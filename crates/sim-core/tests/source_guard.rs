//! Backstop scan of `sim-core/src` for constructs that break determinism (R8.1).
//!
//! Clippy (`clippy.toml` plus the denied lints in `lib.rs`) is the primary guard, but an
//! `#[allow(...)]` silences it. This test reads the raw text of every source file, blanks
//! out comments and string/char literals, and then fails on float literals and banned
//! names, whatever attributes surround them.
//!
//! It reads nothing except `src/**/*.rs` of this crate and uses only `std`.

use std::fs;
use std::path::{Path, PathBuf};

/// Identifiers that must not appear in simulation code.
const BANNED_IDENTS: &[&str] = &[
    "f32",
    "f64",
    "HashMap",
    "HashSet",
    "Instant",
    "SystemTime",
    "thread_rng",
    "getrandom",
];

/// `a::b` pairs that must not appear in simulation code.
///
/// The scan sees pairs of adjacent identifiers, so `std::thread::Builder::new().spawn(..)`
/// is caught through `thread::Builder`. An item imported by name (`use std::thread::scope;`
/// then `scope(..)`) is not caught here; clippy resolves paths and catches that case.
const BANNED_PATHS: &[(&str, &str)] = &[
    ("thread", "spawn"),
    ("thread", "scope"),
    ("thread", "Builder"),
    ("thread", "available_parallelism"),
    ("env", "var"),
    ("env", "vars"),
    ("env", "var_os"),
    ("env", "vars_os"),
];

fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_'
}

/// Replaces comments and string/char literals with spaces. Newlines are kept so that
/// line numbers in reports still match the original file.
fn strip(src: &str) -> String {
    let chars: Vec<char> = src.chars().collect();
    let mut out: Vec<char> = Vec::with_capacity(chars.len());
    let blank = |c: char| if c == '\n' { '\n' } else { ' ' };
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        // Line comment (also covers `///` and `//!`).
        if c == '/' && next == Some('/') {
            while i < chars.len() && chars[i] != '\n' {
                out.push(' ');
                i += 1;
            }
            continue;
        }
        // Block comment; Rust block comments nest.
        if c == '/' && next == Some('*') {
            let mut depth = 0usize;
            while i < chars.len() {
                if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
                    depth += 1;
                    out.push(' ');
                    out.push(' ');
                    i += 2;
                } else if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    depth -= 1;
                    out.push(' ');
                    out.push(' ');
                    i += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    out.push(blank(chars[i]));
                    i += 1;
                }
            }
            continue;
        }
        // Raw string: r"..", r#".."#, br".." (the `b` was already emitted as plain code).
        if c == 'r' {
            let prev = if i > 0 { Some(chars[i - 1]) } else { None };
            let prev2 = if i > 1 { Some(chars[i - 2]) } else { None };
            let prefix_ok = match prev {
                None => true,
                Some('b') => !prev2.is_some_and(is_ident_char),
                Some(p) => !is_ident_char(p),
            };
            if prefix_ok {
                let mut j = i + 1;
                let mut hashes = 0usize;
                while chars.get(j) == Some(&'#') {
                    hashes += 1;
                    j += 1;
                }
                if chars.get(j) == Some(&'"') {
                    j += 1;
                    // Find the closing quote followed by the same number of hashes.
                    loop {
                        if j >= chars.len() {
                            break;
                        }
                        if chars[j] == '"'
                            && (0..hashes).all(|k| chars.get(j + 1 + k) == Some(&'#'))
                        {
                            j += 1 + hashes;
                            break;
                        }
                        j += 1;
                    }
                    for &ch in &chars[i..j.min(chars.len())] {
                        out.push(blank(ch));
                    }
                    i = j.min(chars.len());
                    continue;
                }
            }
        }
        // Ordinary (or byte) string literal.
        if c == '"' {
            out.push(' ');
            i += 1;
            while i < chars.len() {
                let ch = chars[i];
                if ch == '\\' {
                    out.push(' ');
                    if let Some(&esc) = chars.get(i + 1) {
                        out.push(blank(esc));
                    }
                    i += 2;
                    continue;
                }
                out.push(blank(ch));
                i += 1;
                if ch == '"' {
                    break;
                }
            }
            continue;
        }
        // Char literal versus lifetime.
        if c == '\'' {
            let is_escape = next == Some('\\');
            let is_plain = chars.get(i + 2) == Some(&'\'') && next.is_some() && next != Some('\'');
            if is_escape || is_plain {
                out.push(' ');
                i += 1;
                while i < chars.len() {
                    let ch = chars[i];
                    if ch == '\\' {
                        out.push(' ');
                        if let Some(&esc) = chars.get(i + 1) {
                            out.push(blank(esc));
                        }
                        i += 2;
                        continue;
                    }
                    out.push(blank(ch));
                    i += 1;
                    if ch == '\'' {
                        break;
                    }
                }
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out.into_iter().collect()
}

fn line_of(chars: &[char], idx: usize) -> usize {
    1 + chars[..idx].iter().filter(|&&c| c == '\n').count()
}

/// Finds float literals in already-stripped source. Returns `(line, literal text)`.
fn float_literals(stripped: &str) -> Vec<(usize, String)> {
    let chars: Vec<char> = stripped.chars().collect();
    let mut found = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let glued_to_ident = i > 0 && is_ident_char(chars[i - 1]);
        if !c.is_ascii_digit() || glued_to_ident {
            i += 1;
            continue;
        }
        let start = i;
        // `t.0.1` is tuple access, not a float; `0..5` is a range, not a tuple access.
        let tuple_access = i > 0 && chars[i - 1] == '.' && !(i > 1 && chars[i - 2] == '.');
        // Prefixed integers (hex, binary, octal) can contain `e` or `f` digits; never floats.
        if c == '0' && matches!(chars.get(i + 1), Some('x' | 'b' | 'o')) {
            i += 2;
            while i < chars.len() && is_ident_char(chars[i]) {
                i += 1;
            }
            continue;
        }
        while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '_') {
            i += 1;
        }
        if tuple_access {
            continue;
        }
        let mut is_float = false;
        if chars.get(i) == Some(&'.') {
            match chars.get(i + 1) {
                Some(d) if d.is_ascii_digit() => {
                    is_float = true;
                    i += 1;
                    while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '_') {
                        i += 1;
                    }
                }
                // `1.` is a float; `1..2` is a range and `1.max(2)` a method call.
                Some(&n) if n != '.' && !is_ident_start(n) => {
                    is_float = true;
                    i += 1;
                }
                None => {
                    is_float = true;
                    i += 1;
                }
                _ => {}
            }
        }
        if matches!(chars.get(i), Some('e' | 'E')) {
            let mut k = i + 1;
            if matches!(chars.get(k), Some('+' | '-')) {
                k += 1;
            }
            if chars.get(k).is_some_and(char::is_ascii_digit) {
                is_float = true;
                i = k;
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '_') {
                    i += 1;
                }
            }
        }
        let rest: String = chars[i..chars.len().min(i + 3)].iter().collect();
        if rest == "f32" || rest == "f64" {
            is_float = true;
            i += 3;
        }
        if is_float {
            found.push((line_of(&chars, start), chars[start..i].iter().collect()));
        }
    }
    found
}

#[derive(Debug, PartialEq)]
enum Token {
    Ident(String),
    PathSep,
}

/// Splits stripped source into identifiers and `::`, remembering the line of each.
fn tokens(stripped: &str) -> Vec<(usize, Token)> {
    let chars: Vec<char> = stripped.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let glued_to_ident = i > 0 && is_ident_char(chars[i - 1]);
        if is_ident_start(c) && !glued_to_ident {
            let start = i;
            while i < chars.len() && is_ident_char(chars[i]) {
                i += 1;
            }
            out.push((
                line_of(&chars, start),
                Token::Ident(chars[start..i].iter().collect()),
            ));
        } else if c == ':' && chars.get(i + 1) == Some(&':') {
            out.push((line_of(&chars, i), Token::PathSep));
            i += 2;
        } else {
            i += 1;
        }
    }
    out
}

fn banned_names(stripped: &str) -> Vec<(usize, String)> {
    let toks = tokens(stripped);
    let mut found = Vec::new();
    for (idx, (line, tok)) in toks.iter().enumerate() {
        if let Token::Ident(name) = tok
            && BANNED_IDENTS.contains(&name.as_str())
        {
            found.push((*line, name.clone()));
        }
        if let [
            (_, Token::Ident(a)),
            (_, Token::PathSep),
            (_, Token::Ident(b)),
        ] = &toks[idx..toks.len().min(idx + 3)]
            && BANNED_PATHS.iter().any(|&(x, y)| x == a && y == b)
        {
            found.push((*line, format!("{a}::{b}")));
        }
    }
    found
}

/// Scans one file's text; returns human-readable violations.
fn scan(file: &str, src: &str) -> Vec<String> {
    let stripped = strip(src);
    let mut problems = Vec::new();
    for (line, lit) in float_literals(&stripped) {
        problems.push(format!("{file}:{line}: float literal `{lit}`"));
    }
    for (line, name) in banned_names(&stripped) {
        problems.push(format!("{file}:{line}: banned name `{name}`"));
    }
    problems.sort();
    problems
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
        .map(|entry| entry.expect("directory entry").path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn sim_core_src_has_no_float_literals_or_banned_names() {
    let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    rust_files(&src_dir, &mut files);
    assert!(
        !files.is_empty(),
        "no source files found under {}",
        src_dir.display()
    );

    let mut problems = Vec::new();
    for path in &files {
        let text = fs::read_to_string(path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        let rel = path
            .strip_prefix(&src_dir)
            .unwrap_or(path)
            .display()
            .to_string();
        problems.extend(scan(&rel, &text));
    }
    assert!(
        problems.is_empty(),
        "determinism guard violations:\n{}",
        problems.join("\n")
    );
}

// ---- tests of the scanner itself ----

#[test]
fn banned_word_in_line_comment_passes() {
    assert!(scan("t.rs", "// uses HashMap and 0.5 and f64\nfn a() {}\n").is_empty());
    assert!(scan("t.rs", "/// doc: Instant::now\nfn a() {}\n").is_empty());
}

#[test]
fn banned_word_in_block_comment_passes_even_nested() {
    assert!(
        scan(
            "t.rs",
            "/* HashMap /* f32 */ still comment 1.5 */ fn a() {}"
        )
        .is_empty()
    );
}

#[test]
fn banned_word_in_string_passes() {
    assert!(scan("t.rs", "const S: &str = \"HashMap 0.5 \\\" f64\";").is_empty());
    assert!(scan("t.rs", "const S: &str = r#\"f64 \" HashSet 2.5\"#;").is_empty());
    assert!(scan("t.rs", "const S: &[u8] = br\"SystemTime\";").is_empty());
}

#[test]
fn banned_word_in_code_fails() {
    let hits = scan("t.rs", "use std::collections::HashMap;\n");
    assert_eq!(hits, vec!["t.rs:1: banned name `HashMap`".to_string()]);
    for src in [
        "fn f(x: f32) {}",
        "fn f(x: f64) {}",
        "struct S { s: HashSet<u8> }",
        "let t = Instant::now();",
        "let t = std::time::SystemTime::now();",
        "let r = thread_rng();",
        "use getrandom as g;",
        "std::thread::spawn(|| {});",
        "let v = std::env::var(\"X\");",
        "let v = env::vars();",
    ] {
        assert!(!scan("t.rs", src).is_empty(), "should flag: {src}");
    }
}

#[test]
fn thread_scope_builder_and_parallelism_are_flagged_in_code_only() {
    for src in [
        "std::thread::scope(|_| {});",
        "let b = std::thread::Builder::new();",
        "let n = thread::available_parallelism();",
    ] {
        assert_eq!(scan("t.rs", src).len(), 1, "should flag: {src}");
        assert!(
            scan("t.rs", &format!("// {src}\nfn a() {{}}")).is_empty(),
            "comment: {src}"
        );
        assert!(
            scan(
                "t.rs",
                &format!("const S: &str = \"{}\";", src.replace('"', ""))
            )
            .is_empty(),
            "string: {src}"
        );
    }
}

#[test]
fn lookalike_thread_paths_pass() {
    assert!(
        scan(
            "t.rs",
            "my_thread::scoped(); thread::scoped_x(); thread2::Builder::new();"
        )
        .is_empty()
    );
}

#[test]
fn code_after_a_comment_on_the_same_line_is_still_scanned() {
    assert_eq!(
        scan("t.rs", "let a = 1; /* c */ let m: HashMap<u8, u8>;").len(),
        1
    );
}

#[test]
fn code_hidden_by_allow_attribute_is_still_caught() {
    let src = "#[allow(clippy::all)]\nfn f() {\n    let x = 0.5;\n}\n";
    assert_eq!(
        scan("t.rs", src),
        vec!["t.rs:3: float literal `0.5`".to_string()]
    );
}

#[test]
fn float_literals_are_detected() {
    for lit in [
        "0.5", "1e3", "1E-3", "2e+4", "2f64", "3_f32", "1.", "1.5e3", "10.25f32",
    ] {
        let src = format!("let x = {lit};");
        assert_eq!(float_literals(&strip(&src)).len(), 1, "should flag: {lit}");
    }
}

#[test]
fn integer_like_tokens_are_not_floats() {
    for src in [
        "let a = 10;",
        "let a = 0xE1;",
        "let a = 0x1f32;",
        "let a = 0b101;",
        "let a = 1_000u64;",
        "let a = t.0.1;",
        "for i in 0..5 {}",
        "for i in 1..=2 {}",
        "let a = 1.max(2);",
        "let x1e3 = 5;",
        "let a: [u8; 4] = [0; 4];",
    ] {
        assert!(
            float_literals(&strip(src)).is_empty(),
            "should not flag: {src}"
        );
    }
}

#[test]
fn lifetimes_and_char_literals_do_not_confuse_the_stripper() {
    // A lifetime must not start a "char literal" that swallows following code.
    let src = "fn f<'a>(x: &'a str) -> &'a str { let m: HashMap<u8, u8>; x }";
    assert_eq!(scan("t.rs", src).len(), 1);
    // Char literals (including quote and escapes) are blanked, code after them is scanned.
    let src = "let a = 'x'; let b = '\\''; let c = '\"'; let d = 0.5;";
    assert_eq!(
        scan("t.rs", src),
        vec!["t.rs:1: float literal `0.5`".to_string()]
    );
}

#[test]
fn line_numbers_survive_multiline_comments_and_strings() {
    let src = "/* a\nb\nc */\nconst S: &str = \"x\ny\";\nlet h: HashMap<u8, u8>;\n";
    assert_eq!(
        scan("t.rs", src),
        vec!["t.rs:6: banned name `HashMap`".to_string()]
    );
}

#[test]
fn identifiers_merely_containing_a_banned_word_pass() {
    assert!(
        scan(
            "t.rs",
            "let my_f64_like = 1; struct HashMapLike; fn instant_replay() {}"
        )
        .is_empty()
    );
}
