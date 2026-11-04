//! Subcommand implementations: `record`, `replay`, `check-size`.
//!
//! Each function returns the process exit code (never panics on user-controlled data)
//! and writes its own output to the `out`/`err` writers passed in, so tests can capture
//! output without touching real stdio.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use sim_core::replay::{ReplayConfig, ReplayError, ReplayFile, record as core_record, verify};
use sim_core::world::{DEFAULT_ENTITY_COUNT, Workload, WorldConfig};

use crate::args::{self, Parsed};
use crate::inputs::generate_inputs;

/// Exit code for a usage error, a malformed input, or any other problem that is not a
/// reported divergence or a `check-size` violation.
pub const EXIT_USAGE_OR_MALFORMED: i32 = 2;
/// Exit code for a reported divergence or a `check-size` violation.
pub const EXIT_FAILED: i32 = 1;
pub const EXIT_OK: i32 = 0;

/// Reads a `--config` file: JSON with exactly the replay file's `config` shape, e.g.
/// `{"entity_count":50,"days_per_tick":1,"workload":"Pairwise"}`, then validates it.
pub(crate) fn load_config(path: &str) -> Result<WorldConfig, String> {
    let text =
        fs::read_to_string(path).map_err(|e| format!("cannot read config file {path}: {e}"))?;
    let file: ReplayConfig =
        serde_json::from_str(&text).map_err(|e| format!("cannot parse config file {path}: {e}"))?;
    WorldConfig::try_from(file).map_err(|e| format!("invalid config in {path}: {e}"))
}

/// Largest `--ticks` accepted by `record` (a replay file holds one checksum per tick, so
/// this also bounds file size and memory). 1,000,000 daily ticks is about 2,700 years.
pub const MAX_TICKS: u64 = 1_000_000;
/// Largest `--random-inputs` accepted by `record`.
pub const MAX_RANDOM_INPUTS: u64 = 1_000_000;

/// The config used when `record` gets no `--config`: 50 entities, 1 day per tick,
/// `Pairwise`. (`WorldConfig::default()` is `Light`, so it is not used here.)
pub fn default_config() -> WorldConfig {
    WorldConfig {
        entity_count: DEFAULT_ENTITY_COUNT,
        days_per_tick: 1,
        workload: Workload::Pairwise,
    }
}

pub const RECORD_USAGE: &str = "usage: sim-cli record --seed S --ticks N [--config FILE] \
[--random-inputs K] --out FILE\n\
without --config: 50 entities, 1 day per tick, Pairwise workload";

pub fn record(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let parsed = match args::parse(args, &["seed", "ticks", "config", "random-inputs", "out"]) {
        Ok(p) => p,
        Err(e) => {
            let _ = writeln!(err, "error: {e}\n{RECORD_USAGE}");
            return EXIT_USAGE_OR_MALFORMED;
        }
    };
    match run_record(&parsed) {
        Ok(summary) => {
            let _ = writeln!(out, "{summary}");
            EXIT_OK
        }
        Err(RecordError::Other(e)) => {
            let _ = writeln!(err, "error: {e}");
            EXIT_USAGE_OR_MALFORMED
        }
        Err(RecordError::Diverged(e)) => {
            let _ = writeln!(err, "error: {e}");
            EXIT_FAILED
        }
    }
}

/// Why `record` failed. A fresh replay that does not verify is a determinism failure
/// (exit 1, like `replay`); everything else is exit 2.
enum RecordError {
    Other(String),
    Diverged(String),
}

impl From<String> for RecordError {
    fn from(s: String) -> Self {
        Self::Other(s)
    }
}

fn run_record(parsed: &Parsed) -> Result<String, RecordError> {
    if let Some(stray) = parsed.positionals().first() {
        return Err(format!("unexpected argument {stray:?}").into());
    }
    let seed = parsed.require_u64("seed")?;
    let ticks = parsed.require_u64("ticks")?;
    if !(1..=MAX_TICKS).contains(&ticks) {
        return Err(format!("--ticks must be between 1 and {MAX_TICKS}, got {ticks}").into());
    }
    let random_inputs = parsed.get_u64("random-inputs")?.unwrap_or(0);
    if random_inputs > MAX_RANDOM_INPUTS {
        return Err(format!(
            "--random-inputs must be at most {MAX_RANDOM_INPUTS}, got {random_inputs}"
        )
        .into());
    }
    let out_path = parsed
        .get("out")
        .ok_or_else(|| "missing required flag --out".to_owned())?;
    let config = match parsed.get("config") {
        Some(path) => load_config(path)?,
        None => default_config(),
    };
    let inputs = generate_inputs(seed, random_inputs, ticks, u64::from(config.entity_count));

    let file = core_record(seed, config, &inputs, ticks).map_err(|e| e.to_string())?;
    // Safety net: verify the freshly produced replay in-process before writing it.
    verify(&file).map_err(|e| {
        RecordError::Diverged(format!(
            "record produced a replay that fails to verify: {e}"
        ))
    })?;
    let json = file.to_json_string().map_err(|e| e.to_string())?;

    if let Some(parent) = Path::new(out_path).parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create directory for {out_path}: {e}"))?;
    }
    let mut text = json;
    text.push('\n');
    fs::write(out_path, &text).map_err(|e| format!("cannot write {out_path}: {e}"))?;

    let final_checksum = file
        .checksums
        .last()
        .map(|c| c.to_hex_string())
        .unwrap_or_else(|| "(no ticks)".to_owned());
    Ok(format!(
        "recorded seed={seed} ticks={ticks} inputs={} final_checksum={final_checksum} -> {out_path}",
        file.inputs.len()
    ))
}

pub const REPLAY_USAGE: &str = "usage: sim-cli replay FILE...";

/// Verifies every file. Prints `ok <path>` to `out` for files that verify; prints the
/// divergence or parse error to `err` otherwise. Exit code: 2 if any file was malformed
/// or unreadable, else 1 if any file diverged, else 0.
pub fn replay(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let parsed = match args::parse(args, &[]) {
        Ok(p) => p,
        Err(e) => {
            let _ = writeln!(err, "error: {e}\n{REPLAY_USAGE}");
            return EXIT_USAGE_OR_MALFORMED;
        }
    };
    if parsed.positionals().is_empty() {
        let _ = writeln!(err, "error: no replay files given\n{REPLAY_USAGE}");
        return EXIT_USAGE_OR_MALFORMED;
    }

    let mut any_diverged = false;
    let mut any_malformed = false;
    for path in parsed.positionals() {
        let text = match fs::read_to_string(path) {
            Ok(text) => text,
            Err(e) => {
                any_malformed = true;
                let _ = writeln!(err, "{path}: cannot read file: {e}");
                continue;
            }
        };
        match ReplayFile::from_json_str(&text).and_then(|file| verify(&file)) {
            Ok(()) => {
                let _ = writeln!(out, "ok {path}");
            }
            Err(ReplayError::Diverged(d)) => {
                any_diverged = true;
                let _ = writeln!(err, "{path}: {d}");
            }
            // Bad JSON, unknown version, wrong checksum count, bad seq, bad config...
            Err(e) => {
                any_malformed = true;
                let _ = writeln!(err, "{path}: {e}");
            }
        }
    }
    if any_malformed {
        EXIT_USAGE_OR_MALFORMED
    } else if any_diverged {
        EXIT_FAILED
    } else {
        EXIT_OK
    }
}

pub const CHECK_SIZE_USAGE: &str =
    "usage: sim-cli check-size DIR [--max-bytes N] (default 26214400, 25 MiB)";
const DEFAULT_MAX_BYTES: u64 = 26_214_400;

/// Recursively lists every regular file under `dir`, sorted by path, so output order is
/// deterministic.
fn list_files_sorted(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let entries =
            fs::read_dir(&d).map_err(|e| format!("cannot read directory {}: {e}", d.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("cannot read directory entry: {e}"))?;
            let path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|e| format!("cannot stat {}: {e}", path.display()))?;
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file() {
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
}

/// Exit 0 if every file under `DIR` is strictly below `--max-bytes`; exit 1 (listing
/// offenders) if any file is at or above the limit; exit 2 on a usage error or an
/// unreadable directory.
pub fn check_size(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let parsed = match args::parse(args, &["max-bytes"]) {
        Ok(p) => p,
        Err(e) => {
            let _ = writeln!(err, "error: {e}\n{CHECK_SIZE_USAGE}");
            return EXIT_USAGE_OR_MALFORMED;
        }
    };
    let max_bytes = match parsed.get_u64("max-bytes") {
        Ok(v) => v.unwrap_or(DEFAULT_MAX_BYTES),
        Err(e) => {
            let _ = writeln!(err, "error: {e}");
            return EXIT_USAGE_OR_MALFORMED;
        }
    };
    let dir = match parsed.positionals() {
        [dir] => dir.clone(),
        [] => {
            let _ = writeln!(err, "error: missing DIR\n{CHECK_SIZE_USAGE}");
            return EXIT_USAGE_OR_MALFORMED;
        }
        _ => {
            let _ = writeln!(
                err,
                "error: check-size takes exactly one DIR\n{CHECK_SIZE_USAGE}"
            );
            return EXIT_USAGE_OR_MALFORMED;
        }
    };

    let files = match list_files_sorted(Path::new(&dir)) {
        Ok(f) => f,
        Err(e) => {
            let _ = writeln!(err, "error: {e}");
            return EXIT_USAGE_OR_MALFORMED;
        }
    };

    let mut any_offender = false;
    for path in &files {
        let size = match fs::metadata(path) {
            Ok(m) => m.len(),
            Err(e) => {
                let _ = writeln!(err, "error: cannot stat {}: {e}", path.display());
                return EXIT_USAGE_OR_MALFORMED;
            }
        };
        if size >= max_bytes {
            any_offender = true;
            let _ = writeln!(out, "{} {size} >= {max_bytes}", path.display());
        }
    }
    if any_offender {
        EXIT_FAILED
    } else {
        let _ = writeln!(out, "ok: every file under {dir} is below {max_bytes} bytes");
        EXIT_OK
    }
}
