# Design: Life in View

**Spec 8 · Author approved for task generation · Planning only**

## 1. Authority, decisions and non-goals

The [requirements](requirements.md), canonical Kiro steering and the Author's latest decisions govern this design. Spec 7 functionality/public delivery and the separate judge release are accepted; this document grants no implementation, model, dependency-installation, Git or cloud operation.

Selected direction: B life/scene-first. Existing-player operation and information hierarchy are the primary acceptance threshold. Comprehensibility and necessary guidance remain requirements, without a stranger/documentation-free full-loop gate. Desktop reference is 1280×720, minimum 1024×640, with priority-led hybrid scrolling and 200% zoom reflow; phones are outside formal acceptance.

Use small full-body pixel scenes, readable system-font text boxes and short performances for the seven key categories below. Initial material is selected RPG Urban Pack/Roguelike RPG Pack art plus bounded original/attributed modifications. Additional compatible licensed material may fill a real gap; paid acquisition, generated imagery or a portrait/expression-matrix expansion requires a separate decision.

Do not add simulation rules, economy, free movement, generated prose, audio, settings/gallery, a second decision bridge or a new simulation pause reason. No animation, disclosure, map toggle, scene skip or Close writes a gameplay input or advances a tick.

## 2. Existing seams and intentional cutovers

| Existing source | Keep / intentional change |
|---|---|
| `web/src/main/ui-state.ts`, `scene-queue.ts`, `templates.ts` | Keep one authoritative reducer, captured historical scene World and four delivered template families. Replace map-first layout and the visual-head choice gate. |
| `world-snapshot.ts:16–35` | Player_Node supplies legal options/previews. Chronicle supplies real applied/source/chooser_absent/skipped information, not a node ID or per-effect before/after ledger. |
| `protocol.ts:19–23,31–86` | Keep pause reasons, current-world generation, request/reply/status grammar and replay shape. Add the typed Haunt arm and the explicitly defined receipt/observation leaves. |
| `sim-client.ts:132–175,201–254` | Keep the sole transport-ID allocator and FIFO/timeout/decision-overtaking behavior. Expose its real request ID through RequestTicket; split decision staleness from other same-world snapshot facts. |
| `sim-core/src/tick.rs:176–196,346–395,459–490` | Existing per-input outcomes and successful-input observer are the observation seam. Checked admission already allocates real sequences. Reuse one advancement loop. |
| `sim-core/src/underworld/{hauntings,magistrate}.rs` | Extract shared borrowed validation inside these rule modules; apply and read-only inspection use it without changing rules/error precedence. |
| `events.rs:504–540`, `underworld/nodes.rs:205–258` | Actual events and resolved NodeRecords remain durable authority. Event IDs/ticks and pending-trigger-to-node binding support result correlation. |
| `web/src/art/sprites.ts`, current direct scene/TownView consumers | Replace the placeholder selection with one loaded active SpriteSet and resolved visual keys; migrate consumers without a placeholder alias. |

Exported-interface changes require references/caller inventory before implementation. LSP was unavailable during planning; that is not a reason to invent definition/reference results or skip caller migration later.

## 3. Main-thread layout and interaction

### 3.1 Life surface

The document order is:

1. Compact continuous Soul/current-body identity and Run/Pause/Step/Speed.
2. Main scene picture, factual text box, involved people and stakes.
3. Current legal choice or underworld operation, with complete previews/conditions.
4. Actual reported outcomes and Chronicle.
5. Secondary relationship/earlier-life detail and optional town map.
6. Reachable Create/Seed/World_Config and technical/decision diagnostics in disclosure, not a new settings page.

At comfortable desktop widths, the wide main reading lane sits left of an approximately 260px information rail. Identity summary is not hidden exclusively in the rail. The map starts closed in a `Town map` disclosure and preserves the delivered depiction/legend; the current TownView has no pointer-inspection mechanic to invent.

The living idle state retains a shallow scene/situation picture, not an all-event animation. Underworld uses the same wide action lane for Dream, Bribe, Haunt and rebirth, rather than trapping forms in a narrow rail. Tabs/disclosures change local view only. Costs, blocked reasons and action phase are adjacent to the relevant control.

At 1024×640, the picture yields space before text/actions. At effective widths around 640/512px from 200% zoom, reflow to one column: identity/control summary, current scene/action, results, then secondary content. Disable sticky chrome when wrapping/short height would cover focus or controls. Long names, u64 amounts, complete Needed and previews wrap; no reduced font-size trick or ellipsis-only fact.

Lists/history can have labeled keyboard-scrollable regions on larger desktops. Customization expands in the main flow, outside a small slot-list scroller. All current slots remain in rule order and reachable; there is no UI-imposed four-slot limit. `Back to current action` is an in-page navigation aid, not a simulation command.

### 3.2 CurrentDecision is independent of playback

CurrentDecision uses the coherent latest `world.player_node`, matching `snapshot.playerNode.pending/node` and the exact node's sending/queued/answered state. It does not depend on the visual queue head, picture progress or map visibility.

One option activation issues one existing typed Choose. After admission, retire/mark only the queue entry for that exact node, wherever it sits, preserving the relative order of every other entry. Show `Choice queued/recorded; not applied yet`; do not display preview values as applied deltas. Rejection retains the valid node/scene unless authoritative state invalidates it.

If an earlier node-null scene is at the queue head, the current node already has its full factual text, options/previews and a compact final-picture vignette in the current-action area. Only the visual head owns active playback. A player may act immediately instead of waiting for the earlier picture or a second animation queue.

Preserve Run/Step gating for unanswered nodes and the existing decision hold. Do not invoke `choose-and-run` for ordinary choice controls or a visual skip. It remains an existing explicit protocol operation, not the redesign's default gesture.

## 4. Closed key-event coverage and presentation identity

Exactly seven categories use the shared short-performance mechanism:

| Category | Illustration / truthful source |
|---|---|
| Player_Node `family_death` | Existing node funeral context, named deceased/involved people and supplied stakes. Illustration does not assert attendance. |
| `inheritance` | Will/document/domestic composition; supplied money, people and timing. |
| `debt_due` | Document/notice composition; do not invent creditor/debtor identity from positions. |
| `feud` | Restrained two-sided domestic/town composition; no invented aggression or dialogue. |
| `life_stage` | Existing body/node facts and actual labels; no guessed birthday/school/subtype. |
| Player's own death | Actual player-associated Death event ID/tick/body/name/origin, supported funeral facts and continuous current Soul status. |
| Player rebirth | Actual Birth/Possession/Rebuild event. Native Birth tick is biological birth; Possession/Rebuild tick is entry/arrival, not biological birth. |

No additional milestone is selected in this draft. Dream resolution retains the delivered static scene/Close. Bribe/Haunt ordinary results, admission, carry-over, other residents' routine events, daily ticks and Chronicle entries use static or restrained status feedback; they do not enqueue a performance.

Player-node identity is a structured `(worldId, playerSoul, node.id)` tuple. Lifecycle identity is `(worldId, coreEventId)`. Names, an animation counter, predicted input sequence, stop tick or PauseReason cannot manufacture an event identity. Stop `(worldId, tick)` is only an episode/FIFO container.

Preserve delivered funeral → Dream → birth → node presentation slots. Multiple actual lifecycle facts within a slot are identified and listed in real event-ID order. An arrival-then-death factual summary may be shown while the historical stage slots remain funeral before birth; label the section `Events reported at this stop`, not an exact screen-order chronology.

The current header/actions always use the latest completed authoritative World. In same-stop arrival plus death, current state remains Waiting. Historical birth/arrival imagery never asserts a currently living newborn, inferred age/location or invented biological birth tick. Omit unsupported detail; use the real event-associated body rather than an arbitrary earlier-body lookup.

Keep playback/deduplication only for the current episode. Duplicate same-stop carriers cannot replay a closed scene. Newer tick/world/node invalidation cancels obsolete bindings; same-stop node retirement retains unrelated valid lifecycle slots. No whole-session played-event set, localStorage history or replay animation input is added.

## 5. Short-performance contract

A shared finite picture sequence supplies genuine event presentation, not merely a generic card fade:

| Beat | Purpose / proposal |
|---|---|
| Establish | Reveal the bounded scene composition, approximately 150–200ms. |
| Focus/action | Emphasize the named focal person or relevant prop; a document/stamp, restrained loss cue or arrival-frame change, approximately 200–250ms. |
| Settle | Return to the stable readable scene, approximately 150–200ms. |

Typical total target is approximately 0.6–1s, an implementation recipe rather than an Author time limit. This longer sequence is optional picture storytelling, not delayed UI response. The small transforms/opacity transitions use one shared curve/token system; the proposed ease-out is `cubic-bezier(0.23, 1, 0.32, 1)`. No seven independent engines, walking-frame inventory or per-person scripts.

All DOM text, legal choices, previews and controls are available from the first frame. This draft does not select a default typewriter or line-paging feature. Full text is already immediately shown; if a later approved design adds progressive text, the requirements' instant-reveal rule applies.

`Skip animation` immediately settles the final picture, never chooses, advances time or consumes a queue entry. It retains the same role/identity after settling, so repeated clicks/held Space cannot turn into Close/Choose. `Close scene` is separate and immediately available only for node-null cues. Guard Close with the expected entry identity; a late/double Close cannot pop the next entry.

An admitted Choose cancels remaining node-only beats. Rejected Choose does not replay the entrance. Model hold remains orthogonal: permitted local scene/navigation operations work while competing gameplay commands keep the existing decision gate.

On hidden tab, settle decorative playback/full text and stop its work. Do not pause simulation or model deadlines; on return render the latest coherent state rather than draining an elapsed visual backlog. Reduced motion renders the final picture/full text immediately. Keyboard controls and skip have immediate behavior; focus/status changes never wait for animation.

Prefer CSS transitions or native cancelable WAAPI on a few picture layers, transform/opacity only. Text/controls do not move for style. No camera shake, flashes, parallax, loops, blur/backdrop effect, audio or new motion dependency. Draw/cache static pixel layers when cue/assets change, not on every running status; hidden map does not redraw. Release temporary animation handles/`will-change` on settle/skip/invalidation.

## 6. Shared read-only ActionView

Extend existing `UnderworldView` with required `actions: ActionView`. Its observed tick/player Soul come from the containing WorldSnapshot; do not create another state authority. Outside waiting, the existing underworld view remains null.

```ts
type BribeBlocked = 'no_ghost' | 'not_waiting' | 'bad_amount'
  | 'insufficient_joss' | 'node_pending' | 'id_exhausted';
type HauntBlocked = 'official_person' | 'no_ghost' | 'not_waiting'
  | 'unknown_person' | 'dead_person' | 'not_connected' | 'rate_limited'
  | 'insufficient_joss' | 'yearly_cap' | 'id_exhausted';
type Eligibility<R extends string> =
  | { eligible: true; reason: null } | { eligible: false; reason: R };
interface ActionView {
  version: 1;
  capped_spend: { cap_year: string; yearly_cap: string; spent: string; remaining: string };
  bribe: { min_amount: string; max_amount: string; availability: Eligibility<BribeBlocked> };
  haunt: { price: string; targets: { target: number; availability: Eligibility<HauntBlocked> }[] };
}
```

Wire u64s are canonical decimal strings; received Person IDs keep the existing numeric convention. Balance remains the existing joss account. `cap_year` uses `joss::cap_year(tick)`; spent uses `capped_spent_in(tick)`, not stale stored values after lazy rollover; remaining comes from the core's capped-spend arithmetic. This budget is shared by Haunt/Rebuilt_Body, distinct from credits/balance, and is not a Haunt-count quota.

Bribe minimum comes from the rule's positive-amount policy; maximum is the actual balance and can be zero. Availability means the minimum positive amount passes the actual current-world validator. The user's chosen amount remains subject to queue-aware core admission/application. Zero is syntactically u64 but rule-invalid `bad_amount`.

Haunt price comes from Params. Targets reuse the existing connected living Person-ID list once, in its order, including negative relations; the Magistrate is outside this list. Availability uses the actual rule check, not positive affinity or membership alone. Remove a vanished target from actionable selection.

Extract borrowed pure checks inside `hauntings.rs` and `magistrate.rs`; apply and inspection share them. Preserve first-error order, one-per-tick/pending-ruling rules, event-capacity position, atomic Bribe event append and spend behavior. Use existing waiting, joss and slot assessment helpers. No World clone for inspection/per target, no live apply/spend/reset/fire/sequence allocation and no TS rule table.

ActionView is an applied-World observation, not a queued-prefix prediction or reservation ledger. Label `as of tick …` when a normal running World read lags. An older tick alone is not an old generation and must not permanently disable every action; current generation/invalid target/node/decision gates remain effective. Actual admission still checks the live queued prefix. Reuse the existing World-read policy; result arrival may coalesce one `world-snapshot` refresh, not animation-driven polling.

## 7. Admission, action results and lifecycle facts

Checked success preserves the sequences already allocated by `Sim::try_submit_all`:

```ts
type CheckedSubmission =
  | { ok: true; tick: string; seqs: string[] }
  | { ok: false; index: number; reason: string };
type SubmissionReceipt = { tick: string; seqs: string[] };
```

Add optional `submission` to successful Reply only for checked queued inputs. Sequence order is payload order; empty checked batches may have empty seqs; failures allocate none. Bribe's primary identity is seqs[0], including after a failed atomic model-choice attempt followed by fallback: bind only the final accepted vector. No preview trigger or request ID substitutes for input identity.

```ts
type RulingOption = 'grant_next_slot' | 'grant_later_slot' | 'deny';
interface RulingRecord {
  node: string; magistrate: number; applied: RulingOption;
  source: 'external' | 'rules_default'; rules_default: RulingOption;
}
type CoreActionResult = { input_seq: string; tick: string } & (
  | { kind: 'bribe'; state: 'rejected'; reason: BribeBlocked; amount: string }
  | { kind: 'haunt'; state: 'rejected'; reason: HauntBlocked; target: number }
  | { kind: 'bribe'; state: 'applied'; amount: string;
      offering_event: string; appeal_event: string; ghost: number; ruling: RulingRecord | null }
  | { kind: 'haunt'; state: 'applied'; target: number; ghost: number;
      event: string; price: string; intensity: string; mood_delta: string }
);
type ActionResult = CoreActionResult & { worldId: number; requestId: number | null };
interface PlayerLifecycleFact {
  event: string; tick: string; kind: 'birth' | 'death' | 'possession' | 'rebuild';
  body: number; name: string; origin: Origin;
}
interface RunUntilStopResult {
  ran: number; checksum: string; stops: Exclude<PauseReason, 'user'>[];
  actions: CoreActionResult[]; player_lifecycle: PlayerLifecycleFact[];
}
// Existing Worker Snapshot gains required leaves, empty when no undelivered facts.
interface Snapshot { actions: ActionResult[]; playerLifecycle: PlayerLifecycleFact[] }
```

Native DTO fields retain snake_case; the existing Worker-protocol adapter maps `player_lifecycle` to root `playerLifecycle`, matching its camelCase worldId/runState/playerNode convention. Core action payload fields stay unchanged inside their wrapper. New shared result types live with world-snapshot types to avoid a circular import. ActionView leaf version is 1; no unrelated protocol negotiation or replay bump.

An application rejection comes from that input's returned InputOutcome, not Rejections.last. Applied Bribe captures actual BribeOffering/Appeal IDs, ghost/amount and fired node at the successful-input prefix, then joins the resolved NodeRecord by that exact node ID after the tick. `external` is not automatically a model source. A grant is a recorded ruling, not proof of a changed access_from; show current register state separately. `ruling: null` means actual applied/spent Bribe without a node record when firing returned None, not an invented Deny/default. Missing records for a captured fired node or missing atomic events are internal contract errors.

Haunt's price/intensity/event are actual emitted facts. `mood_delta` reports the core event-defined signed Mood effect **before clamp**, currently −15; use the existing `events::mood_delta` with the target's actor position (1 in a Haunting card), not its PersonId. Do not label it as a guaranteed actual 15-point loss. No new per-effect history ledger is selected.

General Player_Node results use the existing Chronicle's actual applied/source/chooser_absent/skipped information and current state. Chronicle has no node ID; do not invent per-node association or preview-to-actual numeric deltas. Bribe/Haunt specialized results do not become a second generic consequence engine.

Lifecycle facts filter only existing Birth/Death/Possession/Rebuild events associated with the player Soul through the retained Person. IDs/ticks/name/origin/body come from real records, including already dead Persons. Native Birth tick is genuine birth; outsider arrival events do not provide biological birth-day/age/location. Order by actual event IDs and keep current Waiting independent of historical illustration.

## 8. One per-tick collector and existing message path

Keep the transient collector/domain projections in a small core observation module beside the existing snapshot/tick code; WASM invokes it and serializes its typed report, rather than duplicating rule/event/node introspection. The collector is an observer adapter, not a generic event engine or persistent history. Its two callback points share one owned state through the single existing advancement loop.


Extend the single `run_until_stop` implementation with an observing variant using the existing successful-input callback and a read-only completed-tick callback. One transient collector implements both points; no Rc/RefCell/shared-heap callback workaround, new persistent Sim/World field, second loop or extra step. The unobserved path retains original stops/checksums and has no observation allocation/work when unused.

At each input success, capture actual last event(s) and Bribe's pending node bound by trigger seq. After **each** tick, join last_outcomes to that tick's actual inputs by sequence, specialize Bribe/Haunt, join fired Bribe node to resolved record and copy the result before a later tick replaces last_outcomes. Rejections.last is latest-only and cannot replace this. Use the same event suffix/cursor for the player's lifecycle leaf; no full-log scan per input or all-event serialization.

Keep Rust scalars typed until serialization; do not clone World or build intermediate JSON-value trees. Preserve typed sequence/event/node IDs, then serialize the required decimal wire form once. Returned vectors contain only needed action/lifecycle facts.

Controller consumes the batch before any later advancement, binds the captured world/actual primary seq to transport request ID and holds only undelivered facts. One unified advancement-result branch owns publication; the running frame path and paused Step path must not both republish the same batch. Ordinary later empty cadence messages remain harmless. Publication is:

- If the batch stops, include both leaves in its existing single stop Status.
- If either leaf is nonempty without a stop, post an ordinary Status immediately, including for paused Step, bypassing the normal running-status throttle.
- Then the normal Step Reply may contain empty leaves. This prevents late/timed-out replies from being the only delivery route and does not add a pause or another message channel.
- Transfer buffered arrays to the posted message and replace the buffers only after Deps.post succeeds; constructing a Snapshot never consumes them. Do not mutate posted arrays or cap/overwrite pending/undelivered facts.

Raw generic submit keeps its existing void contract; observer results can have requestId null because that path does not expose a transport-to-seq receipt. Checked typed actions have complete correlation. Every result is keyed by `(worldId,input_seq)` and every lifecycle fact by `(worldId,event)`. Merge idempotently; later empty arrays and tick changes do not erase outcomes.

Keep current pending actions until terminal/reset/fatal handling. Settled display history is limited to the latest 20 action results, explicitly labeled when older settled rows are omitted; pending/undelivered results have no such truncation. Chronicle remains accessible separately. Same-stop lifecycle facts live with their presentation episode, not an unbounded whole-session animation history.

## 9. Client and reducer integration

```ts
interface RequestTicket { requestId: number; reply: Promise<Reply> }
// SimClient.request(RequestWithoutId) returns RequestTicket.
```

The existing private send point remains the sole transport-ID allocator. Ticket identity is available when the request is issued; reply retains the existing FIFO, timeout and bound decision-overtaking behavior. Migrate all direct callers and affected convenience methods/harness/tests; do not add requestWithReceipt or a legacy Promise-returning alias. Pre-issuance failure creates no synthetic id/seq or queued action. Handle real client/process failures at that existing boundary.

App records submitting/deciding with the actual ticket requestId, never placeholder 0. Checked Reply adds queued tick/seqs. Terminal results arriving before a delayed queued Reply remain terminal. Timeout means unknown completion, not core rejection and not an automatic retry; later same-world Status results can settle it through real correlation.

Split SimClient/reducer decision freshness from core/observation freshness. A stale DecisionStatus subtree cannot discard valid same-world ordinary/stop snapshots or action/lifecycle leaves. Preserve old-world rejection and existing decision identity checks; ingest observations before decision-field-only filtering. Do not roll current live state back from a truly older frame.

Successful Create clears old-world action/form/playback bindings after existing decision cancellation. Failed Create leaves the live World untouched. Existing create/decision single-flight guards remain; handlers capture current world/node/entry identity and validate it before issuing an action. No expected world or simulation sequence is invented in a new Haunt payload.

### Thin Haunt request

Add `{ type: 'haunt'; id: number; target: number }` to Request. Route it through existing checked submit as `[{ Haunt: { target: String(req.target) } }]`. Keep the existing received Person-ID convention, global decision_pending dispatch gate and core target checks. Do not call preview/DecisionBridge or make a model request for Haunt. Bribe remains the existing typed decision path.

Bribe input is canonical decimal-u64, no signs/spaces/fractions/exponents/leading-zero alternatives and no unsafe Number conversion. Zero is syntax-valid but core bad_amount; distinguish the messages. Admission never starts Run/Step or optimistically subtracts joss/cap room.

All required DTO leaves and checked-success fields migrate together with native/WASM expectations, shared types, production SimHandle/controller/client/reducer, all fake handles, fixtures and harnesses. Existing raw step/run_ticks checksum-only exports are not interactive observation paths. Missing/version-mismatched new view data is an explicit interface error, not a fabricated price/result or compatibility shim.

## 10. Visual system and approved material

### Proposed visual recipe for final design approval

Keep a restrained light paper-like reading surface, deep blue-green structural chrome and dark red event emphasis, with the color-bearing pixel scene above the text box. Do not imitate console logos, protected game characters or real institutional emblems. Pixel art carries the scene; DOM typography carries authoritative information.

| Token / role | Proposed value |
|---|---|
| Reading surface / text | `#f7f6ef` / `#24383c` |
| Secondary surface / muted text | `#e9eee7` / `#4e6263` |
| Structural accent / on-accent text | `#285258` / `#ffffff` |
| Event/error emphasis | `#8b3038` |
| Keyboard focus on light / dark surfaces | `#005fcc` / `#ffd36b` |
| Body / title / controls | system-ui/sans-serif; 15px body, 21–24px titles, readable 14–15px controls |
| Numeric/debug detail | ui-monospace/monospace where useful; never mandatory pixel-font body text |

These are proposed design tokens, not already observed browser contrast/font proof. Later actual implementation must meet contrast/focus/glyph requirements at both viewports/200% zoom. Font files/network font service and Kenney font pack are not selected.

Scene uses approximately 240–256 logical pixels of width and a shallow 48–80px field; choose integer pixel scale to fit available width (normally 3×, with smaller scale/reflow at zoom). Text/labels remain independent DOM, never resampled with the scene. Illustrate a few supported focal participants/props; all involved people and all effects remain in readable lists even when not pictured.

### Exact initial material families

Evidence root is `/home/kaiki/.cache/back-in-the-family/first-playable/c4-direction/`; the existing license/selection/drawn manifests document provenance, not runtime lookup paths.

| Family | Selected scope / provenance |
|---|---|
| RPG Urban Pack | Modern adult figures, grass/sidewalk/road, roof/window/door, tree/fence/streetlight pieces. Source `Tilemap/tilemap.png`, 16×16 crops at `(column×17,row×17)`. Urban archive SHA256 `4541d89d639fc7d1e905dd925e55b1c4977a41d983516228db1d57173bb9afaf`; root License.txt CC0. |
| Roguelike RPG Pack | Interior wall/floor/door/window, wooden table, document/book/ink props, gravestones/candles. Source `Spritesheet/roguelikeSheet_transparent.png`, same 16×16/17px stride. Archive SHA256 `8e7d2378f8f794245645f6d7dc7aeeb246791410a7e512293c594b46a5a9524b`; root License.txt CC0; do not invent a package-text version. |
| Original/modified gaps | Baby/children, supported elder/adult modifications, coffin/cradle/cloud/night, continuous Soul/affected markers and fictional paperwork. Retain exact per-file origin/base-crop lineage. Additional neutral unknown-age figure may be authored instead of claiming an unsupported age. |

Reuse compositions, not a new painting per event. Six base modern adult figures plus bounded age variants suffice; no 50-unique-face, walking-frame or expression-matrix obligation. Resolve a stable cosmetic key from available person identity/age, not rule RNG, kinship, skin-color/sex inference or unseen traits. Unknown age stays unknown. Native infant treatment/cradle requires actual birth/age support; Imported/Rebuilt arrival is not automatically a baby.

### Emission, registration and SpriteSet

Build small selected atlases separated by provenance, not full source sheets. Proposed stable emitted files are `assets/life-view-urban.png`, `assets/life-view-roguelike.png` and `assets/life-view-original.png`. Use `web/public/assets/` so Vite copies explicit files rather than inlining tiny imports or producing names inconsistent with the exact-path registry. Do not commit web/dist or other built application artifacts to main.

Put Urban-derived modifications in the Urban lineage and Roguelike-derived candle modifications in the Roguelike lineage; the original atlas contains only wholly original work. Composite artwork must not be mislabeled `project` merely because modifications were made. Record selected IDs, source sheets/crops, ZIP/source hashes, full applicable licenses, modification lineage and atlas destination rectangles in source asset documentation/metadata. Register actual emitted paths in existing `web/assets/ASSETS.json` using `project` or the exact README pack name, with notices in the established license/NOTICE path.

Decode/load once into the active SpriteSet before synchronous draw calls. Pass a resolved visual key to resident drawing rather than querying World inside art. Migrate TownView and the four direct template consumers; remove placeholder selection/alias. Cache bounded static picture layers and use compositor transforms for the short beats. Do not silently substitute placeholder art on load failure: show an explicit visual-asset error, keep available factual controls readable and fail visual delivery proof until repaired.

Additional external assets require verified distribution/modification terms, style coherence and exact provenance before use. Prefer simpler compatible licenses. This allowance is not a paid/image-generation grant or a reason to expand scope without a real gap. Preserve existing assetInventoryOffenders, media allowlist, immutable public/judge/Deploy-button artifact and full license/SDK treatment; do not bypass emission checks to make a picture load.

## 11. Verification and execution gates

This design is based on source research and existing direction/runtime captures only. No new runtime or implementation checks have run; a style recipe is not a visual PASS.

| Verification slice | Consumer-visible proof |
|---|---|
| Pure core/view and observed advancement | Exact errors/atomic spend; lazy cap rollover; changed price/cap; observed/unobserved identical input/checksum/stops; no readonly mutation. |
| WASM receipt/batch | Actual assigned seqs; successful and rejected inputs early in multi-tick batches survive later empty ticks; Bribe exact events/node/ruling/null case; Haunt pre-clamp labeling; native birth versus arrival+death facts. |
| Worker/client/reducer | Paused Step/nonstop observations use ordinary Status; one stop Status otherwise; late reply/timeout, stale decision subtree, old generation, terminal-before-queued, repeated carriers and no buffer loss. RequestTicket real ID; no auto retry/Run/Step. |
| Scene/templates | All seven key categories; exact-node retirement independent of head; remaining FIFO; same-stop waiting/history truth; Skip/Close identity, repeated activation and callback invalidation; no fabricated facts. |
| Actual local UI | Every legal option/complete preview, all underworld paths/actions and Set/Adjust; exact u64; rejected versus queued versus applied; animation bypass while actions remain usable; ordinary events not performed. |
| Actual visual/motion/accessibility | 1280×720, 1024×640, 200% zoom, long/similar names, actual large valid lists, keyboard/focus, hidden tab, reduced motion; complete text first frame and finite key picture sequence. |
| Art and delivery | Actual selected atlas bytes/provenance/glyphs; emitted paths match registry; active SpriteSet (no placeholder); original public/judge/Deploy-button guards/artifacts retained. |

**Non-head proof qualification:** The Scene/templates and Worker/client/reducer slices prove non-head CurrentDecision, exact-node retirement, remaining FIFO, Choose-specific rejection/no-replay and Run/Step gates using the production reducer and production-component interactions. Ordinary actual local Worker/WASM/UI Choose, its receipt/recorded input/application and native replay separately prove the transport/admission seam: presentation FIFO is not a Worker input field. Constructed rejected replies and controlled native lifecycle DTOs remain explicitly qualified; real Bribe/Haunt rejection is not relabeled as live pending-node Choose rejection. These complementary layers satisfy the conditional behavior without requiring a naturally joined default-Params stop. A bounded search that does not observe the combination neither proves universal unreachability nor authorizes fabricated World/UI facts, altered rules/Params or omitted behavior.

Update legitimate map-first/visual-head/snapshot contract expectations; preserve queue/input/replay/privacy/atomicity/SDK rules. Delete implementation-wording tests rather than repinning wording. Run focused checks after each integrated implementation slice, not while subagents are editing; final ordinary gates still run once on completed integration. Feature proof uses actual locally rendered behavior, with new regression tests only for plausible uncertain consumer edges.

Proposed execution checkpoints: **LV-C1** read-only facts/receipts and native-WASM coherence; **LV-C2** Worker/client lifecycle preservation; **LV-C3** selected art/life layout; **LV-C4** seven-category motion/all operations/viewport evidence; **LV-C5** final requirement audit. These are Spec 8 local checkpoints, not reused Spec 7 live-call grants. Exact tasks and stop policy follow design approval. No push/deploy/live model is implied by local acceptance; source publication needs a later named grant and must account for existing three-path CI effects.

## 12. Future file ownership and migration

| Slice | Owned implementation locations after approval |
|---|---|
| Core facts and observation | Existing `underworld/hauntings.rs`, `underworld/magistrate.rs`, `snapshot.rs`, `tick.rs`, core exports and a small `observations.rs` collector/projection module. No new World/checksum/replay state. |
| WASM/native contract | `sim-wasm/src/lib.rs`, required native/WASM DTO fixtures and shared native result/view types. Serialize actual allocations/observations, not predicted identities. |
| Worker/client integration | `shared/protocol.ts`, controller, SimHandle/fake handles, `main/sim-client.ts`, ui-state/bridge/harness consumers. One integration owner migrates shared message contracts and the RequestTicket signature. |
| Life UI and key scenes | App, existing panels/templates/view-model/scene-queue, a pure key-scene view builder and a reusable KeyScene/LifeSurface Svelte module. Reuse existing client/reducer; no parallel controller. |
| Art | Existing sprites module, selected source/provenance metadata and explicit `web/public/assets/` atlases, ASSETS.json/README/NOTICE entries and their legitimate fixture updates. No runtime downloader or new art dependency. |

Source/declaration/reference inventory precedes exported-interface changes. Independent art preparation and core observation can be delegated separately only under the approved task ownership; shared protocol/controller/App integration has one owner. Do not run formatters/builds/tests while those owners are mid-edit. No file in this table is claimed to have been implemented by planning.
