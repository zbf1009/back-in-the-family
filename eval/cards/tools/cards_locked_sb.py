"""Locked cards, writer sb.

Ten broken_promise cards (G071-G076, pairs P032-P033), ten relationship_shift cards
(G077-G082, pairs P034-P035) and four unscored synthesis sanity cards (G085-G086).
Card, group and pair numbers follow /tmp/bitf-locked/allocation.md.
"""

from cardlib import decision, ev, pair, person, rel, synthesis

L = "locked"
CARDS = []
add = CARDS.append

# ---------------------------------------------------------------- broken_promise

_PROMISE_SEVERE = ["invented_event_id", "invented_person", "self_reference", "reversed_direction",
                   "contradicts_fact"]
_PROMISE_BASIC = ["invented_event_id", "invented_person", "self_reference"]

# G071: a grandmother's fee promise. Variable: where the fee day falls relative to the log end.
_g071_people = [
    person(1, "Bernice Mallory", 68, "female", wealth=2100, warmth=1, loyalty=1),
    person(2, "Truman Mallory", 41, "male", wealth=3400, loyalty=2),
    person(3, "Gertie Mallory", 19, "female", wealth=300, warmth=1),
    person(4, "Rowan Pickett", 44, "male", wealth=2600, pride=1),
]
_g071_situation = (
    "Bernice Mallory promised her granddaughter Gertie $800 toward the term's fees, to be paid before the term starts. "
    "Gertie promised their neighbor Rowan Pickett she would feed his hens through the county fair. "
    "Truman is Gertie's father. The fair came and went this spring; the school fixes its fee day once a year."
)
_g071_base = [
    ev("e1", 4800, "promise", [1, 3], magnitude=800, tags=["verbal", "witnessed"], due=4960),
    ev("e2", 4870, "promise", [3, 4], magnitude=60, tags=["verbal"], due=4900),
    ev("e3", 4900, "promise_kept", [3, 4], magnitude=60, caused_by=["e2"]),
    ev("e4", 4900, "quarrel", [4, 2], magnitude=50, tags=["public"]),
    ev("e5", 4950, "help", [2, 1], magnitude=45),
]
_g071_b = [ev("e1", 4800, "promise", [1, 3], magnitude=800, tags=["verbal", "witnessed"], due=5120)] + _g071_base[1:]
_ca, _cb = pair(
    "P032", "The $800 fee day is day 4960 in card a and day 5120 in card b; the log ends on day 5040",
    {"include": [{"promise_event": "e1", "status": "broken"}],
     "exclude": [{"promise_event": "e1", "status": "pending"}]},
    {"include": [{"promise_event": "e1", "status": "pending"}],
     "exclude": [{"promise_event": "e1", "status": "broken"}]},
)
add(synthesis(4, "broken_promise", "G071", L, tick=5040, people=_g071_people, relations=[],
              events=_g071_base, situation=_g071_situation, schema="broken_promise_v1",
              must=[{"promisor": 1, "promisee": 3, "promise_event": "e1", "status": "broken",
                     "evidence_any": ["e1"]}],
              must_not=[{"promise_event": "e1", "status": ["pending", "kept"]},
                        {"promise_event": "e2", "status": ["broken", "pending"]}],
              severe_conditions=_PROMISE_SEVERE,
              severe_patterns=[("reversed_direction", {"promise_event": "e1", "promisor": 3}),
                               ("contradicts_fact", {"promise_event": "e1", "status": "kept"})],
              contrast=_ca,
              note="The fee day fell on day 4960, 80 days before the log ends, and no payment appears, so Bernice's "
                   "promise is broken; claiming it was kept says money changed hands that did not. Gertie fed Rowan's "
                   "hens and the kept event records it, so calling that promise broken or pending contradicts the log. An "
                   "item with Gertie as promisor reverses who promised the fees."))
add(synthesis(5, "broken_promise", "G071", L, tick=5040, people=_g071_people, relations=[],
              events=_g071_b, situation=_g071_situation, schema="broken_promise_v1",
              must=[{"promisor": 1, "promisee": 3, "promise_event": "e1", "status": "pending"}],
              must_not=[{"promise_event": "e1", "status": ["broken", "kept"]},
                        {"promise_event": "e2", "status": ["broken", "pending"]}],
              severe_conditions=_PROMISE_SEVERE,
              severe_patterns=[("reversed_direction", {"promise_event": "e1", "promisor": 3}),
                               ("contradicts_fact", {"promise_event": "e1", "status": "kept"})],
              contrast=_cb,
              note="Same cast and log, but the fee day is 80 days after the log ends on day 5040, so nothing is "
                   "overdue and the fee promise is pending. Calling it broken or kept contradicts the record. Gertie's hen "
                   "promise was still kept."))

# G072: a railing promise whose fulfilment event is present or absent. Variable: that event.
_g072_people = [
    person(1, "Freda Newcomb", 72, "female", wealth=5200, warmth=2, piety=1),
    person(2, "Percy Newcomb", 46, "male", wealth=1800, loyalty=1, pride=1),
    person(3, "Hattie Newcomb", 14, "female", wealth=0),
    person(4, "Corinna Tolliver", 39, "female", wealth=900, warmth=1),
]
_g072_situation = (
    "Freda Newcomb promised her granddaughter Hattie $600 for a year of music lessons, due when the autumn term ends, "
    "six weeks after the harvest fair. Freda's son Percy promised their neighbor Corinna Tolliver he would repair her "
    "porch railing before the fair. Corinna later gave Hattie a violin. The log ends three months after the fair."
)
_g072_kept = [
    ev("e1", 6100, "promise", [1, 3], magnitude=600, tags=["written"], due=6300),
    ev("e2", 6120, "promise", [2, 4], magnitude=150, tags=["verbal", "witnessed"], due=6250),
    ev("e3", 6200, "help", [4, 1], magnitude=45),
    ev("e4", 6250, "promise_kept", [2, 4], magnitude=150, caused_by=["e2"]),
    ev("e5", 6260, "gift", [4, 3], magnitude=40),
    ev("e6", 6290, "help", [2, 1], magnitude=60),
    ev("e7", 6290, "help", [4, 3], magnitude=30),
]
_g072_dropped = [e for e in _g072_kept if e["id"] != "e4"]
_ca, _cb = pair(
    "P033", "Card b drops event e4, the promise_kept that records Percy finishing Corinna's railing; all other events match",
    {"include": [],
     "exclude": [{"promise_event": "e2", "status": ["broken", "pending"]}]},
    {"include": [{"promise_event": "e2", "status": "broken"}],
     "exclude": []},
)
add(synthesis(6, "broken_promise", "G072", L, tick=6350, people=_g072_people, relations=[],
              events=_g072_kept, situation=_g072_situation, schema="broken_promise_v1",
              must=[{"promisor": 1, "promisee": 3, "promise_event": "e1", "status": "broken"}],
              must_not=[{"promise_event": "e2", "status": ["broken", "pending"]},
                        {"promise_event": "e1", "status": ["pending", "kept"]}],
              severe_conditions=_PROMISE_SEVERE,
              severe_patterns=[("reversed_direction", {"promise_event": "e2", "promisor": 4}),
                               ("contradicts_fact", {"promise_event": "e1", "status": "kept"})],
              contrast=_ca,
              note="Percy repaired the railing before the fair, ten days ahead of the due day, and e4 records it, so "
                   "that promise is kept and is optional to list; calling it broken or pending contradicts the log. "
                   "Freda's lesson money was due at the term's end and nothing was paid, so it is broken. Corinna as "
                   "promisor of the railing reverses who promised."))
add(synthesis(7, "broken_promise", "G072", L, tick=6350, people=_g072_people, relations=[],
              events=_g072_dropped, situation=_g072_situation, schema="broken_promise_v1",
              must=[{"promisor": 2, "promisee": 4, "promise_event": "e2", "status": "broken"},
                    {"promisor": 1, "promisee": 3, "promise_event": "e1", "status": "broken"}],
              must_not=[{"promise_event": "e2", "status": ["kept", "pending"]},
                        {"promise_event": "e1", "status": ["pending", "kept"]}],
              severe_conditions=_PROMISE_SEVERE,
              severe_patterns=[("reversed_direction", {"promise_event": "e2", "promisor": 4}),
                               ("contradicts_fact", {"promise_event": "e1", "status": "kept"})],
              contrast=_cb,
              note="Without the kept event nothing was repaired by the fair, so Percy's railing promise is broken "
                   "even though the cast and the other events are unchanged. Calling it kept invents the repair; "
                   "pending ignores that the fair is over."))

# G073: part payments. Two cards on the same cast and the same two promises.
_g073_people = [
    person(1, "Marshall Orton", 58, "male", wealth=7400, pride=1, loyalty=1),
    person(2, "Kittie Orton", 55, "female", wealth=2000, warmth=1),
    person(3, "Bridget Slade", 31, "female", wealth=2600, greed=1),
    person(4, "Harvey Orton", 26, "male", wealth=1100),
]
_g073_situation = (
    "Marshall Orton promised his son Harvey $1,200 toward a truck by Harvey's twenty-sixth birthday. He also promised "
    "Bridget Slade new shelving for her shop before it opened. Bridget later gave Harvey a set of tools. Kittie is "
    "Marshall's wife. The log ends a month after the birthday."
)
add(synthesis(8, "broken_promise", "G073", L, tick=8330, people=_g073_people, relations=[],
              events=[ev("e1", 8200, "promise", [1, 3], magnitude=900, tags=["written"], due=8280),
                      ev("e2", 8210, "promise", [1, 4], magnitude=1200, tags=["verbal"], due=8300),
                      ev("e3", 8280, "promise_kept", [1, 3], magnitude=900, caused_by=["e1"]),
                      ev("e4", 8290, "promise_kept", [1, 4], magnitude=700, caused_by=["e2"], tags=["partial"]),
                      ev("e5", 8290, "help", [3, 2], magnitude=50),
                      ev("e6", 8310, "gift", [3, 4], magnitude=60)],
              situation=_g073_situation, schema="broken_promise_v1",
              must=[{"promisor": 1, "promisee": 4, "promise_event": "e2", "status": "broken",
                     "evidence_any": ["e2", "e4"]}],
              must_not=[{"promise_event": "e2", "status": ["kept", "pending"]},
                        {"promise_event": "e1", "status": ["broken", "pending"]}],
              severe_conditions=_PROMISE_SEVERE,
              severe_patterns=[("reversed_direction", {"promise_event": "e2", "promisor": 4}),
                               ("contradicts_fact", {"promise_event": "e2", "status": "kept"})],
              note="$1,200 was promised and e4 pays $700 of it, leaving $500 unpaid after the birthday: a part "
                   "payment counts as broken under the schema. The shelving was finished on its due day, so calling "
                   "it broken or pending contradicts the log."))
add(synthesis(9, "broken_promise", "G073", L, tick=8330, people=_g073_people, relations=[],
              events=[ev("e1", 8200, "promise", [1, 3], magnitude=900, tags=["written"], due=8280),
                      ev("e2", 8210, "promise", [1, 4], magnitude=1200, tags=["verbal"], due=8300),
                      ev("e3", 8260, "promise_kept", [1, 4], magnitude=600, caused_by=["e2"], tags=["partial"]),
                      ev("e4", 8290, "promise_kept", [1, 3], magnitude=400, caused_by=["e1"], tags=["partial"]),
                      ev("e5", 8290, "help", [3, 2], magnitude=50),
                      ev("e6", 8300, "promise_kept", [1, 4], magnitude=600, caused_by=["e2", "e3"]),
                      ev("e7", 8310, "gift", [3, 4], magnitude=60)],
              situation=_g073_situation, schema="broken_promise_v1",
              must=[{"promisor": 1, "promisee": 3, "promise_event": "e1", "status": "broken"}],
              must_not=[{"promise_event": "e1", "status": ["kept", "pending"]},
                        {"promise_event": "e2", "status": ["broken", "pending"]}],
              severe_conditions=_PROMISE_SEVERE,
              severe_patterns=[("reversed_direction", {"promise_event": "e1", "promisor": 3}),
                               ("contradicts_fact", {"promise_event": "e2", "status": "broken"})],
              note="Harvey's $1,200 arrives in two payments, the second on the birthday, so that promise is complete. "
                   "Only $400 of the $900 shelving job was done, so Bridget's promise is broken; the total paid is "
                   "not the test, the work promised is. Calling the completed truck money broken contradicts the "
                   "log."))

# G074: a promise by a man who dies before the due day; the estate owes it.
_g074_people = [
    person(1, "Vernon Rourke", 77, "male", alive=False, wealth=9000, pride=2),
    person(2, "Lavinia Rourke", 49, "female", wealth=2100, loyalty=2),
    person(3, "Reuben Rourke", 22, "male", wealth=600),
    person(4, "Pansy Vickers", 63, "female", wealth=1500, warmth=1),
]
_g074_situation = (
    "Vernon Rourke promised his grandson Reuben $2,000 toward trade school, due before the autumn term. Vernon "
    "died six weeks before the term began. Under town rules a dead person's promise becomes a debt of "
    "the estate, and Lavinia is Vernon's sole heir. Pansy Vickers is a neighbor. The log ends two months after the "
    "term began."
)
_g074_severe = _PROMISE_SEVERE
add(synthesis(10, "broken_promise", "G074", L, tick=9360, people=_g074_people, relations=[],
              events=[ev("e1", 9200, "promise", [1, 3], magnitude=2000, tags=["written"], due=9300),
                      ev("e2", 9260, "death", [1]),
                      ev("e3", 9260, "inheritance", [1, 2], magnitude=9000, caused_by=["e2"], tags=["house"]),
                      ev("e4", 9270, "offering", [2, 1], magnitude=60, tags=["joss_paper"]),
                      ev("e5", 9280, "promise", [2, 4], magnitude=0, tags=["verbal"], due=9290),
                      ev("e6", 9290, "promise_kept", [2, 4], magnitude=0, caused_by=["e5"]),
                      ev("e7", 9340, "help", [4, 2], magnitude=40)],
              situation=_g074_situation, schema="broken_promise_v1",
              must=[{"promisee": 3, "promise_event": "e1", "status": "broken",
                     "evidence_any": ["e1", "e2"]}],
              must_not=[{"promise_event": "e1", "status": ["pending", "kept"]},
                        {"promise_event": "e5", "status": ["broken", "pending"]}],
              severe_conditions=_g074_severe,
              severe_patterns=[("contradicts_fact", {"promise_event": "e1", "status": "kept"}),
                               ("reversed_direction", {"promise_event": "e1", "promisor": 3})],
              contrast=None,
              note="Vernon promised $2,000 due on day 9300, died on day 9260, and no money reached Reuben by the log "
                   "end; the estate owes it, so the promise is broken rather than cancelled. Listing it as kept says "
                   "a dead man paid, which the log never shows. Lavinia's promise of weekly rides was kept at e6."))
add(synthesis(11, "broken_promise", "G074", L, tick=9360, people=_g074_people, relations=[],
              events=[ev("e1", 9200, "promise", [1, 3], magnitude=2000, tags=["written"], due=9300),
                      ev("e2", 9260, "death", [1]),
                      ev("e3", 9260, "inheritance", [1, 2], magnitude=9000, caused_by=["e2"], tags=["house"]),
                      ev("e4", 9270, "offering", [2, 1], magnitude=60, tags=["joss_paper"]),
                      ev("e5", 9280, "promise", [2, 4], magnitude=0, tags=["verbal"], due=9290),
                      ev("e6", 9295, "gift", [2, 3], magnitude=2000, tags=["cash"], caused_by=["e1", "e3"]),
                      ev("e7", 9340, "help", [4, 2], magnitude=40)],
              situation=_g074_situation, schema="broken_promise_v1",
              must=[{"promisor": 2, "promisee": 4, "promise_event": "e5", "status": "broken"}],
              must_not=[{"promise_event": "e1", "status": ["broken", "pending"]},
                        {"promise_event": "e5", "status": ["kept", "pending"]}],
              severe_conditions=_g074_severe,
              severe_patterns=[("contradicts_fact", {"promise_event": "e1", "status": "broken"}),
                               ("reversed_direction", {"promise_event": "e5", "promisor": 4})],
              note="The heir paid the full $2,000 out of the estate on day 9295, five days before the due day, so "
                   "Vernon's promise is discharged and is not broken or pending. Lavinia's weekly-ride promise was "
                   "due on day 9290 and nothing was done, so that one is broken."))

# G075: a payment made, but after the due day.
_g075_people = [
    person(1, "Byron Wexler", 63, "male", wealth=4100, pride=1, temper=1),
    person(2, "Dorothea Wexler", 59, "female", wealth=1200, warmth=1),
    person(3, "Clarice Wexler", 34, "female", wealth=1500, loyalty=1),
    person(4, "Stanley Yeager", 52, "male", wealth=3000, loyalty=1),
]
add(synthesis(12, "broken_promise", "G075", L, tick=7260,
              people=_g075_people, relations=[],
              events=[ev("e1", 7000, "promise", [3, 1], magnitude=500, tags=["written"], due=7150),
                      ev("e2", 7010, "promise", [1, 4], magnitude=300, tags=["verbal", "witnessed"], due=7150),
                      ev("e3", 7150, "promise_kept", [1, 4], magnitude=300, caused_by=["e2"]),
                      ev("e4", 7200, "promise_kept", [3, 1], magnitude=500, caused_by=["e1"]),
                      ev("e5", 7220, "gift", [4, 2], magnitude=50),
                      ev("e6", 7220, "help", [2, 3], magnitude=40)],
              situation=("Clarice Wexler promised her father Byron $500 toward his workshop roof by mid-May. Byron "
                         "promised their neighbor Stanley Yeager his old lathe by the same day. In this town a promise "
                         "counts as kept only if it is fulfilled by its due day. The log ends in early September."),
              schema="broken_promise_v1",
              must=[{"promisor": 3, "promisee": 1, "promise_event": "e1", "status": "broken",
                     "evidence_any": ["e1", "e4"]}],
              must_not=[{"promise_event": "e1", "status": ["kept", "pending"]},
                        {"promise_event": "e2", "status": ["broken", "pending"]}],
              severe_conditions=_PROMISE_SEVERE,
              severe_patterns=[("reversed_direction", {"promise_event": "e1", "promisor": 1}),
                               ("contradicts_fact", {"promise_event": "e2", "status": "broken"})],
              note="Clarice paid the $500 on day 7200, fifty days after the day it was due, and the card's rule "
                   "counts late fulfilment as broken. Byron handed over the lathe on the due day itself, so that "
                   "promise is kept. Calling the lathe promise broken contradicts the log."))

# G076: work completed through a hired hand. Two promises, one part paid.
_g076_people = [
    person(1, "Cecil Vickers", 47, "male", wealth=3300, pride=1, loyalty=1),
    person(2, "Lucinda Vickers", 44, "female", wealth=900, warmth=1),
    person(3, "Jerome Slade", 38, "male", wealth=1200, greed=1),
    person(4, "Annette Slade", 36, "female", wealth=700, temper=1),
]
add(synthesis(13, "broken_promise", "G076", L, tick=5590,
              people=_g076_people, relations=[],
              events=[ev("e1", 5400, "promise", [1, 2], magnitude=900, tags=["written"], due=5560),
                      ev("e2", 5450, "accident", [1], magnitude=70),
                      ev("e3", 5470, "promise", [1, 3], magnitude=400, tags=["verbal"], due=5550),
                      ev("e4", 5500, "help", [3, 1], magnitude=90, caused_by=["e3"]),
                      ev("e5", 5540, "quarrel", [4, 3], magnitude=40, tags=["public"]),
                      ev("e6", 5550, "promise_kept", [1, 2], magnitude=900, caused_by=["e1", "e4"]),
                      ev("e7", 5550, "promise_kept", [1, 3], magnitude=250, caused_by=["e3"], tags=["partial"])],
              situation=("Cecil Vickers promised his wife Lucinda a new kitchen before their daughter's spring "
                         "wedding. He also promised Jerome Slade, a hired hand, a $400 bonus when the kitchen was "
                         "finished. Jerome's wife Annette works at the diner. The log ends a month after the "
                         "wedding."),
              schema="broken_promise_v1",
              must=[{"promisor": 1, "promisee": 3, "promise_event": "e3", "status": "broken",
                     "evidence_any": ["e3", "e7"]}],
              must_not=[{"promise_event": "e1", "status": ["broken", "pending"]},
                        {"promise_event": "e3", "status": ["kept", "pending"]}],
              severe_conditions=_PROMISE_SEVERE,
              severe_patterns=[("reversed_direction", {"promise_event": "e3", "promisor": 3}),
                               ("contradicts_fact", {"promisor": 3, "promisee": 2})],
              note="The $400 bonus was paid as $250, so the bonus promise is broken. The kitchen itself was finished "
                   "before the wedding, recorded at e6 after Jerome's work, so calling it broken or pending "
                   "contradicts the log. Jerome never promised Lucinda anything."))

# ---------------------------------------------------------------- relationship_shift

_SHIFT_BASIC = ["invented_event_id", "invented_person", "self_reference"]
_SHIFT_SEVERE = ["invented_event_id", "invented_person", "self_reference", "contradicts_fact"]

# G077: a courtship that ends in marriage or in a public quarrel. Variable: what e3 is.
_g077_people = [
    person(1, "Sadie Ashby", 21, "female", wealth=400, warmth=1),
    person(2, "Homer Brandt", 24, "male", wealth=700, pride=2),
    person(3, "Marigold Ashby", 45, "female", wealth=2500, pride=1),
]
_g077_situation = (
    "Sadie Ashby and Homer Brandt grew up on the same street and began courting this spring. Marigold is Sadie's "
    "mother and has known Homer since he was a boy. The log covers the season that followed the courtship."
)
_g077_base = [
    ev("e1", 2000, "courtship", [2, 1], magnitude=60, tags=["public"]),
    ev("e2", 2030, "gift", [1, 2], magnitude=60),
]
_g077_a = _g077_base + [
    ev("e3", 2060, "marriage", [1, 2], magnitude=60, tags=["public"]),
    ev("e4", 2060, "deal", [3, 2], magnitude=40),
]
_g077_b = _g077_base + [
    ev("e3", 2060, "quarrel", [1, 2], magnitude=60, tags=["public"]),
    ev("e4", 2060, "deal", [3, 2], magnitude=40),
]
_ca, _cb = pair(
    "P034", "Event e3 is a marriage of the same two people in card a and a public quarrel between them in card b",
    {"include": [{"a": 1, "b": 2, "direction": "warmer"}],
     "exclude": [{"a": 1, "b": 2, "direction": ["colder", "reversed"]}]},
    {"include": [{"a": 1, "b": 2, "direction": ["colder", "reversed"]}],
     "exclude": [{"a": 1, "b": 2, "direction": "warmer"}]},
)
add(synthesis(4, "relationship_shift", "G077", L, tick=2100, people=_g077_people, relations=[],
              events=_g077_a, situation=_g077_situation, schema="relationship_shift_v1",
              must=[{"a": 1, "b": 2, "direction": "warmer", "turning_point": ["e1", "e3"]}],
              must_not=[{"a": 1, "b": 2, "direction": ["colder", "reversed", "unchanged"]},
                        {"a": 2, "b": 3, "direction": ["warmer", "reversed"]}],
              severe_conditions=_SHIFT_SEVERE,
              severe_patterns=[("contradicts_fact", {"a": 1, "b": 2, "direction": "colder"})],
              contrast=_ca,
              note="Two neighbours court, exchange a gift and marry, so the pair moves warmer and the decisive event "
                   "is the courtship or the marriage. A colder reading reverses the log. Marigold sells Homer firewood "
                   "once; that transaction does not warm her relationship with him."))
add(synthesis(5, "relationship_shift", "G077", L, tick=2100, people=_g077_people, relations=[],
              events=_g077_b, situation=_g077_situation, schema="relationship_shift_v1",
              must=[{"a": 1, "b": 2, "direction": ["colder", "reversed"], "turning_point": "e3"}],
              must_not=[{"a": 1, "b": 2, "direction": ["warmer", "unchanged"]},
                        {"a": 2, "b": 3, "direction": ["warmer", "reversed"]}],
              severe_conditions=_SHIFT_SEVERE,
              severe_patterns=[("contradicts_fact", {"a": 1, "b": 2, "direction": "warmer"})],
              contrast=_cb,
              note="The courtship ends in a public quarrel on day 2060 and nothing follows it, so the pair ends "
                   "colder or reversed with that quarrel as the turning point. The gift before it does not cancel the "
                   "public break. Calling the pair warmer contradicts the log."))

# G078: hay sold at the going price or at three times it. Variable: the price in e3.
_g078_people = [
    person(1, "Winifred Everly", 58, "female", wealth=5000, loyalty=1),
    person(2, "Ivan Everly", 61, "male", wealth=6400, greed=1),
    person(3, "Henrietta Ives", 70, "female", wealth=1200, warmth=1),
]
_g078_situation = (
    "Winifred Everly runs the last dairy farm on her road. Ivan is her late husband's brother and has helped her since "
    "the funeral. A load of hay sells for about $800 around here. Henrietta Ives is Winifred's neighbor. The log covers one "
    "summer."
)
_g078_fair = [
    ev("e1", 2000, "help", [2, 1], magnitude=70),
    ev("e2", 2030, "gift", [1, 2], magnitude=90),
    ev("e3", 2060, "deal", [2, 1], magnitude=800),
    ev("e4", 2060, "help", [3, 1], magnitude=40),
]
_g078_gouge = [
    ev("e1", 2000, "help", [2, 1], magnitude=70),
    ev("e2", 2030, "gift", [1, 2], magnitude=90),
    ev("e3", 2060, "deal", [2, 1], magnitude=2400),
    ev("e4", 2060, "help", [3, 1], magnitude=40),
]
_ca, _cb = pair(
    "P035", "The hay Ivan sells Winifred in e3 costs $800, the going price, in card a and $2,400 in card b",
    {"include": [{"a": 1, "b": 2, "direction": "warmer"}],
     "exclude": [{"a": 1, "b": 2, "direction": ["colder", "reversed"]}]},
    {"include": [{"a": 1, "b": 2, "direction": ["colder", "reversed"]}],
     "exclude": [{"a": 1, "b": 2, "direction": "warmer"}]},
)
add(synthesis(6, "relationship_shift", "G078", L, tick=2100, people=_g078_people, relations=[],
              events=_g078_fair, situation=_g078_situation, schema="relationship_shift_v1",
              must=[{"a": 1, "b": 2, "direction": "warmer"}],
              must_not=[{"a": 1, "b": 2, "direction": ["colder", "reversed", "unchanged"]}],
              severe_conditions=_SHIFT_BASIC,
              contrast=_ca,
              note="Ivan mends her barn roof, she gives him cider, and he sells her a load at the price everyone "
                   "pays, so the summer makes them warmer. Three friendly events leave no ground for colder, and the "
                   "pair was never hostile, so not reversed either."))
add(synthesis(7, "relationship_shift", "G078", L, tick=2100, people=_g078_people, relations=[],
              events=_g078_gouge, situation=_g078_situation, schema="relationship_shift_v1",
              must=[{"a": 1, "b": 2, "direction": ["colder", "reversed"]}],
              must_not=[{"a": 1, "b": 2, "direction": ["warmer", "unchanged"]}],
              severe_conditions=_SHIFT_BASIC,
              contrast=_cb,
              note="The roof and the gift already passed, but charging a widow three times the going price for her "
                   "winter hay sours the pair, so the summer ends colder. Calling it warmer reads the price out "
                   "of the log, and unchanged ignores it."))

# G079: two brothers. Card 1 reconciles after a public insult; card 2 leaves the brothers where they were.
_g079_people = [
    person(1, "Johanna Cogswell", 66, "female", wealth=2800, warmth=1),
    person(2, "Lamar Cogswell", 38, "male", wealth=3600, pride=2, temper=1),
    person(3, "Clayton Cogswell", 35, "male", wealth=2400, loyalty=2),
    person(4, "Priscilla Dunmore", 60, "female", wealth=1700, temper=1),
]
_g079_situation = (
    "Lamar and Clayton Cogswell are brothers who farm the land their father left them. Johanna is their mother. "
    "Priscilla Dunmore and Johanna have bickered over the church flower beds for twenty years. The log covers one "
    "year."
)
add(synthesis(8, "relationship_shift", "G079", L, tick=3350, people=_g079_people, relations=[],
              events=[ev("e1", 3000, "quarrel", [2, 3], magnitude=70, tags=["public"]),
                      ev("e2", 3000, "insult", [2, 3], magnitude=60, caused_by=["e1"], tags=["public"]),
                      ev("e3", 3100, "illness", [2]),
                      ev("e4", 3150, "help", [3, 2], magnitude=85, caused_by=["e3"]),
                      ev("e5", 3200, "apology", [2, 3], magnitude=70, caused_by=["e4"]),
                      ev("e6", 3250, "gift", [2, 3], magnitude=120, caused_by=["e5"]),
                      ev("e7", 3300, "quarrel", [4, 1], magnitude=30)],
              situation=_g079_situation, schema="relationship_shift_v1",
              must=[{"a": 2, "b": 3, "direction": ["warmer", "reversed"], "turning_point": ["e4", "e5"]}],
              must_not=[{"a": 2, "b": 3, "direction": ["colder", "unchanged"]},
                        {"a": 1, "b": 4, "direction": ["warmer", "reversed"]}],
              severe_conditions=_SHIFT_SEVERE,
              severe_patterns=[("contradicts_fact", {"a": 2, "b": 3, "direction": "colder"})],
              contrast=None,
              note="Lamar insults Clayton in public, then Clayton works his brother's fields through the illness and "
                   "Lamar apologizes and brings a gift: the brothers end warmer or reversed, and the turning point is "
                   "the help or the apology. Johanna and Priscilla only repeat a twenty-year quarrel, so they did not "
                   "warm."))
add(synthesis(9, "relationship_shift", "G079", L, tick=3350, people=_g079_people, relations=[],
              events=[ev("e1", 3000, "quarrel", [2, 3], magnitude=60, tags=["public"]),
                      ev("e2", 3080, "help", [1, 2], magnitude=55),
                      ev("e3", 3150, "gift", [2, 1], magnitude=150),
                      ev("e4", 3220, "help", [1, 2], magnitude=45),
                      ev("e5", 3300, "quarrel", [2, 3], magnitude=40, tags=["public"]),
                      ev("e6", 3300, "gift", [1, 3], magnitude=30)],
              situation=_g079_situation, schema="relationship_shift_v1",
              must=[{"a": 1, "b": 2, "direction": "warmer"}],
              must_not=[{"a": 2, "b": 3, "direction": ["warmer", "reversed"]},
                        {"a": 1, "b": 2, "direction": ["colder", "reversed", "unchanged"]}],
              severe_conditions=_SHIFT_BASIC,
              contrast=None,
              note="Johanna sits with Lamar's children, he buys her a stove and she keeps his accounts, so mother and "
                   "son grow warmer. The brothers argue about the same truck twice and nothing else passes between "
                   "them, so they stay where they were."))

# G080: a slow cooling with no single breach, then the same cast with one witnessed theft.
_g080_people = [
    person(1, "Ida Fenwick", 54, "female", wealth=6000, pride=2),
    person(2, "Prentice Fenwick", 57, "male", wealth=3000, loyalty=1),
    person(3, "Flora Ives", 29, "female", wealth=500, warmth=2),
    person(4, "Thaddeus Ives", 31, "male", wealth=900),
]
_g080_situation = (
    "Flora Ives has worked in Ida Fenwick's shop for six years and the two have been close. Thaddeus is Flora's "
    "brother. Prentice is Ida's husband. The log covers about a year."
)
add(synthesis(10, "relationship_shift", "G080", L, tick=4300, people=_g080_people, relations=[],
              events=[ev("e1", 4000, "help", [3, 1], magnitude=70),
                      ev("e2", 4060, "insult", [1, 3], magnitude=25, tags=["private"]),
                      ev("e3", 4120, "quarrel", [1, 3], magnitude=30, tags=["private"]),
                      ev("e4", 4180, "insult", [1, 3], magnitude=35, tags=["witnessed"]),
                      ev("e5", 4240, "gift", [4, 3], magnitude=40),
                      ev("e6", 4240, "help", [1, 4], magnitude=30)],
              situation=_g080_situation, schema="relationship_shift_v1",
              must=[{"a": 1, "b": 3, "direction": ["colder", "reversed"]}],
              must_not=[{"a": 1, "b": 3, "direction": ["warmer", "unchanged"]}],
              severe_conditions=_SHIFT_BASIC,
              contrast=None,
              note="Three slights in a year, two of them private and one in front of a customer, wear a six-year "
                   "friendship down; no one event turns it, so no turning point is required. The pair still works "
                   "together, so warmer or unchanged both misread the year."))
add(synthesis(11, "relationship_shift", "G080", L, tick=4300, people=_g080_people, relations=[],
              events=[ev("e1", 4000, "help", [3, 1], magnitude=70),
                      ev("e2", 4060, "gift", [1, 3], magnitude=50),
                      ev("e3", 4150, "theft", [1, 3], magnitude=300, tags=["witnessed"]),
                      ev("e4", 4200, "quarrel", [1, 3], magnitude=60, tags=["public"]),
                      ev("e5", 4260, "help", [4, 3], magnitude=40),
                      ev("e6", 4260, "help", [2, 1], magnitude=30)],
              situation=_g080_situation, schema="relationship_shift_v1",
              must=[{"a": 1, "b": 3, "direction": ["colder", "reversed"], "turning_point": ["e3", "e4"]}],
              must_not=[{"a": 1, "b": 3, "direction": ["warmer", "unchanged"]}],
              severe_conditions=_SHIFT_BASIC,
              contrast=None,
              note="Ida takes $300 from the till in front of a witness on day 4150, and the quarrel the next day "
                   "settles it: the pair ends colder or reversed with that theft as the turning point. The earlier "
                   "help and gift do not survive a witnessed theft."))

# G081: an outsider in an assigned body. The landlord's household splits.
_g081_people = [
    person(1, "Geraldine Kessler", 58, "female", wealth=4200, warmth=2, piety=1),
    person(2, "Alvin Kessler", 30, "male", wealth=800, pride=2),
    person(3, "Rodney Huxley", 33, "male", origin="possessed", wealth=100, loyalty=1),
    person(4, "Ottilie Galloway", 26, "female", wealth=300, warmth=1),
]
add(synthesis(12, "relationship_shift", "G081", L, tick=4100,
              people=_g081_people, relations=[],
              events=[ev("e1", 4000, "possession", [3]),
                      ev("e2", 4005, "help", [3, 1], magnitude=60),
                      ev("e3", 4030, "quarrel", [2, 3], magnitude=50, tags=["public"]),
                      ev("e4", 4070, "help", [3, 4], magnitude=80),
                      ev("e5", 4090, "gift", [1, 3], magnitude=40),
                      ev("e6", 4090, "help", [1, 4], magnitude=35)],
              situation=("Rodney Huxley arrived this year in a body assigned by the underworld office. He rents a "
                         "room at the boarding house run by Geraldine Kessler, whose son Alvin lives there too. Ottilie "
                         "Galloway keeps house for them. The log covers one autumn."),
              schema="relationship_shift_v1",
              must=[{"a": 1, "b": 3, "direction": ["warmer", "reversed"]}],
              must_not=[{"a": 1, "b": 3, "direction": ["colder", "unchanged"]},
                        {"a": 2, "b": 3, "direction": ["warmer", "reversed"]}],
              severe_conditions=_SHIFT_BASIC,
              contrast=None,
              note="Geraldine takes the coal and pump repairs as rent is due and then gives Rodney her late husband's "
                   "coat, so her view of him warms whatever body he came in. Alvin quarrels once about a stranger "
                   "wearing a dead man's coat and nothing repairs it, so his relationship stays where it was."))

# G082: cousins, a will, and a lawsuit.
_g082_people = [
    person(1, "Viola Ashby", 44, "female", wealth=2200, loyalty=1),
    person(2, "August Ashby", 47, "male", wealth=3100, greed=2, pride=1),
    person(3, "Irwin Ashby", 79, "male", alive=False, wealth=14000),
]
add(synthesis(13, "relationship_shift", "G082", L, tick=3700,
              people=_g082_people, relations=[],
              events=[ev("e1", 3000, "help", [2, 1], magnitude=70),
                      ev("e2", 3100, "gift", [1, 2], magnitude=60, tags=["heirloom"]),
                      ev("e4", 3350, "will", [3, 1], magnitude=14000, tags=["written", "land"]),
                      ev("e3", 3400, "death", [3]),
                      ev("e5", 3400, "inheritance", [3, 1], magnitude=14000, caused_by=["e3", "e4"],
                         tags=["house", "land"]),
                      ev("e6", 3500, "quarrel", [2, 1], magnitude=80, caused_by=["e5"], tags=["public"]),
                      ev("e7", 3600, "lawsuit", [2, 1], magnitude=3000, caused_by=["e6"], tags=["public"]),
                      ev("e8", 3650, "offering", [1, 3], magnitude=60, tags=["joss_paper"])],
              situation=("Viola and August Ashby are cousins. Their uncle Irwin raised them both and died this spring, "
                         "leaving the home place. Under town rules a will decides who takes the estate. The log covers "
                         "the two years around his death."),
              schema="relationship_shift_v1",
              must=[{"a": 1, "b": 2, "direction": ["colder", "reversed"], "turning_point": ["e5", "e6"]}],
              must_not=[{"a": 1, "b": 2, "direction": ["warmer", "unchanged"]}],
              severe_conditions=_SHIFT_BASIC,
              contrast=None,
              note="The cousins help each other until the will leaves the home place to Viola alone; August's public "
                   "quarrel and his lawsuit follow, so the pair ends colder or reversed with the inheritance or the "
                   "quarrel as the turning point. The earlier help and heirloom belong to the time before the will."))

# ---------------------------------------------------------------- sanity (synthesis)

_g085_people = [
    person(1, "Harriet Rook", 50, "female", wealth=3000, loyalty=1),
    person(2, "Milton Rook", 52, "male", wealth=2600, warmth=1),
]
add(synthesis(3, "sanity", "G085", L, tick=1040, scored=False, people=_g085_people, relations=[],
              events=[ev("e1", 1000, "promise", [2, 1], magnitude=200, tags=["verbal"], due=1030),
                      ev("e2", 1000, "help", [1, 2], magnitude=40),
                      ev("e3", 1030, "gift", [2, 1], magnitude=15)],
              situation=("Milton Rook promised his sister Harriet $200 toward her new well by the end of the month. "
                         "The month has passed and he has paid nothing."),
              schema="broken_promise_v1",
              must=[{"promisor": 2, "promisee": 1, "promise_event": "e1", "status": "broken"}],
              must_not=[{"promise_event": "e1", "status": ["kept", "pending"]}],
              severe_conditions=_PROMISE_BASIC,
              note="Sanity: the due month passed and nothing was paid."))
add(synthesis(4, "sanity", "G085", L, tick=1040, scored=False, people=_g085_people, relations=[],
              events=[ev("e1", 1000, "gift", [2, 1], magnitude=60),
                      ev("e2", 1000, "help", [2, 1], magnitude=40),
                      ev("e3", 1030, "help", [1, 2], magnitude=50)],
              situation="Harriet Rook and her brother Milton live next door to each other. The log covers one month.",
              schema="relationship_shift_v1",
              must=[{"a": 1, "b": 2, "direction": "warmer"}],
              must_not=[{"a": 1, "b": 2, "direction": ["colder", "unchanged"]}],
              severe_conditions=_SHIFT_BASIC,
              note="Sanity: every event is a gift or a favour."))

_g086_people = [
    person(1, "Perry Sable", 60, "male", wealth=3400, temper=1),
    person(2, "Eula Sable", 58, "female", wealth=1300, warmth=1),
]
add(synthesis(5, "sanity", "G086", L, tick=2015, scored=False, people=_g086_people, relations=[],
              events=[ev("e1", 2000, "quarrel", [1, 2], magnitude=60, tags=["private"]),
                      ev("e2", 2005, "apology", [1, 2], magnitude=70),
                      ev("e3", 2005, "help", [2, 1], magnitude=50),
                      ev("e4", 2010, "gift", [1, 2], magnitude=40)],
              situation=("Perry Sable quarrelled with his wife Eula over money and apologized the same week. The log "
                         "covers a fortnight."),
              schema="relationship_shift_v1",
              must=[{"a": 1, "b": 2, "direction": ["warmer", "reversed"]}],
              must_not=[{"a": 1, "b": 2, "direction": ["colder", "unchanged"]}],
              severe_conditions=_SHIFT_BASIC,
              note="Sanity: quarrel, apology, help and a gift inside a fortnight."))
add(synthesis(6, "sanity", "G086", L, tick=2070, scored=False, people=_g086_people, relations=[],
              events=[ev("e1", 2000, "promise", [1, 2], magnitude=300, tags=["written"], due=2060),
                      ev("e2", 2050, "promise_kept", [1, 2], magnitude=300, caused_by=["e1"]),
                      ev("e3", 2050, "gift", [1, 2], magnitude=30)],
              situation=("Perry Sable promised his wife Eula $300 for a new stove before the harvest. He paid her the "
                         "full $300 ten days before the harvest."),
              schema="broken_promise_v1",
              must=[{"promisor": 1, "promisee": 2, "promise_event": "e1", "status": "kept"}],
              must_not=[{"promise_event": "e1", "status": ["broken", "pending"]}],
              severe_conditions=_PROMISE_BASIC,
              note="Sanity: the full amount was paid ten days before the due day."))