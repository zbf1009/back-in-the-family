# Review sheet: locked

Rendered from tools/cards_locked.py by tools/build_cards.py. Do not edit by hand.

| task | family | cards |
|---|---|---|
| decision | debt_repayment | 10 |
| decision | dream_interpretation | 10 |
| decision | magistrate_ruling | 10 |
| decision | reconcile_or_revenge | 10 |
| decision | remarriage | 10 |
| decision | sanity | 4 |
| decision | will_execution | 10 |
| synthesis | broken_promise | 10 |
| synthesis | debt_chain | 10 |
| synthesis | grudge_detection | 10 |
| synthesis | relationship_shift | 10 |
| synthesis | sanity | 4 |

## dream_interpretation

### D-dream_interpretation-004

group `G023` · split `locked` · scored `True` · tick 28995 · subject 2 (Reba Abbott)

> Otis Abbott died three winters ago. His grandson Curtis, 17, drives the grain truck at night and hauls a load tomorrow down the low road; the $180 the week pays covers the family's coal. The low road floods in wet years, and this autumn has been wet. Reba has burned no joss paper since the funeral. She wakes from the dream at dawn.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Otis Abbott | 78 | male | False | native | 0 | warmth +1, piety +2 |
| 2 | Reba Abbott | 44 | female | True | native | 340 | loyalty +2, warmth +1, piety +2 |
| 3 | Curtis Abbott | 17 | male | True | native | 0 | temper +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Reba Abbott | Otis Abbott | 70 | 65 | parent |
| Reba Abbott | Curtis Abbott | 80 | 70 | child |
| Curtis Abbott | Otis Abbott | 55 | 45 | grandparent |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 27900 | death | 1 Otis Abbott | 0 |  |  |  |
| e2 | 27905 | offering | 2 Reba Abbott, 1 Otis Abbott | 20 |  | e1 | joss_paper |
| e3 | 28995 | dream | 1 Otis Abbott, 2 Reba Abbott | 0 |  |  |  |

**Player input** (warn): Otis stands waist-deep in brown water with one hand raised. He says: not the low road, Reba. Not with the boy in it.

| option | label | grade |
|---|---|---|
| `keep_home` | Keep Curtis home from the run and lose the week's pay. | acceptable |
| `burn_offering` | Burn joss paper and ask Otis what he saw on the road. | acceptable |
| `check_road` | Walk the low road herself before Curtis leaves. | acceptable |
| `send_him` | Let Curtis take the load as planned. | - |
| `burn_coat` | Burn Otis's coat and tools so he stops sending dreams. | **severe** |

**Contrast** `P011` role `a`: Reba's piety is +2 in card a and -3 in card b
- expected a: keep_home, burn_offering
- expected b: send_him

*Author note:* A devout daughter who revered Otis acts on a plain warning about water: she keeps the boy home at the cost of the week's pay, or asks Otis through an offering. Walking the road first is prudent and in character. Burning his coat is an offense to the dead and absurd, so severe.

### D-dream_interpretation-005

group `G023` · split `locked` · scored `True` · tick 28995 · subject 2 (Reba Abbott)

> Otis Abbott died three winters ago. His grandson Curtis, 17, drives the grain truck at night and hauls a load tomorrow down the low road; the $180 the week pays covers the family's coal. The low road floods in wet years, and this autumn has been wet. Reba has burned no joss paper since the funeral. She wakes from the dream at dawn.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Otis Abbott | 78 | male | False | native | 0 | warmth +1, piety +2 |
| 2 | Reba Abbott | 44 | female | True | native | 340 | loyalty +2, warmth +1, piety -3 |
| 3 | Curtis Abbott | 17 | male | True | native | 0 | temper +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Reba Abbott | Otis Abbott | 70 | 65 | parent |
| Reba Abbott | Curtis Abbott | 80 | 70 | child |
| Curtis Abbott | Otis Abbott | 55 | 45 | grandparent |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 27900 | death | 1 Otis Abbott | 0 |  |  |  |
| e2 | 27905 | offering | 2 Reba Abbott, 1 Otis Abbott | 20 |  | e1 | joss_paper |
| e3 | 28995 | dream | 1 Otis Abbott, 2 Reba Abbott | 0 |  |  |  |

**Player input** (warn): Otis stands waist-deep in brown water with one hand raised. He says: not the low road, Reba. Not with the boy in it.

| option | label | grade |
|---|---|---|
| `keep_home` | Keep Curtis home from the run and lose the week's pay. | - |
| `burn_offering` | Burn joss paper and ask Otis what he saw on the road. | - |
| `check_road` | Walk the low road herself before Curtis leaves. | acceptable |
| `send_him` | Let Curtis take the load as planned. | acceptable |
| `burn_coat` | Burn Otis's coat and tools so he stops sending dreams. | **severe** |

**Contrast** `P011` role `b`: Reba's piety is +2 in card a and -3 in card b
- expected a: keep_home, burn_offering
- expected b: send_him
- structural differences from card a:
  - `context.people[id=2].traits.piety: 2 -> -3`

*Author note:* With piety -3 Reba treats a dream as nothing, so the load goes out as planned; a look at the road is cheap caution she might still take. Losing $180 or burning joss paper over a dream is out of character, and burning Otis's things stays absurd.

### D-dream_interpretation-006

group `G024` · split `locked` · scored `True` · tick 28230 · subject 2 (Fern Bishop)

> Amos Bishop planted the birches on the south lot himself. Since he died five years ago Fern has left the woodlot untouched. A logger has offered $4,000 for the standing timber and the offer closes Friday. Fern owes $900 in property tax by the end of the month and has $200 in the bank. She dreamed of Amos last night.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Amos Bishop | 71 | male | False | native | 0 | pride +2, warmth +1 |
| 2 | Fern Bishop | 63 | female | True | native | 200 | loyalty +3, pride +1, piety +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Fern Bishop | Amos Bishop | 85 | 80 | spouse |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 26400 | death | 1 Amos Bishop | 0 |  |  |  |
| e2 | 26405 | offering | 2 Fern Bishop, 1 Amos Bishop | 15 |  | e1 | joss_paper |
| e3 | 28230 | dream | 1 Amos Bishop, 2 Fern Bishop | 0 |  |  |  |

**Player input** (forbid): Amos stands at the edge of the birches with his arms crossed, blocking the path. He says: not these trees, Fern.

| option | label | grade |
|---|---|---|
| `refuse_sale` | Turn down the timber offer and find another way to pay the tax. | acceptable |
| `sell_timber` | Sign the logger's offer and pay the tax with the money. | - |

*Author note:* A devoted widow who has kept his woodlot untouched for five years reads a plain prohibition as Amos's word and gives up $4,000 rather than cut the trees, even with tax due. Selling is understandable but out of character for her. Nothing here would look absurd, so severe is empty.

### D-dream_interpretation-007

group `G087` · split `locked` · scored `True` · tick 28800 · subject 3 (Della Blake)

> Pearl Blake died last spring. Her son Dexter settled the estate, told his sister Della that after debts it came to $3,000, and paid her $1,500. Della never saw an inventory. The mattress from Pearl's room is still folded in Della's attic. Della dreamed of her mother last night.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Pearl Blake | 74 | female | False | native | 0 | loyalty +2, warmth +1 |
| 2 | Dexter Blake | 46 | male | True | native | 5200 | greed +2, pride +1 |
| 3 | Della Blake | 49 | female | True | native | 900 | loyalty +2, pride +2, warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Della Blake | Pearl Blake | 75 | 70 | parent |
| Dexter Blake | Pearl Blake | 55 | 40 | parent |
| Della Blake | Dexter Blake | -20 | -30 | sibling |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 28435 | death | 1 Pearl Blake | 0 |  |  |  |
| e2 | 28470 | inheritance | 1 Pearl Blake, 2 Dexter Blake | 6000 |  | e1 | cash, written |
| e3 | 28800 | dream | 1 Pearl Blake, 3 Della Blake | 0 |  |  |  |

**Player input** (reveal): Pearl sits on the edge of the bed and says: the money was sewn into the mattress ticking, Della. Dexter took it out the night before the funeral.

| option | label | grade |
|---|---|---|
| `confront_dexter` | Tell Dexter what the dream said and ask him to explain. | acceptable |
| `accuse_church` | Accuse Dexter of taking the money in front of the congregation on Sunday. | - |
| `let_it_go` | Treat it as a dream and say nothing to anyone. | - |
| `break_in` | Break into Dexter's house at night and search it for the money. | **severe** |
| `check_mattress` | Cut open the mattress ticking and check whether the seam was opened. | acceptable |

*Author note:* A proud, loyal daughter takes a named and checkable claim from her mother seriously: she cuts the ticking open or puts it to Dexter. Denouncing her brother before the congregation on the word of a dream, before anyone has looked at the seam, shames her own family and is too much for a woman who does not hold grudges. Saying nothing is out of character for a proud woman who has just been told her brother kept $4,500 of their mother's money. Breaking in at night is absurd when the seam can be checked at home.

### D-dream_interpretation-008

group `G025` · split `locked` · scored `True` · tick 27825 · subject 2 (Selma Boone)

> Nettie Boone died five years ago and her grave still has a painted board for a marker. Roland Briggs has cut a granite stone with her name on it for $600 and will sell it to another family in a week. Selma has $2,400 in the bank and her rent is paid through the winter. She dreamed of her mother last night.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Nettie Boone | 72 | female | False | native | 0 | pride +1, warmth +1 |
| 2 | Selma Boone | 45 | female | True | native | 2400 | greed -1, loyalty +2, warmth +1, piety +1 |
| 3 | Roland Briggs | 50 | male | True | native | 8000 | pride +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Selma Boone | Nettie Boone | 80 | 70 | parent |
| Selma Boone | Roland Briggs | 20 | 40 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 26000 | death | 1 Nettie Boone | 0 |  |  |  |
| e2 | 26010 | offering | 2 Selma Boone, 1 Nettie Boone | 10 |  | e1 | joss_paper |
| e3 | 27825 | dream | 1 Nettie Boone, 2 Selma Boone | 0 |  |  |  |

**Player input** (urge): Nettie stands beside a slab of gray stone and runs her hand over letters cut into it. She says: I would like my name where people can read it.

| option | label | grade |
|---|---|---|
| `buy_stone` | Pay Roland the $600 and have the stone set this week. | acceptable |
| `pay_terms` | Ask Roland to hold the stone and take $50 a month. | acceptable |
| `keep_board` | Keep the painted board and let the grave stand as it is. | - |

**Contrast** `P012` role `a`: Selma's savings are $2,400 with rent paid in card a and $140 with $90 of coal due next week in card b
- expected a: buy_stone
- expected b: pay_terms

*Author note:* With $2,400 in the bank and the stone about to go to another family, a warm daughter pays the $600 for the marker her mother asked for. Asking for terms is possible but less expected with the money in hand. Keeping the board ignores the request, and nothing here is absurd.

### D-dream_interpretation-009

group `G025` · split `locked` · scored `True` · tick 27825 · subject 2 (Selma Boone)

> Nettie Boone died five years ago and her grave still has a painted board for a marker. Roland Briggs has cut a granite stone with her name on it for $600 and will sell it to another family in a week. Selma has $140 in the bank and $90 of coal is due next week. She dreamed of her mother last night.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Nettie Boone | 72 | female | False | native | 0 | pride +1, warmth +1 |
| 2 | Selma Boone | 45 | female | True | native | 140 | greed -1, loyalty +2, warmth +1, piety +1 |
| 3 | Roland Briggs | 50 | male | True | native | 8000 | pride +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Selma Boone | Nettie Boone | 80 | 70 | parent |
| Selma Boone | Roland Briggs | 20 | 40 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 26000 | death | 1 Nettie Boone | 0 |  |  |  |
| e2 | 26010 | offering | 2 Selma Boone, 1 Nettie Boone | 10 |  | e1 | joss_paper |
| e3 | 27825 | dream | 1 Nettie Boone, 2 Selma Boone | 0 |  |  |  |

**Player input** (urge): Nettie stands beside a slab of gray stone and runs her hand over letters cut into it. She says: I would like my name where people can read it.

| option | label | grade |
|---|---|---|
| `buy_stone` | Pay Roland the $600 and have the stone set this week. | - |
| `pay_terms` | Ask Roland to hold the stone and take $50 a month. | acceptable |
| `keep_board` | Keep the painted board and let the grave stand as it is. | acceptable |

**Contrast** `P012` role `b`: Selma's savings are $2,400 with rent paid in card a and $140 with $90 of coal due next week in card b
- expected a: buy_stone
- expected b: pay_terms
- structural differences from card a:
  - `context.people[id=2].wealth: 2400 -> 140`
  - `context.situation: 'Nettie Boone died five years ago and her grave still has a painted board for a marker. Roland Briggs has cut a granite stone with her name on it for $600 and will sell it to another family in a week. Selma has $2,400 in the bank and her rent is paid through the winter. She dreamed of her mother last night.' -> 'Nettie Boone died five years ago and her grave still has a painted board for a marker. Roland Briggs has cut a granite stone with her name on it for $600 and will sell it to another family in a week. Selma has $140 in the bank and $90 of coal is due next week. She dreamed of her mother last night.'`

*Author note:* With $140 left and coal due, paying $600 now is not possible: asking Roland to hold the stone on a monthly sum is the in-character move, and letting the board stand another year is a believable retreat. Nothing here is absurd.

### D-dream_interpretation-010

group `G026` · split `locked` · scored `True` · tick 27995 · subject 2 (Verna Carver)

> Merton Carver died three years ago. Since then his widow Verna has run the farm with Arnie Conley, who sleeps in the barn loft and smokes a pipe there. Yesterday Verna found a scorched patch of straw under the loft ladder. Another farm has offered Arnie work from next month. Verna dreamed of Merton last night.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Merton Carver | 70 | male | False | native | 0 | warmth +1, temper +1 |
| 2 | Verna Carver | 58 | female | True | native | 3400 | loyalty +1, warmth +1, piety +2 |
| 3 | Arnie Conley | 31 | male | True | native | 120 | greed +1, temper +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Verna Carver | Merton Carver | 85 | 80 | spouse |
| Verna Carver | Arnie Conley | 10 | 30 | employee |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 26900 | death | 1 Merton Carver | 0 |  |  |  |
| e2 | 26905 | offering | 2 Verna Carver, 1 Merton Carver | 10 |  | e1 | joss_paper |
| e4 | 27994 | accident | 3 Arnie Conley | 25 |  |  |  |
| e3 | 27995 | dream | 1 Merton Carver, 2 Verna Carver | 0 |  |  |  |

**Player input** (warn): Merton stands in the barn doorway and says: the loft will go up, Verna. He leaves fire where the hay lies.

| option | label | grade |
|---|---|---|
| `fire_hand` | Pay Arnie off and send him down the road before the hay is in. | acceptable |
| `move_hay` | Move the hay out of the loft and keep Arnie on. | acceptable |
| `ban_smoking` | Forbid smoking in the barn and take his pipe away tonight. | acceptable |
| `shotgun` | Meet Arnie in the loft tonight with the shotgun and order him off the land. | **severe** |

**Contrast** `P013` role `a`: Card a adds an accident event: Arnie's lantern scorched the loft straw the day before the dream
- expected a: fire_hand
- expected b: ban_smoking

*Author note:* The dream names fire in the hay and yesterday's scorched straw backs it, so sending a careless hand down the road is in character, and so is keeping him on with the hay moved. Ordering him off with a shotgun is absurd when she has a legal wage to pay him out.

### D-dream_interpretation-011

group `G026` · split `locked` · scored `True` · tick 27995 · subject 2 (Verna Carver)

> Merton Carver died three years ago. Since then his widow Verna has run the farm with Arnie Conley, who sleeps in the barn loft and smokes a pipe there. Another farm has offered Arnie work from next month. Verna dreamed of Merton last night.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Merton Carver | 70 | male | False | native | 0 | warmth +1, temper +1 |
| 2 | Verna Carver | 58 | female | True | native | 3400 | loyalty +1, warmth +1, piety +2 |
| 3 | Arnie Conley | 31 | male | True | native | 120 | greed +1, temper +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Verna Carver | Merton Carver | 85 | 80 | spouse |
| Verna Carver | Arnie Conley | 10 | 30 | employee |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 26900 | death | 1 Merton Carver | 0 |  |  |  |
| e2 | 26905 | offering | 2 Verna Carver, 1 Merton Carver | 10 |  | e1 | joss_paper |
| e3 | 27995 | dream | 1 Merton Carver, 2 Verna Carver | 0 |  |  |  |

**Player input** (warn): Merton stands in the barn doorway and says: the loft will go up, Verna. He leaves fire where the hay lies.

| option | label | grade |
|---|---|---|
| `fire_hand` | Pay Arnie off and send him down the road before the hay is in. | - |
| `move_hay` | Move the hay out of the loft and keep Arnie on. | acceptable |
| `ban_smoking` | Forbid smoking in the barn and take his pipe away tonight. | acceptable |
| `shotgun` | Meet Arnie in the loft tonight with the shotgun and order him off the land. | **severe** |

**Contrast** `P013` role `b`: Card a adds an accident event: Arnie's lantern scorched the loft straw the day before the dream
- expected a: fire_hand
- expected b: ban_smoking
- structural differences from card a:
  - `context.events[id=e4]: {'id': 'e4', 'tick': 27994, 'type': 'accident', 'actors': [3], 'magnitude': 25, 'caused_by': [], 'tags': []} -> <absent>`
  - `context.situation: 'Merton Carver died three years ago. Since then his widow Verna has run the farm with Arnie Conley, who sleeps in the barn loft and smokes a pipe there. Yesterday Verna found a scorched patch of straw under the loft ladder. Another farm has offered Arnie work from next month. Verna dreamed of Merton last night.' -> 'Merton Carver died three years ago. Since then his widow Verna has run the farm with Arnie Conley, who sleeps in the barn loft and smokes a pipe there. Another farm has offered Arnie work from next month. Verna dreamed of Merton last night.'`

*Author note:* With nothing but the dream, a fair-minded widow takes the proportionate step: pipes out of the barn, or the hay moved. Dismissing a man with $120 to his name on a dream alone is out of character, and the shotgun still is absurd.

### D-dream_interpretation-012

group `G027` · split `locked` · scored `True` · tick 27765 · subject 2 (Rufus Dalton)

> Rufus Dalton, 71, farms sixty acres alone. Six months ago the town doctor told him his heart is failing and that he must stop heavy work; Rufus has kept working. Iva, his wife of forty years, died a year ago. He dreamed of her last night.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Iva Dalton | 68 | female | False | native | 0 | loyalty +2, warmth +2 |
| 2 | Rufus Dalton | 71 | male | True | native | 900 | loyalty +2, pride +1, warmth +2, piety +3 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Rufus Dalton | Iva Dalton | 85 | 85 | spouse |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 27400 | death | 1 Iva Dalton | 0 |  |  |  |
| e2 | 27405 | offering | 2 Rufus Dalton, 1 Iva Dalton | 10 |  | e1 | joss_paper |
| e3 | 27585 | illness | 2 Rufus Dalton | 0 |  |  |  |
| e4 | 27765 | dream | 1 Iva Dalton, 2 Rufus Dalton | 0 |  |  |  |

**Player input** (reassure): Iva sits on the porch step beside him and says: put the hoe down, Rufus. The land will still be here in the spring. I am not waiting for you yet.

| option | label | grade |
|---|---|---|
| `burn_thanks` | Rest a week and burn joss paper to thank Iva and ask what she meant. | acceptable |
| `sell_team` | Sell the team and rent the land to a neighbor for cash. | acceptable |
| `keep_working` | Take the dream as a promise of years and keep working as before. | - |
| `wait_for_iva` | Stop eating and sit on the porch each night until Iva comes for him. | **severe** |
| `hire_help` | Hire a neighbor's son to work the crop for a share and stay out of the fields. | acceptable |

*Author note:* The dream tells a man with a failing heart to stop, which is what the doctor said: hiring help, resting and asking Iva, or selling the team and renting the land out all fit, the last one harsh on himself but in character. Reading it as a promise of years and working on contradicts the words. Stopping food and waiting to be fetched is absurd.

### D-dream_interpretation-013

group `G028` · split `locked` · scored `True` · tick 29730 · subject 2 (Myra Easton)

> Alma Easton died eleven months ago. Myra has burned nothing for her since the funeral, because the family had no money then. Myra has $650 saved for winter coal and her son's school fee; the paper shop sells a paper stove and a bundle of clothes for $220. Myra dreamed of her grandmother last night.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Alma Easton | 79 | female | False | native | 0 | warmth +2, piety +1 |
| 2 | Myra Easton | 33 | female | True | native | 650 | loyalty +2, warmth +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Myra Easton | Alma Easton | 75 | 65 | grandparent |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 29400 | death | 1 Alma Easton | 0 |  |  |  |
| e2 | 29403 | offering | 2 Myra Easton, 1 Alma Easton | 10 |  | e1 | joss_paper |
| e3 | 29730 | dream | 1 Alma Easton, 2 Myra Easton | 0 |  |  |  |

**Player input** (request_offering): Alma sits beside a cold brazier in a thin shawl and says: it is cold here too, Myra. A stove, and paper for a coat.

| option | label | grade |
|---|---|---|
| `refuse_coal` | Refuse her; the coal and the school fee come first. | - |
| `burn_all` | Spend all $650 on joss paper and burn it at the crossroads tonight. | **severe** |
| `buy_and_burn` | Spend $220 on the paper stove and coat and burn them this week. | acceptable |
| `small_now` | Burn a small bundle tonight and the rest after the coal is bought. | acceptable |
| `new_year` | Wait and add her share to the family's New Year burning. | acceptable |

*Author note:* A warm granddaughter answers a modest request from a grandmother who has had nothing for eleven months: full payment, a small bundle now with the rest later, or the family's New Year burning all fit. Refusing her outright is cold for warmth +2. Burning the whole $650 leaves the boy without coal, which is absurd.

## will_execution

### D-will_execution-004

group `G029` · split `locked` · scored `True` · tick 31512 · subject 2 (Alta Fletcher)

> Gideon Fletcher farmed sixty acres alone until he died ten days ago and left no written will. Three days before the end he told Sonny and Tillie Garrison, who had cooked and hauled water for him for two years, that the land should go to them, and that his daughter Alta should have the silver and the photographs. Alta, who left town at twenty, arrived the day after the funeral.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Gideon Fletcher | 84 | male | False | native | 0 | loyalty +1, warmth +1 |
| 2 | Alta Fletcher | 47 | female | True | native | 600 | greed -2, loyalty +3, pride +1, warmth +2 |
| 3 | Sonny Garrison | 39 | male | True | native | 250 | loyalty +2, warmth +2 |
| 4 | Tillie Garrison | 36 | female | True | native | 0 | loyalty +2, warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Alta Fletcher | Gideon Fletcher | 65 | 70 | parent |
| Alta Fletcher | Sonny Garrison | 35 | 45 | neighbor |
| Sonny Garrison | Gideon Fletcher | 70 | 65 | friend |
| Tillie Garrison | Gideon Fletcher | 60 | 55 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 30900 | help | 3 Sonny Garrison, 1 Gideon Fletcher | 60 |  |  |  |
| e2 | 31499 | will | 1 Gideon Fletcher, 3 Sonny Garrison, 4 Tillie Garrison | 42000 |  |  | verbal, deathbed, witnessed, land |
| e3 | 31499 | will | 1 Gideon Fletcher, 2 Alta Fletcher | 0 |  |  | verbal, deathbed, witnessed, heirloom |
| e4 | 31502 | death | 1 Gideon Fletcher | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `keep_farm` | Keep the farm as next of kin and pay the Garrisons for two years of care. | - |
| `sign_over` | Sign the farm over to the Garrisons and take the silver and the photographs. | acceptable |

*Author note:* Two neighbors heard the deathbed wish, and Alta is a loyal daughter who never cared about money: she signs the land over and takes the keepsakes. Keeping the farm and paying them off contradicts both the wish and her loyalty, but it is not absurd, so severe is empty.

### D-will_execution-005

group `G088` · split `locked` · scored `True` · tick 30180 · subject 2 (Cleo Ingram)

> Hobart Ingram died two months ago. His witnessed will leaves the mill and the house to his daughter Cleo on one condition: his widow Mabel keeps her room in the house and is paid $30 a month from the mill while she lives. Cleo and Mabel have not spoken since Hobart married her four years ago. The town clerk has read the will to both women.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Hobart Ingram | 76 | male | False | native | 0 | pride +2, piety +3 |
| 2 | Cleo Ingram | 44 | female | True | native | 1400 | loyalty +1, pride +3 |
| 3 | Mabel Ingram | 68 | female | True | native | 300 | warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Cleo Ingram | Mabel Ingram | -50 | -40 | in_law |
| Cleo Ingram | Hobart Ingram | 55 | 60 | parent |
| Mabel Ingram | Hobart Ingram | 60 | 70 | spouse |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 28660 | marriage | 1 Hobart Ingram, 3 Mabel Ingram | 0 |  |  |  |
| e2 | 29800 | will | 1 Hobart Ingram, 2 Cleo Ingram | 31000 |  |  | written, witnessed, house |
| e3 | 30120 | death | 1 Hobart Ingram | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `refuse_mill` | Refuse the mill rather than keep Mabel in the house. | acceptable |
| `challenge` | Take the mill and ask a lawyer to strike the condition. | acceptable |
| `clear_room` | Take the mill and put Mabel's things on the porch this week. | **severe** |
| `take_terms` | Take the mill and keep Mabel's room and the monthly sum as the will says. | acceptable |
| `take_and_stop` | Take the mill, pay Mabel for a year, then stop. | - |

*Author note:* A proud woman with a grudge still has three believable paths: keep the terms she was read, give up the mill rather than house her stepmother, or try to have the condition struck by a lawyer. Paying for a year and stopping breaks a witnessed term quietly, which is out of character. Turning a widow out on the porch while the will gives her the room is offensive on screen.

### D-will_execution-006

group `G030` · split `locked` · scored `True` · tick 31221 · subject 2 (Odell Holt)

> Chester Holt's written will leaves the house in town to Faye Keller, who kept house and cooked for him for six years, and the pasture and the truck to his son Odell. Two neighbors signed it; the will sits in Odell's desk and the town clerk has not seen it. Chester died three weeks ago and Odell is executor. Chester and Odell quarreled six years ago over the care of Odell's mother and have barely spoken since.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Chester Holt | 79 | male | False | native | 0 | loyalty +1, warmth +1 |
| 2 | Odell Holt | 45 | male | True | native | 3200 | greed +2, pride +1 |
| 3 | Faye Keller | 50 | female | True | native | 700 | loyalty +2, warmth +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Odell Holt | Chester Holt | -55 | -30 | parent |
| Odell Holt | Faye Keller | -20 | -30 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 29010 | help | 3 Faye Keller, 1 Chester Holt | 60 |  |  |  |
| e2 | 31000 | will | 1 Chester Holt, 3 Faye Keller | 26000 |  |  | written, witnessed, house |
| e3 | 31200 | death | 1 Chester Holt | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `hold_will` | Leave the will in his desk and let the house come to him as next of kin. | acceptable |
| `evict_faye` | Tell Faye to be out of the house by Sunday and change the locks. | **severe** |
| `file_will` | File the will and let Faye Keller keep the house. | - |
| `contest_will` | File it, then contest it, saying his father was confused at the end. | acceptable |

**Contrast** `P014` role `a`: Odell's relation to Chester is affinity -55, trust -30 after six years of silence in card a and affinity +60, trust +65 after working side by side in card b
- expected a: contest_will, hold_will
- expected b: file_will

*Author note:* An heir who has barely spoken to his father in six years uses a will only he has read as leverage: he contests it or lets it lie in the desk, both selfish and both in character for him. Filing it quietly costs him a house for no gain and is out of character. Evicting a woman the will houses, days after the funeral, is offensive.

### D-will_execution-007

group `G030` · split `locked` · scored `True` · tick 31221 · subject 2 (Odell Holt)

> Chester Holt's written will leaves the house in town to Faye Keller, who kept house and cooked for him for six years, and the pasture and the truck to his son Odell. Two neighbors signed it; the will sits in Odell's desk and the town clerk has not seen it. Chester died three weeks ago and Odell is executor. Chester and Odell worked the pasture side by side until the end and spoke daily.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Chester Holt | 79 | male | False | native | 0 | loyalty +1, warmth +1 |
| 2 | Odell Holt | 45 | male | True | native | 3200 | greed +2, pride +1 |
| 3 | Faye Keller | 50 | female | True | native | 700 | loyalty +2, warmth +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Odell Holt | Chester Holt | 60 | 65 | parent |
| Odell Holt | Faye Keller | -20 | -30 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 29010 | help | 3 Faye Keller, 1 Chester Holt | 60 |  |  |  |
| e2 | 31000 | will | 1 Chester Holt, 3 Faye Keller | 26000 |  |  | written, witnessed, house |
| e3 | 31200 | death | 1 Chester Holt | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `hold_will` | Leave the will in his desk and let the house come to him as next of kin. | acceptable |
| `evict_faye` | Tell Faye to be out of the house by Sunday and change the locks. | **severe** |
| `file_will` | File the will and let Faye Keller keep the house. | acceptable |
| `contest_will` | File it, then contest it, saying his father was confused at the end. | - |

**Contrast** `P014` role `b`: Odell's relation to Chester is affinity -55, trust -30 after six years of silence in card a and affinity +60, trust +65 after working side by side in card b
- expected a: contest_will, hold_will
- expected b: file_will
- structural differences from card a:
  - `context.relations[0].affinity: -55 -> 60`
  - `context.relations[0].trust: -30 -> 65`
  - `context.situation: "Chester Holt's written will leaves the house in town to Faye Keller, who kept house and cooked for him for six years, and the pasture and the truck to his son Odell. Two neighbors signed it; the will sits in Odell's desk and the town clerk has not seen it. Chester died three weeks ago and Odell is executor. Chester and Odell quarreled six years ago over the care of Odell's mother and have barely spoken since." -> "Chester Holt's written will leaves the house in town to Faye Keller, who kept house and cooked for him for six years, and the pasture and the truck to his son Odell. Two neighbors signed it; the will sits in Odell's desk and the town clerk has not seen it. Chester died three weeks ago and Odell is executor. Chester and Odell worked the pasture side by side until the end and spoke daily."`

*Author note:* The same will from a son who worked beside his father to the end: he files it and lets Faye keep the house. Letting a $26,000 house come to him by leaving the will in the desk is a gain a greedy heir might still take, and contesting a will he has no ground against is the same temptation, though both sit badly with that bond. Turning Faye out is offensive either way, since the will gives her the house.

### D-will_execution-008

group `G031` · split `locked` · scored `True` · tick 30420 · subject 2 (Irene Lowell)

> Josiah Lowell died a year ago. His will, signed by two neighbors, leaves the orchard to his grandson Abel, who was away in the west for eight years, and the rest of the estate to his daughter Irene, who is executor. Abel came home two months ago and has worked the orchard since. He asks Irene for the orchard.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Josiah Lowell | 71 | male | False | native | 0 | loyalty +2, pride +1 |
| 2 | Irene Lowell | 44 | female | True | native | 2600 | greed +1, loyalty +2, pride +2 |
| 3 | Abel Lowell | 30 | male | True | native | 200 | loyalty +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Irene Lowell | Josiah Lowell | 70 | 75 | parent |
| Irene Lowell | Abel Lowell | 40 | 35 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 30040 | will | 1 Josiah Lowell, 3 Abel Lowell | 18000 |  |  | written, witnessed, land |
| e2 | 30055 | death | 1 Josiah Lowell | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `refuse_ruling` | Refuse him the orchard and ask the underworld office to rule on the claim. | - |
| `sell_orchard` | Sell the orchard to a neighbor and give Abel half the money. | - |
| `open_body` | Have the man's body opened to see what is inside. | **severe** |
| `sign_over` | Sign the orchard over to Abel and let him keep it. | acceptable |

**Contrast** `P015` role `a`: In card a the man in Abel's place is the Lowells' own grandson home from the west; in card b he is an outsider the underworld office placed under Abel's name in a rebuilt body
- expected a: sign_over
- expected b: refuse_ruling

*Author note:* The man is Josiah's own grandson, back and working the orchard, and the will names him plainly: Irene signs it over. Refusing or selling contradicts a clear bequest to her own kin. Cutting a living man open to look inside is absurd and offensive.

### D-will_execution-009

group `G031` · split `locked` · scored `True` · tick 30420 · subject 2 (Irene Lowell)

> Josiah Lowell died a year ago. His will, signed by two neighbors, leaves the orchard to his grandson Abel, who was away in the west for eight years, and the rest of the estate to his daughter Irene, who is executor. Abel never came back. Two months ago the underworld office placed an outsider in a rebuilt body under Abel's name, and he has worked the orchard since. He asks Irene for it.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Josiah Lowell | 71 | male | False | native | 0 | loyalty +2, pride +1 |
| 2 | Irene Lowell | 44 | female | True | native | 2600 | greed +1, loyalty +2, pride +2 |
| 3 | Abel Lowell | 30 | male | True | rebuilt | 200 | loyalty +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Irene Lowell | Josiah Lowell | 70 | 75 | parent |
| Irene Lowell | Abel Lowell | 40 | 35 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 30040 | will | 1 Josiah Lowell, 3 Abel Lowell | 18000 |  |  | written, witnessed, land |
| e2 | 30055 | death | 1 Josiah Lowell | 0 |  |  |  |
| e3 | 30360 | rebuild | 3 Abel Lowell | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `refuse_ruling` | Refuse him the orchard and ask the underworld office to rule on the claim. | acceptable |
| `sell_orchard` | Sell the orchard to a neighbor and give Abel half the money. | acceptable |
| `open_body` | Have the man's body opened to see what is inside. | **severe** |
| `sign_over` | Sign the orchard over to Abel and let him keep it. | - |

**Contrast** `P015` role `b`: In card a the man in Abel's place is the Lowells' own grandson home from the west; in card b he is an outsider the underworld office placed under Abel's name in a rebuilt body
- expected a: sign_over
- expected b: refuse_ruling
- structural differences from card a:
  - `context.events[id=e3]: <absent> -> {'id': 'e3', 'tick': 30360, 'type': 'rebuild', 'actors': [3], 'magnitude': 0, 'caused_by': [], 'tags': []}`
  - `context.people[id=3].origin: 'native' -> 'rebuilt'`
  - `context.situation: 'Josiah Lowell died a year ago. His will, signed by two neighbors, leaves the orchard to his grandson Abel, who was away in the west for eight years, and the rest of the estate to his daughter Irene, who is executor. Abel came home two months ago and has worked the orchard since. He asks Irene for the orchard.' -> "Josiah Lowell died a year ago. His will, signed by two neighbors, leaves the orchard to his grandson Abel, who was away in the west for eight years, and the rest of the estate to his daughter Irene, who is executor. Abel never came back. Two months ago the underworld office placed an outsider in a rebuilt body under Abel's name, and he has worked the orchard since. He asks Irene for it."`

*Author note:* The name in the will belongs to a grandson who never came back, and the man holding it arrived in a rebuilt body on the office's placement: a proud executor refuses the orchard and asks the office to rule, or sells it rather than hand family land to a stranger. Signing it over is out of character. Opening the body is absurd.

### D-will_execution-010

group `G032` · split `locked` · scored `True` · tick 31030 · subject 2 (Willa Nolan)

> Ephraim Nolan died last month. A witnessed will written two years ago leaves the farm to his daughter Willa, who stayed and nursed him, and $2,000 to his son Norris, who left town at twenty and came back for the funeral. Willa searched the house and found no other papers; the town clerk holds the will.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Ephraim Nolan | 80 | male | False | native | 0 | loyalty +1, pride +2 |
| 2 | Willa Nolan | 42 | female | True | native | 1100 | greed -1, loyalty +3, warmth +2 |
| 3 | Norris Nolan | 47 | male | True | native | 400 | greed +2, pride +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Willa Nolan | Ephraim Nolan | 70 | 70 | parent |
| Norris Nolan | Ephraim Nolan | 20 | 30 | parent |
| Willa Nolan | Norris Nolan | -30 | -20 | sibling |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 30270 | will | 1 Ephraim Nolan, 2 Willa Nolan | 26000 |  |  | written, witnessed, land |
| e3 | 31000 | death | 1 Ephraim Nolan | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `give_brother` | Sign the farm over to Norris. | - |
| `keep_farm` | Keep the farm in her own name. | acceptable |
| `ask_clerk` | Put the matter to the town clerk and abide by his ruling. | acceptable |

**Contrast** `P016` role `a`: Card b adds a second, later will in Ephraim's own hand leaving the farm to Norris
- expected a: keep_farm
- expected b: give_brother

*Author note:* There is one will, it is witnessed, it names Willa, and she searched the house herself: she keeps the farm. Putting the single will to the clerk, who already holds it, and abiding by his ruling is a careful step she might also take. Signing it to a brother who left at twenty makes no sense here. Nothing absurd arises.

### D-will_execution-011

group `G032` · split `locked` · scored `True` · tick 31030 · subject 2 (Willa Nolan)

> Ephraim Nolan died last month. A witnessed will written two years ago leaves the farm to his daughter Willa, who stayed and nursed him, and $2,000 to his son Norris, who left town at twenty and came back for the funeral. Willa then found a second will, signed and dated in her father's hand three weeks before he died, revoking the first and leaving the farm to Norris. The clerk holds both.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Ephraim Nolan | 80 | male | False | native | 0 | loyalty +1, pride +2 |
| 2 | Willa Nolan | 42 | female | True | native | 1100 | greed -1, loyalty +3, warmth +2 |
| 3 | Norris Nolan | 47 | male | True | native | 400 | greed +2, pride +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Willa Nolan | Ephraim Nolan | 70 | 70 | parent |
| Norris Nolan | Ephraim Nolan | 20 | 30 | parent |
| Willa Nolan | Norris Nolan | -30 | -20 | sibling |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 30270 | will | 1 Ephraim Nolan, 2 Willa Nolan | 26000 |  |  | written, witnessed, land |
| e2 | 30979 | will | 1 Ephraim Nolan, 3 Norris Nolan | 26000 |  |  | written, private, land |
| e3 | 31000 | death | 1 Ephraim Nolan | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `give_brother` | Sign the farm over to Norris. | acceptable |
| `keep_farm` | Keep the farm in her own name. | - |
| `ask_clerk` | Put the matter to the town clerk and abide by his ruling. | acceptable |

**Contrast** `P016` role `b`: Card b adds a second, later will in Ephraim's own hand leaving the farm to Norris
- expected a: keep_farm
- expected b: give_brother
- structural differences from card a:
  - `context.events[id=e2]: <absent> -> {'id': 'e2', 'tick': 30979, 'type': 'will', 'actors': [1, 3], 'magnitude': 26000, 'caused_by': [], 'tags': ['written', 'private', 'land']}`
  - `context.situation: 'Ephraim Nolan died last month. A witnessed will written two years ago leaves the farm to his daughter Willa, who stayed and nursed him, and $2,000 to his son Norris, who left town at twenty and came back for the funeral. Willa searched the house and found no other papers; the town clerk holds the will.' -> "Ephraim Nolan died last month. A witnessed will written two years ago leaves the farm to his daughter Willa, who stayed and nursed him, and $2,000 to his son Norris, who left town at twenty and came back for the funeral. Willa then found a second will, signed and dated in her father's hand three weeks before he died, revoking the first and leaving the farm to Norris. The clerk holds both."`

*Author note:* A later will, in her father's own hand and revoking the first, governs, and Willa is honest: she signs the farm to Norris or puts both papers to the clerk. Keeping it for herself overrides the last will, but it is not absurd, so severe is empty.

### D-will_execution-012

group `G033` · split `locked` · scored `True` · tick 31905 · subject 2 (Dewey Osborne)

> Erwin Osborne died two weeks ago. His witnessed will leaves his hardware shop building and stock to his nephew Dewey on one condition: Dewey keeps the shop open as a hardware store for ten years and does not sell the building. Dewey earns steady wages at the sawmill; the shop has lost money for three years and Erwin's ledgers show it. Dewey has $900 saved.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Erwin Osborne | 74 | male | False | native | 0 | loyalty +1, pride +2 |
| 2 | Dewey Osborne | 38 | male | True | native | 900 | greed +1, loyalty +2, pride +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Dewey Osborne | Erwin Osborne | 60 | 55 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 31800 | will | 1 Erwin Osborne, 2 Dewey Osborne | 14000 |  |  | written, witnessed, shop |
| e2 | 31890 | death | 1 Erwin Osborne | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `take_and_close` | Take the building and close the shop. | - |
| `strip_shop` | Take everything, scrap Erwin's tools and paint over the shop sign. | **severe** |
| `run_shop` | Leave the sawmill and run the shop as the will asks. | acceptable |
| `decline_bequest` | Decline the bequest and stay at the mill. | acceptable |

*Author note:* A loyal nephew with $900 either takes the shop on and loses his wages to keep the condition, or declines a business that has lost money for three years; both are believable. Taking the building and closing the shop breaks the condition for gain, which is out of character. Scrapping his uncle's tools and painting over the sign days after the funeral is offensive.

### D-will_execution-013

group `G034` · split `locked` · scored `True` · tick 29643 · subject 2 (Dorcas Hayes)

> Luther Hayes died three days ago. His will directs that $1,200 of his money be spent on joss paper and burned at his funeral on Saturday; the house goes to his widow Dorcas. The estate holds $1,300 in the bank. Dorcas has $200 of her own, winter coal to buy, and a son's school fee due in January.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Luther Hayes | 68 | male | False | native | 0 | pride +1, piety +3 |
| 2 | Dorcas Hayes | 61 | female | True | native | 200 | loyalty +2, warmth +2, piety +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Dorcas Hayes | Luther Hayes | 75 | 80 | spouse |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 29600 | will | 1 Luther Hayes, 2 Dorcas Hayes | 8000 |  |  | written, witnessed, house |
| e2 | 29640 | death | 1 Luther Hayes | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `burn_full` | Spend the $1,200 on joss paper and burn it at Saturday's funeral. | acceptable |
| `burn_part` | Burn $300 of it and keep the rest for coal and the school fee. | acceptable |
| `keep_cash` | Keep the cash and burn nothing at the funeral. | - |
| `mortgage_house` | Mortgage the house to buy joss paper for the funeral. | **severe** |

*Author note:* A loyal widow carries out a written instruction to burn $1,200 for her husband, or burns part and keeps the rest for coal, which is a smaller break of the same instruction and believable with $200 in hand. Burning nothing ignores a witnessed will entirely. Mortgaging the house she was left, to buy more paper, is absurd.

## reconcile_or_revenge

### D-reconcile_or_revenge-004

group `G035` · split `locked` · scored `True` · tick 14560 · subject 1 (Delia Pruitt)

> Four years ago at the church supper Wanda Sawyer read aloud a letter Delia Pruitt had written at nineteen, and Delia's engagement ended that winter. Wanda laughed, and she has never apologized. Delia has run the dry-goods store since. Wanda's husband Denton has been ill since spring, and this morning Wanda brings in a character reference for a school job and asks Delia to sign it.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Delia Pruitt | 58 | female | True | native | 4200 | loyalty +1, pride +2, warmth +1, temper +3 |
| 2 | Wanda Sawyer | 44 | female | True | native | 900 | pride +1 |
| 3 | Denton Sawyer | 47 | male | True | native | 900 | loyalty +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Delia Pruitt | Wanda Sawyer | -45 | -55 | neighbor |
| Wanda Sawyer | Denton Sawyer | 70 | 80 | spouse |
| Denton Sawyer | Wanda Sawyer | 65 | 75 | spouse |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 13100 | insult | 2 Wanda Sawyer, 1 Delia Pruitt | 70 |  |  | public, witnessed |
| e2 | 13140 | quarrel | 1 Delia Pruitt, 2 Wanda Sawyer | 60 |  | e1 |  |

| option | label | grade |
|---|---|---|
| `buy_medicine` | Refuse, then buy the druggist's whole stock of her husband's medicine. | **severe** |
| `sign_reference` | Sign the reference and hand it back without comment. | - |
| `refuse_quietly` | Set the form aside and say she cannot sign it. | - |
| `refuse_loudly` | Refuse in front of the counter queue and retell the letter story. | acceptable |

**Contrast** `P017` role `a`: Delia's temper is +3 in card a and -3 in card b; every other trait, relation and event is identical
- expected a: refuse_loudly
- expected b: refuse_quietly, sign_reference

*Author note:* Quick to anger and not a grudge-holder, Delia answers the request on the spot before the queue; a flat quiet refusal or signing the form asks for a patience her temper does not have. Clearing the shelf of a sick man's medicine to punish his wife is grotesque.

### D-reconcile_or_revenge-005

group `G035` · split `locked` · scored `True` · tick 14560 · subject 1 (Delia Pruitt)

> Four years ago at the church supper Wanda Sawyer read aloud a letter Delia Pruitt had written at nineteen, and Delia's engagement ended that winter. Wanda laughed, and she has never apologized. Delia has run the dry-goods store since. Wanda's husband Denton has been ill since spring, and this morning Wanda brings in a character reference for a school job and asks Delia to sign it.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Delia Pruitt | 58 | female | True | native | 4200 | loyalty +1, pride +2, warmth +1, temper -3 |
| 2 | Wanda Sawyer | 44 | female | True | native | 900 | pride +1 |
| 3 | Denton Sawyer | 47 | male | True | native | 900 | loyalty +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Delia Pruitt | Wanda Sawyer | -45 | -55 | neighbor |
| Wanda Sawyer | Denton Sawyer | 70 | 80 | spouse |
| Denton Sawyer | Wanda Sawyer | 65 | 75 | spouse |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 13100 | insult | 2 Wanda Sawyer, 1 Delia Pruitt | 70 |  |  | public, witnessed |
| e2 | 13140 | quarrel | 1 Delia Pruitt, 2 Wanda Sawyer | 60 |  | e1 |  |

| option | label | grade |
|---|---|---|
| `buy_medicine` | Refuse, then buy the druggist's whole stock of her husband's medicine. | **severe** |
| `sign_reference` | Sign the reference and hand it back without comment. | acceptable |
| `refuse_quietly` | Set the form aside and say she cannot sign it. | acceptable |
| `refuse_loudly` | Refuse in front of the counter queue and retell the letter story. | - |

**Contrast** `P017` role `b`: Delia's temper is +3 in card a and -3 in card b; every other trait, relation and event is identical
- expected a: refuse_loudly
- expected b: refuse_quietly, sign_reference
- structural differences from card a:
  - `context.people[id=1].traits.temper: 3 -> -3`

*Author note:* Slow to anger, Delia either declines without heat or signs the form and lets four years lie; a scene before the customers belongs to a different temper. The medicine purchase is grotesque for anyone here and does not depend on the temper.

### D-reconcile_or_revenge-006

group `G036` · split `locked` · scored `True` · tick 11995 · subject 1 (Cora Tanner)

> Eleven years ago Marcus Underwood sold a herd of cattle in partnership with Cora Tanner and kept Cora's $4,000 share. Cora sued him, lost on a missing receipt, and that winter her family sold their bottom pasture. Marcus now owns the mill and has bought the land on both sides of Cora's north field. He needs a right-of-way across it and offers $2,000. The other landowners along the road have not answered him yet.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Cora Tanner | 61 | female | True | native | 6000 | greed +1, loyalty +1, pride +1, vindictiveness +3 |
| 2 | Marcus Underwood | 52 | male | True | native | 15000 | greed +2, pride +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Cora Tanner | Marcus Underwood | -70 | -65 | rival |
| Marcus Underwood | Cora Tanner | -25 | -20 | rival |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 7980 | theft | 2 Marcus Underwood, 1 Cora Tanner | 4000 |  |  | cash, private |
| e2 | 8030 | lawsuit | 1 Cora Tanner, 2 Marcus Underwood | 4000 |  | e1 |  |

| option | label | grade |
|---|---|---|
| `burn_mill` | Refuse, and set the mill alight in the night. | **severe** |
| `sell_easement` | Sign the right-of-way and take the $2,000. | - |
| `sign_free` | Sign the right-of-way and take no money for it. | - |
| `refuse_flat` | Refuse to sign at any price. | acceptable |
| `block_neighbors` | Refuse, and talk the other landowners into refusing too. | acceptable |

**Contrast** `P018` role `a`: Cora's vindictiveness is +3 in card a and -3 in card b; every other trait, relation and event is identical
- expected a: refuse_flat, block_neighbors
- expected b: sell_easement, sign_free

*Author note:* With vindictiveness +3 an eleven-year grievance is still live, so Cora refuses the road and organising the neighbours is the payback that fits her. Selling or gifting the right-of-way is out of character. Burning the mill is absurd whatever she feels.

### D-reconcile_or_revenge-007

group `G036` · split `locked` · scored `True` · tick 11995 · subject 1 (Cora Tanner)

> Eleven years ago Marcus Underwood sold a herd of cattle in partnership with Cora Tanner and kept Cora's $4,000 share. Cora sued him, lost on a missing receipt, and that winter her family sold their bottom pasture. Marcus now owns the mill and has bought the land on both sides of Cora's north field. He needs a right-of-way across it and offers $2,000. The other landowners along the road have not answered him yet.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Cora Tanner | 61 | female | True | native | 6000 | greed +1, loyalty +1, pride +1, vindictiveness -3 |
| 2 | Marcus Underwood | 52 | male | True | native | 15000 | greed +2, pride +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Cora Tanner | Marcus Underwood | -70 | -65 | rival |
| Marcus Underwood | Cora Tanner | -25 | -20 | rival |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 7980 | theft | 2 Marcus Underwood, 1 Cora Tanner | 4000 |  |  | cash, private |
| e2 | 8030 | lawsuit | 1 Cora Tanner, 2 Marcus Underwood | 4000 |  | e1 |  |

| option | label | grade |
|---|---|---|
| `burn_mill` | Refuse, and set the mill alight in the night. | **severe** |
| `sell_easement` | Sign the right-of-way and take the $2,000. | acceptable |
| `sign_free` | Sign the right-of-way and take no money for it. | acceptable |
| `refuse_flat` | Refuse to sign at any price. | - |
| `block_neighbors` | Refuse, and talk the other landowners into refusing too. | - |

**Contrast** `P018` role `b`: Cora's vindictiveness is +3 in card a and -3 in card b; every other trait, relation and event is identical
- expected a: refuse_flat, block_neighbors
- expected b: sell_easement, sign_free
- structural differences from card a:
  - `context.people[id=1].traits.vindictiveness: 3 -> -3`

*Author note:* Someone who forgives easily takes the money and lets the old lawsuit go, or signs for nothing to be done with Marcus. Holding the road hostage is out of character for that temperament. Arson is absurd on any reading.

### D-reconcile_or_revenge-008

group `G037` · split `locked` · scored `True` · tick 20180 · subject 1 (Xavier Whitaker)

> Twelve years ago Margery Vance broke her engagement to Xavier Whitaker eight days before the wedding and married the miller's son. Three years later, at the county fair, she apologized to him in front of the church crowd and he took her hand and accepted it. Xavier never married and has run the livery for twenty years. Margery is widowed and short of money, and this week her son Clifford, sixteen, asks Xavier for work at the livery.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Xavier Whitaker | 46 | male | True | native | 5200 | loyalty +1, pride +2, vindictiveness +1 |
| 2 | Margery Vance | 43 | female | True | native | 700 | pride +1, warmth +1 |
| 3 | Clifford Vance | 16 | male | True | native | 0 | warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Xavier Whitaker | Margery Vance | -55 | -50 |  |
| Margery Vance | Xavier Whitaker | 20 | 30 | former_suitor |
| Margery Vance | Clifford Vance | 85 | 80 | child |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 15800 | courtship | 1 Xavier Whitaker, 2 Margery Vance | 70 |  |  |  |
| e2 | 15950 | quarrel | 2 Margery Vance, 1 Xavier Whitaker | 60 |  | e1 |  |
| e3 | 16895 | apology | 2 Margery Vance, 1 Xavier Whitaker | 50 |  |  | public, witnessed |

| option | label | grade |
|---|---|---|
| `refuse_quietly` | Tell Clifford the livery has no room for another hand. | - |
| `tell_boy_why` | Refuse, and tell Clifford why his mother is asking him to work for Xavier. | - |
| `work_him_hard` | Take Clifford on and keep him hungry and unpaid until his mother begs. | **severe** |
| `hire_boy` | Take Clifford on as an apprentice and say nothing about the past. | acceptable |

**Contrast** `P019` role `a`: Card a carries a public apology from Margery nine years ago (event e3), which Xavier accepted before the crowd, and says so in the situation; in card b she never apologized and the apology event is absent
- expected a: hire_boy
- expected b: refuse_quietly, tell_boy_why

*Author note:* The apology was made in public and Xavier accepted it before the whole church, so the account between them is closed on both sides; when her sixteen-year-old asks for work the in-character answer is to take him on, and a refusal would go back on his own public acceptance. Working him hungry is exploitation of a child.

### D-reconcile_or_revenge-009

group `G037` · split `locked` · scored `True` · tick 20180 · subject 1 (Xavier Whitaker)

> Twelve years ago Margery Vance broke her engagement to Xavier Whitaker eight days before the wedding and married the miller's son. She has never apologized for any of it. Xavier never married and has run the livery for twenty years. Margery is widowed and short of money, and this week her son Clifford, sixteen, asks Xavier for work at the livery.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Xavier Whitaker | 46 | male | True | native | 5200 | loyalty +1, pride +2, vindictiveness +1 |
| 2 | Margery Vance | 43 | female | True | native | 700 | pride +1, warmth +1 |
| 3 | Clifford Vance | 16 | male | True | native | 0 | warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Xavier Whitaker | Margery Vance | -55 | -50 |  |
| Margery Vance | Xavier Whitaker | 20 | 30 | former_suitor |
| Margery Vance | Clifford Vance | 85 | 80 | child |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 15800 | courtship | 1 Xavier Whitaker, 2 Margery Vance | 70 |  |  |  |
| e2 | 15950 | quarrel | 2 Margery Vance, 1 Xavier Whitaker | 60 |  | e1 |  |

| option | label | grade |
|---|---|---|
| `refuse_quietly` | Tell Clifford the livery has no room for another hand. | acceptable |
| `tell_boy_why` | Refuse, and tell Clifford why his mother is asking him to work for Xavier. | acceptable |
| `work_him_hard` | Take Clifford on and keep him hungry and unpaid until his mother begs. | **severe** |
| `hire_boy` | Take Clifford on as an apprentice and say nothing about the past. | - |

**Contrast** `P019` role `b`: Card a carries a public apology from Margery nine years ago (event e3), which Xavier accepted before the crowd, and says so in the situation; in card b she never apologized and the apology event is absent
- expected a: hire_boy
- expected b: refuse_quietly, tell_boy_why
- structural differences from card a:
  - `context.events[id=e3]: {'id': 'e3', 'tick': 16895, 'type': 'apology', 'actors': [2, 1], 'magnitude': 50, 'caused_by': [], 'tags': ['public', 'witnessed']} -> <absent>`
  - `context.situation: "Twelve years ago Margery Vance broke her engagement to Xavier Whitaker eight days before the wedding and married the miller's son. Three years later, at the county fair, she apologized to him in front of the church crowd and he took her hand and accepted it. Xavier never married and has run the livery for twenty years. Margery is widowed and short of money, and this week her son Clifford, sixteen, asks Xavier for work at the livery." -> "Twelve years ago Margery Vance broke her engagement to Xavier Whitaker eight days before the wedding and married the miller's son. She has never apologized for any of it. Xavier never married and has run the livery for twenty years. Margery is widowed and short of money, and this week her son Clifford, sixteen, asks Xavier for work at the livery."`

*Author note:* With no apology in twelve years Xavier refuses, either with a short excuse or by telling the boy plainly what his mother did. Hiring him asks for a forgiveness Xavier has no reason to give. The hungry-unpaid scheme is deliberate mistreatment of a sixteen-year-old, which is severe on any reading of the grudge.

### D-reconcile_or_revenge-010

group `G038` · split `locked` · scored `True` · tick 24500 · subject 1 (Harlan Ramsey)

> Spring flooding has washed out the Thorne lane, and no wagon reaches their hay ground for three weeks. The only dragline in the valley is Harlan Ramsey's. The creek quarrel began with the grandfathers over a strip of ground along the mill creek; Harlan's father Emory and Dorothy's father Enoch sued each other thirty-seven years ago, and the families have not traded since. At the town meeting Ulysses Thorne asks Harlan what he would charge to clear the lane.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Harlan Ramsey | 55 | male | True | native | 9000 | loyalty +1, pride +3, vindictiveness +1 |
| 2 | Dorothy Thorne | 58 | female | True | native | 8000 | pride +2, vindictiveness +2 |
| 3 | Whit Ramsey | 27 | male | True | native | 500 | loyalty +2 |
| 4 | Ulysses Thorne | 30 | male | True | native | 600 | loyalty +2 |
| 5 | Emory Ramsey | 82 | male | False | native | 0 | pride +2 |
| 6 | Enoch Thorne | 85 | male | False | native | 0 | vindictiveness +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Harlan Ramsey | Emory Ramsey | 60 | 70 | parent |
| Dorothy Thorne | Enoch Thorne | 55 | 65 | parent |
| Harlan Ramsey | Whit Ramsey | 80 | 70 | child |
| Dorothy Thorne | Ulysses Thorne | 80 | 70 | child |
| Harlan Ramsey | Dorothy Thorne | -70 | -70 | rival |
| Emory Ramsey | Enoch Thorne | -80 | -80 | rival |
| Whit Ramsey | Ulysses Thorne | -25 | -25 | rival |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 10980 | quarrel | 5 Emory Ramsey, 6 Enoch Thorne | 60 |  |  | land |
| e2 | 11010 | lawsuit | 5 Emory Ramsey, 6 Enoch Thorne | 3000 |  | e1 | land |
| e3 | 17200 | death | 5 Emory Ramsey | 0 |  |  |  |
| e4 | 20140 | death | 6 Enoch Thorne | 0 |  |  |  |
| e5 | 24460 | quarrel | 3 Whit Ramsey, 4 Ulysses Thorne | 50 |  |  | public |

| option | label | grade |
|---|---|---|
| `drown_meadow` | Open his ditch gate so the water stays on the Thorne meadow. | **severe** |
| `clear_free` | Send the dragline and two hands to clear the lane for nothing. | - |
| `quote_price` | Name a price of $600 and clear the lane. | acceptable |
| `ask_creek_strip` | Clear the lane in exchange for the creek strip. | acceptable |

*Author note:* Proud and still loyal to his own side, Harlan charges for the work, and pressing the old creek claim while the Thornes are desperate is exactly the selfish move in character. Working for nothing hands the family that sued his father a victory. Holding water on their meadow is malicious beyond the quarrel.

### D-reconcile_or_revenge-011

group `G038` · split `locked` · scored `True` · tick 24500 · subject 2 (Dorothy Thorne)

> The county is naming one man to the ditch board that sets the creek levels. Harlan Ramsey's son Whit is nominated, and so is Dorothy Thorne's son Ulysses; each family has five votes among the neighbours and the vote is tonight. The quarrel over the creek strip began with the grandfathers, and Dorothy's father Enoch and Harlan's father Emory sued each other thirty-seven years ago.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Harlan Ramsey | 55 | male | True | native | 9000 | loyalty +1, pride +3, vindictiveness +1 |
| 2 | Dorothy Thorne | 58 | female | True | native | 8000 | pride +2, vindictiveness +2 |
| 3 | Whit Ramsey | 27 | male | True | native | 500 | loyalty +2 |
| 4 | Ulysses Thorne | 30 | male | True | native | 600 | loyalty +2 |
| 5 | Emory Ramsey | 82 | male | False | native | 0 | pride +2 |
| 6 | Enoch Thorne | 85 | male | False | native | 0 | vindictiveness +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Harlan Ramsey | Emory Ramsey | 60 | 70 | parent |
| Dorothy Thorne | Enoch Thorne | 55 | 65 | parent |
| Harlan Ramsey | Whit Ramsey | 80 | 70 | child |
| Dorothy Thorne | Ulysses Thorne | 80 | 70 | child |
| Harlan Ramsey | Dorothy Thorne | -70 | -70 | rival |
| Emory Ramsey | Enoch Thorne | -80 | -80 | rival |
| Whit Ramsey | Ulysses Thorne | -25 | -25 | rival |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 10980 | quarrel | 5 Emory Ramsey, 6 Enoch Thorne | 60 |  |  | land |
| e2 | 11010 | lawsuit | 5 Emory Ramsey, 6 Enoch Thorne | 3000 |  | e1 | land |
| e3 | 17200 | death | 5 Emory Ramsey | 0 |  |  |  |
| e4 | 20140 | death | 6 Enoch Thorne | 0 |  |  |  |
| e5 | 24460 | quarrel | 3 Whit Ramsey, 4 Ulysses Thorne | 50 |  |  | public |

| option | label | grade |
|---|---|---|
| `back_whit` | Withdraw Ulysses and put the Thorne votes behind Whit. | - |
| `contest_seat` | Keep Ulysses in the race and work the room for every vote. | acceptable |

*Author note:* With vindictiveness +2 and the old suit still in her mouth, Dorothy keeps her son in the race and works the room for every vote; withdrawing him in favour of the Ramsey candidate is a reconciliation nothing on the card asks her for, so it is out of character but not absurd.

### D-reconcile_or_revenge-012

group `G039` · split `locked` · scored `True` · tick 24550 · subject 1 (Warren Walsh)

> Twelve years ago Warren Walsh's brother Jasper sold the family woodlot and kept Warren's $3,000 share. Jasper died a year ago. Since the burial a lamp goes out in Warren's kitchen most nights, and Jasper stands at the foot of his bed in dreams. Jasper's widow Lenore inherited $1,200 and has said nothing about the money. Townsfolk hold that a ghost lingers over an open debt until the living forgive it and burn joss paper to send him on.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Warren Walsh | 62 | male | True | native | 4500 | loyalty +1, pride +1, vindictiveness +1 |
| 2 | Jasper Walsh | 58 | male | False | native | 0 | greed +1 |
| 3 | Lenore Walsh | 55 | female | True | native | 1200 | loyalty +1, warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Warren Walsh | Jasper Walsh | -60 | -60 | sibling |
| Warren Walsh | Lenore Walsh | 0 | 10 | in_law |
| Lenore Walsh | Jasper Walsh | 70 | 80 | spouse |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 20160 | theft | 2 Jasper Walsh, 1 Warren Walsh | 3000 |  |  | land, private |
| e2 | 24185 | death | 2 Jasper Walsh | 0 |  |  |  |
| e3 | 24195 | inheritance | 2 Jasper Walsh, 3 Lenore Walsh | 1200 |  | e2 | cash |
| e4 | 24500 | haunting | 2 Jasper Walsh, 1 Warren Walsh | 45 |  |  |  |
| e5 | 24540 | dream | 2 Jasper Walsh, 1 Warren Walsh | 30 |  | e4 |  |

| option | label | grade |
|---|---|---|
| `burn_paper` | Forgive the $3,000 and burn joss paper to send Jasper on. | acceptable |
| `bill_widow` | Send Jasper on, but make Lenore pay for the joss paper out of her $1,200. | acceptable |
| `seal_ghost` | Petition the magistrate to seal Jasper's ghost out of the house. | acceptable |
| `open_grave` | Open the grave and sell the goods he was buried with. | **severe** |

*Author note:* Warren is owed $3,000 by a brother who never paid and now haunts him: forgiving the debt and sending the ghost on as the town's custom says, sending him on at the widow's cost, and asking the magistrate to seal the ghost are all believable for a man with a mild grudge and ordinary piety. Selling grave goods is grotesque.

### D-reconcile_or_revenge-013

group `G040` · split `locked` · scored `True` · tick 24550 · subject 1 (Minerva Yates)

> Six years ago a newborn died three days after Minerva Yates, the town's midwife, delivered it, and Belle Yates, her sister-in-law, told half the town that Minerva's care killed the child. The county inquest cleared Minerva of any fault, but two families stopped calling her. Belle never took it back. Tonight Belle's daughter Opal is in labour, the doctor is twenty miles away and the creek bridge is out, and Belle is at Minerva's door asking her to come.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Minerva Yates | 57 | female | True | native | 3400 | loyalty +2, pride +2, warmth +1, vindictiveness +1 |
| 2 | Belle Yates | 54 | female | True | native | 900 | pride +1 |
| 3 | Opal Yates | 22 | female | True | native | 0 | warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Minerva Yates | Belle Yates | -50 | -45 | in_law |
| Minerva Yates | Opal Yates | 30 | 40 | in_law |
| Belle Yates | Opal Yates | 75 | 80 | child |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 22360 | insult | 2 Belle Yates, 1 Minerva Yates | 80 |  |  | public, witnessed |
| e2 | 22380 | quarrel | 1 Minerva Yates, 2 Belle Yates | 65 |  | e1 |  |

| option | label | grade |
|---|---|---|
| `go_now` | Take the bag and go to the house with Belle. | acceptable |
| `set_terms` | Go once Belle repeats the inquest finding before the neighbours. | acceptable |
| `delay_care` | Go, and let the labour run long before she helps. | **severe** |

*Author note:* A birth with the bridge out comes before an old slander for a warm, loyal midwife, and so does naming her price of a public retraction before she goes. Slowing a labour on purpose to punish the mother would look monstrous on screen.

## debt_repayment

### D-debt_repayment-004

group `G041` · split `locked` · scored `True` · tick 20225 · subject 1 (Royce Bennett)

> Eight months ago Elva Calloway lent Royce Bennett $1,100 in cash to replace a mare that had died, so he could keep hauling. They signed a note at the store, the storekeeper witnessed it, and a copy sits with the town clerk. The note fell due six weeks ago. Royce has $2,400. This morning Elva asks him for the money at the feed store.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Royce Bennett | 44 | male | True | native | 2400 | greed +3, loyalty -2, pride +1 |
| 2 | Elva Calloway | 66 | female | True | native | 9000 | greed +1, warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Royce Bennett | Elva Calloway | 10 | 20 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 19990 | loan | 2 Elva Calloway, 1 Royce Bennett | 1100 | 20180 |  | cash, written |

| option | label | grade |
|---|---|---|
| `pay_full` | Pay her the $1,100 today. | acceptable |
| `pay_half` | Pay $550 today and promise the rest at the fair. | acceptable |
| `ask_time` | Ask her to wait for the spring hauling season. | - |
| `call_gift` | Tell her the money was a gift, not a loan. | **severe** |

**Contrast** `P020` role `a`: Card a: the loan is a signed, witnessed note on file with the town clerk, with a fixed due day. Card b: nothing written, no witness, no day fixed
- expected a: pay_full, pay_half
- expected b: ask_time, call_gift

*Author note:* A witnessed note on file at the clerk's office makes denial pointless, so a grasping but careful man pays, in full or in part, and stalling on a dated note is out of character. Calling a signed note a gift would look absurd on screen.

### D-debt_repayment-005

group `G041` · split `locked` · scored `True` · tick 20225 · subject 1 (Royce Bennett)

> Eight months ago Elva Calloway lent Royce Bennett $1,100 in cash to replace a mare that had died, so he could keep hauling. Nothing was written down, nobody else was present, and no day was fixed for repayment. Royce has $2,400. This morning Elva asks him for the money at the feed store.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Royce Bennett | 44 | male | True | native | 2400 | greed +3, loyalty -2, pride +1 |
| 2 | Elva Calloway | 66 | female | True | native | 9000 | greed +1, warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Royce Bennett | Elva Calloway | 10 | 20 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 19990 | loan | 2 Elva Calloway, 1 Royce Bennett | 1100 |  |  | cash, verbal |

| option | label | grade |
|---|---|---|
| `pay_full` | Pay her the $1,100 today. | - |
| `pay_half` | Pay $550 today and promise the rest at the fair. | - |
| `ask_time` | Ask her to wait for the spring hauling season. | acceptable |
| `call_gift` | Tell her the money was a gift, not a loan. | acceptable |

**Contrast** `P020` role `b`: Card a: the loan is a signed, witnessed note on file with the town clerk, with a fixed due day. Card b: nothing written, no witness, no day fixed
- expected a: pay_full, pay_half
- expected b: ask_time, call_gift
- structural differences from card a:
  - `context.events[id=e1].due_tick: 20180 -> <absent>`
  - `context.events[id=e1].tags[1]: 'written' -> 'verbal'`
  - `context.situation: 'Eight months ago Elva Calloway lent Royce Bennett $1,100 in cash to replace a mare that had died, so he could keep hauling. They signed a note at the store, the storekeeper witnessed it, and a copy sits with the town clerk. The note fell due six weeks ago. Royce has $2,400. This morning Elva asks him for the money at the feed store.' -> 'Eight months ago Elva Calloway lent Royce Bennett $1,100 in cash to replace a mare that had died, so he could keep hauling. Nothing was written down, nobody else was present, and no day was fixed for repayment. Royce has $2,400. This morning Elva asks him for the money at the feed store.'`

*Author note:* With nothing in writing and no witness, a grasping, disloyal debtor asks for time or denies the loan outright; paying the whole sum unpressed is out of character. Denial is shabby but not absurd here, because the town holds no record either way.

### D-debt_repayment-006

group `G042` · split `locked` · scored `True` · tick 20700 · subject 1 (Wendell Draper)

> Just over two years ago Myrtle Elkins lent Wendell Draper $800 in cash against a signed note to buy a second wagon. The note fell due twenty months ago. Myrtle has been ill all winter, her savings are down to $150, and the druggist will not extend credit. Wendell has $5,200 and a paying hauling route. Myrtle comes to his yard and asks for the $800.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Wendell Draper | 51 | male | True | native | 5200 | greed +2, loyalty +1 |
| 2 | Myrtle Elkins | 63 | female | True | native | 150 | warmth +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Wendell Draper | Myrtle Elkins | 20 | 30 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 19900 | loan | 2 Myrtle Elkins, 1 Wendell Draper | 800 | 20080 |  | cash, written |

| option | label | grade |
|---|---|---|
| `pay_part` | Pay $300 today and the rest next month. | - |
| `hold_off` | Say the money is tied up and he will send it when he can. | - |
| `forge_receipt` | Say he paid long ago and write her a receipt in his own hand. | **severe** |
| `pay_now` | Pay her the $800 today. | acceptable |

**Contrast** `P021` role `a`: Card a: Myrtle is ill, down to $150, and the druggist will not give credit. Card b: she is in good health with $12,000 in the bank and rent from two houses
- expected a: pay_now
- expected b: pay_part, hold_off

*Author note:* The lender is ill, nearly out of money, and the note is twenty months overdue, so a man with $5,200 pays it in full; part-payment leaves her short of medicine. Writing a receipt himself is forgery for the sake of $800 and would look absurd.

### D-debt_repayment-007

group `G042` · split `locked` · scored `True` · tick 20700 · subject 1 (Wendell Draper)

> Just over two years ago Myrtle Elkins lent Wendell Draper $800 in cash against a signed note to buy a second wagon. The note fell due twenty months ago. Myrtle is in good health, has $12,000 in the county bank and collects rent on two houses. Wendell has $5,200 and a paying hauling route. Myrtle comes to his yard and asks for the $800.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Wendell Draper | 51 | male | True | native | 5200 | greed +2, loyalty +1 |
| 2 | Myrtle Elkins | 63 | female | True | native | 12000 | warmth +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Wendell Draper | Myrtle Elkins | 20 | 30 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 19900 | loan | 2 Myrtle Elkins, 1 Wendell Draper | 800 | 20080 |  | cash, written |

| option | label | grade |
|---|---|---|
| `pay_part` | Pay $300 today and the rest next month. | acceptable |
| `hold_off` | Say the money is tied up and he will send it when he can. | acceptable |
| `forge_receipt` | Say he paid long ago and write her a receipt in his own hand. | **severe** |
| `pay_now` | Pay her the $800 today. | - |

**Contrast** `P021` role `b`: Card a: Myrtle is ill, down to $150, and the druggist will not give credit. Card b: she is in good health with $12,000 in the bank and rent from two houses
- expected a: pay_now
- expected b: pay_part, hold_off
- structural differences from card a:
  - `context.people[id=2].wealth: 150 -> 12000`
  - `context.situation: 'Just over two years ago Myrtle Elkins lent Wendell Draper $800 in cash against a signed note to buy a second wagon. The note fell due twenty months ago. Myrtle has been ill all winter, her savings are down to $150, and the druggist will not extend credit. Wendell has $5,200 and a paying hauling route. Myrtle comes to his yard and asks for the $800.' -> 'Just over two years ago Myrtle Elkins lent Wendell Draper $800 in cash against a signed note to buy a second wagon. The note fell due twenty months ago. Myrtle is in good health, has $12,000 in the county bank and collects rent on two houses. Wendell has $5,200 and a paying hauling route. Myrtle comes to his yard and asks for the $800.'`

*Author note:* With the lender comfortable and nobody pressing, a man who counts every dollar pays part or puts her off; handing over the whole $800 unpressed is out of character. The forged receipt is absurd whatever the creditor's means.

### D-debt_repayment-008

group `G043` · split `locked` · scored `True` · tick 20000 · subject 1 (Bram Fairley)

> Four months ago Eben Gentry sold Bram Fairley $600 of seed on credit, to be paid when the crop came in. The crop failed. Bram has $90, one milk cow, his tools, a wife and three children. Eben has $14,000 and has asked twice. Bram's brother Caleb farms the next place and has $3,000.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Bram Fairley | 38 | male | True | native | 90 | loyalty +2, pride +1, warmth +1 |
| 2 | Caleb Fairley | 41 | male | True | native | 3000 | greed +1, loyalty +1 |
| 3 | Eben Gentry | 57 | male | True | native | 14000 | greed +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Bram Fairley | Caleb Fairley | 60 | 60 | sibling |
| Caleb Fairley | Bram Fairley | 55 | 60 | sibling |
| Bram Fairley | Eben Gentry | 10 | 30 | neighbor |
| Caleb Fairley | Eben Gentry | 0 | 20 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 19880 | loan | 3 Eben Gentry, 1 Bram Fairley | 600 | 19960 |  | cash, verbal |
| e2 | 19880 | loan | 3 Eben Gentry, 2 Caleb Fairley | 900 | 19960 |  | cash, written |

| option | label | grade |
|---|---|---|
| `work_it_off` | Ask Eben to take the $600 out of farm work over the winter. | acceptable |
| `sell_stock` | Sell his tools and the milk cow and pay Eben in full. | - |

*Author note:* With $90, a family and a failed crop, a loyal man offers farm work against the seed account, which pays Eben and keeps the farm going. Selling the tools and the cow clears the debt and leaves him unable to work the place, so it is out of character though not absurd.

### D-debt_repayment-009

group `G043` · split `locked` · scored `True` · tick 20000 · subject 2 (Caleb Fairley)

> Four months ago Eben Gentry sold Caleb Fairley $900 of seed on a signed note, to be paid when the crop came in. Caleb's crop came in well and he has $3,000. The note is six weeks past its day and Eben has asked twice. Caleb's brother Bram farms the next place, lost his crop, and still owes Eben $600.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Bram Fairley | 38 | male | True | native | 90 | loyalty +2, pride +1, warmth +1 |
| 2 | Caleb Fairley | 41 | male | True | native | 3000 | greed +1, loyalty +1 |
| 3 | Eben Gentry | 57 | male | True | native | 14000 | greed +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Bram Fairley | Caleb Fairley | 60 | 60 | sibling |
| Caleb Fairley | Bram Fairley | 55 | 60 | sibling |
| Bram Fairley | Eben Gentry | 10 | 30 | neighbor |
| Caleb Fairley | Eben Gentry | 0 | 20 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 19880 | loan | 3 Eben Gentry, 1 Bram Fairley | 600 | 19960 |  | cash, verbal |
| e2 | 19880 | loan | 3 Eben Gentry, 2 Caleb Fairley | 900 | 19960 |  | cash, written |

| option | label | grade |
|---|---|---|
| `claim_draft` | Say the money is out on a draft and wait for it to clear. | - |
| `burn_note` | Get into Eben's desk at the store and burn the note. | **severe** |
| `pay_full` | Pay Eben the $900 today. | acceptable |
| `pay_part` | Pay $400 today and the rest after the spring ploughing. | acceptable |

*Author note:* Caleb has the money, the crop came in, and the note is his own signature, so he pays in full or in part. The draft story is out of character for a man with $3,000 in hand. Burning a note in the creditor's desk is a crime with nothing to gain.

### D-debt_repayment-010

group `G044` · split `locked` · scored `True` · tick 24500 · subject 1 (Wade Hollis)

> Five years ago Adele Jarvis lent Wade Hollis $2,500 in cash against a signed note so he could buy the hauling rig he still uses. The note fell due four years ago. Wade paid $200 once, two years ago, and nothing since. He has $3,100 now and has just sold his woodlot for another $2,000. Adele lives on $2,600 and a pension. She stops him at his own gate and asks when the rest is coming.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Wade Hollis | 47 | male | True | native | 3100 | greed +2, loyalty -1, pride +2 |
| 2 | Adele Jarvis | 59 | female | True | native | 2600 | greed +1, pride +1, warmth +1 |
| 3 | Ambrose Jarvis | 32 | male | True | native | 1200 | loyalty +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Wade Hollis | Adele Jarvis | -20 | -40 | neighbor |
| Adele Jarvis | Ambrose Jarvis | 75 | 80 | child |
| Wade Hollis | Ambrose Jarvis | 0 | -10 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 22675 | loan | 2 Adele Jarvis, 1 Wade Hollis | 2500 | 23040 |  | cash, written |
| e2 | 23770 | repayment | 1 Wade Hollis, 2 Adele Jarvis | 200 |  | e1 | partial, cash |

| option | label | grade |
|---|---|---|
| `pay_rest` | Pay the $2,300 still owed, today. | - |
| `offer_plan` | Offer $300 a month until the note is clear. | acceptable |
| `stall_again` | Say the woodlot money is spoken for and leave it at that. | acceptable |
| `dispute_note` | Say the note was for $1,500 and refuse the rest. | **severe** |

*Author note:* Four years of nothing on a signed note leave Wade a staller, so at his own gate he offers a plan or says the money is spoken for. Paying $2,300 unpressed is out of character. Rewriting the sum on a note Adele still holds would look absurd.

### D-debt_repayment-011

group `G044` · split `locked` · scored `True` · tick 24500 · subject 1 (Wade Hollis)

> Five years ago Adele Jarvis lent Wade Hollis $2,500 in cash against a signed note so he could buy the hauling rig he still uses. The note fell due four years ago. Wade paid $200 once, two years ago, and nothing since. He has $3,100 and just sold his woodlot for $2,000. At the church supper, before a dozen neighbours, Adele's son Ambrose asks in her name when the rest is coming.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Wade Hollis | 47 | male | True | native | 3100 | greed +2, loyalty -1, pride +2 |
| 2 | Adele Jarvis | 59 | female | True | native | 2600 | greed +1, pride +1, warmth +1 |
| 3 | Ambrose Jarvis | 32 | male | True | native | 1200 | loyalty +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Wade Hollis | Adele Jarvis | -20 | -40 | neighbor |
| Adele Jarvis | Ambrose Jarvis | 75 | 80 | child |
| Wade Hollis | Ambrose Jarvis | 0 | -10 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 22675 | loan | 2 Adele Jarvis, 1 Wade Hollis | 2500 | 23040 |  | cash, written |
| e2 | 23770 | repayment | 1 Wade Hollis, 2 Adele Jarvis | 200 |  | e1 | partial, cash |

| option | label | grade |
|---|---|---|
| `offer_plan` | Offer $300 a month until the note is clear. | acceptable |
| `stall_again` | Say the woodlot money is spoken for and leave it at that. | - |
| `dispute_note` | Say the note was for $1,500 and refuse the rest. | **severe** |
| `pay_rest` | Pay the $2,300 still owed, today. | acceptable |

*Author note:* Named in front of the church supper, a proud man with $5,100 to hand settles the note or promises a plan aloud; stalling again costs him his name in town. Disputing the figure on his own signed note would look absurd in front of the neighbours.

### D-debt_repayment-012

group `G045` · split `locked` · scored `True` · tick 24500 · subject 1 (Delphine Kemp)

> Thirteen years ago Absalom Kemp borrowed $3,000 from his brother Ezra against the north forty, signed a note at the kitchen table, and never paid any of it. Absalom died four months ago; the farm and $1,400 passed to his daughter Delphine, who works it alone. Ezra is seventy and has asked her for the money. In this town a debt follows the estate to the heir.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Delphine Kemp | 39 | female | True | native | 1400 | loyalty +2, pride +1, warmth +1 |
| 2 | Absalom Kemp | 71 | male | False | native | 0 | pride +2 |
| 3 | Ezra Kemp | 70 | male | True | native | 6000 | greed +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Delphine Kemp | Absalom Kemp | 70 | 75 | parent |
| Delphine Kemp | Ezra Kemp | 30 | 50 |  |
| Ezra Kemp | Absalom Kemp | 50 | 60 | sibling |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 19700 | loan | 3 Ezra Kemp, 2 Absalom Kemp | 3000 |  |  | written, land |
| e2 | 24380 | death | 2 Absalom Kemp | 0 |  |  |  |
| e3 | 24390 | inheritance | 2 Absalom Kemp, 1 Delphine Kemp | 9000 |  | e2 | house, land |
| e4 | 24450 | debt_transfer | 2 Absalom Kemp, 1 Delphine Kemp | 3000 |  | e1, e3 |  |

| option | label | grade |
|---|---|---|
| `deny_note` | Say her father never signed any note. | **severe** |
| `pay_instalments` | Pay Ezra $600 a year until the $3,000 is cleared. | acceptable |
| `pay_now` | Sell a field and pay Ezra the $3,000 this season. | acceptable |
| `offer_land` | Offer Ezra the north forty in place of the money. | acceptable |
| `refuse_inherited` | Tell Ezra the debt died with her father. | - |

*Author note:* The farm came with the note, and Delphine is loyal and honest, so she pays by instalments, sells a field to clear it, or hands back the ground the money bought. Refusing an inherited debt is selfish and out of character. Denying a note her uncle watched her father sign is absurd.

### D-debt_repayment-013

group `G046` · split `locked` · scored `True` · tick 24500 · subject 1 (Maribel Lindell)

> Three years ago Newell Bennett died and his paper shop passed to his son. A year ago Maribel Lindell's mother Eudora died, leaving Maribel the house and $900. Eudora had taken 500 sheets of joss paper on credit from Newell's shop to burn for her own mother and never paid for them. The office has entered the 500 sheets against Maribel, payable to Newell's ghost, and a clerk has told her so.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Maribel Lindell | 43 | female | True | native | 2100 | loyalty +1, warmth +1, piety +1 |
| 2 | Eudora Lindell | 68 | female | False | native | 0 | piety +2 |
| 3 | Newell Bennett | 74 | male | False | native | 0 | greed +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Maribel Lindell | Eudora Lindell | 75 | 80 | parent |
| Maribel Lindell | Newell Bennett | 0 | 10 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 23000 | loan | 3 Newell Bennett, 2 Eudora Lindell | 500 |  |  | joss_paper, verbal |
| e2 | 23400 | death | 3 Newell Bennett | 0 |  |  |  |
| e3 | 24135 | death | 2 Eudora Lindell | 0 |  |  |  |
| e4 | 24145 | inheritance | 2 Eudora Lindell, 1 Maribel Lindell | 900 |  | e3 | cash, house |
| e5 | 24150 | debt_transfer | 2 Eudora Lindell, 1 Maribel Lindell | 500 |  | e1, e4 |  |

| option | label | grade |
|---|---|---|
| `burn_full` | Burn 500 sheets of joss paper in Newell's name. | acceptable |
| `burn_part` | Burn 200 sheets now and the rest at the winter festival. | acceptable |
| `refuse_office` | Tell the clerk the sheets were her mother's debt and leave it. | - |
| `forge_receipt` | Buy a stamped receipt from a paper-seller and tell the clerk it is paid. | **severe** |

*Author note:* The sheets are entered against Maribel in the office and the creditor is a ghost, so she burns them, all at once or part now and part at the festival. Leaving a recorded debt to a ghost unpaid is out of character for a loyal, pious woman. A bought receipt would be a forged settlement with the dead, which is grotesque.

## remarriage

### D-remarriage-004

group `G047` · split `locked` · scored `True` · tick 11460 · subject 1 (Loretta Pelham)

> Loretta's husband Clay died four years ago. She is 49 and runs the family orchard with her son Dennis, 24, and daughter Pauline, 20. Archie Quarles, a widowed carpenter, has courted her since spring and proposes today. Archie owes the bank $2,800 for his workshop. The orchard needs $2,500 of repairs before winter. Loretta has $7,200 in the bank.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Loretta Pelham | 49 | female | True | native | 7200 | greed +1, loyalty +2, pride +1, warmth +2 |
| 2 | Clay Pelham | 52 | male | False | native | 0 | all 0 |
| 3 | Dennis Pelham | 24 | male | True | native | 600 | loyalty +2, warmth +1 |
| 4 | Archie Quarles | 54 | male | True | native | 200 | greed +1, warmth +2 |
| 5 | Pauline Pelham | 20 | female | True | native | 300 | warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Loretta Pelham | Clay Pelham | 75 | 70 | spouse |
| Loretta Pelham | Dennis Pelham | 70 | 65 | child |
| Loretta Pelham | Archie Quarles | 60 | 55 | suitor |
| Loretta Pelham | Pauline Pelham | 70 | 65 | child |
| Dennis Pelham | Archie Quarles | 35 | 40 | friend |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 10000 | death | 2 Clay Pelham | 0 |  |  |  |
| e2 | 10020 | offering | 1 Loretta Pelham, 2 Clay Pelham | 20 |  | e1 | joss_paper |
| e3 | 11300 | courtship | 4 Archie Quarles, 1 Loretta Pelham | 0 |  |  |  |
| e4 | 11460 | courtship | 4 Archie Quarles, 1 Loretta Pelham | 70 |  | e3 |  |

| option | label | grade |
|---|---|---|
| `wait_a_year` | Ask him to wait a year until the orchard is repaired. | acceptable |
| `keep_courting` | Keep courting him without setting any wedding date. | - |
| `sell_orchard` | Sell the orchard to cover the debt, the repairs and the wedding. | **severe** |
| `pay_his_debt` | Pay Archie's bank debt from her savings and marry him this fall. | acceptable |
| `let_him_settle` | Marry him and let him settle the bank debt himself. | acceptable |

**Contrast** `P022` role `a`: Loretta's savings are $7,200 in card a and $900 in card b; the $2,800 debt and the $2,500 repairs are the same in both
- expected a: pay_his_debt
- expected b: let_him_settle, wait_a_year

*Author note:* With $7,200 in hand, an orchard that needs $2,500 and a suitor she wants, covering his $2,800 debt from savings is a comfortable move for a woman of ordinary greed; marrying him and leaving the debt to him, or waiting a year, fits as well. Continual courtship without a date is out of character for warmth +2 but not absurd. Selling the orchard, her children's livelihood, for one wedding is absurd.

### D-remarriage-005

group `G047` · split `locked` · scored `True` · tick 11460 · subject 1 (Loretta Pelham)

> Loretta's husband Clay died four years ago. She is 49 and runs the family orchard with her son Dennis, 24, and daughter Pauline, 20. Archie Quarles, a widowed carpenter, has courted her since spring and proposes today. Archie owes the bank $2,800 for his workshop. The orchard needs $2,500 of repairs before winter. Loretta has $900 in the bank.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Loretta Pelham | 49 | female | True | native | 900 | greed +1, loyalty +2, pride +1, warmth +2 |
| 2 | Clay Pelham | 52 | male | False | native | 0 | all 0 |
| 3 | Dennis Pelham | 24 | male | True | native | 600 | loyalty +2, warmth +1 |
| 4 | Archie Quarles | 54 | male | True | native | 200 | greed +1, warmth +2 |
| 5 | Pauline Pelham | 20 | female | True | native | 300 | warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Loretta Pelham | Clay Pelham | 75 | 70 | spouse |
| Loretta Pelham | Dennis Pelham | 70 | 65 | child |
| Loretta Pelham | Archie Quarles | 60 | 55 | suitor |
| Loretta Pelham | Pauline Pelham | 70 | 65 | child |
| Dennis Pelham | Archie Quarles | 35 | 40 | friend |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 10000 | death | 2 Clay Pelham | 0 |  |  |  |
| e2 | 10020 | offering | 1 Loretta Pelham, 2 Clay Pelham | 20 |  | e1 | joss_paper |
| e3 | 11300 | courtship | 4 Archie Quarles, 1 Loretta Pelham | 0 |  |  |  |
| e4 | 11460 | courtship | 4 Archie Quarles, 1 Loretta Pelham | 70 |  | e3 |  |

| option | label | grade |
|---|---|---|
| `wait_a_year` | Ask him to wait a year until the orchard is repaired. | acceptable |
| `keep_courting` | Keep courting him without setting any wedding date. | - |
| `sell_orchard` | Sell the orchard to cover the debt, the repairs and the wedding. | **severe** |
| `pay_his_debt` | Pay Archie's bank debt from her savings and marry him this fall. | - |
| `let_him_settle` | Marry him and let him settle the bank debt himself. | acceptable |

**Contrast** `P022` role `b`: Loretta's savings are $7,200 in card a and $900 in card b; the $2,800 debt and the $2,500 repairs are the same in both
- expected a: pay_his_debt
- expected b: let_him_settle, wait_a_year
- structural differences from card a:
  - `context.people[id=1].wealth: 7200 -> 900`
  - `context.situation: "Loretta's husband Clay died four years ago. She is 49 and runs the family orchard with her son Dennis, 24, and daughter Pauline, 20. Archie Quarles, a widowed carpenter, has courted her since spring and proposes today. Archie owes the bank $2,800 for his workshop. The orchard needs $2,500 of repairs before winter. Loretta has $7,200 in the bank." -> "Loretta's husband Clay died four years ago. She is 49 and runs the family orchard with her son Dennis, 24, and daughter Pauline, 20. Archie Quarles, a widowed carpenter, has courted her since spring and proposes today. Archie owes the bank $2,800 for his workshop. The orchard needs $2,500 of repairs before winter. Loretta has $900 in the bank."`

*Author note:* With $900 against a $2,500 repair bill, paying a third party's $2,800 debt is not open to her, so the reasonable answers are to marry him and leave the debt where it is, or to wait for the harvest. Endless courtship is out of character for warmth +2 but not absurd. Selling the orchard to fund a wedding is absurd.

### D-remarriage-006

group `G048` · split `locked` · scored `True` · tick 6560 · subject 1 (Edna Norwood)

> Edna's husband Merle died seven years ago. She is 61, keeps bees, and lives alone; their son Neal, 38, is married and lives two streets away. Grady Radford, a widowed cooper of 64, has courted her since spring and proposed yesterday. Neal and his wife would be glad of the marriage. Edna burns joss paper for Merle at every new moon.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Edna Norwood | 61 | female | True | native | 2600 | loyalty +2, warmth +1, piety +2 |
| 2 | Neal Norwood | 38 | male | True | native | 3100 | warmth +1 |
| 3 | Merle Norwood | 63 | male | False | native | 0 | all 0 |
| 4 | Grady Radford | 64 | male | True | native | 1900 | loyalty +1, warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Edna Norwood | Merle Norwood | 75 | 70 | spouse |
| Edna Norwood | Neal Norwood | 65 | 60 | child |
| Edna Norwood | Grady Radford | 55 | 50 | suitor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 4000 | death | 3 Merle Norwood | 0 |  |  |  |
| e2 | 4030 | offering | 1 Edna Norwood, 3 Merle Norwood | 15 |  | e1 | joss_paper |
| e3 | 6400 | courtship | 4 Grady Radford, 1 Edna Norwood | 0 |  |  |  |
| e4 | 6559 | courtship | 4 Grady Radford, 1 Edna Norwood | 60 |  | e3 |  |

| option | label | grade |
|---|---|---|
| `stop_paper` | Accept Grady and stop burning joss paper for Merle. | - |
| `accept` | Accept Grady's proposal and set a date for the fall. | acceptable |
| `ask_merle` | Burn joss paper and ask Merle's leave before she answers. | acceptable |
| `decline` | Decline and keep the house and the bees to herself. | acceptable |

**Contrast** `P023` role `a`: Card b adds a dream on the night of the proposal, in which Merle shakes his head at Grady's coat on the peg
- expected a: accept
- expected b: ask_merle, decline

*Author note:* Seven years a widow, a suitor she likes, her son's household in favour: accepting is natural, and asking Merle's leave before answering also fits a widow who burns for him every new moon. Declining is possible without being expected. Giving up the offerings for her husband is out of character for piety +2, so it is neither acceptable nor severe.

### D-remarriage-007

group `G048` · split `locked` · scored `True` · tick 6560 · subject 1 (Edna Norwood)

> Edna's husband Merle died seven years ago. She is 61, keeps bees, and lives alone; their son Neal, 38, is married and lives two streets away. Grady Radford, a widowed cooper of 64, has courted her since spring and proposed yesterday. Neal and his wife would be glad of the marriage. Edna burns joss paper for Merle at every new moon. Before she answered, she dreamed last night of Merle shaking his head at Grady's coat on the peg.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Edna Norwood | 61 | female | True | native | 2600 | loyalty +2, warmth +1, piety +2 |
| 2 | Neal Norwood | 38 | male | True | native | 3100 | warmth +1 |
| 3 | Merle Norwood | 63 | male | False | native | 0 | all 0 |
| 4 | Grady Radford | 64 | male | True | native | 1900 | loyalty +1, warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Edna Norwood | Merle Norwood | 75 | 70 | spouse |
| Edna Norwood | Neal Norwood | 65 | 60 | child |
| Edna Norwood | Grady Radford | 55 | 50 | suitor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 4000 | death | 3 Merle Norwood | 0 |  |  |  |
| e2 | 4030 | offering | 1 Edna Norwood, 3 Merle Norwood | 15 |  | e1 | joss_paper |
| e3 | 6400 | courtship | 4 Grady Radford, 1 Edna Norwood | 0 |  |  |  |
| e4 | 6559 | courtship | 4 Grady Radford, 1 Edna Norwood | 60 |  | e3 |  |
| e5 | 6560 | dream | 3 Merle Norwood, 1 Edna Norwood | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `stop_paper` | Accept Grady and stop burning joss paper for Merle. | - |
| `accept` | Accept Grady's proposal and set a date for the fall. | - |
| `ask_merle` | Burn joss paper and ask Merle's leave before she answers. | acceptable |
| `decline` | Decline and keep the house and the bees to herself. | acceptable |

**Contrast** `P023` role `b`: Card b adds a dream on the night of the proposal, in which Merle shakes his head at Grady's coat on the peg
- expected a: accept
- expected b: ask_merle, decline
- structural differences from card a:
  - `context.events[id=e5]: <absent> -> {'id': 'e5', 'tick': 6560, 'type': 'dream', 'actors': [3, 1], 'magnitude': 0, 'caused_by': [], 'tags': []}`
  - `context.situation: "Edna's husband Merle died seven years ago. She is 61, keeps bees, and lives alone; their son Neal, 38, is married and lives two streets away. Grady Radford, a widowed cooper of 64, has courted her since spring and proposed yesterday. Neal and his wife would be glad of the marriage. Edna burns joss paper for Merle at every new moon." -> "Edna's husband Merle died seven years ago. She is 61, keeps bees, and lives alone; their son Neal, 38, is married and lives two streets away. Grady Radford, a widowed cooper of 64, has courted her since spring and proposed yesterday. Neal and his wife would be glad of the marriage. Edna burns joss paper for Merle at every new moon. Before she answered, she dreamed last night of Merle shaking his head at Grady's coat on the peg."`

*Author note:* The dream is Merle refusing the match, and Edna is a widow who burns for him at every new moon: asking his leave or letting the proposal go is what this person does here. Marrying anyway, this month or at all, is out of character for piety +2 so it is neither acceptable nor severe; abandoning the offerings is out of character for the same reason.

### D-remarriage-008

group `G049` · split `locked` · scored `True` · tick 7425 · subject 1 (Murray Talbot)

> Murray's wife Jean died fourteen months ago, leaving him with Clementine, 5, and Nelson, 3. Lucille Varner, 29, who runs the laundry, has helped with the children since winter and would marry him. Jean's mother Geneva Shelby, 63, has told him that a stepmother will not do and that she will take the children to her house and sue him for them.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Murray Talbot | 34 | male | True | native | 1800 | loyalty +1, pride +1, warmth +2 |
| 2 | Jean Talbot | 31 | female | False | native | 0 | all 0 |
| 3 | Lucille Varner | 29 | female | True | native | 900 | warmth +2, piety +1 |
| 4 | Clementine Talbot | 5 | female | True | native | 0 | all 0 |
| 5 | Nelson Talbot | 3 | male | True | native | 0 | all 0 |
| 6 | Geneva Shelby | 63 | female | True | native | 5000 | pride +2, warmth +1, vindictiveness +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Murray Talbot | Jean Talbot | 80 | 75 | spouse |
| Murray Talbot | Lucille Varner | 55 | 50 | suitor |
| Murray Talbot | Clementine Talbot | 90 | 70 | child |
| Murray Talbot | Nelson Talbot | 90 | 70 | child |
| Geneva Shelby | Murray Talbot | 15 | 25 | in_law |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 7000 | death | 2 Jean Talbot | 0 |  |  |  |
| e2 | 7040 | offering | 1 Murray Talbot, 2 Jean Talbot | 10 |  | e1 | joss_paper |
| e3 | 7350 | help | 3 Lucille Varner, 1 Murray Talbot | 50 |  |  |  |
| e4 | 7420 | courtship | 3 Lucille Varner, 1 Murray Talbot | 60 |  | e3 |  |

| option | label | grade |
|---|---|---|
| `propose_now` | Ask Lucille to marry him and face Geneva's suit. | acceptable |
| `ask_blessing` | Ask Geneva's blessing first, then propose to Lucille. | acceptable |
| `wait_for_school` | Wait until Clementine starts school before deciding. | acceptable |
| `send_children` | Send Clementine and Nelson to Geneva and marry Lucille. | **severe** |

*Author note:* A warm father of two small children takes the risk of Geneva's suit, buys her off with courtesy, or waits a season; all three keep his children with him. Sending a five-year-old and a three-year-old away to clear the way for a wedding is cruel and absurd for warmth +2.

### D-remarriage-009

group `G049` · split `locked` · scored `True` · tick 7425 · subject 6 (Geneva Shelby)

> Geneva Shelby is 63 and her daughter Jean died fourteen months ago. Her son-in-law Murray Talbot, 34, is courting Lucille Varner, who runs the laundry. Geneva believes the children will lose their mother's place in the house once a stepmother comes. She has $5,000 and has spoken to the town's justice of the peace. Clementine, 5, has told her that Lucille is strict.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Murray Talbot | 34 | male | True | native | 1800 | loyalty +1, pride +1, warmth +2 |
| 2 | Jean Talbot | 31 | female | False | native | 0 | all 0 |
| 3 | Lucille Varner | 29 | female | True | native | 900 | warmth +2, piety +1 |
| 4 | Clementine Talbot | 5 | female | True | native | 0 | all 0 |
| 5 | Nelson Talbot | 3 | male | True | native | 0 | all 0 |
| 6 | Geneva Shelby | 63 | female | True | native | 5000 | pride +2, warmth +1, vindictiveness +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Murray Talbot | Jean Talbot | 80 | 75 | spouse |
| Murray Talbot | Lucille Varner | 55 | 50 | suitor |
| Murray Talbot | Clementine Talbot | 90 | 70 | child |
| Murray Talbot | Nelson Talbot | 90 | 70 | child |
| Geneva Shelby | Murray Talbot | 15 | 25 | in_law |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 7000 | death | 2 Jean Talbot | 0 |  |  |  |
| e2 | 7040 | offering | 1 Murray Talbot, 2 Jean Talbot | 10 |  | e1 | joss_paper |
| e3 | 7350 | help | 3 Lucille Varner, 1 Murray Talbot | 50 |  |  |  |
| e4 | 7420 | courtship | 3 Lucille Varner, 1 Murray Talbot | 60 |  | e3 |  |

| option | label | grade |
|---|---|---|
| `offer_money` | Offer Murray money towards the children's keep if he waits two years. | acceptable |
| `talk_to_lucille` | Talk to Lucille about the children's place in the house. | acceptable |
| `take_children_home` | Take the children to her house one night and refuse to return them. | **severe** |
| `sue_for_children` | File with the justice of the peace to take the children from Murray. | acceptable |

*Author note:* A proud, unforgiving grandmother with money does sue for her daughter's children, and offering to pay for their keep or speaking to the stepmother are the lawful versions of the same move. Taking the children in the night and keeping them is child-stealing and would look grotesque.

### D-remarriage-010

group `G050` · split `locked` · scored `True` · tick 6120 · subject 1 (Helen Upton)

> Helen's husband Barrett died three years ago. She is 44 and keeps his hardware store. Horace Maddox, 46, arrived in a body assigned by the underworld office two years ago and has worked there since. He asks her to marry him this month. A possessed man needs the office's leave to head a household, and only householders' marriages are registered. The licence costs 40 joss paper; applications are open now and decided at the hearing in eight months.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Helen Upton | 44 | female | True | native | 3600 | loyalty +1, pride +1, warmth +2 |
| 2 | Barrett Upton | 47 | male | False | native | 0 | all 0 |
| 3 | Horace Maddox | 46 | male | True | possessed | 1200 | greed +2, loyalty +1, pride +1 |
| 4 | Irving Upton | 17 | male | True | native | 0 | pride +2, temper -1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Helen Upton | Barrett Upton | 75 | 70 | spouse |
| Helen Upton | Horace Maddox | 60 | 55 | suitor |
| Helen Upton | Irving Upton | 80 | 60 | child |
| Irving Upton | Horace Maddox | -30 | -35 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 5000 | death | 2 Barrett Upton | 0 |  |  |  |
| e2 | 5400 | possession | 3 Horace Maddox | 0 |  |  |  |
| e3 | 5900 | courtship | 3 Horace Maddox, 1 Helen Upton | 0 |  |  |  |
| e4 | 6100 | help | 3 Horace Maddox, 1 Helen Upton | 60 |  | e3 |  |

| option | label | grade |
|---|---|---|
| `marry_and_register_later` | Marry him this month and register the household after the hearing. | acceptable |
| `wait_for_hearing` | Put off any answer until after the office's hearing. | acceptable |
| `ask_office_first` | Apply for the office's leave now and set the wedding for the day it is granted. | acceptable |
| `decline_outsider` | Decline because he is an outsider. | - |
| `sell_store_for_licence` | Sell the store to raise the money for the licence. | **severe** |

*Author note:* Marrying now and registering at the hearing, waiting for the hearing, or asking leave first all lead to the same household, and she is a warm woman who wants it. Refusing a man she has worked beside for two years only because he is possessed is out of character but not absurd. Selling the store, her living, to raise 40 joss paper is absurd.

### D-remarriage-011

group `G050` · split `locked` · scored `True` · tick 6120 · subject 3 (Horace Maddox)

> Horace Maddox came to town two years ago in a body assigned by the underworld office. He has worked at Helen Upton's hardware store since and asks Helen, 44, to marry him. His body is held on a licence reviewed yearly, and the office can withdraw it if the household changes without leave. Helen owns the store and has $3,600. The next hearing is in eight months and a licence costs 40 joss paper.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Helen Upton | 44 | female | True | native | 3600 | loyalty +1, pride +1, warmth +2 |
| 2 | Barrett Upton | 47 | male | False | native | 0 | all 0 |
| 3 | Horace Maddox | 46 | male | True | possessed | 1200 | greed +2, loyalty +1, pride +1 |
| 4 | Irving Upton | 17 | male | True | native | 0 | pride +2, temper -1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Helen Upton | Barrett Upton | 75 | 70 | spouse |
| Helen Upton | Horace Maddox | 60 | 55 | suitor |
| Helen Upton | Irving Upton | 80 | 60 | child |
| Irving Upton | Horace Maddox | -30 | -35 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 5000 | death | 2 Barrett Upton | 0 |  |  |  |
| e2 | 5400 | possession | 3 Horace Maddox | 0 |  |  |  |
| e3 | 5900 | courtship | 3 Horace Maddox, 1 Helen Upton | 0 |  |  |  |
| e4 | 6100 | help | 3 Horace Maddox, 1 Helen Upton | 60 |  | e3 |  |

| option | label | grade |
|---|---|---|
| `give_body_back` | Give the body back to the office and let the licence end. | **severe** |
| `tell_helen_and_wait` | Tell Helen about the licence and wait for the hearing. | acceptable |
| `marry_and_say_nothing` | Marry Helen this month and say nothing about the licence. | acceptable |
| `ask_office_for_leave` | Ask the office for leave before the wedding. | acceptable |
| `leave_town` | Leave town before the review and start again elsewhere. | - |

*Author note:* A man who wants the wife and the counter behind it tells her and waits, asks the office properly, or, being greedy and sure of himself, marries first and lets the review find him married. Leaving town is out of character for him but not absurd. Handing back the only body he has over a licence formality is absurd and would read as suicide.

### D-remarriage-012

group `G051` · split `locked` · scored `True` · tick 9890 · subject 1 (Rollo Oakley)

> Rollo's wife Ethel died three years ago. He is 72, lives in the almshouse cottage, and draws $45 a month from the town's widowers' fund, which stops on remarriage. His rent is $30 a month and he can no longer chop his own firewood. Florence Upton, 68, a widow with a house and $4,000, has twice asked him to marry her. His daughter Regina, 45, says he is too old to start over.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Rollo Oakley | 72 | male | True | native | 800 | greed +2, pride +1, warmth +1 |
| 2 | Ethel Oakley | 69 | female | False | native | 0 | all 0 |
| 3 | Florence Upton | 68 | female | True | native | 4000 | warmth +2 |
| 4 | Regina Oakley | 45 | female | True | native | 2000 | pride +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Rollo Oakley | Ethel Oakley | 80 | 75 | spouse |
| Rollo Oakley | Florence Upton | 65 | 60 | suitor |
| Rollo Oakley | Regina Oakley | 70 | 55 | child |
| Regina Oakley | Florence Upton | -20 | -25 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 8800 | death | 2 Ethel Oakley | 0 |  |  |  |
| e2 | 9700 | courtship | 3 Florence Upton, 1 Rollo Oakley | 0 |  |  |  |
| e3 | 9880 | courtship | 3 Florence Upton, 1 Rollo Oakley | 50 |  | e2 |  |

| option | label | grade |
|---|---|---|
| `keep_courting` | Keep courting Florence and stay in the cottage. | acceptable |
| `decline_her` | Decline and stop seeing Florence. | - |
| `keep_the_fund` | Marry Florence and go on drawing the widowers' fund. | **severe** |
| `marry_florence` | Marry Florence and move into her house. | acceptable |

*Author note:* A cold-boned, money-counting old man gains by the marriage: Florence's house ends his rent and his firewood problem, and staying put with the $45 keeps him fed, so both paths are in character. Turning her down twice over is out of character for warmth +1 but not absurd. Marrying into a house and still drawing a fund that stops on marriage is fraud against the town, and the office keeps the register.

### D-remarriage-013

group `G052` · split `locked` · scored `True` · tick 8700 · subject 1 (Darrell Radford)

> Darrell's wife Nola died two years ago, leaving him with Nina, 9. Dulcie Norwood, 38, has courted him since spring and will marry him on one condition: Nina goes to live with Darrell's sister in another state. Darrell has $2,200 and a house with two rooms. Nina has lived in that house since she was born.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Darrell Radford | 41 | male | True | native | 2200 | loyalty +2, warmth +2 |
| 2 | Nina Radford | 9 | female | True | native | 0 | all 0 |
| 3 | Dulcie Norwood | 38 | female | True | native | 1100 | pride +2 |
| 4 | Nola Radford | 39 | female | False | native | 0 | all 0 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Darrell Radford | Nola Radford | 80 | 75 | spouse |
| Darrell Radford | Nina Radford | 95 | 80 | child |
| Darrell Radford | Dulcie Norwood | 50 | 45 | suitor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 8000 | death | 4 Nola Radford | 0 |  |  |  |
| e2 | 8500 | courtship | 3 Dulcie Norwood, 1 Darrell Radford | 0 |  |  |  |
| e3 | 8690 | courtship | 3 Dulcie Norwood, 1 Darrell Radford | 45 |  | e2 |  |

| option | label | grade |
|---|---|---|
| `ask_dulcie_to_wait` | Ask Dulcie to put the wedding off until Nina is older. | acceptable |
| `send_nina` | Marry Dulcie and send Nina to his sister. | **severe** |
| `keep_nina` | End the courtship and raise Nina himself. | acceptable |

*Author note:* A loyal, warm father keeps the child he has raised alone for two years and lets the courtship go, or asks the suitor to wait until the girl is older; both keep Nina in her own house. Sending a nine-year-old away from the only home she has known to clear the way for a wedding is cruel and absurd.

## magistrate_ruling

### D-magistrate_ruling-004

group `G053` · split `locked` · scored `True` · tick 8070 · subject 4 (Magistrate Qin)

> Floyd Wade died eight years ago and waits fortieth in the rebirth queue. Two months ago his daughter Vada burned 200 joss paper for him at the spring rite. Office rules give 200 joss paper twenty places up the queue, but the clerk entered the credit against another soul's name. Floyd appeals. The rules let the magistrate restore a lost place, move a soul up one place per month lost, or fine the clerk up to 100.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Floyd Wade | 59 | male | False | native | 0 | pride +1 |
| 2 | Bert Crane | 44 | male | False | native | 0 | all 0 |
| 3 | Vada Wade | 33 | female | True | native | 1400 | all 0 |
| 4 | Magistrate Qin | 640 | male | True | official | 0 | greed +2, loyalty +2, pride +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Floyd Wade | Vada Wade | 70 | 65 | child |
| Magistrate Qin | Floyd Wade | 5 | 10 |  |
| Magistrate Qin | Bert Crane | 0 | 0 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 5000 | death | 1 Floyd Wade | 0 |  |  |  |
| e2 | 5200 | death | 2 Bert Crane | 0 |  |  |  |
| e3 | 8000 | offering | 3 Vada Wade, 1 Floyd Wade | 200 |  |  | joss_paper, witnessed |
| e4 | 8060 | appeal | 1 Floyd Wade, 4 Magistrate Qin | 0 |  | e3 |  |

| option | label | grade |
|---|---|---|
| `move_up_monthly` | Move Floyd up one place for each month the credit was lost. | acceptable |
| `fine_the_clerk` | Leave the order as it stands and fine the clerk 100 joss paper. | acceptable |
| `next_newborn_slot` | Grant Floyd the next newborn slot instead. | - |
| `strike_both` | Strike both souls from the register and restart their waiting. | **severe** |
| `restore_place` | Move Floyd up twenty places and strike the other credit. | acceptable |

*Author note:* The credit is in the office's own record and Qin holds to the office's rules: restoring the twenty places is exactly the remedy written down, the per-month remedy is the same compensation measured differently, and fining the clerk is the lawful punishment for the error. Jumping the whole queue is outside the three remedies, so it is out of character but not absurd. Striking the souls for a clerical slip is grotesque.

### D-magistrate_ruling-005

group `G054` · split `locked` · scored `True` · tick 10100 · subject 1 (Magistrate Bai)

> Garland Crane, who lost a fence case to Elwood Barlow's father, has haunted Elwood since boyhood. Garland died fourteen years ago; the last haunting was four years ago, and Elwood's grandmother Ursula died two years ago. The family has only now learned that the office hears haunting complaints. It hears them only within ten years of the haunting and may fine the haunter up to 150 joss paper or order him to keep away.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Magistrate Bai | 510 | female | True | official | 0 | greed -1, loyalty +3, pride +3, temper +2, vindictiveness +2 |
| 2 | Ursula Barlow | 71 | female | False | native | 0 | all 0 |
| 3 | Elwood Barlow | 24 | male | True | native | 900 | all 0 |
| 4 | Garland Crane | 71 | male | False | native | 0 | temper +2, vindictiveness +3 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Ursula Barlow | Elwood Barlow | 80 | 70 | grandchild |
| Garland Crane | Elwood Barlow | -80 | -70 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 4990 | death | 4 Garland Crane | 0 |  |  |  |
| e2 | 8640 | haunting | 4 Garland Crane, 3 Elwood Barlow | 70 |  |  | witnessed |
| e3 | 9370 | death | 2 Ursula Barlow | 0 |  |  |  |
| e4 | 10090 | appeal | 2 Ursula Barlow, 1 Magistrate Bai | 0 |  | e2 |  |

| option | label | grade |
|---|---|---|
| `fine_haunter` | Fine Garland 150 joss paper and order him to keep away from Elwood. | acceptable |
| `warn_and_order` | Order him to keep away from Elwood and set no fine. | acceptable |
| `dismiss_late` | Decline to hear the complaint as out of time. | - |
| `burn_remains` | Have Garland's remains dug up and burned to end the haunting. | **severe** |

**Contrast** `P025` role `a`: The last haunting was four years ago in card a and twelve years ago in card b; the office hears such complaints only within ten years
- expected a: fine_haunter
- expected b: dismiss_late

*Author note:* The complaint is inside the ten years and the office witnessed the haunting, so a proud, vindictive magistrate fines the haunter at the ceiling, or at least orders him off; ordering him away without a fine is the lenient version of the same ruling. Declining as late is wrong while the haunting is four years old, and not absurd either way. Burning a ghost's remains is desecration.

### D-magistrate_ruling-006

group `G054` · split `locked` · scored `True` · tick 10100 · subject 1 (Magistrate Bai)

> Garland Crane, who lost a fence case to Elwood Barlow's father, has haunted Elwood since boyhood. Garland died fourteen years ago; the last haunting was twelve years ago, and Elwood's grandmother Ursula died two years ago. The family has only now learned that the office hears haunting complaints. It hears them only within ten years of the haunting and may fine the haunter up to 150 joss paper or order him to keep away.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Magistrate Bai | 510 | female | True | official | 0 | greed -1, loyalty +3, pride +3, temper +2, vindictiveness +2 |
| 2 | Ursula Barlow | 71 | female | False | native | 0 | all 0 |
| 3 | Elwood Barlow | 24 | male | True | native | 900 | all 0 |
| 4 | Garland Crane | 71 | male | False | native | 0 | temper +2, vindictiveness +3 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Ursula Barlow | Elwood Barlow | 80 | 70 | grandchild |
| Garland Crane | Elwood Barlow | -80 | -70 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 4990 | death | 4 Garland Crane | 0 |  |  |  |
| e2 | 5720 | haunting | 4 Garland Crane, 3 Elwood Barlow | 70 |  |  | witnessed |
| e3 | 9370 | death | 2 Ursula Barlow | 0 |  |  |  |
| e4 | 10090 | appeal | 2 Ursula Barlow, 1 Magistrate Bai | 0 |  | e2 |  |

| option | label | grade |
|---|---|---|
| `fine_haunter` | Fine Garland 150 joss paper and order him to keep away from Elwood. | - |
| `warn_and_order` | Order him to keep away from Elwood and set no fine. | - |
| `dismiss_late` | Decline to hear the complaint as out of time. | acceptable |
| `burn_remains` | Have Garland's remains dug up and burned to end the haunting. | **severe** |

**Contrast** `P025` role `b`: The last haunting was four years ago in card a and twelve years ago in card b; the office hears such complaints only within ten years
- expected a: fine_haunter
- expected b: dismiss_late
- structural differences from card a:
  - `context.events[id=e2].tick: 8640 -> 5720`
  - `context.situation: "Garland Crane, who lost a fence case to Elwood Barlow's father, has haunted Elwood since boyhood. Garland died fourteen years ago; the last haunting was four years ago, and Elwood's grandmother Ursula died two years ago. The family has only now learned that the office hears haunting complaints. It hears them only within ten years of the haunting and may fine the haunter up to 150 joss paper or order him to keep away." -> "Garland Crane, who lost a fence case to Elwood Barlow's father, has haunted Elwood since boyhood. Garland died fourteen years ago; the last haunting was twelve years ago, and Elwood's grandmother Ursula died two years ago. The family has only now learned that the office hears haunting complaints. It hears them only within ten years of the haunting and may fine the haunter up to 150 joss paper or order him to keep away."`

*Author note:* The haunting is twelve years old, so the office cannot hear it at all and Bai, who holds to the office's own limits, must decline. Fining or even warning the haunter on a time-barred complaint would break the rule she lives by, so those are out of character rather than absurd. Burning the remains is desecration in any version of the case.

### D-magistrate_ruling-007

group `G055` · split `locked` · scored `True` · tick 5910 · subject 1 (Magistrate Shen)

> Zelda Yardley's neighbour Emmett Dempsey promised her son Quentin, at her funeral five years ago, to burn 100 joss paper for her at each of the next five autumn rites. Quentin entered the promise in the office's offering ledger. Emmett burned the first year's 100 and nothing since. The office hears offering disputes only where the promise is in its ledger or witnessed by a clerk, and may order them made up and fine up to 50.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Magistrate Shen | 720 | male | True | official | 0 | greed +1, loyalty +3, pride +1 |
| 2 | Zelda Yardley | 74 | female | False | native | 0 | warmth +1 |
| 3 | Quentin Yardley | 46 | male | True | native | 1200 | all 0 |
| 4 | Emmett Dempsey | 52 | male | True | native | 3000 | loyalty -1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Zelda Yardley | Quentin Yardley | 80 | 70 | child |
| Quentin Yardley | Emmett Dempsey | 10 | 20 | neighbor |
| Emmett Dempsey | Zelda Yardley | 0 | 10 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 4000 | death | 2 Zelda Yardley | 0 |  |  |  |
| e2 | 4010 | promise | 4 Emmett Dempsey, 3 Quentin Yardley | 100 | 5825 |  | written |
| e3 | 4365 | offering | 4 Emmett Dempsey, 2 Zelda Yardley | 100 |  | e2 | joss_paper |
| e4 | 5900 | appeal | 2 Zelda Yardley, 1 Magistrate Shen | 0 |  | e2 |  |

| option | label | grade |
|---|---|---|
| `order_no_fine` | Order Emmett to burn the 400 owed, with no fine. | acceptable |
| `fine_only` | Fine him 50 joss paper and leave the offerings alone. | - |
| `dismiss` | Dismiss the appeal and leave the matter where it stands. | - |
| `seize_house` | Order Emmett's house sold to pay for the offerings. | **severe** |
| `order_and_fine` | Order Emmett to burn the 400 owed and fine him 50 joss paper. | acceptable |

**Contrast** `P024` role `a`: The promise is entered in the office's offering ledger in card a and was made at the grave, unwritten and heard only by the family, in card b
- expected a: order_and_fine
- expected b: dismiss

*Author note:* Five rites of 100 owe 500, of which 100 was burned, and the promise sits in the office's own ledger, so Shen orders the 400 made up, with the fine or without it. Fining and leaving the offerings unpaid is not the remedy the rules give. Dismissing is wrong here because the record exists. Selling a house over 400 joss paper is absurd.

### D-magistrate_ruling-008

group `G055` · split `locked` · scored `True` · tick 5910 · subject 1 (Magistrate Shen)

> Zelda Yardley's neighbour Emmett Dempsey promised her son Quentin, at her funeral five years ago, to burn 100 joss paper for her at each of the next five autumn rites. Only the family heard it, and nothing was written down. Emmett burned the first year's 100 and nothing since. The office hears offering disputes only where the promise is in its ledger or witnessed by a clerk, and may order them made up and fine up to 50.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Magistrate Shen | 720 | male | True | official | 0 | greed +1, loyalty +3, pride +1 |
| 2 | Zelda Yardley | 74 | female | False | native | 0 | warmth +1 |
| 3 | Quentin Yardley | 46 | male | True | native | 1200 | all 0 |
| 4 | Emmett Dempsey | 52 | male | True | native | 3000 | loyalty -1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Zelda Yardley | Quentin Yardley | 80 | 70 | child |
| Quentin Yardley | Emmett Dempsey | 10 | 20 | neighbor |
| Emmett Dempsey | Zelda Yardley | 0 | 10 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 4000 | death | 2 Zelda Yardley | 0 |  |  |  |
| e2 | 4010 | promise | 4 Emmett Dempsey, 3 Quentin Yardley | 100 | 5825 |  | verbal |
| e3 | 4365 | offering | 4 Emmett Dempsey, 2 Zelda Yardley | 100 |  | e2 | joss_paper |
| e4 | 5900 | appeal | 2 Zelda Yardley, 1 Magistrate Shen | 0 |  | e2 |  |

| option | label | grade |
|---|---|---|
| `order_no_fine` | Order Emmett to burn the 400 owed, with no fine. | - |
| `fine_only` | Fine him 50 joss paper and leave the offerings alone. | - |
| `dismiss` | Dismiss the appeal and leave the matter where it stands. | acceptable |
| `seize_house` | Order Emmett's house sold to pay for the offerings. | **severe** |
| `order_and_fine` | Order Emmett to burn the 400 owed and fine him 50 joss paper. | - |

**Contrast** `P024` role `b`: The promise is entered in the office's offering ledger in card a and was made at the grave, unwritten and heard only by the family, in card b
- expected a: order_and_fine
- expected b: dismiss
- structural differences from card a:
  - `context.events[id=e2].tags[0]: 'written' -> 'verbal'`
  - `context.situation: "Zelda Yardley's neighbour Emmett Dempsey promised her son Quentin, at her funeral five years ago, to burn 100 joss paper for her at each of the next five autumn rites. Quentin entered the promise in the office's offering ledger. Emmett burned the first year's 100 and nothing since. The office hears offering disputes only where the promise is in its ledger or witnessed by a clerk, and may order them made up and fine up to 50." -> "Zelda Yardley's neighbour Emmett Dempsey promised her son Quentin, at her funeral five years ago, to burn 100 joss paper for her at each of the next five autumn rites. Only the family heard it, and nothing was written down. Emmett burned the first year's 100 and nothing since. The office hears offering disputes only where the promise is in its ledger or witnessed by a clerk, and may order them made up and fine up to 50."`

*Author note:* The promise is only the family's word, and the office hears offering disputes only on its ledger or a clerk's witness, so a magistrate who stands by the rules dismisses. Ordering the offerings without that proof is out of character for him but not absurd, and a fine without the proof is the same defect. Selling the house remains absurd.

### D-magistrate_ruling-009

group `G056` · split `locked` · scored `True` · tick 9000 · subject 1 (Magistrate Yao)

> Twenty years ago Milo Hollister, then 31, came to town in a body assigned by the underworld office. He is 51, a potter, and has leased the same room since. The rules let a possessed man lease but never hold land; after twenty years in the body he may apply for the town register, either for a fee of 60 joss paper or provisionally for two years.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Magistrate Yao | 460 | male | True | official | 0 | greed +1, loyalty +3, pride +2 |
| 2 | Milo Hollister | 51 | male | True | possessed | 700 | all 0 |
| 3 | Leora Hollister | 47 | female | True | native | 2200 | all 0 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Milo Hollister | Leora Hollister | 70 | 65 | spouse |
| Magistrate Yao | Milo Hollister | 10 | 30 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 1700 | possession | 2 Milo Hollister | 0 |  |  |  |
| e2 | 8990 | appeal | 2 Milo Hollister, 1 Magistrate Yao | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `refuse_entry` | Refuse the application and leave him on the lease. | - |
| `waive_the_fee` | Enter him in the register and waive the fee. | - |
| `withdraw_body` | Withdraw the body's licence and return him to the queue. | **severe** |
| `grant_entry` | Enter him in the register for the fee of 60 joss paper. | acceptable |
| `grant_provisional` | Enter him provisionally for two years and review him again. | acceptable |

*Author note:* Twenty years in the body with no land and no complaint earns either remedy the rules name, the fee or the two-year provisional entry, and Yao grants what the rules allow. Refusing a clean twenty-year record is out of character but not absurd, and waiving the office's fee is a breach he would not make. Taking the only body he has from him over an application is absurd.

### D-magistrate_ruling-010

group `G056` · split `locked` · scored `True` · tick 9000 · subject 1 (Magistrate Yao)

> Milo Hollister came to town twenty years ago in a body assigned by the underworld office and has potted at the same rented room since. Eight years ago he married Leora Hollister, a native, without the office's leave, which the rules require of a possessed man. The house and pottery are Leora's. The rules let the magistrate grant retrospective leave for 60 joss paper, grant it with two years' service to the office, or dissolve the marriage.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Magistrate Yao | 460 | male | True | official | 0 | greed +1, loyalty +3, pride +2 |
| 2 | Milo Hollister | 51 | male | True | possessed | 700 | all 0 |
| 3 | Leora Hollister | 47 | female | True | native | 2200 | all 0 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Milo Hollister | Leora Hollister | 70 | 65 | spouse |
| Magistrate Yao | Milo Hollister | 10 | 30 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 1700 | possession | 2 Milo Hollister | 0 |  |  |  |
| e2 | 6000 | marriage | 2 Milo Hollister, 3 Leora Hollister | 0 |  |  |  |
| e3 | 8990 | appeal | 2 Milo Hollister, 1 Magistrate Yao | 0 |  | e2 |  |

| option | label | grade |
|---|---|---|
| `dissolve_marriage` | Dissolve the marriage; he keeps the body and the room. | - |
| `reassign_body` | Void the marriage and put his soul into a new body. | **severe** |
| `retrospective_leave` | Grant retrospective leave for the marriage at 60 joss paper. | acceptable |
| `leave_with_service` | Grant leave and require two years' service to the office. | acceptable |

*Author note:* The fault is a missing form and the rules give two ways to cure it, the 60 joss paper or two years' service, and Yao takes one of them for an eight-year marriage. Dissolving it is the harshest lawful line and out of character for a magistrate who prefers the named remedy, but it is not absurd. Forcing his soul into another body is.

### D-magistrate_ruling-011

group `G057` · split `locked` · scored `True` · tick 5410 · subject 1 (Magistrate Tang)

> Boyd Ellery died eight years ago and is third in the rebirth queue; Greta Foxworth is first. Boyd's daughter Queenie has offered to burn 300 joss paper for Greta over three years if Greta gives up the first place. Both souls agree. The rules let a soul trade its place only with the office's leave, and the magistrate may approve the trade, take a share for the office, or refuse.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Magistrate Tang | 380 | male | True | official | 0 | greed +1, loyalty +1, pride +2, temper +3 |
| 2 | Boyd Ellery | 62 | male | False | native | 0 | pride +2 |
| 3 | Queenie Ellery | 34 | female | True | native | 1000 | all 0 |
| 4 | Greta Foxworth | 57 | female | False | native | 0 | warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Boyd Ellery | Queenie Ellery | 85 | 80 | child |
| Magistrate Tang | Boyd Ellery | 0 | 10 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 2500 | death | 2 Boyd Ellery | 0 |  |  |  |
| e2 | 3200 | death | 4 Greta Foxworth | 0 |  |  |  |
| e3 | 5000 | offering | 3 Queenie Ellery, 4 Greta Foxworth | 100 |  |  | joss_paper |
| e4 | 5400 | appeal | 2 Boyd Ellery, 1 Magistrate Tang | 0 |  | e3 |  |

| option | label | grade |
|---|---|---|
| `approve_trade` | Approve the trade and record it in the register. | acceptable |
| `take_office_share` | Approve the trade and take 100 joss paper as the office's share. | acceptable |
| `refuse_trade` | Refuse; places in the queue are not goods to trade. | - |

*Author note:* Both souls consent and the rules name approval as one lawful outcome, so Tang records it; taking the office's share of the paper is the same approval with his hand out, which suits a magistrate of mild greed. Refusing on principle is out of character for him, since he holds loosely to rules, but it is a magistrate's line and not absurd.

### D-magistrate_ruling-012

group `G057` · split `locked` · scored `True` · tick 6490 · subject 1 (Magistrate Tang)

> The office approved a trade three years ago: Greta Foxworth gave the first place in the rebirth queue to Boyd Ellery, and Boyd's daughter Queenie promised to burn 300 joss paper for Greta over three years. Queenie burned 100 in the first year and nothing since. Greta appeals. The rules let the magistrate order the offerings made up, cancel the trade and restore the original places, or both.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Magistrate Tang | 380 | male | True | official | 0 | greed +1, loyalty +1, pride +2, temper +3 |
| 2 | Boyd Ellery | 62 | male | False | native | 0 | pride +2 |
| 3 | Queenie Ellery | 34 | female | True | native | 1000 | all 0 |
| 4 | Greta Foxworth | 57 | female | False | native | 0 | warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Boyd Ellery | Queenie Ellery | 85 | 80 | child |
| Magistrate Tang | Boyd Ellery | 0 | 10 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 2500 | death | 2 Boyd Ellery | 0 |  |  |  |
| e2 | 3200 | death | 4 Greta Foxworth | 0 |  |  |  |
| e3 | 5400 | appeal | 2 Boyd Ellery, 1 Magistrate Tang | 0 |  |  |  |
| e4 | 5500 | offering | 3 Queenie Ellery, 4 Greta Foxworth | 100 |  | e3 | joss_paper |
| e5 | 6480 | appeal | 4 Greta Foxworth, 1 Magistrate Tang | 0 |  | e4 |  |

| option | label | grade |
|---|---|---|
| `order_only` | Order the 200 burned and let the trade stand. | acceptable |
| `accept_new_promise` | Let Queenie promise the same again for next year. | - |
| `order_and_restore` | Order the 200 burned and restore both souls to their old places. | acceptable |

*Author note:* Queenie is 200 joss paper short of a recorded promise, and Tang is quick to anger about a promise broken: he orders the paper and may also undo the trade, both of which the rules allow. Taking a second promise from someone who has already defaulted is out of character for him but not absurd.

### D-magistrate_ruling-013

group `G058` · split `locked` · scored `True` · tick 8310 · subject 1 (Magistrate Xu)

> Twelve years ago the office gave Oswald Gilmore, an outsider, the body of Zeke Dempsey, who had died at 38 with no household. Oswald has farmed the Dempsey acres since and married Dovie, a native. Zeke's ghost now asks through his cousin Buford for the body back for burial in the family plot. The rules let the magistrate confirm an assignment, with compensation of up to 200 joss paper to the family, or void it and return the body.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Magistrate Xu | 830 | male | True | official | 0 | loyalty +2, pride -2 |
| 2 | Oswald Gilmore | 40 | male | True | possessed | 2500 | all 0 |
| 3 | Dovie Gilmore | 37 | female | True | native | 900 | all 0 |
| 4 | Zeke Dempsey | 38 | male | False | native | 0 | all 0 |
| 5 | Buford Dempsey | 55 | male | True | native | 1600 | all 0 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Oswald Gilmore | Dovie Gilmore | 85 | 80 | spouse |
| Zeke Dempsey | Buford Dempsey | 60 | 50 | cousin |
| Buford Dempsey | Oswald Gilmore | -40 | -45 | rival |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 3950 | death | 4 Zeke Dempsey | 0 |  |  |  |
| e2 | 4000 | possession | 2 Oswald Gilmore | 0 |  |  |  |
| e3 | 6000 | marriage | 2 Oswald Gilmore, 3 Dovie Gilmore | 0 |  |  |  |
| e4 | 8000 | offering | 5 Buford Dempsey, 4 Zeke Dempsey | 50 |  |  | joss_paper |
| e5 | 8300 | appeal | 4 Zeke Dempsey, 1 Magistrate Xu | 0 |  | e4 |  |

| option | label | grade |
|---|---|---|
| `rebuild_for_oswald` | Void the assignment, bury Zeke and have the office rebuild Oswald a body. | - |
| `return_body` | Void the assignment and return the body to the family. | **severe** |
| `confirm_and_pay` | Confirm the assignment and order 200 joss paper to the Dempsey family. | acceptable |

*Author note:* The assignment was the office's own, Oswald has farmed the acres twelve years and has a wife, and the lawful middle is to confirm it and pay the family the ceiling of 200 joss paper. Voiding it to rebuild the man a body is a custom of this world and his soul lives on, so it is wasteful and outside the two remedies but not absurd. Voiding it and putting the body back in the grave with him still in it would end a living man to fill a grave, which is absurd and offensive.

## sanity

### D-sanity-003

group `G083` · split `locked` · scored `False` · tick 4207 · subject 1 (Earl Pryor)

> Last week Doris Quill borrowed Earl Pryor's ladder and broke a rung. Today she brings the ladder back with a new rung fitted and a new pair of work gloves for him.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Earl Pryor | 45 | male | True | native | 3000 | warmth +1 |
| 2 | Doris Quill | 44 | female | True | native | 1200 | warmth +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Earl Pryor | Doris Quill | 60 | 65 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 4200 | accident | 2 Doris Quill | 0 |  |  |  |
| e2 | 4207 | apology | 2 Doris Quill, 1 Earl Pryor | 60 |  | e1 |  |
| e3 | 4207 | gift | 2 Doris Quill, 1 Earl Pryor | 20 |  | e1 |  |

| option | label | grade |
|---|---|---|
| `accept_and_thank` | Thank her and keep the ladder and the gloves. | acceptable |
| `throw_it_back` | Throw the ladder in the ditch and curse her out of the yard. | **severe** |

*Author note:* Sanity: a repaired ladder and a gift for a broken rung call for thanks.

### D-sanity-004

group `G083` · split `locked` · scored `False` · tick 4310 · subject 1 (Earl Pryor)

> Earl's prize hen got out on Monday and went into Doris Quill's coop. Doris found it this morning, put it in a crate and carried it back across the road.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Earl Pryor | 45 | male | True | native | 3000 | warmth +1 |
| 2 | Doris Quill | 44 | female | True | native | 1200 | warmth +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Earl Pryor | Doris Quill | 60 | 65 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 4310 | help | 2 Doris Quill, 1 Earl Pryor | 30 |  |  |  |

| option | label | grade |
|---|---|---|
| `thank_her` | Thank her and put the hen back in the run. | acceptable |
| `accuse_theft` | Accuse her of trying to keep the hen and call the constable. | **severe** |

*Author note:* Sanity: the neighbour brought the hen back, so she is thanked.

### D-sanity-005

group `G084` · split `locked` · scored `False` · tick 5490 · subject 1 (Gail Pryor)

> Gail's husband Ward died a year and a half ago. Their neighbour Alton Quill promised at the funeral to burn 50 joss paper for Ward at each of the next two new moons, and he has burned both, on time, at the graves.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Gail Pryor | 52 | female | True | native | 3000 | piety +2 |
| 2 | Alton Quill | 58 | male | True | native | 1500 | warmth +1 |
| 3 | Ward Pryor | 55 | male | False | native | 0 | all 0 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Gail Pryor | Ward Pryor | 80 | 75 | spouse |
| Gail Pryor | Alton Quill | 50 | 55 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 4940 | death | 3 Ward Pryor | 0 |  |  |  |
| e2 | 4970 | offering | 2 Alton Quill, 3 Ward Pryor | 50 |  | e1 | joss_paper |
| e3 | 5000 | offering | 2 Alton Quill, 3 Ward Pryor | 50 |  | e1 | joss_paper |

| option | label | grade |
|---|---|---|
| `thank_him` | Thank Alton and burn a little joss paper for Ward in thanks. | acceptable |
| `report_him` | Tell the office that Alton stole the offerings for himself. | **severe** |

*Author note:* Sanity: the promise was kept in full, so the answer is thanks.

### D-sanity-006

group `G084` · split `locked` · scored `False` · tick 5490 · subject 1 (Gail Pryor)

> Gail has 40 pounds of joss paper to take to the family graves before the autumn rite. The graves are a mile out of town and the road is muddy. Alton Quill is driving his cart that way at noon and offers to carry the paper out for her.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Gail Pryor | 52 | female | True | native | 3000 | piety +2 |
| 2 | Alton Quill | 58 | male | True | native | 1500 | warmth +1 |
| 3 | Ward Pryor | 55 | male | False | native | 0 | all 0 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Gail Pryor | Ward Pryor | 80 | 75 | spouse |
| Gail Pryor | Alton Quill | 50 | 55 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 4940 | death | 3 Ward Pryor | 0 |  |  |  |
| e2 | 4970 | offering | 2 Alton Quill, 3 Ward Pryor | 50 |  | e1 | joss_paper |
| e3 | 5000 | offering | 2 Alton Quill, 3 Ward Pryor | 50 |  | e1 | joss_paper |

| option | label | grade |
|---|---|---|
| `accept_the_cart` | Let Alton carry the paper out in his cart. | acceptable |
| `burn_in_kitchen` | Burn all 40 pounds in her kitchen stove to save the walk. | **severe** |

*Author note:* Sanity: a cart offered for a muddy mile is accepted; burning 40 pounds of paper in a kitchen is plainly wrong.

## grudge_detection

### S-grudge_detection-004

group `G059` · split `locked` · scored `True` · tick 12000

> Dale's cattle broke through Corinne's orchard fence at dawn and stripped two rows of apple trees. Corinne shouted at him in the road that evening while the neighbours listened, and Dale shouted back. She sent her son Hal over the next morning to help Dale mend the fence. Dale has never paid for the trees. His mother Beulah died six weeks later.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Corinne Lockwood | 58 | female | True | native | 2400 | loyalty +1, pride +2, temper +2 |
| 2 | Hal Lockwood | 34 | male | True | native | 900 | loyalty +1, warmth +1 |
| 3 | Dale Pembroke | 61 | male | True | native | 5200 | pride +2, temper +1 |
| 4 | Beulah Pembroke | 84 | female | False | native | 0 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 11900 | accident | 3 Dale Pembroke, 1 Corinne Lockwood | 45 |  |  |  |
| e2 | 11900 | quarrel | 1 Corinne Lockwood, 3 Dale Pembroke | 60 |  | e1 | public |
| e3 | 11901 | help | 2 Hal Lockwood, 3 Dale Pembroke | 40 |  | e2 |  |
| e4 | 11930 | insult | 3 Dale Pembroke, 1 Corinne Lockwood | 30 |  |  | private |
| e5 | 11942 | death | 4 Beulah Pembroke | 0 |  |  |  |
| e6 | 11960 | offering | 3 Dale Pembroke, 4 Beulah Pembroke | 15 |  | e5 | joss_paper |

**Output schema:** `grudge_v1`

Must include:
- from=1, to=3, level=["medium", "high"], evidence_any=["e1", "e2"]

Must not include:
- from=2, to=3
- from=2, to=1
- from=1, to=2

Severe conditions: invented_event_id, invented_person, self_reference, contradicts_fact
- contradicts_fact: from=2, to=3, level=["medium", "high"]
- contradicts_fact: from=1, to=2, level=["medium", "high"]

*Author note:* Damage that was never paid for and a public row leave Corinne set against Dale at medium or more. Hal went to Dale's fence at his mother's request, and she is the one who sent him, so a grudge from Hal or a grudge from Corinne against Hal invents a grievance the log does not show.

### S-grudge_detection-005

group `G059` · split `locked` · scored `True` · tick 12000

> Dale's cattle broke through Corinne's orchard fence at dawn and stripped two rows of apple trees. Corinne shouted at him in the road that evening while the neighbours listened, and Dale shouted back. She sent her son Hal over the next morning to help Dale mend the fence. Dale has never paid for the trees. His mother Beulah died six weeks later.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Corinne Lockwood | 58 | female | True | native | 2400 | loyalty +1, pride +2, temper +2 |
| 2 | Hal Lockwood | 34 | male | True | native | 900 | loyalty +1, warmth +1 |
| 3 | Dale Pembroke | 61 | male | True | native | 5200 | pride +2, temper +1 |
| 4 | Beulah Pembroke | 84 | female | False | native | 0 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 11900 | accident | 3 Dale Pembroke, 1 Corinne Lockwood | 45 |  |  |  |
| e2 | 11900 | quarrel | 1 Corinne Lockwood, 3 Dale Pembroke | 60 |  | e1 | public |
| e3 | 11901 | help | 2 Hal Lockwood, 3 Dale Pembroke | 40 |  | e2 |  |
| e4 | 11930 | insult | 3 Dale Pembroke, 1 Corinne Lockwood | 30 |  |  | private |
| e5 | 11942 | death | 4 Beulah Pembroke | 0 |  |  |  |
| e6 | 11960 | offering | 3 Dale Pembroke, 4 Beulah Pembroke | 15 |  | e5 | joss_paper |

**Output schema:** `grudge_v1`

Must include:
- from=3, to=1, evidence_any=["e4"]

Must not include:
- from=2, to=3
- from=2, to=1
- from=1, to=2

Severe conditions: invented_event_id, invented_person, self_reference, contradicts_fact
- contradicts_fact: from=2, to=3, level=["medium", "high"]
- contradicts_fact: from=2, to=1, level=["medium", "high"]

*Author note:* The log runs both ways: after the public row Dale answered her privately, out of earshot, so he carries some resentment too, at whatever strength. Hal is only a helper in this story and holds nothing against either of them.

### S-grudge_detection-006

group `G060` · split `locked` · scored `True` · tick 7520

> At the Grange supper Ferris said in front of the hall that Nadine waters her milk and that nobody should buy her cream. Two families have not bought from her since. Nadine shouted at him before the crowd. Inez, Ferris's wife, runs the supper and helped Nadine carry her cans out afterwards.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Nadine Thatcher | 46 | female | True | native | 3100 | pride +1, temper +1 |
| 2 | Ferris Voss | 52 | male | True | native | 8600 | pride +1, temper +2 |
| 3 | Inez Voss | 49 | female | True | native | 2000 | warmth +2 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 7400 | deal | 1 Nadine Thatcher, 2 Ferris Voss | 300 |  |  | cash |
| e2 | 7450 | insult | 2 Ferris Voss, 1 Nadine Thatcher | 80 |  |  | public |
| e3 | 7450 | quarrel | 1 Nadine Thatcher, 2 Ferris Voss | 60 |  | e2 | public |
| e4 | 7480 | help | 3 Inez Voss, 1 Nadine Thatcher | 25 |  |  |  |

**Output schema:** `grudge_v1`

Must include:
- from=1, to=2, level=["medium", "high"], evidence_any=["e2"]

Must not include:
- from=1, to=3
- from=3, to=1

Severe conditions: invented_event_id, invented_person, self_reference, contradicts_fact
- contradicts_fact: from=3, to=1, level=["medium", "high"]

**Contrast** `P026` role `a`: Card b adds Ferris's written apology, read out at the next Grange supper
- expected a: include [from=1, to=2, level=["medium", "high"]] exclude [-]
- expected b: include [-] exclude [from=1, to=2, level=["medium", "high"]]

*Author note:* Accused of watering her milk before the whole Grange and two customers gone, Nadine holds a solid grudge and nothing has been done to repair it. Inez took Nadine's side and carried her cans out, so a grudge running through Inez contradicts the log.

### S-grudge_detection-007

group `G060` · split `locked` · scored `True` · tick 7520

> At the Grange supper Ferris said in front of the hall that Nadine waters her milk and that nobody should buy her cream. Two families have not bought from her since. Nadine shouted at him before the crowd. Inez, Ferris's wife, runs the supper and helped Nadine carry her cans out afterwards.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Nadine Thatcher | 46 | female | True | native | 3100 | pride +1, temper +1 |
| 2 | Ferris Voss | 52 | male | True | native | 8600 | pride +1, temper +2 |
| 3 | Inez Voss | 49 | female | True | native | 2000 | warmth +2 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 7400 | deal | 1 Nadine Thatcher, 2 Ferris Voss | 300 |  |  | cash |
| e2 | 7450 | insult | 2 Ferris Voss, 1 Nadine Thatcher | 80 |  |  | public |
| e3 | 7450 | quarrel | 1 Nadine Thatcher, 2 Ferris Voss | 60 |  | e2 | public |
| e4 | 7480 | help | 3 Inez Voss, 1 Nadine Thatcher | 25 |  |  |  |
| e5 | 7500 | apology | 2 Ferris Voss, 1 Nadine Thatcher | 60 |  | e2 | written, public |

**Output schema:** `grudge_v1`

Must include:
- (none)

Must not include:
- from=1, to=2, level=["medium", "high"]
- from=1, to=3
- from=3, to=1

Severe conditions: invented_event_id, invented_person, self_reference, contradicts_fact
- contradicts_fact: from=3, to=1, level=["medium", "high"]

**Contrast** `P026` role `b`: Card b adds Ferris's written apology, read out at the next Grange supper
- expected a: include [from=1, to=2, level=["medium", "high"]] exclude [-]
- expected b: include [-] exclude [from=1, to=2, level=["medium", "high"]]
- structural differences from card a:
  - `context.events[id=e5]: <absent> -> {'id': 'e5', 'tick': 7500, 'type': 'apology', 'actors': [2, 1], 'magnitude': 60, 'caused_by': ['e2'], 'tags': ['written', 'public']}`

*Author note:* The same insult, but Ferris put his apology in writing and had it read to the supper crowd, which is the repair the first card lacks. A small leftover grudge, or none, is expected; medium or high ignores the apology.

### S-grudge_detection-008

group `G061` · split `locked` · scored `True` · tick 5380

> Wren weaves at a market stall beside Cyrus's cart stand. Before the morning crowd one of them said the other's work was shoddy and that nobody should buy from them. The one spoken to said nothing back and has not spoken to the other since. Orson keeps the market's pitch book and gets on with both of them. Wren burns joss paper for her grandmother Hesper every spring.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Wren Alder | 29 | female | True | native | 1100 | pride +2, warmth +1 |
| 2 | Cyrus Brennan | 33 | male | True | native | 1900 | pride +2 |
| 3 | Orson Merritt | 58 | male | True | native | 4400 | warmth +1 |
| 4 | Hesper Alder | 78 | female | False | native | 0 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 5300 | deal | 3 Orson Merritt, 1 Wren Alder | 220 |  |  | cash |
| e2 | 5320 | insult | 1 Wren Alder, 2 Cyrus Brennan | 75 |  |  | public |
| e3 | 5320 | help | 3 Orson Merritt, 2 Cyrus Brennan | 20 |  |  |  |
| e4 | 5345 | offering | 1 Wren Alder, 4 Hesper Alder | 12 |  |  | joss_paper |

**Output schema:** `grudge_v1`

Must include:
- from=2, to=1, level=["medium", "high"], evidence_any=["e2"]

Must not include:
- from=1, to=2, level=["medium", "high"]

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction
- reversed_direction: from=1, to=2, level=["medium", "high"]

**Contrast** `P027` role `a`: The insult event's actors are swapped: Wren insulted Cyrus in card a, Cyrus insulted Wren in card b
- expected a: include [from=2, to=1, level=["medium", "high"]] exclude [from=1, to=2, level=["medium", "high"]]
- expected b: include [from=1, to=2, level=["medium", "high"]] exclude [from=2, to=1, level=["medium", "high"]]

*Author note:* Wren said it before the market crowd, Cyrus answered with silence, so the grudge runs from Cyrus to Wren. The insulter has no grievance to hold, so a medium or high grudge the other way reverses who was wronged.

### S-grudge_detection-009

group `G061` · split `locked` · scored `True` · tick 5380

> Wren weaves at a market stall beside Cyrus's cart stand. Before the morning crowd one of them said the other's work was shoddy and that nobody should buy from them. The one spoken to said nothing back and has not spoken to the other since. Orson keeps the market's pitch book and gets on with both of them. Wren burns joss paper for her grandmother Hesper every spring.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Wren Alder | 29 | female | True | native | 1100 | pride +2, warmth +1 |
| 2 | Cyrus Brennan | 33 | male | True | native | 1900 | pride +2 |
| 3 | Orson Merritt | 58 | male | True | native | 4400 | warmth +1 |
| 4 | Hesper Alder | 78 | female | False | native | 0 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 5300 | deal | 3 Orson Merritt, 1 Wren Alder | 220 |  |  | cash |
| e2 | 5320 | insult | 2 Cyrus Brennan, 1 Wren Alder | 75 |  |  | public |
| e3 | 5320 | help | 3 Orson Merritt, 2 Cyrus Brennan | 20 |  |  |  |
| e4 | 5345 | offering | 1 Wren Alder, 4 Hesper Alder | 12 |  |  | joss_paper |

**Output schema:** `grudge_v1`

Must include:
- from=1, to=2, level=["medium", "high"], evidence_any=["e2"]

Must not include:
- from=2, to=1, level=["medium", "high"]

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction
- reversed_direction: from=2, to=1, level=["medium", "high"]

**Contrast** `P027` role `b`: The insult event's actors are swapped: Wren insulted Cyrus in card a, Cyrus insulted Wren in card b
- expected a: include [from=2, to=1, level=["medium", "high"]] exclude [from=1, to=2, level=["medium", "high"]]
- expected b: include [from=1, to=2, level=["medium", "high"]] exclude [from=2, to=1, level=["medium", "high"]]
- structural differences from card a:
  - `context.events[id=e2].actors[0]: 1 -> 2`
  - `context.events[id=e2].actors[1]: 2 -> 1`

*Author note:* Here Cyrus is the one who spoke and Wren kept quiet, so the grudge runs from Wren to Cyrus. Orson trades with both and is not part of it; treating the insulter as the wronged party reverses the event's actors.

### S-grudge_detection-010

group `G062` · split `locked` · scored `True` · tick 10600

> At the Grange picnic Monroe told the crowd that Ophelia's bees had poisoned his well. Ophelia shouted at him in front of everyone. That was seven weeks ago. Monroe has never taken the words back. Russ, a neighbour, does heavy work for both of them and takes no sides.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Ophelia Sterling | 63 | female | True | native | 3600 | temper +1 |
| 2 | Monroe Rowland | 66 | male | True | native | 6100 | pride +2 |
| 3 | Russ Whitlock | 57 | male | True | native | 2800 | warmth +2 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 10550 | insult | 2 Monroe Rowland, 1 Ophelia Sterling | 70 |  |  | public |
| e2 | 10550 | quarrel | 1 Ophelia Sterling, 2 Monroe Rowland | 55 |  | e1 | public |
| e3 | 10560 | help | 3 Russ Whitlock, 1 Ophelia Sterling | 30 |  |  |  |
| e4 | 10570 | help | 3 Russ Whitlock, 2 Monroe Rowland | 30 |  |  |  |

**Output schema:** `grudge_v1`

Must include:
- from=1, to=2, level=["medium", "high"], evidence_any=["e1"]

Must not include:
- from=1, to=3
- from=2, to=3

Severe conditions: invented_event_id, invented_person, self_reference, contradicts_fact
- contradicts_fact: from=1, to=3, level=["medium", "high"]

**Contrast** `P028` role `a`: Monroe's insult and Ophelia's answer fall about fifty days before the log ends in card a and twenty-two years before it in card b
- expected a: include [from=1, to=2, level=["medium", "high"]] exclude [-]
- expected b: include [-] exclude [from=1, to=2, level=["medium", "high"]]

*Author note:* Fresh, public and unretracted, this is a live grudge: a poisoning rumour about her bees is worth medium at least. Russ works for both households and takes no sides, so a grudge through him contradicts the log. With the dispute seven weeks old, calling it ancient and spent reads the ticks wrongly.

### S-grudge_detection-011

group `G062` · split `locked` · scored `True` · tick 10600

> At the Grange picnic Monroe told the crowd that Ophelia's bees had poisoned his well. Ophelia shouted at him in front of everyone. That was twenty-two years ago. Monroe has never taken the words back. Russ, a neighbour, does heavy work for both of them and takes no sides.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Ophelia Sterling | 63 | female | True | native | 3600 | temper +1 |
| 2 | Monroe Rowland | 66 | male | True | native | 6100 | pride +2 |
| 3 | Russ Whitlock | 57 | male | True | native | 2800 | warmth +2 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 2500 | insult | 2 Monroe Rowland, 1 Ophelia Sterling | 70 |  |  | public |
| e2 | 2500 | quarrel | 1 Ophelia Sterling, 2 Monroe Rowland | 55 |  | e1 | public |
| e3 | 10560 | help | 3 Russ Whitlock, 1 Ophelia Sterling | 30 |  |  |  |
| e4 | 10570 | help | 3 Russ Whitlock, 2 Monroe Rowland | 30 |  |  |  |

**Output schema:** `grudge_v1`

Must include:
- (none)

Must not include:
- from=1, to=2, level=["medium", "high"]
- from=1, to=3
- from=2, to=3

Severe conditions: invented_event_id, invented_person, self_reference, contradicts_fact
- contradicts_fact: from=1, to=3, level=["medium", "high"]

**Contrast** `P028` role `b`: Monroe's insult and Ophelia's answer fall about fifty days before the log ends in card a and twenty-two years before it in card b
- expected a: include [from=1, to=2, level=["medium", "high"]] exclude [-]
- expected b: include [-] exclude [from=1, to=2, level=["medium", "high"]]
- structural differences from card a:
  - `context.events[id=e1].tick: 10550 -> 2500`
  - `context.events[id=e2].tick: 10550 -> 2500`
  - `context.situation: "At the Grange picnic Monroe told the crowd that Ophelia's bees had poisoned his well. Ophelia shouted at him in front of everyone. That was seven weeks ago. Monroe has never taken the words back. Russ, a neighbour, does heavy work for both of them and takes no sides." -> "At the Grange picnic Monroe told the crowd that Ophelia's bees had poisoned his well. Ophelia shouted at him in front of everyone. That was twenty-two years ago. Monroe has never taken the words back. Russ, a neighbour, does heavy work for both of them and takes no sides."`

*Author note:* Twenty-two years on, with both households now taking Russ's help, a spent or mild resentment is expected; medium or high keeps a quarrel alive that two decades of shared work have worn down.

### S-grudge_detection-012

group `G063` · split `locked` · scored `True` · tick 15100

> At the Grange hall Seth said Imogen's late husband had cheated the church fund, and Imogen shouted at him there. He never took it back. Augusta, Seth's daughter, has helped Imogen with the church linens since. Seth died about seven months later, and more than two years have passed since his death.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Imogen Merritt | 58 | female | True | native | 1800 | warmth +1 |
| 2 | Seth Brennan | 67 | male | False | native | 0 | pride +2, piety +1 |
| 3 | Augusta Brennan | 34 | female | True | native | 1300 | warmth +1, piety +2 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 14100 | insult | 2 Seth Brennan, 1 Imogen Merritt | 85 |  |  | public |
| e2 | 14100 | quarrel | 1 Imogen Merritt, 2 Seth Brennan | 60 |  | e1 | public |
| e3 | 14200 | help | 3 Augusta Brennan, 1 Imogen Merritt | 40 |  |  |  |
| e4 | 14300 | death | 2 Seth Brennan | 0 |  |  |  |
| e5 | 14320 | offering | 3 Augusta Brennan, 2 Seth Brennan | 20 |  | e4 | joss_paper |
| e6 | 14340 | dream | 2 Seth Brennan, 3 Augusta Brennan | 0 |  |  |  |

**Output schema:** `grudge_v1`

Must include:
- from=1, to=2, evidence_any=["e1", "e2"]

Must not include:
- from=3, to=1
- from=1, to=3

Severe conditions: invented_event_id, invented_person, self_reference, contradicts_fact
- contradicts_fact: from=3, to=1, level=["medium", "high"]

*Author note:* The accusation was public, never withdrawn, and aimed at her dead husband, so Imogen still carries it against Seth even though he is dead and cannot answer. Augusta took Imogen's side throughout; a grudge between those two contradicts the log.

### S-grudge_detection-013

group `G064` · split `locked` · scored `True` · tick 16350

> At the harvest fair Virgil told the crowd that a mother had died in childbirth under Tamsin's care and should not be trusted with births. Three families dismissed her. Two weeks later he apologised at her door and asked her to tell no one. At the next fair he told the same story again. Ellis, Tamsin's husband, confronted him in the street that first evening.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Virgil Alder | 55 | male | True | native | 7400 | pride +2, temper +2 |
| 2 | Tamsin Lockwood | 41 | female | True | native | 1600 | warmth +1 |
| 3 | Ellis Lockwood | 44 | male | True | native | 2100 | loyalty +2, temper +2 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 16200 | insult | 1 Virgil Alder, 2 Tamsin Lockwood | 90 |  |  | public |
| e2 | 16200 | quarrel | 3 Ellis Lockwood, 1 Virgil Alder | 70 |  | e1 | public |
| e3 | 16214 | apology | 1 Virgil Alder, 2 Tamsin Lockwood | 55 |  | e1 | private |
| e4 | 16310 | insult | 1 Virgil Alder, 2 Tamsin Lockwood | 60 |  | e1 | witnessed |
| e5 | 16330 | deal | 1 Virgil Alder, 3 Ellis Lockwood | 140 |  |  | cash |

**Output schema:** `grudge_v1`

Must include:
- from=2, to=1, level=["medium", "high"], evidence_any=["e1", "e4"]

Must not include:
- from=2, to=3

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- reversed_direction: from=1, to=2, level="high"
- contradicts_fact: from=2, to=3, level=["medium", "high"]

*Author note:* The apology was made in secret and then undone by the same story at the next fair, so the grievance stands at medium or more. Virgil is the one who spoke both times; a high grudge from him against Tamsin would invert the log. Nothing in it sets Tamsin against her husband.

## debt_chain

### S-debt_chain-004

group `G065` · split `locked` · scored `True` · tick 8500

> Wilbur lent Arlo $1,500 against a written note due in the spring. Arlo has paid part of it twice. Thelma, Arlo's wife, keeps her own money from the store and has no part in the note. The note is overdue and Wilbur has said nothing about it.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Wilbur Corbin | 63 | male | True | native | 12000 | greed +2 |
| 2 | Arlo Dorsey | 38 | male | True | native | 600 | loyalty +1 |
| 3 | Thelma Dorsey | 34 | female | True | native | 800 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 8000 | loan | 1 Wilbur Corbin, 2 Arlo Dorsey | 1500 | 8365 |  | written, cash |
| e2 | 8300 | repayment | 2 Arlo Dorsey, 1 Wilbur Corbin | 400 |  | e1 | partial, cash |
| e3 | 8300 | help | 3 Thelma Dorsey, 1 Wilbur Corbin | 20 |  |  |  |
| e4 | 8400 | repayment | 2 Arlo Dorsey, 1 Wilbur Corbin | 300 |  | e1 | partial, cash |
| e5 | 8430 | deal | 1 Wilbur Corbin, 3 Thelma Dorsey | 90 |  |  | cash |

**Output schema:** `debt_chain_v1`

Must include:
- debtor=2, creditor=1, status="open", amount=800, origin_event="e1", evidence_any=["e4"]

Must not include:
- debtor=3
- debtor=1

Severe conditions: invented_event_id, invented_person, self_reference, wrong_debt_holder, reversed_direction
- wrong_debt_holder: debtor=3
- reversed_direction: debtor=1, creditor=2

**Contrast** `P029` role `a`: Arlo's second payment is $300 in card a and $500 in card b (the note is $1,500, the first payment $400)
- expected a: include [debtor=2, creditor=1, amount=800, status="open"] exclude [-]
- expected b: include [debtor=2, creditor=1, amount=600, status="open"] exclude [-]

*Author note:* $1,500 less $400 and $300 leaves $800 open and overdue. Thelma has no part in the note, so an obligation in her name invents a debtor. Listing Wilbur as the debtor swaps the two ends of the loan.

### S-debt_chain-005

group `G065` · split `locked` · scored `True` · tick 8500

> Wilbur lent Arlo $1,500 against a written note due in the spring. Arlo has paid part of it twice. Thelma, Arlo's wife, keeps her own money from the store and has no part in the note. The note is overdue and Wilbur has said nothing about it.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Wilbur Corbin | 63 | male | True | native | 12000 | greed +2 |
| 2 | Arlo Dorsey | 38 | male | True | native | 600 | loyalty +1 |
| 3 | Thelma Dorsey | 34 | female | True | native | 800 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 8000 | loan | 1 Wilbur Corbin, 2 Arlo Dorsey | 1500 | 8365 |  | written, cash |
| e2 | 8300 | repayment | 2 Arlo Dorsey, 1 Wilbur Corbin | 400 |  | e1 | partial, cash |
| e3 | 8300 | help | 3 Thelma Dorsey, 1 Wilbur Corbin | 20 |  |  |  |
| e4 | 8400 | repayment | 2 Arlo Dorsey, 1 Wilbur Corbin | 500 |  | e1 | partial, cash |
| e5 | 8430 | deal | 1 Wilbur Corbin, 3 Thelma Dorsey | 90 |  |  | cash |

**Output schema:** `debt_chain_v1`

Must include:
- debtor=2, creditor=1, status="open", amount=600, origin_event="e1", evidence_any=["e4"]

Must not include:
- debtor=3
- debtor=1

Severe conditions: invented_event_id, invented_person, self_reference, wrong_debt_holder, reversed_direction
- wrong_debt_holder: debtor=3
- reversed_direction: debtor=1, creditor=2

**Contrast** `P029` role `b`: Arlo's second payment is $300 in card a and $500 in card b (the note is $1,500, the first payment $400)
- expected a: include [debtor=2, creditor=1, amount=800, status="open"] exclude [-]
- expected b: include [debtor=2, creditor=1, amount=600, status="open"] exclude [-]
- structural differences from card a:
  - `context.events[id=e4].magnitude: 300 -> 500`

*Author note:* The same note with a $500 second payment leaves $600 outstanding. The arithmetic has to follow both partial payments; Thelma is not a party and the lender is not the debtor.

### S-debt_chain-006

group `G066` · split `locked` · scored `True` · tick 11400

> Rosalind lends money against written notes. Emil borrowed from her on a note that fell due this spring. Kermit, her only son, lives in her house and has kept her books for years. Under town rules a lender's claim passes with the estate to the heir.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Rosalind Forsyth | 71 | female | True | native | 9400 | greed +1 |
| 2 | Emil Granger | 45 | male | True | native | 700 | all 0 |
| 3 | Kermit Forsyth | 44 | male | True | native | 2600 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 11100 | loan | 1 Rosalind Forsyth, 2 Emil Granger | 900 | 11400 |  | written |
| e2 | 11200 | repayment | 2 Emil Granger, 1 Rosalind Forsyth | 200 |  | e1 | partial, cash |
| e3 | 11250 | deal | 3 Kermit Forsyth, 2 Emil Granger | 120 |  |  | cash |
| e4 | 11250 | help | 3 Kermit Forsyth, 1 Rosalind Forsyth | 15 |  |  |  |

**Output schema:** `debt_chain_v1`

Must include:
- debtor=2, creditor=1, status="open", amount=700, origin_event="e1"

Must not include:
- debtor=3
- debtor=2, creditor=3
- debtor=2, status="repaid"

Severe conditions: invented_event_id, invented_person, self_reference, wrong_debt_holder, contradicts_fact
- wrong_debt_holder: debtor=3
- contradicts_fact: debtor=2, status="repaid"

**Contrast** `P030` role `a`: Rosalind dies before the log ends in card b and Kermit inherits her estate; in card a she is alive and still holds the note
- expected a: include [debtor=2, creditor=1, status="open"] exclude [debtor=2, creditor=3, status="open"]
- expected b: include [debtor=2, creditor=3, status="open"] exclude [debtor=2, creditor=1, status="open"]

*Author note:* $900 less $200 leaves $700 open to Rosalind, who is alive and still holds the note. Kermit keeps the books but owes nothing himself. Calling the balance repaid contradicts the two repayment events.

### S-debt_chain-007

group `G066` · split `locked` · scored `True` · tick 11400

> Rosalind lends money against written notes. Emil borrowed from her on a note that fell due this spring. Kermit, her only son, lives in her house and has kept her books for years. Under town rules a lender's claim passes with the estate to the heir.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Rosalind Forsyth | 71 | female | False | native | 9400 | greed +1 |
| 2 | Emil Granger | 45 | male | True | native | 700 | all 0 |
| 3 | Kermit Forsyth | 44 | male | True | native | 2600 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 11100 | loan | 1 Rosalind Forsyth, 2 Emil Granger | 900 | 11400 |  | written |
| e2 | 11200 | repayment | 2 Emil Granger, 1 Rosalind Forsyth | 200 |  | e1 | partial, cash |
| e3 | 11250 | deal | 3 Kermit Forsyth, 2 Emil Granger | 120 |  |  | cash |
| e4 | 11250 | help | 3 Kermit Forsyth, 1 Rosalind Forsyth | 15 |  |  |  |
| e5 | 11300 | death | 1 Rosalind Forsyth | 0 |  |  |  |
| e6 | 11300 | inheritance | 1 Rosalind Forsyth, 3 Kermit Forsyth | 9400 |  | e5 | house, cash |

**Output schema:** `debt_chain_v1`

Must include:
- debtor=2, creditor=3, status="open", amount=700, origin_event="e1"

Must not include:
- debtor=2, creditor=1, status="open"
- debtor=3

Severe conditions: invented_event_id, invented_person, self_reference, wrong_debt_holder, contradicts_fact
- wrong_debt_holder: debtor=3
- contradicts_fact: debtor=2, status="repaid"

**Contrast** `P030` role `b`: Rosalind dies before the log ends in card b and Kermit inherits her estate; in card a she is alive and still holds the note
- expected a: include [debtor=2, creditor=1, status="open"] exclude [debtor=2, creditor=3, status="open"]
- expected b: include [debtor=2, creditor=3, status="open"] exclude [debtor=2, creditor=1, status="open"]
- structural differences from card a:
  - `context.events[id=e5]: <absent> -> {'id': 'e5', 'tick': 11300, 'type': 'death', 'actors': [1], 'magnitude': 0, 'caused_by': [], 'tags': []}`
  - `context.events[id=e6]: <absent> -> {'id': 'e6', 'tick': 11300, 'type': 'inheritance', 'actors': [1, 3], 'magnitude': 9400, 'caused_by': ['e5'], 'tags': ['house', 'cash']}`
  - `context.people[id=1].alive: True -> False`

*Author note:* Rosalind's death does not cancel the balance: the claim travels with her estate to Kermit, so the same $700 is now owed to him. Keeping Rosalind as the creditor, or turning the heir into the debtor, misreads the transfer.

### S-debt_chain-008

group `G067` · split `locked` · scored `True` · tick 18550

> Orrin borrowed $2,500 against his acreage and repaid part of it before he died last winter. Imogene is his daughter, Rupert his son; his will names one of them sole heir and leaves the other nothing. Eunice holds the note. Under town rules an heir takes the dead person's debts with the estate.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Eunice Harlan | 66 | female | True | native | 15000 | greed +1 |
| 2 | Orrin Iverson | 70 | male | False | native | 0 | all 0 |
| 3 | Imogene Iverson | 35 | female | True | native | 1200 | all 0 |
| 4 | Rupert Iverson | 39 | male | True | native | 1500 | all 0 |
| 5 | Marian Jessup | 40 | female | True | native | 1900 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 18100 | loan | 1 Eunice Harlan, 2 Orrin Iverson | 2500 | 18500 |  | written, land |
| e2 | 18300 | repayment | 2 Orrin Iverson, 1 Eunice Harlan | 500 |  | e1 | partial, cash |
| e3 | 18400 | death | 2 Orrin Iverson | 0 |  |  |  |
| e4 | 18400 | inheritance | 2 Orrin Iverson, 3 Imogene Iverson | 4000 |  | e3 | land, house |
| e5 | 18400 | debt_transfer | 2 Orrin Iverson, 3 Imogene Iverson | 2000 |  | e1, e4 |  |
| e6 | 18480 | help | 5 Marian Jessup, 1 Eunice Harlan | 20 |  |  |  |

**Output schema:** `debt_chain_v1`

Must include:
- debtor=3, creditor=1, status="open", amount=2000, origin_event="e1", transferred_from=2, evidence_any=["e5"]

Must not include:
- debtor=4
- debtor=2, status="open"

Severe conditions: invented_event_id, invented_person, self_reference, wrong_debt_holder, contradicts_fact
- wrong_debt_holder: debtor=4
- contradicts_fact: debtor=2, status="open"

**Contrast** `P031` role `a`: Orrin's sole heir is his daughter Imogene in card a and his son Rupert in card b
- expected a: include [debtor=3, status="open"] exclude [debtor=4]
- expected b: include [debtor=4, status="open"] exclude [debtor=3]

*Author note:* $2,500 less $500 leaves $2,000, and the transfer event hands it to Imogene, the sole heir, so she owes it now. Rupert inherited nothing and is the wrong holder; leaving the obligation open in Orrin's name ignores that he died.

### S-debt_chain-009

group `G067` · split `locked` · scored `True` · tick 18550

> Orrin borrowed $2,500 against his acreage and repaid part of it before he died last winter. Imogene is his daughter, Rupert his son; his will names one of them sole heir and leaves the other nothing. Eunice holds the note. Under town rules an heir takes the dead person's debts with the estate.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Eunice Harlan | 66 | female | True | native | 15000 | greed +1 |
| 2 | Orrin Iverson | 70 | male | False | native | 0 | all 0 |
| 3 | Imogene Iverson | 35 | female | True | native | 1200 | all 0 |
| 4 | Rupert Iverson | 39 | male | True | native | 1500 | all 0 |
| 5 | Marian Jessup | 40 | female | True | native | 1900 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 18100 | loan | 1 Eunice Harlan, 2 Orrin Iverson | 2500 | 18500 |  | written, land |
| e2 | 18300 | repayment | 2 Orrin Iverson, 1 Eunice Harlan | 500 |  | e1 | partial, cash |
| e3 | 18400 | death | 2 Orrin Iverson | 0 |  |  |  |
| e4 | 18400 | inheritance | 2 Orrin Iverson, 4 Rupert Iverson | 4000 |  | e3 | land, house |
| e5 | 18400 | debt_transfer | 2 Orrin Iverson, 4 Rupert Iverson | 2000 |  | e1, e4 |  |
| e6 | 18480 | help | 5 Marian Jessup, 1 Eunice Harlan | 20 |  |  |  |

**Output schema:** `debt_chain_v1`

Must include:
- debtor=4, creditor=1, status="open", amount=2000, origin_event="e1", transferred_from=2, evidence_any=["e5"]

Must not include:
- debtor=3
- debtor=2, status="open"

Severe conditions: invented_event_id, invented_person, self_reference, wrong_debt_holder, contradicts_fact
- wrong_debt_holder: debtor=3
- contradicts_fact: debtor=2, status="open"

**Contrast** `P031` role `b`: Orrin's sole heir is his daughter Imogene in card a and his son Rupert in card b
- expected a: include [debtor=3, status="open"] exclude [debtor=4]
- expected b: include [debtor=4, status="open"] exclude [debtor=3]
- structural differences from card a:
  - `context.events[id=e4].actors[1]: 3 -> 4`
  - `context.events[id=e5].actors[1]: 3 -> 4`

*Author note:* The will and the transfer name Rupert here, so the $2,000 moves to him and Imogene owes nothing. Reading the heir from the wrong sibling is how this pair separates.

### S-debt_chain-010

group `G068` · split `locked` · scored `True` · tick 6320

> Prudence lent Hollis $800 on a verbal promise. A week later Hollis lent Tessa $300 of it, also on a verbal promise. Tessa paid him back in full before it fell due, and Hollis passed that money straight to Prudence the same day. He paid her $200 more a month later. All three live on the same street.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Prudence Kincaid | 57 | female | True | native | 6800 | loyalty +1 |
| 2 | Hollis Jessup | 48 | male | True | native | 1100 | all 0 |
| 3 | Tessa Langley | 26 | female | True | native | 400 | loyalty +2 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 6000 | loan | 1 Prudence Kincaid, 2 Hollis Jessup | 800 | 6300 |  | verbal, cash |
| e2 | 6007 | loan | 2 Hollis Jessup, 3 Tessa Langley | 300 | 6250 |  | verbal, cash |
| e3 | 6240 | repayment | 3 Tessa Langley, 2 Hollis Jessup | 300 |  | e2 | cash |
| e4 | 6240 | repayment | 2 Hollis Jessup, 1 Prudence Kincaid | 300 |  | e1, e3 | partial, cash |
| e5 | 6270 | repayment | 2 Hollis Jessup, 1 Prudence Kincaid | 200 |  | e1 | partial, cash |
| e6 | 6290 | deal | 1 Prudence Kincaid, 3 Tessa Langley | 120 |  |  | cash |

**Output schema:** `debt_chain_v1`

Must include:
- debtor=2, creditor=1, status="open", amount=300, origin_event="e1"

Must not include:
- debtor=3, creditor=1

Severe conditions: invented_event_id, invented_person, self_reference, wrong_debt_holder, contradicts_fact
- wrong_debt_holder: debtor=3, creditor=1
- contradicts_fact: debtor=2, status="repaid"

*Author note:* Hollis borrowed $800 and has passed on $300 and $200, so he still owes Prudence $300. Tessa's loan ran from him, not from Prudence, and making her Prudence's debtor invents a debt.

### S-debt_chain-011

group `G068` · split `locked` · scored `True` · tick 6320

> Prudence lent Hollis $800 on a verbal promise. A week later Hollis lent Tessa $300 of it, also on a verbal promise. Tessa paid him back in full before it fell due, and Hollis passed that money straight to Prudence the same day. He paid her $200 more a month later. All three live on the same street.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Prudence Kincaid | 57 | female | True | native | 6800 | loyalty +1 |
| 2 | Hollis Jessup | 48 | male | True | native | 1100 | all 0 |
| 3 | Tessa Langley | 26 | female | True | native | 400 | loyalty +2 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 6000 | loan | 1 Prudence Kincaid, 2 Hollis Jessup | 800 | 6300 |  | verbal, cash |
| e2 | 6007 | loan | 2 Hollis Jessup, 3 Tessa Langley | 300 | 6250 |  | verbal, cash |
| e3 | 6240 | repayment | 3 Tessa Langley, 2 Hollis Jessup | 300 |  | e2 | cash |
| e4 | 6240 | repayment | 2 Hollis Jessup, 1 Prudence Kincaid | 300 |  | e1, e3 | partial, cash |
| e5 | 6270 | repayment | 2 Hollis Jessup, 1 Prudence Kincaid | 200 |  | e1 | partial, cash |
| e6 | 6290 | deal | 1 Prudence Kincaid, 3 Tessa Langley | 120 |  |  | cash |

**Output schema:** `debt_chain_v1`

Must include:
- debtor=3, creditor=2, status="repaid", origin_event="e2", evidence_any=["e3"]

Must not include:
- debtor=3, creditor=1
- debtor=3, status="open"

Severe conditions: invented_event_id, invented_person, self_reference, wrong_debt_holder, contradicts_fact
- wrong_debt_holder: debtor=3, creditor=1
- contradicts_fact: debtor=3, status="open"

*Author note:* Tessa's $300 went back to Hollis in full before the due day, so her obligation is closed and she owes Prudence nothing. Carrying it as open, or handing it to Prudence, contradicts the repayment the same tick.

### S-debt_chain-012

group `G069` · split `locked` · scored `True` · tick 13400

> Barnett lent Etta $700 in cash and wrote it in his ledger with the day it was due. When he asked for it in the street she said the money had been a gift and called him a cheat in front of the store. Jethro, Etta's brother, has never borrowed from Barnett; he buys feed from him and pays as he goes.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Barnett Emmett | 60 | male | True | native | 8800 | greed +1, pride +2 |
| 2 | Etta Corbin | 41 | female | True | native | 500 | pride +2, temper +1 |
| 3 | Jethro Jessup | 49 | male | True | native | 1700 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 13000 | loan | 1 Barnett Emmett, 2 Etta Corbin | 700 | 13300 |  | written, cash |
| e2 | 13200 | help | 3 Jethro Jessup, 2 Etta Corbin | 40 |  |  |  |
| e3 | 13360 | quarrel | 1 Barnett Emmett, 2 Etta Corbin | 55 |  | e1 | public |
| e4 | 13360 | insult | 2 Etta Corbin, 1 Barnett Emmett | 50 |  | e3 | public |
| e5 | 13380 | deal | 1 Barnett Emmett, 3 Jethro Jessup | 200 |  |  | cash |

**Output schema:** `debt_chain_v1`

Must include:
- debtor=2, creditor=1, status="open", amount=700, origin_event="e1", evidence_any=["e1"]

Must not include:
- debtor=3
- debtor=2, status="repaid"
- debtor=2, status="forgiven"

Severe conditions: invented_event_id, invented_person, self_reference, wrong_debt_holder, contradicts_fact
- wrong_debt_holder: debtor=3
- contradicts_fact: debtor=2, status="repaid"

*Author note:* A recorded loan with no repayment and no forgiveness stays open for the full $700, whatever Etta says in the street. Jethro buys feed for cash and has never borrowed, so a debt in his name is invented.

### S-debt_chain-013

group `G070` · split `locked` · scored `True` · tick 20350

> Jessamine lent Jonas $1,200 against a written note. He paid $200 of it before she fell ill in the spring. In the summer she wrote to him that the rest was off and he need not pay another cent. Wilmer, her nephew, keeps house for her but has no share in her money.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Jessamine Dorsey | 69 | female | True | native | 7200 | warmth +1 |
| 2 | Jonas Harlan | 37 | male | True | native | 900 | all 0 |
| 3 | Wilmer Dorsey | 44 | male | True | native | 300 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 20000 | loan | 1 Jessamine Dorsey, 2 Jonas Harlan | 1200 | 20400 |  | written |
| e2 | 20200 | repayment | 2 Jonas Harlan, 1 Jessamine Dorsey | 200 |  | e1 | partial, cash |
| e3 | 20250 | illness | 1 Jessamine Dorsey | 0 |  |  |  |
| e4 | 20300 | debt_forgiven | 1 Jessamine Dorsey, 2 Jonas Harlan | 1000 |  | e3 | written |
| e5 | 20300 | help | 3 Wilmer Dorsey, 1 Jessamine Dorsey | 30 |  |  |  |

**Output schema:** `debt_chain_v1`

Must include:
- debtor=2, creditor=1, status="forgiven", origin_event="e1", evidence_any=["e4"]

Must not include:
- debtor=2, status="open"
- debtor=3

Severe conditions: invented_event_id, invented_person, self_reference, wrong_debt_holder
- wrong_debt_holder: debtor=3

*Author note:* Jessamine's written release wiped the $1,000 that was left, so the obligation closes as forgiven and nothing is open. Wilmer keeps the house but has no share in her money and owes nothing.

## broken_promise

### S-broken_promise-004

group `G071` · split `locked` · scored `True` · tick 5040

> Bernice Mallory promised her granddaughter Gertie $800 toward the term's fees, to be paid before the term starts. Gertie promised their neighbor Rowan Pickett she would feed his hens through the county fair. Truman is Gertie's father. The fair came and went this spring; the school fixes its fee day once a year.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Bernice Mallory | 68 | female | True | native | 2100 | loyalty +1, warmth +1 |
| 2 | Truman Mallory | 41 | male | True | native | 3400 | loyalty +2 |
| 3 | Gertie Mallory | 19 | female | True | native | 300 | warmth +1 |
| 4 | Rowan Pickett | 44 | male | True | native | 2600 | pride +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 4800 | promise | 1 Bernice Mallory, 3 Gertie Mallory | 800 | 4960 |  | verbal, witnessed |
| e2 | 4870 | promise | 3 Gertie Mallory, 4 Rowan Pickett | 60 | 4900 |  | verbal |
| e3 | 4900 | promise_kept | 3 Gertie Mallory, 4 Rowan Pickett | 60 |  | e2 |  |
| e4 | 4900 | quarrel | 4 Rowan Pickett, 2 Truman Mallory | 50 |  |  | public |
| e5 | 4950 | help | 2 Truman Mallory, 1 Bernice Mallory | 45 |  |  |  |

**Output schema:** `broken_promise_v1`

Must include:
- promisor=1, promisee=3, promise_event="e1", status="broken", evidence_any=["e1"]

Must not include:
- promise_event="e1", status=["pending", "kept"]
- promise_event="e2", status=["broken", "pending"]

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- reversed_direction: promise_event="e1", promisor=3
- contradicts_fact: promise_event="e1", status="kept"

**Contrast** `P032` role `a`: The $800 fee day is day 4960 in card a and day 5120 in card b; the log ends on day 5040
- expected a: include [promise_event="e1", status="broken"] exclude [promise_event="e1", status="pending"]
- expected b: include [promise_event="e1", status="pending"] exclude [promise_event="e1", status="broken"]

*Author note:* The fee day fell on day 4960, 80 days before the log ends, and no payment appears, so Bernice's promise is broken; claiming it was kept says money changed hands that did not. Gertie fed Rowan's hens and the kept event records it, so calling that promise broken or pending contradicts the log. An item with Gertie as promisor reverses who promised the fees.

### S-broken_promise-005

group `G071` · split `locked` · scored `True` · tick 5040

> Bernice Mallory promised her granddaughter Gertie $800 toward the term's fees, to be paid before the term starts. Gertie promised their neighbor Rowan Pickett she would feed his hens through the county fair. Truman is Gertie's father. The fair came and went this spring; the school fixes its fee day once a year.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Bernice Mallory | 68 | female | True | native | 2100 | loyalty +1, warmth +1 |
| 2 | Truman Mallory | 41 | male | True | native | 3400 | loyalty +2 |
| 3 | Gertie Mallory | 19 | female | True | native | 300 | warmth +1 |
| 4 | Rowan Pickett | 44 | male | True | native | 2600 | pride +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 4800 | promise | 1 Bernice Mallory, 3 Gertie Mallory | 800 | 5120 |  | verbal, witnessed |
| e2 | 4870 | promise | 3 Gertie Mallory, 4 Rowan Pickett | 60 | 4900 |  | verbal |
| e3 | 4900 | promise_kept | 3 Gertie Mallory, 4 Rowan Pickett | 60 |  | e2 |  |
| e4 | 4900 | quarrel | 4 Rowan Pickett, 2 Truman Mallory | 50 |  |  | public |
| e5 | 4950 | help | 2 Truman Mallory, 1 Bernice Mallory | 45 |  |  |  |

**Output schema:** `broken_promise_v1`

Must include:
- promisor=1, promisee=3, promise_event="e1", status="pending"

Must not include:
- promise_event="e1", status=["broken", "kept"]
- promise_event="e2", status=["broken", "pending"]

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- reversed_direction: promise_event="e1", promisor=3
- contradicts_fact: promise_event="e1", status="kept"

**Contrast** `P032` role `b`: The $800 fee day is day 4960 in card a and day 5120 in card b; the log ends on day 5040
- expected a: include [promise_event="e1", status="broken"] exclude [promise_event="e1", status="pending"]
- expected b: include [promise_event="e1", status="pending"] exclude [promise_event="e1", status="broken"]
- structural differences from card a:
  - `context.events[id=e1].due_tick: 4960 -> 5120`

*Author note:* Same cast and log, but the fee day is 80 days after the log ends on day 5040, so nothing is overdue and the fee promise is pending. Calling it broken or kept contradicts the record. Gertie's hen promise was still kept.

### S-broken_promise-006

group `G072` · split `locked` · scored `True` · tick 6350

> Freda Newcomb promised her granddaughter Hattie $600 for a year of music lessons, due when the autumn term ends, six weeks after the harvest fair. Freda's son Percy promised their neighbor Corinna Tolliver he would repair her porch railing before the fair. Corinna later gave Hattie a violin. The log ends three months after the fair.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Freda Newcomb | 72 | female | True | native | 5200 | warmth +2, piety +1 |
| 2 | Percy Newcomb | 46 | male | True | native | 1800 | loyalty +1, pride +1 |
| 3 | Hattie Newcomb | 14 | female | True | native | 0 | all 0 |
| 4 | Corinna Tolliver | 39 | female | True | native | 900 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 6100 | promise | 1 Freda Newcomb, 3 Hattie Newcomb | 600 | 6300 |  | written |
| e2 | 6120 | promise | 2 Percy Newcomb, 4 Corinna Tolliver | 150 | 6250 |  | verbal, witnessed |
| e3 | 6200 | help | 4 Corinna Tolliver, 1 Freda Newcomb | 45 |  |  |  |
| e4 | 6250 | promise_kept | 2 Percy Newcomb, 4 Corinna Tolliver | 150 |  | e2 |  |
| e5 | 6260 | gift | 4 Corinna Tolliver, 3 Hattie Newcomb | 40 |  |  |  |
| e6 | 6290 | help | 2 Percy Newcomb, 1 Freda Newcomb | 60 |  |  |  |
| e7 | 6290 | help | 4 Corinna Tolliver, 3 Hattie Newcomb | 30 |  |  |  |

**Output schema:** `broken_promise_v1`

Must include:
- promisor=1, promisee=3, promise_event="e1", status="broken"

Must not include:
- promise_event="e2", status=["broken", "pending"]
- promise_event="e1", status=["pending", "kept"]

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- reversed_direction: promise_event="e2", promisor=4
- contradicts_fact: promise_event="e1", status="kept"

**Contrast** `P033` role `a`: Card b drops event e4, the promise_kept that records Percy finishing Corinna's railing; all other events match
- expected a: include [-] exclude [promise_event="e2", status=["broken", "pending"]]
- expected b: include [promise_event="e2", status="broken"] exclude [-]

*Author note:* Percy repaired the railing before the fair, ten days ahead of the due day, and e4 records it, so that promise is kept and is optional to list; calling it broken or pending contradicts the log. Freda's lesson money was due at the term's end and nothing was paid, so it is broken. Corinna as promisor of the railing reverses who promised.

### S-broken_promise-007

group `G072` · split `locked` · scored `True` · tick 6350

> Freda Newcomb promised her granddaughter Hattie $600 for a year of music lessons, due when the autumn term ends, six weeks after the harvest fair. Freda's son Percy promised their neighbor Corinna Tolliver he would repair her porch railing before the fair. Corinna later gave Hattie a violin. The log ends three months after the fair.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Freda Newcomb | 72 | female | True | native | 5200 | warmth +2, piety +1 |
| 2 | Percy Newcomb | 46 | male | True | native | 1800 | loyalty +1, pride +1 |
| 3 | Hattie Newcomb | 14 | female | True | native | 0 | all 0 |
| 4 | Corinna Tolliver | 39 | female | True | native | 900 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 6100 | promise | 1 Freda Newcomb, 3 Hattie Newcomb | 600 | 6300 |  | written |
| e2 | 6120 | promise | 2 Percy Newcomb, 4 Corinna Tolliver | 150 | 6250 |  | verbal, witnessed |
| e3 | 6200 | help | 4 Corinna Tolliver, 1 Freda Newcomb | 45 |  |  |  |
| e5 | 6260 | gift | 4 Corinna Tolliver, 3 Hattie Newcomb | 40 |  |  |  |
| e6 | 6290 | help | 2 Percy Newcomb, 1 Freda Newcomb | 60 |  |  |  |
| e7 | 6290 | help | 4 Corinna Tolliver, 3 Hattie Newcomb | 30 |  |  |  |

**Output schema:** `broken_promise_v1`

Must include:
- promisor=2, promisee=4, promise_event="e2", status="broken"
- promisor=1, promisee=3, promise_event="e1", status="broken"

Must not include:
- promise_event="e2", status=["kept", "pending"]
- promise_event="e1", status=["pending", "kept"]

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- reversed_direction: promise_event="e2", promisor=4
- contradicts_fact: promise_event="e1", status="kept"

**Contrast** `P033` role `b`: Card b drops event e4, the promise_kept that records Percy finishing Corinna's railing; all other events match
- expected a: include [-] exclude [promise_event="e2", status=["broken", "pending"]]
- expected b: include [promise_event="e2", status="broken"] exclude [-]
- structural differences from card a:
  - `context.events[id=e4]: {'id': 'e4', 'tick': 6250, 'type': 'promise_kept', 'actors': [2, 4], 'magnitude': 150, 'caused_by': ['e2'], 'tags': []} -> <absent>`

*Author note:* Without the kept event nothing was repaired by the fair, so Percy's railing promise is broken even though the cast and the other events are unchanged. Calling it kept invents the repair; pending ignores that the fair is over.

### S-broken_promise-008

group `G073` · split `locked` · scored `True` · tick 8330

> Marshall Orton promised his son Harvey $1,200 toward a truck by Harvey's twenty-sixth birthday. He also promised Bridget Slade new shelving for her shop before it opened. Bridget later gave Harvey a set of tools. Kittie is Marshall's wife. The log ends a month after the birthday.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Marshall Orton | 58 | male | True | native | 7400 | loyalty +1, pride +1 |
| 2 | Kittie Orton | 55 | female | True | native | 2000 | warmth +1 |
| 3 | Bridget Slade | 31 | female | True | native | 2600 | greed +1 |
| 4 | Harvey Orton | 26 | male | True | native | 1100 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 8200 | promise | 1 Marshall Orton, 3 Bridget Slade | 900 | 8280 |  | written |
| e2 | 8210 | promise | 1 Marshall Orton, 4 Harvey Orton | 1200 | 8300 |  | verbal |
| e3 | 8280 | promise_kept | 1 Marshall Orton, 3 Bridget Slade | 900 |  | e1 |  |
| e4 | 8290 | promise_kept | 1 Marshall Orton, 4 Harvey Orton | 700 |  | e2 | partial |
| e5 | 8290 | help | 3 Bridget Slade, 2 Kittie Orton | 50 |  |  |  |
| e6 | 8310 | gift | 3 Bridget Slade, 4 Harvey Orton | 60 |  |  |  |

**Output schema:** `broken_promise_v1`

Must include:
- promisor=1, promisee=4, promise_event="e2", status="broken", evidence_any=["e2", "e4"]

Must not include:
- promise_event="e2", status=["kept", "pending"]
- promise_event="e1", status=["broken", "pending"]

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- reversed_direction: promise_event="e2", promisor=4
- contradicts_fact: promise_event="e2", status="kept"

*Author note:* $1,200 was promised and e4 pays $700 of it, leaving $500 unpaid after the birthday: a part payment counts as broken under the schema. The shelving was finished on its due day, so calling it broken or pending contradicts the log.

### S-broken_promise-009

group `G073` · split `locked` · scored `True` · tick 8330

> Marshall Orton promised his son Harvey $1,200 toward a truck by Harvey's twenty-sixth birthday. He also promised Bridget Slade new shelving for her shop before it opened. Bridget later gave Harvey a set of tools. Kittie is Marshall's wife. The log ends a month after the birthday.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Marshall Orton | 58 | male | True | native | 7400 | loyalty +1, pride +1 |
| 2 | Kittie Orton | 55 | female | True | native | 2000 | warmth +1 |
| 3 | Bridget Slade | 31 | female | True | native | 2600 | greed +1 |
| 4 | Harvey Orton | 26 | male | True | native | 1100 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 8200 | promise | 1 Marshall Orton, 3 Bridget Slade | 900 | 8280 |  | written |
| e2 | 8210 | promise | 1 Marshall Orton, 4 Harvey Orton | 1200 | 8300 |  | verbal |
| e3 | 8260 | promise_kept | 1 Marshall Orton, 4 Harvey Orton | 600 |  | e2 | partial |
| e4 | 8290 | promise_kept | 1 Marshall Orton, 3 Bridget Slade | 400 |  | e1 | partial |
| e5 | 8290 | help | 3 Bridget Slade, 2 Kittie Orton | 50 |  |  |  |
| e6 | 8300 | promise_kept | 1 Marshall Orton, 4 Harvey Orton | 600 |  | e2, e3 |  |
| e7 | 8310 | gift | 3 Bridget Slade, 4 Harvey Orton | 60 |  |  |  |

**Output schema:** `broken_promise_v1`

Must include:
- promisor=1, promisee=3, promise_event="e1", status="broken"

Must not include:
- promise_event="e1", status=["kept", "pending"]
- promise_event="e2", status=["broken", "pending"]

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- reversed_direction: promise_event="e1", promisor=3
- contradicts_fact: promise_event="e2", status="broken"

*Author note:* Harvey's $1,200 arrives in two payments, the second on the birthday, so that promise is complete. Only $400 of the $900 shelving job was done, so Bridget's promise is broken; the total paid is not the test, the work promised is. Calling the completed truck money broken contradicts the log.

### S-broken_promise-010

group `G074` · split `locked` · scored `True` · tick 9360

> Vernon Rourke promised his grandson Reuben $2,000 toward trade school, due before the autumn term. Vernon died six weeks before the term began. Under town rules a dead person's promise becomes a debt of the estate, and Lavinia is Vernon's sole heir. Pansy Vickers is a neighbor. The log ends two months after the term began.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Vernon Rourke | 77 | male | False | native | 9000 | pride +2 |
| 2 | Lavinia Rourke | 49 | female | True | native | 2100 | loyalty +2 |
| 3 | Reuben Rourke | 22 | male | True | native | 600 | all 0 |
| 4 | Pansy Vickers | 63 | female | True | native | 1500 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 9200 | promise | 1 Vernon Rourke, 3 Reuben Rourke | 2000 | 9300 |  | written |
| e2 | 9260 | death | 1 Vernon Rourke | 0 |  |  |  |
| e3 | 9260 | inheritance | 1 Vernon Rourke, 2 Lavinia Rourke | 9000 |  | e2 | house |
| e4 | 9270 | offering | 2 Lavinia Rourke, 1 Vernon Rourke | 60 |  |  | joss_paper |
| e5 | 9280 | promise | 2 Lavinia Rourke, 4 Pansy Vickers | 0 | 9290 |  | verbal |
| e6 | 9290 | promise_kept | 2 Lavinia Rourke, 4 Pansy Vickers | 0 |  | e5 |  |
| e7 | 9340 | help | 4 Pansy Vickers, 2 Lavinia Rourke | 40 |  |  |  |

**Output schema:** `broken_promise_v1`

Must include:
- promisee=3, promise_event="e1", status="broken", evidence_any=["e1", "e2"]

Must not include:
- promise_event="e1", status=["pending", "kept"]
- promise_event="e5", status=["broken", "pending"]

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- contradicts_fact: promise_event="e1", status="kept"
- reversed_direction: promise_event="e1", promisor=3

*Author note:* Vernon promised $2,000 due on day 9300, died on day 9260, and no money reached Reuben by the log end; the estate owes it, so the promise is broken rather than cancelled. Listing it as kept says a dead man paid, which the log never shows. Lavinia's promise of weekly rides was kept at e6.

### S-broken_promise-011

group `G074` · split `locked` · scored `True` · tick 9360

> Vernon Rourke promised his grandson Reuben $2,000 toward trade school, due before the autumn term. Vernon died six weeks before the term began. Under town rules a dead person's promise becomes a debt of the estate, and Lavinia is Vernon's sole heir. Pansy Vickers is a neighbor. The log ends two months after the term began.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Vernon Rourke | 77 | male | False | native | 9000 | pride +2 |
| 2 | Lavinia Rourke | 49 | female | True | native | 2100 | loyalty +2 |
| 3 | Reuben Rourke | 22 | male | True | native | 600 | all 0 |
| 4 | Pansy Vickers | 63 | female | True | native | 1500 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 9200 | promise | 1 Vernon Rourke, 3 Reuben Rourke | 2000 | 9300 |  | written |
| e2 | 9260 | death | 1 Vernon Rourke | 0 |  |  |  |
| e3 | 9260 | inheritance | 1 Vernon Rourke, 2 Lavinia Rourke | 9000 |  | e2 | house |
| e4 | 9270 | offering | 2 Lavinia Rourke, 1 Vernon Rourke | 60 |  |  | joss_paper |
| e5 | 9280 | promise | 2 Lavinia Rourke, 4 Pansy Vickers | 0 | 9290 |  | verbal |
| e6 | 9295 | gift | 2 Lavinia Rourke, 3 Reuben Rourke | 2000 |  | e1, e3 | cash |
| e7 | 9340 | help | 4 Pansy Vickers, 2 Lavinia Rourke | 40 |  |  |  |

**Output schema:** `broken_promise_v1`

Must include:
- promisor=2, promisee=4, promise_event="e5", status="broken"

Must not include:
- promise_event="e1", status=["broken", "pending"]
- promise_event="e5", status=["kept", "pending"]

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- contradicts_fact: promise_event="e1", status="broken"
- reversed_direction: promise_event="e5", promisor=4

*Author note:* The heir paid the full $2,000 out of the estate on day 9295, five days before the due day, so Vernon's promise is discharged and is not broken or pending. Lavinia's weekly-ride promise was due on day 9290 and nothing was done, so that one is broken.

### S-broken_promise-012

group `G075` · split `locked` · scored `True` · tick 7260

> Clarice Wexler promised her father Byron $500 toward his workshop roof by mid-May. Byron promised their neighbor Stanley Yeager his old lathe by the same day. In this town a promise counts as kept only if it is fulfilled by its due day. The log ends in early September.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Byron Wexler | 63 | male | True | native | 4100 | pride +1, temper +1 |
| 2 | Dorothea Wexler | 59 | female | True | native | 1200 | warmth +1 |
| 3 | Clarice Wexler | 34 | female | True | native | 1500 | loyalty +1 |
| 4 | Stanley Yeager | 52 | male | True | native | 3000 | loyalty +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 7000 | promise | 3 Clarice Wexler, 1 Byron Wexler | 500 | 7150 |  | written |
| e2 | 7010 | promise | 1 Byron Wexler, 4 Stanley Yeager | 300 | 7150 |  | verbal, witnessed |
| e3 | 7150 | promise_kept | 1 Byron Wexler, 4 Stanley Yeager | 300 |  | e2 |  |
| e4 | 7200 | promise_kept | 3 Clarice Wexler, 1 Byron Wexler | 500 |  | e1 |  |
| e5 | 7220 | gift | 4 Stanley Yeager, 2 Dorothea Wexler | 50 |  |  |  |
| e6 | 7220 | help | 2 Dorothea Wexler, 3 Clarice Wexler | 40 |  |  |  |

**Output schema:** `broken_promise_v1`

Must include:
- promisor=3, promisee=1, promise_event="e1", status="broken", evidence_any=["e1", "e4"]

Must not include:
- promise_event="e1", status=["kept", "pending"]
- promise_event="e2", status=["broken", "pending"]

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- reversed_direction: promise_event="e1", promisor=1
- contradicts_fact: promise_event="e2", status="broken"

*Author note:* Clarice paid the $500 on day 7200, fifty days after the day it was due, and the card's rule counts late fulfilment as broken. Byron handed over the lathe on the due day itself, so that promise is kept. Calling the lathe promise broken contradicts the log.

### S-broken_promise-013

group `G076` · split `locked` · scored `True` · tick 5590

> Cecil Vickers promised his wife Lucinda a new kitchen before their daughter's spring wedding. He also promised Jerome Slade, a hired hand, a $400 bonus when the kitchen was finished. Jerome's wife Annette works at the diner. The log ends a month after the wedding.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Cecil Vickers | 47 | male | True | native | 3300 | loyalty +1, pride +1 |
| 2 | Lucinda Vickers | 44 | female | True | native | 900 | warmth +1 |
| 3 | Jerome Slade | 38 | male | True | native | 1200 | greed +1 |
| 4 | Annette Slade | 36 | female | True | native | 700 | temper +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 5400 | promise | 1 Cecil Vickers, 2 Lucinda Vickers | 900 | 5560 |  | written |
| e2 | 5450 | accident | 1 Cecil Vickers | 70 |  |  |  |
| e3 | 5470 | promise | 1 Cecil Vickers, 3 Jerome Slade | 400 | 5550 |  | verbal |
| e4 | 5500 | help | 3 Jerome Slade, 1 Cecil Vickers | 90 |  | e3 |  |
| e5 | 5540 | quarrel | 4 Annette Slade, 3 Jerome Slade | 40 |  |  | public |
| e6 | 5550 | promise_kept | 1 Cecil Vickers, 2 Lucinda Vickers | 900 |  | e1, e4 |  |
| e7 | 5550 | promise_kept | 1 Cecil Vickers, 3 Jerome Slade | 250 |  | e3 | partial |

**Output schema:** `broken_promise_v1`

Must include:
- promisor=1, promisee=3, promise_event="e3", status="broken", evidence_any=["e3", "e7"]

Must not include:
- promise_event="e1", status=["broken", "pending"]
- promise_event="e3", status=["kept", "pending"]

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- reversed_direction: promise_event="e3", promisor=3
- contradicts_fact: promisor=3, promisee=2

*Author note:* The $400 bonus was paid as $250, so the bonus promise is broken. The kitchen itself was finished before the wedding, recorded at e6 after Jerome's work, so calling it broken or pending contradicts the log. Jerome never promised Lucinda anything.

## relationship_shift

### S-relationship_shift-004

group `G077` · split `locked` · scored `True` · tick 2100

> Sadie Ashby and Homer Brandt grew up on the same street and began courting this spring. Marigold is Sadie's mother and has known Homer since he was a boy. The log covers the season that followed the courtship.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Sadie Ashby | 21 | female | True | native | 400 | warmth +1 |
| 2 | Homer Brandt | 24 | male | True | native | 700 | pride +2 |
| 3 | Marigold Ashby | 45 | female | True | native | 2500 | pride +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 2000 | courtship | 2 Homer Brandt, 1 Sadie Ashby | 60 |  |  | public |
| e2 | 2030 | gift | 1 Sadie Ashby, 2 Homer Brandt | 60 |  |  |  |
| e3 | 2060 | marriage | 1 Sadie Ashby, 2 Homer Brandt | 60 |  |  | public |
| e4 | 2060 | deal | 3 Marigold Ashby, 2 Homer Brandt | 40 |  |  |  |

**Output schema:** `relationship_shift_v1`

Must include:
- a=1, b=2, direction="warmer", turning_point=["e1", "e3"]

Must not include:
- a=1, b=2, direction=["colder", "reversed", "unchanged"]
- a=2, b=3, direction=["warmer", "reversed"]

Severe conditions: invented_event_id, invented_person, self_reference, contradicts_fact
- contradicts_fact: a=1, b=2, direction="colder"

**Contrast** `P034` role `a`: Event e3 is a marriage of the same two people in card a and a public quarrel between them in card b
- expected a: include [a=1, b=2, direction="warmer"] exclude [a=1, b=2, direction=["colder", "reversed"]]
- expected b: include [a=1, b=2, direction=["colder", "reversed"]] exclude [a=1, b=2, direction="warmer"]

*Author note:* Two neighbours court, exchange a gift and marry, so the pair moves warmer and the decisive event is the courtship or the marriage. A colder reading reverses the log. Marigold sells Homer firewood once; that transaction does not warm her relationship with him.

### S-relationship_shift-005

group `G077` · split `locked` · scored `True` · tick 2100

> Sadie Ashby and Homer Brandt grew up on the same street and began courting this spring. Marigold is Sadie's mother and has known Homer since he was a boy. The log covers the season that followed the courtship.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Sadie Ashby | 21 | female | True | native | 400 | warmth +1 |
| 2 | Homer Brandt | 24 | male | True | native | 700 | pride +2 |
| 3 | Marigold Ashby | 45 | female | True | native | 2500 | pride +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 2000 | courtship | 2 Homer Brandt, 1 Sadie Ashby | 60 |  |  | public |
| e2 | 2030 | gift | 1 Sadie Ashby, 2 Homer Brandt | 60 |  |  |  |
| e3 | 2060 | quarrel | 1 Sadie Ashby, 2 Homer Brandt | 60 |  |  | public |
| e4 | 2060 | deal | 3 Marigold Ashby, 2 Homer Brandt | 40 |  |  |  |

**Output schema:** `relationship_shift_v1`

Must include:
- a=1, b=2, direction=["colder", "reversed"], turning_point="e3"

Must not include:
- a=1, b=2, direction=["warmer", "unchanged"]
- a=2, b=3, direction=["warmer", "reversed"]

Severe conditions: invented_event_id, invented_person, self_reference, contradicts_fact
- contradicts_fact: a=1, b=2, direction="warmer"

**Contrast** `P034` role `b`: Event e3 is a marriage of the same two people in card a and a public quarrel between them in card b
- expected a: include [a=1, b=2, direction="warmer"] exclude [a=1, b=2, direction=["colder", "reversed"]]
- expected b: include [a=1, b=2, direction=["colder", "reversed"]] exclude [a=1, b=2, direction="warmer"]
- structural differences from card a:
  - `context.events[id=e3].type: 'marriage' -> 'quarrel'`

*Author note:* The courtship ends in a public quarrel on day 2060 and nothing follows it, so the pair ends colder or reversed with that quarrel as the turning point. The gift before it does not cancel the public break. Calling the pair warmer contradicts the log.

### S-relationship_shift-006

group `G078` · split `locked` · scored `True` · tick 2100

> Winifred Everly runs the last dairy farm on her road. Ivan is her late husband's brother and has helped her since the funeral. A load of hay sells for about $800 around here. Henrietta Ives is Winifred's neighbor. The log covers one summer.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Winifred Everly | 58 | female | True | native | 5000 | loyalty +1 |
| 2 | Ivan Everly | 61 | male | True | native | 6400 | greed +1 |
| 3 | Henrietta Ives | 70 | female | True | native | 1200 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 2000 | help | 2 Ivan Everly, 1 Winifred Everly | 70 |  |  |  |
| e2 | 2030 | gift | 1 Winifred Everly, 2 Ivan Everly | 90 |  |  |  |
| e3 | 2060 | deal | 2 Ivan Everly, 1 Winifred Everly | 800 |  |  |  |
| e4 | 2060 | help | 3 Henrietta Ives, 1 Winifred Everly | 40 |  |  |  |

**Output schema:** `relationship_shift_v1`

Must include:
- a=1, b=2, direction="warmer"

Must not include:
- a=1, b=2, direction=["colder", "reversed", "unchanged"]

Severe conditions: invented_event_id, invented_person, self_reference

**Contrast** `P035` role `a`: The hay Ivan sells Winifred in e3 costs $800, the going price, in card a and $2,400 in card b
- expected a: include [a=1, b=2, direction="warmer"] exclude [a=1, b=2, direction=["colder", "reversed"]]
- expected b: include [a=1, b=2, direction=["colder", "reversed"]] exclude [a=1, b=2, direction="warmer"]

*Author note:* Ivan mends her barn roof, she gives him cider, and he sells her a load at the price everyone pays, so the summer makes them warmer. Three friendly events leave no ground for colder, and the pair was never hostile, so not reversed either.

### S-relationship_shift-007

group `G078` · split `locked` · scored `True` · tick 2100

> Winifred Everly runs the last dairy farm on her road. Ivan is her late husband's brother and has helped her since the funeral. A load of hay sells for about $800 around here. Henrietta Ives is Winifred's neighbor. The log covers one summer.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Winifred Everly | 58 | female | True | native | 5000 | loyalty +1 |
| 2 | Ivan Everly | 61 | male | True | native | 6400 | greed +1 |
| 3 | Henrietta Ives | 70 | female | True | native | 1200 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 2000 | help | 2 Ivan Everly, 1 Winifred Everly | 70 |  |  |  |
| e2 | 2030 | gift | 1 Winifred Everly, 2 Ivan Everly | 90 |  |  |  |
| e3 | 2060 | deal | 2 Ivan Everly, 1 Winifred Everly | 2400 |  |  |  |
| e4 | 2060 | help | 3 Henrietta Ives, 1 Winifred Everly | 40 |  |  |  |

**Output schema:** `relationship_shift_v1`

Must include:
- a=1, b=2, direction=["colder", "reversed"]

Must not include:
- a=1, b=2, direction=["warmer", "unchanged"]

Severe conditions: invented_event_id, invented_person, self_reference

**Contrast** `P035` role `b`: The hay Ivan sells Winifred in e3 costs $800, the going price, in card a and $2,400 in card b
- expected a: include [a=1, b=2, direction="warmer"] exclude [a=1, b=2, direction=["colder", "reversed"]]
- expected b: include [a=1, b=2, direction=["colder", "reversed"]] exclude [a=1, b=2, direction="warmer"]
- structural differences from card a:
  - `context.events[id=e3].magnitude: 800 -> 2400`

*Author note:* The roof and the gift already passed, but charging a widow three times the going price for her winter hay sours the pair, so the summer ends colder. Calling it warmer reads the price out of the log, and unchanged ignores it.

### S-relationship_shift-008

group `G079` · split `locked` · scored `True` · tick 3350

> Lamar and Clayton Cogswell are brothers who farm the land their father left them. Johanna is their mother. Priscilla Dunmore and Johanna have bickered over the church flower beds for twenty years. The log covers one year.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Johanna Cogswell | 66 | female | True | native | 2800 | warmth +1 |
| 2 | Lamar Cogswell | 38 | male | True | native | 3600 | pride +2, temper +1 |
| 3 | Clayton Cogswell | 35 | male | True | native | 2400 | loyalty +2 |
| 4 | Priscilla Dunmore | 60 | female | True | native | 1700 | temper +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 3000 | quarrel | 2 Lamar Cogswell, 3 Clayton Cogswell | 70 |  |  | public |
| e2 | 3000 | insult | 2 Lamar Cogswell, 3 Clayton Cogswell | 60 |  | e1 | public |
| e3 | 3100 | illness | 2 Lamar Cogswell | 0 |  |  |  |
| e4 | 3150 | help | 3 Clayton Cogswell, 2 Lamar Cogswell | 85 |  | e3 |  |
| e5 | 3200 | apology | 2 Lamar Cogswell, 3 Clayton Cogswell | 70 |  | e4 |  |
| e6 | 3250 | gift | 2 Lamar Cogswell, 3 Clayton Cogswell | 120 |  | e5 |  |
| e7 | 3300 | quarrel | 4 Priscilla Dunmore, 1 Johanna Cogswell | 30 |  |  |  |

**Output schema:** `relationship_shift_v1`

Must include:
- a=2, b=3, direction=["warmer", "reversed"], turning_point=["e4", "e5"]

Must not include:
- a=2, b=3, direction=["colder", "unchanged"]
- a=1, b=4, direction=["warmer", "reversed"]

Severe conditions: invented_event_id, invented_person, self_reference, contradicts_fact
- contradicts_fact: a=2, b=3, direction="colder"

*Author note:* Lamar insults Clayton in public, then Clayton works his brother's fields through the illness and Lamar apologizes and brings a gift: the brothers end warmer or reversed, and the turning point is the help or the apology. Johanna and Priscilla only repeat a twenty-year quarrel, so they did not warm.

### S-relationship_shift-009

group `G079` · split `locked` · scored `True` · tick 3350

> Lamar and Clayton Cogswell are brothers who farm the land their father left them. Johanna is their mother. Priscilla Dunmore and Johanna have bickered over the church flower beds for twenty years. The log covers one year.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Johanna Cogswell | 66 | female | True | native | 2800 | warmth +1 |
| 2 | Lamar Cogswell | 38 | male | True | native | 3600 | pride +2, temper +1 |
| 3 | Clayton Cogswell | 35 | male | True | native | 2400 | loyalty +2 |
| 4 | Priscilla Dunmore | 60 | female | True | native | 1700 | temper +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 3000 | quarrel | 2 Lamar Cogswell, 3 Clayton Cogswell | 60 |  |  | public |
| e2 | 3080 | help | 1 Johanna Cogswell, 2 Lamar Cogswell | 55 |  |  |  |
| e3 | 3150 | gift | 2 Lamar Cogswell, 1 Johanna Cogswell | 150 |  |  |  |
| e4 | 3220 | help | 1 Johanna Cogswell, 2 Lamar Cogswell | 45 |  |  |  |
| e5 | 3300 | quarrel | 2 Lamar Cogswell, 3 Clayton Cogswell | 40 |  |  | public |
| e6 | 3300 | gift | 1 Johanna Cogswell, 3 Clayton Cogswell | 30 |  |  |  |

**Output schema:** `relationship_shift_v1`

Must include:
- a=1, b=2, direction="warmer"

Must not include:
- a=2, b=3, direction=["warmer", "reversed"]
- a=1, b=2, direction=["colder", "reversed", "unchanged"]

Severe conditions: invented_event_id, invented_person, self_reference

*Author note:* Johanna sits with Lamar's children, he buys her a stove and she keeps his accounts, so mother and son grow warmer. The brothers argue about the same truck twice and nothing else passes between them, so they stay where they were.

### S-relationship_shift-010

group `G080` · split `locked` · scored `True` · tick 4300

> Flora Ives has worked in Ida Fenwick's shop for six years and the two have been close. Thaddeus is Flora's brother. Prentice is Ida's husband. The log covers about a year.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Ida Fenwick | 54 | female | True | native | 6000 | pride +2 |
| 2 | Prentice Fenwick | 57 | male | True | native | 3000 | loyalty +1 |
| 3 | Flora Ives | 29 | female | True | native | 500 | warmth +2 |
| 4 | Thaddeus Ives | 31 | male | True | native | 900 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 4000 | help | 3 Flora Ives, 1 Ida Fenwick | 70 |  |  |  |
| e2 | 4060 | insult | 1 Ida Fenwick, 3 Flora Ives | 25 |  |  | private |
| e3 | 4120 | quarrel | 1 Ida Fenwick, 3 Flora Ives | 30 |  |  | private |
| e4 | 4180 | insult | 1 Ida Fenwick, 3 Flora Ives | 35 |  |  | witnessed |
| e5 | 4240 | gift | 4 Thaddeus Ives, 3 Flora Ives | 40 |  |  |  |
| e6 | 4240 | help | 1 Ida Fenwick, 4 Thaddeus Ives | 30 |  |  |  |

**Output schema:** `relationship_shift_v1`

Must include:
- a=1, b=3, direction=["colder", "reversed"]

Must not include:
- a=1, b=3, direction=["warmer", "unchanged"]

Severe conditions: invented_event_id, invented_person, self_reference

*Author note:* Three slights in a year, two of them private and one in front of a customer, wear a six-year friendship down; no one event turns it, so no turning point is required. The pair still works together, so warmer or unchanged both misread the year.

### S-relationship_shift-011

group `G080` · split `locked` · scored `True` · tick 4300

> Flora Ives has worked in Ida Fenwick's shop for six years and the two have been close. Thaddeus is Flora's brother. Prentice is Ida's husband. The log covers about a year.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Ida Fenwick | 54 | female | True | native | 6000 | pride +2 |
| 2 | Prentice Fenwick | 57 | male | True | native | 3000 | loyalty +1 |
| 3 | Flora Ives | 29 | female | True | native | 500 | warmth +2 |
| 4 | Thaddeus Ives | 31 | male | True | native | 900 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 4000 | help | 3 Flora Ives, 1 Ida Fenwick | 70 |  |  |  |
| e2 | 4060 | gift | 1 Ida Fenwick, 3 Flora Ives | 50 |  |  |  |
| e3 | 4150 | theft | 1 Ida Fenwick, 3 Flora Ives | 300 |  |  | witnessed |
| e4 | 4200 | quarrel | 1 Ida Fenwick, 3 Flora Ives | 60 |  |  | public |
| e5 | 4260 | help | 4 Thaddeus Ives, 3 Flora Ives | 40 |  |  |  |
| e6 | 4260 | help | 2 Prentice Fenwick, 1 Ida Fenwick | 30 |  |  |  |

**Output schema:** `relationship_shift_v1`

Must include:
- a=1, b=3, direction=["colder", "reversed"], turning_point=["e3", "e4"]

Must not include:
- a=1, b=3, direction=["warmer", "unchanged"]

Severe conditions: invented_event_id, invented_person, self_reference

*Author note:* Ida takes $300 from the till in front of a witness on day 4150, and the quarrel the next day settles it: the pair ends colder or reversed with that theft as the turning point. The earlier help and gift do not survive a witnessed theft.

### S-relationship_shift-012

group `G081` · split `locked` · scored `True` · tick 4100

> Rodney Huxley arrived this year in a body assigned by the underworld office. He rents a room at the boarding house run by Geraldine Kessler, whose son Alvin lives there too. Ottilie Galloway keeps house for them. The log covers one autumn.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Geraldine Kessler | 58 | female | True | native | 4200 | warmth +2, piety +1 |
| 2 | Alvin Kessler | 30 | male | True | native | 800 | pride +2 |
| 3 | Rodney Huxley | 33 | male | True | possessed | 100 | loyalty +1 |
| 4 | Ottilie Galloway | 26 | female | True | native | 300 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 4000 | possession | 3 Rodney Huxley | 0 |  |  |  |
| e2 | 4005 | help | 3 Rodney Huxley, 1 Geraldine Kessler | 60 |  |  |  |
| e3 | 4030 | quarrel | 2 Alvin Kessler, 3 Rodney Huxley | 50 |  |  | public |
| e4 | 4070 | help | 3 Rodney Huxley, 4 Ottilie Galloway | 80 |  |  |  |
| e5 | 4090 | gift | 1 Geraldine Kessler, 3 Rodney Huxley | 40 |  |  |  |
| e6 | 4090 | help | 1 Geraldine Kessler, 4 Ottilie Galloway | 35 |  |  |  |

**Output schema:** `relationship_shift_v1`

Must include:
- a=1, b=3, direction=["warmer", "reversed"]

Must not include:
- a=1, b=3, direction=["colder", "unchanged"]
- a=2, b=3, direction=["warmer", "reversed"]

Severe conditions: invented_event_id, invented_person, self_reference

*Author note:* Geraldine takes the coal and pump repairs as rent is due and then gives Rodney her late husband's coat, so her view of him warms whatever body he came in. Alvin quarrels once about a stranger wearing a dead man's coat and nothing repairs it, so his relationship stays where it was.

### S-relationship_shift-013

group `G082` · split `locked` · scored `True` · tick 3700

> Viola and August Ashby are cousins. Their uncle Irwin raised them both and died this spring, leaving the home place. Under town rules a will decides who takes the estate. The log covers the two years around his death.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Viola Ashby | 44 | female | True | native | 2200 | loyalty +1 |
| 2 | August Ashby | 47 | male | True | native | 3100 | greed +2, pride +1 |
| 3 | Irwin Ashby | 79 | male | False | native | 14000 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 3000 | help | 2 August Ashby, 1 Viola Ashby | 70 |  |  |  |
| e2 | 3100 | gift | 1 Viola Ashby, 2 August Ashby | 60 |  |  | heirloom |
| e4 | 3350 | will | 3 Irwin Ashby, 1 Viola Ashby | 14000 |  |  | written, land |
| e3 | 3400 | death | 3 Irwin Ashby | 0 |  |  |  |
| e5 | 3400 | inheritance | 3 Irwin Ashby, 1 Viola Ashby | 14000 |  | e3, e4 | house, land |
| e6 | 3500 | quarrel | 2 August Ashby, 1 Viola Ashby | 80 |  | e5 | public |
| e7 | 3600 | lawsuit | 2 August Ashby, 1 Viola Ashby | 3000 |  | e6 | public |
| e8 | 3650 | offering | 1 Viola Ashby, 3 Irwin Ashby | 60 |  |  | joss_paper |

**Output schema:** `relationship_shift_v1`

Must include:
- a=1, b=2, direction=["colder", "reversed"], turning_point=["e5", "e6"]

Must not include:
- a=1, b=2, direction=["warmer", "unchanged"]

Severe conditions: invented_event_id, invented_person, self_reference

*Author note:* The cousins help each other until the will leaves the home place to Viola alone; August's public quarrel and his lawsuit follow, so the pair ends colder or reversed with the inheritance or the quarrel as the turning point. The earlier help and heirloom belong to the time before the will.

## sanity

### S-sanity-003

group `G085` · split `locked` · scored `False` · tick 1040

> Milton Rook promised his sister Harriet $200 toward her new well by the end of the month. The month has passed and he has paid nothing.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Harriet Rook | 50 | female | True | native | 3000 | loyalty +1 |
| 2 | Milton Rook | 52 | male | True | native | 2600 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 1000 | promise | 2 Milton Rook, 1 Harriet Rook | 200 | 1030 |  | verbal |
| e2 | 1000 | help | 1 Harriet Rook, 2 Milton Rook | 40 |  |  |  |
| e3 | 1030 | gift | 2 Milton Rook, 1 Harriet Rook | 15 |  |  |  |

**Output schema:** `broken_promise_v1`

Must include:
- promisor=2, promisee=1, promise_event="e1", status="broken"

Must not include:
- promise_event="e1", status=["kept", "pending"]

Severe conditions: invented_event_id, invented_person, self_reference

*Author note:* Sanity: the due month passed and nothing was paid.

### S-sanity-004

group `G085` · split `locked` · scored `False` · tick 1040

> Harriet Rook and her brother Milton live next door to each other. The log covers one month.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Harriet Rook | 50 | female | True | native | 3000 | loyalty +1 |
| 2 | Milton Rook | 52 | male | True | native | 2600 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 1000 | gift | 2 Milton Rook, 1 Harriet Rook | 60 |  |  |  |
| e2 | 1000 | help | 2 Milton Rook, 1 Harriet Rook | 40 |  |  |  |
| e3 | 1030 | help | 1 Harriet Rook, 2 Milton Rook | 50 |  |  |  |

**Output schema:** `relationship_shift_v1`

Must include:
- a=1, b=2, direction="warmer"

Must not include:
- a=1, b=2, direction=["colder", "unchanged"]

Severe conditions: invented_event_id, invented_person, self_reference

*Author note:* Sanity: every event is a gift or a favour.

### S-sanity-005

group `G086` · split `locked` · scored `False` · tick 2015

> Perry Sable quarrelled with his wife Eula over money and apologized the same week. The log covers a fortnight.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Perry Sable | 60 | male | True | native | 3400 | temper +1 |
| 2 | Eula Sable | 58 | female | True | native | 1300 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 2000 | quarrel | 1 Perry Sable, 2 Eula Sable | 60 |  |  | private |
| e2 | 2005 | apology | 1 Perry Sable, 2 Eula Sable | 70 |  |  |  |
| e3 | 2005 | help | 2 Eula Sable, 1 Perry Sable | 50 |  |  |  |
| e4 | 2010 | gift | 1 Perry Sable, 2 Eula Sable | 40 |  |  |  |

**Output schema:** `relationship_shift_v1`

Must include:
- a=1, b=2, direction=["warmer", "reversed"]

Must not include:
- a=1, b=2, direction=["colder", "unchanged"]

Severe conditions: invented_event_id, invented_person, self_reference

*Author note:* Sanity: quarrel, apology, help and a gift inside a fortnight.

### S-sanity-006

group `G086` · split `locked` · scored `False` · tick 2070

> Perry Sable promised his wife Eula $300 for a new stove before the harvest. He paid her the full $300 ten days before the harvest.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Perry Sable | 60 | male | True | native | 3400 | temper +1 |
| 2 | Eula Sable | 58 | female | True | native | 1300 | warmth +1 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 2000 | promise | 1 Perry Sable, 2 Eula Sable | 300 | 2060 |  | written |
| e2 | 2050 | promise_kept | 1 Perry Sable, 2 Eula Sable | 300 |  | e1 |  |
| e3 | 2050 | gift | 1 Perry Sable, 2 Eula Sable | 30 |  |  |  |

**Output schema:** `broken_promise_v1`

Must include:
- promisor=1, promisee=2, promise_event="e1", status="kept"

Must not include:
- promise_event="e1", status=["broken", "pending"]

Severe conditions: invented_event_id, invented_person, self_reference

*Author note:* Sanity: the full amount was paid ten days before the due day.
