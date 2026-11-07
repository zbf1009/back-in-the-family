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

const COMMANDS: Record<string, () => Promise<void>> = {
  'check-manifest': requireManifest,
};

const command = process.argv[2];
const run = command === undefined ? undefined : COMMANDS[command];
if (run === undefined) {
  printErrorLine(`probe: unknown or missing command${command === undefined ? '' : ` "${command}"`}`);
  printErrorLine(`probe: commands: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(2);
}
await run();
