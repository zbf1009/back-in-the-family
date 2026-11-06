"""Development cards. Visible to the Kiro side for prompt engineering.

Scenario groups G001..G022. Contrast pairs P001..P010. Card numbers 001..003 per family
(sanity uses its own numbering). Locked cards continue from 004 and from G023 / P011.
"""

from cardlib import decision, ev, pair, person, rel, synthesis

D = "dev"
CARDS = []
add = CARDS.append

# ---------------------------------------------------------------- dream_interpretation

# G001: a warning dream before a risky roof job. Variable: the dreamer's piety.
_harold = person(1, "Harold Pike", 81, "male", alive=False, piety=2, warmth=1)
_june = dict(id=2, name="June Pike", age=34, sex="female", wealth=2600, loyalty=1, warmth=1)
_g001_events = [
    ev("e1", 20100, "death", [1]),
    ev("e2", 20200, "offering", [2, 1], magnitude=20, caused_by=["e1"], tags=["joss_paper"]),
    ev("e3", 21400, "dream", [1, 2]),
]
_g001_situation = (
    "June inherited her grandfather Harold's farm after he died. On Saturday she plans to reroof the barn "
    "alone, using Harold's old wooden ladder, which has not been inspected in years. The night before, she "
    "dreams of Harold standing beside a cracked ladder, shaking his head. She wakes at dawn."
)
_g001_input = {"intent": "warn", "content": "Harold stands beside a cracked ladder leaning on the barn and slowly shakes his head."}
_g001_options = [
    ("heed_warning", "Check the ladder, then hire help or postpone the roof job."),
    ("burn_offering", "Burn joss paper for Harold and ask him what he meant."),
    ("dismiss_dream", "Shrug the dream off and reroof the barn as planned."),
    ("read_as_blessing", "Take the dream as Harold blessing the job and start early."),
]
_ca, _cb = pair("P001", "June's piety is +2 in card a and -3 in card b",
                ["heed_warning", "burn_offering"], ["dismiss_dream"])
add(decision(1, "dream_interpretation", "G001", D, tick=21401, subject=2,
             people=[_harold, person(**_june, piety=2)],
             relations=[rel(2, 1, 75, 70, ["grandparent"])],
             events=_g001_events, situation=_g001_situation, player_input=_g001_input,
             options=_g001_options, acceptable=["heed_warning", "burn_offering"], severe=["read_as_blessing"],
             contrast=_ca,
             note="A pious granddaughter who loved Harold takes a warning dream seriously: checking the ladder or asking "
                  "Harold through an offering are both in character. Ignoring it is out of character but not absurd. "
                  "Reading a head-shake beside a cracked ladder as a blessing contradicts the dream."))
add(decision(2, "dream_interpretation", "G001", D, tick=21401, subject=2,
             people=[_harold, person(**_june, piety=-3)],
             relations=[rel(2, 1, 75, 70, ["grandparent"])],
             events=_g001_events, situation=_g001_situation, player_input=_g001_input,
             options=_g001_options, acceptable=["dismiss_dream", "heed_warning"], severe=["read_as_blessing"],
             contrast=_cb,
             note="A dreamer who dismisses ghosts treats it as a dream; being cautious about an old ladder is also "
                  "reasonable without belief. Burning joss paper to ask a ghost is out of character for piety -3. "
                  "The blessing reading contradicts the dream for anyone."))

# G002: a ghost asks his widow for offerings she can barely afford.
add(decision(3, "dream_interpretation", "G002", D, tick=18800, subject=2,
             people=[person(1, "Walter Gray", 74, "male", alive=False, warmth=1),
                     person(2, "Rosa Gray", 71, "female", wealth=40, warmth=2, piety=1, loyalty=2)],
             relations=[rel(2, 1, 70, 65, ["spouse"])],
             events=[ev("e1", 18000, "death", [1]),
                     ev("e2", 18000, "inheritance", [1, 2], magnitude=85000, caused_by=["e1"], tags=["house"]),
                     ev("e3", 18790, "dream", [1, 2])],
             situation=("Walter died two years ago and left Rosa the house and very little money. She has not burned "
                        "joss paper for him since the funeral; she has $40 left until her pension arrives next week. "
                        "Tomorrow is the town's autumn offering day. Tonight she dreamed of Walter."),
             player_input={"intent": "request_offering",
                           "content": "Walter sits in a thin coat beside an empty brazier, shivering, and looks at her."},
             options=[("burn_offering", "Spend most of her $40 on joss paper for Walter tomorrow."),
                      ("burn_small", "Burn a small bundle she can afford and promise more next month."),
                      ("ignore_dream", "Treat it as a dream about the cold weather and do nothing."),
                      ("sell_house", "Sell the house to buy a mountain of joss paper.")],
             acceptable=["burn_offering", "burn_small"], severe=["sell_house"],
             note="A loving, mildly pious widow answers a clear request for offerings within her means. Doing nothing "
                  "is possible but out of character. Selling the house for one dream is absurd."))

# ---------------------------------------------------------------- will_execution

# G003: a will leaves the family shop to an employee. Variable: the heir's greed.
_frank = person(1, "Frank Doyle", 77, "male", alive=False, loyalty=2)
_mark = dict(id=2, name="Mark Doyle", age=41, sex="male", wealth=900, pride=1)
_lena = person(3, "Lena Ortiz", 36, "female", wealth=400, loyalty=2, warmth=1)
_g003_events = [
    ev("e1", 14000, "will", [1, 3], magnitude=60000, tags=["written", "private", "shop"]),
    ev("e2", 15210, "death", [1]),
]
_g003_situation = (
    "Frank's written will leaves his hardware shop to Lena, who worked there for twelve years, and leaves his son "
    "Mark the house. The will is in a drawer only Mark can reach; nobody else has read it. Mark has a steady job "
    "and does not need the shop to live. The town hall asks Mark for the will this week."
)
_g003_options = [
    ("honor_will", "Hand the will to the town hall; Lena gets the shop."),
    ("contest_will", "Hand it in, then contest it, claiming Frank was confused."),
    ("hide_will", "Quietly lose the will so the shop passes to Mark as next of kin."),
    ("offer_buyout", "Hand it in, then offer Lena cash to give the shop back."),
]
_ca, _cb = pair("P002", "Mark's greed is +3 in card a and -3 in card b",
                ["contest_will", "hide_will"], ["honor_will"])
add(decision(1, "will_execution", "G003", D, tick=15220, subject=2,
             people=[_frank, person(**_mark, greed=3), _lena],
             relations=[rel(2, 1, 30, 40, ["parent"]), rel(2, 3, 0, 10, [])],
             events=_g003_events, situation=_g003_situation,
             options=_g003_options, acceptable=["contest_will", "hide_will", "offer_buyout"], severe=[],
             contrast=_ca,
             note="A very greedy heir with a private will is tempted to hide or contest it; a buyout is the lawful "
                  "greedy move. Honoring it is out of character but not absurd, so it is neither acceptable nor severe."))
add(decision(2, "will_execution", "G003", D, tick=15220, subject=2,
             people=[_frank, person(**_mark, greed=-3), _lena],
             relations=[rel(2, 1, 30, 40, ["parent"]), rel(2, 3, 0, 10, [])],
             events=_g003_events, situation=_g003_situation,
             options=_g003_options, acceptable=["honor_will", "offer_buyout"], severe=[],
             contrast=_cb,
             note="An heir indifferent to money and not in need honors his father's will; wanting the family shop "
                  "back for sentimental reasons through a fair buyout is also reasonable. Hiding or contesting is out "
                  "of character."))

# G004: a will with a condition the heir dislikes.
add(decision(3, "will_execution", "G004", D, tick=9300, subject=2,
             people=[person(1, "Agnes Novak", 88, "female", alive=False, piety=3, pride=1),
                     person(2, "Eli Novak", 19, "male", wealth=150, piety=-2, warmth=1, greed=1)],
             relations=[rel(2, 1, 50, 50, ["grandparent"])],
             events=[ev("e1", 8800, "will", [1, 2], magnitude=45000, tags=["written", "witnessed", "house"]),
                     ev("e2", 9280, "death", [1])],
             situation=("Agnes's witnessed will leaves her house to her grandson Eli on one condition: he must keep "
                        "sweeping the family graves and burn joss paper there twice a year. Eli rents a small room "
                        "and has $150. Nobody checks the graves except the groundskeeper, who visits monthly."),
             options=[("accept_and_comply", "Take the house and keep up the graves as the will asks."),
                      ("accept_and_neglect", "Take the house and quietly let the grave duties slide."),
                      ("decline_house", "Decline the house and keep renting his room."),
                      ("dig_up_graves", "Take the house and dig up the graves to end the duty.")],
             acceptable=["accept_and_comply", "accept_and_neglect"], severe=["dig_up_graves"],
             note="A young man with little money takes the house; whether he keeps the duty honestly or lets it "
                  "slide fits his low piety. Declining a free house over light chores is unlikely. Digging up graves "
                  "is absurd and offensive."))

# ---------------------------------------------------------------- reconcile_or_revenge

# G005: a neighbor who wronged her asks for a job. Variable: vindictiveness.
_nora = dict(id=1, name="Nora Quinn", age=52, sex="female", wealth=8000, pride=1)
_beth = person(2, "Beth Lyle", 49, "female", wealth=300, pride=2)
_g005_events = [
    ev("e1", 11000, "accident", [2, 1], magnitude=40),
    ev("e2", 11005, "insult", [2, 1], magnitude=60, caused_by=["e1"], tags=["public"]),
    ev("e3", 12800, "death", [3]),
]
_g005_situation = (
    "Six years ago Beth's dog killed Nora's hens. Beth denied it in front of the whole church, though a neighbor "
    "had seen it; she never paid for the hens. Beth's husband died this spring and she needs work. Today she walks "
    "into Nora's bakery and asks whether the counter job is still open."
)
_g005_people_rest = [_beth, person(3, "Cal Lyle", 55, "male", alive=False)]
_g005_options = [
    ("reconcile", "Give Beth the job and call the hens even."),
    ("keep_away", "Say the job is filled and keep her at a distance."),
    ("public_revenge", "Refuse loudly in front of customers and retell the hen story."),
    ("poison_dog", "Refuse, then poison Beth's dog that night."),
]
_ca, _cb = pair("P003", "Nora's vindictiveness is +3 in card a and -3 in card b",
                ["keep_away", "public_revenge"], ["reconcile"])
add(decision(1, "reconcile_or_revenge", "G005", D, tick=13000, subject=1,
             people=[person(**_nora, vindictiveness=3)] + _g005_people_rest,
             relations=[rel(1, 2, -40, -50, ["neighbor"])],
             events=_g005_events, situation=_g005_situation,
             options=_g005_options, acceptable=["keep_away", "public_revenge"], severe=["poison_dog"],
             contrast=_ca,
             note="Someone who holds grudges refuses; doing it coldly or publicly both fit. Hiring her is out of "
                  "character. Killing an animal over old hens is far beyond the grievance."))
add(decision(2, "reconcile_or_revenge", "G005", D, tick=13000, subject=1,
             people=[person(**_nora, vindictiveness=-3)] + _g005_people_rest,
             relations=[rel(1, 2, -40, -50, ["neighbor"])],
             events=_g005_events, situation=_g005_situation,
             options=_g005_options, acceptable=["reconcile", "keep_away"], severe=["poison_dog"],
             contrast=_cb,
             note="A forgiving woman can let six-year-old hens go and help a new widow; keeping polite distance from "
                  "someone with trust -50 is also reasonable. Public humiliation is out of character. Poisoning the "
                  "dog is absurd."))

# G006: an estranged brother on his deathbed asks to see him.
add(decision(3, "reconcile_or_revenge", "G006", D, tick=24100, subject=1,
             people=[person(1, "Victor Hale", 66, "male", wealth=12000, pride=2, vindictiveness=1, warmth=1),
                     person(2, "Ray Hale", 69, "male", wealth=7000)],
             relations=[rel(1, 2, -30, -20, ["sibling"])],
             events=[ev("e1", 16800, "quarrel", [1, 2], magnitude=70, tags=["land"]),
                     ev("e2", 16820, "lawsuit", [2, 1], magnitude=5000, caused_by=["e1"], tags=["land"]),
                     ev("e3", 24000, "illness", [2])],
             situation=("Twenty years ago Ray sued Victor over their father's pasture and won it. The brothers have not "
                        "spoken since. Ray is now dying in the county hospital and has sent word through a nurse that "
                        "he wants to see Victor before the end of the week."),
             options=[("visit_and_reconcile", "Visit Ray and make peace."),
                      ("send_letter", "Send a short letter instead of visiting."),
                      ("refuse", "Refuse to come."),
                      ("demand_pasture", "Visit only to demand the pasture back before Ray dies.")],
             acceptable=["visit_and_reconcile", "send_letter", "refuse"], severe=["demand_pasture"],
             note="Proud, slightly grudging but not cold: visiting, a guarded letter, or refusal are all believable. "
                  "Using a dying brother's last request to grab land would look grotesque on screen."))

# ---------------------------------------------------------------- debt_repayment

# G007: an overdue written loan. Variable: the debtor's savings.
_tom = dict(id=1, name="Tom Reyes", age=38, sex="male", loyalty=1)
_iris = person(2, "Iris Bloom", 63, "female", wealth=20000, greed=1)
_g007_events = [ev("e1", 7000, "loan", [2, 1], magnitude=1200, tags=["written", "cash"], due=7180)]
_g007_options = [
    ("repay", "Repay the full $1,200 now."),
    ("ask_extension", "Explain and ask Iris for three more months."),
    ("pay_part", "Pay $300 now and promise the rest within two months."),
    ("deny_debt", "Tell Iris the money was a gift."),
]
_ca, _cb = pair("P004", "Tom's savings are $9,000 in card a and $1,300 in card b (rent of $1,100 is due in a week)",
                ["repay"], ["ask_extension", "pay_part"])
add(decision(1, "debt_repayment", "G007", D, tick=7210, subject=1,
             people=[person(**_tom, wealth=9000), _iris],
             relations=[rel(1, 2, 20, 40, ["neighbor"])],
             events=_g007_events,
             situation=("Iris lent Tom $1,200 in cash against a signed note, due a month ago. Tom has $9,000 in "
                        "savings. His rent of $1,100 is due in a week. Iris stops him outside the post office and "
                        "asks about the money."),
             options=_g007_options, acceptable=["repay"], severe=["deny_debt"],
             contrast=_ca,
             note="A mildly loyal man with ample savings pays an overdue signed loan. Stalling is out of character. "
                  "Calling a signed note a gift is absurd."))
add(decision(2, "debt_repayment", "G007", D, tick=7210, subject=1,
             people=[person(**_tom, wealth=1300), _iris],
             relations=[rel(1, 2, 20, 40, ["neighbor"])],
             events=_g007_events,
             situation=("Iris lent Tom $1,200 in cash against a signed note, due a month ago. Tom has $1,300 in "
                        "savings. His rent of $1,100 is due in a week. Iris stops him outside the post office and "
                        "asks about the money."),
             options=_g007_options, acceptable=["repay", "ask_extension", "pay_part"], severe=["deny_debt"],
             contrast=_cb,
             note="Repaying would leave Tom unable to pay rent, so asking for time or paying part is the expected "
                  "move; a loyal man might still repay in full. Calling a signed note a gift is absurd."))

# G008: a debt inherited from a dead father.
add(decision(3, "debt_repayment", "G008", D, tick=10500, subject=2,
             people=[person(1, "Hank Wu", 72, "male", alive=False),
                     person(2, "Grace Wu", 45, "female", wealth=3000, greed=2, pride=2),
                     person(3, "Sam Patel", 58, "male", wealth=15000, warmth=1)],
             relations=[rel(2, 3, 10, 20, [])],
             events=[ev("e1", 9600, "loan", [3, 1], magnitude=800, tags=["written"], due=9960),
                     ev("e2", 10300, "death", [1]),
                     ev("e3", 10300, "inheritance", [1, 2], magnitude=2000, caused_by=["e2"], tags=["cash"]),
                     ev("e4", 10300, "debt_transfer", [1, 2], magnitude=800, caused_by=["e1", "e3"])],
             situation=("Grace's father Hank owed the grocer Sam $800 on a signed note when he died. Under town rules the "
                        "debt passed to Grace along with $2,000 from his estate. Sam sends Grace a polite letter "
                        "asking how she would like to settle it."),
             options=[("repay", "Pay Sam the $800 from the estate money."),
                      ("ask_extension", "Ask Sam for a year to pay."),
                      ("refuse_inherited", "Write back that her father's debts died with him."),
                      ("work_it_off", "Offer to work weekends at the grocery instead.")],
             acceptable=["repay", "ask_extension", "refuse_inherited"], severe=[],
             note="The estate covers the debt, so repaying is natural. A greedy heir may stall or refuse, even though "
                  "town rules transferred the debt. A proud woman with $3,000 working weekends at a grocery is "
                  "unlikely but not absurd."))

# ---------------------------------------------------------------- remarriage

# G009: a widow courted by a kind widower. Variable: time since her husband died.
_clara = person(1, "Clara Finch", 58, "female", wealth=5000, loyalty=1, warmth=1)
_dean = person(2, "Dean Finch", 61, "male", alive=False)
_hugh = person(3, "Hugh Barr", 60, "male", wealth=7000, warmth=2)
_g009_rel = [rel(1, 2, 70, 70, ["spouse"]), rel(1, 3, 55, 50, ["suitor"])]
_g009_options = [
    ("accept", "Accept Hugh's proposal."),
    ("ask_to_wait", "Ask Hugh to wait a year and keep seeing him."),
    ("decline", "Decline and stay a widow."),
    ("elope_tonight", "Run off with Hugh tonight without telling her children."),
]
_ca, _cb = pair("P005", "Dean died four months before the proposal in card a and six years before it in card b",
                ["ask_to_wait", "decline"], ["accept"])
add(decision(1, "remarriage", "G009", D, tick=20000, subject=1,
             people=[_clara, _dean, _hugh], relations=_g009_rel,
             events=[ev("e1", 19880, "death", [2]),
                     ev("e2", 19950, "courtship", [3, 1]),
                     ev("e3", 20000, "courtship", [3, 1], magnitude=80)],
             situation=("Clara's husband Dean died four months ago after thirty years of marriage. Hugh, a widower from "
                        "church, has walked her home every Sunday for seven weeks. Tonight he proposes. Clara's grown "
                        "children live nearby and like Hugh."),
             options=_g009_options, acceptable=["ask_to_wait", "decline"], severe=["elope_tonight"],
             contrast=_ca,
             note="Four months after a long marriage, asking for time or declining is expected. Accepting this fast "
                  "is out of character for a loyal widow but not absurd. Eloping in secret at 58 when her children "
                  "approve makes no sense."))
add(decision(2, "remarriage", "G009", D, tick=20000, subject=1,
             people=[_clara, _dean, _hugh], relations=_g009_rel,
             events=[ev("e1", 17810, "death", [2]),
                     ev("e2", 19950, "courtship", [3, 1]),
                     ev("e3", 20000, "courtship", [3, 1], magnitude=80)],
             situation=("Clara's husband Dean died six years ago after thirty years of marriage. Hugh, a widower from "
                        "church, has walked her home every Sunday for seven weeks. Tonight he proposes. Clara's grown "
                        "children live nearby and like Hugh."),
             options=_g009_options, acceptable=["accept", "ask_to_wait"], severe=["elope_tonight"],
             contrast=_cb,
             note="Six years on, with a suitor she likes and family approval, accepting is natural; asking for more "
                  "time after seven weeks is also reasonable. Declining outright is possible but not expected. "
                  "Secret elopement makes no sense."))

# G010: a widower with small children and his late wife's sister.
add(decision(3, "remarriage", "G010", D, tick=12400, subject=1,
             people=[person(1, "Leo Banks", 35, "male", wealth=2500, warmth=2, loyalty=1),
                     person(2, "Ivy Banks", 31, "female", alive=False),
                     person(3, "Mae Hart", 33, "female", wealth=1800, warmth=2),
                     person(4, "Finn Banks", 6, "male"),
                     person(5, "Rue Banks", 4, "female")],
             relations=[rel(1, 2, 80, 80, ["spouse"]), rel(1, 3, 60, 75, ["in_law"]),
                        rel(1, 4, 90, 60, ["child"]), rel(1, 5, 90, 60, ["child"])],
             events=[ev("e1", 11670, "death", [2]),
                     ev("e2", 11700, "help", [3, 1], magnitude=70, caused_by=["e1"]),
                     ev("e3", 12300, "help", [3, 1], magnitude=70)],
             situation=("Leo's wife Ivy died two years ago, leaving him with Finn, 6, and Rue, 4. Ivy's unmarried sister "
                        "Mae has helped with the children almost every day since. Leo's mother says the children "
                        "need a stepmother and that he should decide this year."),
             options=[("propose_to_mae", "Ask Mae to marry him."),
                      ("stay_single", "Stay single and keep things as they are."),
                      ("court_someone_new", "Start courting the new schoolteacher."),
                      ("send_children_away", "Send the children to an aunt out of state so he can date freely.")],
             acceptable=["propose_to_mae", "stay_single", "court_someone_new"], severe=["send_children_away"],
             note="Any of the three family-centred paths is believable for a warm widower. Sending his small children "
                  "away to date is cruel and absurd for warmth +2."))

# ---------------------------------------------------------------- magistrate_ruling

# G011: a ghost asks to jump the rebirth queue. Variable: a bribe was burned.
_owen = person(1, "Owen Stark", 67, "male", alive=False, pride=1)
_carl = person(2, "Carl Stark", 40, "male", wealth=3000, loyalty=2, piety=2)
_magistrate = dict(id=3, name="Magistrate Lu", age=900, sex="male", origin="official", wealth=0, greed=3, pride=2)
_g011_situation = (
    "Owen died two years ago; Carl is his son. The register places Owen fifth in the rebirth queue, about five years "
    "away. He appeals for the next newborn slot, saying his grandson needs him. The rules let the magistrate grant the "
    "next slot for a fee of 50 joss paper, grant a slot in three years, or deny."
)
_g011_options = [
    ("grant_next_slot", "Grant the next newborn slot for a fee of 50 joss paper."),
    ("grant_later_slot", "Grant a slot in three years, no fee."),
    ("deny", "Deny the appeal; the queue stands."),
    ("strike_from_register", "Strike Owen from the register of souls for asking."),
]
_ca, _cb = pair("P006", "In card a Carl burned 300 joss paper addressed to the magistrate before the hearing; in card b he did not",
                ["grant_next_slot"], ["grant_later_slot", "deny"])
add(decision(1, "magistrate_ruling", "G011", D, tick=9000, subject=3,
             people=[_owen, _carl, person(**_magistrate)],
             relations=[rel(3, 1, 0, 0, []), rel(3, 2, 0, 0, [])],
             events=[ev("e1", 8270, "death", [1]),
                     ev("e2", 8990, "offering", [2, 3], magnitude=300, tags=["joss_paper", "private"]),
                     ev("e3", 9000, "appeal", [1, 3])],
             situation=_g011_situation,
             options=_g011_options, acceptable=["grant_next_slot", "grant_later_slot"], severe=["strike_from_register"],
             contrast=_ca,
             note="A very greedy magistrate who has just received 300 joss paper from the family grants the request, "
                  "or at least a softer slot. Erasing a soul over a polite appeal is absurd."))
add(decision(2, "magistrate_ruling", "G011", D, tick=9000, subject=3,
             people=[_owen, _carl, person(**_magistrate)],
             relations=[rel(3, 1, 0, 0, []), rel(3, 2, 0, 0, [])],
             events=[ev("e1", 8270, "death", [1]),
                     ev("e3", 9000, "appeal", [1, 3])],
             situation=_g011_situation,
             options=_g011_options, acceptable=["grant_later_slot", "deny"], severe=["strike_from_register"],
             contrast=_cb,
             note="Without a gift, a greedy magistrate has no reason to skip the queue: deny, or a modest compromise. "
                  "Granting the next slot for the bare fee is out of character. Erasing a soul is absurd."))

# G012: a ghost complains that another ghost haunts her grandson.
add(decision(3, "magistrate_ruling", "G012", D, tick=16500, subject=4,
             people=[person(1, "Ruth Coles", 79, "female", alive=False, warmth=2),
                     person(2, "Silas Grim", 64, "male", alive=False, vindictiveness=3),
                     person(3, "Ben Coles", 22, "male", wealth=600),
                     person(4, "Magistrate Fen", 700, "female", origin="official", loyalty=2, pride=1)],
             relations=[rel(4, 1, 10, 30, []), rel(4, 2, -10, -20, [])],
             events=[ev("e1", 15000, "death", [1]),
                     ev("e2", 15800, "death", [2]),
                     ev("e3", 16300, "haunting", [2, 3], magnitude=60, tags=["witnessed"]),
                     ev("e4", 16420, "haunting", [2, 3], magnitude=70, tags=["witnessed"]),
                     ev("e5", 16500, "appeal", [1, 4], caused_by=["e3", "e4"])],
             situation=("Ruth appeals that the ghost Silas has haunted her grandson Ben twice this year. Both hauntings "
                        "were seen by a clerk of the underworld office. Silas once lost a fence dispute to Ben's "
                        "father. Ben has done nothing to Silas. The rules allow a fine of up to 100 joss paper."),
             options=[("fine_haunter", "Fine Silas 100 joss paper, paid to Ruth, and order him to stop."),
                      ("warn_haunter", "Warn Silas to stop, no fine."),
                      ("dismiss", "Dismiss the appeal for lack of proof."),
                      ("fine_appellant", "Fine Ruth 100 joss paper for a false appeal.")],
             acceptable=["fine_haunter", "warn_haunter"], severe=["fine_appellant"],
             note="The hauntings are witnessed by the office itself, so a rule-minded magistrate acts against Silas. "
                  "Dismissing for lack of proof contradicts the record. Punishing Ruth for a proven complaint is absurd."))

# ---------------------------------------------------------------- sanity (decision)

_amy = person(1, "Amy Rowe", 30, "female", wealth=4000, loyalty=3, warmth=3)
_ken = person(2, "Ken Ito", 50, "male", wealth=6000, warmth=2)
add(decision(1, "sanity", "G013", D, tick=3000, subject=1, scored=False,
             people=[_amy, _ken], relations=[rel(1, 2, 60, 70, ["neighbor"])],
             events=[ev("e1", 2990, "help", [2, 1], magnitude=50)],
             situation="Amy lost her wallet on Main Street. Her neighbor Ken found it and brings it to her door with all the cash still inside.",
             options=[("thank_him", "Thank Ken warmly."),
                      ("accuse_him", "Accuse Ken of stealing it.")],
             acceptable=["thank_him"], severe=["accuse_him"],
             note="Sanity: the only reasonable response is thanks."))
add(decision(2, "sanity", "G013", D, tick=3100, subject=1, scored=False,
             people=[_amy, _ken], relations=[rel(1, 2, 60, 70, ["neighbor"])],
             events=[ev("e1", 3080, "loan", [2, 1], magnitude=20, tags=["cash", "verbal"], due=3100)],
             situation="Ken lent Amy $20 for groceries last month and asked for it back today. Amy has $4,000 in the bank and likes Ken.",
             options=[("repay", "Pay Ken back the $20."),
                      ("deny_loan", "Say she never borrowed anything.")],
             acceptable=["repay"], severe=["deny_loan"],
             note="Sanity: a loyal, well-off neighbor repays $20."))

# ---------------------------------------------------------------- grudge_detection

_GRUDGE_SEVERE = ["invented_event_id", "invented_person", "self_reference", "reversed_direction", "contradicts_fact"]

# G015: an insult at a funeral. Variable: whether the insulter later apologized.
_g015_people = [person(1, "Ada Moss", 50, "female"), person(2, "Roy Moss", 47, "male"),
                person(3, "Cy Lane", 60, "male"), person(4, "Hazel Moss", 82, "female", alive=False)]
_g015_base = [
    ev("e100", 16990, "death", [4]),
    ev("e101", 16995, "help", [3, 1], magnitude=60, caused_by=["e100"]),
    ev("e102", 17000, "insult", [2, 1], magnitude=80, caused_by=["e100"], tags=["public"]),
    ev("e103", 17000, "quarrel", [1, 2], magnitude=70, caused_by=["e102"], tags=["public"]),
]
_g015_situation = (
    "Ada and Roy are siblings; Hazel was their mother. Cy is a neighbor. The log covers the weeks around Hazel's "
    "funeral and the year after."
)
_ca, _cb = pair(
    "P007", "Card b adds Roy's public apology to Ada and a gift to her, months after the funeral",
    {"include": [{"from": 1, "to": 2, "level": ["medium", "high"]}], "exclude": []},
    {"include": [], "exclude": [{"from": 1, "to": 2, "level": ["medium", "high"]}]},
)
add(synthesis(1, "grudge_detection", "G015", D, tick=17400, people=_g015_people, relations=[],
              events=_g015_base, situation=_g015_situation, schema="grudge_v1",
              must=[{"from": 1, "to": 2, "level": ["medium", "high"], "evidence_any": ["e102", "e103"]}],
              must_not=[{"from": 1, "to": 3}],
              severe_conditions=_GRUDGE_SEVERE,
              severe_patterns=[("reversed_direction", {"from": 2, "to": 1, "level": "high"}),
                               ("contradicts_fact", {"from": 1, "to": 3, "level": ["medium", "high"]})],
              contrast=_ca,
              note="A public insult at her mother's funeral, never repaired, leaves Ada with a real grudge against Roy. "
                   "Cy only helped Ada. Roy was the aggressor, so a high grudge from Roy to Ada reverses the story."))
add(synthesis(2, "grudge_detection", "G015", D, tick=17400, people=_g015_people, relations=[],
              events=_g015_base + [
                  ev("e104", 17200, "apology", [2, 1], magnitude=70, caused_by=["e102"], tags=["public"]),
                  ev("e105", 17200, "gift", [2, 1], magnitude=200, caused_by=["e104"])],
              situation=_g015_situation, schema="grudge_v1",
              must=[],
              must_not=[{"from": 1, "to": 2, "level": "high"}, {"from": 1, "to": 3}],
              severe_conditions=_GRUDGE_SEVERE,
              severe_patterns=[("reversed_direction", {"from": 2, "to": 1, "level": "high"}),
                               ("contradicts_fact", {"from": 1, "to": 3, "level": ["medium", "high"]})],
              contrast=_cb,
              note="After a public apology and a gift, a lingering low grudge or none is reasonable; medium is "
                   "tolerated by the gold but fails the pair direction; high ignores the apology."))

# G016: a private theft blamed on the newcomer.
add(synthesis(3, "grudge_detection", "G016", D, tick=9300,
              people=[person(1, "Kurt Vale", 30, "male", origin="possessed"),
                      person(2, "Lisa Webb", 45, "female"),
                      person(3, "Moe Grant", 70, "male")],
              relations=[],
              events=[ev("e201", 9000, "possession", [1]),
                      ev("e202", 9100, "theft", [3, 2], magnitude=60, tags=["private"]),
                      ev("e203", 9100, "insult", [2, 1], magnitude=70, caused_by=["e202"], tags=["public"]),
                      ev("e204", 9150, "lawsuit", [2, 1], magnitude=300, caused_by=["e203"], tags=["public"]),
                      ev("e205", 9250, "help", [3, 1], magnitude=20)],
              situation=("Kurt arrived in town this year in a body assigned by the underworld office. The theft of Lisa's "
                         "toolbox was private: neither Lisa nor Kurt knows who took it. Lisa blamed Kurt in public and "
                         "sued him."),
              schema="grudge_v1",
              must=[{"from": 1, "to": 2, "level": ["medium", "high"], "evidence_any": ["e203", "e204"]}],
              must_not=[{"from": 2, "to": 3}, {"from": 1, "to": 3}],
              severe_conditions=["invented_event_id", "invented_person", "self_reference"],
              note="Kurt was publicly accused and sued for something he did not do, so he resents Lisa. The theft was "
                   "private, so neither Lisa nor Kurt knows Moe did it; a grudge against Moe uses knowledge the "
                   "characters do not have. A grudge from Lisa to Kurt (she believes he stole) is allowed but not "
                   "required."))

# ---------------------------------------------------------------- debt_chain

_DEBT_SEVERE = ["invented_event_id", "invented_person", "self_reference", "reversed_direction",
                "wrong_debt_holder", "contradicts_fact"]

# G017: a debt passes to a daughter. Variable: the lender forgives it.
_g017_people = [person(1, "Ned Ford", 60, "male"), person(2, "Otto Lake", 66, "male", alive=False),
                person(3, "Pia Lake", 34, "female"), person(4, "Rhea Lake", 62, "female")]
_g017_base = [
    ev("e301", 12000, "loan", [1, 2], magnitude=3000, tags=["written"], due=12365),
    ev("e302", 12200, "repayment", [2, 1], magnitude=1000, caused_by=["e301"], tags=["partial"]),
    ev("e303", 12500, "death", [2]),
    ev("e304", 12500, "inheritance", [2, 3], magnitude=5000, caused_by=["e303"], tags=["house"]),
    ev("e305", 12500, "debt_transfer", [2, 3], magnitude=2000, caused_by=["e301", "e304"]),
]
_g017_situation = (
    "Otto borrowed from Ned and later died. Pia is Otto's daughter and sole heir. Rhea is Otto's sister; she "
    "inherited nothing. Under town rules an heir takes on the dead person's debts."
)
_ca, _cb = pair(
    "P008", "Card b adds Ned forgiving Pia's inherited debt",
    {"include": [{"debtor": 3, "creditor": 1, "status": "open"}], "exclude": [{"debtor": 3, "status": "forgiven"}]},
    {"include": [{"debtor": 3, "creditor": 1, "status": "forgiven"}], "exclude": [{"debtor": 3, "status": "open"}]},
)
_g017_severe_patterns = [
    ("wrong_debt_holder", {"debtor": 4}),
    ("reversed_direction", {"debtor": 1, "creditor": [2, 3]}),
    ("contradicts_fact", {"debtor": 2, "status": "open"}),
]
add(synthesis(1, "debt_chain", "G017", D, tick=12700, people=_g017_people, relations=[],
              events=_g017_base, situation=_g017_situation, schema="debt_chain_v1",
              must=[{"debtor": 2, "creditor": 1, "status": "transferred", "origin_event": "e301"},
                    {"debtor": 3, "creditor": 1, "status": "open", "amount": 2000, "origin_event": "e301",
                     "transferred_from": 2, "evidence_any": ["e305"]}],
              must_not=[{"debtor": 4}, {"debtor": 2, "status": "open"}],
              severe_conditions=_DEBT_SEVERE, severe_patterns=_g017_severe_patterns, contrast=_ca,
              note="$3,000 minus a $1,000 partial repayment leaves $2,000, which passed to Pia at Otto's death. Rhea "
                   "never owed anything. Otto's own obligation is closed by the transfer."))
add(synthesis(2, "debt_chain", "G017", D, tick=12700, people=_g017_people, relations=[],
              events=_g017_base + [ev("e306", 12600, "debt_forgiven", [1, 3], magnitude=2000, caused_by=["e305"])],
              situation=_g017_situation, schema="debt_chain_v1",
              must=[{"debtor": 3, "creditor": 1, "status": "forgiven", "origin_event": "e301", "evidence_any": ["e306"]}],
              must_not=[{"debtor": 4}, {"debtor": 2, "status": "open"}, {"debtor": 3, "status": "open"}],
              severe_conditions=_DEBT_SEVERE, severe_patterns=_g017_severe_patterns, contrast=_cb,
              note="Same chain, but Ned forgave Pia's $2,000, so nothing is open. Listing Otto's transferred "
                   "obligation is optional here."))

# G018: two loans in a row, partly settled on the same day.
add(synthesis(3, "debt_chain", "G018", D, tick=6400,
              people=[person(1, "Sue Park", 55, "female"), person(2, "Tim Cole", 40, "male"),
                      person(3, "Uma Reed", 29, "female")],
              relations=[],
              events=[ev("e401", 6000, "loan", [1, 2], magnitude=500, tags=["verbal", "cash"], due=6200),
                      ev("e402", 6050, "loan", [2, 3], magnitude=400, tags=["verbal", "cash"], due=6250),
                      ev("e403", 6240, "repayment", [3, 2], magnitude=400, caused_by=["e402"]),
                      ev("e404", 6240, "repayment", [2, 1], magnitude=400, caused_by=["e401", "e403"], tags=["partial"])],
              situation=("Sue lent Tim money; a few weeks later Tim lent Uma money. On one day Uma paid Tim back and Tim "
                         "passed the cash on to Sue."),
              schema="debt_chain_v1",
              must=[{"debtor": 2, "creditor": 1, "status": "open", "amount": 100, "origin_event": "e401"},
                    {"debtor": 3, "creditor": 2, "status": "repaid", "origin_event": "e402"}],
              must_not=[{"debtor": 3, "creditor": 1}, {"debtor": 3, "status": "open"}],
              severe_conditions=["invented_event_id", "invented_person", "self_reference", "reversed_direction",
                                 "wrong_debt_holder"],
              severe_patterns=[("wrong_debt_holder", {"debtor": 3, "creditor": 1}),
                               ("reversed_direction", {"debtor": 1})],
              note="Tim still owes Sue $100. Uma repaid Tim in full and never owed Sue anything; making Uma Sue's "
                   "debtor invents a debt."))

# ---------------------------------------------------------------- broken_promise

_PROMISE_SEVERE = ["invented_event_id", "invented_person", "self_reference", "reversed_direction",
                   "contradicts_fact"]

# G019: a deathbed promise to pay a granddaughter's school fees. Variable: whether it was kept.
_g019_people = [person(1, "Vera Nash", 74, "female", alive=False), person(2, "Wes Nash", 45, "male"),
                person(3, "Zoe Nash", 16, "female")]
_g019_base = [
    ev("e501", 20000, "promise", [2, 3], magnitude=1500, tags=["deathbed", "witnessed", "verbal"], due=20400),
    ev("e502", 20010, "death", [1]),
    ev("e503", 20010, "inheritance", [1, 2], magnitude=9000, caused_by=["e502"], tags=["house"]),
    ev("e504", 20200, "promise", [3, 2], magnitude=0, tags=["verbal"], due=20600),
]
_g019_situation = (
    "At his mother Vera's deathbed, Wes promised his niece Zoe that he would pay her $1,500 school fees before the "
    "school year starts. Later Zoe promised Wes she would paint his fence before winter. The log ends in early autumn."
)
_ca, _cb = pair(
    "P009", "Card b adds Wes paying the $1,500 before the due day",
    {"include": [{"promise_event": "e501", "status": "broken"}], "exclude": []},
    {"include": [], "exclude": [{"promise_event": "e501", "status": ["broken", "pending"]}]},
)
_g019_patterns = [("reversed_direction", {"promise_event": "e501", "promisor": 3}),
                  ("contradicts_fact", {"promisor": 1})]
add(synthesis(1, "broken_promise", "G019", D, tick=20500, people=_g019_people, relations=[],
              events=_g019_base, situation=_g019_situation, schema="broken_promise_v1",
              must=[{"promisor": 2, "promisee": 3, "promise_event": "e501", "status": "broken"},
                    {"promisor": 3, "promisee": 2, "promise_event": "e504", "status": "pending"}],
              must_not=[{"promise_event": "e504", "status": "broken"}],
              severe_conditions=_PROMISE_SEVERE, severe_patterns=_g019_patterns, contrast=_ca,
              note="The fees were due on day 20400 and nothing was paid by day 20500: broken. Zoe's fence promise is "
                   "not due yet: pending. Vera made no promise."))
add(synthesis(2, "broken_promise", "G019", D, tick=20500, people=_g019_people, relations=[],
              events=_g019_base + [ev("e505", 20390, "promise_kept", [2, 3], magnitude=1500, caused_by=["e501"])],
              situation=_g019_situation, schema="broken_promise_v1",
              must=[{"promisor": 3, "promisee": 2, "promise_event": "e504", "status": "pending"}],
              must_not=[{"promise_event": "e501", "status": ["broken", "pending"]},
                        {"promise_event": "e504", "status": "broken"}],
              severe_conditions=_PROMISE_SEVERE, severe_patterns=_g019_patterns, contrast=_cb,
              note="Wes paid in full ten days before the due day, so the deathbed promise is kept (listing it is "
                   "optional). The fence promise is still pending."))

# G020: a roof repair done only in part.
add(synthesis(3, "broken_promise", "G020", D, tick=5200,
              people=[person(1, "Ian Frost", 28, "male", origin="rebuilt"), person(2, "Jude Marsh", 61, "male")],
              relations=[],
              events=[ev("e601", 4900, "rebuild", [1]),
                      ev("e602", 5000, "promise", [2, 1], magnitude=100, tags=["verbal"], due=5030),
                      ev("e603", 5010, "promise", [1, 2], magnitude=0, tags=["verbal"], due=5100),
                      ev("e604", 5030, "promise_kept", [2, 1], magnitude=100, caused_by=["e602"]),
                      ev("e605", 5090, "promise_kept", [1, 2], magnitude=0, caused_by=["e603"], tags=["partial"]),
                      ev("e606", 5090, "quarrel", [2, 1], magnitude=50, caused_by=["e605"])],
              situation=("Ian came to town in a rebuilt body and rents a room from Jude. Jude promised to lower the rent by "
                         "$100 for one month. Ian promised to repair the whole roof by the end of the season but fixed "
                         "only the front half."),
              schema="broken_promise_v1",
              must=[{"promisor": 1, "promisee": 2, "promise_event": "e603", "status": "broken"}],
              must_not=[{"promise_event": "e602", "status": ["broken", "pending"]}],
              severe_conditions=["invented_event_id", "invented_person", "self_reference", "reversed_direction",
                                 "contradicts_fact"],
              severe_patterns=[("reversed_direction", {"promise_event": "e603", "promisor": 2}),
                               ("contradicts_fact", {"promise_event": "e602", "status": "broken"})],
              note="A partial repair by the due day counts as broken under the schema. Jude kept his rent promise on "
                   "time, so calling it broken contradicts the log."))

# ---------------------------------------------------------------- relationship_shift

_SHIFT_SEVERE = ["invented_event_id", "invented_person", "self_reference", "contradicts_fact"]

# G021: friendly neighbors, then one event. Variable: the event is a theft or a gift.
_g021_people = [person(1, "Kay Dorn", 40, "female"), person(2, "Lou Pratt", 42, "male")]
_g021_situation = "Kay and Lou are next-door neighbors. The log covers about two years."
_ca, _cb = pair(
    "P010", "Event e703 is a witnessed theft by Lou from Kay in card a and a gift from Lou to Kay in card b",
    {"include": [{"a": 1, "b": 2, "direction": ["colder", "reversed"]}], "exclude": [{"a": 1, "b": 2, "direction": "warmer"}]},
    {"include": [{"a": 1, "b": 2, "direction": "warmer"}], "exclude": [{"a": 1, "b": 2, "direction": ["colder", "reversed"]}]},
)
add(synthesis(1, "relationship_shift", "G021", D, tick=3600, people=_g021_people, relations=[],
              events=[ev("e701", 3000, "help", [2, 1], magnitude=60),
                      ev("e702", 3000, "gift", [1, 2], magnitude=40, caused_by=["e701"]),
                      ev("e703", 3500, "theft", [2, 1], magnitude=80, tags=["witnessed"])],
              situation=_g021_situation, schema="relationship_shift_v1",
              must=[{"a": 1, "b": 2, "direction": ["colder", "reversed"], "turning_point": "e703"}],
              must_not=[{"a": 1, "b": 2, "direction": ["warmer", "unchanged"]}],
              severe_conditions=_SHIFT_SEVERE,
              severe_patterns=[("contradicts_fact", {"a": 1, "b": 2, "direction": "warmer"})],
              contrast=_ca,
              note="Help and a thank-you gift, then a witnessed theft: the relationship turns hostile at e703."))
add(synthesis(2, "relationship_shift", "G021", D, tick=3600, people=_g021_people, relations=[],
              events=[ev("e701", 3000, "help", [2, 1], magnitude=60),
                      ev("e702", 3000, "gift", [1, 2], magnitude=40, caused_by=["e701"]),
                      ev("e703", 3500, "gift", [2, 1], magnitude=80, tags=["witnessed"])],
              situation=_g021_situation, schema="relationship_shift_v1",
              must=[{"a": 1, "b": 2, "direction": "warmer"}],
              must_not=[{"a": 1, "b": 2, "direction": ["colder", "reversed"]}],
              severe_conditions=_SHIFT_SEVERE,
              severe_patterns=[("contradicts_fact", {"a": 1, "b": 2, "direction": ["colder", "reversed"]})],
              contrast=_cb,
              note="Every event is friendly, so the relationship only grows warmer. The turning point is not scored."))

# G022: a father-in-law and the man his daughter married.
add(synthesis(3, "relationship_shift", "G022", D, tick=2000,
              people=[person(1, "Nell Ash", 25, "female"), person(2, "Omar Kidd", 27, "male"),
                      person(3, "Pete Ash", 58, "male")],
              relations=[],
              events=[ev("e801", 1000, "quarrel", [3, 1], magnitude=60),
                      ev("e802", 1000, "insult", [3, 2], magnitude=70, tags=["public"]),
                      ev("e803", 1400, "marriage", [1, 2]),
                      ev("e804", 1800, "illness", [3]),
                      ev("e805", 1810, "help", [2, 3], magnitude=80, caused_by=["e804"]),
                      ev("e806", 1810, "apology", [3, 2], magnitude=70, caused_by=["e805"])],
              situation=("Pete is Nell's father. Pete opposed Nell's courtship with Omar; they married anyway. Two years "
                         "later Pete fell ill."),
              schema="relationship_shift_v1",
              must=[{"a": 3, "b": 2, "direction": ["warmer", "reversed"], "turning_point": ["e805", "e806"]}],
              must_not=[{"a": 1, "b": 2, "direction": ["colder", "reversed"]}],
              severe_conditions=_SHIFT_SEVERE,
              severe_patterns=[("contradicts_fact", {"a": 3, "b": 2, "direction": "colder"})],
              note="Pete and Omar start hostile (public insult) and end reconciled after Omar nursed him and Pete "
                   "apologized. Nell and Omar married, so calling their relationship colder contradicts the log."))

# ---------------------------------------------------------------- sanity (synthesis)

_g014_people = [person(1, "Bob Hall", 40, "male"), person(2, "Gus Dunn", 41, "male"),
                person(3, "Dana Price", 50, "female"), person(4, "Eve Shaw", 33, "female")]
add(synthesis(1, "sanity", "G014", D, tick=200, scored=False, people=_g014_people, relations=[],
              events=[ev("e1", 100, "theft", [1, 2], magnitude=90, tags=["witnessed", "public"]),
                      ev("e2", 100, "insult", [1, 2], magnitude=80, caused_by=["e1"], tags=["public"])],
              situation="Bob robbed Gus in public and mocked him while doing it.",
              schema="grudge_v1",
              must=[{"from": 2, "to": 1, "level": ["medium", "high"], "evidence_any": ["e1", "e2"]}],
              must_not=[{"from": 3}, {"from": 4}],
              severe_conditions=["invented_event_id", "invented_person", "self_reference", "reversed_direction"],
              severe_patterns=[("reversed_direction", {"from": 1, "to": 2})],
              note="Sanity: the robbed man resents the robber; Dana and Eve are not involved."))
add(synthesis(2, "sanity", "G014", D, tick=400, scored=False, people=_g014_people, relations=[],
              events=[ev("e1", 200, "loan", [3, 4], magnitude=500, tags=["written"], due=380),
                      ev("e2", 350, "repayment", [4, 3], magnitude=500, caused_by=["e1"]),
                      ev("e3", 350, "gift", [4, 3], magnitude=20, caused_by=["e2"])],
              situation="Dana lent Eve money and Eve paid it all back early, with a small thank-you gift.",
              schema="debt_chain_v1",
              must=[{"debtor": 4, "creditor": 3, "status": "repaid", "origin_event": "e1"}],
              must_not=[{"debtor": 4, "status": "open"}, {"debtor": 1}, {"debtor": 2}],
              severe_conditions=["invented_event_id", "invented_person", "self_reference", "reversed_direction"],
              severe_patterns=[("reversed_direction", {"debtor": 3, "creditor": 4})],
              note="Sanity: a fully repaid loan."))
