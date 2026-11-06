# Lock record

Locked: 2026-11-05T00:50:58Z (2026-11-05 08:50 China Standard Time).

## Statement

The answer keys of every card in `cards/dev.jsonl` and `cards/locked.jsonl` (acceptable and severe sets, gold patterns, severe conditions, contrast expectations) were fixed before any model was run on any card. No model output of any kind has been produced against these cards. The pass thresholds in `README.md` were fixed at the same time.

From this point the locked set is not edited. A bad card found later is marked void in the table at the end of this file, with the date and the reason; its answer key is not changed and it is excluded from every metric.

## Contents

| Split | Cards | Scored D | Scored S | Sanity (unscored) | Scenario groups | Contrast pairs (D / S) | sha256 |
|---|---|---|---|---|---|---|---|
| dev | 34 | 18 | 12 | 4 | 22 | 10 (6 / 4) | `77fbec6333eb73ebdeda71cfae8bf46ef648e8f671e57000dcf0543f20b3aac4` |
| locked | 108 | 60 | 40 | 8 | 66 | 25 (15 / 10) | `d5abed2a80ce3f4150b5969b86ba48548c63f9ae2f9d93f0d6bb9a1934714083` |

`MANIFEST.sha256` lists the hash of every other file in this directory.

## How the set was checked before locking

1. `tools/validate.py` passed on all 142 cards (schema, cross-field rules, pair rules, name and soul identity rules).
2. Dev set: reviewed by the author in full; approved without changes.
3. Locked set: an independent review pass card by card found about 50 issues (fact and tick errors, ambiguous wording, two groups mixing two casts, an impossible queue move, one S card requiring an optional item). All were fixed before the blind check.
4. Option order on decision cards was rotated deterministically (`tools/cards_locked.py`) so acceptable options are spread evenly over positions.
5. Blind check, one round, 12 locked decision cards. The author key was hashed (`b27173b94e54dbe69ad1500a5f17ec14209d8f2c72e260f98c743836b96472dd`) before the reviewer saw the sheet. Result and decision: `blind/round1_followup.md`. Two cards the reviewer found ambiguous were reworded (D-reconcile_or_revenge-012, D-remarriage-010); their answer keys did not change.
6. Locked set: reviewed by the author in full after the blind check; approved without changes.

## Random-pick baseline

Mean of |acceptable| / |options| over scored decision cards: 51.8% (locked), 55.6% (dev). Expected severe picks at random: 11.2 of 60 (locked). Reports state these next to D results.

## Voided cards

| Date | Card | Reason |
|---|---|---|
| none | | |
