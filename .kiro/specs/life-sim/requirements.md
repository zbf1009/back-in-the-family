# Requirements Document

## Introduction

This is spec 4 of Back in the Family and the first spec of the vertical slice. It replaces the skeleton model in `sim-core` (the generic `Entity` with `value` and `affinity`, and the synthetic `Workload`) with a thin life simulation: residents, households, relationships, debts, aging, births, deaths and inheritance, plus the soul-identity core (permanent souls, one soul in one place, a waiting queue, conservation of souls). Outsiders enter only as bodies (imported vessels or rebuilt bodies) for souls that have waited too long.

The data model of residents, relationships and the event log follows the evaluation-card field set (`eval/cards/README.md`, section "Field set"; `Person`, `Relation` and `Event` in `crates/sim-core/src/llm/context.rs`), so that a decision-node context built from a live world renders through the existing System One mapping v1 (`decision.system_one.v1.txt`) without changes.

Deadline: 2026-11-14.

Out of scope: narrator nodes; player choices beyond the existing `TickInput` plumbing; the underworld economy (joss paper, dreams, hauntings, bribes, slot choice by the player); slow-think and any model call; scenes; presentation text; UI work beyond what the web shell already shows.

### Open points for the design phase

These are deliberately not decided here. The design offers 2–3 options for each and the Author picks.

- OP-1: the unit that owns money and property (household, person, or both) and how a person's Card_Person `wealth` is derived from it.
- OP-2: the inheritance rule (heir order, splitting, what happens to an estate with no heir) and the debt-at-death rule (transfer to an heir, forgiveness, or both by condition); and the rule for open Debts whose creditor dies (transfer of the claim to the creditor's heirs, or forgiveness).
- OP-3: which waiting soul a birth takes (for example longest wait first) and whether a newborn needs one or two living parents.
- OP-4: the condition that selects an Imported_Vessel versus a Rebuilt_Body for a released soul, and which household an arriving outsider joins.
- OP-5: the numeric parameters set by sim-cli measurement: Max_Wait, birth, death, marriage, loan and relationship-change rates, the grudge threshold, and fine-tuning of the Player_Soul's opening age band (Requirement 12.5 sets 20 to 50 years inclusive; design may adjust it). Requirements fix the targets (Requirement 17); design fixes the numbers; the minimum adult age of an arriving outsider body (Requirement 11.2 uses 18 provisionally; design confirms or changes it); and any ratio of outsider-body arrivals to native births tighter than Requirement 17.8, set by measurement.
- OP-6: the replacement `InputPayload` set and how sim-cli `batch` generates random inputs for it.
- OP-7: how opening-world history (the events behind existing families, debts and grudges) is placed in the Event_Log (for example at ticks before 0 or at tick 0).
- OP-8: how the checksum cost of a growing Event_Log is kept bounded (for example incremental hashing), and whether a ticks-per-second threshold is set in addition to reporting it.
- OP-9: the Acceptance_Seeds and how the 80-year runs fit into `scripts/gates.sh` run time.
- OP-10: where the Context_Builder lives (sim-core library code or test support) and which Family and options its test node uses; and how live Event IDs above `e9999` map to context-local IDs accepted by `EventId::new`; and whether the Person ID counter starts at 1 or Person IDs are mapped, since the card parser rejects person id 0 (no upper bound below i64::MAX).

## Glossary

- **Life_Sim**: the deterministic life simulation in `crates/sim-core` that this spec adds, including the tick loop, the world state and the Event_Log.
- **World**: the full simulation state of the Life_Sim at one tick. Everything in the World enters the Checksum.
- **Person**: one body that has existed in the World, living or dead, with a stable Person ID. Fields follow Card_Person.
- **Resident**: a living Person.
- **Card_Person**: the person field set of the evaluation cards: `id`, `name`, `age`, `sex`, `alive`, `origin`, `traits`, `wealth`, `soul_id`.
- **Traits**: the seven card traits `greed`, `loyalty`, `pride`, `warmth`, `temper`, `vindictiveness`, `piety`, each an integer in -3..=3.
- **Origin**: one of `native` (born in town), `possessed` (Imported_Vessel), `rebuilt` (Rebuilt_Body), `official` (underworld office staff; not produced by this spec).
- **Household**: a group of Residents living together, holding money and property as decided in OP-1.
- **Relation**: a directed record from one Person to another with `affinity` (-100..=100), `trust` (-100..=100) and tags from the card tag list (`parent`, `child`, `sibling`, `spouse`, `former_spouse`, `grandparent`, `grandchild`, `cousin`, `in_law`, `friend`, `rival`, `neighbor`, `employer`, `employee`, `suitor`, `former_suitor`).
- **Kinship_Tag**: the Relation tags `parent`, `child`, `sibling`, `spouse`, `former_spouse`, `grandparent`, `grandchild`, `cousin`, `in_law`.
- **Event_Log**: the append-only list of Events; the single source of truth for history.
- **Event**: one Event_Log entry with a stable Event ID, `tick`, `type` from the card event-type list, `actors` in the card's actor order, `magnitude`, `caused_by`, `tags` and, for `loan` and `promise` only, `due_tick`.
- **Afterlife_Event_Types**: the event types in which a dead Person may appear as an actor after the death: `death`, `offering`, `dream`, `haunting`, `appeal`, `debt_transfer`, `debt_forgiven`, `inheritance`.
- **Debt**: an open obligation from a debtor Person to a creditor Person, created by a `loan` Event, with an amount and a `due_tick`.
- **Money_Flow**: one entry of the closed, documented list of ways money enters, leaves or moves inside the World (sources, sinks and transfers).
- **Soul**: a permanent identity with a stable Soul ID, separate from any body.
- **Waiting_Queue**: the ordered set of Souls that are not in a living body, each with the tick its wait began.
- **Soul_Place**: where a Soul is: in exactly one Resident's body, or in the Waiting_Queue.
- **Total_Souls**: the number of Souls created with the World.
- **Max_Wait**: the longest a Soul may stay in the Waiting_Queue before release into an outsider body, in days (number set in OP-5).
- **Imported_Vessel**: a blank adult body allocated by the underworld office, arriving from out of town, possessed by a released waiting Soul; Origin `possessed`.
- **Rebuilt_Body**: an adult body rebuilt for a released waiting Soul; Origin `rebuilt`.
- **Player_Soul**: the Soul the player controls; designated at World creation.
- **Opening_World**: the World at tick 0, generated from the seed.
- **Name_List**: the project's own list of first names and surnames, stored in the repository.
- **Mood**: a thin, long-term integer state per Resident covering mood and stress, with a documented range.
- **Frozen_Context**: `sim_core::llm::FrozenContext`, the decision-node context type used by the renderer, the System One mapping and the validator.
- **Context_Builder**: the function that builds a Frozen_Context for a decision node from the current World.
- **System_One_Mapping_v1**: `eval/probe/templates/decision.system_one.v1.txt` as rendered by `sim_core::llm::system_one::render_system_one`.
- **Checksum**: the per-tick checksum over the canonical serialization of the World.
- **Derived_State**: caches and indexes computed from the World; outside the Checksum.
- **Sim_Cli**: the native binary in `crates/sim-cli`.
- **Sim_Wasm**: the wasm-bindgen crate `crates/sim-wasm`.
- **Snapshot**: a read-only JSON view of Residents, Households and Souls exposed by Sim_Wasm.
- **Parity_Fixture**: a native-recorded replay file in `fixtures/parity/`.
- **Gates_Script**: `scripts/gates.sh`.
- **Web_Shell**: the existing `web/` page from the web-shell spec that shows tick and Checksum.
- **Acceptance_Seeds**: the fixed set of at least 5 seeds used for the 80-year acceptance runs (chosen in OP-9).
- **Life_Run**: 29,200 ticks (80 years of 365 days).
- **Author**: the project owner.

## Requirements

### Requirement 1: Remove the skeleton model

**User Story:** As the developer, I want the placeholder model and synthetic workload gone, so that every tick does real life-simulation work and nothing pretends to be a resident.

#### Acceptance Criteria

1. THE Life_Sim SHALL contain no `Entity` placeholder type, no `Workload` type, no Light or Pairwise mode, and no placeholder tick step that changes the skeleton `value` or `affinity` fields.
2. THE Sim_Cli, Sim_Wasm, the files in `fixtures/` and the code in `web/` SHALL read and write world configurations that have no `workload` field.
3. IF a world configuration or replay file given to the Sim_Cli or Sim_Wasm contains a `workload` field, THEN THE Sim_Cli or Sim_Wasm SHALL reject it with an error indicating the unknown field and create no World.
4. THE Life_Sim SHALL replace the placeholder `SetValue`, `Spawn` and `Despawn` inputs with an `InputPayload` set that acts on Persons, Households or Souls (OP-6) and contains at least one payload kind whose valid application changes the Checksum.
5. IF an input is invalid when it is applied (it names a Person, Household or Soul that does not exist or is not in the state the payload requires, or it carries a value outside the payload's documented range), THEN THE Life_Sim SHALL skip the input, leave the rest of the World unchanged by it, and record the input's tick, sequence number and rejection reason in the World, inside the Checksum.

### Requirement 2: Persons

**User Story:** As the slow-think spec author, I want every person to carry the card person fields, so that decision contexts render from live state.

#### Acceptance Criteria

1. THE Life_Sim SHALL store, for every Person, a stable Person ID, a full name (first name and surname), a birth tick, a sex (`female` or `male`), an alive flag, a death tick that is present exactly when the alive flag is false, an Origin, Traits and a Soul ID.
2. THE Life_Sim SHALL keep every Trait value of every Person in -3..=3.
3. THE Life_Sim SHALL compute a Person's age in whole years as (end tick − birth tick) divided by 365, rounded down, where the end tick is the current tick for a Resident and the death tick for a dead Person.
4. WHEN a Person dies, THE Life_Sim SHALL keep the Person record, set the alive flag to false and set the death tick to the tick of the death, leaving the Person ID, name, birth tick, sex, Origin, Traits and Soul ID unchanged.
5. THE Life_Sim SHALL assign Person IDs, Household IDs, Soul IDs and Event IDs from dedicated monotonic counters, one counter per ID kind, and SHALL never assign an ID value that was already assigned within the same ID kind.

### Requirement 3: Households, money and property

**User Story:** As a player, I want families to live in households with money and property, so that births, deaths and debts have material stakes.

#### Acceptance Criteria

1. THE Life_Sim SHALL place every Resident in the member list of exactly one Household at the end of every tick.
2. THE Life_Sim SHALL place no dead Person in any Household's member list at the end of every tick.
3. THE Life_Sim SHALL store every money balance as a non-negative integer number of dollars, and every property item with one kind from `land`, `house`, `shop`, `heirloom` and exactly one owner of the unit chosen in OP-1.
4. THE Life_Sim SHALL make every change to a money balance part of exactly one Money_Flow from the documented Money_Flow list, with each transfer between owners leaving total money unchanged.
5. WHEN a tick completes, THE Life_Sim SHALL satisfy: total money in the World after the tick equals total money before the tick plus the sum of that tick's Money_Flow sources minus the sum of that tick's Money_Flow sinks.
6. WHEN the last Resident member leaves a Household, THE Life_Sim SHALL dissolve the Household in the same tick and settle all its money and property by the inheritance rule (OP-2), so that the dissolved Household holds no money and no property at the end of that tick.

### Requirement 4: Relationships and kinship

**User Story:** As a player, I want residents to have kin, friends and rivals whose feelings change over time, so that grudges and loyalties emerge from the simulation.

#### Acceptance Criteria

1. THE Life_Sim SHALL store at most one Relation per ordered pair of Persons, with `affinity` in -100..=100, `trust` in -100..=100, and tags only from the card tag list. Each tag states what the `to` Person is to the `from` Person: a Relation from A to B tagged `parent` means B is A's parent.
2. THE Life_Sim SHALL store no Relation from a Person to the same Person at the end of every tick.
3. THE Life_Sim SHALL keep these Kinship_Tag pairs consistent at the end of every tick: `parent` from A to B exists exactly when `child` from B to A exists; `spouse` from A to B exists exactly when `spouse` from B to A exists; `sibling` from A to B exists exactly when `sibling` from B to A exists.
4. THE Life_Sim SHALL keep the parent graph acyclic at the end of every tick, so that following `parent` tags from any Person never leads back to that Person.
5. THE Life_Sim SHALL keep, at the end of every tick, at most two Relations tagged `parent` from each Person.
6. THE Life_Sim SHALL keep, at the end of every tick, at most one Relation tagged `spouse` from each Resident whose `to` Person is a Resident.
7. WHEN a Person dies, THE Life_Sim SHALL keep the `spouse` tag on both Relations between the dead Person and their spouse, with no `former_spouse` tag replacing it.
8. WHEN an Event of type `quarrel`, `insult`, `help`, `gift`, `theft` or `apology` is appended, THE Life_Sim SHALL change `affinity`, `trust` or both on the Relations between that Event's actors, in the same tick, by no more than the per-event-type bounds documented in design, and SHALL keep the results within -100..=100.
9. WHEN a Resident whose spouse has died marries again, THE Life_Sim SHALL keep the `spouse` tag on both Relations between the Resident and the dead spouse unchanged, with no `former_spouse` tag replacing it; criterion 6 limits only spouses who are Residents.

### Requirement 5: Event log

**User Story:** As the narrator and slow-think spec authors, I want one append-only event log with causal pointers, so that every fact and summary can be traced to recorded events.

#### Acceptance Criteria

1. WHEN a birth, death, marriage, loan, repayment, debt transfer, debt forgiveness, inheritance, possession or rebuild occurs, THE Life_Sim SHALL append to the Event_Log, in the same tick, an Event of the matching card type (`birth`, `death`, `marriage`, `loan`, `repayment`, `debt_transfer`, `debt_forgiven`, `inheritance`, `possession`, `rebuild`) whose `tick` is that tick.
2. THE Life_Sim SHALL never remove an Event from the Event_Log and never change any field of an Event after it is appended.
3. THE Life_Sim SHALL give every Event a `type` from the card event-type list (`eval/cards/README.md`, "Field set") and `actors` whose count and order match the card's actor list for that type, with a single actor for `accident` allowed only when nobody else was involved.
4. THE Life_Sim SHALL set `magnitude` to a non-negative amount in dollars for `deal`, `loan`, `repayment`, `debt_transfer`, `debt_forgiven` and `inheritance` Events, to an intensity in 1..=100 for `quarrel`, `insult`, `help`, `gift`, `theft` and `apology` Events, and to 0 for every other type.
5. THE Life_Sim SHALL set `due_tick` on every `loan` and `promise` Event and on no Event of another type.
6. THE Life_Sim SHALL make every `caused_by` entry the ID of an Event already in the Event_Log with a lower Event ID and a tick less than or equal to the citing Event's tick.
7. THE Life_Sim SHALL make every actor of every Event the Person ID of a Person in the World.
8. IF an Event to be appended has an actor whose `death` Event has a lower Event ID, and the Event's type is not one of the Afterlife_Event_Types, THEN THE Life_Sim SHALL not append the Event and SHALL leave the World unchanged by that Event.
9. THE Life_Sim SHALL give every Event only tags from the card event-tag list: `public`, `private`, `witnessed`, `written`, `verbal`, `partial`, `cash`, `joss_paper`, `land`, `house`, `shop`, `heirloom`, `deathbed`.
10. THE Life_Sim SHALL include the Event_Log in the Checksum.

### Requirement 6: Aging and death

**User Story:** As a player, I want residents to age and die, so that lives end and souls move on.

#### Acceptance Criteria

1. WHEN a tick runs, THE Life_Sim SHALL decide for each Resident whether the Resident dies in that tick, using the Resident's age and a seeded random stream keyed by the Resident's Person ID, at rates set in design (OP-5).
2. THE Life_Sim SHALL keep every Resident's age in 0..=120 years at the end of every tick.
3. WHEN a Resident dies, THE Life_Sim SHALL, in the same tick, set the death tick, append one `death` Event with the deceased as actor, remove the deceased from the Household member list, and place the deceased's Soul in the Waiting_Queue with the wait beginning at the death tick.
4. THE Life_Sim SHALL start no Event, Money_Flow or Relation change on behalf of a dead Person after that Person's death tick, except Events whose type is one of the Afterlife_Event_Types.
5. IF an input names a dead Person as the Person who acts, THEN THE Life_Sim SHALL reject the input as invalid under Requirement 1.5.

### Requirement 7: Inheritance and debts at death

**User Story:** As a player, I want estates and debts to pass on when someone dies, so that one life's choices weigh on the next.

#### Acceptance Criteria

1. WHEN a Person dies holding a non-zero estate (the money and property attributed to that Person by the ownership rule, OP-1), THE Life_Sim SHALL, in the tick of the death, pass the whole estate by the inheritance rule (OP-2) as Money_Flow transfers and property moves only, and append exactly one `inheritance` Event per heir with the `death` Event in `caused_by`.
2. WHEN a Person dies as the debtor of one or more open Debts, THE Life_Sim SHALL, in the tick of the death, transfer or forgive each of those Debts by the debt-at-death rule (OP-2) and append exactly one `debt_transfer` or `debt_forgiven` Event per Debt, citing in `caused_by` both that Debt's `loan` Event and the `death` Event.
3. THE Life_Sim SHALL append no `inheritance` Event that names as heir a Person with Origin `possessed` or `rebuilt` for a `death` Event whose Event ID is lower than that Person's `possession` or `rebuild` Event ID.

### Requirement 8: Debts

**User Story:** As a player, I want residents to lend and owe money with due dates, so that debts fall due and create stakes.

#### Acceptance Criteria

1. WHEN a `loan` Event is appended, THE Life_Sim SHALL, in the same tick, open one Debt from the debtor to a creditor who is a different Person, with an open amount equal to the Event's `magnitude` (at least 1), a `due_tick` equal to the Event's `due_tick` (later than the Event's tick), and a link to that `loan` Event, and SHALL move the loaned amount from creditor to debtor as a Money_Flow.
2. WHEN a debtor repays all or part of a Debt, THE Life_Sim SHALL move the repaid amount from debtor to creditor as a Money_Flow, reduce the open amount by exactly the repaid amount, and append a `repayment` Event whose `magnitude` equals the repaid amount and whose `caused_by` cites the `loan` Event. The repaid amount is in 1..=the open amount and is no more than the money available to the debtor under the money owner decided in OP-1.
3. THE Life_Sim SHALL keep the open amount of every open Debt in 1..=the `magnitude` of the Debt's `loan` Event.
4. WHEN the open amount of a Debt reaches 0, THE Life_Sim SHALL close the Debt in the same tick.
5. IF the current tick is later than a Debt's `due_tick` and the open amount is above 0, THEN THE Life_Sim SHALL keep the Debt open, because a Debt closes only through criterion 4 or through the debt-at-death rule in Requirement 7.2.

### Requirement 9: Soul identity

**User Story:** As a player, I want my soul to stay the same across bodies and to be in exactly one place, so that rebirth has clear rules.

#### Acceptance Criteria

1. WHEN Opening_World generation completes or a tick completes, THE Life_Sim SHALL hold each Soul in exactly one Soul_Place: either the body of exactly one Resident or the Waiting_Queue, never both.
2. WHEN Opening_World generation completes or a tick completes, THE Life_Sim SHALL give each Resident exactly one Soul ID that refers to an existing Soul, and SHALL give no two Residents the same Soul ID.
3. WHEN Opening_World generation completes or a tick completes, THE Life_Sim SHALL make the number of Residents plus the number of Souls in the Waiting_Queue equal Total_Souls.
4. THE Life_Sim SHALL create Souls only during Opening_World generation, so that the number of Souls and the Soul ID counter stay unchanged by every tick.
5. THE Life_Sim SHALL set a Person's Soul ID when the Person is created and keep it unchanged for the rest of the run, including after the Person's death, where it records the Soul that occupied that body and does not count as a Soul_Place.
6. WHEN Opening_World generation completes, THE Life_Sim SHALL designate exactly one Soul as Player_Soul and keep that same Soul ID as the Player_Soul for every later tick of the run.

### Requirement 10: Births

**User Story:** As a player, I want newborns to be the town's own returning souls, so that the sealed-town premise holds.

#### Acceptance Criteria

1. WHEN the Life_Sim decides a birth during a tick, from seeded random streams at rates set in design (OP-5), THE Life_Sim SHALL remove one Soul other than the Player_Soul from the Waiting_Queue by the selection rule (OP-3) and set that Soul as the newborn's Soul ID in the same tick.
2. IF the Waiting_Queue holds no Soul other than the Player_Soul when a tick's births are decided, THEN THE Life_Sim SHALL create no newborn and append no `birth` Event in that tick.
3. WHEN a birth occurs, THE Life_Sim SHALL create the newborn as a Resident with Origin `native` and a birth tick equal to the current tick, place it in the Household of one of its living parents, and append one `birth` Event at the current tick with actors in the card actor order for `birth`.
4. WHEN a birth occurs, THE Life_Sim SHALL link the newborn to each of its parents (one or two, OP-3) with a `parent` tag from the newborn to the parent and a `child` tag from the parent to the newborn. Every one of those parents SHALL be a Resident at the birth tick.
5. WHEN a birth occurs, THE Life_Sim SHALL derive the newborn's Traits from seeded random streams keyed by the newborn's Person ID.

### Requirement 11: Outsiders

**User Story:** As a player, I want souls that wait too long to come back in outsider bodies, so that waiting is bounded without new souls entering the town.

#### Acceptance Criteria

1. WHEN a tick begins in which a Soul other than the Player_Soul has a wait (the current tick minus the tick its wait began) that exceeds Max_Wait, THE Life_Sim SHALL, in that same tick, remove the Soul from the Waiting_Queue and place the Soul in a new Imported_Vessel or Rebuilt_Body chosen by the selection rule (OP-4), and SHALL do this for every Soul that meets the condition in that tick.
2. WHEN an outsider body arrives, THE Life_Sim SHALL create a Person aged 18 or older with Origin `possessed` for an Imported_Vessel or `rebuilt` for a Rebuilt_Body, no Kinship_Tags at arrival, membership in exactly one Household (chosen by OP-4), and one `possession` (Imported_Vessel) or `rebuild` (Rebuilt_Body) Event that lists the new Person as an actor.
3. THE Life_Sim SHALL keep the wait of every Soul in the Waiting_Queue other than the Player_Soul at or below Max_Wait at the end of every tick.
4. WHEN an outsider body arrives, THE Life_Sim SHALL give the new Person the Soul ID of the released waiting Soul and SHALL leave Total_Souls unchanged.

### Requirement 12: Opening world

**User Story:** As a player, I want to start as an adult in a town that already has families, debts and grudges, so that the first life has stakes from minute one.

#### Acceptance Criteria

1. WHEN a World is created from a seed, THE Life_Sim SHALL generate an Opening_World with between 40 and 60 Residents, inclusive.
2. WHEN a World is created from a seed, THE Life_Sim SHALL generate at least one Household whose members include a Resident and that Resident's child, linked by a `parent` Relation from the child to the parent and a `child` Relation from the parent to the child.
3. WHEN a World is created from a seed, THE Life_Sim SHALL generate at least one open Debt whose debtor and creditor are both Residents, linked to its `loan` Event, with a `due_tick` greater than 0.
4. WHEN a World is created from a seed, THE Life_Sim SHALL generate at least one directed Relation between two Residents with `affinity` below the grudge threshold (OP-5), and at least one `quarrel`, `insult` or `theft` Event whose actors include both of those Residents, placed in the Event_Log as decided in OP-7.
5. WHEN a World is created from a seed, THE Life_Sim SHALL designate as Player_Soul the Soul of exactly one Resident whose age is inside the Player_Soul opening age band of 20 to 50 years inclusive (design may adjust the band, OP-5).
6. WHEN a World is created twice from the same seed, THE Life_Sim SHALL produce two Opening_Worlds with equal Checksums.

### Requirement 13: Names

**User Story:** As a player, I want every resident to have a recognizable name, so that I can follow who is who.

#### Acceptance Criteria

1. WHEN the Life_Sim creates a Person (in Opening_World generation, at a birth, or at an outsider body's arrival), THE Life_Sim SHALL give the Person a full name made of exactly one first name and exactly one surname, each taken from the Name_List.
2. THE Name_List SHALL consist only of names written for this project and stored in the repository, and SHALL contain no name data copied from a third-party source.
3. THE Life_Sim SHALL keep the full names of all Residents pairwise distinct at the end of every tick, where two full names count as equal when both the first name and the surname are equal.

### Requirement 14: Mood

**User Story:** As the narrator spec author, I want a thin long-term mood per resident, so that later specs can read who is under strain.

#### Acceptance Criteria

1. THE Life_Sim SHALL keep every Mood value of every Resident an integer inside the range documented in design, at World creation and at the end of every tick.
2. WHEN an Event that lists a Resident among its `actors` is appended, THE Life_Sim SHALL change that Resident's Mood by the amount the design assigns to that event type and actor position, clamped to the documented range.
3. IF a tick appends no Event that lists a Resident among its `actors`, THEN THE Life_Sim SHALL leave that Resident's Mood unchanged in that tick.

### Requirement 15: Card-format compatibility

**User Story:** As the slow-think spec author, I want decision contexts built from the live world to use the card format unchanged, so that System_One_Mapping_v1 and the validator work without changes.

#### Acceptance Criteria

1. WHEN the Context_Builder builds a decision Frozen_Context for a Resident subject at the current tick, THE Context_Builder SHALL include the subject in `people` and SHALL take every Person, Relation and Event in the Frozen_Context from the World, with the values the World holds at that tick (age per Requirement 2.3, `wealth` per OP-1) and every value inside the card ranges of the Glossary entries Card_Person, Traits, Relation and Event.
2. THE Context_Builder SHALL render each Person ID as an integer of at least 1, each Event ID as `e` followed by 1 to 4 digits, and each Soul ID as `S-` followed by exactly 4 digits, so that within one Frozen_Context distinct Persons, Events and Souls get distinct IDs and each Soul has the same Soul ID text in every Frozen_Context of a run.
3. THE Context_Builder SHALL produce a `situation` text of at most 80 whitespace-separated words, made only of fixed template text and values read from the World.
4. THE Context_Builder SHALL build only Frozen_Contexts that `frozen_context_from_json` accepts after `frozen_context_to_json`, and the result SHALL equal the original Frozen_Context.
5. THE Context_Builder SHALL build only Frozen_Contexts for which `render_system_one`, given the System_One_Mapping_v1 text, returns a rendering without error for every permutation returned by `render::permutations`.
6. WHEN `validate_raw_choice` receives the options of a Frozen_Context built by the Context_Builder and a raw text equal byte for byte to one of its option IDs, THE validator SHALL return a `Decision` verdict for that option.
7. IF `validate_raw_choice` receives the options of a Frozen_Context built by the Context_Builder and a raw text that equals none of its option IDs, THEN THE validator SHALL return an `Illegal` verdict with reason `OutOfSetOption`.
8. THE Life_Sim SHALL leave the files under `crates/sim-core/src/llm/` and `eval/probe/templates/decision.system_one.v1.txt` byte-identical to their content at the start of this spec.

### Requirement 16: Determinism and replay

**User Story:** As the developer, I want the life simulation to stay bit-for-bit reproducible, so that replays and native/WASM parity keep holding.

#### Acceptance Criteria

1. THE Life_Sim SHALL derive every random draw only from `hash(world_seed, entity_id, stream_tag)` streams, where the entity is a Person, Household or Soul ID, or a world-level stream tag listed in the design document, and SHALL use no other source of randomness.
2. THE Life_Sim SHALL run each tick as the fixed sequence of steps written down in the design document, in the same order on every tick.
3. THE Life_Sim SHALL use no floating-point types in World state or tick logic. It SHALL use integer arithmetic with explicit checked or saturating operations wherever overflow is possible, and a rounding rule stated in the design document for every division.
4. THE Life_Sim SHALL iterate every collection whose iteration can change World state in ascending ID order, and SHALL iterate no hash-ordered collection in tick logic.
5. WHEN a run discards Derived_State at a tick T and rebuilds it from the World, THE Life_Sim SHALL produce, for every tick after T, the same Checksum as an uninterrupted run with the same seed and input stream.
6. WHEN a recorded run is replayed from its seed and recorded input stream, THE Life_Sim SHALL produce a Checksum equal to the recorded Checksum for every recorded tick.
7. WHEN the native build and the WASM build run the seed and input stream of a Parity_Fixture, THE Life_Sim SHALL produce identical Checksums for every tick of that Parity_Fixture.

### Requirement 17: Population targets and measurement

**User Story:** As the Author, I want the town to stay at a playable size over 80 years and the cost of the new model to be measured, so that design parameters rest on evidence.

#### Acceptance Criteria

1. WHEN the Sim_Cli runs a Life_Run for an Acceptance_Seed with the input stream that the Sim_Cli `batch` command generates for that seed (OP-6), THE Life_Sim SHALL keep the number of Residents in 35..=65 at the end of every tick of the Life_Run.
2. THE Life_Sim SHALL contain no rule that blocks a birth or forces a death because the Resident count has reached a fixed bound.
3. WHEN the Sim_Cli `batch` command finishes a seed, THE Sim_Cli SHALL report, in a deterministic report for that seed, the minimum and maximum Resident count at the end of any tick, the Waiting_Queue size at the end of the last tick, the longest wait in days observed for any Soul other than the Player_Soul, the longest wait in days observed for the Player_Soul (listed separately), the total counts of births, deaths, Imported_Vessels and Rebuilt_Bodies over the run, the Resident count by Origin (`native`, `possessed`, `rebuilt`) at the end of the last tick, and the arrival counts by Origin over the run (births as `native`, Imported_Vessels as `possessed`, Rebuilt_Bodies as `rebuilt`).
4. WHEN the Sim_Cli `batch` command runs twice with the same arguments, THE Sim_Cli SHALL print byte-identical deterministic reports, where the deterministic report contains the values of criterion 3, the result of criterion 6 and the pass/fail results of criteria 1, 8 and 9, and excludes the ticks-per-second figure of criterion 5.
5. WHEN the Sim_Cli runs a Life_Run from an Opening_World of 60 Residents, THE Sim_Cli SHALL report the ticks per second of that Life_Run in an output that is not part of the deterministic report.
6. WHEN the Sim_Cli `batch` command runs a seed, THE Sim_Cli SHALL check every invariant of Requirements 3.1, 3.2, 3.5, 4.2 to 4.6, 5.6 to 5.8, 9.1 to 9.3, 11.3 and 20.1 at the end of every tick.
7. IF a check of criterion 6 fails, THEN THE Sim_Cli SHALL report the first violation with its tick and the number of the violated criterion, and exit with a non-zero status.
8. WHEN the Sim_Cli runs a Life_Run for an Acceptance_Seed as in criterion 1, THE Life_Sim SHALL keep the number of outsider-body arrivals (Imported_Vessels plus Rebuilt_Bodies) over the Life_Run at or below the number of native births over the Life_Run; any tighter ratio is set in design by measurement (OP-5).
9. WHEN the Sim_Cli runs a Life_Run for an Acceptance_Seed as in criterion 1, THE Life_Sim SHALL keep the number of Residents in 40..=60 at the end of at least 95% of the ticks of the Life_Run, checked in integer arithmetic as (ticks with the count in 40..=60) × 100 ≥ (ticks of the Life_Run) × 95.

### Requirement 18: WASM snapshot

**User Story:** As the scenes and narrator spec authors, I want a read-only snapshot of the town from WASM, so that later UI work can read residents, households and souls.

#### Acceptance Criteria

1. WHEN a caller requests a Snapshot, THE Sim_Wasm SHALL return JSON for the current World that contains every Resident with its Card_Person fields and Household ID, every Household with its ID and member Person IDs, and every Soul with its Soul ID and Soul_Place, with each list in ascending ID order.
2. WHEN Snapshots are taken at any ticks of a run, THE Sim_Wasm SHALL produce the same World and the same per-tick Checksums as the same seed and input stream run without Snapshots.
3. WHEN a native Snapshot (built by `sim-core` without Sim_Wasm) and a Sim_Wasm Snapshot are taken at the same tick of the same seed and input stream, THE Sim_Wasm SHALL return JSON byte-identical to the native Snapshot.
4. THE Web_Shell SHALL show the tick and the Checksum with no new UI elements, and the existing web Smoke_Test SHALL pass unchanged apart from the regenerated Parity_Fixture.

### Requirement 19: Gates and fixtures

**User Story:** As the developer, I want the new model guarded by the existing gates and new semantic tests, so that "deterministically wrong" behavior is caught.

#### Acceptance Criteria

1. THE Life_Sim test suite SHALL use `proptest`, over generated seeds and input streams, to check these invariants at the end of every tick of each generated run: soul conservation (9.3), one soul one place (9.1, 9.2), one Household per Resident (3.1), no actions by the dead (5.8, 6.4), acyclic kinship (4.4) and money conservation (3.5). A run fails at the first tick where any of these invariants is violated.
2. IF a commit changes any per-tick Checksum that a committed Parity_Fixture records, THEN THE commit SHALL include the Parity_Fixtures regenerated with `scripts/regen-fixtures.sh` and SHALL say in its message that they were regenerated.
3. WHEN the Gates_Script runs from a clean build, THE Gates_Script SHALL exit with status 0 only if every gate passes. The gates include the native and WASM parity tests and the web Smoke_Test, all run against Parity_Fixtures recorded from the Life_Sim model.
4. WHEN this spec adds a check for one of the six invariants listed in criterion 1 or a new gate in the Gates_Script, THE developer SHALL inject the fault that the check guards against, confirm that the check fails, revert the injection, and record in `docs/kiro-log.md` the fault that was injected, the failure that was seen, and the revert. Other checks are covered by ordinary tests.
5. THE `README.md` SHALL list the Name_List with its source and license, and every third-party library added by this spec with its license.

### Requirement 20: Player_Soul waiting

**User Story:** As a player, I want my soul to wait in the underworld until I choose where to be reborn, so that the rules never pick my next body for me.

#### Acceptance Criteria

1. WHILE the Player_Soul is in the Waiting_Queue, THE Life_Sim SHALL keep the Player_Soul in the Waiting_Queue at the end of every tick, whatever its wait, until a player input defined by a later spec places it.
2. THE Life_Sim SHALL exempt the Player_Soul from the automatic release of Requirement 11.1 and from the Max_Wait bound of Requirement 11.3.
3. THE Life_Sim SHALL select for a birth under Requirement 10.1 only Souls other than the Player_Soul.
4. WHILE the Player_Soul is in the Waiting_Queue, THE Life_Sim SHALL count the Player_Soul as a Soul in the Waiting_Queue for Requirements 9.1 and 9.3.
