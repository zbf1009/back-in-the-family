//! Subcommand implementations for replay files and fixture tooling.
//!
//! Each function returns the process exit code (never panics on user-controlled data)
//! and writes its own output to the `out`/`err` writers passed in, so tests can capture
//! output without touching real stdio.

use std::cmp::Reverse;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use sim_core::ids::Tick;
use sim_core::input::InputPayload;
use sim_core::narrator::chronicle::EntrySource;
use sim_core::replay::{ReplayConfig, ReplayError, ReplayFile, record as core_record, verify};
use sim_core::replay_audit::audit;
use sim_core::tick::Sim;
use sim_core::underworld::carry_over::TraitName;
use sim_core::underworld::dreams::DreamIntent;
use sim_core::underworld::ghosts::connected;
use sim_core::underworld::slots::{SlotRef, path_status};
use sim_core::values::Origin;
use sim_core::world::{Life, SoulPlace, WorldConfig};

use crate::args::{self, Parsed};
use crate::auto_player::{AutoPlayer, PlayerAnswerer};
use crate::batch::{parse_seed_range, replay_of};
use crate::inputs::generate_inputs;

/// Exit code for invalid arguments, malformed files and I/O errors.
pub const EXIT_USAGE_OR_MALFORMED: i32 = 2;
/// Exit code for a failed check or an unqualified playthrough recording.
pub const EXIT_FAILED: i32 = 1;
pub const EXIT_OK: i32 = 0;

/// Reads a `--config` file: JSON with exactly the replay file's `config` shape, e.g.
/// `{"opening_residents":50}`, then validates it. Unknown fields (such as the retired
/// `workload`) are rejected with serde's `unknown field` message (R1.3).
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

/// The config used when `record` gets no `--config`: `{"opening_residents":50}`
/// (`WorldConfig::default()`).
pub fn default_config() -> WorldConfig {
    WorldConfig::default()
}

pub const RECORD_USAGE: &str = "usage: sim-cli record --seed S --ticks N [--config FILE] \
[--random-inputs K] [--auto-player] --out FILE\n\
       sim-cli record --seed S --ticks N --playthrough --stages FILE --out FILE \
[--config FILE] [--step-fallback]\n\
without --config: {\"opening_residents\":50}";

pub fn record(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let parsed = match args::parse_with_switches(
        args,
        &["seed", "ticks", "config", "random-inputs", "out", "stages"],
        &["auto-player", "playthrough", "step-fallback"],
    ) {
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
        Err(RecordError::Failed(e)) => {
            let _ = writeln!(err, "error: {e}");
            EXIT_FAILED
        }
    }
}

/// A verification failure or an unqualified playthrough exits 1; usage and I/O exit 2.
enum RecordError {
    Other(String),
    Failed(String),
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
    if parsed.get("playthrough").is_some() {
        if parsed.get("random-inputs").is_some() || parsed.get("auto-player").is_some() {
            return Err(
                "--playthrough cannot be combined with --random-inputs or --auto-player"
                    .to_owned()
                    .into(),
            );
        }
        let stages_path = parsed
            .get("stages")
            .ok_or_else(|| "--playthrough requires --stages FILE".to_owned())?;
        if Path::new(out_path) == Path::new(stages_path) {
            return Err("--out and --stages must name different files"
                .to_owned()
                .into());
        }
        let run = run_playthrough(seed, config, ticks, parsed.get("step-fallback").is_some())?
            .ok_or_else(|| {
                RecordError::Failed(format!(
                    "seed {seed}: no qualifying playthrough within {ticks} ticks"
                ))
            })?;
        let file = replay_of(
            seed,
            config,
            run.sim.world().tick().0,
            run.sim.inputs().all(),
            run.sim.checksums(),
        );
        let stages = serde_json::json!({
            "last_tick": file.ticks.to_string(),
            "step_clicks": run.step_clicks,
            "stages": run.stages.iter().map(|(tick, reasons)| serde_json::json!({
                "tick": tick.0.to_string(),
                "reasons": reasons,
            })).collect::<Vec<_>>(),
        });
        let text = serde_json::to_string_pretty(&stages).map_err(|e| e.to_string())?;
        let summary = write_record(&file, out_path)?;
        write_json_line(stages_path, text)?;
        return Ok(format!("{summary}\n{} -> {stages_path}", run.summary()));
    }
    if parsed.get("stages").is_some() || parsed.get("step-fallback").is_some() {
        return Err(
            "--stages and --step-fallback require --playthrough when recording"
                .to_owned()
                .into(),
        );
    }
    let inputs = generate_inputs(
        seed,
        random_inputs,
        ticks,
        u64::from(config.opening_residents),
    );

    let file = if parsed.get("auto-player").is_some() {
        let mut sim = Sim::new(seed, config).map_err(|e| e.to_string())?;
        for &(tick, payload) in &inputs {
            sim.submit(tick, payload).map_err(|e| e.to_string())?;
        }
        let mut player = AutoPlayer::default();
        for _ in 0..ticks {
            let tick = sim.world().tick();
            for payload in player.plan(&sim) {
                sim.submit(tick, payload).map_err(|e| e.to_string())?;
            }
            sim.step();
        }
        replay_of(seed, config, ticks, sim.inputs().all(), sim.checksums())
    } else {
        core_record(seed, config, &inputs, ticks).map_err(|e| e.to_string())?
    };
    write_record(&file, out_path)
}

fn write_record(file: &ReplayFile, out_path: &str) -> Result<String, RecordError> {
    // Safety net: verify the freshly produced replay in-process before writing it.
    verify(file).map_err(|e| {
        RecordError::Failed(format!(
            "record produced a replay that fails to verify: {e}"
        ))
    })?;
    write_json_line(out_path, file.to_json_string().map_err(|e| e.to_string())?)?;

    let ReplayFile { seed, ticks, .. } = file;
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

fn write_json_line(out_path: &str, mut text: String) -> Result<(), String> {
    if let Some(parent) = Path::new(out_path).parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create directory for {out_path}: {e}"))?;
    }
    text.push('\n');
    fs::write(out_path, &text).map_err(|e| format!("cannot write {out_path}: {e}"))
}

const FALLBACK_MAX_STEPS: u64 = 200;
const IMPORTED: SlotRef = SlotRef::ImportedVessel;

struct Playthrough {
    sim: Sim,
    stages: Vec<(Tick, Vec<&'static str>)>,
    first_life_choices: usize,
    death_stop: Tick,
    dream_stop: Tick,
    claim_tick: Tick,
    reborn_stop: Tick,
    funeral_joss: u64,
    step_clicks: u64,
}

impl Playthrough {
    fn summary(&self) -> String {
        format!(
            "seed={} first_life_choices={} death_stop={} funeral_joss={} dream_stop={} claim_tick={} reborn_stop={} last_tick={} step_clicks={}",
            self.sim.world().seed(),
            self.first_life_choices,
            self.death_stop.0,
            self.funeral_joss,
            self.dream_stop.0,
            self.claim_tick.0,
            self.reborn_stop.0,
            self.sim.world().tick().0,
            self.step_clicks,
        )
    }
}

/// The same script drives search and recording. An unsuccessful seed never produces a fixture.
fn run_playthrough(
    seed: u64,
    config: WorldConfig,
    max_ticks: u64,
    fallback: bool,
) -> Result<Option<Playthrough>, String> {
    let mut sim = Sim::new(seed, config).map_err(|e| e.to_string())?;
    let souls = sim.world().souls();
    let SoulPlace::Body(first_body) = souls.places[&souls.player] else {
        return Err("player has no opening body".to_owned());
    };
    let mut stages = Vec::new();
    let mut death_stop = None;
    let mut dream_stop = None;
    let mut claim_tick = None;
    let mut reborn_stop = None;
    let mut first_life_choices = 0;
    let mut funeral_joss = 0;

    loop {
        let world = sim.world();
        let tick = world.tick();
        let stops = sim.last_stops();
        if stops.any() {
            stages.push((tick, stops.labels()));
        }
        if stops.player_reborn {
            let Some(life) = world.narrator().life.as_ref() else {
                return Ok(None);
            };
            if claim_tick.is_none()
                || life.body == first_body
                || world.persons()[&life.body].origin != Origin::Possessed
            {
                return Ok(None);
            }
            reborn_stop = Some(tick);
        }
        if let Some(reborn_stop) = reborn_stop
            && tick > reborn_stop
        {
            let death_stop = death_stop.expect("claim follows death");
            let dream_stop = dream_stop.expect("claim follows dream");
            let claim_tick = claim_tick.expect("qualifying rebirth follows a claim");
            return Ok(Some(Playthrough {
                sim,
                stages,
                first_life_choices,
                death_stop,
                dream_stop,
                claim_tick,
                reborn_stop,
                funeral_joss,
                step_clicks: claim_tick.0 - dream_stop.0,
            }));
        }
        if tick.0 >= max_ticks {
            return Ok(None);
        }

        let mut dream = None;
        let mut carry_over = None;
        if stops.player_died {
            let Some(wait) = world.player_wait() else {
                return Ok(None);
            };
            let Life::Dead { death } = world.persons()[&first_body].life else {
                return Ok(None);
            };
            if death_stop.is_some() || wait.ghost != first_body || death.0 + 1 != tick.0 {
                return Ok(None);
            }
            first_life_choices = world
                .narrator()
                .chronicle
                .entries()
                .iter()
                .filter(|entry| entry.source == EntrySource::External && !entry.chooser_absent)
                .count();
            if first_life_choices < 2 {
                return Ok(None);
            }
            funeral_joss = world.joss()[&world.souls().player].balance;
            let params = world.params();
            if funeral_joss < params.dream_price
                || (!fallback && funeral_joss < params.dream_price + params.imported_price)
            {
                return Ok(None);
            }
            let Some(dreamer) = connected(world, wait.ghost).into_iter().max_by_key(|&id| {
                (
                    world.relations()[&(id, wait.ghost)].affinity.get(),
                    Reverse(id),
                )
            }) else {
                return Ok(None);
            };
            dream = Some(InputPayload::Dream {
                dreamer,
                intent: DreamIntent::Reassure,
            });
            death_stop = Some(tick);
        }
        if stops.dream_resolved {
            dream_stop = Some(tick);
        }
        if let Some(dream_stop) = dream_stop
            && claim_tick.is_none()
        {
            if path_status(world, IMPORTED).executable() {
                // The claim tick and one subsequent tick must both fit in the recording.
                if tick.0 + 2 > max_ticks {
                    return Ok(None);
                }
                carry_over = Some(InputPayload::CarryOver {
                    trait_name: strongest_trait(world, first_body),
                });
                claim_tick = Some(tick);
            } else if !fallback || tick.0 - dream_stop.0 >= FALLBACK_MAX_STEPS {
                return Ok(None);
            }
        }
        let choice = PlayerAnswerer.plan(&sim);
        for payload in [
            choice,
            dream,
            carry_over,
            carry_over.map(|_| InputPayload::ClaimSlot {
                slot: IMPORTED,
                customization: None,
            }),
        ]
        .into_iter()
        .flatten()
        {
            sim.submit(tick, payload).map_err(|e| e.to_string())?;
        }
        sim.step();
        if sim
            .last_outcomes()
            .iter()
            .any(|outcome| outcome.result.is_err())
        {
            return Ok(None);
        }
        if (dream.is_some() && !sim.last_stops().dream_resolved)
            || (carry_over.is_some() && !sim.last_stops().player_reborn)
        {
            return Ok(None);
        }
    }
}

fn strongest_trait(world: &sim_core::world::World, body: sim_core::ids::PersonId) -> TraitName {
    // Match the CLI's carry-over policy: greatest absolute magnitude, then card order.
    let t = &world.persons()[&body].traits;
    let values = [
        t.greed,
        t.loyalty,
        t.pride,
        t.warmth,
        t.temper,
        t.vindictiveness,
        t.piety,
    ];
    TraitName::ALL
        .into_iter()
        .zip(values)
        .max_by_key(|(name, value)| (value.get().unsigned_abs(), Reverse(*name)))
        .expect("non-empty trait list")
        .0
}

pub const PLAYTHROUGH_SEARCH_USAGE: &str =
    "usage: sim-cli playthrough-search --seeds A..=B --max-ticks N [--step-fallback]";

pub fn playthrough_search(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    match run_playthrough_search(args, out) {
        Ok(()) => EXIT_OK,
        Err(e) => {
            let _ = writeln!(err, "error: {e}\n{PLAYTHROUGH_SEARCH_USAGE}");
            EXIT_USAGE_OR_MALFORMED
        }
    }
}

fn run_playthrough_search(args: &[String], out: &mut dyn Write) -> Result<(), String> {
    let parsed = args::parse_with_switches(args, &["seeds", "max-ticks"], &["step-fallback"])?;
    if let Some(stray) = parsed.positionals().first() {
        return Err(format!("unexpected argument {stray:?}"));
    }
    let (first, last) =
        parse_seed_range(parsed.get("seeds").ok_or("missing required flag --seeds")?)?;
    let ticks = parsed.require_u64("max-ticks")?;
    if !(1..=MAX_TICKS).contains(&ticks) {
        return Err(format!(
            "--max-ticks must be between 1 and {MAX_TICKS}, got {ticks}"
        ));
    }
    let fallback = parsed.get("step-fallback").is_some();
    let mut qualifying = 0;
    let mut tested = 0;
    for seed in first..=last {
        tested += 1;
        if let Some(run) = run_playthrough(seed, default_config(), ticks, fallback)? {
            writeln!(out, "{}", run.summary()).map_err(|e| e.to_string())?;
            qualifying += 1;
            if fallback {
                break;
            }
        }
    }
    writeln!(
        out,
        "playthrough-search: {qualifying} qualifying seeds ({tested} tested)"
    )
    .map_err(|e| e.to_string())
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

pub const AUDIT_REPLAY_USAGE: &str = "usage: sim-cli audit-replay FILE";

/// Verifies and audits one replay in one forward traversal; writes versioned JSON
/// only after all completed checksums match. Uses replay's exit-code convention.
pub fn audit_replay(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let parsed = match args::parse(args, &[]) {
        Ok(parsed) if parsed.positionals().len() == 1 => parsed,
        Ok(_) => {
            let _ = writeln!(
                err,
                "error: exactly one replay file is required\n{AUDIT_REPLAY_USAGE}"
            );
            return EXIT_USAGE_OR_MALFORMED;
        }
        Err(error) => {
            let _ = writeln!(err, "error: {error}\n{AUDIT_REPLAY_USAGE}");
            return EXIT_USAGE_OR_MALFORMED;
        }
    };
    let path = &parsed.positionals()[0];
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) => {
            let _ = writeln!(err, "{path}: cannot read file: {error}");
            return EXIT_USAGE_OR_MALFORMED;
        }
    };
    let report = match ReplayFile::from_json_str(&text).and_then(|file| audit(&file)) {
        Ok(report) => report,
        Err(ReplayError::Diverged(divergence)) => {
            let _ = writeln!(err, "{path}: {divergence}");
            return EXIT_FAILED;
        }
        Err(error) => {
            let _ = writeln!(err, "{path}: {error}");
            return EXIT_USAGE_OR_MALFORMED;
        }
    };
    match serde_json::to_string(&report) {
        Ok(json) => match writeln!(out, "{json}") {
            Ok(()) => EXIT_OK,
            Err(error) => {
                let _ = writeln!(err, "cannot write audit report: {error}");
                EXIT_USAGE_OR_MALFORMED
            }
        },
        Err(error) => {
            let _ = writeln!(err, "cannot serialize audit report: {error}");
            EXIT_USAGE_OR_MALFORMED
        }
    }
}

pub const SNAPSHOT_USAGE: &str = "usage: sim-cli snapshot --replay FILE --at TICK --out FILE\n\
Replays the file's seed, config and inputs up to TICK, checks every recorded checksum \
on the way, and writes the Snapshot JSON of that World to --out (one line, compact).";

/// Writes the Snapshot JSON at `--at` (R18): the design names only a snapshot recorded
/// natively at tick 500; this subcommand is how the committed fixture is produced.
pub fn snapshot(args: &[String], out: &mut dyn Write, err: &mut dyn Write) -> i32 {
    let parsed = match args::parse(args, &["replay", "at", "out"]) {
        Ok(p) => p,
        Err(e) => {
            let _ = writeln!(err, "error: {e}\n{SNAPSHOT_USAGE}");
            return EXIT_USAGE_OR_MALFORMED;
        }
    };
    match run_snapshot(&parsed) {
        Ok(summary) => {
            let _ = writeln!(out, "{summary}");
            EXIT_OK
        }
        Err(SnapshotError::Diverged(message)) => {
            let _ = writeln!(err, "error: {message}");
            EXIT_FAILED
        }
        Err(SnapshotError::Other(message)) => {
            let _ = writeln!(err, "error: {message}");
            EXIT_USAGE_OR_MALFORMED
        }
    }
}

/// Why `snapshot` failed: a checksum divergence is exit 1, everything else exit 2.
enum SnapshotError {
    Other(String),
    Diverged(String),
}

impl From<String> for SnapshotError {
    fn from(s: String) -> Self {
        Self::Other(s)
    }
}

fn run_snapshot(parsed: &Parsed) -> Result<String, SnapshotError> {
    if let Some(stray) = parsed.positionals().first() {
        return Err(format!("unexpected argument {stray:?}").into());
    }
    let replay_path = parsed
        .get("replay")
        .ok_or_else(|| "missing required flag --replay".to_owned())?;
    let at = parsed.require_u64("at")?;
    let out_path = parsed
        .get("out")
        .ok_or_else(|| "missing required flag --out".to_owned())?;

    let text = fs::read_to_string(replay_path)
        .map_err(|e| format!("cannot read replay file {replay_path}: {e}"))?;
    let file = ReplayFile::from_json_str(&text).map_err(|e| e.to_string())?;
    if at > file.ticks {
        return Err(format!("--at {at} is past the replay's {} ticks", file.ticks).into());
    }
    let config = WorldConfig::try_from(file.config).map_err(|e| e.to_string())?;
    let mut sim = Sim::new(file.seed, config).map_err(|e| e.to_string())?;

    // Submit the whole input stream, as `verify` does: the stream assigns `seq` in
    // submission order and `seq` enters the checksum, so skipping later inputs would
    // renumber the rest. Inputs for ticks at or after `at` simply stay pending.
    for (index, input) in (0u64..).zip(&file.inputs) {
        if input.seq != index {
            return Err(format!("input {index} has seq {}, expected {index}", input.seq).into());
        }
        sim.submit(Tick(input.tick), input.payload.into())
            .map_err(|e| e.to_string())?;
    }

    for n in 0..at {
        let actual = sim.step();
        let Some(&expected) = file.checksums.get(usize::try_from(n).unwrap_or(usize::MAX)) else {
            return Err(format!("the replay has no checksum for tick {n}").into());
        };
        if actual != expected {
            return Err(SnapshotError::Diverged(format!(
                "replay diverged at tick {n}: expected {}, got {}",
                expected.to_hex_string(),
                actual.to_hex_string()
            )));
        }
    }

    // No trailing newline: the committed fixture is compared byte for byte with
    // `WasmSim::snapshot()`, which returns `snapshot_json` unchanged (R18.3).
    let json = sim_core::snapshot::snapshot_json(sim.world());
    if let Some(parent) = Path::new(out_path).parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create directory for {out_path}: {e}"))?;
    }
    fs::write(out_path, &json).map_err(|e| format!("cannot write {out_path}: {e}"))?;
    Ok(format!(
        "snapshot tick={at} residents={} -> {out_path}",
        sim.world()
            .persons()
            .values()
            .filter(|p| matches!(p.life, sim_core::world::Life::Alive { .. }))
            .count()
    ))
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
