# Spec 9 + Spec 10 LU-P2 release

## Authority and frozen candidate

The Author reports final independent Spec review PASS and grants combined LU-P2 publication at runtime baseline `582932444c1632880b0cd2480aad21778d33b6c3`. Later exact v3/v4 prompt revisions are explicitly confirmed; the native release obstacle is repaired only in tests. Spec9 LU-P1 and the local own-obituary trial remain accepted. Both existing sites are published and technically verified on v4 source `05794477dab0504fbfd207d0ffa346761512b507`; the real86-word sample facts pass. Final Author wording experience remains pending. Historical failures and prior terminal words are not rewritten into passes.

The original `life-unfolds` checkout, its uncommitted planning/history and other work remain untouched. A detached release worktree starts from the exact reviewed baseline. Remote main was `cb264943170bf9fbe315f9704d15e1e6dc03cb71`, an ancestor with no remote-only changes. The exact approved baseline was pushed to main without force or an additional runtime change. Initial [deploy/publisher46100827494/1](https://github.com/zbf1009/back-in-the-family/actions/runs/46100827494/attempts/1) and dependent [Judge46103145206/1](https://github.com/zbf1009/back-in-the-family/actions/runs/46103145206/attempts/1) both completed SUCCESS, including full ordinary gates and checked disabled→prerequisites→enabled Judge publication.

## Preserved release and verification boundaries

- Existing public `back-in-the-family` and private `back-in-the-family-judge` only, using `.github/workflows/deploy.yml` and its dependent `.github/workflows/deploy-judge.yml`. Main must pass full gates for its SHA. Normal `cloudflare-deploy` publisher behavior is retained, generic inference defaults off, and no private Judge package is made public.
- Wait for both chains to finish before any next main push, including documents. Judge uses checked disabled→native prerequisite checks→enabled publication on the same owned SQLite namespace.
- JUDGE_CODE existence was checked without reading its value. Namespace `94ccd70c31864da69594838a4baeda91`, pool and counters remain unchanged. Existing limits remain 40 admissions per UTC day and 10 per session lifetime, TTL 86400 seconds; no refund/reset/session churn or replacement account/Worker/namespace.
- Only IntegrationOwner makes real calls, serially, maintaining a cumulative release ledger. The grant is ten total across calibration/validation/repairs, not ten per round. Timeout/failure/possibly-dispatched calls count. If authorization or current quota is exhausted before the goal is met, request further authorization or the Author's next direction; do not skip required proof or dispatch unauthorized requests.
- Actual deaths must come from live Start/legal controls; no injected World/facts/ledger or replay import. Avoid unrelated Dream/Bribe decision calls. Each death has only its original one-shot attempt. Exports, CI and zero-model online checks do not dispatch models.
- Model/options stay `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, max_tokens256, temperature0.3, streamfalse, returnRawResponsetrue. Initial v2 prompt/digest and failed v2/v3 terminal words remain historical; current approved v4 is `c51dde03bb73f20c7b7254bc1f1acde660a0a456f9b7d93cd9906a6d38de0954`. Every revision requires Author confirmation and new version/digest for later actual deaths only, never regeneration of terminal records.
- No new feature, P3 refactor, game/economy/RNG/checksum/replay-v5 change, budget increase, payment activation or switch-policy change.

## Retained local prerequisites

Complete ordinary and Judge prerequisites are green through original successful portions, repairs and previously unrun remainders—not a claim that every historical full run exited zero. `docs/kiro-log.md` in the original worktree records Spec 9 completion at lines4442–4443 and Spec10 at4539–4545. Final Spec10 affected run `target/life-unfolds/obituary-final-affected-gates.log` exits0; Web488, Judge unit27/runtime41/artifact78 pass. Repair `20c227a` has 24 production-App browser cases, 13 workerd/SQLite cases (including claims-driven primary-key cleanup), final types/build and six affected artifact cases. Final `5829324` has eight capability/deadline/UTC browser regressions, zero-error type checks and checked production build. Reports and original failures remain under original `target/life-unfolds/obituary-*.{json,log}`. Controlled clocks/FakeAI are not real network-race or model-quality proof.

The checked candidate contains registered artwork, exact user-facing Credits, source/modification provenance, full CC0/CC-BY terms and Character portrait kit attribution, root Apache LICENSE, and the existing artifact NOTICE/dependency/license closure. Source-bound artifact checks verify committed input paths/blobs rather than relying on uncommitted licenses.

## Stable deployment and safety path

| Existing target | Previous stable deployment | Previous stable version |
|---|---|---|
| Public | 48bacce1-5414-49a1-9309-b9f27c0b4feb | 7a1f7532-4c93-4192-8023-95c9013b8b3b |
| Judge | 698a6e0f-e870-4657-b970-17c967962287 | 974ee276-e6d8-4a6a-aeb4-38775a546d8d |

Read-only preflight observed2026-11-28T02:58:55.142Z. The previous accepted main/static/publisher is45361194843/1 and Judge45364401590/1, sourcecb264943, public artifact refd4791af7205ba59089724b48127274552bf8569c. Required GitHub deployment credentials exist; values were not read. Judge alias is enabled with preview/version URLs off; AI/ASSETS, inference=true,16384-byte cap and40/10 policy match existing config.

Dual-site switching is not atomic. On Judge activation failure the existing workflow republishes the same checked disabled variant. Prefer that safety path or scoped repair through the same main pipeline. If a stable rollback is necessary, use only the recorded checked stable versions at100% traffic, or the prior checked Judge disabled version57f6d29b-9b51-426c-815d-ede190ea2325. Check actual deployment identity afterward. No DO data restoration, admission reset, Secret rotation or namespace recreation; [Cloudflare rollback changes deployments, not connected data](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

## Initial release and live calibration

| Observed initial release | Identity |
|---|---|
| Main source | `582932444c1632880b0cd2480aad21778d33b6c3` |
| Public deployment / version | `c2071756-5c0f-4716-8b32-1ea90cd0879a` / `6b2fc636-ab1e-43a5-ba67-a6baa99f53eb` |
| Judge enabled deployment / version | `3564d3c5-ecaa-4d98-b763-f83dab44005e` / `24e901f1-b4a1-47a2-b5fc-0f05ea6c4ea7` |
| Judge checked disabled predecessor | `73c38e5a-7668-4f13-8b4c-6188c8fe3189` / `540711de-7fb6-45b8-8d47-82325024d4a0` |
| Producer artifact | `15246452575`, raw ZIP SHA256 `6e7aee1b8fc0a347b42cf7b9a7562ec8d8347a669734b1c44ddc78c9ac27fcef` |
| Producer envelope | `1d368abdd591f426922fdebec137617f03055b241fe9845caf9f082be037fa3e` |
| Public artifact ref | `8ec0fbd4443c48ccbfb2882bade89350fbd64ab1` |
| Private Judge artifact | `15246054440`, raw ZIP SHA256 `e518bbd9b2b899cf7bee5667e1c107fee891341141995c641983e30432cad563` |
| Judge manifest | `edd8a5f7789c2192636553d4e0a1defebcc32a9df1d16e59c26eccc317b73203` |

The received archives independently match authenticated GitHub digests; Judge manifest binds that exact producer source/run/attempt, artifact/archive/envelope. Both sites' ten deployed files match every checked asset's SHA256 and size. The actual Credits page was read. Independent tabs preserve the Author's existing games. One existing private code login succeeded; no repeated login, browser/session change or quota bypass. The initial navigation wait timed out, but the already successful200 login and subsequently loaded page were inspected instead of logging in again.

Public Start seed1205/town50 and three legal Ask-for-your-money choices reach Nadine Bradley,60, own Death2368/body10/tick5372; first status5373/checksum8a1b9da5de15bb91. Exact seven-line template and Skip reveal pass with unchanged5373. Public model POST count is0. Chrome's second-download permission initially held the sidecar; the Author allowed multiple downloads and the original pending sidecar arrived. Public raw pair replay SHA256 `3ddacc91ac84043bde450ba4a5d0051b415ad48527e18c653ff20c98eafa55a5` matches the sidecar; facts/terminal words match the page and native replay returns `ok`.

First real attempt uses the same actual Start/legal choices on Judge. Frozen facts retain surviving husbandMarvin Jenkins, sonMarcus Bradley, grandsonsBen/Leo Rhodes and predeceased husbandClifford Bradley; four demands to three people, four distinct loans with repayments, estate229012 to Marcus/Marvin, and two people burning joss paper. OperationKey `4953bf7eeeb6c95a1bc361c9b0bcb830607032481976b4ba1334012616139fb7`; promptv2/digest above; HTTP200,1008 request bytes,3333ms transport. While narration remains pending, legal One day advances5373→5374; completion does not move that tick. Skip also leaves5374 unchanged. No decision model is dispatched.

**First real paragraph is lexically accepted but factual quality FAIL.** It says “4 debts paid on her behalf,” reversing the repayment recipient, and “Two joss burners were lit,” turning a count of people into objects. Original full text/facts/terminal are preserved unchanged in `target/lu-p2-release/attempt-001-online-proof.json`; no manual replacement or regeneration. Judge original raw pair replay SHA256 `e6bb235530a2d82e428f90fa63b1c9eab5cf949f9dd42e33fed7296530a753d9` matches its sidecar, exact page text/facts and native `ok`. Legal Borrow-a-body plus One day reaches5375; the unchanged card moves into `Your life as Nadine Bradley` history with0 direct current-reading cards. Full rebirth raw pair `dae13a30e722382d60f0bcdb58216665c957a1c92d43784c044c077dd4de074e` also matches sidecar/unchanged text and native `ok`. Exports add0 calls.

Server currentUTC day2026-11-28 returned40/10 immediately before the attempt and39/9 afterward. Release cumulative real calls **1/10**, decision calls0; no refund/reset. The cumulative ledger and qualified proofs are under release-worktree `target/lu-p2-release/`. Private local packets/proofs contain no Secret, reviewer code, Cookie or Token.

## Author-approved prompt clarification

The Author explicitly approves `obituary.author.v3`, SHA256 `d67a55a60f35902db5f3c4fa5d21b9610b60ae02a62b3f87b96a4a27690cdede`, by selecting approve_v3. It retains the initial instruction and appends definitions for repayment recipient, deceased-made demands/distinct debtors, people burning joss paper, and recorded distributed estate/heirs. Approved literal bytes are in `target/lu-p2-release/approved-prompt-v3.json` and the updated Obituary design. Runtime changes only the three shared prompt constants; current-attempt test provenance follows the shared identity instead of duplicated old literals. Original v2 terminal/data stay unchanged. Model/options, facts, budgets, World/replay and protected resources remain fixed.

Prompt calibration commit `716ef590e460f514fbddb7b1fc1bec85786cfa5b` contains only three owned runtime/test paths. Approved literal/version/SHA match independently;56 contract/memory cases,27 Judge unit cases, full Web types and the final valid-version mismatch/Node-type checks pass through preserved initial failures and narrow repairs. Independent correctness/regression/maintenance re-review has0 remaining findings; two obsolete current-test provenance assertions and one invalid-format version negative were separately confirmed and minimally repaired without changing the shipping validator. Unchanged generated native declarations and exact prepared dependencies were reused in the isolated release worktree; no native rules were rebuilt for the prompt edit. The candidate proceeds through the same full main/dependent-Judge CI; its terminal identities and subsequent actual-death quality proof are not yet claimed. Only after both chains succeed will v3 be used in a new actual death, within the same remaining nine-call authorization and surviving session quota. No existing terminal is regenerated.

## First v3 publication attempt — failed gate, no deployment

Producer [46105874445/1](https://github.com/zbf1009/back-in-the-family/actions/runs/46105874445/attempts/1) for `716ef590e460f514fbddb7b1fc1bec85786cfa5b` fails `Run gates`; publisher and dependent [Judge46106319315/1](https://github.com/zbf1009/back-in-the-family/actions/runs/46106319315/attempts/1) are skipped, not successful releases. Native Narrator property tests retain the exact failed seed5294597185254543075 and proptest persistence seed89e24c93b23db1646db789c9b08965561fc79f4cf6a3db13c6add6578a95db29: both assert global pending-empty after resolving their earlier node. Original job log is preserved in `target/lu-p2-release/ci-46105874445/failed-job.log`. No failed test is rerun merely to reconfirm this CI observation.

Read-only deployment metadata at2026-11-28T04:13:30.778Z confirms public remains6b2fc636-ab1e-43a5-ba67-a6baa99f53eb and Judge remains24e901f1-b4a1-47a2-b5fc-0f05ea6c4ea7 on their previous deployment IDs. Neither site received v3; no rollback/data restoration/reset is necessary. Real calls remain1/10. The native gate consumer is being investigated within test-only scope; any required game/rule/RNG/checksum/replay change would require an Author boundary decision instead of a silent repair.

## Test-only native gate repair

Commit `7885fabfb5b85312f49492adac5250137e6dc19b` changes only `crates/sim-core/tests/narrator.rs` and its existing proptest regression file. Source confirms step2c resolves the old node before step13a may fire a fresh node in that same tick; monotonic NodeIDs and fixture minimum/gap0 permit a different current pending node. The tests now require the old ID no longer be pending, preserving exact resolution tick, per-node Chronicle identity/count/source/applied/digest and100-case generators. The exact CI persistence seed is appended without replacing older regressions. Production Rust, params, rules, economy, RNG, checksum and replay are untouched.

`scripts/offline-gates.sh cargo test --locked --offline -p sim-core --test narrator` exits0 with31/31 passing, including persisted cases; affected rustfmt check exits0. Independent correctness/regression/maintenance review has0 candidates. Original failure remains failed; this is a consumer-contract repair, not a newly invented game rule or an online game mutation. Proof is `target/lu-p2-release/narrator-gate-{repair.log,review.json,format.log}`. The corrected source must still pass the full same-main ordinary and dependent Judge CI before v3 is used online.

## V3 checked republication and second real sample

Source `7885fabfb5b85312f49492adac5250137e6dc19b` completes [main46125232759/1](https://github.com/zbf1009/back-in-the-family/actions/runs/46125232759/attempts/1) and [Judge46127007056/1](https://github.com/zbf1009/back-in-the-family/actions/runs/46127007056/attempts/1), both SUCCESS. Full main gates, publisher and checked disabled→check→enabled Judge all pass; the prior46105874445 failure/46106319315 skip remain historical failures.

| V3 checked release | Identity |
|---|---|
| Public deployment / version | `2019d8df-260a-4028-be83-ad449a9f5e78` / `96df102b-9b9e-4bbc-a823-05f0621135f1` |
| Judge enabled deployment / version | `f70ba9aa-3fc2-4c62-8e36-415f2854e290` / `6cd5d008-876a-4d98-91f2-8d8a105df0a6` |
| Judge disabled predecessor version | `40818876-04c9-4564-885a-b9961e6ee0b1` |
| Producer artifact / raw ZIP SHA256 | `15256022792` / `5e334ec1b537f4dffa1c9644f06fd6a58a7a80b8451a867c93e617e76e0acf4a` |
| Producer envelope SHA256 | `412793ba04badda0b01c8faa2150f8be632ba60ecef31f4d4764843bebf5a9d4` |
| Public artifact ref | `6dcaf879f9613c21df294e08eeeae7808ba822e6` |
| Private Judge artifact / raw ZIP SHA256 | `15256660273` / `0369f86a0be103fa970d5e117304b1f63907f71297ca1888cde1504a970f8ef9` |
| Judge manifest SHA256 | `f7595e58769f729f8446154eaaad6135aba338619d60a738f6de23d66a9b3d55` |

Received archives match authenticated GitHub digests; Judge binds the exact producer source/run/attempt/artifact/archive/envelope. Both sites' ten deployed files match current checked hashes/sizes. New independent tabs use the same surviving session without another login; GET at08:50:01UTC returns39/day and9/session, preserving the first call's spend. Public v3 Start/three choices/death/Skip remains the exact template with tick5373 unchanged and0 model POSTs; raw replay `3ddacc91ac84043bde450ba4a5d0051b415ad48527e18c653ff20c98eafa55a5` matches its sidecar/page facts/text and native `ok`.

Second real death is generated by a new live Start seed1205/town50 and the same three legal choices, not a retry or regeneration of the earlier run. New run `4f953ad5-e062-4a89-b7f6-58237c0be6d3`, operationKey `966567aed4a722930fa32677c2264d457d0fcdad07b36c8e7984b7bbd6a9da98`, own Death2368/body10/tick5372, matching frozen facts. V3 returns HTTP200 in2008ms with1008 request bytes, one narration and0 decision POSTs. Step is requested while pending; its immediate DOM read still shows5373 and the terminal snapshot5374, so this is not presented as another independent pending-at5374 observation. Skip leaves5374 unchanged.

**Second real paragraph is lexically accepted but factual quality FAIL.** It corrects two people burning joss paper and the past-tense distributed estate, but still says “had4debts paid on her behalf,” reversing the repayment recipient. Original v3 words/facts/terminal remain untouched in `target/lu-p2-release/attempt-002-online-proof.json`. Its original raw replay `e6bb235530a2d82e428f90fa63b1c9eab5cf949f9dd42e33fed7296530a753d9` matches the sidecar and exact page facts/text; native returns `ok`. No export dispatches a model. Current cumulative real calls **2/10**, UTC-day/session remaining **38/8** at08:50:36UTC; no refunds or session/counter resets.

## Author-approved positive v4 wording

The Author selects approve_v4 for `obituary.author.v4`, SHA256 `c51dde03bb73f20c7b7254bc1f1acde660a0a456f9b7d93cd9906a6d38de0954`. It replaces the v3 field clarification with positive repayment wording and a generic supplied-name/count phrase, removing the negative example that the model repeated. Approved literal bytes are preserved in `target/lu-p2-release/approved-prompt-v4.json` and current Obituary design. Only the three shared prompt constants change; model/options, closed facts, validators, budgets, game/core and previous terminals remain unchanged. Exact approved bytes/hash, current contract/memory/Judge-unit checks and Web types pass. Independent review and checked republication precede later actual-death use; the subsequent real sample and factual reading are recorded below.

V4 calibration commit `05794477dab0504fbfd207d0ffa346761512b507` contains only the shared instruction file, changing its three constants. Independent correctness/regression/maintenance review has0 candidates;56 contract/memory cases,27 Judge unit cases, Web types and exact approved literal/version/SHA checks pass. Its full main46128864365/1 and dependent Judge46130496953/1 subsequently both succeed before the third real attempt. The preserved publication-stage ledger had2/10 calls; final verified usage is3/10 below.

## Verified v4 publication and third real sample

Source `05794477dab0504fbfd207d0ffa346761512b507` completes [main46128864365/1](https://github.com/zbf1009/back-in-the-family/actions/runs/46128864365/attempts/1) and [Judge46130496953/1](https://github.com/zbf1009/back-in-the-family/actions/runs/46130496953/attempts/1), both SUCCESS, with full gates/publisher and checked disabled→native checks→enabled deployment on the existing namespace.

| V4 verified release | Identity |
|---|---|
| Public deployment / version | `be8e68da-3a55-4149-a2a3-3f8b583e25b2` / `1cc83f87-db9a-4819-a6aa-1f7c4981e705` |
| Judge deployment / version | `531be386-c4d8-420e-a419-4f5c976e9738` / `edeba22f-0805-4ccb-ace5-d7e66bf9e2b0` |
| Judge disabled predecessor | `6b58aa1e-8094-44c5-8612-bbe895a5f033` / `9a54b73b-54be-413f-8575-3cb844c1693a` |
| Producer artifact / raw ZIP SHA256 | `15256999845` / `a74853010c55a9d42d771b03064149b93aab3ce7127fb6a5907aa0223ffa70a8` |
| Producer envelope SHA256 | `12fc26e0e7f72d99863e09bf2f4c8f944b3532c952fa62797af609dafac9479f` |
| Public artifact ref | `6a425c03dc068f1abe938825f3ecbcbdf4cb6fe9` |
| Private Judge artifact / raw ZIP SHA256 | `15258060401` / `0ec8bae679d72398b6671d29033eb14de19fa0504ccaf5cdde691542720e8c01` |
| Judge manifest SHA256 | `d14a37f7308e4db30a4a79d83e3ef35b01cceb48095397152e75122f746242be` |

Received raw archives independently match authenticated GitHub digests; Judge manifest binds that exact producer/source/artifact/envelope. Both sites' ten deployed files match every checked hash and size. Public v4 Start seed1205/town50, three real debt choices and own Death produce the exact seven-line template; Skip5373→5373 and replay/sidecar export use0 model POSTs. Original replaySHA `3ddacc91ac84043bde450ba4a5d0051b415ad48527e18c653ff20c98eafa55a5` and sidecarSHA `b093de44c7b6f3f1611641d98b97c52d5618736090c33ef680c55839dd9d54f8` are independently preserved, match page facts/text, and native replay returns `ok`.

The third actual Judge run starts normally under the same surviving session and uses the same legal seed1205/town50/three choices. Run `fc774119-77bf-4d5f-a510-7cea949a0e04`, own Death2368/body10/tick5372, operationKey `e6fb21c8cc68268a86a8d5029c046bccae146ca0c1a29d0f88396b42dc97b6da`. One real narration POST returns HTTP200,1008 request bytes,1844ms transport, sourceModel/v4/currentdigest and no fallback. No decision POST is dispatched.

While that attempt is still pending, legal One day advances5373→5374; Borrow-a-body plus One day reaches5375 while still pending. The naturally late paragraph then appears only in `Your life as Nadine Bradley` history, with0 direct current-reading cards. Skip5375→5375 leaves canonical time unchanged; Play/One day and existing legal controls remain available. No World/clock/ledger injection or artificial provider delay is used.

### Original accepted real paragraph — unchanged

> Nadine Bradley, 60, died on Year 15, Day 263. She is survived by her husband Marvin Jenkins, son Marcus Bradley, and grandsons Ben Rhodes and Leo Rhodes. She was preceded in death by her husband Clifford Bradley. Nadine Bradley received repayments on 4 loans. She made 4 demands for repayment to 3 individuals. Her estate, valued at $229,012, was distributed to her son Marcus Bradley and husband Marvin Jenkins. Two people burned joss paper on her death day. She is not expected to stay away long.

This86-word sample matches frozen real names/relations/age/date, receiving repayments on4 distinct loans,4 demands to3 people, recorded229012 estate toMarcus/Marvin, and2 people burning paper. No cause/job/hobby/unprovided place/feeling/quote is introduced. This is an executor factual reading of one successful real sample, not a corpus success-rate or final Author wording acceptance; earlier v2/v3 failures remain retained.

Original Judge replaySHA `dae13a30e722382d60f0bcdb58216665c957a1c92d43784c044c077dd4de074e` and sidecarSHA `d474eda5d9a718e79db515ff7e4fb3097fab685d3796dabe89e22bf6ee63ba3e` come from the same actual export reply after legal rebirth. Hash pairing, exact terminal words/facts/provenance against the page and native `ok` pass. Exports add0 calls. Proof: `target/lu-p2-release/{attempt-003-online-proof.json,final-v4-pair-proof.json,model-ledger.json}` and independently preserved original byte pairs under `downloads/`.

Final verified real-call total is **3/10**, decisions0. ServerUTC2026-11-28T09:34:52Z reports daily37/40 and surviving session7/10 remaining; release authorization7 calls remain. No budget exhaustion occurred, no additional call is made merely to fill ten, and no refund/reset/session churn is used. At exhaustion with missing proof the Author's extra-authorization/next-direction policy still applies. The status-only publication receives its own full dual CI and zero-model recheck before final handoff; its actual SHA/run/version identities are in the final delivery receipt rather than an invented self-referential commit.

## Demo and submission handoff

- Public: https://back-in-the-family.2290698778.workers.dev — rules/template mode, no model calls. Judge: https://back-in-the-family-judge.2290698778.workers.dev — existing private code or surviving session, shared budgets unchanged.
- From Advanced set seed1205/town50; Start, Skip ahead and choose Ask for your money at each of the three debt choices to reach Nadine's actual death. Skip reveals terminal text without time advancement. Borrow a body is a legal way to continue without an unrelated Dream/Bribe decision.
- Technical details → Export obituary archive delivers original replay and the matching terminal-word sidecar from one reply; allow both files in Chrome's multiple-download permission when requested. Keep each pair's original bytes separately. Replay is ordinary v5, and there is no browser importer/recovery feature.
- The retained v4 Judge trial is already after legal rebirth, with the unmodified paragraph under Nadine's life history. Do not refresh it expecting memory persistence. Raw files retain that sample. Use public mode for zero-model recording; actual Judge deaths spend the same remaining quotas.
- Portrait/scenery Credits and complete source/license closure remain available. Spec8 history stays functional-PASS/visual-unaccepted/superseded; LU-P1 is accepted, LU-P2 execution is verified, and final Author wording experience is pending. Video/submission remains Author-owned, with the existing December4 buffer and December5,2026,06:00GMT+8 deadline; no video production is added here.
