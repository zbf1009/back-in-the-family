#!/usr/bin/env python3
"""Select the blind-check cards and write the reviewer sheet and the author key.

Run from anywhere, after tools/build_cards.py:
    python3 tools/make_blind.py

Selection is deterministic: per decision family, the first two scored locked cards that are not part of a
contrast pair and come from different scenario groups (falling back to pair cards if a family has too few).
The sheet shows only what the model would see; the author key holds the grades from cards/locked.jsonl.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from cardlib import DECISION_FAMILIES  # noqa: E402

PER_FAMILY = 2


def select(cards):
    chosen = []
    for family in DECISION_FAMILIES:
        pool = [c for c in cards if c["family"] == family and c["task"] == "decision" and c["scored"]]
        ordered = [c for c in pool if "contrast" not in c] + [c for c in pool if "contrast" in c]
        picked, groups = [], set()
        for c in ordered:
            if c["scenario_group"] in groups:
                continue
            picked.append(c)
            groups.add(c["scenario_group"])
            if len(picked) == PER_FAMILY:
                break
        if len(picked) < PER_FAMILY:
            raise SystemExit(f"{family}: not enough cards from distinct groups")
        chosen += picked
    return chosen


def fmt_traits(t):
    nonzero = [f"{k} {v:+d}" for k, v in t.items() if v]
    return ", ".join(nonzero) if nonzero else "all 0"


def render(card, n):
    ctx = card["context"]
    names = {p["id"]: p["name"] for p in ctx["people"]}
    out = [f"## B{n:02d} · {card['id']}", "", f"Decision maker: {names[ctx['subject']]} (id {ctx['subject']})", "",
           f"> {ctx['situation']}", ""]
    out += ["| id | name | age | sex | alive | origin | wealth | traits |", "|---|---|---|---|---|---|---|---|"]
    for p in ctx["people"]:
        out.append(f"| {p['id']} | {p['name']} | {p['age']} | {p['sex']} | {p['alive']} | {p['origin']} | {p['wealth']} | {fmt_traits(p['traits'])} |")
    out.append("")
    if ctx["relations"]:
        out += ["| from | to | affinity | trust | tags |", "|---|---|---|---|---|"]
        for r in ctx["relations"]:
            out.append(f"| {names[r['from']]} | {names[r['to']]} | {r['affinity']} | {r['trust']} | {', '.join(r['tags'])} |")
        out.append("")
    if ctx["events"]:
        out += ["| id | tick | type | actors | magnitude | due | tags |", "|---|---|---|---|---|---|---|"]
        for e in ctx["events"]:
            actors = ", ".join(names[a] for a in e["actors"])
            out.append(f"| {e['id']} | {e['tick']} | {e['type']} | {actors} | {e['magnitude']} | {e.get('due_tick', '')} | {', '.join(e['tags'])} |")
        out.append("")
    if ctx["player_input"]:
        out += [f"Player's dream ({ctx['player_input']['intent']}): {ctx['player_input']['content']}", ""]
    out += [f"Current tick: {ctx['tick']}", "", "| option | label | your grade |", "|---|---|---|"]
    for o in card["options"]:
        out.append(f"| `{o['id']}` | {o['label']} | |")
    out.append("")
    return out


def main():
    cards = [json.loads(l) for l in (ROOT / "cards" / "locked.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    chosen = select(cards)
    blind = ROOT / "blind"
    blind.mkdir(exist_ok=True)

    sheet = [
        "# Blind check: reviewer sheet",
        "",
        "Grade every option of every card from the card alone, before seeing any answer key:",
        "",
        "- **A**: a reasonable choice for this person in this situation.",
        "- **N**: out of character, but not absurd.",
        "- **S**: absurd or offensive on screen given these facts.",
        "",
        "Each card needs at least one A. One tick is one day. Traits run from -3 to +3; 0 is ordinary.",
        "",
    ]
    for n, card in enumerate(chosen, 1):
        sheet += render(card, n)
    (blind / "sheet.md").write_text("\n".join(sheet), encoding="utf-8")

    key = []
    for n, card in enumerate(chosen, 1):
        grades = {}
        for o in card["options"]:
            grades[o["id"]] = "A" if o["id"] in card["acceptable"] else ("S" if o["id"] in card["severe"] else "N")
        key.append({"blind_id": f"B{n:02d}", "card_id": card["id"], "grades": grades})
    raw = (json.dumps(key, ensure_ascii=False, indent=1) + "\n").encode("utf-8")
    (blind / "author_key.json").write_bytes(raw)

    print("selected:", ", ".join(c["id"] for c in chosen))
    print("author_key.json sha256", hashlib.sha256(raw).hexdigest())
    print("locked.jsonl   sha256", hashlib.sha256((ROOT / "cards" / "locked.jsonl").read_bytes()).hexdigest())
    return 0


if __name__ == "__main__":
    sys.exit(main())
