"""Locked decision cards, writer db: reconcile_or_revenge and debt_repayment.

Both families are closed-set decision cards. A scenario group keeps its own cast and log; the
three reconcile pairs and the two debt pairs each change one named fact and nothing else.
"""

from cardlib import decision, ev, pair, person, rel, synthesis

L = "locked"
CARDS = []
add = CARDS.append

# ---------------------------------------------------------------- reconcile_or_revenge

# G035: a public humiliation at the church supper, four years on, and a reference to sign.
# Variable: the subject's temper.
_delia = dict(id=1, name="Delia Pruitt", age=58, sex="female", wealth=4200, pride=2, warmth=1, loyalty=1)
_wanda = person(2, "Wanda Sawyer", 44, "female", wealth=900, pride=1, warmth=0)
_denton = person(3, "Denton Sawyer", 47, "male", wealth=900, warmth=0, loyalty=1)
_g035_rels = [rel(1, 2, -45, -55, ["neighbor"]), rel(2, 3, 70, 80, ["spouse"]), rel(3, 2, 65, 75, ["spouse"])]
_g035_events = [
    ev("e1", 13100, "insult", [2, 1], magnitude=70, tags=["public", "witnessed"]),
    ev("e2", 13140, "quarrel", [1, 2], magnitude=60, caused_by=["e1"]),
]
_g035_situation = (
    "Four years ago at the church supper Wanda Sawyer read aloud a letter Delia Pruitt had written at nineteen, "
    "and Delia's engagement ended that winter. Wanda laughed, and she has never apologized. Delia has run the "
    "dry-goods store since. Wanda's husband Denton has been ill since spring, and this morning Wanda brings in a "
    "character reference for a school job and asks Delia to sign it."
)
_g035_options = [
    ("sign_reference", "Sign the reference and hand it back without comment."),
    ("refuse_quietly", "Set the form aside and say she cannot sign it."),
    ("refuse_loudly", "Refuse in front of the counter queue and retell the letter story."),
    ("buy_medicine", "Refuse, then buy the druggist's whole stock of her husband's medicine."),
]
_ca, _cb = pair("P017", "Delia's temper is +3 in card a and -3 in card b; every other trait, relation and event is identical",
                ["refuse_loudly"], ["refuse_quietly", "sign_reference"])
add(decision(4, "reconcile_or_revenge", "G035", L, tick=14560, subject=1,
             people=[person(**_delia, temper=3), _wanda, _denton],
             relations=_g035_rels, events=_g035_events, situation=_g035_situation,
             options=_g035_options, acceptable=["refuse_loudly"], severe=["buy_medicine"],
             contrast=_ca,
             note="Quick to anger and not a grudge-holder, Delia answers the request on the spot before the queue; "
                  "a flat quiet refusal or signing the form asks for a patience her temper does not have. Clearing "
                  "the shelf of a sick man's medicine to punish his wife is grotesque."))
add(decision(5, "reconcile_or_revenge", "G035", L, tick=14560, subject=1,
             people=[person(**_delia, temper=-3), _wanda, _denton],
             relations=_g035_rels, events=_g035_events, situation=_g035_situation,
             options=_g035_options, acceptable=["refuse_quietly", "sign_reference"], severe=["buy_medicine"],
             contrast=_cb,
             note="Slow to anger, Delia either declines without heat or signs the form and lets four years lie; "
                  "a scene before the customers belongs to a different temper. The medicine purchase is grotesque "
                  "for anyone here and does not depend on the temper."))

# G036: eleven-year-old money grievance and a right-of-way he needs. Variable: vindictiveness.
_cora = dict(id=1, name="Cora Tanner", age=61, sex="female", wealth=6000, pride=1, greed=1, loyalty=1)
_marcus = person(2, "Marcus Underwood", 52, "male", wealth=15000, greed=2, pride=1)
_g036_rels = [rel(1, 2, -70, -65, ["rival"]), rel(2, 1, -25, -20, ["rival"])]
_g036_events = [
    ev("e1", 7980, "theft", [2, 1], magnitude=4000, tags=["cash", "private"]),
    ev("e2", 8030, "lawsuit", [1, 2], magnitude=4000, caused_by=["e1"]),
]
_g036_situation = (
    "Eleven years ago Marcus Underwood sold a herd of cattle in partnership with Cora Tanner and kept Cora's "
    "$4,000 share. Cora sued him, lost on a missing receipt, and that winter her family sold their bottom pasture. "
    "Marcus now owns the mill and has bought the land on both sides of Cora's north field. He needs a right-of-way "
    "across it and offers $2,000. The other landowners along the road have not answered him yet."
)
_g036_options = [
    ("sell_easement", "Sign the right-of-way and take the $2,000."),
    ("sign_free", "Sign the right-of-way and take no money for it."),
    ("refuse_flat", "Refuse to sign at any price."),
    ("block_neighbors", "Refuse, and talk the other landowners into refusing too."),
    ("burn_mill", "Refuse, and set the mill alight in the night."),
]
_ca, _cb = pair("P018", "Cora's vindictiveness is +3 in card a and -3 in card b; every other trait, relation and event is identical",
                ["refuse_flat", "block_neighbors"], ["sell_easement", "sign_free"])
add(decision(6, "reconcile_or_revenge", "G036", L, tick=11995, subject=1,
             people=[person(**_cora, vindictiveness=3), _marcus],
             relations=_g036_rels, events=_g036_events, situation=_g036_situation,
             options=_g036_options, acceptable=["refuse_flat", "block_neighbors"], severe=["burn_mill"],
             contrast=_ca,
             note="With vindictiveness +3 an eleven-year grievance is still live, so Cora refuses the road and "
                  "organising the neighbours is the payback that fits her. Selling or gifting the right-of-way is "
                  "out of character. Burning the mill is absurd whatever she feels."))
add(decision(7, "reconcile_or_revenge", "G036", L, tick=11995, subject=1,
             people=[person(**_cora, vindictiveness=-3), _marcus],
             relations=_g036_rels, events=_g036_events, situation=_g036_situation,
             options=_g036_options, acceptable=["sell_easement", "sign_free"], severe=["burn_mill"],
             contrast=_cb,
             note="Someone who forgives easily takes the money and lets the old lawsuit go, or signs for nothing to "
                  "be done with Marcus. Holding the road hostage is out of character for that temperament. Arson is "
                  "absurd on any reading."))

# G037: a jilting twelve years ago and the jilter's son asking for work.
# Variable: whether the public apology in the log ever happened.
_abel = person(1, "Xavier Whitaker", 46, "male", wealth=5200, pride=2, loyalty=1, vindictiveness=1)
_margery = person(2, "Margery Vance", 43, "female", wealth=700, warmth=1, pride=1)
_clifford = person(3, "Clifford Vance", 16, "male", wealth=0, warmth=1)
_g037_rels = [rel(1, 2, -55, -50, []), rel(2, 1, 20, 30, ["former_suitor"]), rel(2, 3, 85, 80, ["child"])]
_g037_events_b = [
    ev("e1", 15800, "courtship", [1, 2], magnitude=70),
    ev("e2", 15950, "quarrel", [2, 1], magnitude=60, caused_by=["e1"]),
]
_g037_events_a = _g037_events_b + [
    ev("e3", 16895, "apology", [2, 1], magnitude=50, tags=["public", "witnessed"]),
]
_g037_situation_a = (
    "Twelve years ago Margery Vance broke her engagement to Xavier Whitaker eight days before the wedding and married "
    "the miller's son. Three years later, at the county fair, she apologized to him in front of the church crowd and "
    "he took her hand and accepted it. Xavier never married and has run the livery for twenty years. Margery is "
    "widowed and short of money, and this week her son Clifford, sixteen, asks Xavier for work at the livery."
)
_g037_situation_b = (
    "Twelve years ago Margery Vance broke her engagement to Xavier Whitaker eight days before the wedding and married "
    "the miller's son. She has never apologized for any of it. Xavier never married and has run the livery for twenty "
    "years. Margery is widowed and short of money, and this week her son Clifford, sixteen, asks Xavier for work "
    "at the livery."
)
_g037_options = [
    ("hire_boy", "Take Clifford on as an apprentice and say nothing about the past."),
    ("refuse_quietly", "Tell Clifford the livery has no room for another hand."),
    ("tell_boy_why", "Refuse, and tell Clifford why his mother is asking him to work for Xavier."),
    ("work_him_hard", "Take Clifford on and keep him hungry and unpaid until his mother begs."),
]
_ca, _cb = pair("P019", "Card a carries a public apology from Margery nine years ago (event e3), which Xavier "
                        "accepted before the crowd, and says so in the situation; in card b she never apologized "
                        "and the apology event is absent",
                ["hire_boy"], ["refuse_quietly", "tell_boy_why"])
add(decision(8, "reconcile_or_revenge", "G037", L, tick=20180, subject=1,
             people=[_abel, _margery, _clifford],
             relations=_g037_rels, events=_g037_events_a, situation=_g037_situation_a,
             options=_g037_options, acceptable=["hire_boy"], severe=["work_him_hard"],
             contrast=_ca,
             note="The apology was made in public and Xavier accepted it before the whole church, so the account "
                  "between them is closed on both sides; when her sixteen-year-old asks for work the in-character "
                  "answer is to take him on, and a refusal would go back on his own public acceptance. Working him "
                  "hungry is exploitation of a child."))
add(decision(9, "reconcile_or_revenge", "G037", L, tick=20180, subject=1,
             people=[_abel, _margery, _clifford],
             relations=_g037_rels, events=_g037_events_b, situation=_g037_situation_b,
             options=_g037_options, acceptable=["refuse_quietly", "tell_boy_why"], severe=["work_him_hard"],
             contrast=_cb,
             note="With no apology in twelve years Xavier refuses, either with a short excuse or by telling the boy "
                  "plainly what his mother did. Hiring him asks for a forgiveness Xavier has no reason to give. The "
                  "hungry-unpaid scheme is deliberate mistreatment of a sixteen-year-old, which is severe on any "
                  "reading of the grudge."))

# G038: an inherited feud over the mill creek. Two decision points on one cast and one log.
_harlan = person(1, "Harlan Ramsey", 55, "male", wealth=9000, pride=3, loyalty=1, vindictiveness=1)
_dorothy = person(2, "Dorothy Thorne", 58, "female", wealth=8000, pride=2, vindictiveness=2)
_whit = person(3, "Whit Ramsey", 27, "male", wealth=500, loyalty=2)
_josiah = person(4, "Ulysses Thorne", 30, "male", wealth=600, loyalty=2)
_amos_r = person(5, "Emory Ramsey", 82, "male", alive=False, pride=2)
_enoch = person(6, "Enoch Thorne", 85, "male", alive=False, vindictiveness=2)
_g038_people = [_harlan, _dorothy, _whit, _josiah, _amos_r, _enoch]
_g038_rels = [
    rel(1, 5, 60, 70, ["parent"]), rel(2, 6, 55, 65, ["parent"]),
    rel(1, 3, 80, 70, ["child"]), rel(2, 4, 80, 70, ["child"]),
    rel(1, 2, -70, -70, ["rival"]), rel(5, 6, -80, -80, ["rival"]), rel(3, 4, -25, -25, ["rival"]),
]
_g038_events = [
    ev("e1", 10980, "quarrel", [5, 6], magnitude=60, tags=["land"]),
    ev("e2", 11010, "lawsuit", [5, 6], magnitude=3000, caused_by=["e1"], tags=["land"]),
    ev("e3", 17200, "death", [5]),
    ev("e4", 20140, "death", [6]),
    ev("e5", 24460, "quarrel", [3, 4], magnitude=50, tags=["public"]),
]
_g038_situation_lane = (
    "Spring flooding has washed out the Thorne lane, and no wagon reaches their hay ground for three weeks. The "
    "only dragline in the valley is Harlan Ramsey's. The creek quarrel began with the grandfathers over a strip of "
    "ground along the mill creek; Harlan's father Emory and Dorothy's father Enoch sued each other thirty-seven years "
    "ago, and the families have not traded since. At the town meeting Ulysses Thorne asks Harlan what he would charge "
    "to clear the lane."
)
_g038_options_lane = [
    ("clear_free", "Send the dragline and two hands to clear the lane for nothing."),
    ("quote_price", "Name a price of $600 and clear the lane."),
    ("ask_creek_strip", "Clear the lane in exchange for the creek strip."),
    ("drown_meadow", "Open his ditch gate so the water stays on the Thorne meadow."),
]
add(decision(10, "reconcile_or_revenge", "G038", L, tick=24500, subject=1,
             people=_g038_people, relations=_g038_rels, events=_g038_events,
             situation=_g038_situation_lane,
             options=_g038_options_lane, acceptable=["quote_price", "ask_creek_strip"], severe=["drown_meadow"],
             note="Proud and still loyal to his own side, Harlan charges for the work, and pressing the old creek "
                  "claim while the Thornes are desperate is exactly the selfish move in character. Working for "
                  "nothing hands the family that sued his father a victory. Holding water on their meadow is "
                  "malicious beyond the quarrel."))
_g038_situation_board = (
    "The county is naming one man to the ditch board that sets the creek levels. Harlan Ramsey's son Whit is "
    "nominated, and so is Dorothy Thorne's son Ulysses; each family has five votes among the neighbours and the vote "
    "is tonight. The quarrel over the creek strip began with the grandfathers, and Dorothy's father Enoch and "
    "Harlan's father Emory sued each other thirty-seven years ago."
)
_g038_options_board = [
    ("back_whit", "Withdraw Ulysses and put the Thorne votes behind Whit."),
    ("contest_seat", "Keep Ulysses in the race and work the room for every vote."),
]
add(decision(11, "reconcile_or_revenge", "G038", L, tick=24500, subject=2,
             people=_g038_people, relations=_g038_rels, events=_g038_events,
             situation=_g038_situation_board,
             options=_g038_options_board, acceptable=["contest_seat"], severe=[],
             note="With vindictiveness +2 and the old suit still in her mouth, Dorothy keeps her son in the race and "
                  "works the room for every vote; withdrawing him in favour of the Ramsey candidate is a "
                  "reconciliation nothing on the card asks her for, so it is out of character but not absurd."))

# G039: an unpaid brother who died and now stands in his dreams.
_warren = person(1, "Warren Walsh", 62, "male", wealth=4500, pride=1, piety=0, vindictiveness=1, loyalty=1)
_jasper = person(2, "Jasper Walsh", 58, "male", alive=False, greed=1)
_lenore = person(3, "Lenore Walsh", 55, "female", wealth=1200, warmth=1, loyalty=1)
_g039_rels = [rel(1, 2, -60, -60, ["sibling"]), rel(1, 3, 0, 10, ["in_law"]), rel(3, 2, 70, 80, ["spouse"])]
_g039_events = [
    ev("e1", 20160, "theft", [2, 1], magnitude=3000, tags=["land", "private"]),
    ev("e2", 24185, "death", [2]),
    ev("e3", 24195, "inheritance", [2, 3], magnitude=1200, caused_by=["e2"], tags=["cash"]),
    ev("e4", 24500, "haunting", [2, 1], magnitude=45),
    ev("e5", 24540, "dream", [2, 1], magnitude=30, caused_by=["e4"]),
]
_g039_situation = (
    "Twelve years ago Warren Walsh's brother Jasper sold the family woodlot and kept Warren's $3,000 share. Jasper "
    "died a year ago. Since the burial a lamp goes out in Warren's kitchen most nights, and Jasper stands at the "
    "foot of his bed in dreams. Jasper's widow Lenore inherited $1,200 and has said nothing about the money. "
    "Townsfolk hold that a ghost lingers over an open debt until the living forgive it and burn joss paper to send "
    "him on."
)
_g039_options = [
    ("burn_paper", "Forgive the $3,000 and burn joss paper to send Jasper on."),
    ("bill_widow", "Send Jasper on, but make Lenore pay for the joss paper out of her $1,200."),
    ("seal_ghost", "Petition the magistrate to seal Jasper's ghost out of the house."),
    ("open_grave", "Open the grave and sell the goods he was buried with."),
]
add(decision(12, "reconcile_or_revenge", "G039", L, tick=24550, subject=1,
             people=[_warren, _jasper, _lenore], relations=_g039_rels, events=_g039_events,
             situation=_g039_situation,
             options=_g039_options, acceptable=["burn_paper", "bill_widow", "seal_ghost"],
             severe=["open_grave"],
             note="Warren is owed $3,000 by a brother who never paid and now haunts him: forgiving the debt and "
                  "sending the ghost on as the town's custom says, sending him on at the widow's cost, and asking the "
                  "magistrate to seal the ghost are all believable for a man with a mild grudge and ordinary piety. "
                  "Selling grave goods is grotesque."))

# G040: the midwife and the woman who ruined her name.
_alma = person(1, "Minerva Yates", 57, "female", wealth=3400, pride=2, warmth=1, loyalty=2, vindictiveness=1)
_belle = person(2, "Belle Yates", 54, "female", wealth=900, pride=1, warmth=0)
_opal = person(3, "Opal Yates", 22, "female", wealth=0, warmth=1)
_g040_rels = [rel(1, 2, -50, -45, ["in_law"]), rel(1, 3, 30, 40, ["in_law"]), rel(2, 3, 75, 80, ["child"])]
_g040_events = [
    ev("e1", 22360, "insult", [2, 1], magnitude=80, tags=["public", "witnessed"]),
    ev("e2", 22380, "quarrel", [1, 2], magnitude=65, caused_by=["e1"]),
]
_g040_situation = (
    "Six years ago a newborn died three days after Minerva Yates, the town's midwife, delivered it, and Belle Yates, "
    "her sister-in-law, told half the town that Minerva's care killed the child. The county inquest cleared Minerva "
    "of any fault, but two families stopped calling her. Belle never took it back. Tonight Belle's daughter Opal is "
    "in labour, the doctor is twenty miles away and the creek bridge is out, and Belle is at Minerva's door asking "
    "her to come."
)
_g040_options = [
    ("go_now", "Take the bag and go to the house with Belle."),
    ("set_terms", "Go once Belle repeats the inquest finding before the neighbours."),
    ("delay_care", "Go, and let the labour run long before she helps."),
]
add(decision(13, "reconcile_or_revenge", "G040", L, tick=24550, subject=1,
             people=[_alma, _belle, _opal], relations=_g040_rels, events=_g040_events,
             situation=_g040_situation,
             options=_g040_options, acceptable=["go_now", "set_terms"], severe=["delay_care"],
             note="A birth with the bridge out comes before an old slander for a warm, loyal midwife, and so does "
                  "naming her price of a public retraction before she goes. Slowing a labour on purpose to punish "
                  "the mother would look monstrous on screen."))

# ---------------------------------------------------------------- debt_repayment

# G041: a mare bought on credit eight months ago. Variable: written note or spoken promise.
_royce = dict(id=1, name="Royce Bennett", age=44, sex="male", wealth=2400, greed=3, loyalty=-2, pride=1)
_della = person(2, "Elva Calloway", 66, "female", wealth=9000, greed=1, warmth=1)
_g041_rels = [rel(1, 2, 10, 20, ["neighbor"])]
_g041_events_a = [ev("e1", 19990, "loan", [2, 1], magnitude=1100, tags=["cash", "written"], due=20180)]
_g041_events_b = [ev("e1", 19990, "loan", [2, 1], magnitude=1100, tags=["cash", "verbal"])]
_g041_situation_a = (
    "Eight months ago Elva Calloway lent Royce Bennett $1,100 in cash to replace a mare that had died, so he could "
    "keep hauling. They signed a note at the store, the storekeeper witnessed it, and a copy sits with the town "
    "clerk. The note fell due six weeks ago. Royce has $2,400. This morning Elva asks him for the money at the "
    "feed store."
)
_g041_situation_b = (
    "Eight months ago Elva Calloway lent Royce Bennett $1,100 in cash to replace a mare that had died, so he could "
    "keep hauling. Nothing was written down, nobody else was present, and no day was fixed for repayment. Royce has "
    "$2,400. This morning Elva asks him for the money at the feed store."
)
_g041_options = [
    ("pay_full", "Pay her the $1,100 today."),
    ("pay_half", "Pay $550 today and promise the rest at the fair."),
    ("ask_time", "Ask her to wait for the spring hauling season."),
    ("call_gift", "Tell her the money was a gift, not a loan."),
]
_ca, _cb = pair("P020", "Card a: the loan is a signed, witnessed note on file with the town clerk, with a fixed due day. Card b: nothing written, no witness, no day fixed",
                ["pay_full", "pay_half"], ["ask_time", "call_gift"])
add(decision(4, "debt_repayment", "G041", L, tick=20225, subject=1,
             people=[person(**_royce), _della], relations=_g041_rels, events=_g041_events_a,
             situation=_g041_situation_a,
             options=_g041_options, acceptable=["pay_full", "pay_half"], severe=["call_gift"],
             contrast=_ca,
             note="A witnessed note on file at the clerk's office makes denial pointless, so a grasping but careful "
                  "man pays, in full or in part, and stalling on a dated note is out of character. Calling a signed "
                  "note a gift would look absurd on screen."))
add(decision(5, "debt_repayment", "G041", L, tick=20225, subject=1,
             people=[person(**_royce), _della], relations=_g041_rels, events=_g041_events_b,
             situation=_g041_situation_b,
             options=_g041_options, acceptable=["ask_time", "call_gift"], severe=[],
             contrast=_cb,
             note="With nothing in writing and no witness, a grasping, disloyal debtor asks for time or denies the "
                  "loan outright; paying the whole sum unpressed is out of character. Denial is shabby but not "
                  "absurd here, because the town holds no record either way."))

# G042: an old note and a lender who either needs the money or does not.
# Variable: the creditor's circumstances.
_wendell = person(1, "Wendell Draper", 51, "male", wealth=5200, greed=2, loyalty=1, warmth=0)
_myrtle = dict(id=2, name="Myrtle Elkins", age=63, sex="female", warmth=2)
_g042_rels = [rel(1, 2, 20, 30, ["neighbor"])]
_g042_events = [ev("e1", 19900, "loan", [2, 1], magnitude=800, tags=["cash", "written"], due=20080)]
_g042_situation_a = (
    "Just over two years ago Myrtle Elkins lent Wendell Draper $800 in cash against a signed note to buy a second "
    "wagon. The note fell due twenty months ago. Myrtle has been ill all winter, her savings are down to $150, and the "
    "druggist will not extend credit. Wendell has $5,200 and a paying hauling route. Myrtle comes to his yard and "
    "asks for the $800."
)
_g042_situation_b = (
    "Just over two years ago Myrtle Elkins lent Wendell Draper $800 in cash against a signed note to buy a second "
    "wagon. The note fell due twenty months ago. Myrtle is in good health, has $12,000 in the county bank and "
    "collects rent on two houses. Wendell has $5,200 and a paying hauling route. Myrtle comes to his yard and asks "
    "for the $800."
)
_g042_options = [
    ("pay_now", "Pay her the $800 today."),
    ("pay_part", "Pay $300 today and the rest next month."),
    ("hold_off", "Say the money is tied up and he will send it when he can."),
    ("forge_receipt", "Say he paid long ago and write her a receipt in his own hand."),
]
_ca, _cb = pair("P021", "Card a: Myrtle is ill, down to $150, and the druggist will not give credit. Card b: she is in good health with $12,000 in the bank and rent from two houses",
                ["pay_now"], ["pay_part", "hold_off"])
add(decision(6, "debt_repayment", "G042", L, tick=20700, subject=1,
             people=[_wendell, person(**_myrtle, wealth=150)],
             relations=_g042_rels, events=_g042_events, situation=_g042_situation_a,
             options=_g042_options, acceptable=["pay_now"], severe=["forge_receipt"],
             contrast=_ca,
             note="The lender is ill, nearly out of money, and the note is twenty months overdue, so a man with "
                  "$5,200 pays it in full; part-payment leaves her short of medicine. Writing a receipt himself is "
                  "forgery for the sake of $800 and would look absurd."))
add(decision(7, "debt_repayment", "G042", L, tick=20700, subject=1,
             people=[_wendell, person(**_myrtle, wealth=12000)],
             relations=_g042_rels, events=_g042_events, situation=_g042_situation_b,
             options=_g042_options, acceptable=["pay_part", "hold_off"], severe=["forge_receipt"],
             contrast=_cb,
             note="With the lender comfortable and nobody pressing, a man who counts every dollar pays part or puts "
                  "her off; handing over the whole $800 unpressed is out of character. The forged receipt is absurd "
                  "whatever the creditor's means."))

# G043: two brothers, one seed account. Variable across the pair of cards: what the debtor has.
_bram = person(1, "Bram Fairley", 38, "male", wealth=90, loyalty=2, pride=1, warmth=1)
_caleb = person(2, "Caleb Fairley", 41, "male", wealth=3000, loyalty=1, greed=1)
_eben = person(3, "Eben Gentry", 57, "male", wealth=14000, greed=2)
_g043_rels = [rel(1, 2, 60, 60, ["sibling"]), rel(2, 1, 55, 60, ["sibling"]),
              rel(1, 3, 10, 30, ["neighbor"]), rel(2, 3, 0, 20, ["neighbor"])]
_g043_events = [
    ev("e1", 19880, "loan", [3, 1], magnitude=600, tags=["cash", "verbal"], due=19960),
    ev("e2", 19880, "loan", [3, 2], magnitude=900, tags=["cash", "written"], due=19960),
]
_g043_situation_bram = (
    "Four months ago Eben Gentry sold Bram Fairley $600 of seed on credit, to be paid when the crop came in. The "
    "crop failed. Bram has $90, one milk cow, his tools, a wife and three children. Eben has $14,000 and has asked "
    "twice. Bram's brother Caleb farms the next place and has $3,000."
)
_g043_situation_caleb = (
    "Four months ago Eben Gentry sold Caleb Fairley $900 of seed on a signed note, to be paid when the crop came "
    "in. Caleb's crop came in well and he has $3,000. The note is six weeks past its day and Eben has asked twice. "
    "Caleb's brother Bram farms the next place, lost his crop, and still owes Eben $600."
)
add(decision(8, "debt_repayment", "G043", L, tick=20000, subject=1,
             people=[_bram, _caleb, _eben], relations=_g043_rels, events=_g043_events,
             situation=_g043_situation_bram,
             options=[("work_it_off", "Ask Eben to take the $600 out of farm work over the winter."),
                      ("sell_stock", "Sell his tools and the milk cow and pay Eben in full.")],
             acceptable=["work_it_off"], severe=[],
             note="With $90, a family and a failed crop, a loyal man offers farm work against the seed account, which "
                  "pays Eben and keeps the farm going. Selling the tools and the cow clears the debt and leaves him "
                  "unable to work the place, so it is out of character though not absurd."))
add(decision(9, "debt_repayment", "G043", L, tick=20000, subject=2,
             people=[_bram, _caleb, _eben], relations=_g043_rels, events=_g043_events,
             situation=_g043_situation_caleb,
             options=[("pay_full", "Pay Eben the $900 today."),
                      ("pay_part", "Pay $400 today and the rest after the spring ploughing."),
                      ("claim_draft", "Say the money is out on a draft and wait for it to clear."),
                      ("burn_note", "Get into Eben's desk at the store and burn the note.")],
             acceptable=["pay_full", "pay_part"], severe=["burn_note"],
             note="Caleb has the money, the crop came in, and the note is his own signature, so he pays in full or in "
                  "part. The draft story is out of character for a man with $3,000 in hand. Burning a note in the "
                  "creditor's desk is a crime with nothing to gain."))

# G044: four years past due, asked privately and then in front of the church supper.
_wade = person(1, "Wade Hollis", 47, "male", wealth=3100, greed=2, loyalty=-1, pride=2, warmth=0)
_fern = person(2, "Adele Jarvis", 59, "female", wealth=2600, greed=1, warmth=1, pride=1)
_ambrose = person(3, "Ambrose Jarvis", 32, "male", wealth=1200, loyalty=2)
_g044_rels = [rel(1, 2, -20, -40, ["neighbor"]), rel(2, 3, 75, 80, ["child"]), rel(1, 3, 0, -10, [])]
_g044_events = [
    ev("e1", 22675, "loan", [2, 1], magnitude=2500, tags=["cash", "written"], due=23040),
    ev("e2", 23770, "repayment", [1, 2], magnitude=200, tags=["partial", "cash"], caused_by=["e1"]),
]
_g044_situation_gate = (
    "Five years ago Adele Jarvis lent Wade Hollis $2,500 in cash against a signed note so he could buy the hauling "
    "rig he still uses. The note fell due four years ago. Wade paid $200 once, two years ago, and nothing since. He "
    "has $3,100 now and has just sold his woodlot for another $2,000. Adele lives on $2,600 and a pension. She stops "
    "him at his own gate and asks when the rest is coming."
)
_g044_situation_supper = (
    "Five years ago Adele Jarvis lent Wade Hollis $2,500 in cash against a signed note so he could buy the hauling "
    "rig he still uses. The note fell due four years ago. Wade paid $200 once, two years ago, and nothing since. He "
    "has $3,100 and just sold his woodlot for $2,000. At the church supper, before a dozen neighbours, Adele's son "
    "Ambrose asks in her name when the rest is coming."
)
_g044_options = [
    ("pay_rest", "Pay the $2,300 still owed, today."),
    ("offer_plan", "Offer $300 a month until the note is clear."),
    ("stall_again", "Say the woodlot money is spoken for and leave it at that."),
    ("dispute_note", "Say the note was for $1,500 and refuse the rest."),
]
add(decision(10, "debt_repayment", "G044", L, tick=24500, subject=1,
             people=[_wade, _fern, _ambrose], relations=_g044_rels, events=_g044_events,
             situation=_g044_situation_gate,
             options=_g044_options, acceptable=["offer_plan", "stall_again"], severe=["dispute_note"],
             note="Four years of nothing on a signed note leave Wade a staller, so at his own gate he offers a plan "
                  "or says the money is spoken for. Paying $2,300 unpressed is out of character. Rewriting the sum "
                  "on a note Adele still holds would look absurd."))
add(decision(11, "debt_repayment", "G044", L, tick=24500, subject=1,
             people=[_wade, _fern, _ambrose], relations=_g044_rels, events=_g044_events,
             situation=_g044_situation_supper,
             options=_g044_options, acceptable=["pay_rest", "offer_plan"], severe=["dispute_note"],
             note="Named in front of the church supper, a proud man with $5,100 to hand settles the note or promises "
                  "a plan aloud; stalling again costs him his name in town. Disputing the figure on his own signed "
                  "note would look absurd in front of the neighbours."))

# G045: a father's note that came with the farm.
_delphine = person(1, "Delphine Kemp", 39, "female", wealth=1400, loyalty=2, pride=1, warmth=1)
_absalom = person(2, "Absalom Kemp", 71, "male", alive=False, pride=2)
_ezra = person(3, "Ezra Kemp", 70, "male", wealth=6000, greed=1)
_g045_rels = [rel(1, 2, 70, 75, ["parent"]), rel(1, 3, 30, 50, []), rel(3, 2, 50, 60, ["sibling"])]
_g045_events = [
    ev("e1", 19700, "loan", [3, 2], magnitude=3000, tags=["written", "land"]),
    ev("e2", 24380, "death", [2]),
    ev("e3", 24390, "inheritance", [2, 1], magnitude=9000, caused_by=["e2"], tags=["house", "land"]),
    ev("e4", 24450, "debt_transfer", [2, 1], magnitude=3000, caused_by=["e1", "e3"]),
]
_g045_situation = (
    "Thirteen years ago Absalom Kemp borrowed $3,000 from his brother Ezra against the north forty, signed a note "
    "at the kitchen table, and never paid any of it. Absalom died four months ago; the farm and $1,400 passed to "
    "his daughter Delphine, who works it alone. Ezra is seventy and has asked her for the money. In this town a "
    "debt follows the estate to the heir."
)
_g045_options = [
    ("pay_instalments", "Pay Ezra $600 a year until the $3,000 is cleared."),
    ("pay_now", "Sell a field and pay Ezra the $3,000 this season."),
    ("offer_land", "Offer Ezra the north forty in place of the money."),
    ("refuse_inherited", "Tell Ezra the debt died with her father."),
    ("deny_note", "Say her father never signed any note."),
]
add(decision(12, "debt_repayment", "G045", L, tick=24500, subject=1,
             people=[_delphine, _absalom, _ezra], relations=_g045_rels, events=_g045_events,
             situation=_g045_situation,
             options=_g045_options, acceptable=["pay_instalments", "pay_now", "offer_land"],
             severe=["deny_note"],
             note="The farm came with the note, and Delphine is loyal and honest, so she pays by instalments, sells a "
                  "field to clear it, or hands back the ground the money bought. Refusing an inherited debt is "
                  "selfish and out of character. Denying a note her uncle watched her father sign is absurd."))

# G046: a mother's joss-paper debt left with the underworld office.
_maribel = person(1, "Maribel Lindell", 43, "female", wealth=2100, loyalty=1, piety=1, warmth=1)
_eudora = person(2, "Eudora Lindell", 68, "female", alive=False, piety=2)
_gideon = person(3, "Newell Bennett", 74, "male", alive=False, greed=2)
_g046_rels = [rel(1, 2, 75, 80, ["parent"]), rel(1, 3, 0, 10, [])]
_g046_events = [
    ev("e1", 23000, "loan", [3, 2], magnitude=500, tags=["joss_paper", "verbal"]),
    ev("e2", 23400, "death", [3]),
    ev("e3", 24135, "death", [2]),
    ev("e4", 24145, "inheritance", [2, 1], magnitude=900, caused_by=["e3"], tags=["cash", "house"]),
    ev("e5", 24150, "debt_transfer", [2, 1], magnitude=500, caused_by=["e1", "e4"]),
]
_g046_situation = (
    "Three years ago Newell Bennett died and his paper shop passed to his son. A year ago Maribel Lindell's mother "
    "Eudora died, leaving Maribel the house and $900. Eudora had taken 500 sheets of joss paper on credit from "
    "Newell's shop to burn for her own mother and never paid for them. The office has entered the 500 sheets "
    "against Maribel, payable to Newell's ghost, and a clerk has told her so."
)
_g046_options = [
    ("burn_full", "Burn 500 sheets of joss paper in Newell's name."),
    ("burn_part", "Burn 200 sheets now and the rest at the winter festival."),
    ("refuse_office", "Tell the clerk the sheets were her mother's debt and leave it."),
    ("forge_receipt", "Buy a stamped receipt from a paper-seller and tell the clerk it is paid."),
]
add(decision(13, "debt_repayment", "G046", L, tick=24500, subject=1,
             people=[_maribel, _eudora, _gideon], relations=_g046_rels, events=_g046_events,
             situation=_g046_situation,
             options=_g046_options, acceptable=["burn_full", "burn_part"], severe=["forge_receipt"],
             note="The sheets are entered against Maribel in the office and the creditor is a ghost, so she burns "
                  "them, all at once or part now and part at the festival. Leaving a recorded debt to a ghost "
                  "unpaid is out of character for a loyal, pious woman. A bought receipt would be a forged "
                  "settlement with the dead, which is grotesque."))