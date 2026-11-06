#!/usr/bin/env python3
"""Validate cards/dev.jsonl and cards/locked.jsonl.

Run from the staging root:
    uv run --no-project --with jsonschema==4.25.1 python tools/validate.py

Checks the JSON Schema plus the cross-field rules listed in README.md ("Validation rules").
Exits non-zero when any rule fails.
"""

from __future__ import annotations

import collections
import json
import pathlib
import sys

from jsonschema import Draft202012Validator

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from cardlib import (  # noqa: E402
    DECISION_FAMILIES,
    EVENT_FIELDS,
    GENERIC_SEVERE,
    PERSON_FIELDS,
    SANITY_FAMILY,
    SCHEMA_FIELDS,
    SYNTHESIS_FAMILIES,
    pair_diff,
)

FAMILY_SCHEMA = {
    "grudge_detection": "grudge_v1",
    "debt_chain": "debt_chain_v1",
    "broken_promise": "broken_promise_v1",
    "relationship_shift": "relationship_shift_v1",
}
# A dead person may still appear in these event types after their death.
POSTHUMOUS_EVENT_TYPES = {"death", "offering", "dream", "haunting", "appeal", "debt_transfer", "debt_forgiven", "inheritance"}
DUE_EVENT_TYPES = {"loan", "promise"}
MAX_SITUATION_WORDS = 80
MAX_TOWNSFOLK_AGE = 120
BANNED_PHRASES = ("hell money",)


def load_jsonl(path):
    cards = []
    if not path.exists():
        return cards
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if line.strip():
            cards.append((path.name, n, json.loads(line)))
    return cards


def output_enums():
    enums = {}
    for name in SCHEMA_FIELDS:
        doc = json.loads((ROOT / "schemas" / f"{name}.json").read_text(encoding="utf-8"))
        props = doc["properties"]["items"]["items"]["properties"]
        enums[name] = {k: set(v["enum"]) for k, v in props.items() if "enum" in v}
    return enums


def walk_floats(value, path="$"):
    if isinstance(value, float):
        yield path
    elif isinstance(value, dict):
        for k, v in value.items():
            yield from walk_floats(v, f"{path}.{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            yield from walk_floats(v, f"{path}[{i}]")


def walk_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from walk_strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from walk_strings(v)


def as_list(v):
    return v if isinstance(v, list) else [v]


def check_pattern(err, where, pattern, schema, people, events, enums):
    allowed = SCHEMA_FIELDS[schema] | {"evidence_any"}
    for field, value in pattern.items():
        if field not in allowed:
            err(f"{where}: field {field!r} is not in {schema}")
            continue
        values = as_list(value)
        if field == "evidence_any":
            for v in values:
                if v not in events:
                    err(f"{where}: evidence_any references missing event {v!r}")
        elif field in PERSON_FIELDS:
            for v in values:
                if v is not None and v not in people:
                    err(f"{where}: {field} references missing person {v!r}")
        elif field in EVENT_FIELDS:
            for v in values:
                if v is not None and v not in events:
                    err(f"{where}: {field} references missing event {v!r}")
        elif field in enums.get(schema, {}):
            for v in values:
                if v not in enums[schema][field]:
                    err(f"{where}: {field}={v!r} is not in the {schema} enum")
        elif field == "amount":
            for v in values:
                if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                    err(f"{where}: amount must be a non-negative integer")


def check_card(card, err, enums):
    cid = card["id"]
    family = card["family"]
    ctx = card["context"]

    expected_prefix = "D" if card["task"] == "decision" else "S"
    if not cid.startswith(f"{expected_prefix}-{family}-"):
        err(f"{cid}: id does not match task/family")
    if family in DECISION_FAMILIES and card["task"] != "decision":
        err(f"{cid}: family {family} must be a decision card")
    if family in SYNTHESIS_FAMILIES and card["task"] != "synthesis":
        err(f"{cid}: family {family} must be a synthesis card")
    if (family == SANITY_FAMILY) == card["scored"]:
        err(f"{cid}: sanity cards must be unscored and all other cards scored")

    for p in walk_floats(card):
        err(f"{cid}: non-integer number at {p}")
    text = " ".join(walk_strings(card)).lower()
    for phrase in BANNED_PHRASES:
        if phrase in text:
            err(f"{cid}: banned phrase {phrase!r}")

    words = len(ctx["situation"].split())
    if words > MAX_SITUATION_WORDS:
        err(f"{cid}: situation has {words} words (max {MAX_SITUATION_WORDS})")

    people = {}
    for p in ctx["people"]:
        if p["id"] in people:
            err(f"{cid}: duplicate person id {p['id']}")
        people[p["id"]] = p
        if p["origin"] != "official" and p["age"] > MAX_TOWNSFOLK_AGE:
            err(f"{cid}: {p['name']} is older than {MAX_TOWNSFOLK_AGE}")
    souls = collections.Counter(p["soul_id"] for p in ctx["people"])
    for soul, n in souls.items():
        if n > 1:
            err(f"{cid}: soul {soul} is in {n} bodies")

    subject = ctx["subject"]
    if card["task"] == "decision":
        if subject not in people:
            err(f"{cid}: decision subject {subject!r} is not in people")
        elif not people[subject]["alive"] and people[subject]["origin"] != "official":
            err(f"{cid}: decision subject is dead")
    elif subject is not None and subject not in people:
        err(f"{cid}: subject {subject!r} is not in people")

    for r in ctx["relations"]:
        for end in ("from", "to"):
            if r[end] not in people:
                err(f"{cid}: relation {end} {r[end]} is not in people")
        if r["from"] == r["to"]:
            err(f"{cid}: relation from a person to themself")

    events = {}
    last_tick = -1
    death_tick = {}
    for e in ctx["events"]:
        if e["id"] in events:
            err(f"{cid}: duplicate event id {e['id']}")
        if e["tick"] < last_tick:
            err(f"{cid}: event {e['id']} is out of tick order")
        last_tick = max(last_tick, e["tick"])
        for c in e["caused_by"]:
            if c not in events:
                err(f"{cid}: {e['id']} caused_by {c} which is missing or later in the log")
        for a in e["actors"]:
            if a not in people:
                err(f"{cid}: {e['id']} actor {a} is not in people")
            elif a in death_tick and e["tick"] > death_tick[a] and e["type"] not in POSTHUMOUS_EVENT_TYPES:
                err(f"{cid}: {e['id']} has dead person {a} acting after death")
        if "due_tick" in e:
            if e["type"] not in DUE_EVENT_TYPES:
                err(f"{cid}: {e['id']} has due_tick on a {e['type']} event")
            elif e["due_tick"] < e["tick"]:
                err(f"{cid}: {e['id']} is due before it happens")
        if e["type"] == "death":
            for a in e["actors"]:
                death_tick[a] = e["tick"]
        events[e["id"]] = e
    if ctx["tick"] < last_tick:
        err(f"{cid}: context tick {ctx['tick']} is before the last event")
    for pid in death_tick:
        if people.get(pid, {}).get("alive", False):
            err(f"{cid}: person {pid} has a death event but alive is true")

    if family == "dream_interpretation":
        if ctx["player_input"] is None:
            err(f"{cid}: dream_interpretation needs player_input")
    elif ctx["player_input"] is not None:
        err(f"{cid}: player_input is only for dream_interpretation")

    if card["task"] == "decision":
        option_ids = [o["id"] for o in card["options"]]
        if len(set(option_ids)) != len(option_ids):
            err(f"{cid}: duplicate option ids")
        for name in ("acceptable", "severe"):
            for o in card[name]:
                if o not in option_ids:
                    err(f"{cid}: {name} has unknown option {o!r}")
        if set(card["acceptable"]) & set(card["severe"]):
            err(f"{cid}: acceptable and severe overlap")
        if card["scored"] and set(card["acceptable"]) == set(option_ids):
            err(f"{cid}: every option is acceptable, so the card cannot score")
    else:
        schema = card["output_schema"]
        if ctx["relations"]:
            err(f"{cid}: synthesis cards carry no relations; state kinship in situation")
        if family in FAMILY_SCHEMA and FAMILY_SCHEMA[family] != schema:
            err(f"{cid}: {family} must use {FAMILY_SCHEMA[family]}")
        for kind in ("must_include", "must_not_include"):
            for i, pat in enumerate(card["gold"][kind]):
                check_pattern(err, f"{cid} gold.{kind}[{i}]", pat, schema, people, events, enums)
        if not card["gold"]["must_include"] and not card["gold"]["must_not_include"]:
            err(f"{cid}: gold is empty")
        conds = set(card["severe_conditions"])
        pattern_conds = set()
        for i, sp in enumerate(card.get("severe_patterns", [])):
            pattern_conds.add(sp["condition"])
            if sp["condition"] not in conds:
                err(f"{cid}: severe_patterns[{i}] condition is not listed in severe_conditions")
            check_pattern(err, f"{cid} severe_patterns[{i}]", sp["pattern"], schema, people, events, enums)
        for c in conds - GENERIC_SEVERE - pattern_conds:
            err(f"{cid}: severe condition {c!r} needs at least one severe_pattern")
        ticks = collections.Counter(e["tick"] for e in ctx["events"])
        if not any(n >= 2 for n in ticks.values()):
            err(f"{cid}: needs at least one tick with two or more events (shuffle test)")


def check_pairs(cards, err, enums):
    by_pair = collections.defaultdict(list)
    for c in cards:
        if "contrast" in c:
            by_pair[c["contrast"]["pair_id"]].append(c)
    diffs = {}
    for pid, members in sorted(by_pair.items()):
        roles = sorted(m["contrast"]["role"] for m in members)
        if roles != ["a", "b"]:
            err(f"{pid}: needs exactly one a card and one b card, found {roles}")
            continue
        a = next(m for m in members if m["contrast"]["role"] == "a")
        b = next(m for m in members if m["contrast"]["role"] == "b")
        if a["contrast"]["expected"] != b["contrast"]["expected"] or a["contrast"]["changed_fact"] != b["contrast"]["changed_fact"]:
            err(f"{pid}: a and b disagree on expected or changed_fact")
        for k in ("task", "family", "scenario_group", "split"):
            if a[k] != b[k]:
                err(f"{pid}: a and b differ in {k}")
        exp = a["contrast"]["expected"]
        if a["task"] == "decision":
            if [o["id"] for o in a["options"]] != [o["id"] for o in b["options"]]:
                err(f"{pid}: a and b must offer the same options")
            for role, card in (("a", a), ("b", b)):
                if not isinstance(exp[role], list):
                    err(f"{pid}: decision expected.{role} must be a list of option ids")
                    continue
                if not set(exp[role]) <= set(card["acceptable"]):
                    err(f"{pid}: expected.{role} is not inside {card['id']} acceptable")
            if isinstance(exp["a"], list) and isinstance(exp["b"], list) and set(exp["a"]) & set(exp["b"]):
                err(f"{pid}: expected.a and expected.b overlap, so direction cannot be read")
        else:
            for role, card in (("a", a), ("b", b)):
                side = exp[role]
                if not isinstance(side, dict):
                    err(f"{pid}: synthesis expected.{role} must have include/exclude")
                    continue
                people = {p["id"] for p in card["context"]["people"]}
                events = {e["id"] for e in card["context"]["events"]}
                for kind in ("include", "exclude"):
                    for i, pat in enumerate(side[kind]):
                        check_pattern(err, f"{pid} expected.{role}.{kind}[{i}]", pat, card["output_schema"], people, events, enums)
        diffs[pid] = pair_diff(a, b)
    return diffs


def module_rows(name):
    """Rows for an in-memory locked-card module, labelled as locked.jsonl. Used while cards are being written."""
    import importlib

    module = importlib.import_module(name)
    return [("locked.jsonl", f"{name}#{i}", card) for i, card in enumerate(module.CARDS, 1)]


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    validator = Draft202012Validator(json.loads((ROOT / "schemas" / "card.schema.json").read_text(encoding="utf-8")))
    enums = output_enums()
    errors = []
    rows = load_jsonl(ROOT / "cards" / "dev.jsonl")
    if argv[:1] == ["--module"] and len(argv) == 2:
        # Validate one module of tools/cards_locked_*.py against the built dev set, without writing files.
        rows += module_rows(argv[1])
    elif argv:
        print("usage: validate.py [--module cards_locked_<part>]")
        return 2
    else:
        rows += load_jsonl(ROOT / "cards" / "locked.jsonl")
    if not rows:
        print("no cards found")
        return 1

    cards = []
    for fname, line, card in rows:
        schema_errors = sorted(validator.iter_errors(card), key=lambda e: list(e.path))
        for e in schema_errors:
            errors.append(f"{fname}:{line} {card.get('id', '?')}: schema: {'/'.join(map(str, e.path))}: {e.message}")
        if schema_errors:
            continue
        expected_split = fname.removesuffix(".jsonl")
        if card["split"] != expected_split:
            errors.append(f"{card['id']}: split {card['split']} is stored in {fname}")
        cards.append(card)
        check_card(card, errors.append, enums)

    ids = collections.Counter(c["id"] for c in cards)
    for cid, n in ids.items():
        if n > 1:
            errors.append(f"{cid}: id used {n} times")

    group_splits = collections.defaultdict(set)
    group_names = collections.defaultdict(set)
    group_souls = collections.defaultdict(dict)
    for c in cards:
        g = c["scenario_group"]
        group_splits[g].add(c["split"])
        group_names[g].update(p["name"] for p in c["context"]["people"])
        for p in c["context"]["people"]:
            prev = group_souls[g].setdefault(p["soul_id"], p["name"])
            if prev != p["name"]:
                errors.append(f"{c['id']}: soul {p['soul_id']} is {p['name']} here but {prev} elsewhere in {g}")
    for g, splits in sorted(group_splits.items()):
        if len(splits) > 1:
            errors.append(f"{g}: scenario group spans splits {sorted(splits)}")
    name_groups = collections.defaultdict(set)
    first_groups = collections.defaultdict(set)
    for g, names in group_names.items():
        for n in names:
            name_groups[n].add(g)
            if not n.startswith("Magistrate "):
                first_groups[n.split()[0]].add(g)
    for n, groups in sorted(name_groups.items()):
        if len(groups) > 1:
            errors.append(f"name {n!r} is reused across scenario groups {sorted(groups)}")
    for n, groups in sorted(first_groups.items()):
        if len(groups) > 1:
            errors.append(f"first name {n!r} is reused across scenario groups {sorted(groups)}")

    check_pairs(cards, errors.append, enums)

    summary = collections.Counter()
    groups = collections.defaultdict(set)
    pairs = collections.defaultdict(set)
    for c in cards:
        key = (c["split"], c["task"], c["family"], c["scored"])
        summary[key] += 1
        groups[key].add(c["scenario_group"])
        if "contrast" in c:
            pairs[key].add(c["contrast"]["pair_id"])
    print(f"{'split':7} {'task':10} {'family':22} {'scored':6} {'cards':>5} {'groups':>6} {'pairs':>5}")
    for key in sorted(summary):
        split, task, family, scored = key
        print(f"{split:7} {task:10} {family:22} {str(scored):6} {summary[key]:5} {len(groups[key]):6} {len(pairs[key]):5}")

    if errors:
        print(f"\n{len(errors)} error(s):")
        for e in errors:
            print(f"  - {e}")
        return 1
    print(f"\nOK: {len(cards)} cards valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
