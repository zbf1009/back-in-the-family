//! Black-box tests of the built `sim-cli` binary: output and exit codes (R6.3).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU32, Ordering};

use sim_core::replay::{ReplayFile, verify};
use sim_core::world::Workload;

/// A unique directory under the system temp dir, removed on drop.
struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let path =
            std::env::temp_dir().join(format!("sim-cli-test-{}-{n}-{label}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn path(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn sim_cli(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_sim-cli"))
        .args(args)
        .output()
        .unwrap()
}

fn code(o: &Output) -> i32 {
    o.status.code().expect("process exited by signal")
}

fn stdout(o: &Output) -> String {
    String::from_utf8_lossy(&o.stdout).into_owned()
}

fn stderr(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).into_owned()
}

fn s(p: &Path) -> &str {
    p.to_str().unwrap()
}

/// Records a small replay with random inputs and returns its path.
fn record_small(dir: &TempDir, name: &str) -> PathBuf {
    let path = dir.path(name);
    let o = sim_cli(&[
        "record",
        "--seed",
        "11",
        "--ticks",
        "40",
        "--random-inputs",
        "20",
        "--out",
        s(&path),
    ]);
    assert_eq!(code(&o), 0, "{}", stderr(&o));
    path
}

#[test]
fn help_exits_zero_and_missing_or_unknown_subcommand_exits_two() {
    for args in [&["--help"][..], &["-h"], &["record", "--help"]] {
        let o = sim_cli(args);
        assert_eq!(code(&o), 0);
        assert!(stdout(&o).contains("USAGE"));
    }
    let o = sim_cli(&[]);
    assert_eq!(code(&o), 2);
    assert!(stderr(&o).contains("missing subcommand"));
    let o = sim_cli(&["frobnicate"]);
    assert_eq!(code(&o), 2);
    assert!(stderr(&o).contains("unknown subcommand"));
}

#[test]
fn record_without_config_uses_the_documented_defaults() {
    let dir = TempDir::new("defaults");
    let path = record_small(&dir, "a.replay.json");
    let file = ReplayFile::from_json_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(file.config.entity_count, 50);
    assert_eq!(file.config.days_per_tick, 1);
    assert_eq!(
        Workload::from(file.config.workload),
        Workload::Pairwise,
        "default workload"
    );
    assert_eq!(file.inputs.len(), 20);
    assert_eq!(file.ticks, 40);
    assert_eq!(verify(&file), Ok(()));
}

#[test]
fn record_summary_line_and_trailing_newline() {
    let dir = TempDir::new("summary");
    let path = dir.path("a.json");
    let o = sim_cli(&["record", "--seed=3", "--ticks=5", "--out", s(&path)]);
    assert_eq!(code(&o), 0);
    let out = stdout(&o);
    assert!(
        out.starts_with("recorded seed=3 ticks=5 inputs=0 final_checksum="),
        "{out}"
    );
    let text = fs::read_to_string(&path).unwrap();
    assert!(text.ends_with("}\n"));
    // The file with its trailing newline is accepted by replay.
    assert_eq!(code(&sim_cli(&["replay", s(&path)])), 0);
}

#[test]
fn record_is_reproducible_byte_for_byte_and_creates_parent_directories() {
    let dir = TempDir::new("repro");
    let a = dir.path("x/y/a.json");
    let b = dir.path("b.json");
    for out in [&a, &b] {
        let o = sim_cli(&[
            "record",
            "--seed",
            "18446744073709551557",
            "--ticks",
            "60",
            "--random-inputs",
            "30",
            "--out",
            s(out),
        ]);
        assert_eq!(code(&o), 0, "{}", stderr(&o));
    }
    assert_eq!(fs::read(&a).unwrap(), fs::read(&b).unwrap());
}

#[test]
fn record_reads_a_config_file() {
    let dir = TempDir::new("config");
    let cfg = dir.path("cfg.json");
    fs::write(
        &cfg,
        r#"{"entity_count":7,"days_per_tick":7,"workload":"Light"}"#,
    )
    .unwrap();
    let out = dir.path("a.json");
    let o = sim_cli(&[
        "record",
        "--seed",
        "1",
        "--ticks",
        "10",
        "--config",
        s(&cfg),
        "--out",
        s(&out),
    ]);
    assert_eq!(code(&o), 0, "{}", stderr(&o));
    let file = ReplayFile::from_json_str(&fs::read_to_string(&out).unwrap()).unwrap();
    assert_eq!(file.config.entity_count, 7);
    assert_eq!(file.config.days_per_tick, 7);
}

#[test]
fn record_usage_errors_exit_two_and_write_nothing() {
    let dir = TempDir::new("usage");
    let out = dir.path("never.json");
    let o_arg = s(&out);
    let bad_cfg = dir.path("bad.json");
    fs::write(
        &bad_cfg,
        r#"{"entity_count":7,"days_per_tick":3,"workload":"Light"}"#,
    )
    .unwrap();
    let garbage_cfg = dir.path("garbage.json");
    fs::write(&garbage_cfg, "not json").unwrap();
    let huge = "9".repeat(5000);

    let cases: Vec<Vec<&str>> = vec![
        vec!["record"],
        vec!["record", "--ticks", "5", "--out", o_arg],
        vec!["record", "--seed", "1", "--out", o_arg],
        vec!["record", "--seed", "1", "--ticks", "5"],
        vec!["record", "--seed", "1", "--ticks", "0", "--out", o_arg],
        vec![
            "record", "--seed", "1", "--ticks", "1000001", "--out", o_arg,
        ],
        vec!["record", "--seed", "x", "--ticks", "5", "--out", o_arg],
        vec!["record", "--seed", "-1", "--ticks", "5", "--out", o_arg],
        vec!["record", "--seed", &huge, "--ticks", "5", "--out", o_arg],
        vec![
            "record", "--seed", "1", "--seed", "2", "--ticks", "5", "--out", o_arg,
        ],
        vec![
            "record", "--seed", "1", "--ticks", "5", "--wat", "1", "--out", o_arg,
        ],
        vec!["record", "--seed", "1", "--ticks", "5", "--out"],
        vec![
            "record",
            "--seed",
            "1",
            "--ticks",
            "5",
            "--random-inputs",
            "1000001",
            "--out",
            o_arg,
        ],
        vec![
            "record", "--seed", "1", "--ticks", "5", "stray", "--out", o_arg,
        ],
        vec![
            "record",
            "--seed",
            "1",
            "--ticks",
            "5",
            "--config",
            s(&bad_cfg),
            "--out",
            o_arg,
        ],
        vec![
            "record",
            "--seed",
            "1",
            "--ticks",
            "5",
            "--config",
            s(&garbage_cfg),
            "--out",
            o_arg,
        ],
        vec![
            "record",
            "--seed",
            "1",
            "--ticks",
            "5",
            "--config",
            "/nonexistent/cfg.json",
            "--out",
            o_arg,
        ],
    ];
    for args in cases {
        let o = sim_cli(&args);
        assert_eq!(code(&o), 2, "{args:?}: {}", stderr(&o));
        assert!(stderr(&o).contains("error:"), "{args:?}");
        assert!(!stderr(&o).contains("panicked"), "{args:?}");
    }
    assert!(
        !out.exists(),
        "a failed record must not create the output file"
    );
}

#[test]
fn record_fails_with_two_when_the_output_cannot_be_written() {
    let dir = TempDir::new("unwritable");
    // The output path is an existing directory.
    let o = sim_cli(&[
        "record",
        "--seed",
        "1",
        "--ticks",
        "3",
        "--out",
        s(&dir.path("")),
    ]);
    assert_eq!(code(&o), 2);
    // A parent that is a file.
    let file = dir.path("f");
    fs::write(&file, "x").unwrap();
    let nested = file.join("child.json");
    let o = sim_cli(&["record", "--seed", "1", "--ticks", "3", "--out", s(&nested)]);
    assert_eq!(code(&o), 2);
}

#[test]
fn replay_ok_prints_ok_lines_and_exits_zero() {
    let dir = TempDir::new("replay-ok");
    let a = record_small(&dir, "a.json");
    let b = record_small(&dir, "b.json");
    let o = sim_cli(&["replay", s(&a), s(&b)]);
    assert_eq!(code(&o), 0);
    assert_eq!(stdout(&o), format!("ok {}\nok {}\n", s(&a), s(&b)));
    assert_eq!(stderr(&o), "");
}

/// Changes the hex digit at the end of the checksum at `tick`.
fn tamper(text: &str, original: &str, replacement: &str) -> String {
    let patched = text.replacen(original, replacement, 1);
    assert_ne!(patched, text);
    patched
}

#[test]
fn replay_names_the_first_divergent_tick_and_exits_one() {
    let dir = TempDir::new("replay-diverged");
    let path = record_small(&dir, "a.json");
    let text = fs::read_to_string(&path).unwrap();
    let file = ReplayFile::from_json_str(&text).unwrap();
    let real = file.checksums[17].to_hex_string();
    let flipped = format!("{:016x}", file.checksums[17].0 ^ 1);
    let bad = dir.path("bad.json");
    fs::write(&bad, tamper(&text, &real, &flipped)).unwrap();

    let o = sim_cli(&["replay", s(&bad)]);
    assert_eq!(code(&o), 1);
    let err = stderr(&o);
    assert!(err.contains("tick 17"), "{err}");
    assert!(err.contains(&format!("expected {flipped}")), "{err}");
    assert!(err.contains(&format!("got {real}")), "{err}");
    assert_eq!(stdout(&o), "");
}

#[test]
fn replay_malformed_inputs_exit_two() {
    let dir = TempDir::new("replay-bad");
    let path = record_small(&dir, "a.json");
    let text = fs::read_to_string(&path).unwrap();
    let file = ReplayFile::from_json_str(&text).unwrap();

    // One checksum removed: the count no longer matches `ticks`.
    let last = file.checksums.last().unwrap().to_hex_string();
    let truncated = dir.path("truncated.json");
    fs::write(&truncated, text.replacen(&format!(",\"{last}\""), "", 1)).unwrap();
    let o = sim_cli(&["replay", s(&truncated)]);
    assert_eq!(code(&o), 2);
    assert!(stderr(&o).contains("checksums"), "{}", stderr(&o));

    let garbage = dir.path("garbage.json");
    fs::write(&garbage, "this is not json").unwrap();
    let o = sim_cli(&["replay", s(&garbage)]);
    assert_eq!(code(&o), 2);
    assert!(stderr(&o).contains("malformed"), "{}", stderr(&o));

    let missing = dir.path("missing.json");
    let o = sim_cli(&["replay", s(&missing)]);
    assert_eq!(code(&o), 2);
    assert!(stderr(&o).contains("missing.json"), "{}", stderr(&o));
    assert!(stderr(&o).contains("cannot read file"), "{}", stderr(&o));

    // A directory is not a replay file.
    assert_eq!(code(&sim_cli(&["replay", s(&dir.path(""))])), 2);

    // Wrong version.
    let v2 = dir.path("v2.json");
    fs::write(&v2, text.replacen("\"version\":1", "\"version\":2", 1)).unwrap();
    assert_eq!(code(&sim_cli(&["replay", s(&v2)])), 2);

    // No files, unknown flag.
    assert_eq!(code(&sim_cli(&["replay"])), 2);
    assert_eq!(code(&sim_cli(&["replay", "--wat"])), 2);
}

#[test]
fn replay_with_several_files_processes_all_and_reports_the_worst_code() {
    let dir = TempDir::new("replay-many");
    let good = record_small(&dir, "good.json");
    let text = fs::read_to_string(&good).unwrap();
    let file = ReplayFile::from_json_str(&text).unwrap();
    let real = file.checksums[3].to_hex_string();
    let diverged = dir.path("diverged.json");
    fs::write(
        &diverged,
        tamper(&text, &real, &format!("{:016x}", file.checksums[3].0 ^ 1)),
    )
    .unwrap();
    let garbage = dir.path("garbage.json");
    fs::write(&garbage, "{").unwrap();

    // Diverged only: 1, and the good file after it is still checked.
    let o = sim_cli(&["replay", s(&diverged), s(&good)]);
    assert_eq!(code(&o), 1);
    assert_eq!(stdout(&o), format!("ok {}\n", s(&good)));

    // Malformed wins over diverged: 2.
    let o = sim_cli(&["replay", s(&diverged), s(&garbage), s(&good)]);
    assert_eq!(code(&o), 2);
    assert_eq!(stdout(&o), format!("ok {}\n", s(&good)));
    assert!(stderr(&o).contains("tick 3"));
    assert!(stderr(&o).contains("garbage.json"));
}

#[test]
fn check_size_boundary_is_strictly_below_the_limit() {
    let dir = TempDir::new("size");
    fs::write(dir.path("ten"), [0u8; 10]).unwrap();
    // 10 bytes: below 11, not below 10.
    assert_eq!(
        code(&sim_cli(&[
            "check-size",
            s(&dir.path("")),
            "--max-bytes",
            "11"
        ])),
        0
    );
    let o = sim_cli(&["check-size", s(&dir.path("")), "--max-bytes=10"]);
    assert_eq!(code(&o), 1);
    assert!(stdout(&o).contains("ten 10 >= 10"), "{}", stdout(&o));
    // The default limit is 25 MiB.
    assert_eq!(code(&sim_cli(&["check-size", s(&dir.path(""))])), 0);
}

#[test]
fn check_size_walks_subdirectories_in_sorted_order() {
    let dir = TempDir::new("size-walk");
    fs::create_dir_all(dir.path("b/inner")).unwrap();
    fs::create_dir_all(dir.path("a")).unwrap();
    for rel in ["b/inner/z", "b/y", "a/x", "top"] {
        fs::write(dir.path(rel), [1u8; 4]).unwrap();
    }
    let o = sim_cli(&["check-size", s(&dir.path("")), "--max-bytes", "1"]);
    assert_eq!(code(&o), 1);
    let lines: Vec<String> = stdout(&o)
        .lines()
        .map(|l| {
            l.strip_prefix(s(&dir.path("")))
                .unwrap()
                .trim_start_matches('/')
                .to_owned()
        })
        .collect();
    assert_eq!(
        lines,
        ["a/x 4 >= 1", "b/inner/z 4 >= 1", "b/y 4 >= 1", "top 4 >= 1"]
    );
}

#[test]
fn check_size_usage_errors_exit_two() {
    let dir = TempDir::new("size-usage");
    let file = dir.path("f");
    fs::write(&file, "x").unwrap();
    for args in [
        vec!["check-size"],
        vec!["check-size", "/nonexistent/dir/for/sim-cli"],
        vec!["check-size", s(&file)], // a file, not a directory
        vec!["check-size", s(&dir.path("")), s(&dir.path(""))],
        vec!["check-size", s(&dir.path("")), "--max-bytes", "lots"],
        vec!["check-size", s(&dir.path("")), "--max-bytes"],
        vec!["check-size", s(&dir.path("")), "--nope", "1"],
    ] {
        let o = sim_cli(&args);
        assert_eq!(code(&o), 2, "{args:?}: {}", stderr(&o));
    }
}
