# first-playable: requirement audit

Audited locally by the planning session against the Spec 6 hand-off at `06fce9b8ed` and the saved execution evidence. The external terminal agent implemented and tested the work; this audit is the planning-side acceptance record. No push or deployment was performed. The clean full-gate result was recorded before the final test-only follow-up commit; the focused follow-up checks and their fail–restore–pass evidence are recorded separately in `docs/kiro-log.md` and under `/home/kaiki/.cache/back-in-the-family/first-playable/15.1/`.

The only untracked worktree item reported by the executor is the user's `.kiro/specs/first-playable/.config.kiro`; it is not part of this audit.

Status values: `met`, `met with note`.

## Final evidence

- Clean-build `scripts/gates.sh`: exit 0, `All gates passed.`, **550.028 s**, compared with the 377 s baseline. This run covered the Rust, native batch, WASM, web/probe, Web_Build and Chrome gates.
- Passive first-stop offsets for seeds 1–5: **626, 664, 639, 852, 700**; all passed the half-open `600..=899` band.
- Playthrough branch: **146,000 simulated ticks**, **34.236942 s** in the clean gate output.
- Frozen playthrough: seed **1205**, stages at ticks **734, 2328, 3866, 5373, 5374, 5375**, endpoint **5376**. Native/WASM parity and all **5,376** completed-tick checksums matched.
- Browser playthrough: Speed-1 first stop **24,515.8 ms** at tick 734; test-specific browser duration **28.1 s**; all three Chrome tests **49.3 s**; long-task count **0**, longest task **0 ms**.
- R15.6 protected-file diff: exit 0. No fixture diff was observed after the follow-up.
- The final clean gate remains the recorded result; the planning session did not rerun it.

## Requirement-family table

| Requirements | Status | Evidence and notes |
|---|---|---|
| R1, Player_Node lifecycle | met | Player_Node lifecycle properties, checked input handling, Chronicle records, Rules_Default replay coverage, and the Worker unanswered-node gate. |
| R2, Narrator patterns and Stakes | met | Five pattern families, closed options, previews, Stakes, salience and first-crossing feud coverage; the priority seam has a real fail–restore–pass regression. |
| R3, Interrupt_Budget | met | First-stop gate on all five acceptance seeds, gap checks, auto-resolution and the Speed-1 browser measurement. |
| R4, Life_Stage | met | Trait-only life-stage properties and the stabilized test fixture; production clamping and indefensible-option auto-resolution remain covered. |
| R5, Opening and Intro_Grace | met with note | Opening Debt, Grace exclusions, transfer protection and first-stop behavior are covered. For N6 first-node resolution, the Author approved alternate evidence: the runtime regression proves same-tick Grace termination and the checker regression proves detection of the illegal post-resolution state. Removing one production `intro::update` call was masked by another same-tick update and is explicitly **not** claimed as production-path C2 evidence. R5.10 and the N6 invariant are unchanged. |
| R6, Rebuilt_Body customization | met | Set/Adjust validation, stable per-wait draw, Carry_Over ordering, customized-Trait behavior, Path_Status and the same-state Imported_Vessel/Rebuilt_Body comparison are covered. |
| R7, Snapshot | met | Extended Snapshot properties, native/WASM Snapshot parity at playthrough stages, read-only behavior and Path_Status consistency. |
| R8, Clock pacing and Worker protocol | met | Pacer properties, stop semantics, checked submission, interactive unanswered-node refusal and accepted-choice advancement are covered by unit and browser evidence. |
| R9, Town_View and identity | met with note | ID-derived layout, Soul_Marker, identity/tie lists, Stakes and previews are covered by web properties and the playthrough. The known Customization-panel geometry/scroll limitation remains recorded; it was not silently patched in Spec 6. |
| R10, Scenes and panels | met | Exactly four template scenes, fixed text, scene ordering, Snapshot-only staging and scene action rules are covered by web properties and the real playthrough. Some scene combinations remain constructed-test coverage rather than appearing in seed 1205. |
| R11, Underworld panel and rebirth | met | Dream, Carry_Over, Path_Status, Imported_Vessel and Rebuilt_Body controls, customization preview, queued inputs and rebirth behavior are covered. Haunting and Bribe controls remain intentionally out of scope. |
| R12, Art assets | met with note | License-first Art_Trial and the Author's `change` decision are recorded. Spec 6 ships placeholder project-drawn shapes, an empty media inventory and no third-party pack. The later B direction is not represented as a new Spec 6 UI. |
| R13, Batch metrics and invariants | met with note | Deterministic reports, first-stop gate, Playthrough_Branch, N1 type guarantee and N2–N6 checks are present. The N6 first-resolution evidence uses the narrowly approved alternate evidence described under R5; N1 remains structural, with no artificial two-pending fault. |
| R14, Kin decay observation | met | Passive and Playthrough figures, censoring and lower-middle medians, pooled comparison with the underworld H1 baseline, and checksum-neutral observation are recorded. |
| R15, Determinism, replay and migration | met | Replay v5, Canon v6, rejected old replay versions, native/WASM fixture parity, recorded choices/dream/claim, and protected LLM/System One files are covered. |
| R16, Smoke and gates | met | Clean gate exit 0, real-control Chrome playthrough, stage reasons/ticks, unanswered-node refusal, customization cancel invariance, checksum comparison, timing report and fault evidence are recorded. |

## Fault-evidence disposition

The following were demonstrated with fail–restore–pass evidence: first-stop band, N2 ordering, N3 gap, N4 defensibility, N5 Grace body designation, N6 transfer protection, protected `pay_debts` target, Intro_Debt priority, playthrough checksum, Imported_Vessel control, unanswered-node advancement and media inventory.

For N6 first-node resolution, the saved production omission attempt did not create a bad state because another same-tick update masked it. Per the Author's explicit acceptance, the close-out evidence is instead:

1. `first_node_resolution_ends_grace_only_on_the_choice_tick` proves the normal state transition at the resolution tick.
2. `grace_after_actual_first_node_resolution_is_caught_as_n6` fails when the checker predicate `first_resolution.is_some()` is removed and passes after restoration.

This substitute proves the behavior and checker recognition, but does not retroactively claim that deleting the production update was a successful C2 injection. The limitation is preserved rather than hidden.

## Scope and release status

Spec 6 is accepted and audited **locally**. It has not been pushed or deployed; production remains the Spec 5 deployment. The slice intentionally contains no Workers AI call, generated presentation text, replay gallery, deploy button, haunting/Bribe UI, or final B-direction interface. Those belong to subsequent planning, not a Spec 6 supplement.

The next planning unit should therefore begin after this close-out: first the slow-think/Workers AI and deployable Worker seam, then the separate B-direction interface revision and presentation-text layer. No new gameplay or model scope is added to Spec 6 by this audit.
