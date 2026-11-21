// Offline 4.1 corpus: real WASM worlds, Rust previews and the production bridge.
// Only aggregates leave this process; no network, prompt or response artifacts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  WasmSim, initSync, llm_render_system_one, llm_validate,
} from '../../target/wasm-pkg/sim_wasm.js';
import { DecisionBridge, type DecisionPreview } from '../src/worker/decision-bridge.ts';
import type { DecisionFamily, DecisionRequest } from '../src/shared/decision.ts';
import type { WorldSnapshot } from '../src/shared/world-snapshot.ts';
import { DREAM_INTENTS } from '../src/shared/protocol.ts';
import {
  ControlledDecisionClient, DecisionClock, config, modelDecision, settle,
} from '../tests/unit/helpers/decision.ts';

type Stage = 'baseline' | 'legal_history';
type Facts = { people: number; relations: number; events: number; options: number };
type Range = { min: number; max: number };
type Summary = {
  samples: number;
  serialized_utf8_bytes: Range;
  fact_cardinality: Record<keyof Facts, Range>;
};
const FAMILIES = ['dream_interpretation', 'magistrate_ruling'] as const;
const OUTPUT = new URL('../../target/slow-think-evidence/request-size-corpus.json', import.meta.url);
const FIXTURE = new URL('../../fixtures/parity/seedU-underworld.replay.json', import.meta.url);
const WAITING_TICK = 1654;
const HISTORY_TICKS = 24;
const HELP_ACTORS = 12;

function summary(): Summary {
  const empty = (): Range => ({ min: Number.MAX_SAFE_INTEGER, max: 0 });
  return { samples: 0, serialized_utf8_bytes: empty(), fact_cardinality: {
    people: empty(), relations: empty(), events: empty(), options: empty(),
  } };
}
function record(target: Summary, bytes: number, facts: Facts): void {
  target.samples += 1;
  target.serialized_utf8_bytes.min = Math.min(target.serialized_utf8_bytes.min, bytes);
  target.serialized_utf8_bytes.max = Math.max(target.serialized_utf8_bytes.max, bytes);
  for (const key of ['people', 'relations', 'events', 'options'] as const) {
    target.fact_cardinality[key].min = Math.min(target.fact_cardinality[key].min, facts[key]);
    target.fact_cardinality[key].max = Math.max(target.fact_cardinality[key].max, facts[key]);
  }
}
function facts(preview: DecisionPreview): Facts {
  const context = preview.frozen_context as { people: unknown[]; relations: unknown[]; events: unknown[] };
  return { people: context.people.length, relations: context.relations.length,
    events: context.events.length, options: preview.option_ids.length };
}
function readWorld(sim: WasmSim): WorldSnapshot {
  return JSON.parse(sim.snapshot()) as WorldSnapshot;
}
function checked(sim: WasmSim, payloads: unknown[]): void {
  // Rust is the only legality guard, including all previously queued inputs.
  assert.equal(JSON.parse(sim.submit_checked(JSON.stringify(payloads))).ok, true, 'legal corpus input rejected');
}
function answerPlayerNode(sim: WasmSim): void {
  const state = JSON.parse(sim.player_node_state()) as { pending: boolean; answered?: boolean };
  if (!state.pending || state.answered) return;
  const node = readWorld(sim).player_node;
  assert.ok(node, 'corpus Player_Node missing');
  checked(sim, [{ ChoosePlayer: { node: node.id, option: node.rules_default } }]);
}
function preview(sim: WasmSim, payload: unknown): DecisionPreview {
  const value = JSON.parse(sim.preview_node(JSON.stringify(payload))) as DecisionPreview;
  assert.equal(value.ok, true, 'legal corpus preview rejected');
  return value;
}

async function main(): Promise<void> {
  assert.equal(process.argv.length, 2, 'sampler takes no arguments');
  initSync({ module: readFileSync(new URL('../../target/wasm-pkg/sim_wasm_bg.wasm', import.meta.url)) });
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    seed: string; config: unknown; inputs: { tick: string; seq: string; payload: unknown }[];
  };
  let sim = new WasmSim(BigInt(fixture.seed), JSON.stringify(fixture.config));
  const client = new ControlledDecisionClient();
  const clock = new DecisionClock();
  const mapping = readFileSync(new URL('../src/shared/system-one-v1.txt', import.meta.url), 'utf8');
  const bridge = new DecisionBridge(client, { llm_render_system_one, llm_validate }, mapping, clock);
  const totals = summary();
  const families = Object.fromEntries(FAMILIES.map(family => [family, {
    ...summary(), baseline: summary(), legal_history: summary(),
  }])) as Record<DecisionFamily, Summary & Record<Stage, Summary>>;
  const baselineCase: Partial<Record<DecisionFamily, number>> = {};
  const largeCase: Partial<Record<DecisionFamily, { serialized_utf8_bytes: number; fact_cardinality: Facts }>> = {};
  let historyTicks = 0;
  let helpInputs = 0;
  let captures = 0;
  let dreamIntents = 0;
  let bribeAmountVariants = 0;
  try {
    // Generate this invocation's worlds from the permanent native fixture, not
    // target/browser evidence. Keep its earlier same-tick CarryOver (seq 60).
    for (const input of fixture.inputs) {
      if (BigInt(input.seq) >= 61n) break;
      sim.submit(JSON.stringify({ tick: input.tick, payload: input.payload }));
    }
    sim.run_ticks(WAITING_TICK);
    assert.equal(readWorld(sim).player.place, 'waiting', 'corpus waiting fixture changed');
    client.prefetched.resolve(config(Number.MAX_SAFE_INTEGER));
    await settle();
    assert.equal(bridge.status().config, 'ready');

    async function sample(payload: unknown, stage: Stage): Promise<void> {
      const node = preview(sim, payload);
      const operation = bridge.decide(node, new AbortController().signal);
      const attempt = client.attempts.pop();
      assert.ok(attempt, 'production bridge did not construct a request');
      const request: DecisionRequest = attempt.request;
      const bytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;
      assert.equal(request.family, node.family);
      const cardinality = facts(node);
      record(totals, bytes, cardinality);
      record(families[node.family], bytes, cardinality);
      record(families[node.family][stage], bytes, cardinality);
      if (stage === 'baseline' && baselineCase[node.family] === undefined) baselineCase[node.family] = bytes;
      if (stage === 'legal_history' && bytes > (largeCase[node.family]?.serialized_utf8_bytes ?? 0)) {
        largeCase[node.family] = { serialized_utf8_bytes: bytes, fact_cardinality: cardinality };
      }
      // Controlled, locally pinned fake reply exercises the real Rust validator;
      // it is not applied and is never stored. Select only a Rust-generated ID.
      attempt.response.resolve(modelDecision(node.option_ids[0]!, Number.MAX_SAFE_INTEGER));
      assert.equal((await operation).kind, 'model', 'production rendering or validation failed');
      captures += 1;
    }
    async function sampleWorld(stage: Stage): Promise<void> {
      const before = sim.export_replay();
      const world = readWorld(sim);
      assert.equal(world.player.place, 'waiting');
      assert.ok(world.underworld_view, 'corpus underworld context missing');
      const balance = BigInt(world.joss.find(account => account.soul_id === world.player_soul)!.balance);
      if (balance >= BigInt(world.underworld_view.dream_price)) {
        for (const dreamer of world.underworld_view.connected) for (const intent of DREAM_INTENTS) {
          await sample({ Dream: { dreamer: String(dreamer), intent } }, stage);
          dreamIntents += 1;
        }
      }
      if (balance > 0n) {
        for (const amount of new Set(['1', balance.toString()])) {
          await sample({ Bribe: { amount } }, stage);
          bribeAmountVariants += 1;
        }
      }
      assert.equal(sim.export_replay(), before, 'measurement mutated the actual simulation');
    }
    const baselineReplay = sim.export_replay();
    await sample({ Dream: { dreamer: '31', intent: 'urge' } }, 'baseline');
    await sample({ Bribe: { amount: '1' } }, 'baseline');
    dreamIntents += 1; bribeAmountVariants += 1;
    assert.equal(sim.export_replay(), baselineReplay, 'measurement mutated the actual simulation');
    await sampleWorld('baseline');
    // A second actual fixture lineage enriches the living player's relations
    // before the recorded death tick. Mortality is keyed by person/tick and
    // age, not social inputs. Funeral offerings and new ghost connections are
    // therefore generated by the real rules, not edited into a frozen context.
    const enriched = new WasmSim(BigInt(fixture.seed), JSON.stringify(fixture.config));
    sim.free(); sim = enriched;
    for (const input of fixture.inputs) {
      if (BigInt(input.seq) >= 61n) break;
      sim.submit(JSON.stringify({ tick: input.tick, payload: input.payload }));
    }
    sim.run_ticks(WAITING_TICK - 1);
    answerPlayerNode(sim);
    const beforeDeath = readWorld(sim);
    assert.equal(beforeDeath.player.place, 'body', 'legal-history pre-death fixture changed');
    assert.notEqual(beforeDeath.player.body, null);
    const funeralActors = beforeDeath.residents
      .filter(person => person.alive && person.id !== beforeDeath.player.body).slice(0, HELP_ACTORS);
    checked(sim, funeralActors.map(actor => ({ Act: {
      kind: 'help', actor: String(actor.id), target: String(beforeDeath.player.body), intensity: 100,
    } })));
    helpInputs += funeralActors.length;
    sim.step();
    assert.equal(readWorld(sim).player.place, 'waiting', 'legal-history death tick changed');
    await sampleWorld('legal_history');
    for (let index = 0; index < HISTORY_TICKS; index += 1) {
      answerPlayerNode(sim);
      const world = readWorld(sim);
      const view = world.underworld_view;
      if (world.player.place !== 'waiting' || !view || view.connected.length === 0) break;
      const balance = BigInt(world.joss.find(account => account.soul_id === world.player_soul)!.balance);
      // Retain one legal Bribe, rather than consuming the final request context.
      if (balance <= BigInt(view.dream_price)) break;
      const dreamer = view.connected[index % view.connected.length]!;
      const actors = world.residents.filter(person => person.alive && person.id !== dreamer).slice(0, HELP_ACTORS);
      // These are actual checked social inputs, not inserted events, repeated
      // prompt text or fabricated option definitions. They produce distinct
      // actor/relationship facts in the rules' 12-event context window.
      checked(sim, actors.map(actor => ({ Act: {
        kind: 'help', actor: String(actor.id), target: String(dreamer), intensity: 10,
      } })));
      helpInputs += actors.length;
      await sampleWorld('legal_history');
      const dream = { Dream: { dreamer: String(dreamer), intent: DREAM_INTENTS[index % DREAM_INTENTS.length]! } };
      checked(sim, [dream]);
      // Trigger only: the existing Rust Rules_Default resolves the real dream.
      sim.step();
      historyTicks += 1;
    }
    await sampleWorld('legal_history');
    for (const family of FAMILIES) {
      assert.ok(families[family].baseline.samples > 0 && families[family].legal_history.samples > 0,
        'each family needs baseline and large legal samples');
      assert.ok(largeCase[family]!.serialized_utf8_bytes > baselineCase[family]!,
        'legal history did not exceed the ordinary baseline request');
    }
    assert.equal(captures, totals.samples);
    const report = {
      version: 1, corpus: 'scope-4.1-real-wasm-request-sizes', mode: 'offline-controlled-client-not-live-ai',
      measurement: 'TextEncoder(JSON.stringify(production DecisionBridge DecisionRequest)).byteLength',
      provenance: {
        fixture: 'fixtures/parity/seedU-underworld.replay.json', prefix_seq_exclusive: '61',
        worlds: 2, start_completed_tick: WAITING_TICK, final_completed_tick: Number(sim.tick()),
        parameters: 'unchanged default rules; fixture opening resident count',
        request_path: 'WasmSim.preview_node -> production System One renderer -> DecisionBridge -> injected controlled DecisionClient',
      },
      coverage: {
        description: 'The ordinary Dream fixture control case and one-unit Bribe, then baseline and successive legal-history worlds; all currently connected dreamers with all six Rust-supported intents; Bribe amounts one and current full balance (deduplicated).',
        legal_history_origin: 'A second actual fixture lineage submits up to 12 checked help actions from distinct living actors to the player body immediately before its rules-generated death/funeral. It then resolves up to 24 real Dream ticks rotating connected residents; before each Dream, up to 12 distinct living actors submit checked help actions to that dreamer. Rust generates events, relations, closed options, defaults and all frozen contexts. Measurements themselves are read-only.',
        resolved_history_dreams: historyTicks, checked_history_help_inputs: helpInputs,
        sampled_dream_intent_cases: dreamIntents, sampled_bribe_amount_cases: bribeAmountVariants,
        limits: 'Two lineages of one seeded 50-resident fixture, bounded legal action history and current connected residents; not all seeds, world sizes, possible histories or a worst-case request bound. No live usage, token, latency or neuron measurement; no permanent byte cap selected.'
      },
      total: totals,
      per_family: FAMILIES.map(family => ({ family, ...families[family],
        ordinary_baseline_serialized_utf8_bytes: baselineCase[family],
        large_legal_case: largeCase[family],
      })),
    };
    await mkdir(new URL('./', OUTPUT), { recursive: true });
    await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Wrote target/slow-think-evidence/request-size-corpus.json (${totals.samples} offline samples).`);
  } finally {
    bridge.dispose();
    sim.free();
  }
}

try { await main(); }
catch {
  // WASM errors can mention local actors. Never print their payloads or causes.
  console.error('Offline request-size sampling failed; no request payload was written.');
  process.exitCode = 1;
}
