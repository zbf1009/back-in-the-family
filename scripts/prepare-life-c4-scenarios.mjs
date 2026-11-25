// Local fixture preparation only. All World changes are real recorded inputs.
// Run after the integrated WASM build; never rewrites committed parity goldens.
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { initSync, WasmSim } from '../target/wasm-pkg/sim_wasm.js';

const arguments_ = process.argv.slice(2);
const claimExpectationsOnly = arguments_.length === 1 && arguments_[0] === '--claim-expectations-only';
if (arguments_.length !== 0 && !claimExpectationsOnly) throw Error('Usage: prepare-life-c4-scenarios.mjs [--claim-expectations-only]');

const root = new URL('../', import.meta.url);
const destination = new URL('target/life-in-view-evidence/c4-scenarios/', root);
const wasm = readFileSync(new URL('target/wasm-pkg/sim_wasm_bg.wasm', root));
initSync({ module: wasm });
mkdirSync(destination, { recursive: true });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const records = [];
const keys = new Set();
const options = new Set();
const families = new Set();
const paths = new Set();
const stopScan = { batches: 0, multipleReasons: [], joinedNodeStops: 0 };
const json = (name, value) => writeFileSync(new URL(name, destination), `${JSON.stringify(value, null, 2)}\n`);
const snapshot = sim => JSON.parse(sim.snapshot());
function save(key, sim, kind, extra = {}) {
  if (keys.has(key)) return;
  keys.add(key);
  const bytes = sim.export_replay();
  const replay = JSON.parse(bytes);
  const world = snapshot(sim);
  const stem = `${String(records.length).padStart(2, '0')}-${kind}`;
  writeFileSync(new URL(`${stem}.replay.json`, destination), bytes);
  json(`${stem}.world.json`, world);
  records.push({ key, kind, replay: `${stem}.replay.json`, world: `${stem}.world.json`,
    tick: world.tick, seed: replay.seed, config: replay.config, sha256: sha256(bytes), ...extra });
  console.log(`prepared ${key} seed=${replay.seed} tick=${world.tick}`);
}
function checked(sim, payloads) {
  const receipt = JSON.parse(sim.submit_checked(JSON.stringify(payloads)));
  if (!receipt.ok) throw Error(`Scenario planner's actual checked input rejected: ${JSON.stringify(receipt)}`);
  return receipt;
}
function slotPayload(slot) {
  return slot.startsWith('birth:') ? { Birth: slot.slice(6) }
    : slot === 'imported_vessel' ? 'ImportedVessel' : 'RebuiltBody';
}
function complete() {
  return families.size === 5 && options.size === 24 && paths.size === 3
    && keys.has('waiting-actions') && keys.has('negative-target') && keys.has('no-eligible-target');
}
if (!claimExpectationsOnly) {
// The existing fixture supplies a cheap, unchanged branch with actual Bribe/Haunt
// eligibility. This is a setup replay, not an assertion that UI actions occurred.
const baseline = JSON.parse(readFileSync(new URL('fixtures/parity/seedP-playthrough.replay.json', root), 'utf8'));
{
  const sim = new WasmSim(BigInt(baseline.seed), JSON.stringify(baseline.config));
  try {
    for (const input of [...baseline.inputs].sort((a, b) => Number(BigInt(a.seq) - BigInt(b.seq)))) {
      if (BigInt(input.tick) < 5374n) sim.submit(JSON.stringify({ tick: input.tick, payload: input.payload }));
    }
    sim.run_ticks(5374);
    const checksums = JSON.parse(sim.checksums(0n, 5373n));
    for (let tick = 0; tick < 5374; tick++) {
      if (checksums[tick] !== baseline.checksums[tick]) throw Error(`Existing native seedP checksum diverged at tick ${tick + 1}`);
    }
    save('waiting-actions', sim, 'waiting', { setupSource: 'seedP-playthrough prefix before tick 5374 claim' });
  } finally { sim.free(); }
}
// Each seed is a separate genuine branch. The fixed policy helps family members
// while alive (like existing DevotedLiving), then preferentially claims a native
// slot. A separate insult policy supplies a negative connection/feud opportunity.
// run_until_stop keeps all Narrator answers explicit in the exported input stream.
for (let seed = 1; seed <= 64 && !complete(); seed++) {
  const sim = new WasmSim(BigInt(seed), JSON.stringify({ opening_residents: 50 }));
  let body = null; let cursor = 0; let nextAct = 0; let enemy = null;
  let lastWait = null; let dreamed = false;
  try {
    while (sim.tick() < 29200n) {
      const world = snapshot(sim);
      const node = world.player_node;
      if (node !== null) {
        const signature = `${node.family}:${node.options.map(option => option.id).join(',')}`;
        save(signature, sim, 'node', { family: node.family, optionLabels: node.options.map(option => option.id) });
        families.add(node.family);
        for (const option of node.options) options.add(option.id);
        checked(sim, [{ ChoosePlayer: { node: node.id, option: node.rules_default } }]);
      }
      const view = world.underworld_view;
      if (view !== null && world.player_wait?.claim === null) {
        if (lastWait !== world.player_wait.ghost) { lastWait = world.player_wait.ghost; dreamed = false; }
        if (view.actions.haunt.targets.length === 0 || view.actions.haunt.targets.every(target => !target.availability.eligible)) {
          save('no-eligible-target', sim, 'no-target');
        }
        const negative = world.player.past_life_ties.find(tie => tie.affinity < 0 && view.actions.haunt.targets.some(target => target.target === tie.rememberer && target.availability.eligible));
        if (negative) save('negative-target', sim, 'negative-target', { target: negative.rememberer });
        for (const slot of view.slots.filter(slot => slot.status.claimable && slot.status.affordable)) {
          save(`path:${slot.kind}`, sim, 'path', { slot: slot.slot, path: slot.kind });
          paths.add(slot.kind);
        }
        const birth = view.slots.find(slot => slot.kind === 'birth_slot' && slot.status.claimable && slot.status.affordable);
        const rebuilt = view.slots.find(slot => slot.kind === 'rebuilt_body' && slot.status.claimable && slot.status.affordable);
        // Wait for the well-off rebuilt branch on every third seed; native births
        // in the other branches let actual childhood age-clock options emerge.
        const chosen = seed % 3 === 0 ? rebuilt : birth;
        if (chosen) {
          checked(sim, [{ ClaimSlot: { slot: slotPayload(chosen.slot), ...(chosen.kind === 'rebuilt_body' ? { customization: { Set: { trait_name: 'piety', value: 3 } } } : {}) } }]);
        } else if (!dreamed && view.connected.length && BigInt(world.joss.find(account => account.soul_id === world.player_soul).balance) >= BigInt(view.dream_price)) {
          const payload = { Dream: { dreamer: String(view.connected[0]), intent: 'request_offering' } };
          const preview = JSON.parse(sim.preview_node(JSON.stringify(payload)));
          // An actual rules-generated option, not a synthetic offering or balance.
          if (preview.ok) {
            const option = preview.option_ids.includes('burn_offering') ? 'burn_offering' : preview.rules_default;
            checked(sim, [payload, { Choose: { node: { Trigger: { seq: preview.trigger } }, option } }]);
          } else checked(sim, [payload]);
          dreamed = true;
        }
      } else if (view === null && world.player.body !== null) {
        if (body !== world.player.body) { body = world.player.body; cursor = 0; nextAct = Number(world.tick); enemy = null; }
        if (Number(world.tick) >= nextAct) {
          nextAct = Number(world.tick) + 30;
          const kin = world.player.blood_ties.filter(tie => world.residents.some(person => person.id === tie.person));
          const targets = kin.length ? kin.map(tie => tie.person) : world.residents.filter(person => person.id !== body).map(person => person.id);
          if (targets.length) {
            enemy ??= targets[0];
            const hostile = seed % 2 === 0 && Number(world.tick) >= 600 && Number(world.tick) <= 1500;
            const target = hostile && world.residents.some(person => person.id === enemy) ? enemy : targets[cursor++ % targets.length];
            checked(sim, [{ Act: { kind: hostile ? 'insult' : cursor % 2 ? 'help' : 'gift', actor: String(body), target: String(target), intensity: 100 } }]);
          }
        }
      }
      const report = JSON.parse(sim.run_until_stop(30));
      if (report.ran === 0) throw Error('Deterministic scenario preparation made no progress');
      stopScan.batches++;
      const stoppedWorld = snapshot(sim);
      if (report.stops.length > 1) {
        const signature = report.stops.join('+');
        if (!stopScan.multipleReasons.includes(signature)) stopScan.multipleReasons.push(signature);
        save(`multi-stop:${signature}`, sim, 'joined-stop', { reasons: report.stops, lifecycle: report.player_lifecycle });
      }
      if (stoppedWorld.player_node !== null && (report.player_lifecycle.length > 0 || report.stops.includes('dream_resolved'))) {
        stopScan.joinedNodeStops++;
        save('joined-nonhead', sim, 'joined-node', { reasons: report.stops, lifecycle: report.player_lifecycle,
          family: stoppedWorld.player_node.family, optionLabels: stoppedWorld.player_node.options.map(option => option.id) });
      }
      for (const fact of report.player_lifecycle) {
        if (fact.kind === 'death') save('own-death', sim, 'death', { lifecycle: report.player_lifecycle });
        if (fact.kind === 'birth') save('native-birth', sim, 'rebirth', { lifecycle: report.player_lifecycle });
      }
      if (complete()) break;
    }
  } finally { sim.free(); }
}
const missing = ['family_death', 'inheritance', 'debt_due', 'feud', 'life_stage'].filter(family => !families.has(family));
if (options.size !== 24) missing.push(`all 24 legal labels (found ${[...options].join(', ')})`);
for (const path of ['birth_slot', 'imported_vessel', 'rebuilt_body']) if (!paths.has(path)) missing.push(path);
for (const key of ['waiting-actions', 'negative-target', 'no-eligible-target', 'own-death', 'native-birth']) if (!keys.has(key)) missing.push(key);
json('manifest.json', { version: 1, mode: 'LOCAL-RECORDED-WASM-SETUP-NOT-UI-PROOF',
  generator: 'scripts/prepare-life-c4-scenarios.mjs', generatorSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
  wasmSha256: sha256(wasm), records, missing,
  nonHeadDiscovery: { ...stopScan, reached: keys.has('joined-nonhead'),
    scope: 'Only the existing bounded preparation traversal; absence is reported, never substituted with constructed World/UI facts.',
    producerConstraints: ['narrator::resolve consumes yesterday pending before mortality', 'narrator::run requires embodied player',
      'new body resets PlayerLife.start; default first_interrupt_min is 600', 'Dream application requires waiting Soul',
      'production currentDecision suppresses legal Choose after sending/queued; repeated activation cannot manufacture a rejection'] },
  boundaries: 'Default Params, 64 deterministic independent seeds maximum; no World mutation, synthetic receipts, model, network or existing golden modification.' });
if (missing.length) throw Error(`Required real scenarios were not reached: ${missing.join('; ')}. Manifest retains reached cases; expand the deterministic recorded policy, never fabricate them.`);
} else {
  const prepared = JSON.parse(readFileSync(new URL('manifest.json', destination), 'utf8'));
  if (prepared.version !== 1 || prepared.missing.length) throw Error('Claim-only mode requires the complete existing scenario manifest');
  records.push(...prepared.records);
}

// Native births inherit from actual parents; imported bodies draw their own
// Traits. Neither uses the Rebuilt_Body base_traits projection. Produce actual
// no-carry completed baselines rather than duplicating inheritance/RNG rules.
const claimBaselines = [];
for (const path of ['birth_slot', 'imported_vessel']) {
  const source = records.find(record => record.key === `path:${path}`);
  if (!source) throw Error(`Required recorded claim prefix ${path} is missing`);
  const sourceBytes = readFileSync(new URL(source.replay, destination), 'utf8');
  if (sha256(sourceBytes) !== source.sha256) throw Error(`Claim source hash changed: ${source.replay}`);
  const replay = JSON.parse(sourceBytes);
  if (replay.inputs.some(input => BigInt(input.tick) >= BigInt(replay.ticks))) throw Error('No-carry baseline cannot include future queued inputs');
  const sim = new WasmSim(BigInt(replay.seed), JSON.stringify(replay.config));
  try {
    for (const input of [...replay.inputs].sort((a, b) => Number(BigInt(a.seq) - BigInt(b.seq)))) {
      sim.submit(JSON.stringify({ tick: input.tick, payload: input.payload }));
    }
    sim.run_ticks(Number(replay.ticks));
    const prefix = JSON.parse(sim.checksums(0n, BigInt(replay.ticks) - 1n));
    for (let tick = 0; tick < replay.checksums.length; tick++) {
      if (prefix[tick] !== replay.checksums[tick]) throw Error(`Claim baseline prefix diverged at tick ${tick + 1}`);
    }
    const before = snapshot(sim);
    if (before.player_wait?.carry_over !== null || before.player_wait?.claim !== null) throw Error('Claim baseline must begin with actual None carry and no existing claim');
    const slot = before.underworld_view.slots.find(slot => slot.slot === source.slot);
    if (!slot?.status.claimable || !slot.status.affordable) throw Error('Prepared claim slot is not executable in the actual baseline World');
    checked(sim, [{ ClaimSlot: { slot: slotPayload(slot.slot) } }]);
    const ticks = path === 'birth_slot' ? Number(BigInt(slot.birth) + 1n - sim.tick()) : 1;
    const report = JSON.parse(sim.run_until_stop(ticks));
    const world = snapshot(sim);
    const body = world.residents.find(person => person.id === world.player.body);
    const kind = path === 'birth_slot' ? 'birth' : 'possession';
    if (world.player.place !== 'body' || !body || !report.stops.includes('player_reborn')
      || !report.player_lifecycle.some(fact => fact.kind === kind && fact.body === body.id)) throw Error(`Actual ${path} baseline did not complete the requested rebirth`);
    const bytes = sim.export_replay();
    const stem = `claim-baseline-${path}`;
    writeFileSync(new URL(`${stem}.replay.json`, destination), bytes);
    json(`${stem}.world.json`, world);
    claimBaselines.push({ path, sourceKey: source.key, sourceSha256: source.sha256, slot: slot.slot,
      seed: replay.seed, config: replay.config, replay: `${stem}.replay.json`, world: `${stem}.world.json`,
      sha256: sha256(bytes), completedTick: world.tick, body: body.id, lifecycle: report.player_lifecycle });
    console.log(`prepared actual None-carry ${path} baseline seed=${replay.seed} tick=${world.tick} body=${body.id}`);
  } finally { sim.free(); }
}
json('claim-expectations.json', { version: 1, layer: 'ACTUAL-WASM-RECORDED-NO-CARRY-CLAIM-BASELINES',
  generatorSha256: sha256(readFileSync(fileURLToPath(import.meta.url))), wasmSha256: sha256(wasm), records: claimBaselines,
  boundaries: 'Actual create/recorded submit/checksummed prefix/checked Claim/observed completion; no simulated RNG, hand-authored Traits, World mutation or existing golden change. Carry expectations override exactly one Trait from the actual ghost projection; rebuilt expectations retain actual base_traits and Set/Adjust.' });
