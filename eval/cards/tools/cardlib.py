"""Helpers for authoring evaluation cards.

Card data lives only in cards_dev.py and cards_locked.py. build_cards.py renders it to
cards/*.jsonl and review/*.md, so the machine file and the review file always agree.
"""

from __future__ import annotations

import copy
import re

TRAITS = ("greed", "loyalty", "pride", "warmth", "temper", "vindictiveness", "piety")

DECISION_FAMILIES = (
    "dream_interpretation",
    "will_execution",
    "reconcile_or_revenge",
    "debt_repayment",
    "remarriage",
    "magistrate_ruling",
)
SYNTHESIS_FAMILIES = ("grudge_detection", "debt_chain", "broken_promise", "relationship_shift")
SANITY_FAMILY = "sanity"

# Fields each output schema exposes to gold patterns, and which of them hold person IDs.
SCHEMA_FIELDS = {
    "grudge_v1": {"from", "to", "level"},
    "debt_chain_v1": {"debtor", "creditor", "amount", "status", "origin_event", "transferred_from"},
    "broken_promise_v1": {"promisor", "promisee", "promise_event", "status"},
    "relationship_shift_v1": {"a", "b", "direction", "turning_point"},
}
PERSON_FIELDS = {"from", "to", "debtor", "creditor", "transferred_from", "promisor", "promisee", "a", "b"}
EVENT_FIELDS = {"origin_event", "promise_event", "turning_point"}

# Severe conditions the runner detects mechanically. All others need explicit severe_patterns.
GENERIC_SEVERE = {"invented_event_id", "invented_person", "self_reference"}


def person(id, name, age, sex, *, alive=True, origin="native", wealth=0, **traits):  # noqa: A002
    unknown = set(traits) - set(TRAITS)
    if unknown:
        raise ValueError(f"unknown traits {sorted(unknown)} for {name}")
    return {
        "id": id,
        "name": name,
        "age": age,
        "sex": sex,
        "alive": alive,
        "origin": origin,
        "traits": {t: traits.get(t, 0) for t in TRAITS},
        "wealth": wealth,
        "soul_id": None,  # assigned per scenario group in _finish()
    }


def rel(frm, to, affinity, trust, tags=()):
    return {"from": frm, "to": to, "affinity": affinity, "trust": trust, "tags": list(tags)}


def ev(eid, tick, type_, actors, magnitude=0, caused_by=(), tags=(), due=None):
    e = {
        "id": eid,
        "tick": tick,
        "type": type_,
        "actors": list(actors),
        "magnitude": magnitude,
        "caused_by": list(caused_by),
        "tags": list(tags),
    }
    if due is not None:
        e["due_tick"] = due
    return e


def pair(pair_id, changed_fact, expected_a, expected_b):
    """Return the contrast blocks for card a and card b of one pair."""
    expected = {"a": expected_a, "b": expected_b}
    return (
        {"pair_id": pair_id, "role": "a", "changed_fact": changed_fact, "expected": expected},
        {"pair_id": pair_id, "role": "b", "changed_fact": changed_fact, "expected": copy.deepcopy(expected)},
    )


def _group_num(group):
    m = re.fullmatch(r"G(\d{3})", group)
    if not m:
        raise ValueError(f"bad scenario_group {group}")
    n = int(m.group(1))
    if n > 99:
        raise ValueError("soul_id scheme supports groups G001..G099")
    return n


def _finish(card, people):
    gnum = _group_num(card["scenario_group"])
    for p in people:
        if p["soul_id"] is None:
            p["soul_id"] = f"S-{gnum:02d}{p['id']:02d}"
    return card


def _context(tick, subject, people, relations, events, situation, player_input):
    return {
        "tick": tick,
        "subject": subject,
        "people": copy.deepcopy(people),
        "relations": copy.deepcopy(relations),
        "events": copy.deepcopy(events),
        "situation": situation,
        "player_input": copy.deepcopy(player_input),
    }


def decision(n, family, group, split, *, tick, subject, people, relations, events, situation,
             options, acceptable, severe, note, player_input=None, contrast=None, scored=True):
    card = {
        "id": f"D-{family}-{n:03d}",
        "task": "decision",
        "family": family,
        "scenario_group": group,
        "split": split,
        "scored": scored,
        "context": _context(tick, subject, people, relations, events, situation, player_input),
    }
    if contrast is not None:
        card["contrast"] = copy.deepcopy(contrast)
    card["author_note"] = note
    card["options"] = [{"id": oid, "label": label} for oid, label in options]
    card["acceptable"] = list(acceptable)
    card["severe"] = list(severe)
    return _finish(card, card["context"]["people"])


def synthesis(n, family, group, split, *, tick, people, relations, events, situation, schema,
              must, must_not, severe_conditions, note, severe_patterns=(), subject=None,
              contrast=None, scored=True):
    card = {
        "id": f"S-{family}-{n:03d}",
        "task": "synthesis",
        "family": family,
        "scenario_group": group,
        "split": split,
        "scored": scored,
        "context": _context(tick, subject, people, relations, events, situation, None),
    }
    if contrast is not None:
        card["contrast"] = copy.deepcopy(contrast)
    card["author_note"] = note
    card["output_schema"] = schema
    card["gold"] = {"must_include": copy.deepcopy(list(must)), "must_not_include": copy.deepcopy(list(must_not))}
    card["severe_conditions"] = list(severe_conditions)
    if severe_patterns:
        card["severe_patterns"] = [{"condition": c, "pattern": copy.deepcopy(p)} for c, p in severe_patterns]
    return _finish(card, card["context"]["people"])


def deep_diff(a, b, path=""):
    """List the paths where two JSON values differ. Used to show reviewers what a pair changes."""
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            p = f"{path}.{k}" if path else k
            if k not in a:
                out.append(f"{p}: <absent> -> {b[k]!r}")
            elif k not in b:
                out.append(f"{p}: {a[k]!r} -> <absent>")
            else:
                out.extend(deep_diff(a[k], b[k], p))
    elif isinstance(a, list) and isinstance(b, list) and _id_keyed(a) and _id_keyed(b):
        ia = {x["id"]: x for x in a}
        ib = {x["id"]: x for x in b}
        for k in [x["id"] for x in a] + [x["id"] for x in b if x["id"] not in ia]:
            p = f"{path}[id={k}]"
            if k not in ia:
                out.append(f"{p}: <absent> -> {ib[k]!r}")
            elif k not in ib:
                out.append(f"{p}: {ia[k]!r} -> <absent>")
            else:
                out.extend(deep_diff(ia[k], ib[k], p))
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            out.extend(deep_diff(x, y, f"{path}[{i}]"))
    elif a != b:
        out.append(f"{path}: {a!r} -> {b!r}")
    return out


def _id_keyed(items):
    return bool(items) and all(isinstance(x, dict) and "id" in x for x in items) and len({x["id"] for x in items}) == len(items)


def pair_diff(card_a, card_b):
    """Differences between the two cards of a pair, excluding fields that are expected to differ."""
    skip = {"id", "contrast", "author_note", "acceptable", "severe", "gold", "severe_patterns", "severe_conditions"}
    a = {k: v for k, v in card_a.items() if k not in skip}
    b = {k: v for k, v in card_b.items() if k not in skip}
    return deep_diff(a, b)
