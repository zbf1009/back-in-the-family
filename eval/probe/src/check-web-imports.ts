// check-web-imports (llm-probe task 11.2, R3.16): nothing under web/ may import, re-export,
// dynamically import or URL-reference a path under <repo>/eval/, so the deployed bundle can
// never carry a Card. The scan is a pure function over {path, text} files; the wrapper below
// only reads files (node:fs, read-only) and prints through sink.ts.
//
// This module imports nothing that reads the environment (no env.ts).
import * as fs from 'node:fs';
import path from 'node:path';
import { printErrorLine, printLine } from './sink.ts';

export interface SourceFile {
  /** Absolute path of the file. */
  readonly path: string;
  readonly text: string;
}

export interface Violation {
  /** Absolute path of the importing file. */
  readonly file: string;
  /** Absolute resolved path of the imported target (under <repo>/eval/). */
  readonly resolved: string;
}

interface Alias {
  readonly name: string;
  /** Absolute target directory or file. */
  readonly target: string;
}

const SCAN_EXTENSIONS = new Set([
  '.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.svelte', '.html', '.json', '.jsonc',
]);

const Q = `(['"\`])([^'"\`\\n]+)\\1`;
// `import … from 'x'` and `export … from 'x'`, also across lines (`[^'"`;]` spans newlines).
const FROM_RE = new RegExp(`\\b(?:import|export)\\b[^'"\`;]*?\\bfrom\\s*${Q}`, 'g');
const SIDE_EFFECT_RE = new RegExp(`\\bimport\\s*${Q}`, 'g');
const DYNAMIC_RE = new RegExp(`\\bimport\\s*\\(\\s*${Q}`, 'g');
const NEW_URL_RE = new RegExp(`\\bnew\\s+URL\\s*\\(\\s*${Q}\\s*,\\s*import\\.meta\\.url`, 'g');
// HTML: <script src="…"> and <link href="…">.
const HTML_SCRIPT_RE = /<script\b[^>]*?\ssrc\s*=\s*(["'])([^"']+)\1/gi;
const HTML_LINK_RE = /<link\b[^>]*?\shref\s*=\s*(["'])([^"']+)\1/gi;
// Vite alias entry: 'name': fileURLToPath(new URL('rel', import.meta.url)).
const VITE_ALIAS_RE = new RegExp(
  `${Q}\\s*:\\s*fileURLToPath\\s*\\(\\s*new\\s+URL\\s*\\(\\s*${Q}\\s*,\\s*import\\.meta\\.url`,
  'g',
);
// tsconfig: "extends": "x", "path": "x" (references), and the arrays under "paths".
const JSON_STRING_KEY_RE = /"(?:extends|path)"\s*:\s*"([^"]+)"/g;
const JSON_PATHS_BLOCK_RE = /"paths"\s*:\s*\{([^}]*)\}/g;
const JSON_PATH_PAIR_RE = /"([^"]+)"\s*:\s*\[([^\]]*)\]/g;
const JSON_STRING_RE = /"([^"]+)"/g;

function ext(file: string): string {
  return path.posix.extname(file).toLowerCase();
}

function isUnder(dir: string, target: string): boolean {
  return target === dir || target.startsWith(`${dir}/`);
}

function stripSuffix(spec: string): string {
  const cut = spec.search(/[?#]/);
  return cut === -1 ? spec : spec.slice(0, cut);
}

/** Matches all regex hits and returns the given capture group of each. */
function captures(re: RegExp, text: string, group: number): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const value = m[group];
    if (value !== undefined) out.push(value);
  }
  return out;
}

/** Every specifier-like string found in one file (before suffix stripping). */
export function extractSpecifiers(file: SourceFile): string[] {
  const kind = ext(file.path);
  const text = file.text;
  const specs: string[] = [];
  if (kind === '.json' || kind === '.jsonc') {
    specs.push(...captures(JSON_STRING_KEY_RE, text, 1));
    for (const block of captures(JSON_PATHS_BLOCK_RE, text, 1)) {
      for (const list of captures(JSON_PATH_PAIR_RE, block, 2)) {
        specs.push(...captures(JSON_STRING_RE, list, 1));
      }
    }
    return specs;
  }
  specs.push(...captures(FROM_RE, text, 2));
  specs.push(...captures(SIDE_EFFECT_RE, text, 2));
  specs.push(...captures(DYNAMIC_RE, text, 2));
  specs.push(...captures(NEW_URL_RE, text, 2));
  if (kind === '.html' || kind === '.svelte') {
    specs.push(...captures(HTML_SCRIPT_RE, text, 2));
    specs.push(...captures(HTML_LINK_RE, text, 2));
  }
  return specs;
}

/** Aliases declared in a Vite config (`alias` map) or a tsconfig (`paths`). */
export function extractAliases(files: readonly SourceFile[]): Alias[] {
  const aliases: Alias[] = [];
  for (const file of files) {
    const dir = path.posix.dirname(file.path);
    const kind = ext(file.path);
    if (kind === '.json' || kind === '.jsonc') {
      for (const block of captures(JSON_PATHS_BLOCK_RE, file.text, 1)) {
        for (const m of block.matchAll(JSON_PATH_PAIR_RE)) {
          const key = m[1];
          const first = m[2] === undefined ? undefined : captures(JSON_STRING_RE, m[2], 1)[0];
          if (key === undefined || first === undefined) continue;
          aliases.push({
            name: key.replace(/\/\*$/, ''),
            target: path.posix.resolve(dir, first.replace(/\/\*$/, '')),
          });
        }
      }
    } else if (/^vite\.config\.[mc]?[jt]s$/.test(path.posix.basename(file.path))) {
      for (const m of file.text.matchAll(VITE_ALIAS_RE)) {
        const name = m[2];
        const rel = m[4];
        if (name === undefined || rel === undefined) continue;
        aliases.push({ name, target: path.posix.resolve(dir, rel) });
      }
    }
  }
  return aliases;
}

/** Resolves one specifier to the absolute paths it may point at (empty for bare packages). */
function resolveCandidates(
  spec: string,
  fromFile: string,
  repoRoot: string,
  aliases: readonly Alias[],
): string[] {
  const clean = stripSuffix(spec.trim());
  if (clean === '') return [];
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(clean) || clean.startsWith('//')) return [];
  if (clean.startsWith('./') || clean.startsWith('../') || clean === '.' || clean === '..') {
    return [path.posix.resolve(path.posix.dirname(fromFile), clean)];
  }
  if (clean.startsWith('/')) {
    // Root-relative: against the repo root, against web/ as Vite does, or already absolute.
    const webRoot = path.posix.join(repoRoot, 'web');
    return [
      path.posix.resolve(repoRoot, `.${clean}`),
      path.posix.resolve(webRoot, `.${clean}`),
      path.posix.resolve(clean),
    ];
  }
  const out: string[] = [];
  for (const alias of aliases) {
    if (clean === alias.name) out.push(alias.target);
    else if (clean.startsWith(`${alias.name}/`)) {
      out.push(path.posix.resolve(alias.target, clean.slice(alias.name.length + 1)));
    }
  }
  return out;
}

/**
 * Pure scan: every import-like specifier in `files` that resolves under `<repoRoot>/eval/`.
 * Output is sorted by file, then resolved path, without duplicates.
 */
export function findWebImportViolations(
  files: readonly SourceFile[],
  repoRoot: string,
): Violation[] {
  const root = path.posix.resolve(repoRoot);
  const evalDir = path.posix.join(root, 'eval');
  const aliases = extractAliases(files);
  const seen = new Set<string>();
  const found: Violation[] = [];
  for (const file of files) {
    for (const spec of extractSpecifiers(file)) {
      for (const resolved of resolveCandidates(spec, file.path, root, aliases)) {
        if (!isUnder(evalDir, resolved)) continue;
        const key = `${file.path}\u0000${resolved}`;
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ file: file.path, resolved });
      }
    }
  }
  return found.sort((a, b) =>
    a.file === b.file ? (a.resolved < b.resolved ? -1 : a.resolved > b.resolved ? 1 : 0)
      : a.file < b.file ? -1 : 1,
  );
}

const SKIPPED_DIRS = new Set(['node_modules', 'dist']);

/** Read-only walk of `webDir` (skipping node_modules and dist) for scannable files. */
export function readWebSources(webDir: string): SourceFile[] {
  const out: SourceFile[] = [];
  const walk = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile() && SCAN_EXTENSIONS.has(ext(entry.name))) {
        out.push({ path: full, text: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(path.posix.resolve(webDir));
  return out;
}

/** `probe check-web-imports`: returns the exit code (0 clean, 1 violations). */
export function checkWebImportsCommand(repoRoot: string): number {
  const root = path.posix.resolve(repoRoot);
  const files = readWebSources(path.posix.join(root, 'web'));
  const violations = findWebImportViolations(files, root);
  for (const v of violations) {
    printErrorLine(
      `probe: web-imports: ${path.posix.relative(root, v.file)} imports ${path.posix.relative(root, v.resolved)}`,
    );
  }
  if (violations.length > 0) return 1;
  printLine(`probe: web-imports: ok (${files.length} files scanned, no import under eval/)`);
  return 0;
}
