// Probe_Runner CLI (llm-probe task 7.1). Run as `pnpm --dir eval/probe run probe <command>`.
//
// Every command that touches cards runs the Manifest_Check first, on every invocation, and
// never reuses an earlier outcome (R1.1). A failure prints `probe: manifest: ...` and exits
// non-zero before any Results file, ledger write or request.
//
// `check-manifest` must not read `env` (R1.6). So this file imports only manifest.ts
// (node built-ins) statically; commands that need more (cards, adapters, env) load their
// modules with dynamic `import()` after the Manifest_Check has passed.
import { fileURLToPath } from 'node:url';
import { printErrorLine, printLine } from './sink.ts';
import { checkManifest, formatManifestResult, PINNED_MANIFEST_HASH } from './manifest.ts';

const CARDS_DIR = fileURLToPath(new URL('../../cards/', import.meta.url));

/** Runs the Manifest_Check against the real Card_Set; exits non-zero on failure. */
export async function requireManifest(): Promise<void> {
  const result = await checkManifest({ cardsDir: CARDS_DIR, pinnedHash: PINNED_MANIFEST_HASH });
  const lines = formatManifestResult(result, PINNED_MANIFEST_HASH);
  if (!result.ok) {
    for (const line of lines) printErrorLine(line);
    process.exit(1);
  }
  for (const line of lines) printLine(line);
}

const REPO_DIR = fileURLToPath(new URL('../../../', import.meta.url));

// `ledger` reads no cards, so it skips the Manifest_Check; `phase-status` reads them for statistics and runs it.
const COMMANDS: Record<string, () => Promise<void>> = {
  'check-manifest': requireManifest,
  'phase-status': async () => {
    // Pass results come from the stored grades, which needs the Card_Set for statistics only: Manifest_Check first.
    await requireManifest();
    const { phaseStatusWithPasses, reportPaths } = await import('./report-command.ts');
    process.exitCode = await phaseStatusWithPasses(reportPaths(REPO_DIR));
  },
  // `report` reads the Card_Set for grading and statistics only (R3.1), so the Manifest_Check comes first.
  report: async () => {
    await requireManifest();
    const { reportCommand, reportPaths } = await import('./report-command.ts');
    // The stored External_References go into section 12 only; they are read here so that report-command.ts never imports external.ts.
    const { loadAuthorSuppliedRecords, loadExternalRecords } = await import('./external-command.ts');
    process.exitCode = await reportCommand(reportPaths(REPO_DIR), loadExternalRecords, loadAuthorSuppliedRecords);
  },
  // Reads no cards and no env, so no Manifest_Check (R3.16).
  'check-web-imports': async () => {
    const { checkWebImportsCommand } = await import('./check-web-imports.ts');
    process.exitCode = checkWebImportsCommand(REPO_DIR);
  },
  // Both runs do their own Manifest_Check at the start of every run (R1.1) before reading any card.
  'dev-run': async () => {
    const { devRunCommand, defaultRunDeps } = await import('./run-command.ts');
    process.exitCode = await devRunCommand(process.argv.slice(3), defaultRunDeps(REPO_DIR));
  },
  'locked-run': async () => {
    const { lockedRunCommand, defaultRunDeps } = await import('./run-command.ts');
    process.exitCode = await lockedRunCommand(process.argv.slice(3), defaultRunDeps(REPO_DIR));
  },
  // Workers AI Smoke_Calls on Dev_Cards only; does its own Manifest_Check, reads `env` only after every other check passed.
  smoke: async () => {
    const { smokeCommand, defaultSmokeDeps } = await import('./smoke.ts');
    process.exitCode = await smokeCommand(process.argv.slice(3), defaultSmokeDeps(REPO_DIR));
  },
  // These three read the Card_Set (page-bundle to render, ingest and regrade to grade only, R3.1) and do
  // their own Manifest_Check before any card is read (R1.1). `ingest-reference` below is the fourth grading-only reader.
  'page-bundle': async () => {
    const { pageBundleCommand } = await import('./ingest-command.ts');
    const { defaultRunDeps } = await import('./run-command.ts');
    process.exitCode = await pageBundleCommand(process.argv.slice(3), defaultRunDeps(REPO_DIR));
  },
  ingest: async () => {
    const { ingestCommand } = await import('./ingest-command.ts');
    const { defaultRunDeps } = await import('./run-command.ts');
    process.exitCode = await ingestCommand(process.argv.slice(3), defaultRunDeps(REPO_DIR));
  },
  regrade: async () => {
    const { regradeCommand } = await import('./ingest-command.ts');
    const { defaultRunDeps } = await import('./run-command.ts');
    process.exitCode = await regradeCommand(process.argv.slice(3), defaultRunDeps(REPO_DIR));
  },
  // Ingests an External_Reference_File (R19.15): runs its own Manifest_Check first, sends no request, reads no env, and
  // writes only under eval/results/external/<label>/. With raw outputs it re-grades through Sim_Wasm, which reads
  // locked.jsonl for grading only (R3.1, RC-13), like ingest, regrade and report.
  'ingest-reference': async () => {
    const { ingestReferenceCommand } = await import('./external-command.ts');
    const { defaultRunDeps } = await import('./run-command.ts');
    process.exitCode = await ingestReferenceCommand(process.argv.slice(3), defaultRunDeps(REPO_DIR));
  },
  // Derives a `perm_avg` Derived_Run from the stored `single` Results (R20.9): no network, no `env`, no Request_Budget, no
  // ledger line, no Runtime. Runs its own Manifest_Check first and reads locked.jsonl for grading only (RC-18, like regrade).
  derive: async () => {
    const { deriveCommand, defaultDeriveDeps } = await import('./derive.ts');
    process.exitCode = await deriveCommand(process.argv.slice(3), defaultDeriveDeps(REPO_DIR));
  },
  // Builds and serves the Probe_Page on localhost:4318 and prints a new empty Fresh_Profile directory.
  // Reads no cards and no env, so no Manifest_Check. Long-running: stops on Ctrl-C.
  'page-serve': async () => {
    const { pageServeCommand } = await import('./page-serve.ts');
    process.exitCode = await pageServeCommand();
  },
  // `screen` reads no card and no env, and touches the network only when the Author runs it. `preflight` reads
  // the Dev_Cards (for the prompt length rule) and does its own Manifest_Check first (R1.1).
  screen: async () => {
    const { screenCommand, defaultScreenDeps } = await import('./screen-command.ts');
    process.exitCode = await screenCommand(process.argv.slice(3), defaultScreenDeps(REPO_DIR));
  },
  preflight: async () => {
    const { preflightCommand, defaultPreflightDeps } = await import('./preflight.ts');
    process.exitCode = await preflightCommand(process.argv.slice(3), await defaultPreflightDeps(REPO_DIR));
  },
  ledger: async () => {
    const { ledgerCommand, defaultPaths } = await import('./phase-commands.ts');
    process.exitCode = ledgerCommand(defaultPaths(REPO_DIR));
  },
};

const command = process.argv[2];
const run = command === undefined ? undefined : COMMANDS[command];
if (run === undefined) {
  printErrorLine(`probe: unknown or missing command${command === undefined ? '' : ` "${command}"`}`);
  printErrorLine(`probe: commands: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(2);
}
await run();
