#!/usr/bin/env python3
"""Render card data (tools/cards_dev.py, tools/cards_locked.py) to cards/*.jsonl and review/*.md.

Run from anywhere:
    python3 tools/build_cards.py

Card data is defined only in the two data modules, so the machine files and the review
sheets are always rendered from the same source.
"""

from __future__ import annotations

import collections
import importlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from cardlib import pair_diff  # noqa: E402

SPLITS = ("dev", "locked")


def load_split(split):
    try:
        module = importlib.import_module(f"cards_{split}")
    except ModuleNotFoundError as e:
        if e.name == f"cards_{split}":
            return []
        raise
    return list(module.CARDS)


def dump_jsonl(cards):
    return "".join(json.dumps(c, ensure_ascii=False, separators=(",", ":")) + "\n" for c in cards)


def fmt_pattern(p):
    return ", ".join(f"{k}={json.dumps(v)}" for k, v in p.items())


def fmt_traits(t):
    nonzero = [f"{k} {v:+d}" for k, v in t.items() if v]
    return ", ".join(nonzero) if nonzero else "all 0"


def render_card(card, partner=None):
    ctx = card["context"]
    names = {p["id"]: p["name"] for p in ctx["people"]}
    out = [f"### {card['id']}", ""]
    meta = f"group `{card['scenario_group']}` · split `{card['split']}` · scored `{card['scored']}` · tick {ctx['tick']}"
    if ctx["subject"] is not None:
        meta += f" · subject {ctx['subject']} ({names.get(ctx['subject'], '?')})"
    out += [meta, "", f"> {ctx['situation']}", ""]

    out += ["| id | name | age | sex | alive | origin | wealth | traits |", "|---|---|---|---|---|---|---|---|"]
    for p in ctx["people"]:
        out.append(f"| {p['id']} | {p['name']} | {p['age']} | {p['sex']} | {p['alive']} | {p['origin']} | {p['wealth']} | {fmt_traits(p['traits'])} |")
    out.append("")

    if ctx["relations"]:
        out += ["| from | to | affinity | trust | tags |", "|---|---|---|---|---|"]
        for r in ctx["relations"]:
            out.append(f"| {names.get(r['from'], r['from'])} | {names.get(r['to'], r['to'])} | {r['affinity']} | {r['trust']} | {', '.join(r['tags'])} |")
        out.append("")

    if ctx["events"]:
        out += ["| id | tick | type | actors | magnitude | due | caused_by | tags |", "|---|---|---|---|---|---|---|---|"]
        for e in ctx["events"]:
            actors = ", ".join(f"{a} {names.get(a, '?')}" for a in e["actors"])
            out.append(
                f"| {e['id']} | {e['tick']} | {e['type']} | {actors} | {e['magnitude']} | {e.get('due_tick', '')} "
                f"| {', '.join(e['caused_by'])} | {', '.join(e['tags'])} |"
            )
        out.append("")

    if ctx["player_input"]:
        out += [f"**Player input** ({ctx['player_input']['intent']}): {ctx['player_input']['content']}", ""]

    if card["task"] == "decision":
        out += ["| option | label | grade |", "|---|---|---|"]
        for o in card["options"]:
            grade = "acceptable" if o["id"] in card["acceptable"] else ("**severe**" if o["id"] in card["severe"] else "-")
            out.append(f"| `{o['id']}` | {o['label']} | {grade} |")
        out.append("")
    else:
        out += [f"**Output schema:** `{card['output_schema']}`", ""]
        out += ["Must include:"] + ([f"- {fmt_pattern(p)}" for p in card["gold"]["must_include"]] or ["- (none)"])
        out += ["", "Must not include:"] + ([f"- {fmt_pattern(p)}" for p in card["gold"]["must_not_include"]] or ["- (none)"])
        out += ["", f"Severe conditions: {', '.join(card['severe_conditions'])}"]
        for sp in card.get("severe_patterns", []):
            out.append(f"- {sp['condition']}: {fmt_pattern(sp['pattern'])}")
        out.append("")

    if "contrast" in card:
        c = card["contrast"]
        out += [f"**Contrast** `{c['pair_id']}` role `{c['role']}`: {c['changed_fact']}"]
        for role in ("a", "b"):
            side = c["expected"][role]
            if isinstance(side, list):
                out.append(f"- expected {role}: {', '.join(side)}")
            else:
                inc = "; ".join(fmt_pattern(p) for p in side["include"]) or "-"
                exc = "; ".join(fmt_pattern(p) for p in side["exclude"]) or "-"
                out.append(f"- expected {role}: include [{inc}] exclude [{exc}]")
        if partner is not None and c["role"] == "b":
            out += ["- structural differences from card a:"] + [f"  - `{d}`" for d in pair_diff(partner, card)]
        out.append("")

    out += [f"*Author note:* {card['author_note']}", ""]
    return out


def render_review(split, cards):
    lines = [f"# Review sheet: {split}", "", "Rendered from tools/cards_{split}.py by tools/build_cards.py. Do not edit by hand.".format(split=split), ""]
    counts = collections.Counter((c["task"], c["family"]) for c in cards)
    lines += ["| task | family | cards |", "|---|---|---|"]
    for (task, family), n in sorted(counts.items()):
        lines.append(f"| {task} | {family} | {n} |")
    lines.append("")
    pair_a = {c["contrast"]["pair_id"]: c for c in cards if c.get("contrast", {}).get("role") == "a"}
    current = None
    for card in cards:
        if card["family"] != current:
            current = card["family"]
            lines += [f"## {current}", ""]
        partner = pair_a.get(card.get("contrast", {}).get("pair_id"))
        lines += render_card(card, partner)
    return "\n".join(lines)


def main():
    (ROOT / "cards").mkdir(exist_ok=True)
    (ROOT / "review").mkdir(exist_ok=True)
    for split in SPLITS:
        cards = load_split(split)
        if not cards:
            print(f"{split}: no card data yet")
            continue
        (ROOT / "cards" / f"{split}.jsonl").write_text(dump_jsonl(cards), encoding="utf-8")
        (ROOT / "review" / f"{split}.md").write_text(render_review(split, cards), encoding="utf-8")
        print(f"{split}: wrote {len(cards)} cards")
    return 0


if __name__ == "__main__":
    sys.exit(main())
