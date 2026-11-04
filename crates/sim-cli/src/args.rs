//! Hand-written argument parsing (no CLI framework).
//!
//! Every flag takes exactly one value, written `--flag value` or `--flag=value`. Anything
//! else that does not start with `-` is a positional argument. Unknown flags, duplicate
//! flags and flags without a value are errors. Nothing here panics on user input.

use std::collections::BTreeMap;

/// The result of parsing one subcommand's arguments.
#[derive(Debug, Default, Eq, PartialEq)]
pub struct Parsed {
    flags: BTreeMap<String, String>,
    positionals: Vec<String>,
}

impl Parsed {
    /// The value of `--name`, if given.
    pub fn get(&self, name: &str) -> Option<&str> {
        self.flags.get(name).map(String::as_str)
    }

    /// Positional arguments in command-line order.
    pub fn positionals(&self) -> &[String] {
        &self.positionals
    }

    /// The value of `--name` as a decimal `u64`, if given.
    pub fn get_u64(&self, name: &str) -> Result<Option<u64>, String> {
        match self.get(name) {
            None => Ok(None),
            Some(text) => parse_u64(text)
                .map(Some)
                .map_err(|e| format!("--{name}: {e}")),
        }
    }

    /// Like [`Parsed::get_u64`] but the flag must be present.
    pub fn require_u64(&self, name: &str) -> Result<u64, String> {
        self.get_u64(name)?
            .ok_or_else(|| format!("missing required flag --{name}"))
    }
}

/// Parses a plain decimal `u64`: ASCII digits only (no sign, spaces or underscores).
pub fn parse_u64(text: &str) -> Result<u64, String> {
    if text.is_empty() {
        return Err("expected a number, got an empty value".to_owned());
    }
    if !text.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!(
            "expected a non-negative decimal number, got {}",
            shorten(text)
        ));
    }
    text.parse::<u64>()
        .map_err(|_| format!("number {} does not fit in 64 bits", shorten(text)))
}

/// Quotes `text` for an error message, cutting very long values.
fn shorten(text: &str) -> String {
    const MAX: usize = 40;
    if text.chars().count() > MAX {
        let head: String = text.chars().take(MAX).collect();
        format!("{head:?}... ({} characters)", text.chars().count())
    } else {
        format!("{text:?}")
    }
}

/// Parses `args` (without the subcommand name). `allowed` lists the flag names, without
/// the leading `--`, that this subcommand accepts.
pub fn parse(args: &[String], allowed: &[&str]) -> Result<Parsed, String> {
    let mut parsed = Parsed::default();
    let mut rest = args.iter();
    while let Some(arg) = rest.next() {
        let Some(flag) = arg.strip_prefix("--") else {
            if arg.starts_with('-') && arg.len() > 1 {
                return Err(format!("unknown flag {}", shorten(arg)));
            }
            parsed.positionals.push(arg.clone());
            continue;
        };
        let (name, inline_value) = match flag.split_once('=') {
            Some((name, value)) => (name, Some(value.to_owned())),
            None => (flag, None),
        };
        if !allowed.contains(&name) {
            return Err(format!(
                "unknown flag --{}",
                shorten(name).trim_matches('"')
            ));
        }
        let value = match inline_value {
            Some(value) => value,
            None => match rest.next() {
                Some(next) if !next.starts_with("--") => next.clone(),
                _ => return Err(format!("flag --{name} needs a value")),
            },
        };
        if parsed.flags.insert(name.to_owned(), value).is_some() {
            return Err(format!("flag --{name} given more than once"));
        }
    }
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn parses_flags_in_both_forms_and_positionals() {
        let p = parse(
            &v(&["a.json", "--seed", "7", "--ticks=9", "b.json"]),
            &["seed", "ticks"],
        )
        .unwrap();
        assert_eq!(p.get("seed"), Some("7"));
        assert_eq!(p.get("ticks"), Some("9"));
        assert_eq!(p.get("out"), None);
        assert_eq!(p.positionals(), ["a.json", "b.json"]);
        assert_eq!(p.require_u64("seed"), Ok(7));
    }

    #[test]
    fn empty_inline_value_is_kept_and_then_rejected_as_a_number() {
        let p = parse(&v(&["--seed="]), &["seed"]).unwrap();
        assert_eq!(p.get("seed"), Some(""));
        assert!(p.get_u64("seed").is_err());
    }

    #[test]
    fn rejects_unknown_flags() {
        assert!(parse(&v(&["--nope", "1"]), &["seed"]).is_err());
        assert!(parse(&v(&["--nope=1"]), &["seed"]).is_err());
        assert!(parse(&v(&["-x"]), &["seed"]).is_err());
    }

    #[test]
    fn rejects_missing_values() {
        assert!(parse(&v(&["--seed"]), &["seed"]).is_err());
        assert!(parse(&v(&["--seed", "--ticks", "3"]), &["seed", "ticks"]).is_err());
    }

    #[test]
    fn rejects_duplicate_flags() {
        let e = parse(&v(&["--seed", "1", "--seed=2"]), &["seed"]).unwrap_err();
        assert!(e.contains("more than once"), "{e}");
    }

    #[test]
    fn numbers_are_strict_decimal() {
        assert_eq!(parse_u64("0"), Ok(0));
        assert_eq!(parse_u64("18446744073709551615"), Ok(u64::MAX));
        for bad in [
            "",
            "-1",
            "+1",
            " 1",
            "1 ",
            "1_0",
            "0x10",
            "1.5",
            "abc",
            "18446744073709551616",
            &"9".repeat(500),
        ] {
            assert!(parse_u64(bad).is_err(), "{bad:?}");
        }
        // Long values are cut in the message.
        let msg = parse_u64(&"9".repeat(500)).unwrap_err();
        assert!(msg.len() < 120, "{msg}");
    }

    #[test]
    fn missing_required_flag_names_the_flag() {
        let p = parse(&[], &["seed"]).unwrap();
        assert_eq!(
            p.require_u64("seed"),
            Err("missing required flag --seed".to_owned())
        );
    }

    #[test]
    fn a_lone_dash_is_a_positional() {
        let p = parse(&v(&["-"]), &[]).unwrap();
        assert_eq!(p.positionals(), ["-"]);
    }
}
