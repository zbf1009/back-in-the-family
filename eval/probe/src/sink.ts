// The only module that writes to files or console streams (R11.3). Every string goes
// through the redactor with the secrets registered via `registerSecrets`.
// tests/unit/sink-guard.test.ts scans src/ to keep it that way.
import * as fs from 'node:fs';
import path from 'node:path';
import { redact, type SecretLike } from './redact.ts';

const registered: SecretLike[] = [];

/** Registers secrets to be redacted from everything written from now on. */
export function registerSecrets(...secrets: SecretLike[]): void {
  registered.push(...secrets);
}

/** Test helper: forgets all registered secrets. */
export function clearSecrets(): void {
  registered.length = 0;
}

/** Applies the registered redaction to a string (also for thrown messages). */
export function scrub(text: string): string {
  return redact(text, registered);
}

export function writeStdout(text: string): void {
  process.stdout.write(scrub(text));
}

export function writeStderr(text: string): void {
  process.stderr.write(scrub(text));
}

/** One line to stdout / stderr (newline appended). */
export function printLine(text: string): void {
  writeStdout(`${text}\n`);
}

export function printErrorLine(text: string): void {
  writeStderr(`${text}\n`);
}

/** Overwrites a file (creating parent directories). */
export function writeTextFile(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, scrub(text));
}

/** Appends to a file (creating parent directories). */
export function appendTextFile(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, scrub(text));
}

/** Appends to a file and `fsync`s it before returning (R3.3: the ledger `start` line). */
export function appendTextFileDurable(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, scrub(text));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Temp file, `fsync`, rename over the target (R11.6: the Request_Budget counter). */
export function writeTextFileAtomicDurable(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, scrub(text));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/** Writes via a temporary sibling file and renames it over the target. */
export function writeTextFileAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, scrub(text));
  fs.renameSync(tmp, file);
}
