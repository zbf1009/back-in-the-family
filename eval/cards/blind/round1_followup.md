# Blind check, round 1: outcome and follow-up

- Author key sha256 before the reviewer saw the sheet: `b27173b94e54dbe69ad1500a5f17ec14209d8f2c72e260f98c743836b96472dd`.
- Locked set sha256 at that time: `18422785c397f6563e6ee4fab8bd7dfffa367358fdbeb9d8c689cd9a881b0d44`.
- Result: 2 of 12 cards agree under the strict rule (same A set, no A/S clash). In 8 of 12 cards the reviewer's A options are a subset of the author's. 4 cards have an A/S clash (B05, B06, B08, B10). Details: `round1_comparison.json`.

## Decision (author and reviewer, 2026-11-05)

- The labellers weigh negative traits differently: the reviewer tends to pick the harsher option for a character with negative traits, the author the more even-handed one. Both readings are defensible. The reviewer judged the author's key the more neutral reading of the cards.
- The broad standard is kept for both A and S (README rules 4 and 5, now written out explicitly). The blind check is a one-off calibration, not a gate; no second round.
- Cards the reviewer found ambiguous are rewritten. All other answer keys stay as they are.

## Changes after round 1

| Card | Problem | Change |
|---|---|---|
| D-reconcile_or_revenge-012 (B06) | "Joss paper burned in a person's name settles accounts with them" could be read as Warren paying the brother who owed him | Situation now states the custom: a ghost lingers over an open debt until the living forgive it and burn joss paper to send him on. Labels of `burn_paper` and `bill_widow` say what is forgiven and who pays. Answer key unchanged |
| D-remarriage-010 (B10) | With the hearing eight months away, "ask the office for leave now" could be read as impossible | Situation now states applications are open now and decided at the hearing. Labels of `wait_for_hearing` and `ask_office_first` reworded to separate "put off any answer" from "apply now, wed when granted". Answer key unchanged |

The 12 blind cards stay in the locked set. They are only option labels and grades seen by the reviewer, not model outputs, so no leakage to any model results.
