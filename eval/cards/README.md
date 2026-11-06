# Back in the Family: LLM probe evaluation cards

This directory holds the evaluation cards for the W1 LLM probe. The cards are written and locked before any model is run, so a model's score cannot shape the answers.

Two task types are tested:

- **D, closed-set decision.** The rules offer 2 to 5 legal options for a key NPC. The model picks one option ID.
- **S, structured fact synthesis.** The model reads an event log with causal pointers and returns conclusions in a fixed JSON schema (closed enums plus event-ID evidence). The rules layer can check every reference.

## Files

| Path | Content |
|---|---|
| `schemas/card.schema.json` | JSON Schema for one card (D and S) |
| `schemas/<name>_v1.json` | Output schema the model must produce, one per S family |
| `cards/dev.jsonl` | Development set. Visible to the Kiro side for prompt engineering |
| `cards/locked.jsonl` | Locked set. Read only by the runner, run once |
| `tools/cards_dev.py`, `tools/cards_locked.py` | The only source of card data |
| `tools/cardlib.py` | Card constructors shared by the two data files |
| `tools/build_cards.py` | Renders the data files to `cards/*.jsonl` and `review/*.md` |
| `tools/validate.py` | Schema check plus the cross-field rules below |
| `review/*.md` | Human-readable review sheets rendered from the same data |
| `tools/make_blind.py` | Selects the blind-check cards and writes `blind/sheet.md` (cards without grades) and `blind/author_key.json` (grades) |
| `blind/` | Blind-check sheet, author key, and later the reviewer's labels and the comparison |
| `MANIFEST.sha256`, `LOCK.md` | Written at lock time |

Commands, from this directory:

```bash
python3 tools/build_cards.py
uv run --no-project --with jsonschema==4.25.1 python tools/validate.py
```

## Families

| Task | Family | Node |
|---|---|---|
| D | `dream_interpretation` | The player's ghost sends a dream (intent and content given). How does the dreamer read it and react? |
| D | `will_execution` | Does an heir carry out a will? |
| D | `reconcile_or_revenge` | Does someone holding a grudge reconcile, take revenge, or keep away? |
| D | `debt_repayment` | Does a debtor repay, stall, or refuse? |
| D | `remarriage` | Does a widow or widower remarry? |
| D | `magistrate_ruling` | How does an underworld magistrate rule on the player's appeal? Options and amounts are bounded by the rules |
| S | `grudge_detection` | Who holds a grudge against whom, how strong, which events prove it |
| S | `debt_chain` | Who owes whom, why, and whether a debt passed to an heir |
| S | `broken_promise` | Which promises were broken, kept, or are still pending |
| S | `relationship_shift` | How a relationship changed over the log, and which event turned it |
| D/S | `sanity` | Cards with an obvious answer. Unscored |

All ten families from the brief are kept. One family was added: `sanity`. It separates "the runner or prompt is wired wrong" from "the model cannot do the task". In the previous evaluation round one model scored 3/7 on sanity questions, and its main results could not be interpreted. Sanity cards are reported on their own and never enter any metric.

## Card-writing rules

1. Every card is new. No situation, name or text is taken from earlier evaluation material.
2. Cards are in English. They will be published in the competition repository.
3. Situations belong to this game's world: a small American town of 40 to 60 named residents, sealed underworld, rebirth into the town's own newborns, joss paper offerings, an underworld office with magistrates and a register of souls. Outsiders enter only through possession (an empty body assigned by the underworld office) or, at a higher cost, a rebuilt body.
4. The acceptable set answers one question: is this a reasonable choice for this person in this situation? It does not ask whether the choice is funny, and it does not ask for the single most likely choice. Every option a fair-minded reader would call reasonable for this person is acceptable, so cards usually accept two or three options.
5. `severe` lists only the choices that would look absurd or offensive on screen for anyone in the card's situation. A choice that badly breaks this person's character, or breaks a written rule, without being absurd, is neither acceptable nor severe. `severe` can be empty.
6. Every fact the answer depends on is written on the card, in `situation` or in the structured fields. A reviewer must be able to derive the acceptable set from the card alone.
7. `situation` states facts only. It never states a conclusion, a motive or the expected answer. `author_note` explains the answer and is never shown to the model.
8. Each scenario group uses its own cast. A name appears in one scenario group only.
9. No third-party trademarks, real people, or copyrighted text. Say *joss paper* or *spirit money*, never *hell money*. The town is not named.
10. All numbers are integers.

## Field set

### Time

One tick is one day in these cards. `situation` states ages and elapsed years in words, so the model never has to convert ticks. If the simulation later uses one tick per week, these cards still read correctly.

### Person

| Field | Values |
|---|---|
| `id` | Positive integer, unique within the card |
| `name` | Fictional full name |
| `age` | Years. Townsfolk 0..120. Underworld officials carry a nominal age |
| `sex` | `female`, `male` |
| `alive` | Boolean. For underworld officials, `true` means in office |
| `origin` | `native` (born in town), `possessed` (outsider in a body assigned by the underworld office), `rebuilt` (outsider in a rebuilt body), `official` (underworld office staff) |
| `traits` | All seven traits, each an integer -3..3, 0 = ordinary |
| `wealth` | Non-negative integer, in dollars |
| `soul_id` | `S-GGPP`: scenario group number and person ID. Permanent across lives in the game; within this card set it only has to be unique per body |

Trait set (the same seven on every card):

| Trait | +3 | -3 |
|---|---|---|
| `greed` | grasping, counts every dollar | indifferent to money |
| `loyalty` | stands by kin, friends and their word | drops people and promises easily |
| `pride` | cannot bear to lose face | does not care how they look |
| `warmth` | affectionate, generous with people | cold, distant |
| `temper` | quick to anger | slow to anger |
| `vindictiveness` | holds grudges, wants payback | forgives easily |
| `piety` | reveres ancestors and the underworld | dismisses ghosts and offerings |

`temper` and `vindictiveness` are separate on purpose: anger and grudge-holding were tested as separate variables before, and each gets its own contrast pairs here. `piety` drives the dream, will and magistrate nodes.

### Relation (decision cards only)

`from`, `to`, `affinity` (-100..100), `trust` (-100..100), and `tags` from: `parent`, `child`, `sibling`, `spouse`, `former_spouse`, `grandparent`, `grandchild`, `cousin`, `in_law`, `friend`, `rival`, `neighbor`, `employer`, `employee`, `suitor`, `former_suitor`. Relations are directed: `from` is the person who feels it. Tags say what `to` is to `from`: a relation from Owen to Ruth tagged `grandparent` means Ruth is Owen's grandparent. A dead spouse keeps the tag `spouse`.

Synthesis cards carry no relations. Their conclusions must come from the log; kinship is stated in `situation`.

### Event

| Field | Meaning |
|---|---|
| `id` | `e` plus digits, unique within the card |
| `tick` | Day of the event. Events are sorted by tick. Events on the same tick have no order among themselves |
| `type` | See below |
| `actors` | Person IDs, in the order given below |
| `magnitude` | Dollars for money events and deals; joss paper units for offerings; intensity 1..100 for social events; 0 when not applicable |
| `caused_by` | Earlier events in the same card |
| `tags` | `public`, `private`, `witnessed`, `written`, `verbal`, `partial`, `cash`, `joss_paper`, `land`, `house`, `shop`, `heirloom`, `deathbed` |
| `due_tick` | Only on `loan` and `promise`: the day repayment or fulfilment is due |

Event types and actor order:

| Type | Actors |
|---|---|
| `birth`, `death`, `illness` | the person |
| `accident` | the one responsible, then the one hurt (a single actor when nobody else was involved) |
| `marriage`, `courtship` | the two people |
| `deal` | seller, buyer |
| `loan` | lender, borrower |
| `repayment` | payer, payee |
| `debt_transfer` | previous debtor, new debtor (the creditor is the lender of the loan in `caused_by`) |
| `debt_forgiven` | creditor, debtor |
| `promise` | promisor, promisee |
| `promise_kept` | promisor, promisee |
| `will` | testator, beneficiary |
| `inheritance` | deceased, heir |
| `insult`, `help`, `gift`, `theft` | doer, target |
| `apology` | the one apologizing, the one addressed |
| `quarrel` | the two people |
| `lawsuit` | plaintiff, defendant |
| `offering` | the one burning joss paper, the recipient (a ghost, or an official for a bribe) |
| `dream` | the ghost, the dreamer |
| `haunting` | the ghost, the haunted |
| `possession`, `rebuild` | the outsider entering town |
| `appeal` | the appellant (a ghost, or a living petitioner to the office), the magistrate |

A dead person may still appear in `death`, `offering`, `dream`, `haunting`, `appeal`, `debt_transfer`, `debt_forgiven` and `inheritance` events after the death: ghosts receive offerings, send dreams, haunt and appeal, and a dead person's debts and estate still move. Any other event with a dead actor is a card error.

### Player input

Only on `dream_interpretation` cards: `{"intent": ..., "content": ...}`, where `intent` is one of `warn`, `reassure`, `urge`, `reveal`, `request_offering`, `forbid` and `content` is what the dreamer sees and hears.

## Output schemas (task S)

| Schema | One item per | Closed enums |
|---|---|---|
| `grudge_v1` | directed grudge (absence means none) | `level`: `low`, `medium`, `high` |
| `debt_chain_v1` | debt obligation at the end of the log | `status`: `open`, `repaid`, `transferred`, `forgiven` |
| `broken_promise_v1` | promise event (kept ones optional) | `status`: `broken`, `pending`, `kept` |
| `relationship_shift_v1` | unordered pair whose relationship changed | `direction`: `warmer`, `colder`, `unchanged`, `reversed` |

Every item carries `evidence` (event IDs) and `reason` (free text for presentation only, never scored).

## Grading

### Decision cards

- Acceptable: the chosen option ID is in `acceptable`.
- Severe: the chosen option ID is in `severe`.
- Illegal: the output does not parse or the ID is not an option. Illegal outputs count as not acceptable, are not severe, and are reported as their own rate. In the game they fall back to the rules default.

### Synthesis cards

An output item matches a pattern when every field in the pattern matches: a scalar must be equal, a list means "equal to one of these", and `evidence_any` means the item's `evidence` contains at least one listed ID. In `relationship_shift_v1`, `a` and `b` are unordered.

- Illegal: the output does not parse or fails its output schema. Counted as not acceptable, not severe, reported separately. Severe checks run only on schema-valid outputs.
- Acceptable: schema-valid, every `must_include` pattern is matched by at least one item, and no item matches any `must_not_include` pattern. Extra items are allowed.
- Severe: any condition in `severe_conditions` fires.

Severe conditions:

| Condition | How it is detected |
|---|---|
| `invented_event_id` | Any event ID in the output is not in the card. Automatic |
| `invented_person` | Any person ID in the output is not in the card. Automatic |
| `self_reference` | An item's two people are the same person. Automatic. *Added: always nonsense on screen* |
| `reversed_direction` | An item matches a `severe_patterns` entry for this condition |
| `dead_person_as_actor_after_death` | Same, pattern-based |
| `contradicts_fact` | Same, pattern-based |
| `wrong_debt_holder` | Same, pattern-based. *Added: blaming a debt on someone who never owed it invents a fact, which is worse than missing an item* |

### Shuffle test

- D: each card is run in its base option order and in K=3 fixed permutations: reversed, rotated by one, rotated by two. Duplicate permutations are dropped (a 2-option card has one, a 3-option card has three). A flip is a permutation whose chosen ID differs from the base run. Flip rate = flips / permutations run.
- S: same-tick events are permuted inside each tick block with the same three fixed permutations, deduplicated. A flip is a permutation whose identity set differs from the base run. Identity fields per schema: `grudge_v1` from, to, level; `debt_chain_v1` debtor, creditor, origin_event, status, amount; `broken_promise_v1` promisor, promisee, promise_event, status; `relationship_shift_v1` {a, b}, direction, turning_point.
- An illegal output compares as the value `invalid`.

### Contrast pairs

The two cards of a pair differ in one fact, named in `changed_fact`; `review/*.md` lists every structural difference so reviewers can check it. A pair is direction-consistent when card a's answer falls in `expected.a` and card b's in `expected.b`. For S pairs, "falls in" means every `include` pattern is matched and no `exclude` pattern is matched. The expected subsets of a pair never overlap, so a model that ignores the changed fact cannot pass.

## Thresholds

Fixed before any model run. They are the thresholds of the previous evaluation round, which were also fixed before that round ran.

| Metric | Threshold | Applies to |
|---|---|---|
| Acceptable rate | ≥ 80% | locked, scored cards, D and S separately |
| Severe count | ≤ 1 | locked, scored cards, D and S separately |
| Shuffle flip rate | ≤ 5% | locked, scored cards, D and S separately |
| Contrast direction consistency | ≥ 80% (D: at least 12 of 15 pairs; S: at least 8 of 10) | locked pairs, D and S separately |
| Illegal output rate | reported only | counted as not acceptable |

A runtime and task combination passes when all four thresholds hold. Latency, download size and cold start are measured by the probe and judged there; they are outside these cards.

Because acceptable sets are broad (rule 4), a model that picks options at random already scores well on D. The report states the random-pick baseline next to every D acceptable rate: the mean over cards of |acceptable| / |options| (51.8% on the locked set, 55.6% on dev at the time of writing; the expected severe count at random is 11.2 of 60). The threshold stays at 80%; the baseline only shows how far above chance a result is.

## Sample sizes

| Task | Locked scored cards | Scenario groups | Contrast pairs | Dev cards | Sanity (locked / dev) |
|---|---|---|---|---|---|
| D | 60 (10 per family) | ≥ 24 (≥ 4 per family) | 15 | 18 | 4 / 2 |
| S | 40 (10 per family) | ≥ 16 (≥ 4 per family) | 10 | 12 | 4 / 2 |

Reasoning:

- At a true acceptable rate of 80%, the Wilson 95% interval is about [68%, 88%] for n = 60 and [65%, 90%] for n = 40.
- Cards in one scenario group share a cast and a log, so they are correlated. With 2 to 3 cards per group and an intra-group correlation around 0.3, the design effect is about 1.3, so 60 cards carry roughly the information of 46 independent ones, and 40 of 31.
- A lower bound above 80% would need a true rate near 90% and several hundred cards. The W1 probe has a few days, and every card is reviewed by hand. So the pass rule uses the point estimate, as in the previous round, and the clustered interval is reported next to it. A pass whose lower bound sits far below the threshold is reported as weak evidence, not as a failure.
- 15 D pairs give a 6.7-point resolution on direction consistency; 10 S pairs give 10 points.

## Confidence intervals

- Primary: cluster bootstrap over scenario groups. Resample whole groups with replacement, 10,000 resamples, seed 20261104, recompute the metric on all cards of the drawn groups, report the 2.5th and 97.5th percentiles.
- Also reported: the unclustered Wilson interval and the estimated intra-group correlation, so readers can see how much clustering widened the interval.
- Contrast consistency is bootstrapped over pairs (each pair lives in one group).

## Validation rules

`tools/validate.py` fails on any of these:

- A card fails `schemas/card.schema.json`, or any number is not an integer.
- An ID is reused; a card's `split` does not match its file; a scenario group spans dev and locked; a full name or a first name is reused across scenario groups (officials excepted for first names); within one scenario group a `soul_id` belongs to two different names.
- A person ID, relation end, event actor or `caused_by` reference is missing from the card; `caused_by` points to a later event; events are out of tick order; the context tick is before the last event.
- A dead person acts after death (outside the event types listed above); a person with a death event is marked alive; one soul is in two bodies.
- `situation` is longer than 80 words; a banned phrase appears.
- D: `acceptable` and `severe` overlap or name an unknown option; a scored card accepts every option; the subject is not a living person (officials excepted).
- S: a gold or severe pattern uses a field outside the output schema, an illegal enum value, or a missing person or event; a pattern-based severe condition has no pattern; the log has no tick with two or more events (the shuffle test needs one); relations are present.
- Pairs: not exactly one a and one b card; the two cards differ in task, family, group, split or options; an expected subset is outside that card's acceptable set; the two expected subsets overlap.
- `player_input` appears outside `dream_interpretation`, or is missing there; sanity cards are scored or other cards are unscored.

## Lock procedure

1. Write dev and locked. Run `tools/validate.py` until it passes; read every pair's difference list in the review sheet.
2. Blind check before review: `tools/make_blind.py` picks 12 locked D cards (two per family, distinct groups, non-pair cards first) and writes the author key; its sha256 is recorded before the reviewer sees the sheet. The reviewer grades every option A / N / S from the sheet alone, and `blind/round1_comparison.json` records the comparison. The check calibrates the labelling standard and finds ambiguous cards; it is run once and is not a gate. Labellers can reasonably weigh a character's negative traits differently, so full agreement is not expected. What it must show is that the reviewer's acceptable options mostly fall inside the author's, and every card the reviewer finds ambiguous is rewritten. Changes are logged in `LOCK.md`.
3. The reviewer reviews every dev and locked card. Fixes are made, then validation runs again.
4. Write `MANIFEST.sha256` and `LOCK.md`. After locking, the locked set never changes. A bad card found later is only marked void in `LOCK.md`, with the reason; its answer is not changed.
5. The author imports this directory into the competition repository and records the manifest hash in `docs/kiro-log.md` before any model run.
6. Prompt templates are written against `cards/dev.jsonl` only. The runner alone reads `cards/locked.jsonl`.
