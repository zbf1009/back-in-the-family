# Requirements: Life in View

**Spec 8 · Requirements scope confirmed for design, with the Author's key-event clarification incorporated · Planning only**

## Purpose and authority

Back in the Family shall put the player's current life, relationships, scene and meaningful choice ahead of the town map. The selected B direction replaces Spec 6's map-first geometry without removing its delivered operations. The visual ambition is a lightweight but appropriately rich GBA/galgame-inspired composition of scene imagery and readable text boxes, not a new scripted game.

Canonical constraints remain in [product steering](../../steering/product.md), [tech steering](../../steering/tech.md) and [structure steering](../../steering/structure.md). [PRODUCT.md](../../../PRODUCT.md) is a context adapter; the [roadmap](../../../docs/development-roadmap.md) records accepted delivery and successor scope. The Author's latest viewport, scrolling and choice-staging decisions supersede older open questions in those records.

Primary acceptance is efficient operation and clear information hierarchy for existing players. Comprehensibility, necessary explanations and contextual guidance remain requirements, assessed through qualitative review; a stranger completing an entire reincarnation without external documentation is not a hard gate.

This draft grants no implementation, installation, test execution, browser operation, model request, Git publication or deployment authority. Requirements, design and tasks retain separate approval stages.

## Delivered baseline and bounded additions

- Specs 1–7 are accepted; final public delivery PASS is recorded for `cb264943170bf9fbe315f9704d15e1e6dc03cb71`. Existing public rules-only, retained judge and Deploy-button delivery contracts remain binding.
- Rust/WASM simulation runs in the existing browser worker. Rules own legal options, effects, eligibility, prices, caps and recorded inputs; presentation does not create an alternative rule engine.
- The Narrator already supplies Player_Node choices for death, inheritance, debt, feud and life-stage families. Existing OptionPreview data comes from rules and is not recomputed by the UI.
- Funeral, inheritance, dream and birth templates, their panels and the ordered scene queue already exist. This Spec improves presentation rather than claiming those scenes are missing.
- Death, underworld, Dream, rebirth paths, Path_Status, carry-over and joss-paper-priced Rebuilt_Body Set/Adjust customization are delivered. Existing customization reachability and geometry need improvement, not new customization rules.
- Bribe has a typed protocol arm and uses the existing Dream/Bribe decision bridge. Its actual ruling is retained in resolved NodeRecords and needs a read-only typed carrier; there is no existing World-level `last_ruling` field to reuse.
- Haunt exists in core InputPayload but lacks the typed WebRequest/controller submission arm. This Spec adds that thin entrance and read-only authoritative price, eligibility, cap and result presentation.
- Necessary Rust/WASM read-only DTO extensions are in scope. Additional World/checksum state, replay v5 input-shape changes, parallel rules and another decision bridge are not.

## Terms and acceptance interpretation

- **Current life** means the current body and its lived relationships, anchored to the player's continuous Soul; a waiting Soul has an underworld presentation, not an invented living body.
- **Key staging** means a short picture/text-box treatment of an existing meaningful player-choice node or major player-lifecycle event, including the player's own death and rebirth. It is not restricted to choice nodes, a new simulation interruption or a scripted branch.
- **Accepted/queued** means an input submission was admitted for processing, not that its requested effect succeeded. **Rejected**, **resolved** and **applied** shall describe the actual authoritative lifecycle.
- **Local view state** means presentation-only selection, map visibility, panel expansion, scroll and visual playback; it is not recorded gameplay input.
- **Capped-spend budget** means the existing Soul-level joss-paper spend limit shared by Haunt and Rebuilt_Body claims in a Cap_Year. It is distinct from the current balance and yearly received credits, not an independent annual Haunt-count quota; Dream and Bribe do not acquire this restriction through UI work.
- Every numbered acceptance criterion below is observable. Visual style and first-time interpretation additionally require the explicitly identified qualitative review; favorable impressions cannot substitute for functional evidence.

## LV-R1 — Life-first information hierarchy

**User story:** As an existing player, I want my current identity and next meaningful operation to lead the screen so that I can act without navigating a map-first dashboard.

1. WHEN a playable state is shown, THE interface SHALL prioritize current body/Soul identity, current scene or situation, affected people, stakes and available action above the optional town map.
2. WHEN a Player_Node is pending, THE interface SHALL make its decision and all legal options reachable from the primary life surface without requiring map navigation.
3. WHILE no Player_Node is pending, THE interface SHALL distinguish the current life or underworld state from previously resolved events rather than presenting old choices as current.
4. WHEN comparing the reference composition at 1280×720, THE review SHALL assess whether the selected B scene/life hierarchy is evident rather than preserving Spec 6's map-first proportions.
5. WHEN secondary information expands, THE interface SHALL preserve a clear route back to the active choice or action and SHALL NOT filter gameplay options to fit the composition.

## LV-R2 — Continuous identity and meaningful ties

**User story:** As a reincarnating Soul, I want to distinguish this body's family from past-life connections and recognize who an action affects.

1. WHEN the player lives, dies or is reborn, THE interface SHALL retain the same continuous Soul marker while accurately updating current body identity and living/waiting status.
2. WHEN relationships are displayed, THE interface SHALL distinguish blood/current-body ties from past-life ties and SHALL NOT imply recognition of a reincarnated body merely from shared portraits, names or the continuous player marker rather than rule-backed facts.
3. WHEN a person participates in a choice or action, THE interface SHALL identify that person and the relevant rule-backed connection without requiring a town-map lookup.
4. WHEN relations include affection, hostility, debts or promises exposed by the baseline, THE interface SHALL present their actual meaning rather than treating every connection as friendship.
5. WHERE visual character variants or scene positions are used, THE interface SHALL NOT assert unrecorded skin color, personality, kinship or simulation location as a fact.
6. WHEN a long name or similar-looking portrait is shown, THE interface SHALL preserve a readable identity distinction; decorative character presentation SHALL NOT replace authoritative names or the Soul marker.

## LV-R3 — Choice context, legal options and consequences

**User story:** As a player at a decision, I want to see what happened, who is involved, what is at stake and what every legal option can actually do.

1. WHEN a Player_Node is pending, THE interface SHALL show its existing context, affected people, concrete stakes, amounts and deadlines where supplied, alongside the current scene.
2. WHEN rules supply options, THE interface SHALL expose every legal option and its complete OptionPreview without UI-side recomputation, artistic filtering or invented additional options.
3. WHEN a preview contains effect bounds or conditional outcomes, THE interface SHALL distinguish them from guaranteed effects and from results already applied.
4. WHEN a player submits a choice, THE interface SHALL use the existing typed action path and SHALL NOT submit another choice because visual playback, focus or panel state changes.
5. WHEN the core resolves the choice, THE interface SHALL show its actual reported applied option/source and skipped or unapplied parts with affected people where provided. Current state remains separately labeled; the UI SHALL NOT infer unreported attributed before/after deltas from balance changes or decorative reactions.
6. WHEN a node becomes stale or is replaced, THE interface SHALL remove its actionable state and retain only appropriately labeled history; an old option SHALL NOT remain usable.
7. WHERE explanatory labels are needed, THE interface SHALL explain costs and consequences using current template/rule facts, not generated narrative text or unsupported success probabilities.

## LV-R4 — Bounded key-event short staging

**User story:** As a player, I want meaningful decisions and major life transitions to feel like scenes without turning every simulation event into a cutscene.

1. WHEN an existing Narrator Player_Node requires a player choice in any of the five delivered families, THE interface SHALL provide a short, context-appropriate key visual treatment around its scene and text box.
2. WHEN key staging is presented, THE interface SHALL keep participants, stakes and legal options legible and SHALL NOT replace the decision with a cinematic overlay that requires waiting.
3. WHEN a rule event does not require a player choice, THE interface SHALL NOT require a new key-staging treatment merely because it appears in the event log or Chronicle.
4. WHEN the player's own death or rebirth is presented, THE key-event design scope SHALL include that major life transition and SHALL NOT exclude its short picture/text-box performance merely because it has no Player_Node. Existing truthful scene data and ordering remain authoritative; no new pause point or gameplay script is introduced.
5. WHEN daily ticks, ordinary Chronicle entries or general results occur, THE interface SHALL use readable static feedback or restrained state feedback, not an individual staged performance for every event.
6. WHEN staging depicts a consequence, THE interface SHALL use existing facts and templates; it SHALL NOT add scripted branches, generate dialogue or invent future outcomes.
7. BEFORE implementation, THE approved design SHALL enumerate the bounded key-event coverage: the five existing player-choice families, the player's own death and rebirth, and any explicitly selected additional player-relevant milestone. Other residents' ordinary events, general Dream/action results and Chronicle entries SHALL NOT automatically receive a staged performance.

## LV-R5 — Immediate reveal, skip and interruption

**User story:** As an experienced player, I want optional visual pacing to be immediately bypassable without choosing for me or advancing simulation time.

1. WHERE text is progressively revealed, THE interface SHALL provide an immediately available full-text reveal that exposes the complete existing text without submitting Choose or Step.
2. WHILE key visual staging is playing, THE interface SHALL provide an immediately available skip that ends that visual treatment without selecting an option, submitting an action, starting Run or advancing a tick.
3. WHEN reveal or skip is activated repeatedly, THE interface SHALL keep the same semantic scene and choice state and SHALL NOT create duplicate submissions or duplicate scene consumption.
4. WHEN a newer authoritative state invalidates the displayed node, THE interface SHALL interrupt obsolete visual playback and present the valid state without stale actionable controls.
5. WHEN ordered scenes are pending, THE interface SHALL preserve their delivered order and distinguish presentation playback from simulation execution; visual skip SHALL NOT falsify or reorder recorded facts.
6. WHILE animation is active, THE interface SHALL accept ordinary navigation and valid explicit actions without a forced animation-completion wait or a new simulation pause point.
7. WHEN a user accesses reveal, skip or a choice by keyboard, THE interface SHALL support equivalent immediate behavior without an animation-dependent input lock.

## LV-R6 — Reduced motion and truthful dynamic feedback

**User story:** As a player, I want responsive state feedback that remains understandable with motion reduced or interrupted.

1. WHEN reduced motion is requested, THE interface SHALL remove nonessential movement and progressive visual delays while retaining complete text, choices, state changes and scene meaning.
2. WHEN action, selection or lifecycle state changes, THE interface SHALL provide prompt visible feedback; it SHALL NOT move information the player must read or act on solely for decoration.
3. WHEN motion is skipped, interrupted or reduced, THE resulting semantic state SHALL match the ordinary presentation state and SHALL NOT change World, inputs or outcomes.
4. WHEN a status is important, THE interface SHALL communicate it through text or another non-motion/non-color-only cue rather than requiring observation of an animation.
5. WHEN the later design chooses motion recipes, THE review SHALL assess purposeful restraint, legibility and interruptibility; exact palette, easing, durations and component APIs are design decisions, not approvals granted by this draft.

## LV-R7 — Underworld and authoritative action lifecycle

**User story:** As a waiting Soul, I want to see my resources and available operations and know whether an action is merely queued or has actually taken effect.

1. WHEN the player is waiting in the underworld, THE interface SHALL expose current joss paper, relevant connections, Dream, Bribe, Haunt and rebirth entrances with rule-backed conditions.
2. WHEN an input is accepted or queued, THE interface SHALL label that state separately from rejection, resolution and applied effects; a submission acknowledgement SHALL NOT be displayed as successful gameplay resolution.
3. WHEN processing rejects or resolves an action, THE interface SHALL present the authoritative reason/result with available core-owned identity/tick correlation, not a generic notice masquerading as a ruling or outcome.
4. WHEN an action is unavailable, THE interface SHALL show its actual condition or missing requirement where exposed and SHALL NOT invent a probability, cooldown, price or unlock rule.
5. WHEN an action is queued while advancement is stopped, THE interface SHALL explain its pending status and preserve existing explicit Run/Pause/Step behavior; queueing SHALL NOT automatically start Run.
6. WHILE the existing decision bridge holds time, THE interface SHALL preserve pending request, deadline, use-rules, cancellation and fallback behavior; scene playback SHALL NOT own that hold.
7. WHEN an authoritative state changes eligibility before application, THE interface SHALL show the actual rejection or result rather than guaranteeing the earlier preview remains valid.

## LV-R8 — Bribe entrance, amount and actual ruling

**User story:** As a waiting Soul, I want to submit an existing Bribe and read its true conditions and ruling without confusing admission with success.

1. WHEN Bribe is inspected, THE interface SHALL show authoritative eligibility, applicable conditions, available joss paper and the actual rule-defined meaning of the requested amount.
2. WHEN an amount is entered or displayed, THE interface SHALL preserve exact unsigned 64-bit integer values through the existing protocol representation without conversion through unsafe JavaScript Number precision.
3. WHEN amount syntax is invalid or exceeds u64, THE interface SHALL explain it without submission; rule-policy eligibility and amount restrictions SHALL remain owned by the core, not a parallel frontend rule implementation.
4. WHEN Bribe is submitted, THE interface SHALL use its existing typed arm and existing Dream/Bribe decision bridge, including the current decision wait and Rules_Default fallback behavior.
5. WHEN Bribe is accepted, rejected, resolved or applied, THE interface SHALL label the actual lifecycle and show the core's real ruling/effects through a read-only typed carrier, including necessary exposure of the existing ruling data.
6. WHEN displaying a ruling, THE interface SHALL NOT manufacture it from generic notices, balance differences, a model reply alone or a visual magistrate reaction.
7. WHEN presenting Bribe availability, THE interface SHALL preserve its actual eligibility rules and SHALL NOT substitute Haunt/Rebuilt_Body's shared capped-spend budget or introduce another model request policy.

## LV-R9 — Haunt entrance, connected targets and actual result

**User story:** As a waiting Soul, I want to haunt a genuinely connected target, understand its real cost and the shared capped-spend constraint, and see what actually happened.

1. WHEN Haunt targets are displayed, THE interface SHALL include rule-backed Connected People with both positive and negative relations, SHALL exclude the Magistrate and SHALL distinguish connections from current target eligibility.
2. WHEN Haunt is inspected, THE interface SHALL show authoritative price, eligibility, remaining shared capped-spend room and applicable blocked reasons through read-only carriers; it SHALL NOT hard-code a cost of 40, equate balance/received credits with spend room or invent an annual Haunt-count quota.
3. WHEN no target is eligible or a connection has been cut, THE interface SHALL explain the actual state while keeping other legitimate underworld actions reachable.
4. WHEN Haunt is submitted, THE interface SHALL use a thin typed WebRequest/controller arm for the existing core InputPayload and existing worker-owned input processing.
5. WHEN Haunt is accepted, rejected or applied, THE interface SHALL show the real correlated result, actual charge and effects where reported; acknowledgement alone SHALL NOT imply a successful haunting.
6. WHEN the existing Yearly_Cap, capped-spend state or Haunt price changes in an authoritative fixture/state, THE interface SHALL display the new facts without a duplicated frontend rule or stale constant.
7. WHEN Haunt is submitted, THE interface SHALL NOT create a decision-model node, new pause family, parallel decision bridge or Bribe-style eligibility rule.

## LV-R10 — Rebirth comparison and delivered personalization

**User story:** As a waiting Soul, I want to compare real rebirth paths and reach every existing carry-over and rebuilt-body control.

1. WHEN rebirth paths are shown, THE interface SHALL preserve Birth_Slot, Imported_Vessel and Rebuilt_Body claims and expose actual Path_Status, price, waiting/expiry and eligibility facts.
2. WHEN choices are unaffordable or unavailable, THE interface SHALL show complete Needed information and the real constraints without fabricating two executable paths, changing income or guaranteeing an affordable claim.
3. WHEN slots are numerous, THE interface SHALL keep every currently offered slot reachable and identifiable without choosing a subset for layout convenience.
4. WHEN any existing rebirth path is used, THE interface SHALL keep the delivered carry-over selection reachable and distinguish that shared capability from joss-paper-priced rebuilt-body customization.
5. WHEN Rebuilt_Body is inspected, THE interface SHALL expose all delivered Set/Adjust controls, previews, costs and constraints without clipping their contents or relabeling them as future functionality.
6. WHEN customization is confirmed, THE interface SHALL use existing recorded actions and actual applied results; decorative portraits SHALL NOT assert customization beyond the core's delivered attributes/traits.
7. WHEN rebirth completes, THE interface SHALL update body identity, ties and available actions while retaining the continuous Soul marker and the one-soul-one-place interpretation.
8. WHEN rebirth and death are reported in the same completed stop, THE interface SHALL preserve the actual waiting/living status and current Soul location; historical scene staging SHALL NOT present a newly created but already dead body as currently alive.

## LV-R11 — Optional map and local presentation state

**User story:** As a player, I want town context when useful without needing the map to operate the current life.

1. WHERE the town map is available, THE interface SHALL make it optional and preserve its existing legitimate inspection operations without making it the primary action surface.
2. WHEN the map is hidden or the player changes a local selection, panel, scroll position or visual playback state, THE interface SHALL NOT submit gameplay input or alter simulation progression.
3. WHEN scene staging positions a character or prop, THE interface SHALL treat that position as illustrative composition, not movement or a new spatial simulation fact.
4. WHEN the current body, pending node or action phase changes, THE interface SHALL prevent local view state from hiding the new primary operation or keeping obsolete targets actionable.
5. WHEN a presentation preference changes, THE simulation SHALL retain its existing input ownership, checksum and replay behavior; this Spec SHALL NOT add a settings page or replay gallery.

## LV-R12 — Desktop capacity, scrolling and keyboard access

**User story:** As a desktop player in a small window or at enlarged text size, I want every legitimate action and its complete explanation to remain usable.

1. WHEN rendered at the 1280×720 reference viewport, THE interface SHALL make identity, scene/context, stakes and primary operations prominent under the selected B hierarchy.
2. WHEN rendered at the minimum supported 1024×640 desktop viewport, THE interface SHALL keep all choices and underworld/rebirth/customization operations reachable using the selected hybrid-priority scrolling behavior.
3. WHEN content exceeds available height, THE interface SHALL prioritize the current action and use deliberate scrolling for long relationships, slot lists and history; it SHALL NOT freeze all panels into clipped fixed-height boxes.
4. WHEN consequences, Needed information, conditions or customization controls exceed their initial region, THE interface SHALL provide access to the full content; ellipsis or decorative clipping SHALL NOT be the only available representation.
5. WHEN names are long or lists reach the actual configured maximum slot/relationship capacity, THE interface SHALL preserve unambiguous labels, action reachability and complete information without layout-driven gameplay limits.
6. WHEN browser zoom is 200% at supported desktop viewports, THE interface SHALL preserve readable text and all functional content through reflow and scrolling; it SHALL NOT require shrinking text back to operate.
7. WHEN operated by keyboard alone, THE interface SHALL provide visible focus, logical navigation, usable scroll regions and reachable reveal/skip/choice/action controls without a focus trap or obscured focused action.
8. WHEN explanatory content is needed, THE interface SHALL make it available without hover-only access; phones are not a formal acceptance platform for this Spec.

## LV-R13 — Asset adoption, glyph coverage and cultural integrity

**User story:** As a player, I want a coherent small-town/fictional-underworld presentation with readable text and legitimately usable art.

1. WHEN art is selected, THE design SHALL use the approved small full-body pixel-stage plan: selected RPG Urban Pack and Roguelike RPG Pack material plus bounded original/attributed modified gaps and clear system fonts. Actual additional external material MAY cover a demonstrated gap only if its license permits the intended modification/public redistribution and its style fits; each source requires its own provenance/license evidence rather than inheriting existing CC0 findings.
2. BEFORE a third-party asset or font enters production content, THE approved asset inventory SHALL identify its source, exact applicable license, provenance, required notices and modifications, with registration in the project's existing license documentation.
3. WHEN a candidate source covers one package, THE adoption record SHALL NOT extend that license finding to other packages or unverified bundled material.
4. WHEN fonts render current English UI, names, amounts, punctuation and symbols, THE interface SHALL provide full required glyph coverage and readable fallback without missing-glyph boxes or decorative-font dependence for actionable text.
5. WHEN original drawn gaps or character variants are used, THE design SHALL record their origin and distinguish artistic representation from unrecorded simulation facts.
6. WHEN tone and imagery are reviewed, THE interface SHALL preserve small-American-town humor and fictional underworld bureaucracy, use joss paper/spirit money terminology and avoid jokes targeting people who honor ancestors.
7. WHEN detailed visual decisions are made, THE design SHALL obtain explicit approval for final asset/font adoption and the visual recipe; this draft authorizes neither paid acquisition nor image-generation requests.

## LV-R14 — Simulation, replay, asynchronous and release boundaries

**User story:** As a player or reviewer, I want the new presentation to leave the accepted deterministic game and delivery policies intact.

1. WHEN this Spec is implemented under a later grant, THE simulation SHALL preserve existing rules, economy, legal options, outcomes, fallback and interactive advancement semantics without new gameplay or model architecture.
2. WHERE read-only Rust/WASM DTOs are extended, THE extensions SHALL expose existing authoritative facts without adding World/checksum state, changing replay v5 input shapes or duplicating rule computation.
3. WHEN any gameplay input is submitted, THE existing core/worker SHALL retain ownership of ordering, input sequence allocation, apply timing and currentWorld; the main-thread UI SHALL NOT synthesize simulation authority.
4. WHEN loading, cancellation, reset, stale response or delayed resolution occurs, THE interface SHALL preserve the existing asynchronous bridge safeguards and SHALL NOT apply feedback to another world, Soul or obsolete action.
5. WHEN presentation operations, map visibility, motion or art change, THE same recorded inputs SHALL retain their existing simulation results; replay SHALL NOT require model requests or presentation-driven inputs.
6. WHEN public, judge or own-account Deploy-button surfaces are affected, THE accepted delivery entrances and policies SHALL remain intact, including public/generic default-off inference and retained judge gating/counters.
7. WHEN approval for this UI Spec is given, THE existing model budgets, production resources and deployment grants SHALL NOT be increased or inferred from it.
8. THE scope SHALL exclude generated presentation text, new conflict/economy/customization rules, free movement, sound, a new settings page, replay gallery, formal mobile support and broader simulation/model redesign.

## LV-R15 — Observable evidence and staged approval

**User story:** As the Author, I want a reviewable requirements/design/tasks sequence and proof from the actual local interface before accepting the redesign.

1. BEFORE implementation begins, THE Spec process SHALL review requirements, resolve and approve design decisions, and approve bounded tasks separately; completion of one document SHALL NOT authorize the next execution stage.
2. WHEN implementation verification is later authorized, THE acceptance evidence SHALL trace functional criteria to appropriate existing test layers and local actual-use observations, distinguishing automated assertions from qualitative visual review.
3. WHEN primary operation is assessed, THE evidence SHALL cover all five Player_Node families, every legal option and complete preview/result, existing death/Dream/rebirth controls, Bribe and Haunt lifecycle, and delivered carry-over/Set/Adjust operations.
4. WHEN lifecycle cases are assessed, THE evidence SHALL cover exact u64 amounts, invalid syntax, authoritative ineligibility/cap/cost changes, rejection versus admission versus application, stale/reset responses and preserved pending-decision fallback/cancellation.
5. WHEN visual acceptance is assessed, THE evidence SHALL come from the actual locally rendered implementation at 1280×720 and 1024×640, with long names, maximum-capacity lists, complete Needed/consequence/customization content, 200% zoom and keyboard operation.
6. WHEN motion acceptance is assessed, THE evidence SHALL include the approved key-event set, including player-choice nodes and the player's own death/rebirth, immediate reveal/skip, interruption and reduced-motion behavior; static direction samples alone SHALL NOT count as this proof.
7. WHEN comprehension is reviewed, THE review SHALL record whether identity, ties, stakes, eligibility and lifecycle explanations are understandable; it SHALL NOT impose a documentation-free stranger full-reincarnation completion-rate gate.
8. WHEN evidence is produced, THE process SHALL use local rules-only operation and existing offline/fake-boundary test facilities within an explicit verification grant; this Spec SHALL NOT require new live model calls, cloud changes or deployments for acceptance.
9. BEFORE final acceptance, THE Author SHALL review the functional evidence and actual visual result against the primary hierarchy/efficiency goal; the draft SHALL NOT claim an implementation, passed checks or approved final art that has not been observed.
