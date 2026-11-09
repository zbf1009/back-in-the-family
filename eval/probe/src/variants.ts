// Decision_Variants (R20.1, R20.8, DA-26, DA-27): the Model_Fingerprint of a derived `perm_avg` run. A `perm_avg`
// Combination sends nothing, so there is no Runtime handle to ask; every member comes from the two records of
// `combinations.json` (the `perm_avg` record and the `single` record it derives from) and from the pinned hashes.
import { WORKERS_AI_REVISION, WORKERS_AI_RUNTIME_VERSION } from './adapters/workers-ai.ts';
import { systemOneFingerprint } from './adapters/system-one.ts';
import { isSystemOne, type Combination } from './phase.ts';
import type { JsonObject, JsonValue } from './results.ts';

export interface DerivedFingerprintInput {
  /** The `perm_avg` record. */
  readonly permAvg: Combination;
  /** The `single` record named by `derives_from`. */
  readonly single: Combination;
  /** Template_Hash of the System_One_Mapping file (sha256 of its bytes). */
  readonly mappingHash: string;
  /** The Aggregation_Hash, the sha256 of the Aggregation_Rule file. */
  readonly aggregationHash: string;
  readonly ruleVersion: number;
  readonly pinnedManifestHash: string;
  /** sha256 of the sim-core WASM that computed the answer. */
  readonly simWasmSha256: string;
}

/**
 * Model_Fingerprint of a Derived_Run (DA-27): the members of the `single` fingerprint (`sampling` and
 * `chat_template_kwargs` as in the `single` record), plus `variant: "perm_avg"`, `derived: true`, the `aggregation` pin and
 * `template_hashes.aggregation` (R20.8: the Aggregation_Hash is a second member of the Combination's Template_Hash map, so
 * R3.10 and R3.12 compare it with no new code). A derived file has no Model_Key, so `model_key` is null.
 */
export function derivedFingerprint(i: DerivedFingerprintInput): JsonObject {
  if (!isSystemOne(i.single)) throw new Error(`${i.single.id} is not a "single" System_One record`);
  const s = (i.single['sampling'] ?? {}) as JsonValue;
  return {
    runtime: { name: i.single.runtime, version: WORKERS_AI_RUNTIME_VERSION },
    model: {
      id: i.single.model_id,
      revision: WORKERS_AI_REVISION,
      model_lib_url: typeof i.single['model_lib_url'] === 'string' ? i.single['model_lib_url'] : null,
      quantization: i.single.quantization,
    },
    model_key: null,
    sampling: JSON.parse(JSON.stringify(s)) as JsonValue,
    chat_template_kwargs: (i.single['chat_template_kwargs'] ?? null) as JsonValue,
    constraint: typeof i.single['constraint'] === 'string' ? i.single['constraint'] : 'none',
    template_hashes: { decision: i.mappingHash, aggregation: i.aggregationHash },
    warmup_hashes: {},
    renderer_version: null,
    sim_wasm_sha256: i.simWasmSha256,
    pinned_manifest_hash: i.pinnedManifestHash,
    browser: null,
    webgpu: null,
    ...systemOneFingerprint(i.single),
    variant: 'perm_avg',
    derived: true,
    aggregation: { rule_version: i.ruleVersion, hash: i.aggregationHash },
  };
}
