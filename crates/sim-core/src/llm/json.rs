//! Strict JSON reader and canonical writer for model output (DA-12 A).
//!
//! - Input of more than [`MAX_INPUT_BYTES`] bytes is a `ParseFailure` (`too_large`).
//! - Nesting deeper than [`MAX_DEPTH`] is a `ParseFailure` (`too_deep`). The reader is a
//!   loop with an explicit stack, so deep input costs no recursion.
//! - Numbers keep their lexeme; [`integer_value`] turns a lexeme into an `i64` or says why not.
//! - Duplicate object keys are a `ParseFailure` (`duplicate_key`).
//! - The writer emits keys in byte order, no insignificant whitespace, minimal escapes and
//!   shortest integers.
//!
//! Integers, strings and ordered collections only: no floats, clocks, environment,
//! randomness or I/O.

#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing
)]

use std::collections::BTreeMap;

use super::IllegalReason;

/// Largest accepted input, in bytes.
pub const MAX_INPUT_BYTES: usize = 1_048_576;
/// Largest accepted nesting depth (arrays and objects open at once).
pub const MAX_DEPTH: usize = 64;

/// A parsed JSON value. Numbers keep their source lexeme.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Json {
    Null,
    Bool(bool),
    /// A validated number lexeme such as `-12`, `0`, `1.5` or `1e2`.
    Number(String),
    Str(String),
    Array(Vec<Json>),
    /// `BTreeMap<String, _>` iterates in byte order of the keys.
    Object(BTreeMap<String, Json>),
}

impl Json {
    /// An integer value in its shortest decimal form.
    pub fn int(n: i64) -> Self {
        Json::Number(n.to_string())
    }
}

/// A reader failure. `reason` is always [`IllegalReason::ParseFailure`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JsonError {
    pub reason: IllegalReason,
    pub detail: &'static str,
}

fn fail(detail: &'static str) -> JsonError {
    JsonError {
        reason: IllegalReason::ParseFailure,
        detail,
    }
}

/// Reads an integer-field lexeme: only `-?(0|[1-9][0-9]*)` that fits `i64` is accepted.
///
/// A lexeme with a fraction or exponent is `NonInteger`; a pure integer outside `i64` is
/// `IntegerOutOfRange`.
pub fn integer_value(lexeme: &str) -> Result<i64, IllegalReason> {
    if lexeme.bytes().any(|b| matches!(b, b'.' | b'e' | b'E')) {
        return Err(IllegalReason::NonInteger);
    }
    lexeme
        .parse::<i64>()
        .map_err(|_| IllegalReason::IntegerOutOfRange)
}

enum Frame {
    Array(Vec<Json>),
    /// The map so far and the key whose value is being read.
    Object(BTreeMap<String, Json>, String),
}

struct Reader<'a> {
    src: &'a [u8],
    pos: usize,
}

impl Reader<'_> {
    fn peek(&self) -> Option<u8> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) {
        self.pos = self.pos.saturating_add(1);
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.bump();
        }
    }

    fn expect(&mut self, byte: u8) -> Result<(), JsonError> {
        if self.peek() == Some(byte) {
            self.bump();
            Ok(())
        } else {
            Err(fail("syntax"))
        }
    }

    fn literal(&mut self, word: &[u8]) -> Result<(), JsonError> {
        let end = self.pos.saturating_add(word.len());
        if self.src.get(self.pos..end) == Some(word) {
            self.pos = end;
            Ok(())
        } else {
            Err(fail("syntax"))
        }
    }

    fn digits(&mut self) -> usize {
        let start = self.pos;
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.bump();
        }
        self.pos.saturating_sub(start)
    }

    fn number(&mut self) -> Result<Json, JsonError> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.bump();
        }
        match self.peek() {
            Some(b'0') => self.bump(),
            Some(b'1'..=b'9') => {
                self.digits();
            }
            _ => return Err(fail("syntax")),
        }
        if self.peek() == Some(b'.') {
            self.bump();
            if self.digits() == 0 {
                return Err(fail("syntax"));
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            self.bump();
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.bump();
            }
            if self.digits() == 0 {
                return Err(fail("syntax"));
            }
        }
        let lexeme = self
            .src
            .get(start..self.pos)
            .and_then(|b| std::str::from_utf8(b).ok())
            .ok_or_else(|| fail("syntax"))?;
        Ok(Json::Number(lexeme.to_owned()))
    }

    fn hex4(&mut self) -> Result<u32, JsonError> {
        let end = self.pos.saturating_add(4);
        let digits = self.src.get(self.pos..end).ok_or_else(|| fail("syntax"))?;
        let mut value = 0u32;
        for &b in digits {
            let d = char::from(b).to_digit(16).ok_or_else(|| fail("syntax"))?;
            value = value.saturating_mul(16).saturating_add(d);
        }
        self.pos = end;
        Ok(value)
    }

    fn string(&mut self) -> Result<String, JsonError> {
        self.expect(b'"')?;
        let mut out: Vec<u8> = Vec::new();
        loop {
            let b = self.peek().ok_or_else(|| fail("syntax"))?;
            self.bump();
            match b {
                b'"' => break,
                0..=0x1f => return Err(fail("syntax")),
                b'\\' => {
                    let e = self.peek().ok_or_else(|| fail("syntax"))?;
                    self.bump();
                    let ch = match e {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => {
                            let hi = self.hex4()?;
                            let code = if (0xd800..0xdc00).contains(&hi) {
                                self.expect(b'\\')?;
                                self.expect(b'u')?;
                                let lo = self.hex4()?;
                                if !(0xdc00..0xe000).contains(&lo) {
                                    return Err(fail("syntax"));
                                }
                                0x10000_u32
                                    .saturating_add(hi.saturating_sub(0xd800).saturating_mul(1024))
                                    .saturating_add(lo.saturating_sub(0xdc00))
                            } else {
                                hi
                            };
                            // A lone low surrogate has no `char`; reject it.
                            char::from_u32(code).ok_or_else(|| fail("syntax"))?
                        }
                        _ => return Err(fail("syntax")),
                    };
                    let mut buf = [0u8; 4];
                    out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                }
                _ => out.push(b),
            }
        }
        String::from_utf8(out).map_err(|_| fail("syntax"))
    }

    /// Reads `"key" :` and returns the key.
    fn key(&mut self) -> Result<String, JsonError> {
        self.skip_ws();
        let key = self.string()?;
        self.skip_ws();
        self.expect(b':')?;
        Ok(key)
    }
}

/// Parses `input` as exactly one JSON value with only whitespace around it.
pub fn parse(input: &str) -> Result<Json, JsonError> {
    parse_limited(input, MAX_INPUT_BYTES)
}

/// Like [`parse`] with a caller-chosen byte limit (the JSON API wraps model output in an
/// envelope, so its outer limit is larger than the limit for the model output itself).
pub fn parse_limited(input: &str, max_bytes: usize) -> Result<Json, JsonError> {
    if input.len() > max_bytes {
        return Err(fail("too_large"));
    }
    let mut r = Reader {
        src: input.as_bytes(),
        pos: 0,
    };
    let mut stack: Vec<Frame> = Vec::new();
    loop {
        // Read the start of one value; containers push a frame and loop again.
        r.skip_ws();
        let first = r.peek().ok_or_else(|| fail("syntax"))?;
        let mut value = match first {
            b'[' | b'{' => {
                if stack.len() >= MAX_DEPTH {
                    return Err(fail("too_deep"));
                }
                r.bump();
                r.skip_ws();
                if first == b'[' {
                    if r.peek() == Some(b']') {
                        r.bump();
                        Json::Array(Vec::new())
                    } else {
                        stack.push(Frame::Array(Vec::new()));
                        continue;
                    }
                } else if r.peek() == Some(b'}') {
                    r.bump();
                    Json::Object(BTreeMap::new())
                } else {
                    let key = r.key()?;
                    stack.push(Frame::Object(BTreeMap::new(), key));
                    continue;
                }
            }
            b'"' => Json::Str(r.string()?),
            b't' => {
                r.literal(b"true")?;
                Json::Bool(true)
            }
            b'f' => {
                r.literal(b"false")?;
                Json::Bool(false)
            }
            b'n' => {
                r.literal(b"null")?;
                Json::Null
            }
            b'-' | b'0'..=b'9' => r.number()?,
            _ => return Err(fail("syntax")),
        };
        // Attach the finished value to its parent; closing a container finishes it too.
        loop {
            match stack.last_mut() {
                None => {
                    r.skip_ws();
                    return if r.pos == r.src.len() {
                        Ok(value)
                    } else {
                        Err(fail("syntax"))
                    };
                }
                Some(Frame::Array(items)) => {
                    items.push(value);
                    r.skip_ws();
                    match r.peek() {
                        Some(b',') => {
                            r.bump();
                            break;
                        }
                        Some(b']') => {
                            r.bump();
                        }
                        _ => return Err(fail("syntax")),
                    }
                }
                Some(Frame::Object(map, key)) => {
                    let key = std::mem::take(key);
                    if map.insert(key, value).is_some() {
                        return Err(fail("duplicate_key"));
                    }
                    r.skip_ws();
                    match r.peek() {
                        Some(b',') => {
                            r.bump();
                            let next = r.key()?;
                            if let Some(Frame::Object(_, slot)) = stack.last_mut() {
                                *slot = next;
                            }
                            break;
                        }
                        Some(b'}') => {
                            r.bump();
                        }
                        _ => return Err(fail("syntax")),
                    }
                }
            }
            // The closing bracket was consumed: pop the finished container.
            value = match stack.pop() {
                Some(Frame::Array(items)) => Json::Array(items),
                Some(Frame::Object(map, _)) => Json::Object(map),
                None => return Err(fail("syntax")),
            };
        }
    }
}

enum Piece<'a> {
    Value(&'a Json),
    Text(&'static str),
    Key(&'a str),
}

fn write_string(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Writes `value` in canonical form (byte-order keys, no whitespace, minimal escapes,
/// shortest integers).
pub fn write(value: &Json) -> String {
    let mut out = String::new();
    let mut work = vec![Piece::Value(value)];
    while let Some(piece) = work.pop() {
        match piece {
            Piece::Text(t) => out.push_str(t),
            Piece::Key(k) => {
                write_string(&mut out, k);
                out.push(':');
            }
            Piece::Value(v) => match v {
                Json::Null => out.push_str("null"),
                Json::Bool(true) => out.push_str("true"),
                Json::Bool(false) => out.push_str("false"),
                Json::Number(lexeme) => match integer_value(lexeme) {
                    Ok(n) => out.push_str(&n.to_string()),
                    Err(_) => out.push_str(lexeme),
                },
                Json::Str(s) => write_string(&mut out, s),
                Json::Array(items) => {
                    out.push('[');
                    work.push(Piece::Text("]"));
                    for (i, item) in items.iter().enumerate().rev() {
                        work.push(Piece::Value(item));
                        if i > 0 {
                            work.push(Piece::Text(","));
                        }
                    }
                }
                Json::Object(map) => {
                    out.push('{');
                    work.push(Piece::Text("}"));
                    for (i, (k, item)) in map.iter().enumerate().rev() {
                        work.push(Piece::Value(item));
                        work.push(Piece::Key(k));
                        if i > 0 {
                            work.push(Piece::Text(","));
                        }
                    }
                }
            },
        }
    }
    out
}
