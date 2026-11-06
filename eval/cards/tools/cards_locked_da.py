"""Locked cards, writer da: dream_interpretation and will_execution.

Scenario groups G023..G028 and G087 (dreams), G029..G034 and G088 (wills); contrast pairs P011..P016.
Card numbers run 004..013 in each family. Data only: tools/build_cards.py renders it.
"""

from cardlib import decision, ev, pair, person, rel, synthesis

L = "locked"
CARDS = []
add = CARDS.append

# ---------------------------------------------------------------- dream_interpretation

# G023: a warning dream about a night haul on a road that floods. Variable: the dreamer's piety.
_otis = person(1, "Otis Abbott", 78, "male", alive=False, piety=2, warmth=1)
_reba = dict(id=2, name="Reba Abbott", age=44, sex="female", wealth=340, loyalty=2, warmth=1, piety=2)
_curtis = person(3, "Curtis Abbott", 17, "male", temper=1)
_g023_people = [_otis, person(**_reba), _curtis]
_g023_relations = [rel(2, 1, 70, 65, ["parent"]), rel(2, 3, 80, 70, ["child"]), rel(3, 1, 55, 45, ["grandparent"])]
_g023_events = [
    ev("e1", 27900, "death", [1]),
    ev("e2", 27905, "offering", [2, 1], magnitude=20, caused_by=["e1"], tags=["joss_paper"]),
    ev("e3", 28995, "dream", [1, 2]),
]
_g023_situation = (
    "Otis Abbott died three winters ago. His grandson Curtis, 17, drives the grain truck at night and hauls a load "
    "tomorrow down the low road; the $180 the week pays covers the family's coal. The low road floods in wet years, "
    "and this autumn has been wet. Reba has burned no joss paper since the funeral. She wakes from the dream at dawn."
)
_g023_input = {"intent": "warn",
               "content": "Otis stands waist-deep in brown water with one hand raised. He says: not the low road, "
                          "Reba. Not with the boy in it."}
_g023_options = [
    ("keep_home", "Keep Curtis home from the run and lose the week's pay."),
    ("burn_offering", "Burn joss paper and ask Otis what he saw on the road."),
    ("check_road", "Walk the low road herself before Curtis leaves."),
    ("send_him", "Let Curtis take the load as planned."),
    ("burn_coat", "Burn Otis's coat and tools so he stops sending dreams."),
]
_ca, _cb = pair("P011", "Reba's piety is +2 in card a and -3 in card b",
                ["keep_home", "burn_offering"], ["send_him"])
add(decision(4, "dream_interpretation", "G023", L, tick=28995, subject=2,
             people=_g023_people, relations=_g023_relations, events=_g023_events,
             situation=_g023_situation, player_input=_g023_input,
             options=_g023_options,
             acceptable=["keep_home", "burn_offering", "check_road"], severe=["burn_coat"],
             contrast=_ca,
             note="A devout daughter who revered Otis acts on a plain warning about water: she keeps the boy "
                  "home at the cost of the week's pay, or asks Otis through an offering. Walking the road first is "
                  "prudent and in character. Burning his coat is an offense to the dead and absurd, so severe."))
add(decision(5, "dream_interpretation", "G023", L, tick=28995, subject=2,
             people=[_otis, person(**{**_reba, "piety": -3}), _curtis],
             relations=_g023_relations, events=_g023_events,
             situation=_g023_situation, player_input=_g023_input,
             options=_g023_options,
             acceptable=["send_him", "check_road"], severe=["burn_coat"],
             contrast=_cb,
             note="With piety -3 Reba treats a dream as nothing, so the load goes out as planned; a look at the road "
                  "is cheap caution she might still take. Losing $180 or burning joss paper over a dream is out of "
                  "character, and burning Otis's things stays absurd."))

# G024: a prohibition dream over a woodlot that would pay the tax. Two options, no severe.
_amos = person(1, "Amos Bishop", 71, "male", alive=False, pride=2, warmth=1)
_fern = person(2, "Fern Bishop", 63, "female", wealth=200, piety=2, loyalty=3, pride=1)
add(decision(6, "dream_interpretation", "G024", L, tick=28230, subject=2,
             people=[_amos, _fern],
             relations=[rel(2, 1, 85, 80, ["spouse"])],
             events=[ev("e1", 26400, "death", [1]),
                     ev("e2", 26405, "offering", [2, 1], magnitude=15, caused_by=["e1"], tags=["joss_paper"]),
                     ev("e3", 28230, "dream", [1, 2])],
             situation=("Amos Bishop planted the birches on the south lot himself. Since he died five years ago Fern "
                        "has left the woodlot untouched. A logger has offered $4,000 for the standing timber and the "
                        "offer closes Friday. Fern owes $900 in property tax by the end of the month and has $200 in "
                        "the bank. She dreamed of Amos last night."),
             player_input={"intent": "forbid",
                           "content": "Amos stands at the edge of the birches with his arms crossed, blocking the "
                                      "path. He says: not these trees, Fern."},
             options=[("refuse_sale", "Turn down the timber offer and find another way to pay the tax."),
                      ("sell_timber", "Sign the logger's offer and pay the tax with the money.")],
             acceptable=["refuse_sale"], severe=[],
             note="A devoted widow who has kept his woodlot untouched for five years reads a plain prohibition as "
                  "Amos's word and gives up $4,000 rather than cut the trees, even with tax due. Selling is "
                  "understandable but out of character for her. Nothing here would look absurd, so severe is empty."))

# G087: a revealing dream about a brother's estate. Five options.
_pearl = person(1, "Pearl Blake", 74, "female", alive=False, loyalty=2, warmth=1)
_dexter = person(2, "Dexter Blake", 46, "male", wealth=5200, greed=2, pride=1)
_della = person(3, "Della Blake", 49, "female", wealth=900, loyalty=2, pride=2, warmth=1)
add(decision(7, "dream_interpretation", "G087", L, tick=28800, subject=3,
             people=[_pearl, _dexter, _della],
             relations=[rel(3, 1, 75, 70, ["parent"]), rel(2, 1, 55, 40, ["parent"]), rel(3, 2, -20, -30, ["sibling"])],
             events=[ev("e1", 28435, "death", [1]),
                     ev("e2", 28470, "inheritance", [1, 2], magnitude=6000, caused_by=["e1"], tags=["cash", "written"]),
                     ev("e3", 28800, "dream", [1, 3])],
             situation=("Pearl Blake died last spring. Her son Dexter settled the estate, told his sister Della that "
                        "after debts it came to $3,000, and paid her $1,500. Della never saw an inventory. The "
                        "mattress from Pearl's room is still folded in Della's attic. Della dreamed of her mother "
                        "last night."),
             player_input={"intent": "reveal",
                           "content": "Pearl sits on the edge of the bed and says: the money was sewn into the "
                                      "mattress ticking, Della. Dexter took it out the night before the funeral."},
             options=[("check_mattress", "Cut open the mattress ticking and check whether the seam was opened."),
                      ("confront_dexter", "Tell Dexter what the dream said and ask him to explain."),
                      ("accuse_church", "Accuse Dexter of taking the money in front of the congregation on Sunday."),
                      ("let_it_go", "Treat it as a dream and say nothing to anyone."),
                      ("break_in", "Break into Dexter's house at night and search it for the money.")],
             acceptable=["check_mattress", "confront_dexter"], severe=["break_in"],
             note="A proud, loyal daughter takes a named and checkable claim from her mother seriously: she cuts the "
                  "ticking open or puts it to Dexter. Denouncing her brother before the congregation on the word of a "
                  "dream, before anyone has looked at the seam, shames her own family and is too much for a woman who "
                  "does not hold grudges. Saying nothing is out of character for a proud woman who has just been told "
                  "her brother kept $4,500 of their mother's money. Breaking in at night is absurd when the seam can "
                  "be checked at home."))

# G025: a ghost asks for a gravestone. Variable: whether the dreamer can pay for it.
_nettie = person(1, "Nettie Boone", 72, "female", alive=False, warmth=1, pride=1)
_selma = dict(id=2, name="Selma Boone", age=45, sex="female", loyalty=2, warmth=1, piety=1)
_roland = person(3, "Roland Briggs", 50, "male", wealth=8000, pride=1)
_g025_people_a = [_nettie, person(**_selma, wealth=2400, greed=-1), _roland]
_g025_people_b = [_nettie, person(**_selma, wealth=140, greed=-1), _roland]
_g025_relations = [rel(2, 1, 80, 70, ["parent"]), rel(2, 3, 20, 40, ["neighbor"])]
_g025_events = [
    ev("e1", 26000, "death", [1]),
    ev("e2", 26010, "offering", [2, 1], magnitude=10, caused_by=["e1"], tags=["joss_paper"]),
    ev("e3", 27825, "dream", [1, 2]),
]
_g025_input = {"intent": "urge",
               "content": "Nettie stands beside a slab of gray stone and runs her hand over letters cut into it. "
                          "She says: I would like my name where people can read it."}
_g025_options = [
    ("buy_stone", "Pay Roland the $600 and have the stone set this week."),
    ("pay_terms", "Ask Roland to hold the stone and take $50 a month."),
    ("keep_board", "Keep the painted board and let the grave stand as it is."),
]
_g025_sit_a = (
    "Nettie Boone died five years ago and her grave still has a painted board for a marker. Roland Briggs has cut "
    "a granite stone with her name on it for $600 and will sell it to another family in a week. Selma has $2,400 in "
    "the bank and her rent is paid through the winter. She dreamed of her mother last night."
)
_g025_sit_b = (
    "Nettie Boone died five years ago and her grave still has a painted board for a marker. Roland Briggs has cut "
    "a granite stone with her name on it for $600 and will sell it to another family in a week. Selma has $140 in "
    "the bank and $90 of coal is due next week. She dreamed of her mother last night."
)
_ca, _cb = pair("P012", "Selma's savings are $2,400 with rent paid in card a and $140 with $90 of coal due next week in card b",
                ["buy_stone"], ["pay_terms"])
add(decision(8, "dream_interpretation", "G025", L, tick=27825, subject=2,
             people=_g025_people_a, relations=_g025_relations, events=_g025_events,
             situation=_g025_sit_a, player_input=_g025_input,
             options=_g025_options,
             acceptable=["buy_stone", "pay_terms"], severe=[],
             contrast=_ca,
             note="With $2,400 in the bank and the stone about to go to another family, a warm daughter pays the "
                  "$600 for the marker her mother asked for. Asking for terms is possible but less expected with the "
                  "money in hand. Keeping the board ignores the request, and nothing here is absurd."))
add(decision(9, "dream_interpretation", "G025", L, tick=27825, subject=2,
             people=_g025_people_b, relations=_g025_relations, events=_g025_events,
             situation=_g025_sit_b, player_input=_g025_input,
             options=_g025_options,
             acceptable=["pay_terms", "keep_board"], severe=[],
             contrast=_cb,
             note="With $140 left and coal due, paying $600 now is not possible: asking Roland to hold the stone on "
                  "a monthly sum is the in-character move, and letting the board stand another year is a believable "
                  "retreat. Nothing here is absurd."))

# G026: a warning about a hired man's pipe in the hayloft. Variable: a corroborating accident.
_merton = person(1, "Merton Carver", 70, "male", alive=False, temper=1, warmth=1)
_verna = person(2, "Verna Carver", 58, "female", wealth=3400, piety=2, loyalty=1, warmth=1)
_arnie = person(3, "Arnie Conley", 31, "male", wealth=120, temper=1, greed=1)
_g026_relations = [rel(2, 1, 85, 80, ["spouse"]), rel(2, 3, 10, 30, ["employee"])]
_g026_input = {"intent": "warn",
               "content": "Merton stands in the barn doorway and says: the loft will go up, Verna. He leaves fire "
                          "where the hay lies."}
_g026_options = [
    ("fire_hand", "Pay Arnie off and send him down the road before the hay is in."),
    ("move_hay", "Move the hay out of the loft and keep Arnie on."),
    ("ban_smoking", "Forbid smoking in the barn and take his pipe away tonight."),
    ("shotgun", "Meet Arnie in the loft tonight with the shotgun and order him off the land."),
]
_g026_sit_b = (
    "Merton Carver died three years ago. Since then his widow Verna has run the farm with Arnie Conley, who sleeps "
    "in the barn loft and smokes a pipe there. Another farm has offered Arnie work from next month. Verna dreamed "
    "of Merton last night."
)
_g026_sit_a = (
    "Merton Carver died three years ago. Since then his widow Verna has run the farm with Arnie Conley, who sleeps "
    "in the barn loft and smokes a pipe there. Yesterday Verna found a scorched patch of straw under the loft "
    "ladder. Another farm has offered Arnie work from next month. Verna dreamed of Merton last night."
)
_ca, _cb = pair("P013", "Card a adds an accident event: Arnie's lantern scorched the loft straw the day before the dream",
                ["fire_hand"], ["ban_smoking"])
_g026_events_b = [
    ev("e1", 26900, "death", [1]),
    ev("e2", 26905, "offering", [2, 1], magnitude=10, caused_by=["e1"], tags=["joss_paper"]),
    ev("e3", 27995, "dream", [1, 2]),
]
_g026_events_a = [
    ev("e1", 26900, "death", [1]),
    ev("e2", 26905, "offering", [2, 1], magnitude=10, caused_by=["e1"], tags=["joss_paper"]),
    ev("e4", 27994, "accident", [3], magnitude=25),
    ev("e3", 27995, "dream", [1, 2]),
]
add(decision(10, "dream_interpretation", "G026", L, tick=27995, subject=2,
             people=[_merton, _verna, _arnie], relations=_g026_relations,
             events=_g026_events_a,
             situation=_g026_sit_a, player_input=_g026_input,
             options=_g026_options,
             acceptable=["fire_hand", "move_hay", "ban_smoking"], severe=["shotgun"],
             contrast=_ca,
             note="The dream names fire in the hay and yesterday's scorched straw backs it, so sending a careless "
                  "hand down the road is in character, and so is keeping him on with the hay moved. Ordering him "
                  "off with a shotgun is absurd when she has a legal wage to pay him out."))
add(decision(11, "dream_interpretation", "G026", L, tick=27995, subject=2,
             people=[_merton, _verna, _arnie], relations=_g026_relations,
             events=_g026_events_b,
             situation=_g026_sit_b, player_input=_g026_input,
             options=_g026_options,
             acceptable=["ban_smoking", "move_hay"], severe=["shotgun"],
             contrast=_cb,
             note="With nothing but the dream, a fair-minded widow takes the proportionate step: pipes out of the "
                  "barn, or the hay moved. Dismissing a man with $120 to his name on a dream alone is out of "
                  "character, and the shotgun still is absurd."))

# G027: a reassuring dream telling a sick man to stop working.
_iva = person(1, "Iva Dalton", 68, "female", alive=False, warmth=2, loyalty=2)
_rufus = person(2, "Rufus Dalton", 71, "male", wealth=900, piety=3, warmth=2, pride=1, loyalty=2)
add(decision(12, "dream_interpretation", "G027", L, tick=27765, subject=2,
             people=[_iva, _rufus],
             relations=[rel(2, 1, 85, 85, ["spouse"])],
             events=[ev("e1", 27400, "death", [1]),
                     ev("e2", 27405, "offering", [2, 1], magnitude=10, caused_by=["e1"], tags=["joss_paper"]),
                     ev("e3", 27585, "illness", [2]),
                     ev("e4", 27765, "dream", [1, 2])],
             situation=("Rufus Dalton, 71, farms sixty acres alone. Six months ago the town doctor told him his heart "
                        "is failing and that he must stop heavy work; Rufus has kept working. Iva, his wife of forty "
                        "years, died a year ago. He dreamed of her last night."),
             player_input={"intent": "reassure",
                           "content": "Iva sits on the porch step beside him and says: put the hoe down, Rufus. The "
                                      "land will still be here in the spring. I am not waiting for you yet."},
             options=[("hire_help", "Hire a neighbor's son to work the crop for a share and stay out of the fields."),
                      ("burn_thanks", "Rest a week and burn joss paper to thank Iva and ask what she meant."),
                      ("sell_team", "Sell the team and rent the land to a neighbor for cash."),
                      ("keep_working", "Take the dream as a promise of years and keep working as before."),
                      ("wait_for_iva", "Stop eating and sit on the porch each night until Iva comes for him.")],
             acceptable=["hire_help", "burn_thanks", "sell_team"], severe=["wait_for_iva"],
             note="The dream tells a man with a failing heart to stop, which is what the doctor said: hiring help, "
                  "resting and asking Iva, or selling the team and renting the land out all fit, the last one harsh "
                  "on himself but in character. Reading it as a promise of years and working on contradicts the "
                  "words. Stopping food and waiting to be fetched is absurd."))

# G028: a grandmother asks for offerings the dreamer can only partly afford.
_alma = person(1, "Alma Easton", 79, "female", alive=False, warmth=2, piety=1)
_myra = person(2, "Myra Easton", 33, "female", wealth=650, loyalty=2, warmth=2)
add(decision(13, "dream_interpretation", "G028", L, tick=29730, subject=2,
             people=[_alma, _myra],
             relations=[rel(2, 1, 75, 65, ["grandparent"])],
             events=[ev("e1", 29400, "death", [1]),
                     ev("e2", 29403, "offering", [2, 1], magnitude=10, caused_by=["e1"], tags=["joss_paper"]),
                     ev("e3", 29730, "dream", [1, 2])],
             situation=("Alma Easton died eleven months ago. Myra has burned nothing for her since the funeral, "
                        "because the family had no money then. Myra has $650 saved for winter coal and her son's "
                        "school fee; the paper shop sells a paper stove and a bundle of clothes for $220. Myra "
                        "dreamed of her grandmother last night."),
             player_input={"intent": "request_offering",
                           "content": "Alma sits beside a cold brazier in a thin shawl and says: it is cold here too, "
                                      "Myra. A stove, and paper for a coat."},
             options=[("buy_and_burn", "Spend $220 on the paper stove and coat and burn them this week."),
                      ("small_now", "Burn a small bundle tonight and the rest after the coal is bought."),
                      ("new_year", "Wait and add her share to the family's New Year burning."),
                      ("refuse_coal", "Refuse her; the coal and the school fee come first."),
                      ("burn_all", "Spend all $650 on joss paper and burn it at the crossroads tonight.")],
             acceptable=["buy_and_burn", "small_now", "new_year"], severe=["burn_all"],
             note="A warm granddaughter answers a modest request from a grandmother who has had nothing for eleven "
                  "months: full payment, a small bundle now with the rest later, or the family's New Year burning "
                  "all fit. Refusing her outright is cold for warmth +2. Burning the whole $650 leaves the boy "
                  "without coal, which is absurd."))

# ---------------------------------------------------------------- will_execution

# G029: a witnessed deathbed bequest with no paper. Two options.
_gideon = person(1, "Gideon Fletcher", 84, "male", alive=False, loyalty=1, warmth=1)
_alta = person(2, "Alta Fletcher", 47, "female", wealth=600, loyalty=3, warmth=2, pride=1, greed=-2)
_sonny = person(3, "Sonny Garrison", 39, "male", wealth=250, loyalty=2, warmth=2)
_tillie = person(4, "Tillie Garrison", 36, "female", wealth=0, loyalty=2, warmth=1)
add(decision(4, "will_execution", "G029", L, tick=31512, subject=2,
             people=[_gideon, _alta, _sonny, _tillie],
             relations=[rel(2, 1, 65, 70, ["parent"]), rel(2, 3, 35, 45, ["neighbor"]),
                        rel(3, 1, 70, 65, ["friend"]), rel(4, 1, 60, 55, ["neighbor"])],
             events=[ev("e1", 30900, "help", [3, 1], magnitude=60),
                     ev("e2", 31499, "will", [1, 3, 4], magnitude=42000, tags=["verbal", "deathbed", "witnessed", "land"]),
                     ev("e3", 31499, "will", [1, 2], magnitude=0, tags=["verbal", "deathbed", "witnessed", "heirloom"]),
                     ev("e4", 31502, "death", [1])],
             situation=("Gideon Fletcher farmed sixty acres alone until he died ten days ago and left no written "
                        "will. Three days before the end he told Sonny and Tillie Garrison, who had cooked and hauled "
                        "water for him for two years, that the land should go to them, and that his daughter Alta "
                        "should have the silver and the photographs. Alta, who left town at twenty, arrived the day "
                        "after the funeral."),
             options=[("sign_over", "Sign the farm over to the Garrisons and take the silver and the photographs."),
                      ("keep_farm", "Keep the farm as next of kin and pay the Garrisons for two years of care.")],
             acceptable=["sign_over"], severe=[],
             note="Two neighbors heard the deathbed wish, and Alta is a loyal daughter who never cared about money: "
                  "she signs the land over and takes the keepsakes. Keeping the farm and paying them off contradicts "
                  "both the wish and her loyalty, but it is not absurd, so severe is empty."))

# G088: a witnessed will with a condition the heir resents. Five options.
_hobart = person(1, "Hobart Ingram", 76, "male", alive=False, pride=2, piety=3)
_cleo = person(2, "Cleo Ingram", 44, "female", wealth=1400, pride=3, piety=0, loyalty=1)
_mabel = person(3, "Mabel Ingram", 68, "female", wealth=300, warmth=1)
add(decision(5, "will_execution", "G088", L, tick=30180, subject=2,
             people=[_hobart, _cleo, _mabel],
             relations=[rel(2, 3, -50, -40, ["in_law"]), rel(2, 1, 55, 60, ["parent"]), rel(3, 1, 60, 70, ["spouse"])],
             events=[ev("e1", 28660, "marriage", [1, 3]),
                     ev("e2", 29800, "will", [1, 2], magnitude=31000, tags=["written", "witnessed", "house"]),
                     ev("e3", 30120, "death", [1])],
             situation=("Hobart Ingram died two months ago. His witnessed will leaves the mill and the house to his "
                        "daughter Cleo on one condition: his widow Mabel keeps her room in the house and is paid $30 "
                        "a month from the mill while she lives. Cleo and Mabel have not spoken since Hobart married "
                        "her four years ago. The town clerk has read the will to both women."),
             options=[("take_terms", "Take the mill and keep Mabel's room and the monthly sum as the will says."),
                      ("take_and_stop", "Take the mill, pay Mabel for a year, then stop."),
                      ("refuse_mill", "Refuse the mill rather than keep Mabel in the house."),
                      ("challenge", "Take the mill and ask a lawyer to strike the condition."),
                      ("clear_room", "Take the mill and put Mabel's things on the porch this week.")],
             acceptable=["take_terms", "refuse_mill", "challenge"], severe=["clear_room"],
             note="A proud woman with a grudge still has three believable paths: keep the terms she was read, give "
                  "up the mill rather than house her stepmother, or try to have the condition struck by a lawyer. "
                  "Paying for a year and stopping breaks a witnessed term quietly, which is out of character. "
                  "Turning a widow out on the porch while the will gives her the room is offensive on screen."))

# G030: the same will, a different bond between testator and executor. Variable: the relation.
_chester = person(1, "Chester Holt", 79, "male", alive=False, loyalty=1, warmth=1)
_odell = dict(id=2, name="Odell Holt", age=45, sex="male", wealth=3200, greed=2, pride=1)
_faye = person(3, "Faye Keller", 50, "female", wealth=700, warmth=2, loyalty=2)
_g030_people_a = [_chester, person(**_odell), _faye]
_g030_people_b = [_chester, person(**_odell), _faye]
_g030_relations_a = [rel(2, 1, -55, -30, ["parent"]), rel(2, 3, -20, -30, [])]
_g030_relations_b = [rel(2, 1, 60, 65, ["parent"]), rel(2, 3, -20, -30, [])]
_g030_events = [
    ev("e1", 29010, "help", [3, 1], magnitude=60),
    ev("e2", 31000, "will", [1, 3], magnitude=26000, tags=["written", "witnessed", "house"]),
    ev("e3", 31200, "death", [1]),
]
_g030_sit_a = (
    "Chester Holt's written will leaves the house in town to Faye Keller, who kept house and cooked for him for six "
    "years, and the pasture and the truck to his son Odell. Two neighbors signed it; the will sits in Odell's desk "
    "and the town clerk has not seen it. Chester died three weeks ago and Odell is executor. Chester and Odell "
    "quarreled six years ago over the care of Odell's mother and have barely spoken since."
)
_g030_sit_b = (
    "Chester Holt's written will leaves the house in town to Faye Keller, who kept house and cooked for him for six "
    "years, and the pasture and the truck to his son Odell. Two neighbors signed it; the will sits in Odell's desk "
    "and the town clerk has not seen it. Chester died three weeks ago and Odell is executor. Chester and Odell "
    "worked the pasture side by side until the end and spoke daily."
)
_g030_options = [
    ("file_will", "File the will and let Faye Keller keep the house."),
    ("contest_will", "File it, then contest it, saying his father was confused at the end."),
    ("hold_will", "Leave the will in his desk and let the house come to him as next of kin."),
    ("evict_faye", "Tell Faye to be out of the house by Sunday and change the locks."),
]
_ca, _cb = pair("P014", "Odell's relation to Chester is affinity -55, trust -30 after six years of silence in card a and affinity +60, trust +65 after working side by side in card b",
                ["contest_will", "hold_will"], ["file_will"])
add(decision(6, "will_execution", "G030", L, tick=31221, subject=2,
             people=_g030_people_a, relations=_g030_relations_a, events=_g030_events,
             situation=_g030_sit_a, options=_g030_options,
             acceptable=["contest_will", "hold_will"], severe=["evict_faye"],
             contrast=_ca,
             note="An heir who has barely spoken to his father in six years uses a will only he has read as leverage: he "
                  "contests it or lets it lie in the desk, both selfish and both in character for him. Filing it "
                  "quietly costs him a house for no gain and is out of character. Evicting a woman the will houses, "
                  "days after the funeral, is offensive."))
add(decision(7, "will_execution", "G030", L, tick=31221, subject=2,
             people=_g030_people_b, relations=_g030_relations_b, events=_g030_events,
             situation=_g030_sit_b, options=_g030_options,
             acceptable=["file_will", "hold_will"], severe=["evict_faye"],
             contrast=_cb,
             note="The same will from a son who worked beside his father to the end: he files it and lets Faye keep "
                  "the house. Letting a $26,000 house come to him by leaving the will in the desk is a gain a greedy "
                  "heir might still take, and contesting a will he has no ground against is the same temptation, "
                  "though both sit badly with that bond. Turning Faye out is offensive either way, since the will "
                  "gives her the house."))

# G031: the legatee is a stranger in a rebuilt body. Variable: who the man called Abel is.
_josiah = person(1, "Josiah Lowell", 71, "male", alive=False, loyalty=2, pride=1)
_irene = person(2, "Irene Lowell", 44, "female", wealth=2600, loyalty=2, pride=2, greed=1)
_abel_native = person(3, "Abel Lowell", 30, "male", wealth=200, loyalty=1)
_abel_rebuilt = person(3, "Abel Lowell", 30, "male", origin="rebuilt", wealth=200, loyalty=1)
_g031_relations = [rel(2, 1, 70, 75, ["parent"]), rel(2, 3, 40, 35, [])]
_g031_events_base = [
    ev("e1", 30040, "will", [1, 3], magnitude=18000, tags=["written", "witnessed", "land"]),
    ev("e2", 30055, "death", [1]),
]
_g031_sit_a = (
    "Josiah Lowell died a year ago. His will, signed by two neighbors, leaves the orchard to his grandson Abel, who "
    "was away in the west for eight years, and the rest of the estate to his daughter Irene, who is executor. Abel "
    "came home two months ago and has worked the orchard since. He asks Irene for the orchard."
)
_g031_sit_b = (
    "Josiah Lowell died a year ago. His will, signed by two neighbors, leaves the orchard to his grandson Abel, who "
    "was away in the west for eight years, and the rest of the estate to his daughter Irene, who is executor. Abel "
    "never came back. Two months ago the underworld office placed an outsider in a rebuilt body under Abel's name, "
    "and he has worked the orchard since. He asks Irene for it."
)
_g031_options = [
    ("sign_over", "Sign the orchard over to Abel and let him keep it."),
    ("refuse_ruling", "Refuse him the orchard and ask the underworld office to rule on the claim."),
    ("sell_orchard", "Sell the orchard to a neighbor and give Abel half the money."),
    ("open_body", "Have the man's body opened to see what is inside."),
]
_ca, _cb = pair("P015", "In card a the man in Abel's place is the Lowells' own grandson home from the west; in card b he is an outsider the underworld office placed under Abel's name in a rebuilt body",
                ["sign_over"], ["refuse_ruling"])
add(decision(8, "will_execution", "G031", L, tick=30420, subject=2,
             people=[_josiah, _irene, _abel_native], relations=_g031_relations, events=_g031_events_base,
             situation=_g031_sit_a, options=_g031_options,
             acceptable=["sign_over"], severe=["open_body"],
             contrast=_ca,
             note="The man is Josiah's own grandson, back and working the orchard, and the will names him plainly: "
                  "Irene signs it over. Refusing or selling contradicts a clear bequest to her own kin. Cutting a "
                  "living man open to look inside is absurd and offensive."))
add(decision(9, "will_execution", "G031", L, tick=30420, subject=2,
             people=[_josiah, _irene, _abel_rebuilt], relations=_g031_relations,
             events=_g031_events_base + [ev("e3", 30360, "rebuild", [3])],
             situation=_g031_sit_b, options=_g031_options,
             acceptable=["refuse_ruling", "sell_orchard"], severe=["open_body"],
             contrast=_cb,
             note="The name in the will belongs to a grandson who never came back, and the man holding it arrived in "
                  "a rebuilt body on the office's placement: a proud executor refuses the orchard and asks the "
                  "office to rule, or sells it rather than hand family land to a stranger. Signing it over is out of "
                  "character. Opening the body is absurd."))

# G032: a later will turns up in the house. Variable: whether it exists.
_ephraim = person(1, "Ephraim Nolan", 80, "male", alive=False, pride=2, loyalty=1)
_willa = person(2, "Willa Nolan", 42, "female", wealth=1100, loyalty=3, warmth=2, greed=-1)
_norris = person(3, "Norris Nolan", 47, "male", wealth=400, greed=2, pride=2)
_g032_relations = [rel(2, 1, 70, 70, ["parent"]), rel(3, 1, 20, 30, ["parent"]), rel(2, 3, -30, -20, ["sibling"])]
_g032_options = [
    ("give_brother", "Sign the farm over to Norris."),
    ("keep_farm", "Keep the farm in her own name."),
    ("ask_clerk", "Put the matter to the town clerk and abide by his ruling."),
]
_g032_sit_a = (
    "Ephraim Nolan died last month. A witnessed will written two years ago leaves the farm to his daughter Willa, "
    "who stayed and nursed him, and $2,000 to his son Norris, who left town at twenty and came back for the "
    "funeral. Willa searched the house and found no other papers; the town clerk holds the will."
)
_g032_sit_b = (
    "Ephraim Nolan died last month. A witnessed will written two years ago leaves the farm to his daughter Willa, "
    "who stayed and nursed him, and $2,000 to his son Norris, who left town at twenty and came back for the "
    "funeral. Willa then found a second will, signed and dated in her father's hand three weeks before he died, "
    "revoking the first and leaving the farm to Norris. The clerk holds both."
)
_ca, _cb = pair("P016", "Card b adds a second, later will in Ephraim's own hand leaving the farm to Norris",
                ["keep_farm"], ["give_brother"])
add(decision(10, "will_execution", "G032", L, tick=31030, subject=2,
             people=[_ephraim, _willa, _norris], relations=_g032_relations,
             events=[ev("e1", 30270, "will", [1, 2], magnitude=26000, tags=["written", "witnessed", "land"]),
                     ev("e3", 31000, "death", [1])],
             situation=_g032_sit_a, options=_g032_options,
             acceptable=["keep_farm", "ask_clerk"], severe=[],
             contrast=_ca,
             note="There is one will, it is witnessed, it names Willa, and she searched the house herself: she keeps "
                  "the farm. Putting the single will to the clerk, who already holds it, and abiding by his ruling is "
                  "a careful step she might also take. Signing it to a brother who left at twenty makes no sense "
                  "here. Nothing absurd arises."))
add(decision(11, "will_execution", "G032", L, tick=31030, subject=2,
             people=[_ephraim, _willa, _norris], relations=_g032_relations,
             events=[ev("e1", 30270, "will", [1, 2], magnitude=26000, tags=["written", "witnessed", "land"]),
                     ev("e2", 30979, "will", [1, 3], magnitude=26000, tags=["written", "private", "land"]),
                     ev("e3", 31000, "death", [1])],
             situation=_g032_sit_b, options=_g032_options,
             acceptable=["give_brother", "ask_clerk"], severe=[],
             contrast=_cb,
             note="A later will, in her father's own hand and revoking the first, governs, and Willa is honest: she "
                  "signs the farm to Norris or puts both papers to the clerk. Keeping it for herself overrides the "
                  "last will, but it is not absurd, so severe is empty."))

# G033: a shop left with a ten-year condition.
_erwin = person(1, "Erwin Osborne", 74, "male", alive=False, pride=2, loyalty=1)
_dewey = person(2, "Dewey Osborne", 38, "male", wealth=900, loyalty=2, greed=1, pride=1)
add(decision(12, "will_execution", "G033", L, tick=31905, subject=2,
             people=[_erwin, _dewey],
             relations=[rel(2, 1, 60, 55, [])],
             events=[ev("e1", 31800, "will", [1, 2], magnitude=14000, tags=["written", "witnessed", "shop"]),
                     ev("e2", 31890, "death", [1])],
             situation=("Erwin Osborne died two weeks ago. His witnessed will leaves his hardware shop building and "
                        "stock to his nephew Dewey on one condition: Dewey keeps the shop open as a hardware store "
                        "for ten years and does not sell the building. Dewey earns steady wages at the sawmill; the "
                        "shop has lost money for three years and Erwin's ledgers show it. Dewey has $900 saved."),
             options=[("run_shop", "Leave the sawmill and run the shop as the will asks."),
                      ("decline_bequest", "Decline the bequest and stay at the mill."),
                      ("take_and_close", "Take the building and close the shop."),
                      ("strip_shop", "Take everything, scrap Erwin's tools and paint over the shop sign.")],
             acceptable=["run_shop", "decline_bequest"], severe=["strip_shop"],
             note="A loyal nephew with $900 either takes the shop on and loses his wages to keep the condition, or "
                  "declines a business that has lost money for three years; both are believable. Taking the "
                  "building and closing the shop breaks the condition for gain, which is out of character. Scrapping "
                  "his uncle's tools and painting over the sign days after the funeral is offensive."))

# G034: a will that orders money burned at the funeral.
_luther = person(1, "Luther Hayes", 68, "male", alive=False, piety=3, pride=1)
_dorcas = person(2, "Dorcas Hayes", 61, "female", wealth=200, piety=1, loyalty=2, warmth=2)
add(decision(13, "will_execution", "G034", L, tick=29643, subject=2,
             people=[_luther, _dorcas],
             relations=[rel(2, 1, 75, 80, ["spouse"])],
             events=[ev("e1", 29600, "will", [1, 2], magnitude=8000, tags=["written", "witnessed", "house"]),
                     ev("e2", 29640, "death", [1])],
             situation=("Luther Hayes died three days ago. His will directs that $1,200 of his money be spent on "
                        "joss paper and burned at his funeral on Saturday; the house goes to his widow Dorcas. The "
                        "estate holds $1,300 in the bank. Dorcas has $200 of her own, winter coal to buy, and a "
                        "son's school fee due in January."),
             options=[("burn_full", "Spend the $1,200 on joss paper and burn it at Saturday's funeral."),
                      ("burn_part", "Burn $300 of it and keep the rest for coal and the school fee."),
                      ("keep_cash", "Keep the cash and burn nothing at the funeral."),
                      ("mortgage_house", "Mortgage the house to buy joss paper for the funeral.")],
             acceptable=["burn_full", "burn_part"], severe=["mortgage_house"],
             note="A loyal widow carries out a written instruction to burn $1,200 for her husband, or burns part and "
                  "keeps the rest for coal, which is a smaller break of the same instruction and believable with "
                  "$200 in hand. Burning nothing ignores a witnessed will entirely. Mortgaging the house she was "
                  "left, to buy more paper, is absurd."))