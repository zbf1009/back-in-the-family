import assert from 'node:assert/strict';
import { digest } from '../worker-api/scripts/bundle.ts';

export const LICENSE_SOURCE_PATHS = ['Cargo.lock', 'LICENSE', 'rust-toolchain.toml',
  'web/assets/licenses/CC-BY-4.0.txt', 'web/assets/licenses/character-portrait-kit-NOTICE.txt', 'web/package.json', 'web/pnpm-lock.yaml'] as const;
export interface LicenseEntry {
  readonly id: string;
  readonly version: string;
  readonly sourcePin: string;
  readonly text: string;
  readonly sha256: string;
}
export interface LicenseClosure {
  readonly sourcePins: Readonly<Record<typeof LICENSE_SOURCE_PATHS[number], string>>;
  readonly entries: readonly LicenseEntry[];
}

// Raw SHA256 values come from the actual prepared runtime and checked artwork license files.
// These implementation pins are not a second transport or public manifest.
export const LICENSE_CATALOG = [
  { id: 'arrayvec', version: '0.7.8', sourcePin: 'cargo:arrayvec@0.7.8/LICENSE-MIT', source: 'cargo', path: 'arrayvec-0.7.8/LICENSE-MIT', sha256: '4da95ec4ecb65b738d470b7d762894ad9c97da93e6cbfb18b570fc2c96f4b871' },
  { id: 'blake3', version: '1.8.7', sourcePin: 'cargo:blake3@1.8.7/LICENSE_A2', source: 'cargo', path: 'blake3-1.8.7/LICENSE_A2', sha256: '00fcc7a934ddbc9ece2a7cc063ac788e284b703b1d705ccbba72d462aa97921e' },
  { id: 'cc-by-4.0', version: '4.0', sourcePin: 'license:CC-BY-4.0/web/assets/licenses/CC-BY-4.0.txt', source: 'asset', path: 'web/assets/licenses/CC-BY-4.0.txt', sha256: '9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411' },
  { id: 'cfg-if', version: '1.0.5', sourcePin: 'cargo:cfg-if@1.0.5/LICENSE-MIT', source: 'cargo', path: 'cfg-if-1.0.5/LICENSE-MIT', sha256: '378f5840b258e2779c39418f3f2d7b2ba96f1c7917dd6be0713f88305dbda397' },
  { id: 'character-portrait-kit', version: 'CC-BY-4.0', sourcePin: 'asset:character-portrait-kit@CC-BY-4.0/web/assets/licenses/character-portrait-kit-NOTICE.txt', source: 'asset', path: 'web/assets/licenses/character-portrait-kit-NOTICE.txt', sha256: '08648ae52986973cbbe2867bb7a5d725c02f35781902a904ec1558ef614202e9' },
  { id: 'constant_time_eq', version: '0.4.2', sourcePin: 'cargo:constant_time_eq@0.4.2/LICENSE-MIT0', source: 'cargo', path: 'constant_time_eq-0.4.2/LICENSE-MIT0', sha256: '9a3aeb3f63659c4c6302d315e1d98784d1e8559858a47ff9562e091bb922d28d' },
  { id: 'memchr', version: '2.8.3', sourcePin: 'cargo:memchr@2.8.3/LICENSE-MIT', source: 'cargo', path: 'memchr-2.8.3/LICENSE-MIT', sha256: '0f96a83840e146e43c0ec96a22ec1f392e0680e6c1226e6f3ba87e0740af850f' },
  { id: 'rust-llvm-exception', version: '1.99.1', sourcePin: 'rust:1.99.1/share/doc/rust/licenses/LLVM-exception.txt', source: 'rust', path: 'LLVM-exception.txt', sha256: 'e34c58338bd89d43e709e226610d8f32b3e3c47f4ad9a99a8dc1d4ac7842488e' },
  { id: 'rust-unicode', version: '1.99.1', sourcePin: 'rust:1.99.1/share/doc/rust/licenses/Unicode-3.0.txt', source: 'rust', path: 'Unicode-3.0.txt', sha256: 'f5062c9a188d81dfe66b56db4182dcf9e4b17c0d9b0d311a8e20b3a1b075c443' },
  { id: 'serde', version: '1.0.229', sourcePin: 'cargo:serde@1.0.229/LICENSE-MIT', source: 'cargo', path: 'serde-1.0.229/LICENSE-MIT', sha256: '23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3' },
  { id: 'svelte', version: '5.57.3', sourcePin: 'npm:svelte@5.57.3/LICENSE.md', source: 'svelte', path: 'LICENSE.md', sha256: '06257f4847b13a49a039efb17b944c141e71b12fd8d231b362d86919067d77a3' },
  { id: 'unicode-ident', version: '1.0.27', sourcePin: 'cargo:unicode-ident@1.0.27/LICENSE-UNICODE', source: 'cargo', path: 'unicode-ident-1.0.27/LICENSE-UNICODE', sha256: 'f7db81051789b729fea528a63ec4c938fdcb93d9d61d97dc8cc2e9df6d47f2a1' },
  { id: 'wasm-bindgen', version: '0.2.130', sourcePin: 'cargo:wasm-bindgen@0.2.130/LICENSE-MIT', source: 'cargo', path: 'wasm-bindgen-0.2.130/LICENSE-MIT', sha256: '378f5840b258e2779c39418f3f2d7b2ba96f1c7917dd6be0713f88305dbda397' },
  { id: 'wasm-bindgen-shared', version: '0.2.130', sourcePin: 'cargo:wasm-bindgen-shared@0.2.130/LICENSE-MIT', source: 'cargo', path: 'wasm-bindgen-shared-0.2.130/LICENSE-MIT', sha256: '378f5840b258e2779c39418f3f2d7b2ba96f1c7917dd6be0713f88305dbda397' },
] as const;
export const LICENSE_IDS = [...LICENSE_CATALOG.map(entry => entry.id), 'project'].sort();
const SHA = /^[a-f0-9]{64}$/;

/** These are source metadata checks, not consumer runtime-license recovery. */
export function validateLicenseSourceVersions(cargoLock: string, rustToolchain: string, webPackage: string): void {
  assert.ok(/^channel\s*=\s*"1\.99\.1"\s*$/m.test(rustToolchain), 'Rust license catalog must match the pinned toolchain');
  const pkg: unknown = JSON.parse(webPackage);
  record(pkg, 'Web license source metadata must be an object');
  record(pkg.devDependencies, 'Web license dependency pins are required');
  assert.ok(pkg.devDependencies.svelte === '5.57.3', 'Svelte license catalog must match the declared dependency');
  const packages = cargoLock.split('[[package]]').slice(1).map(block => ({
    name: /^name = "([^"]+)"$/m.exec(block)?.[1], version: /^version = "([^"]+)"$/m.exec(block)?.[1] }));
  for (const pinned of LICENSE_CATALOG) {
    if (pinned.source !== 'cargo') continue;
    const declared = packages.filter(pkg => pkg.name === pinned.id);
    assert.ok(declared.length === 1 && declared[0]!.version === pinned.version, 'Cargo license catalog must match the declared dependency versions');
  }
}
/** Preserve BOM and every original byte; replacement decoding is forbidden. */
export function losslessUtf8(bytes: Buffer): string {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('License/input text must be lossless UTF-8 (contents redacted)'); }
  assert.ok(Buffer.from(text, 'utf8').equals(bytes), 'License/input UTF-8 must round-trip exactly');
  return text;
}
function record(value: unknown, message: string): asserts value is Record<string, unknown> {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), message);
}
function fields(value: Record<string, unknown>, expected: readonly string[], message: string): void {
  assert.ok(JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected), message);
}
export function validateLicenseClosure(value: unknown, sourceDigests: Readonly<Record<string, string>>, sourceCommit: string): asserts value is LicenseClosure {
  record(value, 'License closure is required');
  fields(value, ['entries', 'sourcePins'], 'License closure fields are closed');
  record(value.sourcePins, 'License source pins are required');
  fields(value.sourcePins, LICENSE_SOURCE_PATHS, 'License source pin fields are closed');
  for (const path of LICENSE_SOURCE_PATHS) {
    assert.ok(typeof value.sourcePins[path] === 'string', 'License source pins differ from checked source digests');
    const sha: string = value.sourcePins[path];
    assert.ok(SHA.test(sha) && sha === sourceDigests[path], 'License source pins differ from checked source digests');
  }
  assert.ok(Array.isArray(value.entries), 'License entries are required');
  const ids: string[] = [];
  for (const entry of value.entries) {
    record(entry, 'License entry must be an object');
    fields(entry, ['id', 'sha256', 'sourcePin', 'text', 'version'], 'License entry fields are closed');
    assert.ok(typeof entry.id === 'string', 'License entry ID is invalid');
    ids.push(entry.id);
    assert.ok(typeof entry.text === 'string' && entry.text.length > 0, 'License text must be complete nonempty UTF-8');
    const bytes = Buffer.from(entry.text, 'utf8');
    assert.ok(losslessUtf8(bytes) === entry.text, 'License text contains invalid Unicode');
    assert.ok(typeof entry.sha256 === 'string' && SHA.test(entry.sha256) && digest(bytes) === entry.sha256, 'License text differs from its raw SHA256');
    if (entry.id === 'project') {
      assert.ok(entry.version === 'source' && entry.sourcePin === `git:${sourceCommit}:LICENSE`, 'Project license source identity differs');
      assert.ok(entry.sha256 === value.sourcePins.LICENSE, 'Project license text differs from checked source LICENSE');
    } else {
      const pinned = LICENSE_CATALOG.find(candidate => candidate.id === entry.id);
      assert.ok(pinned && entry.version === pinned.version && entry.sourcePin === pinned.sourcePin, 'License catalog version or source pin differs');
      if (pinned.source === 'asset') {
        assert.ok(entry.sha256 === pinned.sha256 && entry.sha256 === value.sourcePins[pinned.path],
          'Asset license text differs from the complete pinned checked source');
      } else {
        assert.ok(entry.sha256 === pinned.sha256, 'License text differs from the complete pinned runtime source');
      }
    }
  }
  assert.ok(JSON.stringify(ids) === JSON.stringify(LICENSE_IDS), 'License catalog IDs must be exact, sorted and unique');
}
