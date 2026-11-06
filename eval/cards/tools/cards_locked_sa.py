"""Locked cards, writer SA.

grudge_detection S-grudge_detection-004..013, groups G059..G064, pairs P026..P028.
debt_chain       S-debt_chain-004..013,       groups G065..G070, pairs P029..P031.
"""

from cardlib import decision, ev, pair, person, rel, synthesis

L = "locked"
CARDS = []
add = CARDS.append

_GEN = ["invented_event_id", "invented_person", "self_reference"]

# ---------------------------------------------------------------- grudge_detection

# G059: cattle in the orchard, a public row, and the son sent to help mend the fence.
_corinne = person(1, "Corinne Lockwood", 58, "female", wealth=2400, pride=2, temper=2, loyalty=1)
_hal = person(2, "Hal Lockwood", 34, "male", wealth=900, warmth=1, loyalty=1)
_dale = person(3, "Dale Pembroke", 61, "male", wealth=5200, pride=2, temper=1)
_beulah = person(4, "Beulah Pembroke", 84, "female", alive=False, warmth=1)

_g059_people = [_corinne, _hal, _dale, _beulah]
_g059_events = [
    ev("e1", 11900, "accident", [3, 1], magnitude=45),
    ev("e2", 11900, "quarrel", [1, 3], magnitude=60, caused_by=["e1"], tags=["public"]),
    ev("e3", 11901, "help", [2, 3], magnitude=40, caused_by=["e2"]),
    ev("e4", 11930, "insult", [3, 1], magnitude=30, tags=["private"]),
    ev("e5", 11942, "death", [4]),
    ev("e6", 11960, "offering", [3, 4], magnitude=15, caused_by=["e5"], tags=["joss_paper"]),
]
_g059_situation = (
    "Dale's cattle broke through Corinne's orchard fence at dawn and stripped two rows of apple trees. Corinne "
    "shouted at him in the road that evening while the neighbours listened, and Dale shouted back. She sent her "
    "son Hal over the next morning to help Dale mend the fence. Dale has never paid for the trees. His mother "
    "Beulah died six weeks later."
)
add(synthesis(4, "grudge_detection", "G059", L, tick=12000, people=_g059_people, relations=[],
              events=_g059_events, situation=_g059_situation, schema="grudge_v1",
              must=[{"from": 1, "to": 3, "level": ["medium", "high"], "evidence_any": ["e1", "e2"]}],
              must_not=[{"from": 2, "to": 3}, {"from": 2, "to": 1}, {"from": 1, "to": 2}],
              severe_conditions=_GEN + ["contradicts_fact"],
              severe_patterns=[("contradicts_fact", {"from": 2, "to": 3, "level": ["medium", "high"]}),
                               ("contradicts_fact", {"from": 1, "to": 2, "level": ["medium", "high"]})],
              note="Damage that was never paid for and a public row leave Corinne set against Dale at medium or more. "
                   "Hal went to Dale's fence at his mother's request, and she is the one who sent him, so a grudge "
                   "from Hal or a grudge from Corinne against Hal invents a grievance the log does not show."))
add(synthesis(5, "grudge_detection", "G059", L, tick=12000, people=_g059_people, relations=[],
              events=_g059_events, situation=_g059_situation, schema="grudge_v1",
              must=[{"from": 3, "to": 1, "evidence_any": ["e4"]}],
              must_not=[{"from": 2, "to": 3}, {"from": 2, "to": 1}, {"from": 1, "to": 2}],
              severe_conditions=_GEN + ["contradicts_fact"],
              severe_patterns=[("contradicts_fact", {"from": 2, "to": 3, "level": ["medium", "high"]}),
                               ("contradicts_fact", {"from": 2, "to": 1, "level": ["medium", "high"]})],
              note="The log runs both ways: after the public row Dale answered her privately, out of earshot, so he "
                   "carries some resentment too, at whatever strength. Hal is only a helper in this story and holds "
                   "nothing against either of them."))

# G060: a public accusation at the Grange supper. Variable: Ferris's written apology.
_nadine = person(1, "Nadine Thatcher", 46, "female", wealth=3100, pride=1, temper=1)
_royce = person(2, "Ferris Voss", 52, "male", wealth=8600, pride=1, temper=2)
_inez = person(3, "Inez Voss", 49, "female", wealth=2000, warmth=2)

_g060_people = [_nadine, _royce, _inez]
_g060_base = [
    ev("e1", 7400, "deal", [1, 2], magnitude=300, tags=["cash"]),
    ev("e2", 7450, "insult", [2, 1], magnitude=80, tags=["public"]),
    ev("e3", 7450, "quarrel", [1, 2], magnitude=60, caused_by=["e2"], tags=["public"]),
    ev("e4", 7480, "help", [3, 1], magnitude=25),
]
_g060_situation = (
    "At the Grange supper Ferris said in front of the hall that Nadine waters her milk and that nobody should buy "
    "her cream. Two families have not bought from her since. Nadine shouted at him before the crowd. Inez, Ferris's "
    "wife, runs the supper and helped Nadine carry her cans out afterwards."
)
_g060_both = {"include": [{"from": 1, "to": 2, "level": ["medium", "high"]}], "exclude": []}
_g060_cleared = {"include": [], "exclude": [{"from": 1, "to": 2, "level": ["medium", "high"]}]}
_ca, _cb = pair("P026", "Card b adds Ferris's written apology, read out at the next Grange supper",
                _g060_both, _g060_cleared)
add(synthesis(6, "grudge_detection", "G060", L, tick=7520, people=_g060_people, relations=[],
              events=_g060_base, situation=_g060_situation, schema="grudge_v1",
              must=[{"from": 1, "to": 2, "level": ["medium", "high"], "evidence_any": ["e2"]}],
              must_not=[{"from": 1, "to": 3}, {"from": 3, "to": 1}],
              severe_conditions=_GEN + ["contradicts_fact"],
              severe_patterns=[("contradicts_fact", {"from": 3, "to": 1, "level": ["medium", "high"]})],
              contrast=_ca,
              note="Accused of watering her milk before the whole Grange and two customers gone, Nadine holds a solid "
                   "grudge and nothing has been done to repair it. Inez took Nadine's side and carried her cans out, "
                   "so a grudge running through Inez contradicts the log."))
add(synthesis(7, "grudge_detection", "G060", L, tick=7520, people=_g060_people, relations=[],
              events=_g060_base + [
                  ev("e5", 7500, "apology", [2, 1], magnitude=60, caused_by=["e2"], tags=["written", "public"])],
              situation=_g060_situation, schema="grudge_v1",
              must=[],
              must_not=[{"from": 1, "to": 2, "level": ["medium", "high"]}, {"from": 1, "to": 3}, {"from": 3, "to": 1}],
              severe_conditions=_GEN + ["contradicts_fact"],
              severe_patterns=[("contradicts_fact", {"from": 3, "to": 1, "level": ["medium", "high"]})],
              contrast=_cb,
              note="The same insult, but Ferris put his apology in writing and had it read to the supper crowd, which "
                   "is the repair the first card lacks. A small leftover grudge, or none, is expected; medium or high "
                   "ignores the apology."))

# G061: a market insult. Variable: which of the two said it.
_wren = person(1, "Wren Alder", 29, "female", wealth=1100, pride=2, warmth=1)
_marcus = person(2, "Cyrus Brennan", 33, "male", wealth=1900, pride=2)
_orson = person(3, "Orson Merritt", 58, "male", wealth=4400, warmth=1)
_hesper = person(4, "Hesper Alder", 78, "female", alive=False, warmth=1)

_g061_people = [_wren, _marcus, _orson, _hesper]
_g061_situation = (
    "Wren weaves at a market stall beside Cyrus's cart stand. Before the morning crowd one of them said the "
    "other's work was shoddy and that nobody should buy from them. The one spoken to said nothing back and has not "
    "spoken to the other since. Orson keeps the market's pitch book and gets on with both of them. Wren burns joss "
    "paper for her grandmother Hesper every spring."
)
_g061_tail = [
    ev("e3", 5320, "help", [3, 2], magnitude=20),
    ev("e4", 5345, "offering", [1, 4], magnitude=12, tags=["joss_paper"]),
]
_g061_a = [
    ev("e1", 5300, "deal", [3, 1], magnitude=220, tags=["cash"]),
    ev("e2", 5320, "insult", [1, 2], magnitude=75, tags=["public"]),
] + _g061_tail
_g061_b = [
    ev("e1", 5300, "deal", [3, 1], magnitude=220, tags=["cash"]),
    ev("e2", 5320, "insult", [2, 1], magnitude=75, tags=["public"]),
] + _g061_tail
_ca, _cb = pair("P027", "The insult event's actors are swapped: Wren insulted Cyrus in card a, Cyrus insulted Wren in card b",
                {"include": [{"from": 2, "to": 1, "level": ["medium", "high"]}],
                 "exclude": [{"from": 1, "to": 2, "level": ["medium", "high"]}]},
                {"include": [{"from": 1, "to": 2, "level": ["medium", "high"]}],
                 "exclude": [{"from": 2, "to": 1, "level": ["medium", "high"]}]})
add(synthesis(8, "grudge_detection", "G061", L, tick=5380, people=_g061_people, relations=[],
              events=_g061_a, situation=_g061_situation, schema="grudge_v1",
              must=[{"from": 2, "to": 1, "level": ["medium", "high"], "evidence_any": ["e2"]}],
              must_not=[{"from": 1, "to": 2, "level": ["medium", "high"]}],
              severe_conditions=_GEN + ["reversed_direction"],
              severe_patterns=[("reversed_direction", {"from": 1, "to": 2, "level": ["medium", "high"]})],
              contrast=_ca,
              note="Wren said it before the market crowd, Cyrus answered with silence, so the grudge runs from "
                   "Cyrus to Wren. The insulter has no grievance to hold, so a medium or high grudge the other way "
                   "reverses who was wronged."))
add(synthesis(9, "grudge_detection", "G061", L, tick=5380, people=_g061_people, relations=[],
              events=_g061_b, situation=_g061_situation, schema="grudge_v1",
              must=[{"from": 1, "to": 2, "level": ["medium", "high"], "evidence_any": ["e2"]}],
              must_not=[{"from": 2, "to": 1, "level": ["medium", "high"]}],
              severe_conditions=_GEN + ["reversed_direction"],
              severe_patterns=[("reversed_direction", {"from": 2, "to": 1, "level": ["medium", "high"]})],
              contrast=_cb,
              note="Here Cyrus is the one who spoke and Wren kept quiet, so the grudge runs from Wren to Cyrus. "
                   "Orson trades with both and is not part of it; treating the insulter as the wronged party "
                   "reverses the event's actors."))

# G062: the same insult, fifty days old in one card and twenty-two years old in the other.
_alma = person(1, "Ophelia Sterling", 63, "female", wealth=3600, temper=1)
_boyd = person(2, "Monroe Rowland", 66, "male", wealth=6100, pride=2)
_russ = person(3, "Russ Whitlock", 57, "male", wealth=2800, warmth=2)

_g062_people = [_alma, _boyd, _russ]
def _g062_situation(elapsed):
    return (
        "At the Grange picnic Monroe told the crowd that Ophelia's bees had poisoned his well. Ophelia shouted at him in "
        f"front of everyone. That was {elapsed} ago. Monroe has never taken the words back. Russ, a neighbour, does "
        "heavy work for both of them and takes no sides."
    )


def _g062_events(t):
    return [
        ev("e1", t, "insult", [2, 1], magnitude=70, tags=["public"]),
        ev("e2", t, "quarrel", [1, 2], magnitude=55, caused_by=["e1"], tags=["public"]),
        ev("e3", 10560, "help", [3, 1], magnitude=30),
        ev("e4", 10570, "help", [3, 2], magnitude=30),
    ]


_ca, _cb = pair("P028", "Monroe's insult and Ophelia's answer fall about fifty days before the log ends in card a and twenty-two years before it in card b",
                {"include": [{"from": 1, "to": 2, "level": ["medium", "high"]}], "exclude": []},
                {"include": [], "exclude": [{"from": 1, "to": 2, "level": ["medium", "high"]}]})
add(synthesis(10, "grudge_detection", "G062", L, tick=10600, people=_g062_people, relations=[],
              events=_g062_events(10550), situation=_g062_situation("seven weeks"), schema="grudge_v1",
              must=[{"from": 1, "to": 2, "level": ["medium", "high"], "evidence_any": ["e1"]}],
              must_not=[{"from": 1, "to": 3}, {"from": 2, "to": 3}],
              severe_conditions=_GEN + ["contradicts_fact"],
              severe_patterns=[("contradicts_fact", {"from": 1, "to": 3, "level": ["medium", "high"]})],
              contrast=_ca,
              note="Fresh, public and unretracted, this is a live grudge: a poisoning rumour about her bees is worth "
                   "medium at least. Russ works for both households and takes no sides, so a grudge through "
                   "him contradicts the log. With the dispute seven weeks old, calling it ancient and spent reads "
                   "the ticks wrongly."))
add(synthesis(11, "grudge_detection", "G062", L, tick=10600, people=_g062_people, relations=[],
              events=_g062_events(2500), situation=_g062_situation("twenty-two years"), schema="grudge_v1",
              must=[],
              must_not=[{"from": 1, "to": 2, "level": ["medium", "high"]}, {"from": 1, "to": 3}, {"from": 2, "to": 3}],
              severe_conditions=_GEN + ["contradicts_fact"],
              severe_patterns=[("contradicts_fact", {"from": 1, "to": 3, "level": ["medium", "high"]})],
              contrast=_cb,
              note="Twenty-two years on, with both households now taking Russ's help, a spent or mild "
                   "resentment is expected; medium or high keeps a quarrel alive that two decades of shared work "
                   "have worn down."))

# G063: a slander of a dead husband, unretracted, two years after the slanderer's death.
_imogen = person(1, "Imogen Merritt", 58, "female", wealth=1800, warmth=1)
_seth = person(2, "Seth Brennan", 67, "male", alive=False, pride=2, piety=1)
_cora = person(3, "Augusta Brennan", 34, "female", wealth=1300, piety=2, warmth=1)

_g063_people = [_imogen, _seth, _cora]
_g063_events = [
    ev("e1", 14100, "insult", [2, 1], magnitude=85, tags=["public"]),
    ev("e2", 14100, "quarrel", [1, 2], magnitude=60, caused_by=["e1"], tags=["public"]),
    ev("e3", 14200, "help", [3, 1], magnitude=40),
    ev("e4", 14300, "death", [2]),
    ev("e5", 14320, "offering", [3, 2], magnitude=20, caused_by=["e4"], tags=["joss_paper"]),
    ev("e6", 14340, "dream", [2, 3]),
]
add(synthesis(12, "grudge_detection", "G063", L, tick=15100, people=_g063_people, relations=[],
              events=_g063_events,
              situation=("At the Grange hall Seth said Imogen's late husband had cheated the church fund, and Imogen "
                         "shouted at him there. He never took it back. Augusta, Seth's daughter, has helped Imogen with "
                         "the church linens since. Seth died about seven months later, and more than two years have "
                         "passed since his death."),
              schema="grudge_v1",
              must=[{"from": 1, "to": 2, "evidence_any": ["e1", "e2"]}],
              must_not=[{"from": 3, "to": 1}, {"from": 1, "to": 3}],
              severe_conditions=_GEN + ["contradicts_fact"],
              severe_patterns=[("contradicts_fact", {"from": 3, "to": 1, "level": ["medium", "high"]})],
              note="The accusation was public, never withdrawn, and aimed at her dead husband, so Imogen still "
                   "carries it against Seth even though he is dead and cannot answer. Augusta took Imogen's side "
                   "throughout; a grudge between those two contradicts the log."))

# G064: an apology that is withdrawn at the next fair.
_josiah = person(1, "Virgil Alder", 55, "male", wealth=7400, pride=2, temper=2)
_tamsin = person(2, "Tamsin Lockwood", 41, "female", wealth=1600, warmth=1)
_ellis = person(3, "Ellis Lockwood", 44, "male", wealth=2100, temper=2, loyalty=2)

_g064_people = [_josiah, _tamsin, _ellis]
_g064_events = [
    ev("e1", 16200, "insult", [1, 2], magnitude=90, tags=["public"]),
    ev("e2", 16200, "quarrel", [3, 1], magnitude=70, caused_by=["e1"], tags=["public"]),
    ev("e3", 16214, "apology", [1, 2], magnitude=55, caused_by=["e1"], tags=["private"]),
    ev("e4", 16310, "insult", [1, 2], magnitude=60, caused_by=["e1"], tags=["witnessed"]),
    ev("e5", 16330, "deal", [1, 3], magnitude=140, tags=["cash"]),
]
add(synthesis(13, "grudge_detection", "G064", L, tick=16350, people=_g064_people, relations=[],
              events=_g064_events,
              situation=("At the harvest fair Virgil told the crowd that a mother had died in childbirth under Tamsin's care and "
                         "should not be trusted with births. Three families dismissed her. Two weeks later he "
                         "apologised at her door and asked her to tell no one. At the next fair he told the same "
                         "story again. Ellis, Tamsin's husband, confronted him in the street that first evening."),
              schema="grudge_v1",
              must=[{"from": 2, "to": 1, "level": ["medium", "high"], "evidence_any": ["e1", "e4"]}],
              must_not=[{"from": 2, "to": 3}],
              severe_conditions=_GEN + ["reversed_direction", "contradicts_fact"],
              severe_patterns=[("reversed_direction", {"from": 1, "to": 2, "level": "high"}),
                               ("contradicts_fact", {"from": 2, "to": 3, "level": ["medium", "high"]})],
              note="The apology was made in secret and then undone by the same story at the next fair, so the "
                   "grievance stands at medium or more. Virgil is the one who spoke both times; a high grudge from "
                   "him against Tamsin would invert the log. Nothing in it sets Tamsin against her husband."))

# ---------------------------------------------------------------- debt_chain

# G065: two partial payments on one note. Variable: the size of the second payment.
_wilbur = person(1, "Wilbur Corbin", 63, "male", wealth=12000, greed=2)
_abel = person(2, "Arlo Dorsey", 38, "male", wealth=600, loyalty=1)
_faye = person(3, "Thelma Dorsey", 34, "female", wealth=800, warmth=1)

_g065_people = [_wilbur, _abel, _faye]
_g065_situation = (
    "Wilbur lent Arlo $1,500 against a written note due in the spring. Arlo has paid part of it twice. Thelma, "
    "Arlo's wife, keeps her own money from the store and has no part in the note. The note is overdue and Wilbur "
    "has said nothing about it."
)


def _g065_events(second):
    return [
        ev("e1", 8000, "loan", [1, 2], magnitude=1500, tags=["written", "cash"], due=8365),
        ev("e2", 8300, "repayment", [2, 1], magnitude=400, caused_by=["e1"], tags=["partial", "cash"]),
        ev("e3", 8300, "help", [3, 1], magnitude=20),
        ev("e4", 8400, "repayment", [2, 1], magnitude=second, caused_by=["e1"], tags=["partial", "cash"]),
        ev("e5", 8430, "deal", [1, 3], magnitude=90, tags=["cash"]),
    ]


_ca, _cb = pair("P029", "Arlo's second payment is $300 in card a and $500 in card b (the note is $1,500, the first payment $400)",
                {"include": [{"debtor": 2, "creditor": 1, "amount": 800, "status": "open"}], "exclude": []},
                {"include": [{"debtor": 2, "creditor": 1, "amount": 600, "status": "open"}], "exclude": []})
add(synthesis(4, "debt_chain", "G065", L, tick=8500, people=_g065_people, relations=[],
              events=_g065_events(300), situation=_g065_situation, schema="debt_chain_v1",
              must=[{"debtor": 2, "creditor": 1, "status": "open", "amount": 800, "origin_event": "e1",
                     "evidence_any": ["e4"]}],
              must_not=[{"debtor": 3}, {"debtor": 1}],
              severe_conditions=_GEN + ["wrong_debt_holder", "reversed_direction"],
              severe_patterns=[("wrong_debt_holder", {"debtor": 3}),
                               ("reversed_direction", {"debtor": 1, "creditor": 2})],
              contrast=_ca,
              note="$1,500 less $400 and $300 leaves $800 open and overdue. Thelma has no part in the note, so an "
                   "obligation in her name invents a debtor. Listing Wilbur as the debtor swaps the two ends of "
                   "the loan."))
add(synthesis(5, "debt_chain", "G065", L, tick=8500, people=_g065_people, relations=[],
              events=_g065_events(500), situation=_g065_situation, schema="debt_chain_v1",
              must=[{"debtor": 2, "creditor": 1, "status": "open", "amount": 600, "origin_event": "e1",
                     "evidence_any": ["e4"]}],
              must_not=[{"debtor": 3}, {"debtor": 1}],
              severe_conditions=_GEN + ["wrong_debt_holder", "reversed_direction"],
              severe_patterns=[("wrong_debt_holder", {"debtor": 3}),
                               ("reversed_direction", {"debtor": 1, "creditor": 2})],
              contrast=_cb,
              note="The same note with a $500 second payment leaves $600 outstanding. The arithmetic has to follow "
                   "both partial payments; Thelma is not a party and the lender is not the debtor."))

# G066: the lender dies. Variable: her death (the claim passes to her heir).
_mabel = person(1, "Rosalind Forsyth", 71, "female", wealth=9400, greed=1)
_emil = person(2, "Emil Granger", 45, "male", wealth=700)
_rufus = person(3, "Kermit Forsyth", 44, "male", wealth=2600, warmth=1)

_g066_people_a = [_mabel, _emil, _rufus]
_g066_people_b = [person(1, "Rosalind Forsyth", 71, "female", alive=False, wealth=9400, greed=1), _emil, _rufus]
_g066_base = [
    ev("e1", 11100, "loan", [1, 2], magnitude=900, tags=["written"], due=11400),
    ev("e2", 11200, "repayment", [2, 1], magnitude=200, caused_by=["e1"], tags=["partial", "cash"]),
    ev("e3", 11250, "deal", [3, 2], magnitude=120, tags=["cash"]),
    ev("e4", 11250, "help", [3, 1], magnitude=15),
]
_g066_situation = (
    "Rosalind lends money against written notes. Emil borrowed from her on a note that fell due this spring. Kermit, her only "
    "son, lives in her house and has kept her books for years. Under town rules a lender's claim passes with the "
    "estate to the heir."
)
_ca, _cb = pair("P030", "Rosalind dies before the log ends in card b and Kermit inherits her estate; in card a she is alive and still holds the note",
                {"include": [{"debtor": 2, "creditor": 1, "status": "open"}],
                 "exclude": [{"debtor": 2, "creditor": 3, "status": "open"}]},
                {"include": [{"debtor": 2, "creditor": 3, "status": "open"}],
                 "exclude": [{"debtor": 2, "creditor": 1, "status": "open"}]})
add(synthesis(6, "debt_chain", "G066", L, tick=11400, people=_g066_people_a, relations=[],
              events=_g066_base, situation=_g066_situation, schema="debt_chain_v1",
              must=[{"debtor": 2, "creditor": 1, "status": "open", "amount": 700, "origin_event": "e1"}],
              must_not=[{"debtor": 3}, {"debtor": 2, "creditor": 3}, {"debtor": 2, "status": "repaid"}],
              severe_conditions=_GEN + ["wrong_debt_holder", "contradicts_fact"],
              severe_patterns=[("wrong_debt_holder", {"debtor": 3}),
                               ("contradicts_fact", {"debtor": 2, "status": "repaid"})],
              contrast=_ca,
              note="$900 less $200 leaves $700 open to Rosalind, who is alive and still holds the note. Kermit keeps the "
                   "books but owes nothing himself. Calling the balance repaid contradicts the two repayment events."))
add(synthesis(7, "debt_chain", "G066", L, tick=11400, people=_g066_people_b, relations=[],
              events=_g066_base + [
                  ev("e5", 11300, "death", [1]),
                  ev("e6", 11300, "inheritance", [1, 3], magnitude=9400, caused_by=["e5"], tags=["house", "cash"])],
              situation=_g066_situation, schema="debt_chain_v1",
              must=[{"debtor": 2, "creditor": 3, "status": "open", "amount": 700, "origin_event": "e1"}],
              must_not=[{"debtor": 2, "creditor": 1, "status": "open"}, {"debtor": 3}],
              severe_conditions=_GEN + ["wrong_debt_holder", "contradicts_fact"],
              severe_patterns=[("wrong_debt_holder", {"debtor": 3}),
                               ("contradicts_fact", {"debtor": 2, "status": "repaid"})],
              contrast=_cb,
              note="Rosalind's death does not cancel the balance: the claim travels with her estate to Kermit, so the "
                   "same $700 is now owed to him. Keeping Rosalind as the creditor, or turning the heir into the "
                   "debtor, misreads the transfer."))

# G067: which child is the sole heir. Variable: the heir's identity.
_eunice = person(1, "Eunice Harlan", 66, "female", wealth=15000, greed=1)
_gideon = person(2, "Orrin Iverson", 70, "male", alive=False)
_loretta = person(3, "Imogene Iverson", 35, "female", wealth=1200)
_ward = person(4, "Rupert Iverson", 39, "male", wealth=1500)
_marian = person(5, "Marian Jessup", 40, "female", wealth=1900, warmth=1)

_g067_people = [_eunice, _gideon, _loretta, _ward, _marian]
_g067_situation = (
    "Orrin borrowed $2,500 against his acreage and repaid part of it before he died last winter. Imogene is his "
    "daughter, Rupert his son; his will names one of them sole heir and leaves the other nothing. Eunice holds the "
    "note. Under town rules an heir takes the dead person's debts with the estate."
)


def _g067_events(heir):
    return [
        ev("e1", 18100, "loan", [1, 2], magnitude=2500, tags=["written", "land"], due=18500),
        ev("e2", 18300, "repayment", [2, 1], magnitude=500, caused_by=["e1"], tags=["partial", "cash"]),
        ev("e3", 18400, "death", [2]),
        ev("e4", 18400, "inheritance", [2, heir], magnitude=4000, caused_by=["e3"], tags=["land", "house"]),
        ev("e5", 18400, "debt_transfer", [2, heir], magnitude=2000, caused_by=["e1", "e4"]),
        ev("e6", 18480, "help", [5, 1], magnitude=20),
    ]


_ca, _cb = pair("P031", "Orrin's sole heir is his daughter Imogene in card a and his son Rupert in card b",
                {"include": [{"debtor": 3, "status": "open"}], "exclude": [{"debtor": 4}]},
                {"include": [{"debtor": 4, "status": "open"}], "exclude": [{"debtor": 3}]})
add(synthesis(8, "debt_chain", "G067", L, tick=18550, people=_g067_people, relations=[],
              events=_g067_events(3), situation=_g067_situation, schema="debt_chain_v1",
              must=[{"debtor": 3, "creditor": 1, "status": "open", "amount": 2000, "origin_event": "e1",
                     "transferred_from": 2, "evidence_any": ["e5"]}],
              must_not=[{"debtor": 4}, {"debtor": 2, "status": "open"}],
              severe_conditions=_GEN + ["wrong_debt_holder", "contradicts_fact"],
              severe_patterns=[("wrong_debt_holder", {"debtor": 4}),
                               ("contradicts_fact", {"debtor": 2, "status": "open"})],
              contrast=_ca,
              note="$2,500 less $500 leaves $2,000, and the transfer event hands it to Imogene, the sole heir, so "
                   "she owes it now. Rupert inherited nothing and is the wrong holder; leaving the obligation open in "
                   "Orrin's name ignores that he died."))
add(synthesis(9, "debt_chain", "G067", L, tick=18550, people=_g067_people, relations=[],
              events=_g067_events(4), situation=_g067_situation, schema="debt_chain_v1",
              must=[{"debtor": 4, "creditor": 1, "status": "open", "amount": 2000, "origin_event": "e1",
                     "transferred_from": 2, "evidence_any": ["e5"]}],
              must_not=[{"debtor": 3}, {"debtor": 2, "status": "open"}],
              severe_conditions=_GEN + ["wrong_debt_holder", "contradicts_fact"],
              severe_patterns=[("wrong_debt_holder", {"debtor": 3}),
                               ("contradicts_fact", {"debtor": 2, "status": "open"})],
              contrast=_cb,
              note="The will and the transfer name Rupert here, so the $2,000 moves to him and Imogene owes nothing. "
                   "Reading the heir from the wrong sibling is how this pair separates."))

# G068: a two-step chain, repaid through on the same day.
_prudence = person(1, "Prudence Kincaid", 57, "female", wealth=6800, loyalty=1)
_hollis = person(2, "Hollis Jessup", 48, "male", wealth=1100)
_tessa = person(3, "Tessa Langley", 26, "female", wealth=400, loyalty=2)

_g068_people = [_prudence, _hollis, _tessa]
_g068_events = [
    ev("e1", 6000, "loan", [1, 2], magnitude=800, tags=["verbal", "cash"], due=6300),
    ev("e2", 6007, "loan", [2, 3], magnitude=300, tags=["verbal", "cash"], due=6250),
    ev("e3", 6240, "repayment", [3, 2], magnitude=300, caused_by=["e2"], tags=["cash"]),
    ev("e4", 6240, "repayment", [2, 1], magnitude=300, caused_by=["e1", "e3"], tags=["partial", "cash"]),
    ev("e5", 6270, "repayment", [2, 1], magnitude=200, caused_by=["e1"], tags=["partial", "cash"]),
    ev("e6", 6290, "deal", [1, 3], magnitude=120, tags=["cash"]),
]
_g068_situation = (
    "Prudence lent Hollis $800 on a verbal promise. A week later Hollis lent Tessa $300 of it, also on a verbal "
    "promise. Tessa paid him back in full before it fell due, and Hollis passed that money straight to Prudence the "
    "same day. He paid her $200 more a month later. All three live on the same street."
)
add(synthesis(10, "debt_chain", "G068", L, tick=6320, people=_g068_people, relations=[],
              events=_g068_events, situation=_g068_situation, schema="debt_chain_v1",
              must=[{"debtor": 2, "creditor": 1, "status": "open", "amount": 300, "origin_event": "e1"}],
              must_not=[{"debtor": 3, "creditor": 1}],
              severe_conditions=_GEN + ["wrong_debt_holder", "contradicts_fact"],
              severe_patterns=[("wrong_debt_holder", {"debtor": 3, "creditor": 1}),
                               ("contradicts_fact", {"debtor": 2, "status": "repaid"})],
              note="Hollis borrowed $800 and has passed on $300 and $200, so he still owes Prudence $300. Tessa's "
                   "loan ran from him, not from Prudence, and making her Prudence's debtor invents a debt."))
add(synthesis(11, "debt_chain", "G068", L, tick=6320, people=_g068_people, relations=[],
              events=_g068_events, situation=_g068_situation, schema="debt_chain_v1",
              must=[{"debtor": 3, "creditor": 2, "status": "repaid", "origin_event": "e2", "evidence_any": ["e3"]}],
              must_not=[{"debtor": 3, "creditor": 1}, {"debtor": 3, "status": "open"}],
              severe_conditions=_GEN + ["wrong_debt_holder", "contradicts_fact"],
              severe_patterns=[("wrong_debt_holder", {"debtor": 3, "creditor": 1}),
                               ("contradicts_fact", {"debtor": 3, "status": "open"})],
              note="Tessa's $300 went back to Hollis in full before the due day, so her obligation is closed and "
                   "she owes Prudence nothing. Carrying it as open, or handing it to Prudence, contradicts the "
                   "repayment the same tick."))

# G069: a debt denied in the street, and a brother who never borrowed.
_barnett = person(1, "Barnett Emmett", 60, "male", wealth=8800, greed=1, pride=2)
_opal = person(2, "Etta Corbin", 41, "female", wealth=500, pride=2, temper=1)
_merle = person(3, "Jethro Jessup", 49, "male", wealth=1700, warmth=1)

_g069_people = [_barnett, _opal, _merle]
_g069_events = [
    ev("e1", 13000, "loan", [1, 2], magnitude=700, tags=["written", "cash"], due=13300),
    ev("e2", 13200, "help", [3, 2], magnitude=40),
    ev("e3", 13360, "quarrel", [1, 2], magnitude=55, caused_by=["e1"], tags=["public"]),
    ev("e4", 13360, "insult", [2, 1], magnitude=50, caused_by=["e3"], tags=["public"]),
    ev("e5", 13380, "deal", [1, 3], magnitude=200, tags=["cash"]),
]
add(synthesis(12, "debt_chain", "G069", L, tick=13400, people=_g069_people, relations=[],
              events=_g069_events,
              situation=("Barnett lent Etta $700 in cash and wrote it in his ledger with the day it was due. When he "
                         "asked for it in the street she said the money had been a gift and called him a cheat in "
                         "front of the store. Jethro, Etta's brother, has never borrowed from Barnett; he buys feed "
                         "from him and pays as he goes."),
              schema="debt_chain_v1",
              must=[{"debtor": 2, "creditor": 1, "status": "open", "amount": 700, "origin_event": "e1",
                     "evidence_any": ["e1"]}],
              must_not=[{"debtor": 3}, {"debtor": 2, "status": "repaid"}, {"debtor": 2, "status": "forgiven"}],
              severe_conditions=_GEN + ["wrong_debt_holder", "contradicts_fact"],
              severe_patterns=[("wrong_debt_holder", {"debtor": 3}),
                               ("contradicts_fact", {"debtor": 2, "status": "repaid"})],
              note="A recorded loan with no repayment and no forgiveness stays open for the full $700, whatever Etta "
                   "says in the street. Jethro buys feed for cash and has never borrowed, so a debt in his name is "
                   "invented."))

# G070: a written debt wiped before the lender's illness ran its course.
_selma = person(1, "Jessamine Dorsey", 69, "female", wealth=7200, warmth=1)
_jonas = person(2, "Jonas Harlan", 37, "male", wealth=900)
_wilmer = person(3, "Wilmer Dorsey", 44, "male", wealth=300)

_g070_people = [_selma, _jonas, _wilmer]
_g070_events = [
    ev("e1", 20000, "loan", [1, 2], magnitude=1200, tags=["written"], due=20400),
    ev("e2", 20200, "repayment", [2, 1], magnitude=200, caused_by=["e1"], tags=["partial", "cash"]),
    ev("e3", 20250, "illness", [1]),
    ev("e4", 20300, "debt_forgiven", [1, 2], magnitude=1000, caused_by=["e3"], tags=["written"]),
    ev("e5", 20300, "help", [3, 1], magnitude=30),
]
add(synthesis(13, "debt_chain", "G070", L, tick=20350, people=_g070_people, relations=[],
              events=_g070_events,
              situation=("Jessamine lent Jonas $1,200 against a written note. He paid $200 of it before she fell ill in "
                         "the spring. In the summer she wrote to him that the rest was off and he need not pay "
                         "another cent. Wilmer, her nephew, keeps house for her but has no share in her money."),
              schema="debt_chain_v1",
              must=[{"debtor": 2, "creditor": 1, "status": "forgiven", "origin_event": "e1", "evidence_any": ["e4"]}],
              must_not=[{"debtor": 2, "status": "open"}, {"debtor": 3}],
              severe_conditions=_GEN + ["wrong_debt_holder"],
              severe_patterns=[("wrong_debt_holder", {"debtor": 3})],
              note="Jessamine's written release wiped the $1,000 that was left, so the obligation closes as forgiven and "
                   "nothing is open. Wilmer keeps the house but has no share in her money and owes nothing."))