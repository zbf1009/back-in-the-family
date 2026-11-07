// Workers AI credentials (R11.2, R11.4). Reads only the root `env` file, and only when
// a Workers AI Combination starts: nothing here runs at import time.
// Error messages name only the file or the variable, never a value.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Secret } from './redact.ts';

export { Secret } from './redact.ts';

export const ENV_FILE_NAME = 'env';
export const TOKEN_VARIABLE = 'WORKERS_AI_TOKEN';
export const ACCOUNT_VARIABLE = 'CLOUDFLARE_ACCOUNT_ID';

export interface WorkersAiEnv {
  token: Secret;
  accountId: Secret;
}

export class EnvError extends Error {
  readonly exitCode = 1;
  constructor(message: string) {
    super(message);
    this.name = 'EnvError';
  }
}

export interface LoadOptions {
  /** Returns the file text; throws if it cannot be read. Default reads <repo root>/env. */
  readFile?: (path: string) => string;
  /** Path handed to readFile. Default: <repo root>/env. */
  envPath?: string;
}

function defaultEnvPath(): string {
  return fileURLToPath(new URL(`../../../${ENV_FILE_NAME}`, import.meta.url));
}

/** Parses `KEY=value` lines. Blank lines and `#` comments are skipped; CRLF, `export ` and matching quotes are handled. Last duplicate wins. */
export function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0]!)) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

export function loadWorkersAiEnv(options: LoadOptions = {}): WorkersAiEnv {
  const readFile = options.readFile ?? ((p: string) => readFileSync(p, 'utf8'));
  const envPath = options.envPath ?? defaultEnvPath();
  let text: string;
  try {
    text = readFile(envPath);
  } catch {
    throw new EnvError(`probe: env: file "${ENV_FILE_NAME}" is missing or unreadable`);
  }
  const vars = parseEnv(text);
  const get = (name: string): Secret => {
    const value = vars.get(name);
    if (value === undefined || value === '') {
      throw new EnvError(`probe: env: variable ${name} is missing or empty in "${ENV_FILE_NAME}"`);
    }
    return new Secret(value);
  };
  return { token: get(TOKEN_VARIABLE), accountId: get(ACCOUNT_VARIABLE) };
}
