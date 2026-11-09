# LLM probe report

Generated on 2026-11-09 by `probe report` from the ledger, the Locked_Run Results and grades, the performance records, the failure, preflight, Exclusion and Smoke_Call records, `combinations.json` and the approvals on `HEAD`.
The Report recommends; it does not decide. Every Metric, interval and performance figure behind a mark or a recommendation comes from Locked_Run Results only (R15.2). This file names Card IDs, Contrast_Pair IDs and scenario-group counts only, and no card content.

## 1. Target_Machine, browser version and network conditions

Target_Machine: NVIDIA GeForce RTX 3050 Ti Laptop GPU (4,096 MiB VRAM, driver 615.78.08), Intel UHD Graphics (TigerLake-H GT1), Intel i7-11800H (16 threads), 15 GiB RAM, Linux, Chrome 155.

| Combination | Ledger entry | GPU used | WebGPU adapter (vendor / architecture / device / description) | Browser version | Measurement source |
| --- | --- | --- | --- | --- | --- |
| webllm/qwen3.5-0.8b-q4f32/nvidia | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | NVIDIA discrete GPU | nvidia / ampere / unknown / unknown | Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36 | headless |
| webllm/qwen3.5-2b-q4f32/nvidia | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | NVIDIA discrete GPU | nvidia / ampere / unknown / unknown | Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/155.0.0.0 Safari/537.36 | headless |
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
| workers-ai/gemma-4-26b-a4b-it | D | 738 | 1036 | 235 | 1 | 0 |  |
| workers-ai/gemma-4-26b-a4b-it | S | 3030 | 6024 | 88 | 0 | 0 |  |

| Combination | Ledger entry | Source | Cold start, empty cache, ms | Cold start, warm cache, ms | Model download | Runtime download | NVIDIA device memory.used delta, MiB | Intel iGPU peak memory, MiB (quantity named) | Limits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| webllm/qwen3.5-0.8b-q4f32/nvidia | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | headless | 70876 | 5137 | 437021473 B (416.8 MiB) | 13382539 B (12.8 MiB) | 1783 | — | within |
| webllm/qwen3.5-2b-q4f32/nvidia | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | headless | 243841 | 6444 | 1072781587 B (1023.1 MiB) | 13399008 B (12.8 MiB) | 2461 | — | within |
| workers-ai/gemma-4-26b-a4b-it | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | REST API (local Probe_Runner) | not applicable | not applicable | not applicable | not applicable | not applicable | not applicable | within |

Intel iGPU figures are never put in the NVIDIA column. The Intel quantity is either "Chrome GPU process peak RSS (excludes unmapped GEM buffers)" or the i915 debugfs / `intel_gpu_top` source, and it is named in the cell.

## 7. Ledger entries per Model_Key and Task_Type

| Model_Key | Task | Entry | Status | Role | Metrics |
| --- | --- | --- | --- | --- | --- |
| webllm / Qwen3.5-0.8B-q4f32_1-MLC / q4f32_1 / 4ed017713f04 | D | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | complete | used for marks and recommendation | acceptable 35/60 (58.3%), severe 8, flips 81/172, contrast 0/15; fail |
| webllm / Qwen3.5-0.8B-q4f32_1-MLC / q4f32_1 / 4ed017713f04 | S | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | complete | used for marks and recommendation | acceptable 7/40 (17.5%), severe 4, flips 11/44, contrast 0/10; fail |
| webllm / Qwen3.5-2B-q4f32_1-MLC / q4f32_1 / d835e5c41aa5 | D | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | complete | used for marks and recommendation | acceptable 36/60 (60.0%), severe 3, flips 72/172, contrast 0/15; fail |
| webllm / Qwen3.5-2B-q4f32_1-MLC / q4f32_1 / d835e5c41aa5 | S | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | complete | used for marks and recommendation | acceptable 0/40 (0.0%), severe 2, flips 3/44, contrast 0/10; fail |
| workers-ai / @cf/google/gemma-4-26b-a4b-it / server-side, not pinnable | D | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | complete | used for marks and recommendation | acceptable 51/60 (85.0%), severe 2, flips 36/172, contrast 3/15; fail |
| workers-ai / @cf/google/gemma-4-26b-a4b-it / server-side, not pinnable | S | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | complete | used for marks and recommendation | acceptable 34/40 (85.0%), severe 0, flips 10/44, contrast 6/10; fail |

## 8. Support marks per link of the fallback chain

| Task | Link | Mark | Evidence (ledger entry IDs) |
| --- | --- | --- | --- |
| D | In-browser: transformers.js | not supported | transformers.js/qwen3.5-0.8b-q4/nvidia: Exclusion_Record (preflight_vram); transformers.js/qwen3.5-2b-q4/nvidia: Exclusion_Record (preflight_vram); transformers.js/lfm2.5-1.2b-instruct-q4/nvidia: Exclusion_Record (preflight_vram) |
| D | In-browser: webllm | not supported | webllm/qwen3.5-0.8b-q4f32/nvidia: entry L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia did not pass; webllm/qwen3.5-2b-q4f32/nvidia: entry L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia did not pass |
| D | Workers AI | not supported | workers-ai/gemma-4-26b-a4b-it: entry L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it did not pass |
| D | Rules_Default | supported | always supported |
| S | In-browser: transformers.js | not supported | transformers.js/qwen3.5-0.8b-q4/nvidia: Exclusion_Record (preflight_vram); transformers.js/qwen3.5-2b-q4/nvidia: Exclusion_Record (preflight_vram); transformers.js/lfm2.5-1.2b-instruct-q4/nvidia: Exclusion_Record (preflight_vram) |
| S | In-browser: webllm | not supported | webllm/qwen3.5-0.8b-q4f32/nvidia: entry L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia did not pass; webllm/qwen3.5-2b-q4f32/nvidia: entry L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia did not pass |
| S | Workers AI | not supported | workers-ai/gemma-4-26b-a4b-it: entry L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it did not pass |
| S | Rules_Default | supported | always supported |

Smoke_Call outputs appear only in this section; they never enter a Metric, a pass or fail mark or an interval (R18.6).

## 9. Recommendation per Task_Type

The in-browser conclusion covers only Qwen3.5 on WebLLM. The Workers AI conclusion covers only gemma-4-26b-a4b-it with the frozen templates, thinking disabled and one call per request; it does not represent other models on Workers AI or other ways of calling them.

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
- workers-ai/gemma-4-26b-a4b-it, D (entry L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it): failed Thresholds: severe count 2, above 1; flip rate 36/172 = 20.9%, above 5%; contrast consistency 3/15 = 20.0%, below 80%
- workers-ai/gemma-4-26b-a4b-it, S (entry L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it): failed Thresholds: flip rate 10/44 = 22.7%, above 5%; contrast consistency 6/10 = 60.0%, below 80%
- transformers.js/qwen3.5-0.8b-q4/nvidia: excluded, see section 3 (preflight_vram)
- transformers.js/qwen3.5-2b-q4/nvidia: excluded, see section 3 (preflight_vram)
- transformers.js/lfm2.5-1.2b-instruct-q4/nvidia: excluded, see section 3 (preflight_vram)

### Engine faults (runtime_stuck) and engine rebuild failures (rebuild_failed)

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

## Quality without timeout (not used for any mark, label or recommendation)

Same denominator as the Metrics, but each timed-out base output that has a Late_Answer is replaced by the grade of that Late_Answer. A timeout without a Late_Answer stays Illegal.

| Combination | Task | Entry | Acceptable rate, without timeout | Severe count, without timeout | Illegal rate, without timeout | Timeouts replaced by a Late_Answer |
| --- | --- | --- | --- | --- | --- | --- |
| webllm/qwen3.5-0.8b-q4f32/nvidia | D | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | 35/60 (58.3%) | 8 | 0/60 (0.0%) | 0 |
| webllm/qwen3.5-0.8b-q4f32/nvidia | S | L-20261108T081803Z-webllm-qwen3-5-0-8b-q4f32-nvidia | 7/40 (17.5%) | 7 | 4/40 (10.0%) | 8 |
| webllm/qwen3.5-2b-q4f32/nvidia | D | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | 38/60 (63.3%) | 3 | 0/60 (0.0%) | 2 |
| webllm/qwen3.5-2b-q4f32/nvidia | S | L-20261108T084653Z-webllm-qwen3-5-2b-q4f32-nvidia | 1/40 (2.5%) | 12 | 7/40 (17.5%) | 38 |
| workers-ai/gemma-4-26b-a4b-it | D | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | 51/60 (85.0%) | 2 | 0/60 (0.0%) | 0 |
| workers-ai/gemma-4-26b-a4b-it | S | L-20261109T014137Z-workers-ai-gemma-4-26b-a4b-it | 34/40 (85.0%) | 0 | 0/40 (0.0%) | 0 |

## Dev_Run figures (not used for the recommendation)

These are Dev_Run figures. They are kept out of every mark and out of the recommendation. The Intel iGPU Dev_Run appears only here.

Position/content confound in the dev set: in `dev.jsonl` all 15 scored D cards that have a severe option list it last in card order (the two unscored two-option Sanity_Cards do too). Option rotation was applied only to the locked set; this was an oversight on the card-authoring side, and the cards are locked and are not changed. So in the Dev_Runs a model that prefers the last-listed option cannot be told apart from one that prefers the severe content. Per the Author, the severe options of the locked set are distributed last 14, middle 26, first 7. The position-versus-content question is therefore to be settled from the Locked_Run results, not from the Dev_Runs.

Intel iGPU finding (Dev_Run, corrected run dev-20261108T044612Z-webllm-qwen3-5-0-8b-q4f32-intel, device_mismatch false): all 74 D requests hit the 10 s timeout; the Late_Answers arrived after 11,975 / 14,955 / 17,495 ms (min / median / max), about 6.7 times the 2,245 ms NVIDIA median of the same Combination. In S, 3 requests timed out and 27 ended in `runtime_error` ("The current Object has already been disposed") after the repeated timeouts; the cause was not investigated. So no Intel quality figure exists for the frozen templates; the run shows a latency result only: the Intel iGPU cannot meet the 10 s limit for the 0.8B. The two earlier Intel-labelled runs are INVALID (device_mismatch) and show no Intel figure.

| Dev_Run | Combination | GPU | Task | Acceptable (Dev_Run, base cards) | Severe (base cards) | Severe in other Permutations | Flips (non-base requests with an output) | Contrast pairs | Latency p50 / p95, ms (nearest rank, all requests with text) | NVIDIA device memory.used delta, MiB | Intel iGPU peak memory, MiB (quantity named) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dev-20261108T012419Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | D | 0/18 (0.0%); random baseline 55.6% | 0 | 0 | 0/54 | 0/6 | 1884 / 2283 | 1769 | — |
| dev-20261108T012419Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | S | 0/12 (0.0%) | 0 | 0 | 0/16 | 0/4 | 6716 / 8784 | 1769 | — |
| dev-20261108T013732Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | D | 0/18 (0.0%); random baseline 55.6% | 0 | 0 | 0/54 | 0/6 | 1903 / 2294 | 1769 | — |
| dev-20261108T013732Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | S | 0/12 (0.0%) | 0 | 0 | 0/16 | 0/4 | 6718 / 8743 | 1769 | — |
| dev-20261108T014704Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | D | 6/18 (33.3%); random baseline 55.6% | 1 | 5 | 25/54 | 0/6 | 1894 / 2283 | 1769 | — |
| dev-20261108T014704Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | S | 1/12 (8.3%) | 1 | 3 | 10/16 | 0/4 | 6741 / 8817 | 1769 | — |
| dev-20261108T020924Z-webllm-qwen3-5-2b-q4f32-nvidia | webllm/qwen3.5-2b-q4f32/nvidia | NVIDIA discrete GPU | D | 9/18 (50.0%); random baseline 55.6% | 3 | 11 | 12/54 | 0/6 | 3938 / 9881 | 2461 | — |
| dev-20261108T020924Z-webllm-qwen3-5-2b-q4f32-nvidia | webllm/qwen3.5-2b-q4f32/nvidia | NVIDIA discrete GPU | S | 2/12 (16.7%) | 2 | 1 | 4/16 | 0/4 | 8102 / 9508 | 2461 | — |
| dev-20261108T022959Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | D | 9/18 (50.0%); random baseline 55.6% | 5 | 5 | 12/54 | 0/6 | 2237 / 2612 | 1769 | — |
| dev-20261108T022959Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | S | 2/12 (16.7%) | 3 | 3 | 9/16 | 0/4 | 6431 / 9683 | 1769 | — |
| dev-20261108T024005Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | S | 1/12 (8.3%) | 2 | 3 | 9/16 | 0/4 | 5513 / 8203 | 1746 | — |
| dev-20261108T024508Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | S | 2/12 (16.7%) | 3 | 7 | 10/16 | 0/4 | 5897 / 8690 | 1754 | — |
| dev-20261108T025126Z-webllm-qwen3-5-2b-q4f32-nvidia | webllm/qwen3.5-2b-q4f32/nvidia | NVIDIA discrete GPU | D | 6/18 (33.3%); random baseline 55.6% | 2 | 6 | 4/54 | 0/6 | 4457 / 9389 | 2455 | — |
| dev-20261108T025126Z-webllm-qwen3-5-2b-q4f32-nvidia | webllm/qwen3.5-2b-q4f32/nvidia | NVIDIA discrete GPU | S | 1/12 (8.3%) | 1 | 1 | 3/16 | 0/4 | 8507 / 9533 | 2455 | — |
| dev-20261108T031044Z-webllm-qwen3-5-2b-q4f32-nvidia | webllm/qwen3.5-2b-q4f32/nvidia | NVIDIA discrete GPU | D | 10/18 (55.6%); random baseline 55.6% | 2 | 9 | 14/54 | 0/6 | 4467 / 9224 | 2385 | — |
| dev-20261108T032118Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | D | 0/18 (0.0%); random baseline 55.6% | 0 | 0 | 0/0 (not computable) | 0/6 | no data / no data | not measured: no perf record | not measured: no perf record |
| dev-20261108T032233Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | D | 9/18 (50.0%); random baseline 55.6% | 5 | 5 | 16/54 | 0/6 | 2320 / 2693 | 1714 | — |
| dev-20261108T035336Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | D | 9/18 (50.0%); random baseline 55.6% | 5 | 5 | 12/54 | 0/6 | 2245 / 2623 | 1761 | — |
| dev-20261108T035336Z-webllm-qwen3-5-0-8b-q4f32-nvidia | webllm/qwen3.5-0.8b-q4f32/nvidia | NVIDIA discrete GPU | S | 1/12 (8.3%) | 2 | 3 | 9/16 | 0/4 | 5527 / 8408 | 1761 | — |
| dev-20261108T040130Z-webllm-qwen3-5-2b-q4f32-nvidia | webllm/qwen3.5-2b-q4f32/nvidia | NVIDIA discrete GPU | D | 8/18 (44.4%); random baseline 55.6% | 2 | 8 | 11/54 | 0/6 | 4488 / 9238 | 2461 | — |
| dev-20261108T040130Z-webllm-qwen3-5-2b-q4f32-nvidia | webllm/qwen3.5-2b-q4f32/nvidia | NVIDIA discrete GPU | S | 1/12 (8.3%) | 1 | 1 | 3/16 | 0/4 | 8692 / 9723 | 2461 | — |
| dev-20261108T041937Z-webllm-qwen3-5-0-8b-q4f32-intel | webllm/qwen3.5-0.8b-q4f32/intel | INVALID: Intel adapter reported, but the work ran on the NVIDIA GPU (device_mismatch) | D | 9/18 (50.0%); random baseline 55.6% | 5 | 5 | 12/54 | 0/6 | 2243 / 2613 | — | INVALID (device_mismatch): NVIDIA memory rose during this run, so these are not Intel figures |
| dev-20261108T041937Z-webllm-qwen3-5-0-8b-q4f32-intel | webllm/qwen3.5-0.8b-q4f32/intel | INVALID: Intel adapter reported, but the work ran on the NVIDIA GPU (device_mismatch) | S | 1/12 (8.3%) | 2 | 3 | 9/16 | 0/4 | 5536 / 8377 | — | INVALID (device_mismatch): NVIDIA memory rose during this run, so these are not Intel figures |
| dev-20261108T043623Z-webllm-qwen3-5-0-8b-q4f32-intel | webllm/qwen3.5-0.8b-q4f32/intel | INVALID: Intel adapter reported, but the work ran on the NVIDIA GPU (device_mismatch) | D | 9/18 (50.0%); random baseline 55.6% | 5 | 5 | 12/54 | 0/6 | 2231 / 2608 | — | INVALID (device_mismatch): NVIDIA memory rose during this run, so these are not Intel figures |
| dev-20261108T043623Z-webllm-qwen3-5-0-8b-q4f32-intel | webllm/qwen3.5-0.8b-q4f32/intel | INVALID: Intel adapter reported, but the work ran on the NVIDIA GPU (device_mismatch) | S | 1/12 (8.3%) | 2 | 3 | 9/16 | 0/4 | 5423 / 8225 | — | INVALID (device_mismatch): NVIDIA memory rose during this run, so these are not Intel figures |
| dev-20261108T044612Z-webllm-qwen3-5-0-8b-q4f32-intel | webllm/qwen3.5-0.8b-q4f32/intel | Intel integrated GPU | D | 0/18 (0.0%); random baseline 55.6% | 0 | 0 | 0/54 | 0/6 | no data / no data | — | 492 — Chrome GPU process peak RSS (excludes unmapped GEM buffers) |
| dev-20261108T044612Z-webllm-qwen3-5-0-8b-q4f32-intel | webllm/qwen3.5-0.8b-q4f32/intel | Intel integrated GPU | S | 0/12 (0.0%) | 0 | 0 | 0/16 | 0/4 | no data / no data | — | 492 — Chrome GPU process peak RSS (excludes unmapped GEM buffers) |
| dev-20261108T101109Z-workers-ai-gemma-4-26b-a4b-it | workers-ai/gemma-4-26b-a4b-it | not applicable (server side) | D | 16/18 (88.9%); random baseline 55.6% | 0 | 0 | 10/54 | 2/6 | 798 / 1672 | not applicable | not applicable |
| dev-20261108T101109Z-workers-ai-gemma-4-26b-a4b-it | workers-ai/gemma-4-26b-a4b-it | not applicable (server side) | S | 11/12 (91.7%) | 0 | 1 | 4/16 | 3/4 | 4186 / 8288 | not applicable | not applicable |

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
