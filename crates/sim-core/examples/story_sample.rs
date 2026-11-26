//! Export the actual recorded prefix as typed story batches, without new inputs.
//! Run from the repo root:
//! cargo run -p sim-core --example story_sample -- target/smoke-evidence/playthrough.replay.json target/life-unfolds/story-sample.json

use std::collections::BTreeSet;
use std::error::Error;
use std::fs;
use std::io::{BufWriter, Write};
use std::path::Path;

use serde::Serialize;
use sim_core::events::EventKind;
use sim_core::ids::Tick;
use sim_core::replay::ReplayFile;
use sim_core::story::{StoryBatch, story_opening};
use sim_core::tick::Sim;
use sim_core::world::WorldConfig;

const KINDS: [&str; 16] = [
    "birth",
    "death",
    "marriage",
    "loan",
    "repayment",
    "debt_transfer",
    "debt_forgiven",
    "inheritance",
    "possession",
    "rebuild",
    "offering",
    "bribe_offering",
    "dream",
    "haunting",
    "appeal",
    "social",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Sample<'a> {
    source_replay: &'a str,
    seed: String,
    ticks: String,
    available_event_kinds: Vec<&'static str>,
    absent_event_kinds: Vec<&'static str>,
    batches: Vec<StoryBatch>,
}

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let input = args.first().map_or(
        "target/smoke-evidence/playthrough.replay.json",
        String::as_str,
    );
    let output = args
        .get(1)
        .map_or("target/life-unfolds/story-sample.json", String::as_str);
    if args.len() > 2 {
        return Err("expected replay path and output path".into());
    }
    let replay = ReplayFile::from_json_str(&fs::read_to_string(input)?)?;
    if replay.checksums.len() != usize::try_from(replay.ticks)? {
        return Err("source replay checksum count does not match its defined prefix".into());
    }
    let mut sim = Sim::new(replay.seed, WorldConfig::try_from(replay.config)?)?;
    for (index, input) in replay.inputs.iter().enumerate() {
        if input.seq != u64::try_from(index)? {
            return Err("source inputs are not in submission order".into());
        }
        let assigned = sim.submit(Tick(input.tick), input.payload.into())?;
        if assigned.0 != input.seq {
            return Err("source input allocation diverged".into());
        }
    }
    let mut batches = vec![story_opening(sim.world())];
    while sim.world().tick().0 < replay.ticks {
        let start = sim.checksums().len();
        let remaining = replay
            .ticks
            .checked_sub(sim.world().tick().0)
            .expect("within source prefix");
        let max = u32::try_from(remaining.min(256))?;
        let result = sim.run_until_stop_observed(max);
        if result.ran == 0 {
            return Err("observed replay did not advance".into());
        }
        // Narrow replay parity on this one traversal, not a density remeasurement.
        for index in start..sim.checksums().len() {
            if sim.checksums()[index] != replay.checksums[index] {
                return Err(format!("source replay diverged at tick {index}").into());
            }
        }
        batches.push(result.story);
    }
    let available: BTreeSet<_> = batches
        .iter()
        .flat_map(|batch| &batch.events)
        .map(|event| match event.kind.0 {
            EventKind::BribeOffering { .. } => "bribe_offering",
            EventKind::Social { .. } => "social",
            _ => event.kind.0.card_type(),
        })
        .collect();
    let sample = Sample {
        source_replay: input,
        seed: replay.seed.to_string(),
        ticks: replay.ticks.to_string(),
        available_event_kinds: KINDS
            .into_iter()
            .filter(|kind| available.contains(kind))
            .collect(),
        absent_event_kinds: KINDS
            .into_iter()
            .filter(|kind| !available.contains(kind))
            .collect(),
        batches,
    };
    if let Some(parent) = Path::new(output).parent() {
        fs::create_dir_all(parent)?;
    }
    let mut writer = BufWriter::new(fs::File::create(output)?);
    serde_json::to_writer(&mut writer, &sample)?;
    writer.flush()?;
    println!(
        "Wrote {} real story batches to {output}; absent variants: {}",
        sample.batches.len(),
        sample.absent_event_kinds.join(", ")
    );
    Ok(())
}
