# Requirements Document

## Introduction

Spec 5 of Back in the Family adds a thin underworld to `sim-core`. Dead Souls receive joss paper from offerings by the living, with a yearly cap. The Player_Soul spends joss paper on dreams, hauntings and bribes. Bribes go to the Magistrate, one fixed `official` Person in the World. Pregnancies announce Birth_Slots that the Player_Soul can claim, next to two Standing_Slots (Imported_Vessel and Rebuilt_Body). At rebirth one trait carries over. The spec also adds a general Decision_Node convention, implemented for two nodes: `dream_interpretation` and `magistrate_ruling`. `sim-cli` gets a seeded Auto_Player and new report fields, and the Snapshot shows the underworld state. Life-sim requirements are cited as "LS-R<n>.<m>" and stay in force unless a criterion here changes them.

Out of scope: UI and web changes (except keeping the Smoke_Test green), any model call, exorcism, NPC spending, presentation text beyond fixed templates.

## Glossary

- **Underworld**: the parts of the Life_Sim added by this spec.
- **Resident**: a living Person whose Origin is not `official`. The Magistrate is never a Resident; this narrows the life-sim Glossary entry (Requirement 15.3).
- **Joss_Balance**: the non-negative integer amount of joss paper a Soul holds.
- **Offering**: an `offering` Event in which a Person burns joss paper for a dead Person or for the Magistrate.
- **Offering_Occasion**: the funeral of the dead Person, the anniversary of the death, or Halloween.
- **Yearly_Cap**: the most joss paper one Soul may receive in one Cap_Year, and the most it may spend in that Cap_Year on hauntings and Rebuilt_Bodies.
- **Cap_Year**: the 365-day period that the Yearly_Cap applies to (boundaries are OP-U2).
- **Ghost**: a dead Person whose Soul is in the Waiting_Queue and was in that Person's body at that Person's death. The Ghost acts for that Soul in afterlife Events. A Soul has a Ghost only after it has died at least once in this run; a Soul that has not yet died in this run (including the Player_Soul before its first death) has no Ghost.
- **Connected_Person**: a Resident who counts as connected to a Ghost under the connection rule (OP-U4).
- **Magistrate**: the one Person with Origin `official`, created with the Opening_World. The Magistrate has no Soul, is not a Resident, is exempt from the life rules as listed in Requirement 15, appears only as the recipient of `appeal` and `offering` Events, and is the subject of every `magistrate_ruling` Decision_Node.
- **Bribe**: an `appeal` from the Player_Soul's Ghost to the Magistrate together with an Offering from that Ghost to the Magistrate.
- **Decision_Node**: one firing of a node family (`dream_interpretation` or `magistrate_ruling`) with a stable Node ID, a Frozen_Context, a closed option set, a Rules_Default and a resolution tick.
- **Rules_Default**: the option that the rules choose for a Decision_Node from the context and the subject's traits and relations (personality priors).
- **External_Choice**: a TickInput that names a Decision_Node and one option ID.
- **Birth_Slot**: an announced future local birth, open from its announcement until the birth.
- **Standing_Slot**: one of two slots that stay open while the Player_Soul is in the Waiting_Queue: the Imported_Vessel slot and the Rebuilt_Body slot.
- **Player_Max_Wait**: the longest the Player_Soul may stay in the Waiting_Queue, in days.
- **Carry_Over**: the one trait the player picks from the previous body for the next body.
- **Auto_Player**: the seeded policy in Sim_Cli that generates Player_Soul inputs outside the simulation.
- **NPC_Soul**: a Soul other than the Player_Soul.
- **Player_Life**: one body of the Player_Soul, from the body's creation to its death.
- **Player_Wait**: one stay of the Player_Soul in the Waiting_Queue while it has a Ghost, from the death that began it to the tick the Player_Soul leaves the Waiting_Queue or the end of the run.

## Requirements

### Requirement 1: Joss paper balances

**User Story:** As a player, I want my dead soul to hold joss paper, so that how I treated the living pays off after death.

#### Acceptance Criteria

1. THE Underworld SHALL keep exactly one Joss_Balance per Soul, included in the Checksum, and SHALL keep every Joss_Balance at or above 0 at the end of every tick.
2. THE Underworld SHALL change a Joss_Balance only by a credit from an Offering or by a spend on a dream, haunting, Bribe or Standing_Slot claim, with each credit or spend attributable to exactly one Event in the Event_Log and each Event carrying at most one credit or spend.
3. WHEN a tick completes, THE Underworld SHALL hold, for every Soul, Joss_Balance at the end of the tick equal to Joss_Balance at the start of the tick plus the sum of that tick's credits to that Soul minus the sum of that tick's spends from that Soul.
4. WHILE a Soul is in a Resident's body, THE Underworld SHALL credit no joss paper to that Soul.

### Requirement 2: Offerings by the living

**User Story:** As a player, I want the living to burn joss paper for me on set occasions, so that relationships and piety decide my income.

#### Acceptance Criteria

1. WHEN a tick is an Offering_Occasion of a Ghost, THE Underworld SHALL, in that tick, decide exactly one Offering amount, a non-negative integer, for each eligible living offerer (OP-U3), from an integer formula of the offerer's affinity toward the Ghost, the offerer's piety and the offerer's household money.
2. WHEN a decided Offering amount is at least 1, THE Underworld SHALL, in the same tick, append one `offering` Event with actors (offerer, Ghost) in that order, `magnitude` equal to the decided amount and the tag `joss_paper`.
3. IF a decided Offering amount is 0, THEN THE Underworld SHALL append no `offering` Event for that offerer and credit nothing.
4. WHEN an `offering` Event to a Ghost is appended, THE Underworld SHALL, in the same tick, credit the Ghost's Soul with the smaller of the Event's `magnitude` and the Yearly_Cap minus that Soul's credits so far in the current Cap_Year; the credit is 0 once the cap is reached, and the Event keeps its full `magnitude`.
5. THE Underworld SHALL keep each Soul's total credits in every Cap_Year at or below the Yearly_Cap.
6. THE Underworld SHALL keep each Soul's total spends on hauntings and Rebuilt_Body claims in every Cap_Year at or below the Yearly_Cap.
7. THE Life_Sim SHALL set the `magnitude` of every `offering` Event, including Offerings to the Magistrate, to the amount of joss paper burned, an integer of at least 1; this changes LS-R5.4 for the type `offering` only.
8. THE Underworld SHALL keep joss paper and money as separate accounts: an Offering by a living offerer changes no money balance and is no Money_Flow, so that LS-R3.5 holds unchanged.

### Requirement 3: Decision_Node convention

**User Story:** As the slow-think spec author, I want one convention for decision nodes, so that a decision model can later choose inside rule-built closed sets with replays unchanged.

#### Acceptance Criteria

1. WHEN a Decision_Node fires, THE Underworld SHALL assign it a Node ID from a dedicated monotonic counter and freeze its context with the Context_Builder from the World at that tick.
2. WHEN a Decision_Node fires, THE Underworld SHALL compute a closed set of 2 to 5 options with distinct option IDs, use exactly that set as the Frozen_Context's options, and compute a Rules_Default that is one of those options.
3. WHEN a Decision_Node resolves and a valid External_Choice for it was applied between its firing tick and its resolution tick (both inclusive), THE Underworld SHALL apply the option named by the External_Choice.
4. IF an External_Choice names an unknown or already resolved Decision_Node, names an option ID outside the node's option set, or names a pending Decision_Node that already has a valid External_Choice, THEN THE Underworld SHALL reject the input under LS-R1.5.
5. WHEN a Decision_Node resolves without a valid External_Choice, THE Underworld SHALL apply the Rules_Default.
6. WHEN a Decision_Node resolves, THE Underworld SHALL record in the World, inside the Checksum, the Node ID, the applied option and whether it came from an External_Choice or the Rules_Default.
7. THE Underworld SHALL compute the Rules_Default only from the Frozen_Context and seeded streams keyed by IDs.
8. THE Underworld SHALL keep every Decision_Node pending from its firing until its resolution tick, resolve it exactly once at that tick, and keep its Frozen_Context unchanged while it is pending.
9. THE Underworld SHALL build only Decision_Node contexts that satisfy LS-R15.1 to LS-R15.7, including `magistrate_ruling` contexts whose subject is the Magistrate (Requirement 15.12).
10. THE Underworld SHALL clamp the effects of every applied option to the bounds documented in design.
11. IF, at resolution, a part of the applied option's effect names a Person, Household or Soul that is no longer in the state that effect requires, THEN THE Underworld SHALL skip that part, apply the rest, and still record the resolution under criterion 6.

### Requirement 4: Dreams

**User Story:** As a player, I want to send dreams to people I am connected to, so that I can influence the living without controlling them.

#### Acceptance Criteria

1. WHEN a valid dream input is applied, THE Underworld SHALL, in the tick the input applies on, spend the dream price (OP-U5) from the Player_Soul's Joss_Balance, append one `dream` Event with actors (Player_Soul's Ghost, dreamer), and fire one `dream_interpretation` Decision_Node with the dreamer as subject.
2. THE Underworld SHALL accept as a dream input only a TickInput that carries one dreamer Person ID and one intent from `warn`, `reassure`, `urge`, `reveal`, `request_offering`, `forbid`.
3. IF the Player_Soul has no Ghost (including before its first death), or the Player_Soul is not in the Waiting_Queue, or the dreamer ID names no living Resident, or the dreamer is not a Connected_Person of the Player_Soul's Ghost, or the Player_Soul's Joss_Balance is below the dream price, THEN THE Underworld SHALL reject the dream input under LS-R1.5.
4. WHEN a `dream_interpretation` Decision_Node fires, THE Underworld SHALL put into its Frozen_Context a player input with the dream's intent and a content text made only of fixed template text and World values.
5. WHEN a `dream_interpretation` Decision_Node fires, THE Underworld SHALL include in its option set at least one option that reads the dream as its intent states and at least one option that dismisses the dream.
6. WHEN a `dream_interpretation` Decision_Node fires for a dream with intent `request_offering`, THE Underworld SHALL include in its option set an option whose effect appends an Offering from the dreamer to the Ghost, credited as in Requirements 2.2 and 2.4.
7. WHEN a dream is applied and its `dream_interpretation` Decision_Node resolves, THE Underworld SHALL change no World state other than the dream price spend, the `dream` Event, the Decision_Node record of Requirement 3.6 and the state named by the applied option's effect, and SHALL start no action of the dreamer other than that effect.

### Requirement 5: Hauntings

**User Story:** As a player, I want to haunt people at a joss paper cost, so that grudges can continue after death within limits.

#### Acceptance Criteria

1. THE Underworld SHALL accept as a haunting input only a TickInput that carries one target Person ID.
2. WHEN a valid haunting input is applied, THE Underworld SHALL, in the tick it applies on, spend the haunting price (OP-U5) from the Player_Soul's Joss_Balance, append one `haunting` Event with actors (Player_Soul's Ghost, target) to which that spend is attributed, and change the target's Mood by the bounded amount documented in design, keeping the Mood within its range.
3. IF the Player_Soul has no Ghost (including before its first death), or the Player_Soul is not in the Waiting_Queue, or the target ID names no living Resident, or the target is not a Connected_Person of the Player_Soul's Ghost, or the Joss_Balance is below the haunting price, or the spend would exceed the Yearly_Cap of Requirement 2.6, THEN THE Underworld SHALL reject the haunting input under LS-R1.5.
4. THE Underworld SHALL change, through a haunting, no state of the target other than the target's Mood, and SHALL start no action of the target.

### Requirement 6: Bribes and the magistrate ruling

**User Story:** As a player, I want to bribe the magistrate with an appeal, so that I can try to buy a better place in the rebirth queue.

#### Acceptance Criteria

1. WHEN a valid Bribe input is applied, THE Underworld SHALL, in the same tick, spend the offered amount from the Player_Soul's Joss_Balance as a spend attributable to a new `offering` Event with actors (Player_Soul's Ghost, Magistrate), `magnitude` equal to the offered amount and the tag `joss_paper`, append that `offering` Event and an `appeal` Event with actors (Player_Soul's Ghost, Magistrate), and fire one `magistrate_ruling` Decision_Node with the Magistrate as subject.
2. IF the Player_Soul has no Ghost (including before its first death), or the Player_Soul is not in the Waiting_Queue, or the offered amount is below 1 or above the Joss_Balance, or a `magistrate_ruling` node for the Player_Soul is pending, THEN THE Underworld SHALL reject the Bribe input under LS-R1.5, appending no Event and firing no Decision_Node.
3. THE `magistrate_ruling` option set SHALL be exactly `grant_next_slot`, `grant_later_slot` and `deny`.
4. THE Underworld SHALL compute the Rules_Default of `magistrate_ruling` only from the offered amount, the Magistrate's traits in the Frozen_Context and seeded streams keyed by IDs (Requirement 3.7).
5. WHEN two `magistrate_ruling` nodes have the same Magistrate traits and the same seeded stream values and differ only in the offered amount, THE Rules_Default for the larger amount SHALL be at least as favourable as the Rules_Default for the smaller amount, in the order `deny` < `grant_later_slot` < `grant_next_slot`.
6. WHEN a `grant_next_slot` or `grant_later_slot` ruling is applied while the Player_Soul is in the Waiting_Queue, THE Underworld SHALL change the Player_Soul's access to Birth_Slots as documented in design (OP-U6).
7. IF a `deny` ruling is applied, or any ruling is applied after the Player_Soul has left the Waiting_Queue, THEN THE Underworld SHALL leave the Player_Soul's access to Birth_Slots unchanged and credit no joss paper back to the Player_Soul.

### Requirement 7: Birth_Slots and Standing_Slots

**User Story:** As a player, I want to see open birth slots and choose one, so that I decide my next family.

#### Acceptance Criteria

1. WHEN the Life_Sim decides a local birth, THE Underworld SHALL, in that tick, open a Birth_Slot with an ID from a dedicated monotonic counter, naming the mother's Household and a birth tick a fixed number of days (OP-U7) after the decision tick; this changes the timing of LS-R10.1.
2. WHEN a valid slot-claim input naming an open, unclaimed Birth_Slot is applied, THE Underworld SHALL record the claim for the Player_Soul on that Birth_Slot.
3. THE Underworld SHALL keep at most one claim per Birth_Slot and at most one claimed slot for the Player_Soul.
4. WHEN a claimed Birth_Slot reaches its birth tick, THE Life_Sim SHALL, in that tick, give the newborn the Player_Soul's Soul ID, remove the Player_Soul from the Waiting_Queue, and create the newborn and its `birth` Event as in LS-R10.3 to LS-R10.5.
5. WHEN an unclaimed Birth_Slot reaches its birth tick, THE Life_Sim SHALL select the newborn's Soul as in LS-R10.1 (longest wait first, OP-3 A), and SHALL create no newborn when LS-R10.2 applies.
6. WHILE the Player_Soul is in the Waiting_Queue, THE Underworld SHALL keep both Standing_Slots open, with the Rebuilt_Body price higher than the Imported_Vessel price (OP-U8).
7. WHEN a valid Standing_Slot claim is applied, THE Underworld SHALL, in that tick, spend the slot price from the Player_Soul's Joss_Balance, remove the Player_Soul from the Waiting_Queue, and create the outsider body holding the Player_Soul as in LS-R11.2 and LS-R11.4.
8. IF a slot-claim input arrives while the Player_Soul has no Ghost (including before its first death) or the Player_Soul is not in the Waiting_Queue, or names a closed or already claimed Birth_Slot, or names a Standing_Slot whose price exceeds the Joss_Balance, or names the Rebuilt_Body slot when the spend would exceed the Yearly_Cap of Requirement 2.6, THEN THE Underworld SHALL reject the input under LS-R1.5.
9. WHILE the Player_Soul is in the Waiting_Queue, THE Sim_Wasm SHALL list in every Snapshot at least two open slots with different prices.
10. WHILE a Soul holds a claim on a Birth_Slot, THE Life_Sim SHALL keep that Soul in the Waiting_Queue until the birth, so that LS-R9.1 and LS-R9.3 continue to hold.

### Requirement 8: Player_Soul maximum wait

**User Story:** As a player, I want my wait in the underworld to be bounded, so that the game never stalls on my soul.

#### Acceptance Criteria

1. WHEN a tick begins in which the Player_Soul's wait (as defined in LS-R11.1) exceeds Player_Max_Wait, THE Underworld SHALL, in that same tick, remove the Player_Soul from the Waiting_Queue and place it in a new Imported_Vessel as in LS-R11.2 and LS-R11.4; this replaces LS-R20.1 and the part of LS-R20.2 that exempts the Player_Soul from LS-R11.1.
2. WHEN the Underworld places the Player_Soul under criterion 1 while the Player_Soul holds a Birth_Slot claim, THE Underworld SHALL release that claim in the same tick, leaving the Birth_Slot unclaimed.
3. WHILE the Player_Soul is in the Waiting_Queue, THE Life_Sim SHALL keep the Player_Soul's wait at or below Player_Max_Wait at the end of every tick; this replaces the part of LS-R20.2 that exempts the Player_Soul from LS-R11.3.
4. THE Life_Sim SHALL give the Player_Soul to a newborn only through a claimed Birth_Slot (Requirement 7.4), and otherwise keep LS-R20.3.

### Requirement 9: Carry-over

**User Story:** As a player, I want to carry one trait into my next body, so that a past life leaves a small mark.

#### Acceptance Criteria

1. WHEN the Player_Soul leaves the Waiting_Queue for a new body, by a claimed Birth_Slot, a Standing_Slot claim or the automatic placement of Requirement 8.1, THE Underworld SHALL, in that same tick, apply to the new body the Carry_Over chosen by TickInput, which names one of the seven Traits of the body of the Player_Life that just ended, by the carry-over rule (OP-U9).
2. IF a Carry_Over input names a value outside the seven Traits, or arrives while the Player_Soul has no Ghost (including before its first death) or the Player_Soul is not in the Waiting_Queue, THEN THE Underworld SHALL reject the input under LS-R1.5.
3. THE Underworld SHALL keep every Trait of the new body in -3..=3 after the Carry_Over.
4. THE Underworld SHALL change at most one Trait of the new body through the Carry_Over and SHALL leave the other six Traits as the body would have them without a Carry_Over.
5. IF no valid Carry_Over input applies when the Player_Soul leaves the Waiting_Queue for a new body, THEN THE Underworld SHALL apply the fallback documented in design (OP-U9).

### Requirement 10: NPC souls

**User Story:** As the Author, I want NPC souls to receive offerings but spend nothing, so that calibration moves as little as possible.

#### Acceptance Criteria

1. THE Underworld SHALL credit Offerings to every NPC_Soul by Requirement 2, within the Yearly_Cap of Requirement 2.5.
2. THE Underworld SHALL charge no dream, haunting, Bribe or Standing_Slot spend to an NPC_Soul, so that an NPC_Soul's Joss_Balance never decreases.
3. THE Life_Sim SHALL choose an NPC_Soul's outsider kind by the rule of life-sim OP-4 A, without reading that Soul's Joss_Balance.

### Requirement 11: Auto_Player and batch report

**User Story:** As the developer, I want batches to play the underworld loop reproducibly, so that every mechanic runs in the gates.

#### Acceptance Criteria

1. THE Auto_Player SHALL generate dream, haunting, Bribe, slot-claim, Carry_Over and External_Choice inputs outside the Life_Sim, using only seeded streams keyed by the world seed and stable IDs, and SHALL submit them to the Life_Sim only as TickInputs.
2. WHEN the Sim_Cli `batch` command runs twice with the same arguments, THE Auto_Player SHALL generate byte-identical input streams for every seed.
3. WHEN the Sim_Cli `batch` command finishes a seed, THE Sim_Cli SHALL report, for each Player_Life, the age at death in days and the joss paper credited to the Player_Soul between that death and the next rebirth or the end of the run, whichever comes first.
4. IF a Player_Life is still alive at the end of the run, THEN THE Sim_Cli SHALL report that Player_Life as alive, with no age at death and no credited joss paper.
5. WHEN the Sim_Cli `batch` command finishes a seed, THE Sim_Cli SHALL report the count of `offering` Events, the counts of applied dreams, hauntings and Bribes, the count of applied slot claims for each slot kind (Birth_Slot, Imported_Vessel, Rebuilt_Body), the count of applied Carry_Over inputs, the count of automatic placements under Requirement 8.1, the count of Decision_Node resolutions for each family and source (External_Choice or Rules_Default), and the longest Player_Soul wait in days.
6. THE Sim_Cli SHALL include the fields of criteria 3 to 5 in the deterministic report of LS-R17.4.
7. WHEN the Sim_Cli runs a Life_Run for an Acceptance_Seed with Auto_Player inputs, THE Life_Sim SHALL meet LS-R17.1, LS-R17.8 and LS-R17.9.
8. WHEN the Gates_Script runs, THE Gates_Script SHALL run the Sim_Cli `batch` command with `--require-targets` over the Acceptance_Seeds with Auto_Player inputs and SHALL fail if any target of criterion 7 is missed.
9. IF the count of applied dreams, hauntings, Bribes, Birth_Slot claims, Imported_Vessel claims, Rebuilt_Body claims or Carry_Over inputs, or the count of Decision_Node resolutions of any family, is zero summed over all Acceptance_Seeds, THEN THE Sim_Cli `batch` command with `--require-targets` SHALL report the zero count and exit with a non-zero status; automatic placements under Requirement 8.1 are not claims and do not count as Imported_Vessel claims.
10. THE Auto_Player SHALL, during every Player_Wait, get at least one dream applied if at some tick of that Player_Wait the Joss_Balance covers the dream price and a living Connected_Person of the Player_Soul's Ghost exists, and at least one Bribe applied if at some tick of that Player_Wait the Joss_Balance exceeds the dream price, or is at least 1 while no living Connected_Person of the Ghost exists; the concrete policy is set in design (OP-U12).
11. THE Sim_Cli `batch` command with `--require-targets` SHALL set its exit status without reading the figures of criteria 3 and 4; those figures are report-only evidence for the rule that dying early is never the best strategy.
12. THE Auto_Player SHALL follow a policy under which every count checked in criterion 9 is non-zero when summed over the five Acceptance_Seeds; the concrete policy is set in design (OP-U12).

### Requirement 12: Invariants

**User Story:** As the developer, I want the underworld rules checked every tick, so that deterministically wrong behaviour is caught.

#### Acceptance Criteria

1. WHEN the Sim_Cli `batch` command runs a seed, or the proptest suite runs a generated input stream, THE Sim_Cli and the proptest suite SHALL check at the end of every tick, in addition to the checks of LS-R17.6: non-negative Joss_Balances (Requirement 1.1); joss paper conservation (Requirements 1.2, 1.3); the Yearly_Cap (Requirements 2.5, 2.6); that every `dream` and `haunting` Event appended in that tick names as dreamer or target a living Connected_Person of the acting Ghost at the append tick (Requirements 4.3, 5.3); one soul one place including slot claims (LS-R9.1, LS-R9.3, Requirement 7.10); no dead actor outside the Afterlife_Event_Types (LS-R5.8); the Player_Soul wait bound (Requirement 8.3); and the Magistrate rules (Requirements 15.1, 15.4 to 15.8).
2. IF a check of criterion 1 fails during a Sim_Cli `batch` run, THEN THE Sim_Cli SHALL report the first violation with its seed, its tick and the number of the violated criterion, and exit with a non-zero status, as in LS-R17.7.
3. IF a check of criterion 1 fails during the proptest suite, THEN THE proptest suite SHALL fail the test and report the tick and the number of the violated criterion.
4. WHEN this spec adds a check of criterion 1, THE developer SHALL inject the fault that the check guards against, confirm that the check fails, revert the injection before committing, and record the injection, the failure and the revert in `docs/kiro-log.md`.

### Requirement 13: Snapshot

**User Story:** As the scenes spec author, I want the underworld state in the Snapshot, so that later UI work can show balances, slots and nodes.

#### Acceptance Criteria

1. WHEN a caller requests a Snapshot, THE Sim_Wasm SHALL include in the LS-R18.1 JSON every Soul's Joss_Balance, in ascending Soul ID order.
2. WHEN a caller requests a Snapshot, THE Sim_Wasm SHALL include every open Birth_Slot with its slot ID, mother's Household ID, birth tick, price and claimant Soul ID (or none), in ascending slot ID order, and SHALL list no closed Birth_Slot.
3. WHEN a caller requests a Snapshot, THE Sim_Wasm SHALL include both Standing_Slots with their prices, Imported_Vessel first, if and only if the Player_Soul is in the Waiting_Queue.
4. WHEN a caller requests a Snapshot, THE Sim_Wasm SHALL include every pending Decision_Node with its Node ID, family, subject, option IDs, Rules_Default option ID and resolution tick, in ascending Node ID order, and SHALL list no resolved Decision_Node.
5. THE Sim_Wasm SHALL keep LS-R18.2, LS-R18.3 and LS-R18.4 for the extended Snapshot.

### Requirement 14: Determinism, card format and fixtures

**User Story:** As the developer, I want the underworld to keep every existing guarantee, so that replays, parity and the card format still hold.

#### Acceptance Criteria

1. THE Underworld SHALL follow LS-R16.1 to LS-R16.7.
2. WHEN a recorded run whose input stream holds External_Choices is replayed from its seed and recorded input stream, THE Life_Sim SHALL apply the same option at every Decision_Node as the recorded run and produce the recorded Checksum for every recorded tick, without calling any model.
3. THE Underworld SHALL keep LS-R5.3 to LS-R5.9 for every Event it appends, so that each Event's type is in the card event-type list and each tag is in the card event-tag list.
4. THE Life_Sim SHALL keep the files under `crates/sim-core/src/llm/` and `eval/probe/templates/decision.system_one.v1.txt` byte-identical (LS-R15.8).
5. IF a commit changes any per-tick Checksum that a committed Parity_Fixture records, THEN THE commit SHALL include the Parity_Fixtures regenerated with `scripts/regen-fixtures.sh` and SHALL say in its message that they were regenerated (LS-R19.2).
6. THE Parity_Fixtures SHALL include at least one fixture whose input stream contains an External_Choice that the Life_Sim applies.
7. WHEN the Gates_Script runs from a clean build, THE Gates_Script SHALL exit with status 0 only if every gate passes, including the native and WASM parity tests and the web Smoke_Test, all run against the current Parity_Fixtures.

### Requirement 15: The Magistrate

**User Story:** As the Author, I want the Magistrate to be one fixed official Person in the World, so that rulings have a real card-format subject without disturbing the life rules, the soul count or the population figures.

#### Acceptance Criteria

1. WHEN Opening_World generation completes, THE Life_Sim SHALL hold exactly one Person with Origin `official`, the Magistrate, with a Person ID from the Person ID counter, `alive` true, no death tick, no Soul ID and Traits in -3..=3 drawn from a seeded stream keyed by its Person ID; THE Life_Sim SHALL create no other Person with Origin `official` and SHALL keep every field of the Magistrate unchanged at every later tick.
2. THE Life_Sim SHALL give the Magistrate a fixed nominal age in 200..=999 years (exact value in design) in place of the age of LS-R2.3, and SHALL store no birth tick for the Magistrate; this adjusts LS-R2.1, LS-R2.3 and LS-R6.2 for the Magistrate only.
3. THE Life_Sim SHALL count the Magistrate as no Resident, so that every Resident count leaves the Magistrate out, including LS-R9.3, LS-R12.1, LS-R17.1, LS-R17.3 and LS-R17.9.
4. THE Life_Sim SHALL keep the Magistrate out of every Household member list and give the Magistrate no money balance, no property item and no Debt as debtor or creditor; this exempts the Magistrate from LS-R3.1 and LS-R8, and LS-R3.3 to LS-R3.6 hold unchanged.
5. THE Life_Sim SHALL run no aging, death, birth, marriage, inheritance, Mood, social-act, economy or outsider-arrival rule for the Magistrate, so that the Magistrate never dies, is never a parent, a spouse, an heir or an outsider body, and is exempt from LS-R6.1, LS-R6.3, LS-R7, LS-R10, LS-R11 and LS-R14.
6. THE Life_Sim SHALL give the Magistrate no Soul and count the Magistrate in no Soul_Place, so that LS-R9.1 to LS-R9.6 and Total_Souls apply to Souls and Residents only; the Soul ID of LS-R2.1 and LS-R9.5 is not required for the Magistrate.
7. THE Life_Sim SHALL store no Relation from or to the Magistrate, so that LS-R4 holds unchanged.
8. THE Life_Sim SHALL list the Magistrate as an actor only in `appeal` and `offering` Events and only in the recipient (second) actor position, so that LS-R5.3, LS-R5.7 and LS-R5.8 hold.
9. IF an input names the Magistrate's Person ID in any Person field, including a social `Act` input that names the Magistrate as actor or target, THEN THE Life_Sim SHALL reject the input under LS-R1.5; a Bribe names no Person and reaches the Magistrate only through Requirement 6.1.
10. THE Life_Sim SHALL give the Magistrate a full name of one first name and one surname written for this project and stored in the repository (exact name in design), distinct from the full name of every Resident at the end of every tick; this replaces the Name_List source of LS-R13.1 for the Magistrate only and extends LS-R13.3 to the Magistrate.
11. THE Underworld SHALL make the Magistrate the subject of every `magistrate_ruling` Decision_Node and of no other Decision_Node.
12. WHEN the Context_Builder builds a Frozen_Context whose subject or `people` include the Magistrate, THE Context_Builder SHALL meet LS-R15.1 to LS-R15.7 with the Magistrate in place of the Resident subject of LS-R15.1, rendering the Magistrate with Origin `official`, `alive` true, the nominal age of criterion 2, `wealth` 0 and a fixed Soul ID text of `S-` followed by exactly 4 digits (value in design) that differs from the Soul ID text of every Soul.
13. WHEN a caller requests a Snapshot, THE Sim_Wasm SHALL list the Magistrate with its Card_Person fields in a field of its own and in none of the Resident, Household and Soul lists of LS-R18.1, and SHALL keep LS-R18.2 to LS-R18.4.
14. THE Life_Sim SHALL keep LS-R12.6 and LS-R16 for an Opening_World that includes the Magistrate.

## Open points for design

- OP-U1: decided in requirements (Requirement 15). Design fixes only the Magistrate's name, nominal age, sex, Trait derivation and context Soul ID text.
- OP-U2: Cap_Year boundaries (calendar year from tick 0, or per Soul from death), the Yearly_Cap value, and whether Bribes and dreams count against the spend cap.
- OP-U3: who is an eligible offerer per Offering_Occasion; the offering formula and constants; which tick is Halloween; whether "household money" is the offerer's own balance or the household total; what happens to an Offering for a Ghost whose Soul has been reborn. (Decided: offerings cost no money, Requirement 2.8.)
- OP-U4: the connection rule for Connected_Person (kinship tags, any Relation, affinity threshold).
- OP-U5: dream and haunting prices, haunting Mood effect, haunting `magnitude`, and any rate limits on dreams and hauntings.
- OP-U6: what `grant_next_slot` and `grant_later_slot` give the Player_Soul (priority on Birth_Slots, a reserved slot, a price reduction) and the Rules_Default formula.
- OP-U7: the announcement lead time N; what happens to a Birth_Slot if the mother dies first; whether a claim can be changed or withdrawn.
- OP-U8: Standing_Slot prices; the price when the Player_Soul is placed automatically (Requirement 8.1) with a low Joss_Balance; what happens to the remaining Joss_Balance at rebirth (any forfeit must be an Event under Requirement 1.2).
- OP-U9: the carry-over rule (copy the value or nudge toward it), the fallback with no input, and whether the Carry_Over is part of the claim input or separate.
- OP-U10: Player_Max_Wait value (equal to Max_Wait or separate).
- OP-U11: the `dream_interpretation` option set per intent, option effects and Rules_Default formula. Author's default for the resolution delay, which design confirms: both node families resolve in the same tick they fire, and an External_Choice is an input that applies on the firing tick (Requirement 3.3 with firing tick equal to resolution tick); Requirement 3.11 stays as the fallback.
- OP-U12: the new `InputPayload` kinds and how an External_Choice names a node; the concrete Auto_Player policy, which must meet Requirements 11.10 and 11.12. (Decided: "dying early is never the best strategy" is report-only, Requirement 11.11.)
- OP-U13: re-calibration of LS-R17 targets under announced births and Player_Soul slot claims.
