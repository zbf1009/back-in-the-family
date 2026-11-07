// `page-serve` (llm-probe task 16.7; design CLI table, "Probe_Page bundle and export", R10.2, R10.7).
//
//   probe page-serve
//
// Builds the Probe_Page with Vite into eval/probe/dist and serves it on http://localhost:4318. It
// creates a NEW EMPTY directory for the Author's headed Chrome (`--user-data-dir`, the Fresh_Profile)
// and prints it together with the command that deletes it. The command never deletes the profile
// itself: the Author needs it after the run, and deletes it with the printed command.
//
// This command reads no Card and no env file, so it skips the Manifest_Check (like `phase-status`).
// All side effects go through `PageServeDeps`, so the unit tests run it with fakes. The real build and
// server are Vite's JS API, imported only when the default deps are used.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { printErrorLine, printLine } from './sink.ts';

export const PAGE_URL = 'http://localhost:4318/';
export const FRESH_PROFILE_PREFIX = 'llm-probe-profile-';

export interface PageServer {
  /** Where the page is reachable. */
  readonly url: string;
  close(): Promise<void>;
}

export interface PageServeDeps {
  /** Creates a new empty directory with the given prefix and returns its absolute path. */
  makeProfileDir(prefix: string): Promise<string>;
  /** Removes a directory (used only when the build or the server fails, so no empty profile is left behind). */
  removeDir(dir: string): Promise<void>;
  /** `vite build` into eval/probe/dist. Rejects on a build error. */
  build(): Promise<void>;
  /** Starts the preview server on the Probe_Page port. */
  serve(): Promise<PageServer>;
  /** Resolves when the Author stops the command (Ctrl-C). */
  waitForStop(): Promise<void>;
  print(line: string): void;
  printError(line: string): void;
}

/** POSIX single-quoting, so a path with a space or a quote cannot change the command. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** The command that deletes the Fresh_Profile after the headed run. */
export const deleteCommand = (profileDir: string): string => `rm -rf -- ${shellQuote(profileDir)}`;

/** A Chrome command line for the headed run on the Fresh_Profile. */
export const chromeCommand = (profileDir: string, url: string = PAGE_URL): string =>
  `google-chrome --user-data-dir=${shellQuote(profileDir)} --no-first-run --no-default-browser-check ${shellQuote(url)}`;

/** Lines printed once the page is served. Pure. */
export function servedLines(profileDir: string, url: string): string[] {
  return [
    `page-serve: Probe_Page built into eval/probe/dist and served on ${url}`,
    `page-serve: Fresh_Profile (new, empty): ${profileDir}`,
    'page-serve: start the Author\'s headed Chrome on it with:',
    `  ${chromeCommand(profileDir, url)}`,
    '  (if the adapter check reports no hardware GPU, add the Headless_Launch_Flags: --enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan)',
    'page-serve: in the page: pick the Combination, "Check WebGPU adapter", "Cold start" (empty cache), reload, pick the bundle, "Cold start" again (warm cache), "Run bundle", "Download export", then run `probe ingest --file <export>`.',
    'page-serve: after the run, stop this command (Ctrl-C) and delete the Fresh_Profile with:',
    `  ${deleteCommand(profileDir)}`,
  ];
}

/** Returns the exit code. Creates the profile directory first so the build error path can clean it up. */
export async function pageServe(deps: PageServeDeps): Promise<number> {
  let profileDir: string | null = null;
  let server: PageServer | null = null;
  try {
    profileDir = await deps.makeProfileDir(FRESH_PROFILE_PREFIX);
    await deps.build();
    server = await deps.serve();
    for (const line of servedLines(profileDir, server.url)) deps.print(line);
    await deps.waitForStop();
    await server.close();
    server = null;
    deps.print(`page-serve: stopped. The Fresh_Profile is still on disk; delete it with: ${deleteCommand(profileDir)}`);
    return 0;
  } catch (e) {
    deps.printError(`page-serve: ${e instanceof Error ? e.message : String(e)}`);
    if (server !== null) await server.close().catch(() => undefined);
    if (profileDir !== null) await deps.removeDir(profileDir).catch(() => undefined);
    return 1;
  }
}

// ---------------------------------------------------------------- default wiring (not unit-tested)

const PROBE_DIR = fileURLToPath(new URL('../', import.meta.url));
const VITE_CONFIG = path.join(PROBE_DIR, 'vite.config.ts');

/** Real build and server: Vite's JS API with the one config file, `eval/probe/vite.config.ts`. */
export function defaultPageServeDeps(): PageServeDeps {
  return {
    makeProfileDir: (prefix) => mkdtemp(path.join(tmpdir(), prefix)),
    removeDir: (dir) => rm(dir, { recursive: true, force: true }),
    async build() {
      const vite = await import('vite');
      await vite.build({ configFile: VITE_CONFIG, logLevel: 'warn' });
    },
    async serve() {
      const vite = await import('vite');
      const server = await vite.preview({ configFile: VITE_CONFIG, logLevel: 'warn', preview: { open: false } });
      return { url: server.resolvedUrls?.local[0] ?? PAGE_URL, close: () => server.close() };
    },
    waitForStop: () =>
      new Promise<void>((resolve) => {
        process.once('SIGINT', () => resolve());
        process.once('SIGTERM', () => resolve());
      }),
    print: printLine,
    printError: printErrorLine,
  };
}

export const pageServeCommand = (deps: PageServeDeps = defaultPageServeDeps()): Promise<number> => pageServe(deps);
