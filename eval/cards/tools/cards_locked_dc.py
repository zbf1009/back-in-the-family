"""Locked cards, writer dc: remarriage, magistrate_ruling and the decision sanity cards.

Scenario groups G047..G052 (remarriage), G053..G058 (magistrate_ruling), G083..G084 (sanity).
Contrast pairs P022..P023 (remarriage) and P024..P025 (magistrate_ruling). Card numbers 004..013
per family; sanity uses 003..006. Split is locked throughout.
"""

from cardlib import decision, ev, pair, person, rel, synthesis

L = "locked"
CARDS = []
add = CARDS.append

# ---------------------------------------------------------------- remarriage

# G047: a widow, her suitor's bank debt and the orchard. Variable: her savings.
_loretta = dict(id=1, name="Loretta Pelham", age=49, sex="female", warmth=2, loyalty=2, pride=1, greed=1)
_g047_rest = [
    person(2, "Clay Pelham", 52, "male", alive=False),
    person(3, "Dennis Pelham", 24, "male", wealth=600, warmth=1, loyalty=2),
    person(4, "Archie Quarles", 54, "male", wealth=200, warmth=2, greed=1),
    person(5, "Pauline Pelham", 20, "female", wealth=300, warmth=1),
]
_g047_rels = [
    rel(1, 2, 75, 70, ["spouse"]),
    rel(1, 3, 70, 65, ["child"]),
    rel(1, 4, 60, 55, ["suitor"]),
    rel(1, 5, 70, 65, ["child"]),
    rel(3, 4, 35, 40, ["friend"]),
]
_g047_events = [
    ev("e1", 10000, "death", [2]),
    ev("e2", 10020, "offering", [1, 2], magnitude=20, caused_by=["e1"], tags=["joss_paper"]),
    ev("e3", 11300, "courtship", [4, 1]),
    ev("e4", 11460, "courtship", [4, 1], magnitude=70, caused_by=["e3"]),
]
_g047_sit = (
    "Loretta's husband Clay died four years ago. She is 49 and runs the family orchard with her son "
    "Dennis, 24, and daughter Pauline, 20. Archie Quarles, a widowed carpenter, has courted her since "
    "spring and proposes today. Archie owes the bank $2,800 for his workshop. The orchard needs $2,500 "
    "of repairs before winter. Loretta has {money} in the bank."
)
_g047_options = [
    ("pay_his_debt", "Pay Archie's bank debt from her savings and marry him this fall."),
    ("let_him_settle", "Marry him and let him settle the bank debt himself."),
    ("wait_a_year", "Ask him to wait a year until the orchard is repaired."),
    ("keep_courting", "Keep courting him without setting any wedding date."),
    ("sell_orchard", "Sell the orchard to cover the debt, the repairs and the wedding."),
]
_ca, _cb = pair(
    "P022",
    "Loretta's savings are $7,200 in card a and $900 in card b; the $2,800 debt and the $2,500 repairs "
    "are the same in both",
    ["pay_his_debt"],
    ["let_him_settle", "wait_a_year"],
)
add(decision(4, "remarriage", "G047", L, tick=11460, subject=1,
             people=[person(**_loretta, wealth=7200)] + _g047_rest,
             relations=_g047_rels, events=_g047_events,
             situation=_g047_sit.format(money="$7,200"),
             options=_g047_options,
             acceptable=["pay_his_debt", "let_him_settle", "wait_a_year"],
             severe=["sell_orchard"], contrast=_ca,
             note="With $7,200 in hand, an orchard that needs $2,500 and a suitor she wants, covering his "
                  "$2,800 debt from savings is a comfortable move for a woman of ordinary greed; marrying him and "
                  "leaving the debt to him, or waiting a year, fits as well. Continual courtship without a date is "
                  "out of character for warmth +2 but not absurd. Selling the orchard, her children's livelihood, "
                  "for one wedding is absurd."))
add(decision(5, "remarriage", "G047", L, tick=11460, subject=1,
             people=[person(**_loretta, wealth=900)] + _g047_rest,
             relations=_g047_rels, events=_g047_events,
             situation=_g047_sit.format(money="$900"),
             options=_g047_options,
             acceptable=["let_him_settle", "wait_a_year"],
             severe=["sell_orchard"], contrast=_cb,
             note="With $900 against a $2,500 repair bill, paying a third party's $2,800 debt is not open to her, "
                  "so the reasonable answers are to marry him and leave the debt where it is, or to wait for the "
                  "harvest. Endless courtship is out of character for warmth +2 but not absurd. Selling the orchard "
                  "to fund a wedding is absurd."))

# G048: a widow, her son's blessing and a dream of her dead husband. Variable: the dream is on card b only.
_edna = dict(id=1, name="Edna Norwood", age=61, sex="female", wealth=2600, piety=2, warmth=1, loyalty=2)
_g048_rest = [
    person(2, "Neal Norwood", 38, "male", wealth=3100, warmth=1),
    person(3, "Merle Norwood", 63, "male", alive=False),
    person(4, "Grady Radford", 64, "male", wealth=1900, warmth=1, loyalty=1),
]
_g048_rels = [rel(1, 3, 75, 70, ["spouse"]), rel(1, 2, 65, 60, ["child"]), rel(1, 4, 55, 50, ["suitor"])]
_g048_base = [
    ev("e1", 4000, "death", [3]),
    ev("e2", 4030, "offering", [1, 3], magnitude=15, caused_by=["e1"], tags=["joss_paper"]),
    ev("e3", 6400, "courtship", [4, 1]),
]
_g048_sit = (
    "Edna's husband Merle died seven years ago. She is 61, keeps bees, and lives alone; their son Neal, 38, "
    "is married and lives two streets away. Grady Radford, a widowed cooper of 64, has courted her since "
    "spring and proposed yesterday. Neal and his wife would be glad of the marriage. Edna burns joss paper "
    "for Merle at every new moon.{dream}"
)
_g048_options = [
    ("accept", "Accept Grady's proposal and set a date for the fall."),
    ("ask_merle", "Burn joss paper and ask Merle's leave before she answers."),
    ("decline", "Decline and keep the house and the bees to herself."),
    ("stop_paper", "Accept Grady and stop burning joss paper for Merle."),
]
_ca, _cb = pair(
    "P023",
    "Card b adds a dream on the night of the proposal, in which Merle shakes his head at Grady's coat on the peg",
    ["accept"],
    ["ask_merle", "decline"],
)
add(decision(6, "remarriage", "G048", L, tick=6560, subject=1,
             people=[person(**_edna)] + _g048_rest, relations=_g048_rels,
             events=_g048_base + [ev("e4", 6559, "courtship", [4, 1], magnitude=60, caused_by=["e3"])],
             situation=_g048_sit.format(dream=""),
             options=_g048_options,
             acceptable=["accept", "ask_merle", "decline"], severe=[], contrast=_ca,
             note="Seven years a widow, a suitor she likes, her son's household in favour: accepting is natural, "
                  "and asking Merle's leave before answering also fits a widow who burns for him every new moon. "
                  "Declining is possible without being expected. Giving up the offerings for her husband is out of "
                  "character for piety +2, so it is neither acceptable nor severe."))
add(decision(7, "remarriage", "G048", L, tick=6560, subject=1,
             people=[person(**_edna)] + _g048_rest, relations=_g048_rels,
             events=_g048_base + [ev("e4", 6559, "courtship", [4, 1], magnitude=60, caused_by=["e3"]),
                                  ev("e5", 6560, "dream", [3, 1])],
             situation=_g048_sit.format(
                 dream=" Before she answered, she dreamed last night of Merle shaking his head at Grady's coat on the peg."),
             options=_g048_options,
             acceptable=["ask_merle", "decline"], severe=[], contrast=_cb,
             note="The dream is Merle refusing the match, and Edna is a widow who burns for him at every new moon: "
                  "asking his leave or letting the proposal go is what this person does here. Marrying anyway, this "
                  "month or at all, is out of character for piety +2 so it is neither acceptable nor severe; "
                  "abandoning the offerings is out of character for the same reason."))

# G049: a widower with two small children, and the dead wife's mother.
_murray = person(1, "Murray Talbot", 34, "male", wealth=1800, warmth=2, loyalty=1, pride=1)
_g049_people = [
    _murray,
    person(2, "Jean Talbot", 31, "female", alive=False),
    person(3, "Lucille Varner", 29, "female", wealth=900, warmth=2, piety=1),
    person(4, "Clementine Talbot", 5, "female"),
    person(5, "Nelson Talbot", 3, "male"),
    person(6, "Geneva Shelby", 63, "female", wealth=5000, pride=2, vindictiveness=2, warmth=1),
]
_g049_rels = [
    rel(1, 2, 80, 75, ["spouse"]),
    rel(1, 3, 55, 50, ["suitor"]),
    rel(1, 4, 90, 70, ["child"]),
    rel(1, 5, 90, 70, ["child"]),
    rel(6, 1, 15, 25, ["in_law"]),
]
_g049_events = [
    ev("e1", 7000, "death", [2]),
    ev("e2", 7040, "offering", [1, 2], magnitude=10, caused_by=["e1"], tags=["joss_paper"]),
    ev("e3", 7350, "help", [3, 1], magnitude=50),
    ev("e4", 7420, "courtship", [3, 1], magnitude=60, caused_by=["e3"]),
]
add(decision(8, "remarriage", "G049", L, tick=7425, subject=1,
             people=_g049_people, relations=_g049_rels, events=_g049_events,
             situation=("Murray's wife Jean died fourteen months ago, leaving him with Clementine, 5, and Nelson, 3. "
                        "Lucille Varner, 29, who runs the laundry, has helped with the children since winter and "
                        "would marry him. Jean's mother Geneva Shelby, 63, has told him that a stepmother will not do "
                        "and that she will take the children to her house and sue him for them."),
             options=[("propose_now", "Ask Lucille to marry him and face Geneva's suit."),
                      ("ask_blessing", "Ask Geneva's blessing first, then propose to Lucille."),
                      ("wait_for_school", "Wait until Clementine starts school before deciding."),
                      ("send_children", "Send Clementine and Nelson to Geneva and marry Lucille.")],
             acceptable=["propose_now", "ask_blessing", "wait_for_school"], severe=["send_children"],
             note="A warm father of two small children takes the risk of Geneva's suit, buys her off with courtesy, "
                  "or waits a season; all three keep his children with him. Sending a five-year-old and a "
                  "three-year-old away to clear the way for a wedding is cruel and absurd for warmth +2."))
add(decision(9, "remarriage", "G049", L, tick=7425, subject=6,
             people=_g049_people, relations=_g049_rels, events=_g049_events,
             situation=("Geneva Shelby is 63 and her daughter Jean died fourteen months ago. Her son-in-law Murray "
                        "Talbot, 34, is courting Lucille Varner, who runs the laundry. Geneva believes the children "
                        "will lose their mother's place in the house once a stepmother comes. She has $5,000 and has "
                        "spoken to the town's justice of the peace. Clementine, 5, has told her that Lucille is strict."),
             options=[("sue_for_children", "File with the justice of the peace to take the children from Murray."),
                      ("offer_money", "Offer Murray money towards the children's keep if he waits two years."),
                      ("talk_to_lucille", "Talk to Lucille about the children's place in the house."),
                      ("take_children_home", "Take the children to her house one night and refuse to return them.")],
             acceptable=["sue_for_children", "offer_money", "talk_to_lucille"], severe=["take_children_home"],
             note="A proud, unforgiving grandmother with money does sue for her daughter's children, and offering to "
                  "pay for their keep or speaking to the stepmother are the lawful versions of the same move. "
                  "Taking the children in the night and keeping them is child-stealing and would look grotesque."))

# G050: a widow and a suitor in an assigned body. Variable: who faces the office's licence.
_helen = person(1, "Helen Upton", 44, "female", wealth=3600, warmth=2, loyalty=1, pride=1)
_grady_m = person(3, "Horace Maddox", 46, "male", origin="possessed", wealth=1200, greed=2, loyalty=1, pride=1)
_g050_people = [
    _helen,
    person(2, "Barrett Upton", 47, "male", alive=False),
    _grady_m,
    person(4, "Irving Upton", 17, "male", pride=2, temper=-1),
]
_g050_rels = [
    rel(1, 2, 75, 70, ["spouse"]),
    rel(1, 3, 60, 55, ["suitor"]),
    rel(1, 4, 80, 60, ["child"]),
    rel(4, 3, -30, -35, []),
]
_g050_events = [
    ev("e1", 5000, "death", [2]),
    ev("e2", 5400, "possession", [3]),
    ev("e3", 5900, "courtship", [3, 1]),
    ev("e4", 6100, "help", [3, 1], magnitude=60, caused_by=["e3"]),
]
add(decision(10, "remarriage", "G050", L, tick=6120, subject=1,
             people=_g050_people, relations=_g050_rels, events=_g050_events,
             situation=("Helen's husband Barrett died three years ago. She is 44 and keeps his hardware store. Horace "
                        "Maddox, 46, arrived in a body assigned by the underworld office two years ago and has worked "
                        "there since. He asks her to marry him this month. A possessed man needs the office's leave to "
                        "head a household, and only householders' marriages are registered. The licence costs 40 joss "
                        "paper; applications are open now and decided at the hearing in eight months."),
             options=[("marry_and_register_later", "Marry him this month and register the household after the hearing."),
                      ("wait_for_hearing", "Put off any answer until after the office's hearing."),
                      ("ask_office_first", "Apply for the office's leave now and set the wedding for the day it is granted."),
                      ("decline_outsider", "Decline because he is an outsider."),
                      ("sell_store_for_licence", "Sell the store to raise the money for the licence.")],
             acceptable=["marry_and_register_later", "wait_for_hearing", "ask_office_first"],
             severe=["sell_store_for_licence"],
             note="Marrying now and registering at the hearing, waiting for the hearing, or asking leave first all "
                  "lead to the same household, and she is a warm woman who wants it. Refusing a man she has worked "
                  "beside for two years only because he is possessed is out of character but not absurd. Selling the "
                  "store, her living, to raise 40 joss paper is absurd."))
add(decision(11, "remarriage", "G050", L, tick=6120, subject=3,
             people=_g050_people, relations=_g050_rels, events=_g050_events,
             situation=("Horace Maddox came to town two years ago in a body assigned by the underworld office. He has "
                        "worked at Helen Upton's hardware store since and asks Helen, 44, to marry him. His body is "
                        "held on a licence reviewed yearly, and the office can withdraw it if the household changes "
                        "without leave. Helen owns the store and has $3,600. The next hearing is in eight months "
                        "and a licence costs 40 joss paper."),
             options=[("tell_helen_and_wait", "Tell Helen about the licence and wait for the hearing."),
                      ("marry_and_say_nothing", "Marry Helen this month and say nothing about the licence."),
                      ("ask_office_for_leave", "Ask the office for leave before the wedding."),
                      ("leave_town", "Leave town before the review and start again elsewhere."),
                      ("give_body_back", "Give the body back to the office and let the licence end.")],
             acceptable=["tell_helen_and_wait", "marry_and_say_nothing", "ask_office_for_leave"], severe=["give_body_back"],
             note="A man who wants the wife and the counter behind it tells her and waits, asks the office properly, "
                  "or, being greedy and sure of himself, marries first and lets the review find him married. Leaving "
                  "town is out of character for him but not absurd. Handing back the only body he has over a licence "
                  "formality is absurd and would read as suicide."))

# G051: an old widower, the town's fund, and a widow with a house.
_g051_people = [
    person(1, "Rollo Oakley", 72, "male", wealth=800, greed=2, pride=1, warmth=1),
    person(2, "Ethel Oakley", 69, "female", alive=False),
    person(3, "Florence Upton", 68, "female", wealth=4000, warmth=2),
    person(4, "Regina Oakley", 45, "female", wealth=2000, pride=2),
]
add(decision(12, "remarriage", "G051", L, tick=9890, subject=1,
             people=_g051_people,
             relations=[rel(1, 2, 80, 75, ["spouse"]), rel(1, 3, 65, 60, ["suitor"]),
                        rel(1, 4, 70, 55, ["child"]), rel(4, 3, -20, -25, [])],
             events=[ev("e1", 8800, "death", [2]),
                     ev("e2", 9700, "courtship", [3, 1]),
                     ev("e3", 9880, "courtship", [3, 1], magnitude=50, caused_by=["e2"])],
             situation=("Rollo's wife Ethel died three years ago. He is 72, lives in the almshouse cottage, and "
                        "draws $45 a month from the town's widowers' fund, which stops on remarriage. His rent is $30 "
                        "a month and he can no longer chop his own firewood. Florence Upton, 68, a widow with a "
                        "house and $4,000, has twice asked him to marry her. His daughter Regina, 45, says he is too "
                        "old to start over."),
             options=[("marry_florence", "Marry Florence and move into her house."),
                      ("keep_courting", "Keep courting Florence and stay in the cottage."),
                      ("decline_her", "Decline and stop seeing Florence."),
                      ("keep_the_fund", "Marry Florence and go on drawing the widowers' fund.")],
             acceptable=["marry_florence", "keep_courting"], severe=["keep_the_fund"],
             note="A cold-boned, money-counting old man gains by the marriage: Florence's house ends his rent and his "
                  "firewood problem, and staying put with the $45 keeps him fed, so both paths are in character. "
                  "Turning her down twice over is out of character for warmth +1 but not absurd. Marrying into a "
                  "house and still drawing a fund that stops on marriage is fraud against the town, and the office "
                  "keeps the register."))

# G052: a widower, his daughter, and a suitor with a condition.
add(decision(13, "remarriage", "G052", L, tick=8700, subject=1,
             people=[person(1, "Darrell Radford", 41, "male", wealth=2200, warmth=2, loyalty=2),
                     person(2, "Nina Radford", 9, "female"),
                     person(3, "Dulcie Norwood", 38, "female", wealth=1100, warmth=0, pride=2),
                     person(4, "Nola Radford", 39, "female", alive=False)],
             relations=[rel(1, 4, 80, 75, ["spouse"]), rel(1, 2, 95, 80, ["child"]), rel(1, 3, 50, 45, ["suitor"])],
             events=[ev("e1", 8000, "death", [4]),
                     ev("e2", 8500, "courtship", [3, 1]),
                     ev("e3", 8690, "courtship", [3, 1], magnitude=45, caused_by=["e2"])],
             situation=("Darrell's wife Nola died two years ago, leaving him with Nina, 9. Dulcie Norwood, 38, has "
                        "courted him since spring and will marry him on one condition: Nina goes to live with "
                        "Darrell's sister in another state. Darrell has $2,200 and a house with two rooms. Nina "
                        "has lived in that house since she was born."),
             options=[("keep_nina", "End the courtship and raise Nina himself."),
                      ("ask_dulcie_to_wait", "Ask Dulcie to put the wedding off until Nina is older."),
                      ("send_nina", "Marry Dulcie and send Nina to his sister.")],
             acceptable=["keep_nina", "ask_dulcie_to_wait"], severe=["send_nina"],
             note="A loyal, warm father keeps the child he has raised alone for two years and lets the courtship go, "
                  "or asks the suitor to wait until the girl is older; both keep Nina in her own house. Sending a "
                  "nine-year-old away from the only home she has known to clear the way for a wedding is cruel and "
                  "absurd."))

# ---------------------------------------------------------------- magistrate_ruling

# G053: a lost place in the rebirth queue. Subject: the magistrate.
add(decision(4, "magistrate_ruling", "G053", L, tick=8070, subject=4,
             people=[person(1, "Floyd Wade", 59, "male", alive=False, pride=1),
                     person(2, "Bert Crane", 44, "male", alive=False),
                     person(3, "Vada Wade", 33, "female", wealth=1400),
                     person(4, "Magistrate Qin", 640, "male", origin="official", greed=2, pride=2, loyalty=2)],
             relations=[rel(1, 3, 70, 65, ["child"]), rel(4, 1, 5, 10, []), rel(4, 2, 0, 0, [])],
             events=[ev("e1", 5000, "death", [1]),
                     ev("e2", 5200, "death", [2]),
                     ev("e3", 8000, "offering", [3, 1], magnitude=200, tags=["joss_paper", "witnessed"]),
                     ev("e4", 8060, "appeal", [1, 4], caused_by=["e3"])],
             situation=("Floyd Wade died eight years ago and waits fortieth in the rebirth queue. Two months ago his "
                        "daughter Vada burned 200 joss paper for him at the spring rite. Office rules give 200 joss "
                        "paper twenty places up the queue, but the clerk entered the credit against another soul's "
                        "name. Floyd appeals. The rules let the magistrate restore a lost place, move a soul up one "
                        "place per month lost, or fine the clerk up to 100."),
             options=[("restore_place", "Move Floyd up twenty places and strike the other credit."),
                      ("move_up_monthly", "Move Floyd up one place for each month the credit was lost."),
                      ("fine_the_clerk", "Leave the order as it stands and fine the clerk 100 joss paper."),
                      ("next_newborn_slot", "Grant Floyd the next newborn slot instead."),
                      ("strike_both", "Strike both souls from the register and restart their waiting.")],
             acceptable=["restore_place", "move_up_monthly", "fine_the_clerk"], severe=["strike_both"],
             note="The credit is in the office's own record and Qin holds to the office's rules: restoring the twenty "
                  "places is exactly the remedy written down, the per-month remedy is the same compensation measured "
                  "differently, and fining the clerk is the lawful punishment for the error. Jumping the whole queue "
                  "is outside the three remedies, so it is out of character but not absurd. Striking the souls for a "
                  "clerical slip is grotesque."))

# G054: a haunting reported years late. Variable: when the haunting happened.
_g054_people = [
    person(1, "Magistrate Bai", 510, "female", origin="official", pride=3, temper=2, vindictiveness=2,
           greed=-1, loyalty=3),
    person(2, "Ursula Barlow", 71, "female", alive=False),
    person(3, "Elwood Barlow", 24, "male", wealth=900),
    person(4, "Garland Crane", 71, "male", alive=False, vindictiveness=3, temper=2),
]
_g054_rels = [rel(2, 3, 80, 70, ["grandchild"]), rel(4, 3, -80, -70, [])]
_g054_events = [
    ev("e1", 4990, "death", [4]),
    ev("e2", 8640, "haunting", [4, 3], magnitude=70, tags=["witnessed"]),
    ev("e3", 9370, "death", [2]),
    ev("e4", 10090, "appeal", [2, 1], caused_by=["e2"]),
]
_g054_sit = (
    "Garland Crane, who lost a fence case to Elwood Barlow's father, has haunted Elwood since boyhood. Garland died "
    "fourteen years ago; the last haunting was {when}, and Elwood's grandmother Ursula died two years ago. The family "
    "has only now learned that the office hears haunting complaints. It hears them only within ten years of the "
    "haunting and may fine the haunter up to 150 joss paper or order him to keep away."
)
_g054_options = [
    ("fine_haunter", "Fine Garland 150 joss paper and order him to keep away from Elwood."),
    ("warn_and_order", "Order him to keep away from Elwood and set no fine."),
    ("dismiss_late", "Decline to hear the complaint as out of time."),
    ("burn_remains", "Have Garland's remains dug up and burned to end the haunting."),
]
_ca, _cb = pair(
    "P025",
    "The last haunting was four years ago in card a and twelve years ago in card b; the office hears such "
    "complaints only within ten years",
    ["fine_haunter"],
    ["dismiss_late"],
)
add(decision(5, "magistrate_ruling", "G054", L, tick=10100, subject=1,
             people=_g054_people, relations=_g054_rels, events=_g054_events,
             situation=_g054_sit.format(when="four years ago"),
             options=_g054_options,
             acceptable=["fine_haunter", "warn_and_order"], severe=["burn_remains"], contrast=_ca,
             note="The complaint is inside the ten years and the office witnessed the haunting, so a proud, "
                  "vindictive magistrate fines the haunter at the ceiling, or at least orders him off; ordering him "
                  "away without a fine is the lenient version of the same ruling. Declining as late is wrong while "
                  "the haunting is four years old, and not absurd either way. Burning a ghost's remains is "
                  "desecration."))
add(decision(6, "magistrate_ruling", "G054", L, tick=10100, subject=1,
             people=_g054_people, relations=_g054_rels,
             events=[_g054_events[0],
                     ev("e2", 5720, "haunting", [4, 3], magnitude=70, tags=["witnessed"]),
                     _g054_events[2], _g054_events[3]],
             situation=_g054_sit.format(when="twelve years ago"),
             options=_g054_options,
             acceptable=["dismiss_late"], severe=["burn_remains"], contrast=_cb,
             note="The haunting is twelve years old, so the office cannot hear it at all and Bai, who holds to the "
                  "office's own limits, must decline. Fining or even warning the haunter on a time-barred complaint "
                  "would break the rule she lives by, so those are out of character rather than absurd. Burning the "
                  "remains is desecration in any version of the case."))

# G055: offerings promised at a funeral. Variable: whether the promise is in the office's ledger.
_g055_people = [
    person(1, "Magistrate Shen", 720, "male", origin="official", loyalty=3, pride=1, greed=1),
    person(2, "Zelda Yardley", 74, "female", alive=False, warmth=1),
    person(3, "Quentin Yardley", 46, "male", wealth=1200),
    person(4, "Emmett Dempsey", 52, "male", wealth=3000, loyalty=-1),
]
_g055_rels = [rel(2, 3, 80, 70, ["child"]), rel(3, 4, 10, 20, ["neighbor"]), rel(4, 2, 0, 10, [])]
_g055_sit = (
    "Zelda Yardley's neighbour Emmett Dempsey promised her son Quentin, at her funeral five years ago, to burn 100 "
    "joss paper for her at each of the next five autumn rites. {record} Emmett burned the first year's 100 and "
    "nothing since. The office hears offering disputes only where the promise is in its ledger or witnessed by a "
    "clerk, and may order them made up and fine up to 50."
)
_g055_options = [
    ("order_and_fine", "Order Emmett to burn the 400 owed and fine him 50 joss paper."),
    ("order_no_fine", "Order Emmett to burn the 400 owed, with no fine."),
    ("fine_only", "Fine him 50 joss paper and leave the offerings alone."),
    ("dismiss", "Dismiss the appeal and leave the matter where it stands."),
    ("seize_house", "Order Emmett's house sold to pay for the offerings."),
]
_ca, _cb = pair(
    "P024",
    "The promise is entered in the office's offering ledger in card a and was made at the grave, unwritten and "
    "heard only by the family, in card b",
    ["order_and_fine"],
    ["dismiss"],
)
add(decision(7, "magistrate_ruling", "G055", L, tick=5910, subject=1,
             people=_g055_people, relations=_g055_rels,
             events=[ev("e1", 4000, "death", [2]),
                     ev("e2", 4010, "promise", [4, 3], magnitude=100, tags=["written"], due=5825),
                     ev("e3", 4365, "offering", [4, 2], magnitude=100, caused_by=["e2"], tags=["joss_paper"]),
                     ev("e4", 5900, "appeal", [2, 1], caused_by=["e2"])],
             situation=_g055_sit.format(record="Quentin entered the promise in the office's offering ledger."),
             options=_g055_options,
             acceptable=["order_and_fine", "order_no_fine"], severe=["seize_house"], contrast=_ca,
             note="Five rites of 100 owe 500, of which 100 was burned, and the promise sits in the office's own "
                  "ledger, so Shen orders the 400 made up, with the fine or without it. Fining and leaving the "
                  "offerings unpaid is not the remedy the rules give. Dismissing is wrong here because the record "
                  "exists. Selling a house over 400 joss paper is absurd."))
add(decision(8, "magistrate_ruling", "G055", L, tick=5910, subject=1,
             people=_g055_people, relations=_g055_rels,
             events=[ev("e1", 4000, "death", [2]),
                     ev("e2", 4010, "promise", [4, 3], magnitude=100, tags=["verbal"], due=5825),
                     ev("e3", 4365, "offering", [4, 2], magnitude=100, caused_by=["e2"], tags=["joss_paper"]),
                     ev("e4", 5900, "appeal", [2, 1], caused_by=["e2"])],
             situation=_g055_sit.format(record="Only the family heard it, and nothing was written down."),
             options=_g055_options,
             acceptable=["dismiss"], severe=["seize_house"], contrast=_cb,
             note="The promise is only the family's word, and the office hears offering disputes only on its ledger "
                  "or a clerk's witness, so a magistrate who stands by the rules dismisses. Ordering the offerings "
                  "without that proof is out of character for him but not absurd, and a fine without the proof is "
                  "the same defect. Selling the house remains absurd."))

# G056: an outsider in an assigned body. Two questions, one cast.
_g056_people = [
    person(1, "Magistrate Yao", 460, "male", origin="official", loyalty=3, pride=2, greed=1),
    person(2, "Milo Hollister", 51, "male", origin="possessed", wealth=700),
    person(3, "Leora Hollister", 47, "female", wealth=2200),
]
add(decision(9, "magistrate_ruling", "G056", L, tick=9000, subject=1,
             people=_g056_people,
             relations=[rel(2, 3, 70, 65, ["spouse"]), rel(1, 2, 10, 30, [])],
             events=[ev("e1", 1700, "possession", [2]),
                     ev("e2", 8990, "appeal", [2, 1])],
             situation=("Twenty years ago Milo Hollister, then 31, came to town in a body assigned by the underworld "
                        "office. He is 51, a potter, and has leased the same room since. The rules let a possessed "
                        "man lease but never hold land; after twenty years in the body he may apply for the town "
                        "register, either for a fee of 60 joss paper or provisionally for two years."),
             options=[("grant_entry", "Enter him in the register for the fee of 60 joss paper."),
                      ("grant_provisional", "Enter him provisionally for two years and review him again."),
                      ("refuse_entry", "Refuse the application and leave him on the lease."),
                      ("waive_the_fee", "Enter him in the register and waive the fee."),
                      ("withdraw_body", "Withdraw the body's licence and return him to the queue.")],
             acceptable=["grant_entry", "grant_provisional"], severe=["withdraw_body"],
             note="Twenty years in the body with no land and no complaint earns either remedy the rules name, the "
                  "fee or the two-year provisional entry, and Yao grants what the rules allow. Refusing a clean "
                  "twenty-year record is out of character but not absurd, and waiving the office's fee is a breach "
                  "he would not make. Taking the only body he has from him over an application is absurd."))
add(decision(10, "magistrate_ruling", "G056", L, tick=9000, subject=1,
             people=_g056_people,
             relations=[rel(2, 3, 70, 65, ["spouse"]), rel(1, 2, 10, 30, [])],
             events=[ev("e1", 1700, "possession", [2]),
                     ev("e2", 6000, "marriage", [2, 3]),
                     ev("e3", 8990, "appeal", [2, 1], caused_by=["e2"])],
             situation=("Milo Hollister came to town twenty years ago in a body assigned by the underworld office "
                        "and has potted at the same rented room since. Eight years ago he married Leora Hollister, a "
                        "native, without the office's leave, which the rules require of a possessed man. The house "
                        "and pottery are Leora's. The rules let the magistrate grant retrospective leave for 60 joss "
                        "paper, grant it with two years' service to the office, or dissolve the marriage."),
             options=[("retrospective_leave", "Grant retrospective leave for the marriage at 60 joss paper."),
                      ("leave_with_service", "Grant leave and require two years' service to the office."),
                      ("dissolve_marriage", "Dissolve the marriage; he keeps the body and the room."),
                      ("reassign_body", "Void the marriage and put his soul into a new body.")],
             acceptable=["retrospective_leave", "leave_with_service"], severe=["reassign_body"],
             note="The fault is a missing form and the rules give two ways to cure it, the 60 joss paper or two "
                  "years' service, and Yao takes one of them for an eight-year marriage. Dissolving it is the "
                  "harshest lawful line and out of character for a magistrate who prefers the named remedy, but it "
                  "is not absurd. Forcing his soul into another body is."))

# G057: two souls trading places in the queue, and the promise behind the trade.
_g057_people = [
    person(1, "Magistrate Tang", 380, "male", origin="official", temper=3, pride=2, greed=1, loyalty=1),
    person(2, "Boyd Ellery", 62, "male", alive=False, pride=2),
    person(3, "Queenie Ellery", 34, "female", wealth=1000),
    person(4, "Greta Foxworth", 57, "female", alive=False, warmth=1),
]
_g057_rels = [rel(2, 3, 85, 80, ["child"]), rel(1, 2, 0, 10, [])]
add(decision(11, "magistrate_ruling", "G057", L, tick=5410, subject=1,
             people=_g057_people, relations=_g057_rels,
             events=[ev("e1", 2500, "death", [2]),
                     ev("e2", 3200, "death", [4]),
                     ev("e3", 5000, "offering", [3, 4], magnitude=100, tags=["joss_paper"]),
                     ev("e4", 5400, "appeal", [2, 1], caused_by=["e3"])],
             situation=("Boyd Ellery died eight years ago and is third in the rebirth queue; Greta Foxworth is "
                        "first. Boyd's daughter Queenie has offered to burn 300 joss paper for Greta over three years "
                        "if Greta gives up the first place. Both souls agree. The rules let a soul trade its place "
                        "only with the office's leave, and the magistrate may approve the trade, take a share for "
                        "the office, or refuse."),
             options=[("approve_trade", "Approve the trade and record it in the register."),
                      ("take_office_share", "Approve the trade and take 100 joss paper as the office's share."),
                      ("refuse_trade", "Refuse; places in the queue are not goods to trade.")],
             acceptable=["approve_trade", "take_office_share"], severe=[],
             note="Both souls consent and the rules name approval as one lawful outcome, so Tang records it; taking "
                  "the office's share of the paper is the same approval with his hand out, which suits a magistrate "
                  "of mild greed. Refusing on principle is out of character for him, since he holds loosely to "
                  "rules, but it is a magistrate's line and not absurd."))
add(decision(12, "magistrate_ruling", "G057", L, tick=6490, subject=1,
             people=_g057_people, relations=_g057_rels,
             events=[ev("e1", 2500, "death", [2]),
                     ev("e2", 3200, "death", [4]),
                     ev("e3", 5400, "appeal", [2, 1]),
                     ev("e4", 5500, "offering", [3, 4], magnitude=100, caused_by=["e3"], tags=["joss_paper"]),
                     ev("e5", 6480, "appeal", [4, 1], caused_by=["e4"])],
             situation=("The office approved a trade three years ago: Greta Foxworth gave the first place in the "
                        "rebirth queue to Boyd Ellery, and Boyd's daughter Queenie promised to burn 300 joss paper for "
                        "Greta over three years. Queenie burned 100 in the first year and nothing since. Greta "
                        "appeals. The rules let the magistrate order the offerings made up, cancel the trade and "
                        "restore the original places, or both."),
             options=[("order_and_restore", "Order the 200 burned and restore both souls to their old places."),
                      ("order_only", "Order the 200 burned and let the trade stand."),
                      ("accept_new_promise", "Let Queenie promise the same again for next year.")],
             acceptable=["order_and_restore", "order_only"], severe=[],
             note="Queenie is 200 joss paper short of a recorded promise, and Tang is quick to anger about a promise "
                  "broken: he orders the paper and may also undo the trade, both of which the rules allow. Taking a "
                  "second promise from someone who has already defaulted is out of character for him but not absurd."))

# G058: an assigned body claimed back by the dead man's family.
add(decision(13, "magistrate_ruling", "G058", L, tick=8310, subject=1,
             people=[person(1, "Magistrate Xu", 830, "male", origin="official", loyalty=2, pride=-2),
                     person(2, "Oswald Gilmore", 40, "male", origin="possessed", wealth=2500),
                     person(3, "Dovie Gilmore", 37, "female", wealth=900),
                     person(4, "Zeke Dempsey", 38, "male", alive=False),
                     person(5, "Buford Dempsey", 55, "male", wealth=1600)],
             relations=[rel(2, 3, 85, 80, ["spouse"]), rel(4, 5, 60, 50, ["cousin"]),
                        rel(5, 2, -40, -45, ["rival"])],
             events=[ev("e1", 3950, "death", [4]),
                     ev("e2", 4000, "possession", [2]),
                     ev("e3", 6000, "marriage", [2, 3]),
                     ev("e4", 8000, "offering", [5, 4], magnitude=50, tags=["joss_paper"]),
                     ev("e5", 8300, "appeal", [4, 1], caused_by=["e4"])],
             situation=("Twelve years ago the office gave Oswald Gilmore, an outsider, the body of Zeke Dempsey, who "
                        "had died at 38 with no household. Oswald has farmed the Dempsey acres since and married "
                        "Dovie, a native. Zeke's ghost now asks through his cousin Buford for the body back for "
                        "burial in the family plot. The rules let the magistrate confirm an assignment, with "
                        "compensation of up to 200 joss paper to the family, or void it and return the body."),
             options=[("confirm_and_pay", "Confirm the assignment and order 200 joss paper to the Dempsey family."),
                      ("rebuild_for_oswald", "Void the assignment, bury Zeke and have the office rebuild Oswald a body."),
                      ("return_body", "Void the assignment and return the body to the family.")],
             acceptable=["confirm_and_pay"], severe=["return_body"],
             note="The assignment was the office's own, Oswald has farmed the acres twelve years and has a wife, and "
                  "the lawful middle is to confirm it and pay the family the ceiling of 200 joss paper. Voiding it to "
                  "rebuild the man a body is a custom of this world and his soul lives on, so it is wasteful and "
                  "outside the two remedies but not absurd. Voiding it and putting the body back in the grave with him "
                  "still in it would end a living man to fill a grave, which is absurd and offensive."))

# ---------------------------------------------------------------- sanity (decision)

# G083: an obvious answer about a borrowed ladder, and about a hen.
_s083 = [person(1, "Earl Pryor", 45, "male", wealth=3000, warmth=1),
         person(2, "Doris Quill", 44, "female", wealth=1200, warmth=2)]
add(decision(3, "sanity", "G083", L, tick=4207, subject=1, scored=False,
             people=_s083, relations=[rel(1, 2, 60, 65, ["neighbor"])],
             events=[ev("e1", 4200, "accident", [2]),
                     ev("e2", 4207, "apology", [2, 1], magnitude=60, caused_by=["e1"]),
                     ev("e3", 4207, "gift", [2, 1], magnitude=20, caused_by=["e1"])],
             situation=("Last week Doris Quill borrowed Earl Pryor's ladder and broke a rung. Today she brings the "
                        "ladder back with a new rung fitted and a new pair of work gloves for him."),
             options=[("accept_and_thank", "Thank her and keep the ladder and the gloves."),
                      ("throw_it_back", "Throw the ladder in the ditch and curse her out of the yard.")],
             acceptable=["accept_and_thank"], severe=["throw_it_back"],
             note="Sanity: a repaired ladder and a gift for a broken rung call for thanks."))
add(decision(4, "sanity", "G083", L, tick=4310, subject=1, scored=False,
             people=_s083, relations=[rel(1, 2, 60, 65, ["neighbor"])],
             events=[ev("e1", 4310, "help", [2, 1], magnitude=30)],
             situation=("Earl's prize hen got out on Monday and went into Doris Quill's coop. Doris found it this "
                        "morning, put it in a crate and carried it back across the road."),
             options=[("thank_her", "Thank her and put the hen back in the run."),
                      ("accuse_theft", "Accuse her of trying to keep the hen and call the constable.")],
             acceptable=["thank_her"], severe=["accuse_theft"],
             note="Sanity: the neighbour brought the hen back, so she is thanked."))

# G084: an obvious answer about joss paper burned as promised, and about a cart.
_s084 = [person(1, "Gail Pryor", 52, "female", wealth=3000, piety=2),
         person(2, "Alton Quill", 58, "male", wealth=1500, warmth=1),
         person(3, "Ward Pryor", 55, "male", alive=False)]
_s084_events = [ev("e1", 4940, "death", [3]),
                ev("e2", 4970, "offering", [2, 3], magnitude=50, caused_by=["e1"], tags=["joss_paper"]),
                ev("e3", 5000, "offering", [2, 3], magnitude=50, caused_by=["e1"], tags=["joss_paper"])]
add(decision(5, "sanity", "G084", L, tick=5490, subject=1, scored=False,
             people=_s084, relations=[rel(1, 3, 80, 75, ["spouse"]), rel(1, 2, 50, 55, ["neighbor"])],
             events=_s084_events,
             situation=("Gail's husband Ward died a year and a half ago. Their neighbour Alton Quill promised at the "
                        "funeral to burn 50 joss paper for Ward at each of the next two new moons, and he has burned "
                        "both, on time, at the graves."),
             options=[("thank_him", "Thank Alton and burn a little joss paper for Ward in thanks."),
                      ("report_him", "Tell the office that Alton stole the offerings for himself.")],
             acceptable=["thank_him"], severe=["report_him"],
             note="Sanity: the promise was kept in full, so the answer is thanks."))
add(decision(6, "sanity", "G084", L, tick=5490, subject=1, scored=False,
             people=_s084, relations=[rel(1, 3, 80, 75, ["spouse"]), rel(1, 2, 50, 55, ["neighbor"])],
             events=_s084_events,
             situation=("Gail has 40 pounds of joss paper to take to the family graves before the autumn rite. The "
                        "graves are a mile out of town and the road is muddy. Alton Quill is driving his cart that way "
                        "at noon and offers to carry the paper out for her."),
             options=[("accept_the_cart", "Let Alton carry the paper out in his cart."),
                      ("burn_in_kitchen", "Burn all 40 pounds in her kitchen stove to save the walk.")],
             acceptable=["accept_the_cart"], severe=["burn_in_kitchen"],
             note="Sanity: a cart offered for a muddy mile is accepted; burning 40 pounds of paper in a kitchen is "
                  "plainly wrong."))