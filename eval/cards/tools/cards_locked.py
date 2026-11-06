"""Locked cards. Read only by the runner, run once after locking.

The card data is split across five modules by family; this file only concatenates them in family order.
Scenario groups G023..G086. Contrast pairs P011..P035.
"""

import cards_locked_da
import cards_locked_db
import cards_locked_dc
import cards_locked_sa
import cards_locked_sb

_RAW = (
    cards_locked_da.CARDS
    + cards_locked_db.CARDS
    + cards_locked_dc.CARDS
    + cards_locked_sa.CARDS
    + cards_locked_sb.CARDS
)


def _rebalance(cards):
    """Rotate each decision card's option list so acceptable options are not clustered at the top.

    Writers tend to list the in-character option first. A model with a first-position bias would then score
    well for the wrong reason. Rotation is deterministic and greedy: units (a contrast pair, or a single card)
    are processed in card order, and each takes the rotation that keeps the per-position count of acceptable
    options closest to its expected share. Both cards of a pair get the same rotation, so they keep identical
    option order. Option IDs, labels and grades are unchanged.
    """
    units, seen = [], {}
    for c in cards:
        if c["task"] != "decision" or not c["scored"]:
            continue
        key = c.get("contrast", {}).get("pair_id") or c["id"]
        if key not in seen:
            seen[key] = []
            units.append(seen[key])
        seen[key].append(c)
    observed, expected = {}, {}
    for unit in units:
        n = len(unit[0]["options"])
        best = None
        for k in range(n):
            cost = 0.0
            for c in unit:
                ids = [o["id"] for o in c["options"]]
                rotated = ids[k:] + ids[:k]
                for pos, oid in enumerate(rotated):
                    hit = 1 if oid in c["acceptable"] else 0
                    share = len(c["acceptable"]) / n
                    o = observed.get((n, pos), 0) + hit
                    e = expected.get((n, pos), 0) + share
                    cost += (o - e) ** 2
            if best is None or cost < best[0]:
                best = (cost, k)
        k = best[1]
        for c in unit:
            c["options"] = c["options"][k:] + c["options"][:k]
            for pos, o in enumerate(c["options"]):
                observed[(n, pos)] = observed.get((n, pos), 0) + (1 if o["id"] in c["acceptable"] else 0)
                expected[(n, pos)] = expected.get((n, pos), 0) + len(c["acceptable"]) / n
    return cards


CARDS = _rebalance(_RAW)
