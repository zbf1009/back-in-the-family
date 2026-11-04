// R10: WASM tick performance benchmark (one tick is one day) (Node, no dependencies).
// Usage: node scripts/measure-wasm.mjs WASM_DIR [--runs N] [--entities N]
// Run through scripts/measure-wasm.sh, which builds WASM_DIR (a --target nodejs build of
// sim-wasm with the `bench` feature). Same parameters and table layout as
// `sim-cli measure`. Timing uses performance.now() in JavaScript, outside the simulation.
import { createRequire } from "node:module";
import path from "node:path";

const SEED = 1n;
const LIFETIME_YEARS = 80;
const TICKS_PER_YEAR = 365; // one tick is one day
const CHECKSUM_ITERATIONS = 2000;
const WARMUP_TICKS = 100;
const MAX_RUNS = 50;
const MAX_ENTITIES = 200;

function usage(msg) {
  console.error(`error: ${msg}\nusage: node scripts/measure-wasm.mjs WASM_DIR [--runs N] [--entities N]`);
  process.exit(2);
}

const argv = process.argv.slice(2);
let dir = null;
let runs = 5;
let entities = 60;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const num = (v) => (/^\d+$/.test(v ?? "") ? Number(v) : usage(`${a} needs a non-negative number`));
  if (a === "--runs") runs = num(argv[++i]);
  else if (a.startsWith("--runs=")) runs = num(a.slice(7));
  else if (a === "--entities") entities = num(argv[++i]);
  else if (a.startsWith("--entities=")) entities = num(a.slice(11));
  else if (!a.startsWith("-") && dir === null) dir = a;
  else usage(`unexpected argument ${a}`);
}
if (dir === null) usage("missing WASM_DIR");
if (runs < 1 || runs > MAX_RUNS) usage(`--runs must be 1..=${MAX_RUNS}`);
if (entities > MAX_ENTITIES) usage(`--entities must be 0..=${MAX_ENTITIES}`);

const require = createRequire(import.meta.url);
const { WasmSim, bench_checksum } = require(path.resolve(dir, "sim_wasm.js"));

const best = (xs) => Math.min(...xs);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const time = (f) => {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
};

function measureOne() {
  const config = JSON.stringify({ entity_count: entities, workload: "Pairwise" });
  const ticks = LIFETIME_YEARS * TICKS_PER_YEAR;

  // Whole lifetime in one run_ticks call (one JS-to-WASM crossing).
  const bulk = [];
  for (let r = 0; r < runs; r++) {
    const sim = new WasmSim(SEED, config);
    bulk.push(time(() => sim.run_ticks(ticks)));
    sim.free();
  }
  // Whole lifetime as one step() call per tick (boundary cost included).
  const stepped = [];
  for (let r = 0; r < runs; r++) {
    const sim = new WasmSim(SEED, config);
    stepped.push(
      time(() => {
        for (let t = 0; t < ticks; t++) sim.step();
      }),
    );
    sim.free();
  }
  // Checksum per call = (t(N iterations) - t(1 iteration)) / (N - 1); the one-iteration
  // call is the baseline (construction + 100 warm-up ticks + one checksum).
  const t1 = [];
  const tN = [];
  for (let r = 0; r < runs; r++) {
    t1.push(time(() => bench_checksum(SEED, config, 1)));
    tN.push(time(() => bench_checksum(SEED, config, CHECKSUM_ITERATIONS)));
  }
  const checksumNs = ((best(tN) - best(t1)) * 1e6) / (CHECKSUM_ITERATIONS - 1);
  return { ticks, bulk, stepped, checksumNs };
}

const r0 = measureOne();

console.log(`sim-wasm measure (node ${process.version}, wasm-bindgen ${process.env.WASM_BINDGEN_VERSION ?? "unknown"}) build=release+bench`);
console.log(
  `params: seed=1 entities=${entities} workload=Pairwise runs=${runs} checksum_iterations=${CHECKSUM_ITERATIONS} checksum_state_after_ticks=${WARMUP_TICKS}`,
);
console.log("lifetime: 80 years = 80 x 365 = 29200 daily ticks; no inputs; fresh WasmSim per run");
console.log("definitions: best/median over runs; ticks/s = lifetime ticks / best lifetime (run_ticks);");
console.log("  checksum share = checksum ns per call / (best lifetime ns / lifetime ticks)");
console.log("  checksum ns per call = (best t(2000 iterations) - best t(1 iteration)) / 1999");
console.log("  step() rows: one WasmSim.step() call per tick, including the JS-to-WASM boundary");
console.log();
const line = (label, a) => console.log(`${label.padEnd(28)}${a.padStart(16)}`);
line("metric", "daily (1d)");
const row = (label, g) => line(label, g(r0));
row("lifetime_ticks", (r) => String(r.ticks));
row("ticks_per_second", (r) => ((r.ticks / best(r.bulk)) * 1000).toFixed(0));
row("lifetime_best_ms", (r) => best(r.bulk).toFixed(2));
row("lifetime_median_ms", (r) => median(r.bulk).toFixed(2));
row("checksum_ns_per_call", (r) => r.checksumNs.toFixed(0));
row("checksum_share_percent", (r) => ((r.checksumNs / ((best(r.bulk) * 1e6) / r.ticks)) * 100).toFixed(1));
row("canonical_state_bytes", () => "-");
row("step_ticks_per_second", (r) => ((r.ticks / best(r.stepped)) * 1000).toFixed(0));
row("step_lifetime_best_ms", (r) => best(r.stepped).toFixed(2));
row("step_lifetime_median_ms", (r) => median(r.stepped).toFixed(2));
