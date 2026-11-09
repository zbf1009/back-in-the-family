//! The `perm_avg` Aggregation_Rule (R20.3 to R20.8, DA-25).
//!
//! For one D Card, the stored `system_one` bodies of its Variant_Permutations are read,
//! each `probabilities` lexeme is converted to an exact decimal with digit operations only,
//! the lexemes are added per option with schoolbook decimal addition, and the option with
//! the largest exact sum is chosen (ties: the smallest option ID by UTF-8 bytes).
//!
//! - A lexeme is `M x 10^X` with `M` a digit string without leading or trailing zeros
//!   (RC-21). Zero is the empty `M` with `X = 0`. At most 40 digits in `M`; the value is at
//!   most 1 by integer comparison; the scale `-X` is at most 60.
//! - Check order for a lexeme: grammar, sign, digits, range, scale.
//! - No float type, no `i128`, no dependency: sums are decimal strings.
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

use super::json::{self, Json};
use super::render::{self, Permutation};
use super::{FrozenContext, TaskSpec};

/// The version of the rule. The rule text file carries the same number on its
/// `rule_version:` line, and `derive` refuses a mismatch (V18).
pub const RULE_VERSION: u32 = 1;

/// Most significant digits of a normalised mantissa.
pub const MAX_DIGITS: usize = 40;
/// Largest scale (`-X` for a negative decimal exponent `X`).
pub const MAX_SCALE: i64 = 60;

/// Exponent digits are clamped here so that any exponent text fits `i64` arithmetic.
const EXPONENT_CAP: i64 = 1 << 40;

// ---------------------------------------------------------------------------------------
// Lexemes
// ---------------------------------------------------------------------------------------

/// A normalised exact decimal `digits x 10^exp`. Zero is `digits == ""` and `exp == 0`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decimal {
    pub digits: String,
    pub exp: i64,
}

/// Why a lexeme is not acceptable; one Illegal reason each.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LexemeError {
    /// Not the JSON number grammar.
    NotNumber,
    /// A leading `-` (including `-0`), or a value above 1.
    OutOfRange,
    /// More than [`MAX_DIGITS`] significant digits.
    Digits,
    /// A decimal exponent below `-MAX_SCALE`.
    Scale,
}

impl LexemeError {
    pub fn reason(self) -> &'static str {
        match self {
            LexemeError::NotNumber => "lexeme_not_number",
            LexemeError::OutOfRange => "lexeme_out_of_range",
            LexemeError::Digits => "lexeme_digits",
            LexemeError::Scale => "lexeme_scale",
        }
    }
}

struct Parts<'a> {
    negative: bool,
    int: &'a str,
    frac: &'a str,
    exp_negative: bool,
    exp_digits: &'a str,
}

fn all_digits(s: &str) -> bool {
    s.bytes().all(|b| b.is_ascii_digit())
}

/// The JSON number grammar `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`.
fn split_grammar(s: &str) -> Option<Parts<'_>> {
    let (negative, rest) = match s.strip_prefix('-') {
        Some(r) => (true, r),
        None => (false, s),
    };
    let (mantissa, exponent) = match rest.split_once(['e', 'E']) {
        Some((m, e)) => (m, Some(e)),
        None => (rest, None),
    };
    let (int, frac) = match mantissa.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (mantissa, None),
    };
    let int_ok =
        int == "0" || (int.starts_with(|c: char| ('1'..='9').contains(&c)) && all_digits(int));
    let frac = match frac {
        Some(f) if !f.is_empty() && all_digits(f) => f,
        Some(_) => return None,
        None => "",
    };
    let (exp_negative, exp_digits) = match exponent {
        None => (false, ""),
        Some(e) => {
            let (neg, d) = match e.strip_prefix('-') {
                Some(d) => (true, d),
                None => (false, e.strip_prefix('+').unwrap_or(e)),
            };
            if d.is_empty() || !all_digits(d) {
                return None;
            }
            (neg, d)
        }
    };
    int_ok.then_some(Parts {
        negative,
        int,
        frac,
        exp_negative,
        exp_digits,
    })
}

fn clamp_exponent(digits: &str) -> i64 {
    digits.bytes().fold(0i64, |acc, b| {
        acc.saturating_mul(10)
            .saturating_add(i64::from(b.saturating_sub(b'0')))
            .min(EXPONENT_CAP)
    })
}

/// Converts one lexeme to an exact normalised decimal, or says which check failed first.
pub fn parse_lexeme(lexeme: &str) -> Result<Decimal, LexemeError> {
    // 1. grammar
    let p = split_grammar(lexeme).ok_or(LexemeError::NotNumber)?;
    // 2. sign
    if p.negative {
        return Err(LexemeError::OutOfRange);
    }
    // 3. digits
    let mut mantissa: String = p
        .int
        .chars()
        .chain(p.frac.chars())
        .skip_while(|c| *c == '0')
        .collect();
    let exp = clamp_exponent(p.exp_digits);
    let exp = if p.exp_negative {
        exp.saturating_neg()
    } else {
        exp
    };
    let frac_len = i64::try_from(p.frac.len()).unwrap_or(i64::MAX);
    let mut x = exp.saturating_sub(frac_len);
    let trimmed = mantissa.trim_end_matches('0').len();
    let zeros = mantissa.len().saturating_sub(trimmed);
    mantissa.truncate(trimmed);
    x = x.saturating_add(i64::try_from(zeros).unwrap_or(i64::MAX));
    if mantissa.is_empty() {
        return Ok(Decimal {
            digits: mantissa,
            exp: 0,
        });
    }
    if mantissa.len() > MAX_DIGITS {
        return Err(LexemeError::Digits);
    }
    // 4. range (integer comparison)
    let len = i64::try_from(mantissa.len()).unwrap_or(i64::MAX);
    let within = (mantissa == "1" && x == 0) || (x < 0 && len <= x.saturating_neg());
    if !within {
        return Err(LexemeError::OutOfRange);
    }
    // 5. scale
    if x < 0 && x.saturating_neg() > MAX_SCALE {
        return Err(LexemeError::Scale);
    }
    Ok(Decimal {
        digits: mantissa,
        exp: x,
    })
}

impl Decimal {
    /// The scale `s`: `-X` for a negative exponent, else 0.
    pub fn scale(&self) -> usize {
        usize::try_from(self.exp.saturating_neg()).unwrap_or(0)
    }

    /// The digit string of `value x 10^scale` (`scale` must be at least [`Decimal::scale`]).
    pub fn scaled(&self, scale: usize) -> String {
        if self.digits.is_empty() {
            return "0".to_owned();
        }
        let shift = i64::try_from(scale)
            .unwrap_or(i64::MAX)
            .saturating_add(self.exp);
        let zeros = usize::try_from(shift).unwrap_or(0);
        let mut out = self.digits.clone();
        out.extend(std::iter::repeat_n('0', zeros));
        out
    }
}

// ---------------------------------------------------------------------------------------
// Decimal-string arithmetic
// ---------------------------------------------------------------------------------------

fn digit(b: Option<u8>) -> u8 {
    b.map_or(0, |b| b.saturating_sub(b'0'))
}

/// Schoolbook addition of two non-negative decimal digit strings; no leading zeros in the
/// result (`"0"` for zero).
pub fn add_decimal(a: &str, b: &str) -> String {
    let mut ai = a.bytes().rev();
    let mut bi = b.bytes().rev();
    let mut out: Vec<u8> = Vec::new();
    let mut carry = 0u8;
    loop {
        let (x, y) = (ai.next(), bi.next());
        if x.is_none() && y.is_none() && carry == 0 {
            break;
        }
        let sum = digit(x).saturating_add(digit(y)).saturating_add(carry);
        out.push(b'0'.saturating_add(sum.checked_rem(10).unwrap_or(0)));
        carry = sum.checked_div(10).unwrap_or(0);
    }
    while out.len() > 1 && out.last() == Some(&b'0') {
        out.pop();
    }
    if out.is_empty() {
        out.push(b'0');
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

/// Compares two normalised digit strings: by length, then lexicographically.
pub fn cmp_decimal(a: &str, b: &str) -> std::cmp::Ordering {
    a.len().cmp(&b.len()).then_with(|| a.cmp(b))
}

// ---------------------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------------------

/// What `scope` of the request means.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    /// The kept permutations of the Card (base, reversed, rotated_1, rotated_2).
    Scored,
    /// The base Permutation only (RC-19).
    Sanity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallStatus {
    Ok,
    Timeout,
    Error,
    EngineFault,
    Missing,
}

impl CallStatus {
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "ok" => Some(CallStatus::Ok),
            "timeout" => Some(CallStatus::Timeout),
            "error" => Some(CallStatus::Error),
            "engine_fault" => Some(CallStatus::EngineFault),
            "missing" => Some(CallStatus::Missing),
            _ => None,
        }
    }
}

/// One stored call as the caller passes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallInput {
    pub permutation: String,
    pub status: CallStatus,
    pub body: Option<String>,
}

/// One call that was read successfully.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallRead {
    pub permutation: String,
    pub choice: String,
    /// `(option ID, lexeme)` in option-ID byte order.
    pub probabilities: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Illegal {
    pub reason: &'static str,
    pub call: Option<String>,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sums {
    pub scale: usize,
    /// `(option ID, exact scaled sum)` in option-ID byte order.
    pub options: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Positions {
    pub original: usize,
    pub shown: Vec<(String, usize)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Answer {
    Decision(String),
    Illegal(Illegal),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Aggregation {
    pub answer: Answer,
    /// `None` when the answer is Illegal (every failure comes before the sums).
    pub sums: Option<Sums>,
    /// The calls read before the first failure, in the set's order.
    pub calls: Vec<CallRead>,
    pub positions: Option<Positions>,
}

fn illegal(reason: &'static str, call: Option<&str>, detail: String) -> Illegal {
    Illegal {
        reason,
        call: call.map(str::to_owned),
        detail,
    }
}

/// The permutations whose calls the rule needs, in order.
pub fn variant_permutations(ctx: &FrozenContext, scope: Scope) -> Vec<Permutation> {
    match scope {
        Scope::Sanity => vec![Permutation::Base],
        Scope::Scored => render::permutations(ctx),
    }
}

fn option_ids(ctx: &FrozenContext) -> Vec<String> {
    match &ctx.spec {
        TaskSpec::Decision { options } => {
            options.iter().map(|o| o.id.as_str().to_owned()).collect()
        }
        TaskSpec::Synthesis { .. } => Vec::new(),
    }
}

fn read_call(
    name: &str,
    call: &CallInput,
    question_id: &str,
    options: &[String],
) -> Result<(CallRead, Vec<Decimal>), Illegal> {
    let fail = |reason: &'static str, detail: &str| illegal(reason, Some(name), detail.to_owned());
    match call.status {
        CallStatus::Ok => {}
        CallStatus::Timeout => return Err(fail("call_timeout", "the call timed out")),
        CallStatus::Error => return Err(fail("call_error", "the call ended in an error")),
        CallStatus::EngineFault => {
            return Err(fail(
                "call_engine_fault",
                "the call ended in an engine fault",
            ));
        }
        CallStatus::Missing => return Err(fail("call_missing", "the call has no record")),
    }
    let Some(body) = call.body.as_deref() else {
        return Err(fail("body_not_json", "the call has no body"));
    };
    let Ok(root) = json::parse(body) else {
        return Err(fail("body_not_json", "the body is not valid JSON"));
    };
    let answer = match &root {
        Json::Object(m) => m.get("result"),
        _ => None,
    }
    .and_then(|v| match v {
        Json::Object(m) => m.get("answers"),
        _ => None,
    })
    .and_then(|v| match v {
        Json::Object(m) => m.get(question_id),
        _ => None,
    });
    let Some(Json::Object(answer)) = answer else {
        return Err(fail("no_answer", "no result.answers.<question_id> object"));
    };
    let choice = match answer.get("choice") {
        Some(Json::Str(s)) => s.clone(),
        _ => {
            return Err(fail(
                "choice_missing_or_not_string",
                "choice is absent or not a string",
            ));
        }
    };
    if !options.contains(&choice) {
        return Err(fail("choice_not_option", "choice is not an option ID"));
    }
    let Some(Json::Object(probs)) = answer.get("probabilities") else {
        return Err(fail(
            "no_probabilities",
            "probabilities is absent or not an object",
        ));
    };
    if let Some(key) = probs.keys().find(|k| !options.contains(k)) {
        return Err(fail("probabilities_keys", &format!("unknown key {key}")));
    }
    if let Some(id) = options.iter().find(|id| !probs.contains_key(*id)) {
        return Err(fail("probabilities_keys", &format!("missing option {id}")));
    }
    let mut lexemes: BTreeMap<&str, (&str, Decimal)> = BTreeMap::new();
    for id in options {
        let Some(value) = probs.get(id) else {
            continue;
        };
        let Json::Number(lexeme) = value else {
            return Err(fail(
                "lexeme_not_number",
                &format!("{id}: the probability is not a number"),
            ));
        };
        match parse_lexeme(lexeme) {
            Ok(d) => {
                lexemes.insert(id.as_str(), (lexeme.as_str(), d));
            }
            Err(e) => return Err(fail(e.reason(), &format!("{id}: {lexeme}"))),
        }
    }
    let probabilities = lexemes
        .iter()
        .map(|(id, (lexeme, _))| ((*id).to_owned(), (*lexeme).to_owned()))
        .collect();
    let decimals: Vec<Decimal> = lexemes.into_values().map(|(_, d)| d).collect();
    Ok((
        CallRead {
            permutation: name.to_owned(),
            choice,
            probabilities,
        },
        decimals,
    ))
}

/// Runs the Aggregation_Rule on a D context. `None` for an S context.
pub fn aggregate(
    ctx: &FrozenContext,
    scope: Scope,
    question_id: &str,
    calls: &[CallInput],
) -> Option<Aggregation> {
    if !matches!(ctx.spec, TaskSpec::Decision { .. }) {
        return None;
    }
    let options = option_ids(ctx);
    let set = variant_permutations(ctx, scope);
    let mut read: Vec<CallRead> = Vec::new();
    // Per call, the decimals in option-ID byte order.
    let mut decimals: Vec<Vec<Decimal>> = Vec::new();
    let fail = |read: Vec<CallRead>, why: Illegal| {
        Some(Aggregation {
            answer: Answer::Illegal(why),
            sums: None,
            calls: read,
            positions: None,
        })
    };
    for perm in &set {
        let name = perm.name();
        let mut matching = calls.iter().filter(|c| c.permutation == name);
        let (Some(call), None) = (matching.next(), matching.next()) else {
            let why = illegal(
                "call_missing",
                Some(name),
                "the call is absent or appears twice".to_owned(),
            );
            return fail(read, why);
        };
        match read_call(name, call, question_id, &options) {
            Ok((r, d)) => {
                read.push(r);
                decimals.push(d);
            }
            Err(why) => return fail(read, why),
        }
    }
    if let Some(extra) = calls
        .iter()
        .find(|c| !set.iter().any(|p| p.name() == c.permutation))
    {
        let why = illegal(
            "call_missing",
            Some(&extra.permutation),
            "the call is not a Variant_Permutation of this Card".to_owned(),
        );
        return fail(read, why);
    }

    let scale = decimals
        .iter()
        .flatten()
        .map(Decimal::scale)
        .max()
        .unwrap_or(0);
    let mut sorted_ids = options.clone();
    sorted_ids.sort();
    let mut totals: Vec<String> = vec!["0".to_owned(); sorted_ids.len()];
    for call in &decimals {
        for (total, d) in totals.iter_mut().zip(call) {
            *total = add_decimal(total, &d.scaled(scale));
        }
    }
    let sums: Vec<(String, String)> = sorted_ids.into_iter().zip(totals).collect();
    let mut best: Option<&(String, String)> = None;
    for entry in &sums {
        best = match best {
            Some(b) if cmp_decimal(&entry.1, &b.1) != std::cmp::Ordering::Greater => Some(b),
            _ => Some(entry),
        };
    }
    let chosen = best.map(|b| b.0.clone())?;
    let position = |perm: Permutation| {
        render::criteria(ctx, perm)
            .iter()
            .position(|(id, _)| *id == chosen)
            .map_or(0, |i| i.saturating_add(1))
    };
    let positions = Positions {
        original: position(Permutation::Base),
        shown: set
            .iter()
            .map(|p| (p.name().to_owned(), position(*p)))
            .collect(),
    };
    Some(Aggregation {
        answer: Answer::Decision(chosen),
        sums: Some(Sums {
            scale,
            options: sums,
        }),
        calls: read,
        positions: Some(positions),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_with_carry() {
        assert_eq!(add_decimal("999", "1"), "1000");
        assert_eq!(add_decimal("0", "0"), "0");
        assert_eq!(add_decimal("05", "5"), "10");
    }

    #[test]
    fn normalises_equal_values_alike() {
        let a = parse_lexeme("0.50");
        assert_eq!(a, parse_lexeme("5e-1"));
        assert_eq!(a, parse_lexeme("0.5"));
        assert_eq!(parse_lexeme("0.0e5"), parse_lexeme("0"));
    }

    #[test]
    fn trailing_zeros_move_into_the_exponent() {
        // Shrunk proptest cases: the normalised mantissa and scale, not the written ones.
        let d = |digits: &str, exp: i64| {
            Ok(Decimal {
                digits: digits.to_owned(),
                exp,
            })
        };
        assert_eq!(parse_lexeme("499811970e-19"), d("49981197", -18));
        assert_eq!(
            parse_lexeme("0.000000000000000000000000000000044212560000"),
            d("4421256", -38)
        );
        assert_eq!(parse_lexeme("0.00e-5"), d("", 0));
    }
}
