# LLM probe report

Generated on 2026-11-10 by `probe report` from the ledger, the Locked_Run Results and grades, the performance records, the failure, preflight, Exclusion and Smoke_Call records, `combinations.json` and the approvals on `HEAD`.
The Report recommends; it does not decide. Every Metric, interval and performance figure behind a mark or a recommendation comes from Locked_Run Results only (R15.2). This file names Card IDs, Contrast_Pair IDs and scenario-group counts only, and no card content.

## 1. Target_Machine, browser version and network conditions

Target_Machine: NVIDIA GeForce RTX 3050 Ti Laptop GPU (4,096 MiB VRAM, driver 615.78.08), Intel UHD Graphics (TigerLake-H GT1), Intel i7-11800H (16 threads), 15 GiB RAM, Linux, Chrome 155.

| Combination | Ledger entry | GPU used | WebGPU adapter (vendor / architecture / device / description) | Browser version | Measurement source |
| --- | --- | --- | --- | --- | --- |
| webllm/qwen3.5-0.8b-q4f32/nvidia | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | NVIDIA discrete GPU | nvidia / ampere / unknown / unknown | Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36 | headless |
| webllm/qwen3.5-2b-q4f32/nvidia | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | NVIDIA discrete GPU | nvidia / ampere / unknown / unknown | Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36 | headless |
| workers-ai/clef | L-20261110T015939Z-workers-ai-clef | not applicable (server side) | not applicable | not applicable | REST API from the local Probe_Runner |
| workers-ai/clef-flash | L-20261110T022013Z-workers-ai-clef-flash | not applicable (server side) | not applicable | not applicable | REST API from the local Probe_Runner |
| workers-ai/gemma-4-26b-a4b-it | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | not applicable (server side) | not applicable | not applicable | REST API from the local Probe_Runner |

- webllm/qwen3.5-0.8b-q4f32/nvidia (L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia): connection 4g; throttling none; measured download bandwidth 52.9 Mbit/s.
- webllm/qwen3.5-2b-q4f32/nvidia (L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia): connection 4g; throttling none; measured download bandwidth 36.06 Mbit/s.

Workers AI region or endpoint: not reported by the API.

## 2. Measurement plan

Phase_1 (in-browser Combinations): ended.

- Task_Type D (decision): no Combination passed in the browser.
- Task_Type S (synthesis): no Combination passed in the browser.

Phase_2 branch taken: **B** (Task_Type_Subset DS): exactly one Workers AI model is measured, for the Task_Types with no passing in-browser Combination.

Author's Phase_2 approval: P2-001, approved on 2026-11-08, branch B, approved model @cf/google/gemma-4-26b-a4b-it, Task_Type_Subset DS.

Phase_2 candidates tried: 5 (workers-ai/clef, workers-ai/clef-flash, workers-ai/clef-flash/perm_avg, workers-ai/clef/perm_avg, workers-ai/gemma-4-26b-a4b-it). A Workers AI Combination counts when it has a Dev_Run or Locked_Run Results file, or a ledger entry, made in Phase_2; a Combination with Smoke_Calls only, or whose Dev_Run the gate refused, does not count.

Several candidates were tried against the same Locked_Cards. This creates a selection bias through multiple comparisons. The Thresholds were not adjusted for it. A pass of the best of several candidates is weaker evidence than a pass of a single pre-chosen one.

The Decision_Variants were pre-registered on 2026-11-09, before any Decision_Model Dev_Run result was seen.
A `perm_avg` variant derived from the stored records of its `single` run is not an independent measurement: it re-reads the same requests and responses.

Additional_Candidate_Set (Decision_Models, Task_Type D only, each approved by the Author by name):

- workers-ai/clef-flash (Task_Type D only): approval IDs DM-001 (dev, 2026-11-09), DM-006 (locked, 2026-11-10); Locked_Run entry L-20261110T022013Z-workers-ai-clef-flash complete (its figures are in section 4). Repeat-request determinism of `choice` (V14): not tested.
- workers-ai/clef (Task_Type D only): approval IDs DM-003 (dev, 2026-11-09), DM-005 (locked, 2026-11-10); Locked_Run entry L-20261110T015939Z-workers-ai-clef complete (its figures are in section 4). Repeat-request determinism of `choice` (V14): not tested.
- workers-ai/clef-flash/perm_avg (Task_Type D only, variant perm_avg, derived from the stored records of workers-ai/clef-flash, 0 requests): approval IDs DM-002 (derive_dev, 2026-11-09), DM-007 (derive_locked, 2026-11-10); Derived_Run file(s): dev derived-dev-dev-20261109T151057Z-workers-ai-clef-flash-perm_avg-v1, locked derived-locked-L-20261110T022013Z-workers-ai-clef-flash-perm_avg-v1.
- workers-ai/clef/perm_avg (Task_Type D only, variant perm_avg, derived from the stored records of workers-ai/clef, 0 requests): approval IDs DM-004 (derive_dev, 2026-11-10), DM-008 (derive_locked, 2026-11-10); Derived_Run file(s): dev derived-dev-dev-20261109T152355Z-workers-ai-clef-perm_avg-v1, locked derived-locked-L-20261110T015939Z-workers-ai-clef-perm_avg-v1.

## 3. Candidates, size limits, pinned revisions and licenses

| Combination | Runtime / model / quantization | Pinned_Revision | Download | Parameters | VRAM need, MiB | License | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| webllm/qwen3.5-0.8b-q4f32/nvidia | webllm / Qwen3.5-0.8B-q4f32_1-MLC / q4f32_1 | 4ed017713f04c91ffe55a9dca8c7ac853c41314d | 426.5 MiB (published); measured 416.8 MiB | 873438784 | 1894.19 | Apache-2.0 (OSI-approved); https://huggingface.co/Qwen/Qwen3.5-0.8B; this is the base model's license; the conversion repository Qwen3.5-0.8B-q4f32_1-MLC declares no license | measured |
| webllm/qwen3.5-0.8b-q4f32/intel | webllm / Qwen3.5-0.8B-q4f32_1-MLC / q4f32_1 | 4ed017713f04c91ffe55a9dca8c7ac853c41314d | 426.5 MiB (published) | 873438784 | 1894.19 | Apache-2.0 (OSI-approved); https://huggingface.co/Qwen/Qwen3.5-0.8B; this is the base model's license; the conversion repository Qwen3.5-0.8B-q4f32_1-MLC declares no license | not run |
| webllm/qwen3.5-2b-q4f32/nvidia | webllm / Qwen3.5-2B-q4f32_1-MLC / q4f32_1 | d835e5c41aa56174d915e8a3940cde599d3f5a30 | 1032.4 MiB (published); measured 1023.1 MiB | 2274069824 | 2591.55 | Apache-2.0 (OSI-approved); https://huggingface.co/Qwen/Qwen3.5-2B; this is the base model's license; the conversion repository Qwen3.5-2B-q4f32_1-MLC declares no license | measured |
| transformers.js/qwen3.5-0.8b-q4/nvidia | transformers.js / onnx-community/Qwen3.5-0.8B-ONNX / q4 | 8fe9dbe3fb39fe902e18df9be84b6a0ac77ae0f6 | 637.5 MiB (published) | 873438784 | 2128 (VRAM_Preflight peak) | Apache-2.0 (OSI-approved); https://huggingface.co/onnx-community/Qwen3.5-0.8B-ONNX | excluded (preflight_vram) |
| transformers.js/qwen3.5-2b-q4/nvidia | transformers.js / onnx-community/Qwen3.5-2B-ONNX / q4 | 315216e893038beefcc6eba41ac168913dd0d879 | 1483.0 MiB (published) | 2274069824 | 3090 (VRAM_Preflight peak) | Apache-2.0 (OSI-approved); https://huggingface.co/Qwen/Qwen3.5-2B; this is the base model's license; the conversion repository onnx-community/Qwen3.5-2B-ONNX declares no license | excluded (preflight_vram) |
| transformers.js/lfm2.5-1.2b-instruct-q4/nvidia | transformers.js / LiquidAI/LFM2.5-1.2B-Instruct-ONNX / q4 | 10f72e70abf67ac0fd7ebf15bc5854726891d864 | 814.0 MiB (published) | 1170340608 | 2675 (VRAM_Preflight peak) | LFM Open License v1.0 — custom license, not OSI-approved; https://huggingface.co/LiquidAI/LFM2.5-1.2B-Instruct-ONNX/blob/main/LICENSE; accepted by the Author on 2026-11-06 | excluded (preflight_vram) |
| workers-ai/gemma-4-26b-a4b-it | workers-ai / @cf/google/gemma-4-26b-a4b-it | server-side, not pinnable | not applicable | not applicable | not applicable | Apache-2.0 (OSI-approved); https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/ | measured |
| workers-ai/glm-4.7-flash | workers-ai / @cf/zai-org/glm-4.7-flash | server-side, not pinnable | not applicable | not applicable | not applicable | MIT (OSI-approved); https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/ | not run |
| workers-ai/granite-4.0-h-micro | workers-ai / @cf/ibm-granite/granite-4.0-h-micro | server-side, not pinnable | not applicable | not applicable | not applicable | Apache-2.0 (OSI-approved); https://developers.cloudflare.com/workers-ai/models/granite-4.0-h-micro/ | not run |
| workers-ai/clef-flash | workers-ai / @cf/cloudflare/clef-flash | server-side, not pinnable | not applicable | not applicable | not applicable | Apache-2.0 (OSI-approved); https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/ | measured |
| workers-ai/clef | workers-ai / @cf/cloudflare/clef | server-side, not pinnable | not applicable | not applicable | not applicable | Apache-2.0 (OSI-approved); https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/ | measured |

Sources of the figures above:

- webllm/qwen3.5-0.8b-q4f32/nvidia: download source Hugging Face API tree at `revision`, summed by `probe screen` (read on 2026-11-07); measured again at Locked_Run start (R14.5); tree listing https://huggingface.co/api/models/mlc-ai/Qwen3.5-0.8B-q4f32_1-MLC/tree/4ed017713f04c91ffe55a9dca8c7ac853c41314d; parameters source https://huggingface.co/api/models/Qwen/Qwen3.5-0.8B; VRAM source https://github.com/mlc-ai/web-llm/blob/main/src/config.ts; GPU NVIDIA discrete GPU.
- webllm/qwen3.5-0.8b-q4f32/intel: download source Hugging Face API tree at `revision`, summed by `probe screen` (read on 2026-11-07); measured again at Locked_Run start (R14.5); tree listing https://huggingface.co/api/models/mlc-ai/Qwen3.5-0.8B-q4f32_1-MLC/tree/4ed017713f04c91ffe55a9dca8c7ac853c41314d; parameters source https://huggingface.co/api/models/Qwen/Qwen3.5-0.8B; VRAM source https://github.com/mlc-ai/web-llm/blob/main/src/config.ts; GPU Intel integrated GPU.
- webllm/qwen3.5-2b-q4f32/nvidia: download source Hugging Face API tree at `revision`, summed by `probe screen` (read on 2026-11-07); measured again at Locked_Run start (R14.5); tree listing https://huggingface.co/api/models/mlc-ai/Qwen3.5-2B-q4f32_1-MLC/tree/d835e5c41aa56174d915e8a3940cde599d3f5a30; parameters source https://huggingface.co/api/models/Qwen/Qwen3.5-2B; VRAM source https://github.com/mlc-ai/web-llm/blob/main/src/config.ts; GPU NVIDIA discrete GPU.
- transformers.js/qwen3.5-0.8b-q4/nvidia: download source Hugging Face API tree at `revision`, q4 text path, summed by `probe screen` (design DA-1 read about 619 MiB on 2026-11-06); measured again at Locked_Run start (R14.5); tree listing https://huggingface.co/api/models/onnx-community/Qwen3.5-0.8B-ONNX/tree/8fe9dbe3fb39fe902e18df9be84b6a0ac77ae0f6; parameters source https://huggingface.co/api/models/Qwen/Qwen3.5-0.8B; VRAM source VRAM_Preflight on the Target_Machine; GPU NVIDIA discrete GPU.
- transformers.js/qwen3.5-2b-q4/nvidia: download source Hugging Face API tree at `revision`, q4 text path, summed by `probe screen` (design DA-1 read about 1465 MiB on 2026-11-06); measured again at Locked_Run start (R14.5); tree listing https://huggingface.co/api/models/onnx-community/Qwen3.5-2B-ONNX/tree/315216e893038beefcc6eba41ac168913dd0d879; parameters source https://huggingface.co/api/models/Qwen/Qwen3.5-2B; VRAM source VRAM_Preflight on the Target_Machine; GPU NVIDIA discrete GPU.
- transformers.js/lfm2.5-1.2b-instruct-q4/nvidia: download source Hugging Face API tree at `revision`, q4 text path, summed by `probe screen` (design DA-1 read about 811 MiB on 2026-11-06); measured again at Locked_Run start (R14.5); tree listing https://huggingface.co/api/models/LiquidAI/LFM2.5-1.2B-Instruct-ONNX/tree/10f72e70abf67ac0fd7ebf15bc5854726891d864; parameters source https://huggingface.co/api/models/LiquidAI/LFM2.5-1.2B-Instruct; VRAM source VRAM_Preflight on the Target_Machine; GPU NVIDIA discrete GPU.
- workers-ai/gemma-4-26b-a4b-it: Workers AI model, license Apache-2.0 (OSI-approved); https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/; prices 9091/27273 neurons per million tokens (https://developers.cloudflare.com/workers-ai/platform/pricing/, read on 2026-11-06).
- workers-ai/glm-4.7-flash: Workers AI model, license MIT (OSI-approved); https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/; prices 5500/36400 neurons per million tokens (https://developers.cloudflare.com/workers-ai/platform/pricing/, read on 2026-11-06).
- workers-ai/granite-4.0-h-micro: Workers AI model, license Apache-2.0 (OSI-approved); https://developers.cloudflare.com/workers-ai/models/granite-4.0-h-micro/; prices 1542/10158 neurons per million tokens (https://developers.cloudflare.com/workers-ai/platform/pricing/, read on 2026-11-06).
- workers-ai/clef-flash: Workers AI model, license Apache-2.0 (OSI-approved); https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/; prices 3455/0 neurons per million tokens (https://developers.cloudflare.com/workers-ai/platform/pricing/, read on 2026-11-09).
- workers-ai/clef: Workers AI model, license Apache-2.0 (OSI-approved); https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/; prices 21818/0 neurons per million tokens (https://developers.cloudflare.com/workers-ai/platform/pricing/, read on 2026-11-09).

Runtime libraries:

- @mlc-ai/web-llm 0.2.87: Apache-2.0 (OSI-approved; stated in the package.json of the installed package) (https://github.com/mlc-ai/web-llm)
- @huggingface/transformers 4.3.2: Apache-2.0 (OSI-approved; stated in the package.json of the installed package) (https://github.com/huggingface/transformers.js)
- @huggingface/transformers-structured-output 4.3.2: Apache-2.0 (OSI-approved; as listed in README.md) (https://www.npmjs.com/package/@huggingface/transformers-structured-output)
- onnxruntime-web 1.31.0-dev.20260914-8d85527a0: MIT (OSI-approved; stated in the package.json of the installed package; pulled in by @huggingface/transformers) (https://github.com/microsoft/onnxruntime)

### Excluded candidates

- transformers.js/qwen3.5-0.8b-q4/nvidia (onnx-community/Qwen3.5-0.8B-ONNX): VRAM_Preflight peak VRAM (MiB): value out_of_memory, limit 2600 (2026-11-07T11:59:00.635Z). A terminal Phase_1 state; never a passing in-browser Combination.
- transformers.js/qwen3.5-2b-q4/nvidia (onnx-community/Qwen3.5-2B-ONNX): VRAM_Preflight peak VRAM (MiB): value out_of_memory, limit 2600 (2026-11-07T12:23:40.884Z). A terminal Phase_1 state; never a passing in-browser Combination.
- transformers.js/lfm2.5-1.2b-instruct-q4/nvidia (LiquidAI/LFM2.5-1.2B-Instruct-ONNX): VRAM_Preflight peak VRAM (MiB): value 2675, limit 2600 (2026-11-07T12:30:21.146Z). A terminal Phase_1 state; never a passing in-browser Combination.

### VRAM_Preflight findings and their limits

- Both Qwen3.5 ONNX exports (0.8B and 2B, q4) run out of GPU memory in the prefill step (new_tokens = 0, `vkAllocateMemory` returned `VK_ERROR_OUT_OF_DEVICE_MEMORY`) on transformers.js 4.3.2 with onnxruntime-web 1.31.0-dev.20260914-8d85527a0, on the 4,096 MiB RTX 3050 Ti, with the 9.4 KB VRAM_Preflight prompt. Their Exclusion_Records carry the reason `out_of_memory`, not a peak above 2,600 MiB.
- The peak figures of those two runs are readings at the moment of the crash, not complete peaks: 2,128 MiB (0.8B, delta over a 44 MiB baseline; 2,172 MiB absolute) and 3,090 MiB (2B, delta over a 46 MiB baseline; 3,136 MiB absolute). The 2B figure being above 2,600 MiB is not the reason for its exclusion.
- This is not a matter of model size: the larger LFM2.5-1.2B-Instruct runs the same preflight to the end (1,024 tokens, peak 2,675 MiB). It stays excluded because 2,675 MiB is above the 2,600 MiB limit, which was not relaxed.
- Clue: the placement log shows that both Qwen3.5 exports put 18 gated-delta-net `Scan` nodes on the CPU, so every step needs a CPU to GPU copy.
- Per the Author, onnxruntime already has a WebGPU LinearAttention fused operator for Qwen3.5, but these exports do not use it. The Report has not verified this statement independently.
- The exclusion conclusion does not change. It covers the Qwen3.5 ONNX exports on transformers.js with this onnxruntime-web build only. The browser-side conclusion covers only the Qwen3.5 family on WebLLM; it does not represent all in-browser models.
- Intel iGPU memory is the GPU process peak RSS. It excludes unmapped GEM buffers and is a different quantity from the NVIDIA device memory.used delta. The two are never compared and never share a column in this Report.
- Prompt-length diagnosis (Report only; no Exclusion_Record was written or changed from it): Qwen3.5-0.8B (transformers.js, NVIDIA) was run again with prompts built from Dev_Cards only. A 1,560-byte prompt completed all 1,024 tokens (no OOM, peak 1,392 MiB). The longest Dev_Card prompt, 4,689 bytes, also completed all 1,024 tokens (no OOM, peak 2,726 MiB, above the 2,600 MiB limit). The 9.4 KB preflight prompt ran out of memory in prefill. So the failure depends on prompt length, and the memory peak grows steeply with it. The raw records are in `eval/results/preflight/diagnosis/`. The VRAM_Preflight rule (R9.16) fixes the prompt, so the Exclusion_Record stands.

## 4. Locked_Run Metrics per Combination and Task_Type

### webllm/qwen3.5-0.8b-q4f32/nvidia, Task_Type D (decision), entry L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia

Mark: **fail**. Scenario groups: 38. Scored non-void cards: 60.

| Metric | Numerator / denominator | Value | Threshold | Mark |
| --- | --- | --- | --- | --- |
| Acceptable rate | 35/60 | 58.3% (Random_Baseline 51.8%) | at least 80% | fail |
| Severe count (base Permutation of each card) | 8 of 60 cards | 8 | at most 1 | fail |
| Severe outputs in other Permutations | 21 of 172 non-base requests | 21 | none (no verdict) | reported only |
| Flip rate (non-base requests with an output, Illegal and timeouts included) | 81/172 | 47.1% | at most 5% | fail |
| Contrast consistency | 0/15 pairs | 0.0% | at least 80% | fail |
| Illegal rate | 0/60 | 0.0% | none (no verdict) | reported only |

| Quantity | Cluster_Bootstrap 95% (10,000 resamples, seed 20261104) | Wilson 95% | Intra-group correlation |
| --- | --- | --- | --- |
| Acceptable rate | 48.3% to 68.3% | 45.7% to 69.9% | -0.480 |
| Illegal rate | 0.0% to 0.0% | 0.0% to 6.0% | not estimable (zero variance) |
| Contrast consistency (pair bootstrap) | 0.0% to 0.0% | not reported | not applicable |

Random_Baseline next to the D acceptable rate: 51.8%.

- Locked_Run D, request level: acceptable 142/236 (60.2%) against a random baseline of 51.8% (expected 122.3 of 236); Scored_Cards' requests only: 140/232 (60.3%) against 51.8%. Illegal requests: 0.
- Locked_Run D, shuffle: 81 of 172 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 60 cards with at least two valid picks, 22 kept the same option in every order and 2 kept the same shown position in every order.
- Locked_Run D, 2-option cards, 12 valid picks: by original position 6 / 6; by shown position 4 / 8 (uniform would be 6.0 each).
- Locked_Run D, 3-option cards, 36 valid picks: by original position 27 / 4 / 5; by shown position 9 / 10 / 17 (uniform would be 12.0 each).
- Locked_Run D, 4-option cards, 120 valid picks: by original position 40 / 21 / 26 / 33; by shown position 18 / 24 / 38 / 40 (uniform would be 30.0 each).
- Locked_Run D, 5-option cards, 68 valid picks: by original position 18 / 15 / 9 / 8 / 18; by shown position 8 / 13 / 10 / 15 / 22 (uniform would be 13.6 each).

CPU-placed nodes (placement detection: webllm_model_lib): none.

### webllm/qwen3.5-0.8b-q4f32/nvidia, Task_Type S (synthesis), entry L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia

Mark: **fail**. Scenario groups: 24. Scored non-void cards: 40.

| Metric | Numerator / denominator | Value | Threshold | Mark |
| --- | --- | --- | --- | --- |
| Acceptable rate | 7/40 | 17.5% | at least 80% | fail |
| Severe count (base Permutation of each card) | 4 of 40 cards | 4 | at most 1 | fail |
| Severe outputs in other Permutations | 6 of 44 non-base requests | 6 | none (no verdict) | reported only |
| Flip rate (non-base requests with an output, Illegal and timeouts included) | 11/44 | 25.0% | at most 5% | fail |
| Contrast consistency | 0/10 pairs | 0.0% | at least 80% | fail |
| Illegal rate | 10/40 | 25.0% | none (no verdict) | reported only |

| Quantity | Cluster_Bootstrap 95% (10,000 resamples, seed 20261104) | Wilson 95% | Intra-group correlation |
| --- | --- | --- | --- |
| Acceptable rate | 7.5% to 28.6% | 8.7% to 32.0% | -0.273 |
| Illegal rate | 9.5% to 42.1% | 14.2% to 40.2% | 0.680 |
| Contrast consistency (pair bootstrap) | 0.0% to 0.0% | not reported | not applicable |

CPU-placed nodes (placement detection: webllm_model_lib): none.

### webllm/qwen3.5-2b-q4f32/nvidia, Task_Type D (decision), entry L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia

Mark: **fail**. Scenario groups: 38. Scored non-void cards: 60.

| Metric | Numerator / denominator | Value | Threshold | Mark |
| --- | --- | --- | --- | --- |
| Acceptable rate | 36/60 | 60.0% (Random_Baseline 51.8%) | at least 80% | fail |
| Severe count (base Permutation of each card) | 3 of 60 cards | 3 | at most 1 | fail |
| Severe outputs in other Permutations | 15 of 172 non-base requests | 15 | none (no verdict) | reported only |
| Flip rate (non-base requests with an output, Illegal and timeouts included) | 72/172 | 41.9% | at most 5% | fail |
| Contrast consistency | 0/15 pairs | 0.0% | at least 80% | fail |
| Illegal rate | 2/60 | 3.3% | none (no verdict) | reported only |

| Quantity | Cluster_Bootstrap 95% (10,000 resamples, seed 20261104) | Wilson 95% | Intra-group correlation |
| --- | --- | --- | --- |
| Acceptable rate | 47.5% to 72.1% | 47.4% to 71.4% | -0.025 |
| Illegal rate | 0.0% to 8.3% | 0.9% to 11.4% | -0.394 |
| Contrast consistency (pair bootstrap) | 0.0% to 0.0% | not reported | not applicable |

Random_Baseline next to the D acceptable rate: 51.8%.

- Locked_Run D, request level: acceptable 148/236 (62.7%) against a random baseline of 51.8% (expected 122.3 of 236); Scored_Cards' requests only: 145/232 (62.5%) against 51.8%. Illegal requests: 10.
- Locked_Run D, shuffle: 62 of 160 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 57 cards with at least two valid picks, 20 kept the same option in every order and 4 kept the same shown position in every order.
- Locked_Run D, 2-option cards, 11 valid picks: by original position 5 / 6; by shown position 4 / 7 (uniform would be 5.5 each).
- Locked_Run D, 3-option cards, 36 valid picks: by original position 17 / 13 / 6; by shown position 5 / 15 / 16 (uniform would be 12.0 each).
- Locked_Run D, 4-option cards, 111 valid picks: by original position 24 / 27 / 24 / 36; by shown position 16 / 35 / 31 / 29 (uniform would be 27.8 each).
- Locked_Run D, 5-option cards, 68 valid picks: by original position 4 / 8 / 17 / 27 / 12; by shown position 5 / 24 / 18 / 11 / 10 (uniform would be 13.6 each).

CPU-placed nodes (placement detection: webllm_model_lib): none.

### webllm/qwen3.5-2b-q4f32/nvidia, Task_Type S (synthesis), entry L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia

Mark: **fail**. Scenario groups: 24. Scored non-void cards: 40.

| Metric | Numerator / denominator | Value | Threshold | Mark |
| --- | --- | --- | --- | --- |
| Acceptable rate | 0/40 | 0.0% | at least 80% | fail |
| Severe count (base Permutation of each card) | 2 of 40 cards | 2 | at most 1 | fail |
| Severe outputs in other Permutations | 2 of 44 non-base requests | 2 | none (no verdict) | reported only |
| Flip rate (non-base requests with an output, Illegal and timeouts included) | 3/44 | 6.8% | at most 5% | fail |
| Contrast consistency | 0/10 pairs | 0.0% | at least 80% | fail |
| Illegal rate | 38/40 | 95.0% | none (no verdict) | reported only |

| Quantity | Cluster_Bootstrap 95% (10,000 resamples, seed 20261104) | Wilson 95% | Intra-group correlation |
| --- | --- | --- | --- |
| Acceptable rate | 0.0% to 0.0% | 0.0% to 8.8% | not estimable (zero variance) |
| Illegal rate | 87.5% to 100.0% | 83.5% to 98.6% | -0.291 |
| Contrast consistency (pair bootstrap) | 0.0% to 0.0% | not reported | not applicable |

CPU-placed nodes (placement detection: webllm_model_lib): none.

### workers-ai/clef, Task_Type D (decision), entry L-20261110T015939Z-workers-ai-clef

Mark: **fail**. Scenario groups: 38. Scored non-void cards: 60.

| Metric | Numerator / denominator | Value | Threshold | Mark |
| --- | --- | --- | --- | --- |
| Acceptable rate | 51/60 | 85.0% (Random_Baseline 51.8%) | at least 80% | pass (point estimate; 95% Cluster_Bootstrap lower bound 76.4% < 80%) |
| Severe count (base Permutation of each card) | 1 of 60 cards | 1 | at most 1 | pass |
| Severe outputs in other Permutations | 3 of 172 non-base requests | 3 | none (no verdict) | reported only |
| Flip rate (non-base requests with an output, Illegal and timeouts included) | 0/172 | 0.0% | at most 5% | pass |
| Contrast consistency | 4/15 pairs | 26.7% | at least 80% | fail |
| Illegal rate | 0/60 | 0.0% | none (no verdict) | reported only |

| Quantity | Cluster_Bootstrap 95% (10,000 resamples, seed 20261104) | Wilson 95% | Intra-group correlation |
| --- | --- | --- | --- |
| Acceptable rate | 76.4% to 93.1% | 73.9% to 91.9% | -0.230 |
| Illegal rate | 0.0% to 0.0% | 0.0% to 6.0% | not estimable (zero variance) |
| Contrast consistency (pair bootstrap) | 6.7% to 53.3% | not reported | not applicable |

Random_Baseline next to the D acceptable rate: 51.8%.

- Locked_Run D, request level: acceptable 200/236 (84.7%) against a random baseline of 51.8% (expected 122.3 of 236); Scored_Cards' requests only: 196/232 (84.5%) against 51.8%. Illegal requests: 0.
- Locked_Run D, shuffle: 0 of 172 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 60 cards with at least two valid picks, 60 kept the same option in every order and 0 kept the same shown position in every order.
- Locked_Run D, 2-option cards, 12 valid picks: by original position 8 / 4; by shown position 8 / 4 (uniform would be 6.0 each).
- Locked_Run D, 3-option cards, 36 valid picks: by original position 12 / 16 / 8; by shown position 11 / 13 / 12 (uniform would be 12.0 each).
- Locked_Run D, 4-option cards, 120 valid picks: by original position 32 / 16 / 48 / 24; by shown position 30 / 34 / 30 / 26 (uniform would be 30.0 each).
- Locked_Run D, 5-option cards, 68 valid picks: by original position 4 / 8 / 16 / 12 / 28; by shown position 14 / 12 / 18 / 13 / 11 (uniform would be 13.6 each).

CPU-placed nodes (placement detection: not applicable): none.

### workers-ai/clef-flash, Task_Type D (decision), entry L-20261110T022013Z-workers-ai-clef-flash

Mark: **fail**. Scenario groups: 38. Scored non-void cards: 60.

| Metric | Numerator / denominator | Value | Threshold | Mark |
| --- | --- | --- | --- | --- |
| Acceptable rate | 47/60 | 78.3% (Random_Baseline 51.8%) | at least 80% | fail |
| Severe count (base Permutation of each card) | 0 of 60 cards | 0 | at most 1 | pass |
| Severe outputs in other Permutations | 0 of 172 non-base requests | 0 | none (no verdict) | reported only |
| Flip rate (non-base requests with an output, Illegal and timeouts included) | 0/172 | 0.0% | at most 5% | pass |
| Contrast consistency | 3/15 pairs | 20.0% | at least 80% | fail |
| Illegal rate | 0/60 | 0.0% | none (no verdict) | reported only |

| Quantity | Cluster_Bootstrap 95% (10,000 resamples, seed 20261104) | Wilson 95% | Intra-group correlation |
| --- | --- | --- | --- |
| Acceptable rate | 68.3% to 87.9% | 66.4% to 86.9% | -0.188 |
| Illegal rate | 0.0% to 0.0% | 0.0% to 6.0% | not estimable (zero variance) |
| Contrast consistency (pair bootstrap) | 0.0% to 40.0% | not reported | not applicable |

Random_Baseline next to the D acceptable rate: 51.8%.

- Locked_Run D, request level: acceptable 186/236 (78.8%) against a random baseline of 51.8% (expected 122.3 of 236); Scored_Cards' requests only: 182/232 (78.4%) against 51.8%. Illegal requests: 0.
- Locked_Run D, shuffle: 0 of 172 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 60 cards with at least two valid picks, 60 kept the same option in every order and 0 kept the same shown position in every order.
- Locked_Run D, 2-option cards, 12 valid picks: by original position 6 / 6; by shown position 8 / 4 (uniform would be 6.0 each).
- Locked_Run D, 3-option cards, 36 valid picks: by original position 12 / 8 / 16; by shown position 13 / 11 / 12 (uniform would be 12.0 each).
- Locked_Run D, 4-option cards, 120 valid picks: by original position 28 / 20 / 44 / 28; by shown position 30 / 34 / 30 / 26 (uniform would be 30.0 each).
- Locked_Run D, 5-option cards, 68 valid picks: by original position 4 / 16 / 12 / 20 / 16; by shown position 12 / 17 / 15 / 14 / 10 (uniform would be 13.6 each).

CPU-placed nodes (placement detection: not applicable): none.

### workers-ai/gemma-4-26b-a4b-it, Task_Type D (decision), entry L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it

Mark: **fail**. Scenario groups: 38. Scored non-void cards: 60.

| Metric | Numerator / denominator | Value | Threshold | Mark |
| --- | --- | --- | --- | --- |
| Acceptable rate | 51/60 | 85.0% (Random_Baseline 51.8%) | at least 80% | pass (point estimate; 95% Cluster_Bootstrap lower bound 76.9% < 80%) |
| Severe count (base Permutation of each card) | 2 of 60 cards | 2 | at most 1 | fail |
| Severe outputs in other Permutations | 9 of 172 non-base requests | 9 | none (no verdict) | reported only |
| Flip rate (non-base requests with an output, Illegal and timeouts included) | 36/172 | 20.9% | at most 5% | fail |
| Contrast consistency | 3/15 pairs | 20.0% | at least 80% | fail |
| Illegal rate | 0/60 | 0.0% | none (no verdict) | reported only |

| Quantity | Cluster_Bootstrap 95% (10,000 resamples, seed 20261104) | Wilson 95% | Intra-group correlation |
| --- | --- | --- | --- |
| Acceptable rate | 76.9% to 93.1% | 73.9% to 91.9% | -0.409 |
| Illegal rate | 0.0% to 0.0% | 0.0% to 6.0% | not estimable (zero variance) |
| Contrast consistency (pair bootstrap) | 0.0% to 40.0% | not reported | not applicable |

Random_Baseline next to the D acceptable rate: 51.8%.

- Locked_Run D, request level: acceptable 194/236 (82.2%) against a random baseline of 51.8% (expected 122.3 of 236); Scored_Cards' requests only: 190/232 (81.9%) against 51.8%. Illegal requests: 1.
- Locked_Run D, shuffle: 35 of 171 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 60 cards with at least two valid picks, 38 kept the same option in every order and 0 kept the same shown position in every order.
- Locked_Run D, 2-option cards, 12 valid picks: by original position 8 / 4; by shown position 8 / 4 (uniform would be 6.0 each).
- Locked_Run D, 3-option cards, 35 valid picks: by original position 10 / 14 / 11; by shown position 10 / 15 / 10 (uniform would be 11.7 each).
- Locked_Run D, 4-option cards, 120 valid picks: by original position 34 / 9 / 53 / 24; by shown position 28 / 33 / 29 / 30 (uniform would be 30.0 each).
- Locked_Run D, 5-option cards, 68 valid picks: by original position 6 / 12 / 18 / 11 / 21; by shown position 8 / 12 / 17 / 20 / 11 (uniform would be 13.6 each).

CPU-placed nodes (placement detection: not applicable): none.

### workers-ai/gemma-4-26b-a4b-it, Task_Type S (synthesis), entry L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it

Mark: **fail**. Scenario groups: 24. Scored non-void cards: 40.

| Metric | Numerator / denominator | Value | Threshold | Mark |
| --- | --- | --- | --- | --- |
| Acceptable rate | 34/40 | 85.0% | at least 80% | pass (point estimate; 95% Cluster_Bootstrap lower bound 74.4% < 80%) |
| Severe count (base Permutation of each card) | 0 of 40 cards | 0 | at most 1 | pass |
| Severe outputs in other Permutations | 1 of 44 non-base requests | 1 | none (no verdict) | reported only |
| Flip rate (non-base requests with an output, Illegal and timeouts included) | 10/44 | 22.7% | at most 5% | fail |
| Contrast consistency | 6/10 pairs | 60.0% | at least 80% | fail |
| Illegal rate | 0/40 | 0.0% | none (no verdict) | reported only |

| Quantity | Cluster_Bootstrap 95% (10,000 resamples, seed 20261104) | Wilson 95% | Intra-group correlation |
| --- | --- | --- | --- |
| Acceptable rate | 74.4% to 94.9% | 70.9% to 92.9% | -0.200 |
| Illegal rate | 0.0% to 0.0% | 0.0% to 8.8% | not estimable (zero variance) |
| Contrast consistency (pair bootstrap) | 30.0% to 90.0% | not reported | not applicable |

CPU-placed nodes (placement detection: not applicable): none.

### workers-ai/clef/perm_avg, Task_Type D (decision), derived run derived-locked-L-20261110T015939Z-workers-ai-clef-perm_avg-v1

Mark: **fail**. Scenario groups: 38. Scored non-void cards: 60.

| Metric | Numerator / denominator | Value | Threshold | Mark |
| --- | --- | --- | --- | --- |
| Acceptable rate | 51/60 | 85.0% (Random_Baseline 51.8%) | at least 80% | pass (point estimate; 95% Cluster_Bootstrap lower bound 76.4% < 80%) |
| Severe count (base Permutation of each card) | 1 of 60 cards | 1 | at most 1 | pass |
| Severe outputs in other Permutations | not applicable | 0 | none (no verdict) | reported only |
| Flip rate (non-base requests with an output, Illegal and timeouts included) | guaranteed by construction (not measured) | not applicable | none (no verdict) | by construction (not measured) |
| Contrast consistency | 4/15 pairs | 26.7% | at least 80% | fail |
| Illegal rate | 0/60 | 0.0% | none (no verdict) | reported only |

| Quantity | Cluster_Bootstrap 95% (10,000 resamples, seed 20261104) | Wilson 95% | Intra-group correlation |
| --- | --- | --- | --- |
| Acceptable rate | 76.4% to 93.1% | 73.9% to 91.9% | -0.230 |
| Illegal rate | 0.0% to 0.0% | 0.0% to 6.0% | not estimable (zero variance) |
| Contrast consistency (pair bootstrap) | 6.7% to 53.3% | not reported | not applicable |

Random_Baseline next to the D acceptable rate: 51.8%.

- Locked_Run D, request level: acceptable 55/64 (85.9%) against a random baseline of 51.7% (expected 33.1 of 64); Scored_Cards' requests only: 51/60 (85.0%) against 51.8%. Illegal requests: 0.
- Locked_Run D, shuffle: 0 of 0 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 0 cards with at least two valid picks, 0 kept the same option in every order and 0 kept the same shown position in every order.
- Locked_Run D, 2-option cards, 8 valid picks: by original position 6 / 2; by shown position 6 / 2 (uniform would be 4.0 each).
- Locked_Run D, 3-option cards, 9 valid picks: by original position 3 / 4 / 2; by shown position 3 / 4 / 2 (uniform would be 3.0 each).
- Locked_Run D, 4-option cards, 30 valid picks: by original position 8 / 4 / 12 / 6; by shown position 8 / 4 / 12 / 6 (uniform would be 7.5 each).
- Locked_Run D, 5-option cards, 17 valid picks: by original position 1 / 2 / 4 / 3 / 7; by shown position 1 / 2 / 4 / 3 / 7 (uniform would be 3.4 each).

CPU-placed nodes (placement detection: not applicable): none.

Derived from the stored records of `workers-ai/clef`, ledger entry L-20261110T015939Z-workers-ai-clef, source Results sha256 1336462500e8b79ae263256aa3890f4669e38c2e490cd4032e38f091b304489c; no request was sent for it; the guarantee holds for the set of Variant_Permutations that the variant averages and is not a measurement of position bias; this is not an independent measurement from the `single` run.

### workers-ai/clef-flash/perm_avg, Task_Type D (decision), derived run derived-locked-L-20261110T022013Z-workers-ai-clef-flash-perm_avg-v1

Mark: **fail**. Scenario groups: 38. Scored non-void cards: 60.

| Metric | Numerator / denominator | Value | Threshold | Mark |
| --- | --- | --- | --- | --- |
| Acceptable rate | 47/60 | 78.3% (Random_Baseline 51.8%) | at least 80% | fail |
| Severe count (base Permutation of each card) | 0 of 60 cards | 0 | at most 1 | pass |
| Severe outputs in other Permutations | not applicable | 0 | none (no verdict) | reported only |
| Flip rate (non-base requests with an output, Illegal and timeouts included) | guaranteed by construction (not measured) | not applicable | none (no verdict) | by construction (not measured) |
| Contrast consistency | 3/15 pairs | 20.0% | at least 80% | fail |
| Illegal rate | 0/60 | 0.0% | none (no verdict) | reported only |

| Quantity | Cluster_Bootstrap 95% (10,000 resamples, seed 20261104) | Wilson 95% | Intra-group correlation |
| --- | --- | --- | --- |
| Acceptable rate | 68.3% to 87.9% | 66.4% to 86.9% | -0.188 |
| Illegal rate | 0.0% to 0.0% | 0.0% to 6.0% | not estimable (zero variance) |
| Contrast consistency (pair bootstrap) | 0.0% to 40.0% | not reported | not applicable |

Random_Baseline next to the D acceptable rate: 51.8%.

- Locked_Run D, request level: acceptable 51/64 (79.7%) against a random baseline of 51.7% (expected 33.1 of 64); Scored_Cards' requests only: 47/60 (78.3%) against 51.8%. Illegal requests: 0.
- Locked_Run D, shuffle: 0 of 0 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 0 cards with at least two valid picks, 0 kept the same option in every order and 0 kept the same shown position in every order.
- Locked_Run D, 2-option cards, 8 valid picks: by original position 5 / 3; by shown position 5 / 3 (uniform would be 4.0 each).
- Locked_Run D, 3-option cards, 9 valid picks: by original position 3 / 2 / 4; by shown position 3 / 2 / 4 (uniform would be 3.0 each).
- Locked_Run D, 4-option cards, 30 valid picks: by original position 7 / 5 / 11 / 7; by shown position 7 / 5 / 11 / 7 (uniform would be 7.5 each).
- Locked_Run D, 5-option cards, 17 valid picks: by original position 1 / 4 / 3 / 5 / 4; by shown position 1 / 4 / 3 / 5 / 4 (uniform would be 3.4 each).

CPU-placed nodes (placement detection: not applicable): none.

Derived from the stored records of `workers-ai/clef-flash`, ledger entry L-20261110T022013Z-workers-ai-clef-flash, source Results sha256 9422e92dd577724c4fbec4d077e99e92db47b93a5637fc9e58d1e7ae16e0ca3c; no request was sent for it; the guarantee holds for the set of Variant_Permutations that the variant averages and is not a measurement of position bias; this is not an independent measurement from the `single` run.

## 4a. Decision_Variants side by side

Each Decision_Model with its `single` and `perm_avg` variants, same Metrics, Thresholds and intervals. A figure of one variant is never printed in the other's column. The `single` flip rate is measured; the `perm_avg` flip row is guaranteed by construction and carries no number. Locked_Run figures only (a Dev_Run derived file is in the Dev_Run section and in 4b and 4c, labelled).

### @cf/cloudflare/clef-flash: workers-ai/clef-flash (single) and workers-ai/clef-flash/perm_avg (perm_avg)

| Metric | single: workers-ai/clef-flash | perm_avg: workers-ai/clef-flash/perm_avg |
| --- | --- | --- |
| Acceptable rate | 47/60 = 78.3% (fail) | 47/60 = 78.3% (fail) |
| Acceptable rate, Cluster_Bootstrap 95% | 68.3% to 87.9% | 68.3% to 87.9% |
| Severe count (base Permutation) | 0 of 60 cards (pass) | 0 of 60 cards (pass) |
| Flip rate | 0/172 = 0.0% (pass) | guaranteed by construction (not measured) |
| Contrast consistency | 3/15 pairs = 20.0% (fail) | 3/15 pairs = 20.0% (fail) |
| Illegal rate | 0/60 = 0.0% | 0/60 = 0.0% |
| Latency p50 / p95, ms (per request; see 4c for a decision) | 410 / 731 | see 4c (sum and maximum of the calls) |
| Mark | fail | fail |

Derived from the stored records of `workers-ai/clef-flash`, ledger entry L-20261110T022013Z-workers-ai-clef-flash, source Results sha256 9422e92dd577724c4fbec4d077e99e92db47b93a5637fc9e58d1e7ae16e0ca3c; no request was sent for it; the guarantee holds for the set of Variant_Permutations that the variant averages and is not a measurement of position bias; this is not an independent measurement from the `single` run.

### @cf/cloudflare/clef: workers-ai/clef (single) and workers-ai/clef/perm_avg (perm_avg)

| Metric | single: workers-ai/clef | perm_avg: workers-ai/clef/perm_avg |
| --- | --- | --- |
| Acceptable rate | 51/60 = 85.0% (pass (point estimate; 95% Cluster_Bootstrap lower bound 76.4% < 80%)) | 51/60 = 85.0% (pass (point estimate; 95% Cluster_Bootstrap lower bound 76.4% < 80%)) |
| Acceptable rate, Cluster_Bootstrap 95% | 76.4% to 93.1% | 76.4% to 93.1% |
| Severe count (base Permutation) | 1 of 60 cards (pass) | 1 of 60 cards (pass) |
| Flip rate | 0/172 = 0.0% (pass) | guaranteed by construction (not measured) |
| Contrast consistency | 4/15 pairs = 26.7% (fail) | 4/15 pairs = 26.7% (fail) |
| Illegal rate | 0/60 = 0.0% | 0/60 = 0.0% |
| Latency p50 / p95, ms (per request; see 4c for a decision) | 600 / 940 | see 4c (sum and maximum of the calls) |
| Mark | fail | fail |

Derived from the stored records of `workers-ai/clef`, ledger entry L-20261110T015939Z-workers-ai-clef, source Results sha256 1336462500e8b79ae263256aa3890f4669e38c2e490cd4032e38f091b304489c; no request was sent for it; the guarantee holds for the set of Variant_Permutations that the variant averages and is not a measurement of position bias; this is not an independent measurement from the `single` run.

## 4b. Position of the chosen option (perm_avg)

Counts over the Scored_Cards that are not Void_Cards, from the stored `perm_avg.positions` of the derived records: one row per Permutation, one column per shown position (1 based, in the order of that request). The row "original position" is the position in the base Permutation. Illegal answers are counted apart and are in no cell.

### workers-ai/clef-flash/perm_avg, derived run derived-dev-dev-20261109T151057Z-workers-ai-clef-flash-perm_avg-v1 (Dev_Run, not used for a mark)

| Shown position | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| base | 13 | 4 | 1 | 0 | 0 |
| reversed | 0 | 1 | 4 | 13 | 0 |
| rotated_1 | 4 | 1 | 0 | 13 | 0 |
| rotated_2 | 1 | 0 | 13 | 4 | 0 |
| original position | 13 | 4 | 1 | 0 | 0 |

Illegal answers (in no position cell): 0. Cards counted: 18.

### workers-ai/clef/perm_avg, derived run derived-dev-dev-20261109T152355Z-workers-ai-clef-perm_avg-v1 (Dev_Run, not used for a mark)

| Shown position | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| base | 9 | 4 | 5 | 0 | 0 |
| reversed | 0 | 5 | 4 | 9 | 0 |
| rotated_1 | 4 | 5 | 0 | 9 | 0 |
| rotated_2 | 5 | 0 | 9 | 4 | 0 |
| original position | 9 | 4 | 5 | 0 | 0 |

Illegal answers (in no position cell): 0. Cards counted: 18.

### workers-ai/clef/perm_avg, derived run derived-locked-L-20261110T015939Z-workers-ai-clef-perm_avg-v1 (Locked_Run)

| Shown position | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| base | 14 | 12 | 18 | 9 | 7 |
| reversed | 17 | 21 | 11 | 10 | 1 |
| rotated_1 | 10 | 18 | 12 | 15 | 1 |
| rotated_2 | 18 | 12 | 19 | 5 | 2 |
| original position | 14 | 12 | 18 | 9 | 7 |

Illegal answers (in no position cell): 0. Cards counted: 60.

### workers-ai/clef-flash/perm_avg, derived run derived-locked-L-20261110T022013Z-workers-ai-clef-flash-perm_avg-v1 (Locked_Run)

| Shown position | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| base | 12 | 14 | 18 | 12 | 4 |
| reversed | 18 | 19 | 11 | 11 | 1 |
| rotated_1 | 11 | 18 | 15 | 11 | 1 |
| rotated_2 | 18 | 15 | 13 | 6 | 4 |
| original position | 12 | 14 | 18 | 12 | 4 |

Illegal answers (in no position cell): 0. Cards counted: 60.

## 4c. Request_Multiplier and decision latency (perm_avg)

`tech.md` fixes one request per node for server inference. A `perm_avg` runtime needs up to four requests per node and per NPC in production. This conflict is left to the Author.

One-request alternative (DA-28): System One accepts several questions in one request, and for a decision the four Variant_Permutations differ only in the order of `criteria`, so they could be asked as four questions over one `state`. This is described, not built: whether the answers stay independent over one shared state is undocumented, the questions share the context window with `state`, and it only holds when the Permutations differ in option order alone. It is not measured, and it is not a Combination.

The Request_Multiplier is the number of calls one decision needs: 4 for a Card with 3 to 5 options, 2 for a Card with 2 options, 1 for a Sanity_Card. The decision latency of a Card is the sum (calls in sequence) and the maximum (calls in parallel) of the latencies of its calls, taken from the requests of the `single` run; no request was sent for the variant. Percentiles are nearest-rank (R14.1).

### workers-ai/clef-flash/perm_avg, derived run derived-dev-dev-20261109T151057Z-workers-ai-clef-flash-perm_avg-v1 (Dev_Run, not used for a mark)

| Request_Multiplier (calls per decision) | Scored_Cards |
| --- | --- |
| 4 | 18 |

| Decision latency | p50, ms | p95, ms |
| --- | --- | --- |
| Sum of the calls (in sequence) | 2178 | 3880 |
| Maximum of the calls (in parallel) | 936 | 1535 |

### workers-ai/clef/perm_avg, derived run derived-dev-dev-20261109T152355Z-workers-ai-clef-perm_avg-v1 (Dev_Run, not used for a mark)

| Request_Multiplier (calls per decision) | Scored_Cards |
| --- | --- |
| 4 | 18 |

| Decision latency | p50, ms | p95, ms |
| --- | --- | --- |
| Sum of the calls (in sequence) | 3186 | 3945 |
| Maximum of the calls (in parallel) | 1101 | 1990 |

### workers-ai/clef/perm_avg, derived run derived-locked-L-20261110T015939Z-workers-ai-clef-perm_avg-v1 (Locked_Run)

| Request_Multiplier (calls per decision) | Scored_Cards |
| --- | --- |
| 2 | 4 |
| 4 | 56 |

| Decision latency | p50, ms | p95, ms |
| --- | --- | --- |
| Sum of the calls (in sequence) | 2439 | 2965 |
| Maximum of the calls (in parallel) | 763 | 1043 |

### workers-ai/clef-flash/perm_avg, derived run derived-locked-L-20261110T022013Z-workers-ai-clef-flash-perm_avg-v1 (Locked_Run)

| Request_Multiplier (calls per decision) | Scored_Cards |
| --- | --- |
| 2 | 4 |
| 4 | 56 |

| Decision latency | p50, ms | p95, ms |
| --- | --- | --- |
| Sum of the calls (in sequence) | 1636 | 2347 |
| Maximum of the calls (in parallel) | 450 | 962 |

## 5. Sanity results (apart from every Metric)

| Combination | Ledger entry | Card ID | Task | Base outcome | Grade |
| --- | --- | --- | --- | --- | --- |
| webllm/qwen3.5-0.8b-q4f32/nvidia | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | D-sanity-003 | D | text | acceptable true, severe false, illegal false |
| webllm/qwen3.5-0.8b-q4f32/nvidia | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | D-sanity-004 | D | text | acceptable false, severe true, illegal false |
| webllm/qwen3.5-0.8b-q4f32/nvidia | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | D-sanity-005 | D | text | acceptable false, severe true, illegal false |
| webllm/qwen3.5-0.8b-q4f32/nvidia | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | D-sanity-006 | D | text | acceptable true, severe false, illegal false |
| webllm/qwen3.5-0.8b-q4f32/nvidia | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | S-sanity-003 | S | text | acceptable true, severe false, illegal false |
| webllm/qwen3.5-0.8b-q4f32/nvidia | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | S-sanity-004 | S | text | acceptable false, severe false, illegal false |
| webllm/qwen3.5-0.8b-q4f32/nvidia | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | S-sanity-005 | S | text | acceptable true, severe false, illegal false |
| webllm/qwen3.5-0.8b-q4f32/nvidia | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | S-sanity-006 | S | text | acceptable true, severe false, illegal false |
| webllm/qwen3.5-2b-q4f32/nvidia | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | D-sanity-003 | D | text | acceptable true, severe false, illegal false |
| webllm/qwen3.5-2b-q4f32/nvidia | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | D-sanity-004 | D | text | acceptable false, severe true, illegal false |
| webllm/qwen3.5-2b-q4f32/nvidia | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | D-sanity-005 | D | text | acceptable true, severe false, illegal false |
| webllm/qwen3.5-2b-q4f32/nvidia | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | D-sanity-006 | D | text | acceptable true, severe false, illegal false |
| webllm/qwen3.5-2b-q4f32/nvidia | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | S-sanity-003 | S | text | acceptable true, severe false, illegal false |
| webllm/qwen3.5-2b-q4f32/nvidia | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | S-sanity-004 | S | timeout | acceptable false, severe false, illegal true |
| webllm/qwen3.5-2b-q4f32/nvidia | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | S-sanity-005 | S | text | acceptable false, severe false, illegal false |
| webllm/qwen3.5-2b-q4f32/nvidia | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | S-sanity-006 | S | text | acceptable false, severe false, illegal false |
| workers-ai/clef | L-20261110T015939Z-workers-ai-clef | D-sanity-003 | D | text | acceptable true, severe false, illegal false |
| workers-ai/clef | L-20261110T015939Z-workers-ai-clef | D-sanity-004 | D | text | acceptable true, severe false, illegal false |
| workers-ai/clef | L-20261110T015939Z-workers-ai-clef | D-sanity-005 | D | text | acceptable true, severe false, illegal false |
| workers-ai/clef | L-20261110T015939Z-workers-ai-clef | D-sanity-006 | D | text | acceptable true, severe false, illegal false |
| workers-ai/clef | L-20261110T015939Z-workers-ai-clef | S-sanity-003 | S | none | no output |
| workers-ai/clef | L-20261110T015939Z-workers-ai-clef | S-sanity-004 | S | none | no output |
| workers-ai/clef | L-20261110T015939Z-workers-ai-clef | S-sanity-005 | S | none | no output |
| workers-ai/clef | L-20261110T015939Z-workers-ai-clef | S-sanity-006 | S | none | no output |
| workers-ai/clef-flash | L-20261110T022013Z-workers-ai-clef-flash | D-sanity-003 | D | text | acceptable true, severe false, illegal false |
| workers-ai/clef-flash | L-20261110T022013Z-workers-ai-clef-flash | D-sanity-004 | D | text | acceptable true, severe false, illegal false |
| workers-ai/clef-flash | L-20261110T022013Z-workers-ai-clef-flash | D-sanity-005 | D | text | acceptable true, severe false, illegal false |
| workers-ai/clef-flash | L-20261110T022013Z-workers-ai-clef-flash | D-sanity-006 | D | text | acceptable true, severe false, illegal false |
| workers-ai/clef-flash | L-20261110T022013Z-workers-ai-clef-flash | S-sanity-003 | S | none | no output |
| workers-ai/clef-flash | L-20261110T022013Z-workers-ai-clef-flash | S-sanity-004 | S | none | no output |
| workers-ai/clef-flash | L-20261110T022013Z-workers-ai-clef-flash | S-sanity-005 | S | none | no output |
| workers-ai/clef-flash | L-20261110T022013Z-workers-ai-clef-flash | S-sanity-006 | S | none | no output |
| workers-ai/gemma-4-26b-a4b-it | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | D-sanity-003 | D | text | acceptable true, severe false, illegal false |
| workers-ai/gemma-4-26b-a4b-it | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | D-sanity-004 | D | text | acceptable true, severe false, illegal false |
| workers-ai/gemma-4-26b-a4b-it | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | D-sanity-005 | D | text | acceptable true, severe false, illegal false |
| workers-ai/gemma-4-26b-a4b-it | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | D-sanity-006 | D | text | acceptable true, severe false, illegal false |
| workers-ai/gemma-4-26b-a4b-it | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | S-sanity-003 | S | text | acceptable true, severe false, illegal false |
| workers-ai/gemma-4-26b-a4b-it | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | S-sanity-004 | S | text | acceptable true, severe false, illegal false |
| workers-ai/gemma-4-26b-a4b-it | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | S-sanity-005 | S | text | acceptable true, severe false, illegal false |
| workers-ai/gemma-4-26b-a4b-it | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | S-sanity-006 | S | text | acceptable true, severe false, illegal false |

## 6. Performance

All figures come from the Locked_Run perf record of the entry (R14.10). Latency covers every request that returned raw text (all Permutations and Sanity_Cards), including outputs later graded Illegal; Timeouts and runtime errors are counted apart. Percentiles are nearest-rank on the sorted values, index floor((p·n + 99) / 100) − 1, with no interpolation, so p50 of 30 values is the 15th and p95 the 29th.

| Combination | Task | p50, ms | p95, ms | Requests covered | Timeouts | Runtime errors | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| webllm/qwen3.5-0.8b-q4f32/nvidia | D | 2482 | 3081 | 236 | 0 | 0 |  |
| webllm/qwen3.5-0.8b-q4f32/nvidia | S | 6079 | 7357 | 68 | 20 | 0 |  |
| webllm/qwen3.5-2b-q4f32/nvidia | D | 4984 | 5936 | 228 | 8 | 0 |  |
| webllm/qwen3.5-2b-q4f32/nvidia | S | 8893 | 9993 | 8 | 80 | 0 |  |
| workers-ai/clef | D | 600 | 940 | 236 | 0 | 0 |  |
| workers-ai/clef-flash | D | 410 | 731 | 236 | 0 | 0 |  |
| workers-ai/gemma-4-26b-a4b-it | D | 738 | 1036 | 235 | 1 | 0 |  |
| workers-ai/gemma-4-26b-a4b-it | S | 3030 | 6024 | 88 | 0 | 0 |  |

| Combination | Ledger entry | Source | Cold start, empty cache, ms | Cold start, warm cache, ms | Model download | Runtime download | NVIDIA device memory.used delta, MiB | Intel iGPU peak memory, MiB (quantity named) | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| webllm/qwen3.5-0.8b-q4f32/nvidia | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | headless | 70876 | 5137 | 437021473 B (416.8 MiB) | 13382539 B (12.8 MiB) | 1783 | — | within |
| webllm/qwen3.5-2b-q4f32/nvidia | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | headless | 243841 | 6444 | 1072781587 B (1023.1 MiB) | 13399008 B (12.8 MiB) | 2461 | — | within |
| workers-ai/clef | L-20261110T015939Z-workers-ai-clef | REST API (local Probe_Runner) | not applicable | not applicable | not applicable | not applicable | not applicable | not applicable | within |
| workers-ai/clef-flash | L-20261110T022013Z-workers-ai-clef-flash | REST API (local Probe_Runner) | not applicable | not applicable | not applicable | not applicable | not applicable | not applicable | within |
| workers-ai/gemma-4-26b-a4b-it | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | REST API (local Probe_Runner) | not applicable | not applicable | not applicable | not applicable | not applicable | not applicable | within |

Intel iGPU figures are never put in the NVIDIA column. The Intel quantity is either "Chrome GPU process peak RSS (excludes unmapped GEM buffers)" or the i915 debugfs / `intel_gpu_top` source, and it is named in the cell.

## 7. Ledger entries per Model_Key and Task_Type

| Model_Key | Task | Entry | Status | Role | Metrics |
| --- | --- | --- | --- | --- | --- |
| webllm / Qwen3.5-0.8B-q4f32_1-MLC / q4f32_1 / 4ed017713f04 | D | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | complete | used for marks and recommendation | acceptable 35/60 (58.3%), severe 8, flips 81/172, contrast 0/15; fail |
| webllm / Qwen3.5-0.8B-q4f32_1-MLC / q4f32_1 / 4ed017713f04 | S | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | complete | used for marks and recommendation | acceptable 7/40 (17.5%), severe 4, flips 11/44, contrast 0/10; fail |
| webllm / Qwen3.5-2B-q4f32_1-MLC / q4f32_1 / d835e5c41aa5 | D | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | complete | used for marks and recommendation | acceptable 36/60 (60.0%), severe 3, flips 72/172, contrast 0/15; fail |
| webllm / Qwen3.5-2B-q4f32_1-MLC / q4f32_1 / d835e5c41aa5 | S | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | complete | used for marks and recommendation | acceptable 0/40 (0.0%), severe 2, flips 3/44, contrast 0/10; fail |
| workers-ai / @cf/cloudflare/clef / server-side, not pinnable | D | L-20261110T015939Z-workers-ai-clef | complete | used for marks and recommendation | acceptable 51/60 (85.0%), severe 1, flips 0/172, contrast 4/15; fail |
| workers-ai / @cf/cloudflare/clef-flash / server-side, not pinnable | D | L-20261110T022013Z-workers-ai-clef-flash | complete | used for marks and recommendation | acceptable 47/60 (78.3%), severe 0, flips 0/172, contrast 3/15; fail |
| workers-ai / @cf/google/gemma-4-26b-a4b-it / server-side, not pinnable | D | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | complete | used for marks and recommendation | acceptable 51/60 (85.0%), severe 2, flips 36/172, contrast 3/15; fail |
| workers-ai / @cf/google/gemma-4-26b-a4b-it / server-side, not pinnable | S | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | complete | used for marks and recommendation | acceptable 34/40 (85.0%), severe 0, flips 10/44, contrast 6/10; fail |

## 8. Support marks per link of the fallback chain

| Task | Link | Mark | Evidence (ledger entry IDs) |
| --- | --- | --- | --- |
| D | In-browser: transformers.js | not supported | transformers.js/qwen3.5-0.8b-q4/nvidia: Exclusion_Record (preflight_vram); transformers.js/qwen3.5-2b-q4/nvidia: Exclusion_Record (preflight_vram); transformers.js/lfm2.5-1.2b-instruct-q4/nvidia: Exclusion_Record (preflight_vram) |
| D | In-browser: webllm | not supported | webllm/qwen3.5-0.8b-q4f32/nvidia: entry L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia did not pass; webllm/qwen3.5-2b-q4f32/nvidia: entry L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia did not pass |
| D | Workers AI | not supported | workers-ai/gemma-4-26b-a4b-it: entry L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it did not pass; workers-ai/clef-flash: entry L-20261110T022013Z-workers-ai-clef-flash did not pass; workers-ai/clef: entry L-20261110T015939Z-workers-ai-clef did not pass |
| D | Rules_Default | supported | always supported |
| S | In-browser: transformers.js | not supported | transformers.js/qwen3.5-0.8b-q4/nvidia: Exclusion_Record (preflight_vram); transformers.js/qwen3.5-2b-q4/nvidia: Exclusion_Record (preflight_vram); transformers.js/lfm2.5-1.2b-instruct-q4/nvidia: Exclusion_Record (preflight_vram) |
| S | In-browser: webllm | not supported | webllm/qwen3.5-0.8b-q4f32/nvidia: entry L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia did not pass; webllm/qwen3.5-2b-q4f32/nvidia: entry L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia did not pass |
| S | Workers AI | not supported | workers-ai/gemma-4-26b-a4b-it: entry L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it did not pass |
| S | Rules_Default | supported | always supported |

Smoke_Call outputs appear only in this section; they never enter a Metric, a pass or fail mark or an interval (R18.6).

## 9. Recommendation per Task_Type

The in-browser conclusion covers only Qwen3.5 on WebLLM. The Workers AI conclusion covers only gemma-4-26b-a4b-it (frozen templates, thinking disabled, one call per request) and the decision models clef and clef-flash (System One mapping decision.system_one.v1.txt, the single and perm_avg variants, task D only); it does not represent other models on Workers AI or other ways of calling them.

Selection among passing Combinations of a link: highest acceptable rate, then fewest severe outputs, then lowest p95 latency, then Combination ID.

### Task_Type D (decision)

- In-browser Runtime: no recommended Combination
- Workers AI: no recommended Combination (measured, did not pass)
- Rules_Default: last link, always supported

Recommendation for D: **Rules_Default alone.** Thresholds failed, per Combination run:

- webllm/qwen3.5-0.8b-q4f32/nvidia (entry L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia): acceptable rate 35/60 = 58.3%, below 80%; severe count 8, above 1; flip rate 81/172 = 47.1%, above 5%; contrast consistency 0/15 = 0.0%, below 80%
- webllm/qwen3.5-2b-q4f32/nvidia (entry L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia): acceptable rate 36/60 = 60.0%, below 80%; severe count 3, above 1; flip rate 72/172 = 41.9%, above 5%; contrast consistency 0/15 = 0.0%, below 80%
- transformers.js/qwen3.5-0.8b-q4/nvidia: Exclusion_Record (preflight_vram)
- transformers.js/qwen3.5-2b-q4/nvidia: Exclusion_Record (preflight_vram)
- transformers.js/lfm2.5-1.2b-instruct-q4/nvidia: Exclusion_Record (preflight_vram)
- workers-ai/gemma-4-26b-a4b-it (entry L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it): severe count 2, above 1; flip rate 36/172 = 20.9%, above 5%; contrast consistency 3/15 = 20.0%, below 80%
- workers-ai/clef-flash (entry L-20261110T022013Z-workers-ai-clef-flash): acceptable rate 47/60 = 78.3%, below 80%; contrast consistency 3/15 = 20.0%, below 80%
- workers-ai/clef (entry L-20261110T015939Z-workers-ai-clef): contrast consistency 4/15 = 26.7%, below 80%

Contrast is the Threshold no measured Combination meets on D. The Workers AI candidates, generative and decision models alike, reach 3 to 4 of 15 (gemma-4-26b-a4b-it 3, clef 4, clef-flash 3); the in-browser WebLLM Combinations reach 0 of 15. The only configuration near the Threshold is the reasoning External reference (11 of 15), which is not a Combination.

### Task_Type S (synthesis)

- In-browser Runtime: no recommended Combination
- Workers AI: no recommended Combination (measured, did not pass)
- Rules_Default: last link, always supported

Recommendation for S: **Rules_Default alone.** Thresholds failed, per Combination run:

- webllm/qwen3.5-0.8b-q4f32/nvidia (entry L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia): acceptable rate 7/40 = 17.5%, below 80%; severe count 4, above 1; flip rate 11/44 = 25.0%, above 5%; contrast consistency 0/10 = 0.0%, below 80%
- webllm/qwen3.5-2b-q4f32/nvidia (entry L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia): acceptable rate 0/40 = 0.0%, below 80%; severe count 2, above 1; flip rate 3/44 = 6.8%, above 5%; contrast consistency 0/10 = 0.0%, below 80%
- transformers.js/qwen3.5-0.8b-q4/nvidia: Exclusion_Record (preflight_vram)
- transformers.js/qwen3.5-2b-q4/nvidia: Exclusion_Record (preflight_vram)
- transformers.js/lfm2.5-1.2b-instruct-q4/nvidia: Exclusion_Record (preflight_vram)
- workers-ai/gemma-4-26b-a4b-it (entry L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it): flip rate 10/44 = 22.7%, above 5%; contrast consistency 6/10 = 60.0%, below 80%

## 10. Void cards, left-out pairs, failures, engine faults, re-runs and incomplete entries

### Void cards

- none

### Contrast pairs left out of the consistency count

- none

### Failed Combinations

- webllm/qwen3.5-0.8b-q4f32/nvidia: failure record model_load_failed (dev run, transient; not counted as a Combination failure; phase: load; cards_answered: 0)
- webllm/qwen3.5-0.8b-q4f32/nvidia, D (entry L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia): failed Thresholds: acceptable rate 35/60 = 58.3%, below 80%; severe count 8, above 1; flip rate 81/172 = 47.1%, above 5%; contrast consistency 0/15 = 0.0%, below 80%
- webllm/qwen3.5-0.8b-q4f32/nvidia, S (entry L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia): failed Thresholds: acceptable rate 7/40 = 17.5%, below 80%; severe count 4, above 1; flip rate 11/44 = 25.0%, above 5%; contrast consistency 0/10 = 0.0%, below 80%
- webllm/qwen3.5-2b-q4f32/nvidia, D (entry L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia): failed Thresholds: acceptable rate 36/60 = 60.0%, below 80%; severe count 3, above 1; flip rate 72/172 = 41.9%, above 5%; contrast consistency 0/15 = 0.0%, below 80%
- webllm/qwen3.5-2b-q4f32/nvidia, S (entry L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia): failed Thresholds: acceptable rate 0/40 = 0.0%, below 80%; severe count 2, above 1; flip rate 3/44 = 6.8%, above 5%; contrast consistency 0/10 = 0.0%, below 80%
- workers-ai/clef, D (entry L-20261110T015939Z-workers-ai-clef): failed Thresholds: contrast consistency 4/15 = 26.7%, below 80%
- workers-ai/clef-flash, D (entry L-20261110T022013Z-workers-ai-clef-flash): failed Thresholds: acceptable rate 47/60 = 78.3%, below 80%; contrast consistency 3/15 = 20.0%, below 80%
- workers-ai/gemma-4-26b-a4b-it, D (entry L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it): failed Thresholds: severe count 2, above 1; flip rate 36/172 = 20.9%, above 5%; contrast consistency 3/15 = 20.0%, below 80%
- workers-ai/gemma-4-26b-a4b-it, S (entry L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it): failed Thresholds: flip rate 10/44 = 22.7%, above 5%; contrast consistency 6/10 = 60.0%, below 80%
- transformers.js/qwen3.5-0.8b-q4/nvidia: excluded, see section 3 (preflight_vram)
- transformers.js/qwen3.5-2b-q4/nvidia: excluded, see section 3 (preflight_vram)
- transformers.js/lfm2.5-1.2b-instruct-q4/nvidia: excluded, see section 3 (preflight_vram)

### Engine faults (runtime_stuck, truncated_state) and engine rebuild failures (rebuild_failed)

- none

### Re-runs

- none

### Incomplete ledger entries

- none

## 11. Workers AI note

Workers AI measurements, or Smoke_Calls, used the REST API called from the local Probe_Runner. A production server path still has to decide or measure:


- the added latency of a Worker proxy in front of the model;
- how to keep the Workers_AI_Token out of the browser;
- the request budget and rate limits from `tech.md`.

None of these is decided here.

## 12. External reference (not a repo Combination)

No External_Reference has been ingested.

### External reference: teacher-upper-bound (Author-supplied, not verified by ingest)

This is an External_Reference, not a Locked_Run Combination of this repository. It takes part in no mark, link mark, recommendation, branch logic or ledger (R19.16), and the Report computes no Threshold verdict for it; the only verdict printed is the Author's own text below (Amendment RC-20).

- Label: Author-supplied, not verified by ingest. The figures below are recorded exactly as the Author supplied them; ingest did not check or re-grade them.
- Run on 2026-11-09 outside this repository, in an "omp" workbench; archive `~/projects/bitf-teacher-archive/`
- Archive commit 0ef13c0 (frozen configuration and ledger start): 0ef13c04612d3d9e1245c73644b3d3476a2a65ba
- Archive commit 732f0c6 (results and complete): 732f0c6f041b372ee3eb6f08186b3910a0726d6c
- Evaluated repository HEAD 7b99dc8: 7b99dc85ecdbc8af605b9d286cb0df7ca324f9f6
- Frozen manifest sha256: 9322729c727a8c975dc3273fb7cc2f239e8790ea66e1745493179aea6815b34f
- Frozen locked cards sha256: d5abed2a80ce3f4150b5969b86ba48548c63f9ae2f9d93f0d6bb9a1934714083
- Frozen Sim_Wasm sha256: a4bc56273b9675cc7813419f5eeb342ae1771481ab74b0418e6d6974feff6587
- Frozen configuration file (freeze.json) sha256: aa012bc73d696d1198c964489cc6f0498ba621bed1f38b12fe9dfe1b6b0f6846
- Archive ledger sha256: 7105cf5e55595b2b123212c203ffaa31a12ccd8b6786949f27330625085cb8df
- Grading and Metrics: the repo's gradeRecords and computeMetrics, called read-only.
- sha256 of the checked-in file (author-supplied.json): b8d6de8203a3f9dd9553dad9e94965a0439ba6962656598500c264f49f6f7ab2

Task_Type D: `deepseek-v4.1-flash-1017`, thinking on, template `decision.teacher1.txt` (sha256 5c9372825cb05b2da992345507284a427ff18194b8feaf8fd8e876187c704a4b); run T-20261109T041744Z-deepseek-think-teacher1-D

| Metric | As supplied |
| --- | --- |
| Acceptable rate | 58 of 60 (96.7%, cluster lower bound 91.5%) |
| Severe count | 1 |
| Flip rate | 34 of 172 (19.8%) |
| Contrast consistency | 11 of 15 pairs |

- sha256 of its results file: 53307452048046341c08eb243ec72625e6b5305e8fffd1786d946b6a91fc9a34
- sha256 of its grades file: a6350d9234258d8f8d20eb21fd6adf54bea990f91758bcf6b43b6308712f5ae1
- As the archive's summary file records it: records 236, errors 0, truncated 1, model_mismatch 0. Recorded as printed there; not interpreted here.

Task_Type S: `kimi-k3`, thinking off, template `synthesis.v1` (sha256 5139bcc5a4e10a52184483779dad0f2c4541ac432862170d1749a2c939663d85); run T-20261109T041744Z-kimi-k3-S

| Metric | As supplied |
| --- | --- |
| Acceptable rate | 34 of 40 (85.0%) |
| Severe count | 0 |
| Flip rate | 7 of 44 (15.9%) |
| Contrast consistency | 8 of 10 pairs |

- sha256 of its results file: efe7802f07277328bf9b220778e3802c77d0707f34fd8603c61940c3f7990931
- sha256 of its grades file: 36df54bb61db39fee54b5c40b6525a0fec54f52234fa52c3ba0539f527cc2087
- As the archive's summary file records it: records 88, errors 0, truncated 0, model_mismatch 0. Recorded as printed there; not interpreted here.

Reading against this probe's Thresholds (the Author's text, Amendment RC-20, 2026-11-10):

Under this probe's Thresholds the teacher D reference fails flip (34 of 172) and contrast (11 of 15, below 12 of 15); the teacher S reference fails flip only (7 of 44). No reference configuration passes all four Thresholds. One D request (D-reconcile_or_revenge-008, permutation rotated_1) reached the 16,384-token output cap with empty content; it is graded Illegal and, being a non-base Permutation, affects only the flip count (it counts as a flip under R13.2; without it the flip rate is at least 33 of 171).

Post-hoc note (an analysis, not a judgement; as reported by the Author, 2026-11-09; script in archive commit 7c8f958): A post-hoc analysis of multi-permutation voting over the existing records left acceptable, severe and contrast almost unchanged. It is an analysis, not a judgement.

## Quality without timeout (not used for any mark, label or recommendation)

Same denominator as the Metrics, but each timed-out base output that has a Late_Answer is replaced by the grade of that Late_Answer. A timeout without a Late_Answer stays Illegal.

| Combination | Task | Entry | Acceptable rate, without timeout | Severe count, without timeout | Illegal rate, without timeout | Timeouts replaced by a Late_Answer |
| --- | --- | --- | --- | --- | --- | --- |
| webllm/qwen3.5-0.8b-q4f32/nvidia | D | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | 35/60 (58.3%) | 8 | 0/60 (0.0%) | 0 |
| webllm/qwen3.5-0.8b-q4f32/nvidia | S | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | 7/40 (17.5%) | 7 | 4/40 (10.0%) | 8 |
| webllm/qwen3.5-2b-q4f32/nvidia | D | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | 38/60 (63.3%) | 3 | 0/60 (0.0%) | 2 |
| webllm/qwen3.5-2b-q4f32/nvidia | S | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | 1/40 (2.5%) | 12 | 7/40 (17.5%) | 38 |
| workers-ai/clef | D | L-20261110T015939Z-workers-ai-clef | 51/60 (85.0%) | 1 | 0/60 (0.0%) | 0 |
| workers-ai/clef-flash | D | L-20261110T022013Z-workers-ai-clef-flash | 47/60 (78.3%) | 0 | 0/60 (0.0%) | 0 |
| workers-ai/gemma-4-26b-a4b-it | D | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | 51/60 (85.0%) | 2 | 0/60 (0.0%) | 0 |
| workers-ai/gemma-4-26b-a4b-it | S | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | 34/40 (85.0%) | 0 | 0/40 (0.0%) | 0 |

## Dev_Run figures (not used for the recommendation)

These are Dev_Run figures. They are kept out of every mark and out of the recommendation. The Intel iGPU Dev_Run appears only here.

Position/content confound in the dev set: in `dev.jsonl` all 15 scored D cards that have a severe option list it last in card order (the two unscored two-option Sanity_Cards do too). Option rotation was applied only to the locked set; this was an oversight on the card-authoring side, and the cards are locked and are not changed. So in the Dev_Runs a model that prefers the last-listed option cannot be told apart from one that prefers the severe content. Per the Author, the severe options of the locked set are distributed last 14, middle 26, first 7. The position-versus-content question is therefore to be settled from the Locked_Run results, not from the Dev_Runs.

Intel iGPU finding (Dev_Run, corrected run dev-20261108T044612Z-webllm-qwen3-5-0-8b-q4f32-intel, device_mismatch false): all 74 D requests hit the 10 s timeout; the Late_Answers arrived after 11,975 / 14,955 / 17,495 ms (min / median / max), about 6.7 times the 2,245 ms NVIDIA median of the same Combination. In S, 3 requests timed out and 27 ended in `runtime_error` ("The current Object has already been disposed") after the repeated timeouts; the cause was not investigated. So no Intel quality figure exists for the frozen templates; the run shows a latency result only: the Intel iGPU cannot meet the 10 s limit for the 0.8B. The two earlier Intel-labelled runs are INVALID (device_mismatch) and show no Intel figure.

| Dev_Run | Combination | GPU | Task | Acceptable (Dev_Run, base cards) | Severe (base cards) | Severe in other Permutations | Flips (non-base requests with an output) | Contrast pairs | Latency p50 / p95, ms (nearest rank). single: every request with text, Sanity_Cards included. perm_avg: per decision, scored non-void cards only | NVIDIA device memory.used delta, MiB | Intel iGPU peak memory, MiB (quantity named) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dev-20261108T012419Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | D | 0/18 (0.0%); random baseline 55.6% | 0 | 0 | 0/54 | 0/6 | 1884 / 2283 (per request) | 1769 | — |
| dev-20261108T012419Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | S | 0/12 (0.0%) | 0 | 0 | 0/16 | 0/4 | 6716 / 8784 (per request) | 1769 | — |
| dev-20261108T013732Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | D | 0/18 (0.0%); random baseline 55.6% | 0 | 0 | 0/54 | 0/6 | 1903 / 2294 (per request) | 1769 | — |
| dev-20261108T013732Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | S | 0/12 (0.0%) | 0 | 0 | 0/16 | 0/4 | 6718 / 8743 (per request) | 1769 | — |
| dev-20261108T014704Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | D | 6/18 (33.3%); random baseline 55.6% | 1 | 5 | 25/54 | 0/6 | 1894 / 2283 (per request) | 1769 | — |
| dev-20261108T014704Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | S | 1/12 (8.3%) | 1 | 3 | 10/16 | 0/4 | 6741 / 8817 (per request) | 1769 | — |
| dev-20261108T020924Z-webllm-qwen3-5-2b-q4f32-nvidia | webllm/qwen3.5-2b-q4f32/nvidia | NVIDIA discrete GPU | D | 9/18 (50.0%); random baseline 55.6% | 3 | 11 | 12/54 | 0/6 | 3938 / 9881 (per request) | 2461 | — |
| dev-20261108T020924Z-webllm-qwen3-5-2b-q4f32-nvidia | webllm/qwen3.5-2b-q4f32/nvidia | NVIDIA discrete GPU | S | 2/12 (16.7%) | 2 | 1 | 4/16 | 0/4 | 8102 / 9508 (per request) | 2461 | — |
| dev-20261108T022959Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | D | 9/18 (50.0%); random baseline 55.6% | 5 | 5 | 12/54 | 0/6 | 2237 / 2612 (per request) | 1769 | — |
| dev-20261108T022959Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | S | 2/12 (16.7%) | 3 | 3 | 9/16 | 0/4 | 6431 / 9683 (per request) | 1769 | — |
| dev-20261108T024005Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | S | 1/12 (8.3%) | 2 | 3 | 9/16 | 0/4 | 5513 / 8203 (per request) | 1746 | — |
| dev-20261108T024508Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | S | 2/12 (16.7%) | 3 | 7 | 10/16 | 0/4 | 5897 / 8690 (per request) | 1754 | — |
| dev-20261108T025126Z-webllm-qwen3-5-2b-q4f32-nvidia | webllm/qwen3.5-2b-q4f32/nvidia | NVIDIA discrete GPU | D | 6/18 (33.3%); random baseline 55.6% | 2 | 6 | 4/54 | 0/6 | 4457 / 9389 (per request) | 2455 | — |
| dev-20261108T025126Z-webllm-qwen3-5-2b-q4f32-nvidia | webllm/qwen3.5-2b-q4f32/nvidia | NVIDIA discrete GPU | S | 1/12 (8.3%) | 1 | 1 | 3/16 | 0/4 | 8507 / 9533 (per request) | 2455 | — |
| dev-20261108T031044Z-webllm-qwen3-5-2b-q4f32-nvidia | webllm/qwen3.5-2b-q4f32/nvidia | NVIDIA discrete GPU | D | 10/18 (55.6%); random baseline 55.6% | 2 | 9 | 14/54 | 0/6 | 4467 / 9224 (per request) | 2385 | — |
| dev-20261108T032118Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | D | 0/18 (0.0%); random baseline 55.6% | 0 | 0 | 0/0 (not computable) | 0/6 | no data / no data (per request) | not measured: no perf record | not measured: no perf record |
| dev-20261108T032233Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | D | 9/18 (50.0%); random baseline 55.6% | 5 | 5 | 16/54 | 0/6 | 2320 / 2693 (per request) | 1714 | — |
| dev-20261108T035336Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | D | 9/18 (50.0%); random baseline 55.6% | 5 | 5 | 12/54 | 0/6 | 2245 / 2623 (per request) | 1761 | — |
| dev-20261108T035336Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | S | 1/12 (8.3%) | 2 | 3 | 9/16 | 0/4 | 5527 / 8408 (per request) | 1761 | — |
| dev-20261108T040130Z-webllm-qwen3-5-2b-q4f32-nvidia | webllm/qwen3.5-2b-q4f32/nvidia | NVIDIA discrete GPU | D | 8/18 (44.4%); random baseline 55.6% | 2 | 8 | 11/54 | 0/6 | 4488 / 9238 (per request) | 2461 | — |
| dev-20261108T040130Z-webllm-qwen3-5-2b-q4f32-nvidia | webllm/qwen3.5-2b-q4f32/nvidia | NVIDIA discrete GPU | S | 1/12 (8.3%) | 1 | 1 | 3/16 | 0/4 | 8692 / 9723 (per request) | 2461 | — |
| dev-20261108T041937Z-webllm-qwen3-5-0-8b-q4f32-intel | webllm/qwen3.5-0.8b-q4f32/intel | INVALID: Intel adapter reported, but the work ran on the NVIDIA GPU (device_mismatch) | D | 9/18 (50.0%); random baseline 55.6% | 5 | 5 | 12/54 | 0/6 | 2243 / 2613 (per request) | — | INVALID (device_mismatch): NVIDIA memory rose during this run, so these are not Intel figures |
| dev-20261108T041937Z-webllm-qwen3-5-0-8b-q4f32-intel | webllm/qwen3.5-0.8b-q4f32/intel | INVALID: Intel adapter reported, but the work ran on the NVIDIA GPU (device_mismatch) | S | 1/12 (8.3%) | 2 | 3 | 9/16 | 0/4 | 5536 / 8377 (per request) | — | INVALID (device_mismatch): NVIDIA memory rose during this run, so these are not Intel figures |
| dev-20261108T043623Z-webllm-qwen3-5-0-8b-q4f32-intel | webllm/qwen3.5-0.8b-q4f32/intel | INVALID: Intel adapter reported, but the work ran on the NVIDIA GPU (device_mismatch) | D | 9/18 (50.0%); random baseline 55.6% | 5 | 5 | 12/54 | 0/6 | 2231 / 2608 (per request) | — | INVALID (device_mismatch): NVIDIA memory rose during this run, so these are not Intel figures |
| dev-20261108T043623Z-webllm-qwen3-5-0-8b-q4f32-intel | webllm/qwen3.5-0.8b-q4f32/intel | INVALID: Intel adapter reported, but the work ran on the NVIDIA GPU (device_mismatch) | S | 1/12 (8.3%) | 2 | 3 | 9/16 | 0/4 | 5423 / 8225 (per request) | — | INVALID (device_mismatch): NVIDIA memory rose during this run, so these are not Intel figures |
| dev-20261108T044612Z-webllm-qwen3-5-0-8b-q4f32-intel | webllm/qwen3.5-0.8b-q4f32/intel | Intel integrated GPU | D | 0/18 (0.0%); random baseline 55.6% | 0 | 0 | 0/54 | 0/6 | no data / no data (per request) | — | 492 — Chrome GPU process peak RSS (excludes unmapped GEM buffers) |
| dev-20261108T044612Z-webllm-qwen3-5-0-8b-q4f32-intel | webllm/qwen3.5-0.8b-q4f32/intel | Intel integrated GPU | S | 0/12 (0.0%) | 0 | 0 | 0/16 | 0/4 | no data / no data (per request) | — | 492 — Chrome GPU process peak RSS (excludes unmapped GEM buffers) |
| dev-20261108T101109Z-workers-ai-gemma-4-26b-a4b-it | workers-ai/gemma-4-26b-a4b-it | not applicable (server side) | D | 16/18 (88.9%); random baseline 55.6% | 0 | 0 | 10/54 | 2/6 | 798 / 1672 (per request) | not applicable | not applicable |
| dev-20261108T101109Z-workers-ai-gemma-4-26b-a4b-it | workers-ai/gemma-4-26b-a4b-it | not applicable (server side) | S | 11/12 (91.7%) | 0 | 1 | 4/16 | 3/4 | 4186 / 8288 (per request) | not applicable | not applicable |
| dev-20261109T151057Z-workers-ai-clef-flash | workers-ai/clef-flash | not applicable (server side) | D | 16/18 (88.9%); random baseline 55.6% | 0 | 0 | 0/54 | 1/6 | 446 / 1226 (per request) | not applicable | not applicable |
| dev-20261109T152355Z-workers-ai-clef | workers-ai/clef | not applicable (server side) | D | 14/18 (77.8%); random baseline 55.6% | 0 | 0 | 0/54 | 0/6 | 697 / 1555 (per request) | not applicable | not applicable |
| derived-dev-dev-20261109T151057Z-workers-ai-clef-flash-perm_avg-v1 | workers-ai/clef-flash/perm_avg | not applicable (server side) | D | 16/18 (88.9%); random baseline 55.6% | 0 | 0 | by construction | 1/6 | 2178 / 3880 (per decision, sum of its calls; as in 4c) | not applicable | not applicable |
| derived-dev-dev-20261109T152355Z-workers-ai-clef-perm_avg-v1 | workers-ai/clef/perm_avg | not applicable (server side) | D | 14/18 (77.8%); random baseline 55.6% | 0 | 0 | by construction | 0/6 | 3186 / 3945 (per decision, sum of its calls; as in 4c) | not applicable | not applicable |

### D requests against the random baseline, and position diagnosis (Dev_Run)

Reading of the Dev_Runs with the frozen D template (Author, 2026-11-08): Qwen3.5-0.8B 43/74 and Qwen3.5-2B 38/74 acceptable D requests are at random level (see the request-level random baseline below, about 41 of 74); contrast-pair consistency is 0 of the pairs; and the gain from the first template to the frozen one came mainly from fewer Illegal outputs (the model stopped writing a leading dash and a wrong ID), not from better judgement. The final Dev_Runs with the frozen hashes gave the same picture: Qwen3.5-0.8B 43/74 on NVIDIA (the two earlier Intel-labelled runs with the same 43/74 are INVALID: they ran on the NVIDIA GPU, see the Intel finding below) and Qwen3.5-2B 34/74 (8 Illegal, mostly Timeouts; run-to-run latency noise moved it from 38/74).

The table above counts the base Permutation of each Scored_Card (Random_Baseline over cards). The lines below count every graded D request (all Permutations and the Sanity_Cards); the random baseline is computed from the cards (acceptable options / options per request), not typed in. Positions are 1-based in the printed order: "original" is the card order, "shown" is the order in that request's prompt.

- **dev-20261108T012419Z-webllm-qwen3-5-0-8b-q4f32-nvidia** (webllm/qwen3.5-0.8b-q4f32/nvidia):
  - Dev_Run D, request level: acceptable 0/74 (0.0%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 0/72 (0.0%) against 55.6%. Illegal requests: 74.
  - Dev_Run D, shuffle: 0 of 0 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 0 cards with at least two valid picks, 0 kept the same option in every order and 0 kept the same shown position in every order.
- **dev-20261108T013732Z-webllm-qwen3-5-0-8b-q4f32-nvidia** (webllm/qwen3.5-0.8b-q4f32/nvidia):
  - Dev_Run D, request level: acceptable 0/74 (0.0%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 0/72 (0.0%) against 55.6%. Illegal requests: 74.
  - Dev_Run D, shuffle: 0 of 0 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 0 cards with at least two valid picks, 0 kept the same option in every order and 0 kept the same shown position in every order.
- **dev-20261108T014704Z-webllm-qwen3-5-0-8b-q4f32-nvidia** (webllm/qwen3.5-0.8b-q4f32/nvidia):
  - Dev_Run D, request level: acceptable 39/74 (52.7%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 39/72 (54.2%) against 55.6%. Illegal requests: 13.
  - Dev_Run D, shuffle: 8 of 33 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 18 cards with at least two valid picks, 7 kept the same option in every order and 1 kept the same shown position in every order.
  - Dev_Run D, 4-option cards, 61 valid picks: by original position 16 / 10 / 27 / 8; by shown position 5 / 20 / 20 / 16 (uniform would be 15.3 each).
- **dev-20261108T020924Z-webllm-qwen3-5-2b-q4f32-nvidia** (webllm/qwen3.5-2b-q4f32/nvidia):
  - Dev_Run D, request level: acceptable 33/74 (44.6%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 32/72 (44.4%) against 55.6%. Illegal requests: 9.
  - Dev_Run D, shuffle: 6 of 45 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 17 cards with at least two valid picks, 13 kept the same option in every order and 0 kept the same shown position in every order.
  - Dev_Run D, 2-option cards, 1 valid picks: by original position 1 / 0; by shown position 1 / 0 (uniform would be 0.5 each).
  - Dev_Run D, 4-option cards, 64 valid picks: by original position 28 / 3 / 19 / 14; by shown position 11 / 16 / 19 / 18 (uniform would be 16.0 each).
- **dev-20261108T022959Z-webllm-qwen3-5-0-8b-q4f32-nvidia** (webllm/qwen3.5-0.8b-q4f32/nvidia):
  - Dev_Run D, request level: acceptable 43/74 (58.1%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 41/72 (56.9%) against 55.6%. Illegal requests: 2.
  - Dev_Run D, shuffle: 10 of 52 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 18 cards with at least two valid picks, 12 kept the same option in every order and 0 kept the same shown position in every order.
  - Dev_Run D, 2-option cards, 2 valid picks: by original position 2 / 0; by shown position 2 / 0 (uniform would be 1.0 each).
  - Dev_Run D, 4-option cards, 70 valid picks: by original position 23 / 7 / 30 / 10; by shown position 12 / 22 / 15 / 21 (uniform would be 17.5 each).
- **dev-20261108T025126Z-webllm-qwen3-5-2b-q4f32-nvidia** (webllm/qwen3.5-2b-q4f32/nvidia):
  - Dev_Run D, request level: acceptable 25/74 (33.8%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 24/72 (33.3%) against 55.6%. Illegal requests: 20.
  - Dev_Run D, shuffle: 4 of 39 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 13 cards with at least two valid picks, 9 kept the same option in every order and 0 kept the same shown position in every order.
  - Dev_Run D, 2-option cards, 2 valid picks: by original position 1 / 1; by shown position 1 / 1 (uniform would be 1.0 each).
  - Dev_Run D, 4-option cards, 52 valid picks: by original position 28 / 0 / 16 / 8; by shown position 9 / 14 / 13 / 16 (uniform would be 13.0 each).
- **dev-20261108T031044Z-webllm-qwen3-5-2b-q4f32-nvidia** (webllm/qwen3.5-2b-q4f32/nvidia):
  - Dev_Run D, request level: acceptable 38/74 (51.4%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 37/72 (51.4%) against 55.6%. Illegal requests: 4.
  - Dev_Run D, shuffle: 8 of 48 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 17 cards with at least two valid picks, 11 kept the same option in every order and 0 kept the same shown position in every order.
  - Dev_Run D, 2-option cards, 2 valid picks: by original position 1 / 1; by shown position 1 / 1 (uniform would be 1.0 each).
  - Dev_Run D, 4-option cards, 68 valid picks: by original position 36 / 3 / 18 / 11; by shown position 10 / 16 / 20 / 22 (uniform would be 17.0 each).
- **dev-20261108T032233Z-webllm-qwen3-5-0-8b-q4f32-nvidia** (webllm/qwen3.5-0.8b-q4f32/nvidia):
  - Dev_Run D, request level: acceptable 44/74 (59.5%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 43/72 (59.7%) against 55.6%. Illegal requests: 2.
  - Dev_Run D, shuffle: 14 of 52 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 18 cards with at least two valid picks, 10 kept the same option in every order and 0 kept the same shown position in every order.
  - Dev_Run D, 2-option cards, 2 valid picks: by original position 1 / 1; by shown position 1 / 1 (uniform would be 1.0 each).
  - Dev_Run D, 4-option cards, 70 valid picks: by original position 24 / 6 / 26 / 14; by shown position 10 / 22 / 16 / 22 (uniform would be 17.5 each).
- **dev-20261108T035336Z-webllm-qwen3-5-0-8b-q4f32-nvidia** (webllm/qwen3.5-0.8b-q4f32/nvidia):
  - Dev_Run D, request level: acceptable 43/74 (58.1%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 41/72 (56.9%) against 55.6%. Illegal requests: 2.
  - Dev_Run D, shuffle: 10 of 52 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 18 cards with at least two valid picks, 12 kept the same option in every order and 0 kept the same shown position in every order.
  - Dev_Run D, 2-option cards, 2 valid picks: by original position 2 / 0; by shown position 2 / 0 (uniform would be 1.0 each).
  - Dev_Run D, 4-option cards, 70 valid picks: by original position 23 / 7 / 30 / 10; by shown position 12 / 22 / 15 / 21 (uniform would be 17.5 each).
- **dev-20261108T040130Z-webllm-qwen3-5-2b-q4f32-nvidia** (webllm/qwen3.5-2b-q4f32/nvidia):
  - Dev_Run D, request level: acceptable 34/74 (45.9%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 33/72 (45.8%) against 55.6%. Illegal requests: 8.
  - Dev_Run D, shuffle: 7 of 46 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 16 cards with at least two valid picks, 11 kept the same option in every order and 0 kept the same shown position in every order.
  - Dev_Run D, 2-option cards, 2 valid picks: by original position 1 / 1; by shown position 1 / 1 (uniform would be 1.0 each).
  - Dev_Run D, 4-option cards, 64 valid picks: by original position 35 / 1 / 18 / 10; by shown position 12 / 15 / 15 / 22 (uniform would be 16.0 each).
- **dev-20261108T041937Z-webllm-qwen3-5-0-8b-q4f32-intel** (webllm/qwen3.5-0.8b-q4f32/intel):
  - Dev_Run D, request level: acceptable 43/74 (58.1%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 41/72 (56.9%) against 55.6%. Illegal requests: 2.
  - Dev_Run D, shuffle: 10 of 52 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 18 cards with at least two valid picks, 12 kept the same option in every order and 0 kept the same shown position in every order.
  - Dev_Run D, 2-option cards, 2 valid picks: by original position 2 / 0; by shown position 2 / 0 (uniform would be 1.0 each).
  - Dev_Run D, 4-option cards, 70 valid picks: by original position 23 / 7 / 30 / 10; by shown position 12 / 22 / 15 / 21 (uniform would be 17.5 each).
- **dev-20261108T043623Z-webllm-qwen3-5-0-8b-q4f32-intel** (webllm/qwen3.5-0.8b-q4f32/intel):
  - Dev_Run D, request level: acceptable 43/74 (58.1%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 41/72 (56.9%) against 55.6%. Illegal requests: 2.
  - Dev_Run D, shuffle: 10 of 52 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 18 cards with at least two valid picks, 12 kept the same option in every order and 0 kept the same shown position in every order.
  - Dev_Run D, 2-option cards, 2 valid picks: by original position 2 / 0; by shown position 2 / 0 (uniform would be 1.0 each).
  - Dev_Run D, 4-option cards, 70 valid picks: by original position 23 / 7 / 30 / 10; by shown position 12 / 22 / 15 / 21 (uniform would be 17.5 each).
- **dev-20261108T044612Z-webllm-qwen3-5-0-8b-q4f32-intel** (webllm/qwen3.5-0.8b-q4f32/intel):
  - Dev_Run D, request level: acceptable 0/74 (0.0%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 0/72 (0.0%) against 55.6%. Illegal requests: 74.
  - Dev_Run D, shuffle: 0 of 0 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 0 cards with at least two valid picks, 0 kept the same option in every order and 0 kept the same shown position in every order.
- **dev-20261108T101109Z-workers-ai-gemma-4-26b-a4b-it** (workers-ai/gemma-4-26b-a4b-it):
  - Dev_Run D, request level: acceptable 62/74 (83.8%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 60/72 (83.3%) against 55.6%. Illegal requests: 1.
  - Dev_Run D, shuffle: 9 of 53 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 18 cards with at least two valid picks, 12 kept the same option in every order and 0 kept the same shown position in every order.
  - Dev_Run D, 2-option cards, 2 valid picks: by original position 2 / 0; by shown position 2 / 0 (uniform would be 1.0 each).
  - Dev_Run D, 4-option cards, 71 valid picks: by original position 48 / 12 / 11 / 0; by shown position 16 / 10 / 15 / 30 (uniform would be 17.8 each).
- **dev-20261109T151057Z-workers-ai-clef-flash** (workers-ai/clef-flash):
  - Dev_Run D, request level: acceptable 66/74 (89.2%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 64/72 (88.9%) against 55.6%. Illegal requests: 0.
  - Dev_Run D, shuffle: 0 of 54 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 18 cards with at least two valid picks, 18 kept the same option in every order and 0 kept the same shown position in every order.
  - Dev_Run D, 2-option cards, 2 valid picks: by original position 2 / 0; by shown position 2 / 0 (uniform would be 1.0 each).
  - Dev_Run D, 4-option cards, 72 valid picks: by original position 52 / 16 / 4 / 0; by shown position 18 / 6 / 18 / 30 (uniform would be 18.0 each).
- **dev-20261109T152355Z-workers-ai-clef** (workers-ai/clef):
  - Dev_Run D, request level: acceptable 58/74 (78.4%) against a random baseline of 55.4% (expected 41.0 of 74); Scored_Cards' requests only: 56/72 (77.8%) against 55.6%. Illegal requests: 0.
  - Dev_Run D, shuffle: 0 of 54 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 18 cards with at least two valid picks, 18 kept the same option in every order and 0 kept the same shown position in every order.
  - Dev_Run D, 2-option cards, 2 valid picks: by original position 2 / 0; by shown position 2 / 0 (uniform would be 1.0 each).
  - Dev_Run D, 4-option cards, 72 valid picks: by original position 36 / 16 / 20 / 0; by shown position 18 / 14 / 18 / 22 (uniform would be 18.0 each).
- **derived-dev-dev-20261109T151057Z-workers-ai-clef-flash-perm_avg-v1** (workers-ai/clef-flash/perm_avg):
  - Dev_Run D, request level: acceptable 18/20 (90.0%) against a random baseline of 55.0% (expected 11.0 of 20); Scored_Cards' requests only: 16/18 (88.9%) against 55.6%. Illegal requests: 0.
  - Dev_Run D, shuffle: 0 of 0 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 0 cards with at least two valid picks, 0 kept the same option in every order and 0 kept the same shown position in every order.
  - Dev_Run D, 2-option cards, 2 valid picks: by original position 2 / 0; by shown position 2 / 0 (uniform would be 1.0 each).
  - Dev_Run D, 4-option cards, 18 valid picks: by original position 13 / 4 / 1 / 0; by shown position 13 / 4 / 1 / 0 (uniform would be 4.5 each).
- **derived-dev-dev-20261109T152355Z-workers-ai-clef-perm_avg-v1** (workers-ai/clef/perm_avg):
  - Dev_Run D, request level: acceptable 16/20 (80.0%) against a random baseline of 55.0% (expected 11.0 of 20); Scored_Cards' requests only: 14/18 (77.8%) against 55.6%. Illegal requests: 0.
  - Dev_Run D, shuffle: 0 of 0 comparisons against the base pick changed the chosen option (only comparisons where both picks are valid options; a timeout or an Illegal output is left out here, while the Flip rate in the Metrics counts it as a Flip, R13.2, and counts Scored_Cards only); of 0 cards with at least two valid picks, 0 kept the same option in every order and 0 kept the same shown position in every order.
  - Dev_Run D, 2-option cards, 2 valid picks: by original position 2 / 0; by shown position 2 / 0 (uniform would be 1.0 each).
  - Dev_Run D, 4-option cards, 18 valid picks: by original position 9 / 4 / 5 / 0; by shown position 9 / 4 / 5 / 0 (uniform would be 4.5 each).

## 13. Note on fine-tuning

External workbenches discussed fine-tuning small models and teacher tests; this is outside the main line of this spec and nothing in this Report depends on it.
