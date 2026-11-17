//! Black-box tests of the built `sim-cli` binary: output and exit codes (R6.3).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU32, Ordering};

use sim_core::replay::{ReplayFile, verify};

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
    assert_eq!(file.config.opening_residents, 50, "default config");
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
fn auto_player_record_contains_choices_and_replays() {
    let dir = TempDir::new("auto-player");
    let path = dir.path("auto.json");
    let result = sim_cli(&[
        "record",
        "--seed",
        "1",
        "--ticks",
        "29200",
        "--auto-player",
        "--random-inputs",
        "60",
        "--out",
        s(&path),
    ]);
    assert_eq!(code(&result), 0, "{}", stderr(&result));
    let file = ReplayFile::from_json_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert!(
        file.inputs
            .iter()
            .enumerate()
            .all(|(index, input)| input.seq == index as u64)
    );
    assert!(
        file.inputs.iter().any(|input| matches!(
            input.payload,
            sim_core::replay::ReplayPayload::Choose { .. }
        )),
        "an External_Choice is recorded"
    );
    assert_eq!(verify(&file), Ok(()));
    assert_eq!(code(&sim_cli(&["replay", s(&path)])), 0);
}

#[test]
fn record_reads_a_config_file() {
    let dir = TempDir::new("config");
    let cfg = dir.path("cfg.json");
    fs::write(&cfg, r#"{"opening_residents":45}"#).unwrap();
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
    assert_eq!(file.config.opening_residents, 45);
}

#[test]
fn a_config_with_a_retired_workload_field_exits_two_with_the_unknown_field_message() {
    let dir = TempDir::new("config-workload");
    let cfg = dir.path("cfg.json");
    fs::write(&cfg, r#"{"opening_residents":50,"workload":"Pairwise"}"#).unwrap();
    let out = dir.path("never.json");
    let o = sim_cli(&[
        "record",
        "--seed",
        "1",
        "--ticks",
        "5",
        "--config",
        s(&cfg),
        "--out",
        s(&out),
    ]);
    assert_eq!(code(&o), 2, "{}", stderr(&o));
    assert!(
        stderr(&o).contains("unknown field `workload`"),
        "{}",
        stderr(&o)
    );
    assert!(!out.exists(), "no World is created, so no file is written");
}

#[test]
fn record_usage_errors_exit_two_and_write_nothing() {
    let dir = TempDir::new("usage");
    let out = dir.path("never.json");
    let o_arg = s(&out);
    let bad_cfg = dir.path("bad.json");
    fs::write(&bad_cfg, r#"{"opening_residents":39}"#).unwrap();
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

    // Unsupported versions: 3 (the life-sim format) and 5 (a future one).
    for (n, version) in [(3, 3), (5, 5)] {
        let bad = dir.path(&format!("v{n}.json"));
        let changed = text.replacen("\"version\":4", &format!("\"version\":{version}"), 1);
        assert_ne!(changed, text);
        fs::write(&bad, changed).unwrap();
        let o = sim_cli(&["replay", s(&bad)]);
        assert_eq!(code(&o), 2);
        assert!(
            stderr(&o).contains("unsupported replay version"),
            "{}",
            stderr(&o)
        );
    }

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
fn snapshot_writes_the_committed_tick_500_file_and_rejects_bad_usage() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let replay = root.join("fixtures/parity/seed1-pairwise.replay.json");
    let committed = root.join("fixtures/parity/seed1-pairwise.snapshot-500.json");
    let dir = TempDir::new("snapshot");
    let out = dir.path("snap.json");

    let o = sim_cli(&[
        "snapshot",
        "--replay",
        s(&replay),
        "--at",
        "500",
        "--out",
        s(&out),
    ]);
    assert_eq!(code(&o), 0, "{}", stderr(&o));
    assert!(
        stdout(&o).starts_with("snapshot tick=500 residents="),
        "{}",
        stdout(&o)
    );
    assert_eq!(
        fs::read(&out).unwrap(),
        fs::read(&committed).unwrap(),
        "the native snapshot differs from the committed fixture"
    );

    // Past the end of the replay and a missing file are both usage errors.
    let bad = dir.path("never.json");
    let o = sim_cli(&[
        "snapshot",
        "--replay",
        s(&replay),
        "--at",
        "2001",
        "--out",
        s(&bad),
    ]);
    assert_eq!(code(&o), 2);
    assert!(stderr(&o).contains("past the replay"));
    assert!(!bad.exists());

    let missing = dir.path("missing.replay.json");
    let o = sim_cli(&[
        "snapshot",
        "--replay",
        s(&missing),
        "--at",
        "500",
        "--out",
        s(&bad),
    ]);
    assert_eq!(code(&o), 2);
    assert!(stderr(&o).contains("cannot read replay file"));
    assert!(!bad.exists());
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

#[test]
fn batch_small_healthy_run_exits_zero_with_one_line_per_seed() {
    let o = sim_cli(&["batch", "--seeds", "1..=3", "--ticks", "50"]);
    assert_eq!(code(&o), 0, "{}", stderr(&o));
    assert!(stderr(&o).is_empty(), "{}", stderr(&o));
    let out = stdout(&o);
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(lines.len(), 5, "{out}");
    for (line, seed) in lines.iter().zip(1..=3) {
        assert!(
            line.starts_with(&format!("seed {seed} ok ticks=50 final=")),
            "{out}"
        );
        for field in [
            " residents_min=",
            " residents_max=",
            " band_40_60_ticks=",
            " queue_final=",
            " max_wait_npc=",
            " max_wait_player=",
            " births=",
            " deaths=",
            " imported=",
            " rebuilt=",
            " origin_final=native:",
            " arrivals=native:",
            " events=",
            " relations_max=",
            " rejections=unknown_person:",
            " invariants=pass ",
            " pop_35_65=pass",
            " band_95=pass",
            " outsiders_le_births=pass",
            " outsiders_le_births_third=pass",
        ] {
            assert!(line.contains(field), "{field} missing from {line}");
        }
        let mut previous = 0;
        for field in [
            " residents_min=",
            " rejections=",
            " offerings=",
            " dreams=",
            " hauntings=",
            " bribes=",
            " claims=birth:",
            " auto_placed=",
            " carry_overs=",
            " nodes=",
            " max_wait_player=",
            " player_lives=",
            " invariants=pass ",
        ] {
            let at = line
                .find(field)
                .expect("every underworld field is reported");
            assert!(at > previous, "{field} out of order in {line}");
            previous = at;
        }
        // The rejection field lists every reason of the design, in report order.
        let mut previous = line.find(' ').expect("a field");
        for reason in sim_core::world::RejectReason::ALL {
            let needle = format!("{}:", reason.label());
            let at = line.find(&needle).expect("every reason is listed");
            assert!(at > previous, "{} is out of report order", reason.label());
            previous = at;
        }
    }
    assert_eq!(
        lines[3],
        "batch: totals dreams=0 hauntings=0 bribes=0 birth_claims=0 imported_claims=0 rebuilt_claims=0 carry_overs=0 nodes_dream_interpretation=0 nodes_magistrate_ruling=0"
    );
    assert_eq!(lines[4], "batch: 3/3 seeds ok");
}

#[test]
fn batch_require_targets_is_accepted_and_passes_here() {
    // The zero-count gate belongs to task 10.1, not this life-sim target check.
    let o = sim_cli(&[
        "batch",
        "--seeds",
        "1..=2",
        "--ticks",
        "20",
        "--require-targets",
    ]);
    assert_eq!(code(&o), 0, "{}", stderr(&o));
    let out = stdout(&o);
    assert!(out.ends_with("batch: 2/2 seeds ok\n"), "{out}");
    assert!(
        out.contains(
            "pop_35_65=pass band_95=pass outsiders_le_births=pass outsiders_le_births_third=pass"
        ),
        "{out}"
    );
}

#[test]
fn batch_output_is_byte_identical_across_runs_and_accepts_a_single_seed() {
    let args = ["batch", "--seeds=7", "--ticks=40", "--random-inputs=25"];
    let (a, b) = (sim_cli(&args), sim_cli(&args));
    assert_eq!(code(&a), 0);
    assert_eq!(a.stdout, b.stdout);
    assert!(stdout(&a).starts_with("seed 7 ok ticks=40 "));
    assert!(stdout(&a).contains("batch: totals "));
    assert!(stdout(&a).ends_with("batch: 1/1 seeds ok\n"));
}

#[test]
fn batch_usage_errors_exit_two() {
    for args in [
        &["batch", "--ticks", "10"][..],
        &["batch", "--seeds", "1..=3"],
        &["batch", "--seeds", "3..=1", "--ticks", "10"],
        &["batch", "--seeds", "1..3", "--ticks", "10"],
        &["batch", "--seeds", "x", "--ticks", "10"],
        &["batch", "--seeds", "0..=10000", "--ticks", "10"],
        &["batch", "--seeds", "1", "--ticks", "0"],
        &["batch", "--seeds", "1", "--ticks", "10", "--bogus", "1"],
        &["batch", "--seeds", "1", "--ticks", "10", "stray"],
        &[
            "batch",
            "--seeds",
            "1",
            "--ticks",
            "10",
            "--config",
            "/nonexistent.json",
        ],
    ] {
        let o = sim_cli(args);
        assert_eq!(code(&o), 2, "{args:?}");
        assert!(stdout(&o).is_empty(), "{args:?}");
        assert!(stderr(&o).contains("error:"), "{args:?}");
    }
}

#[test]
fn devoted_flag_rules_and_candidate_reporting() {
    for args in [
        &[
            "batch",
            "--seeds",
            "1",
            "--ticks",
            "10",
            "--require-reachability",
        ][..],
        &[
            "batch",
            "--seeds",
            "1",
            "--ticks",
            "10",
            "--devoted",
            "--require-targets",
        ],
    ] {
        let output = sim_cli(args);
        assert_eq!(code(&output), 2, "{}", stderr(&output));
        assert!(stdout(&output).is_empty());
    }
    let args = ["batch", "--seeds", "1", "--ticks", "40", "--devoted"];
    let a = sim_cli(&args);
    let b = sim_cli(&args);
    assert_eq!(code(&a), 0, "{}", stderr(&a));
    assert_eq!(a.stdout, b.stdout);
    let out = stdout(&a);
    assert!(
        out.contains(
            "seed 1 devoted waits= zero_credit_waits=0/0 acts=submitted:2,applied:2,rejected:0"
        ),
        "{out}"
    );
    assert!(out.contains(" afford_candidates=dream:0,haunting:0,bribe:0,imported:0,rebuilt:0"));
    assert!(out.contains("batch: totals dreams=0 hauntings=0 bribes=0"));
    assert!(out.ends_with("batch: 1/1 seeds ok\n"));
}

#[test]
fn devoted_reachability_fails_on_applied_zeros_not_candidates() {
    let output = sim_cli(&[
        "batch",
        "--seeds",
        "1",
        "--ticks",
        "40",
        "--devoted",
        "--require-reachability",
    ]);
    assert_eq!(code(&output), 1);
    assert!(
        stdout(&output)
            .contains(" afford_candidates=dream:0,haunting:0,bribe:0,imported:0,rebuilt:0")
    );
    let fail = "batch: FAIL zero counts: dreams, hauntings, bribes, imported_claims, rebuilt_claims, carry_overs, nodes_dream_interpretation, nodes_magistrate_ruling";
    assert!(stderr(&output).contains(fail), "{}", stderr(&output));
}

#[test]
fn batch_uses_a_config_file() {
    let dir = TempDir::new("batch-config");
    let cfg = dir.path("c.json");
    fs::write(&cfg, r#"{"opening_residents":45}"#).unwrap();
    let o = sim_cli(&[
        "batch",
        "--seeds",
        "1",
        "--ticks",
        "20",
        "--random-inputs",
        "0",
        "--config",
        s(&cfg),
    ]);
    assert_eq!(code(&o), 0, "{}", stderr(&o));
    assert!(stdout(&o).contains(" residents_max=45 "), "{}", stdout(&o));
}

#[test]
fn measure_runs_tiny_and_rejects_bad_usage() {
    let ok = sim_cli(&["measure", "--runs", "1", "--residents", "40"]);
    assert_eq!(code(&ok), 0, "{}", stderr(&ok));
    assert!(stdout(&ok).contains("ticks_per_second"));
    assert!(stdout(&ok).contains("residents=40"));
    let bad = sim_cli(&["measure", "--runs", "0"]);
    assert_eq!(code(&bad), 2);
    assert!(stderr(&bad).contains("--runs"));
    let bad = sim_cli(&["measure", "--residents", "39"]);
    assert_eq!(code(&bad), 2);
    assert!(stderr(&bad).contains("--residents"));
    assert!(stdout(&sim_cli(&["--help"])).contains("sim-cli measure"));
}

/// The grading fixture generators are deterministic and match the committed fixtures.
/// They write to a temp directory only; the committed files are read, never written.
#[test]
fn grading_generators_are_deterministic_and_match_the_committed_fixtures() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let cards = root.join("eval/cards/cards/dev.jsonl");
    let cards = cards.to_str().unwrap();
    let dir = TempDir::new("grading");
    let (outputs, golden) = (dir.path("o.json"), dir.path("g.json"));
    let (outputs, golden) = (outputs.to_str().unwrap(), golden.to_str().unwrap());
    let system_one = dir.path("s.json");
    let system_one = system_one.to_str().unwrap();
    let o = sim_cli(&["grading-outputs", "--cards", cards, "--out", outputs]);
    assert_eq!(code(&o), 0, "{}", stderr(&o));
    let o = sim_cli(&[
        "grading-golden",
        "--cards",
        cards,
        "--outputs",
        outputs,
        "--out",
        golden,
    ]);
    assert_eq!(code(&o), 0, "{}", stderr(&o));
    let o = sim_cli(&[
        "grading-system-one-golden",
        "--cards",
        cards,
        "--out",
        system_one,
    ]);
    assert_eq!(code(&o), 0, "{}", stderr(&o));
    let (pa_in, pa_out) = (dir.path("pi.json"), dir.path("pg.json"));
    let (pa_in, pa_out) = (pa_in.to_str().unwrap(), pa_out.to_str().unwrap());
    let o = sim_cli(&["grading-perm-avg-inputs", "--cards", cards, "--out", pa_in]);
    assert_eq!(code(&o), 0, "{}", stderr(&o));
    let o = sim_cli(&[
        "grading-perm-avg-golden",
        "--inputs",
        pa_in,
        "--out",
        pa_out,
    ]);
    assert_eq!(code(&o), 0, "{}", stderr(&o));
    for (made, committed) in [
        (outputs, "fixtures/grading/dev-outputs.json"),
        (golden, "fixtures/grading/dev-golden.json"),
        (system_one, "fixtures/grading/system-one-golden.json"),
        (pa_in, "fixtures/grading/perm-avg-inputs.json"),
        (pa_out, "fixtures/grading/perm-avg-golden.json"),
    ] {
        let made = fs::read(made).unwrap();
        assert!(made.ends_with(b"}\n"));
        assert!(
            made == fs::read(root.join(committed)).unwrap(),
            "{committed} differs from the generator output; regenerate on purpose with \
             scripts/regen-grading-golden.sh if the change is intended"
        );
    }
}
