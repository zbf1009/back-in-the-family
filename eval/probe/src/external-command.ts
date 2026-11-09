// CLI side of `ingest-reference` (llm-probe task 31.1; R19.15, R3.1, RC-13): flag parsing, the Manifest_Check and output.
//
//   ingest-reference --file <external-reference.json>
//
// The path is resolved against the current directory (`pnpm --dir eval/probe` runs in eval/probe), so an absolute
// path is the safe choice for the reference file itself; the files it names are relative to its directory.
//
// This is the only module that imports `external.ts` (cli.ts reaches it through `loadExternalRecords` below). The
// command runs the Manifest_Check first (R1.1), sends no request to any Runtime and reads no `env`. A rejected file
// prints `probe: external_reference: <first failing field>: <reason>`, exits 1 and writes nothing. It prints no Card
// content: field names, line numbers, hashes, labels, figures, Card IDs and the names of differing figures.
import path from 'node:path';
import { parseArgs } from 'node:util';
import { CardLoadError } from './cards.ts';
import { ExternalReferenceError, ingestExternalReference, readAuthorSupplied, readExternalRecords, type AuthorSuppliedRecord, type ExternalRecord, type Figures } from './external.ts';
import type { ParsedArgs } from './run-command.ts';
import { RunLogger } from './run-logger.ts';
import { reportFailure, runManifestCheck, type RunDeps } from './run.ts';
import { printErrorLine, printLine } from './sink.ts';

/** What the command needs from the run wiring. `RunDeps` fits. */
export interface ExternalCommandDeps {
  readonly paths: RunDeps['paths'];
  readonly pinnedManifestHash: string;
  readonly logger?: RunLogger;
}

export function parseIngestReferenceArgs(argv: readonly string[]): ParsedArgs<{ readonly file: string }> {
  try {
    const { values, positionals } = parseArgs({ args: [...argv], allowPositionals: true, strict: true, options: { file: { type: 'string' } } });
    if (positionals.length > 0) return { ok: false, message: `unexpected argument "${positionals[0]}"` };
    if (values.file === undefined || values.file === '') return { ok: false, message: '--file <external-reference.json> is required' };
    return { ok: true, options: { file: path.resolve(values.file) } };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

const figuresText = (f: Figures): string => `acceptable ${f.acceptable}/${f.scored_cards}, severe ${f.severe}, illegal ${f.illegal}/${f.scored_cards}, flips ${f.flips}/${f.flip_perms}, contrast ${f.consistent_pairs}/${f.pairs}`;

/** The lines printed for an accepted reference. */
export function acceptedLines(r: ExternalRecord, dir: string): string[] {
  const lines = [`probe: external_reference: accepted ${r.label} (Task_Type ${r.task_type}, reference model ${JSON.stringify(r.reference_model)}), stored under ${dir}`];
  lines.push(`probe: external_reference: supplied figures: ${figuresText(r.supplied)}`);
  if (r.regrade === null || r.regrade_figures === null) lines.push('probe: external_reference: no raw outputs supplied; nothing was re-graded');
  else if (r.regrade === 'match') lines.push(`probe: external_reference: re-graded ${r.raw_output_count ?? 0} raw outputs through Sim_Wasm: match`);
  else {
    lines.push(`probe: external_reference: re-graded ${r.raw_output_count ?? 0} raw outputs through Sim_Wasm: MISMATCH in ${r.differing.join(', ')}`);
    lines.push(`probe: external_reference: re-graded figures: ${figuresText(r.regrade_figures)}`);
  }
  return lines;
}

/** `ingest-reference`. Returns the exit code: 0 for an accepted file (also with a mismatch), 1 for a rejected one, 2 for bad arguments. */
export async function ingestReferenceCommand(argv: readonly string[], deps: ExternalCommandDeps): Promise<number> {
  const parsed = parseIngestReferenceArgs(argv);
  if (!parsed.ok) {
    printErrorLine(`probe: ingest-reference: ${parsed.message}`);
    return 2;
  }
  const logger = deps.logger ?? new RunLogger();
  try {
    await runManifestCheck(deps, logger);
    const { record, dir } = ingestExternalReference({ paths: deps.paths, pinnedManifestHash: deps.pinnedManifestHash }, parsed.options.file);
    for (const line of acceptedLines(record, path.relative(deps.paths.repoDir, dir))) printLine(line);
    return 0;
  } catch (e) {
    if (e instanceof ExternalReferenceError) {
      printErrorLine(`probe: external_reference: ${e.field}: ${e.reason}`);
      return 1;
    }
    if (e instanceof CardLoadError) {
      logger.cardLoad(e.failures);
      return 1;
    }
    return reportFailure(logger, e);
  }
}

/** Stored External_References for the Report (section 12). The only way the CLI reaches `external.ts` for `report`. */
export const loadExternalRecords = (resultsDir: string): ExternalRecord[] => readExternalRecords(resultsDir);

/** Stored Author-supplied External references (task 43) for the Report's section 12; read-only, nothing is verified. */
export const loadAuthorSuppliedRecords = (resultsDir: string): AuthorSuppliedRecord[] => readAuthorSupplied(resultsDir);
