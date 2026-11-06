# Review sheet: dev

Rendered from tools/cards_dev.py by tools/build_cards.py. Do not edit by hand.

| task | family | cards |
|---|---|---|
| decision | debt_repayment | 3 |
| decision | dream_interpretation | 3 |
| decision | magistrate_ruling | 3 |
| decision | reconcile_or_revenge | 3 |
| decision | remarriage | 3 |
| decision | sanity | 2 |
| decision | will_execution | 3 |
| synthesis | broken_promise | 3 |
| synthesis | debt_chain | 3 |
| synthesis | grudge_detection | 3 |
| synthesis | relationship_shift | 3 |
| synthesis | sanity | 2 |

## dream_interpretation

### D-dream_interpretation-001

group `G001` · split `dev` · scored `True` · tick 21401 · subject 2 (June Pike)

> June inherited her grandfather Harold's farm after he died. On Saturday she plans to reroof the barn alone, using Harold's old wooden ladder, which has not been inspected in years. The night before, she dreams of Harold standing beside a cracked ladder, shaking his head. She wakes at dawn.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Harold Pike | 81 | male | False | native | 0 | warmth +1, piety +2 |
| 2 | June Pike | 34 | female | True | native | 2600 | loyalty +1, warmth +1, piety +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| June Pike | Harold Pike | 75 | 70 | grandparent |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 20100 | death | 1 Harold Pike | 0 |  |  |  |
| e2 | 20200 | offering | 2 June Pike, 1 Harold Pike | 20 |  | e1 | joss_paper |
| e3 | 21400 | dream | 1 Harold Pike, 2 June Pike | 0 |  |  |  |

**Player input** (warn): Harold stands beside a cracked ladder leaning on the barn and slowly shakes his head.

| option | label | grade |
|---|---|---|
| `heed_warning` | Check the ladder, then hire help or postpone the roof job. | acceptable |
| `burn_offering` | Burn joss paper for Harold and ask him what he meant. | acceptable |
| `dismiss_dream` | Shrug the dream off and reroof the barn as planned. | - |
| `read_as_blessing` | Take the dream as Harold blessing the job and start early. | **severe** |

**Contrast** `P001` role `a`: June's piety is +2 in card a and -3 in card b
- expected a: heed_warning, burn_offering
- expected b: dismiss_dream

*Author note:* A pious granddaughter who loved Harold takes a warning dream seriously: checking the ladder or asking Harold through an offering are both in character. Ignoring it is out of character but not absurd. Reading a head-shake beside a cracked ladder as a blessing contradicts the dream.

### D-dream_interpretation-002

group `G001` · split `dev` · scored `True` · tick 21401 · subject 2 (June Pike)

> June inherited her grandfather Harold's farm after he died. On Saturday she plans to reroof the barn alone, using Harold's old wooden ladder, which has not been inspected in years. The night before, she dreams of Harold standing beside a cracked ladder, shaking his head. She wakes at dawn.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Harold Pike | 81 | male | False | native | 0 | warmth +1, piety +2 |
| 2 | June Pike | 34 | female | True | native | 2600 | loyalty +1, warmth +1, piety -3 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| June Pike | Harold Pike | 75 | 70 | grandparent |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 20100 | death | 1 Harold Pike | 0 |  |  |  |
| e2 | 20200 | offering | 2 June Pike, 1 Harold Pike | 20 |  | e1 | joss_paper |
| e3 | 21400 | dream | 1 Harold Pike, 2 June Pike | 0 |  |  |  |

**Player input** (warn): Harold stands beside a cracked ladder leaning on the barn and slowly shakes his head.

| option | label | grade |
|---|---|---|
| `heed_warning` | Check the ladder, then hire help or postpone the roof job. | acceptable |
| `burn_offering` | Burn joss paper for Harold and ask him what he meant. | - |
| `dismiss_dream` | Shrug the dream off and reroof the barn as planned. | acceptable |
| `read_as_blessing` | Take the dream as Harold blessing the job and start early. | **severe** |

**Contrast** `P001` role `b`: June's piety is +2 in card a and -3 in card b
- expected a: heed_warning, burn_offering
- expected b: dismiss_dream
- structural differences from card a:
  - `context.people[id=2].traits.piety: 2 -> -3`

*Author note:* A dreamer who dismisses ghosts treats it as a dream; being cautious about an old ladder is also reasonable without belief. Burning joss paper to ask a ghost is out of character for piety -3. The blessing reading contradicts the dream for anyone.

### D-dream_interpretation-003

group `G002` · split `dev` · scored `True` · tick 18800 · subject 2 (Rosa Gray)

> Walter died two years ago and left Rosa the house and very little money. She has not burned joss paper for him since the funeral; she has $40 left until her pension arrives next week. Tomorrow is the town's autumn offering day. Tonight she dreamed of Walter.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Walter Gray | 74 | male | False | native | 0 | warmth +1 |
| 2 | Rosa Gray | 71 | female | True | native | 40 | loyalty +2, warmth +2, piety +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Rosa Gray | Walter Gray | 70 | 65 | spouse |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 18000 | death | 1 Walter Gray | 0 |  |  |  |
| e2 | 18000 | inheritance | 1 Walter Gray, 2 Rosa Gray | 85000 |  | e1 | house |
| e3 | 18790 | dream | 1 Walter Gray, 2 Rosa Gray | 0 |  |  |  |

**Player input** (request_offering): Walter sits in a thin coat beside an empty brazier, shivering, and looks at her.

| option | label | grade |
|---|---|---|
| `burn_offering` | Spend most of her $40 on joss paper for Walter tomorrow. | acceptable |
| `burn_small` | Burn a small bundle she can afford and promise more next month. | acceptable |
| `ignore_dream` | Treat it as a dream about the cold weather and do nothing. | - |
| `sell_house` | Sell the house to buy a mountain of joss paper. | **severe** |

*Author note:* A loving, mildly pious widow answers a clear request for offerings within her means. Doing nothing is possible but out of character. Selling the house for one dream is absurd.

## will_execution

### D-will_execution-001

group `G003` · split `dev` · scored `True` · tick 15220 · subject 2 (Mark Doyle)

> Frank's written will leaves his hardware shop to Lena, who worked there for twelve years, and leaves his son Mark the house. The will is in a drawer only Mark can reach; nobody else has read it. Mark has a steady job and does not need the shop to live. The town hall asks Mark for the will this week.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Frank Doyle | 77 | male | False | native | 0 | loyalty +2 |
| 2 | Mark Doyle | 41 | male | True | native | 900 | greed +3, pride +1 |
| 3 | Lena Ortiz | 36 | female | True | native | 400 | loyalty +2, warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Mark Doyle | Frank Doyle | 30 | 40 | parent |
| Mark Doyle | Lena Ortiz | 0 | 10 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 14000 | will | 1 Frank Doyle, 3 Lena Ortiz | 60000 |  |  | written, private, shop |
| e2 | 15210 | death | 1 Frank Doyle | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `honor_will` | Hand the will to the town hall; Lena gets the shop. | - |
| `contest_will` | Hand it in, then contest it, claiming Frank was confused. | acceptable |
| `hide_will` | Quietly lose the will so the shop passes to Mark as next of kin. | acceptable |
| `offer_buyout` | Hand it in, then offer Lena cash to give the shop back. | acceptable |

**Contrast** `P002` role `a`: Mark's greed is +3 in card a and -3 in card b
- expected a: contest_will, hide_will
- expected b: honor_will

*Author note:* A very greedy heir with a private will is tempted to hide or contest it; a buyout is the lawful greedy move. Honoring it is out of character but not absurd, so it is neither acceptable nor severe.

### D-will_execution-002

group `G003` · split `dev` · scored `True` · tick 15220 · subject 2 (Mark Doyle)

> Frank's written will leaves his hardware shop to Lena, who worked there for twelve years, and leaves his son Mark the house. The will is in a drawer only Mark can reach; nobody else has read it. Mark has a steady job and does not need the shop to live. The town hall asks Mark for the will this week.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Frank Doyle | 77 | male | False | native | 0 | loyalty +2 |
| 2 | Mark Doyle | 41 | male | True | native | 900 | greed -3, pride +1 |
| 3 | Lena Ortiz | 36 | female | True | native | 400 | loyalty +2, warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Mark Doyle | Frank Doyle | 30 | 40 | parent |
| Mark Doyle | Lena Ortiz | 0 | 10 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 14000 | will | 1 Frank Doyle, 3 Lena Ortiz | 60000 |  |  | written, private, shop |
| e2 | 15210 | death | 1 Frank Doyle | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `honor_will` | Hand the will to the town hall; Lena gets the shop. | acceptable |
| `contest_will` | Hand it in, then contest it, claiming Frank was confused. | - |
| `hide_will` | Quietly lose the will so the shop passes to Mark as next of kin. | - |
| `offer_buyout` | Hand it in, then offer Lena cash to give the shop back. | acceptable |

**Contrast** `P002` role `b`: Mark's greed is +3 in card a and -3 in card b
- expected a: contest_will, hide_will
- expected b: honor_will
- structural differences from card a:
  - `context.people[id=2].traits.greed: 3 -> -3`

*Author note:* An heir indifferent to money and not in need honors his father's will; wanting the family shop back for sentimental reasons through a fair buyout is also reasonable. Hiding or contesting is out of character.

### D-will_execution-003

group `G004` · split `dev` · scored `True` · tick 9300 · subject 2 (Eli Novak)

> Agnes's witnessed will leaves her house to her grandson Eli on one condition: he must keep sweeping the family graves and burn joss paper there twice a year. Eli rents a small room and has $150. Nobody checks the graves except the groundskeeper, who visits monthly.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Agnes Novak | 88 | female | False | native | 0 | pride +1, piety +3 |
| 2 | Eli Novak | 19 | male | True | native | 150 | greed +1, warmth +1, piety -2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Eli Novak | Agnes Novak | 50 | 50 | grandparent |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 8800 | will | 1 Agnes Novak, 2 Eli Novak | 45000 |  |  | written, witnessed, house |
| e2 | 9280 | death | 1 Agnes Novak | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `accept_and_comply` | Take the house and keep up the graves as the will asks. | acceptable |
| `accept_and_neglect` | Take the house and quietly let the grave duties slide. | acceptable |
| `decline_house` | Decline the house and keep renting his room. | - |
| `dig_up_graves` | Take the house and dig up the graves to end the duty. | **severe** |

*Author note:* A young man with little money takes the house; whether he keeps the duty honestly or lets it slide fits his low piety. Declining a free house over light chores is unlikely. Digging up graves is absurd and offensive.

## reconcile_or_revenge

### D-reconcile_or_revenge-001

group `G005` · split `dev` · scored `True` · tick 13000 · subject 1 (Nora Quinn)

> Six years ago Beth's dog killed Nora's hens. Beth denied it in front of the whole church, though a neighbor had seen it; she never paid for the hens. Beth's husband died this spring and she needs work. Today she walks into Nora's bakery and asks whether the counter job is still open.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Nora Quinn | 52 | female | True | native | 8000 | pride +1, vindictiveness +3 |
| 2 | Beth Lyle | 49 | female | True | native | 300 | pride +2 |
| 3 | Cal Lyle | 55 | male | False | native | 0 | all 0 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Nora Quinn | Beth Lyle | -40 | -50 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 11000 | accident | 2 Beth Lyle, 1 Nora Quinn | 40 |  |  |  |
| e2 | 11005 | insult | 2 Beth Lyle, 1 Nora Quinn | 60 |  | e1 | public |
| e3 | 12800 | death | 3 Cal Lyle | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `reconcile` | Give Beth the job and call the hens even. | - |
| `keep_away` | Say the job is filled and keep her at a distance. | acceptable |
| `public_revenge` | Refuse loudly in front of customers and retell the hen story. | acceptable |
| `poison_dog` | Refuse, then poison Beth's dog that night. | **severe** |

**Contrast** `P003` role `a`: Nora's vindictiveness is +3 in card a and -3 in card b
- expected a: keep_away, public_revenge
- expected b: reconcile

*Author note:* Someone who holds grudges refuses; doing it coldly or publicly both fit. Hiring her is out of character. Killing an animal over old hens is far beyond the grievance.

### D-reconcile_or_revenge-002

group `G005` · split `dev` · scored `True` · tick 13000 · subject 1 (Nora Quinn)

> Six years ago Beth's dog killed Nora's hens. Beth denied it in front of the whole church, though a neighbor had seen it; she never paid for the hens. Beth's husband died this spring and she needs work. Today she walks into Nora's bakery and asks whether the counter job is still open.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Nora Quinn | 52 | female | True | native | 8000 | pride +1, vindictiveness -3 |
| 2 | Beth Lyle | 49 | female | True | native | 300 | pride +2 |
| 3 | Cal Lyle | 55 | male | False | native | 0 | all 0 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Nora Quinn | Beth Lyle | -40 | -50 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 11000 | accident | 2 Beth Lyle, 1 Nora Quinn | 40 |  |  |  |
| e2 | 11005 | insult | 2 Beth Lyle, 1 Nora Quinn | 60 |  | e1 | public |
| e3 | 12800 | death | 3 Cal Lyle | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `reconcile` | Give Beth the job and call the hens even. | acceptable |
| `keep_away` | Say the job is filled and keep her at a distance. | acceptable |
| `public_revenge` | Refuse loudly in front of customers and retell the hen story. | - |
| `poison_dog` | Refuse, then poison Beth's dog that night. | **severe** |

**Contrast** `P003` role `b`: Nora's vindictiveness is +3 in card a and -3 in card b
- expected a: keep_away, public_revenge
- expected b: reconcile
- structural differences from card a:
  - `context.people[id=1].traits.vindictiveness: 3 -> -3`

*Author note:* A forgiving woman can let six-year-old hens go and help a new widow; keeping polite distance from someone with trust -50 is also reasonable. Public humiliation is out of character. Poisoning the dog is absurd.

### D-reconcile_or_revenge-003

group `G006` · split `dev` · scored `True` · tick 24100 · subject 1 (Victor Hale)

> Twenty years ago Ray sued Victor over their father's pasture and won it. The brothers have not spoken since. Ray is now dying in the county hospital and has sent word through a nurse that he wants to see Victor before the end of the week.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Victor Hale | 66 | male | True | native | 12000 | pride +2, warmth +1, vindictiveness +1 |
| 2 | Ray Hale | 69 | male | True | native | 7000 | all 0 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Victor Hale | Ray Hale | -30 | -20 | sibling |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 16800 | quarrel | 1 Victor Hale, 2 Ray Hale | 70 |  |  | land |
| e2 | 16820 | lawsuit | 2 Ray Hale, 1 Victor Hale | 5000 |  | e1 | land |
| e3 | 24000 | illness | 2 Ray Hale | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `visit_and_reconcile` | Visit Ray and make peace. | acceptable |
| `send_letter` | Send a short letter instead of visiting. | acceptable |
| `refuse` | Refuse to come. | acceptable |
| `demand_pasture` | Visit only to demand the pasture back before Ray dies. | **severe** |

*Author note:* Proud, slightly grudging but not cold: visiting, a guarded letter, or refusal are all believable. Using a dying brother's last request to grab land would look grotesque on screen.

## debt_repayment

### D-debt_repayment-001

group `G007` · split `dev` · scored `True` · tick 7210 · subject 1 (Tom Reyes)

> Iris lent Tom $1,200 in cash against a signed note, due a month ago. Tom has $9,000 in savings. His rent of $1,100 is due in a week. Iris stops him outside the post office and asks about the money.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Tom Reyes | 38 | male | True | native | 9000 | loyalty +1 |
| 2 | Iris Bloom | 63 | female | True | native | 20000 | greed +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Tom Reyes | Iris Bloom | 20 | 40 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 7000 | loan | 2 Iris Bloom, 1 Tom Reyes | 1200 | 7180 |  | written, cash |

| option | label | grade |
|---|---|---|
| `repay` | Repay the full $1,200 now. | acceptable |
| `ask_extension` | Explain and ask Iris for three more months. | - |
| `pay_part` | Pay $300 now and promise the rest within two months. | - |
| `deny_debt` | Tell Iris the money was a gift. | **severe** |

**Contrast** `P004` role `a`: Tom's savings are $9,000 in card a and $1,300 in card b (rent of $1,100 is due in a week)
- expected a: repay
- expected b: ask_extension, pay_part

*Author note:* A mildly loyal man with ample savings pays an overdue signed loan. Stalling is out of character. Calling a signed note a gift is absurd.

### D-debt_repayment-002

group `G007` · split `dev` · scored `True` · tick 7210 · subject 1 (Tom Reyes)

> Iris lent Tom $1,200 in cash against a signed note, due a month ago. Tom has $1,300 in savings. His rent of $1,100 is due in a week. Iris stops him outside the post office and asks about the money.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Tom Reyes | 38 | male | True | native | 1300 | loyalty +1 |
| 2 | Iris Bloom | 63 | female | True | native | 20000 | greed +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Tom Reyes | Iris Bloom | 20 | 40 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 7000 | loan | 2 Iris Bloom, 1 Tom Reyes | 1200 | 7180 |  | written, cash |

| option | label | grade |
|---|---|---|
| `repay` | Repay the full $1,200 now. | acceptable |
| `ask_extension` | Explain and ask Iris for three more months. | acceptable |
| `pay_part` | Pay $300 now and promise the rest within two months. | acceptable |
| `deny_debt` | Tell Iris the money was a gift. | **severe** |

**Contrast** `P004` role `b`: Tom's savings are $9,000 in card a and $1,300 in card b (rent of $1,100 is due in a week)
- expected a: repay
- expected b: ask_extension, pay_part
- structural differences from card a:
  - `context.people[id=1].wealth: 9000 -> 1300`
  - `context.situation: 'Iris lent Tom $1,200 in cash against a signed note, due a month ago. Tom has $9,000 in savings. His rent of $1,100 is due in a week. Iris stops him outside the post office and asks about the money.' -> 'Iris lent Tom $1,200 in cash against a signed note, due a month ago. Tom has $1,300 in savings. His rent of $1,100 is due in a week. Iris stops him outside the post office and asks about the money.'`

*Author note:* Repaying would leave Tom unable to pay rent, so asking for time or paying part is the expected move; a loyal man might still repay in full. Calling a signed note a gift is absurd.

### D-debt_repayment-003

group `G008` · split `dev` · scored `True` · tick 10500 · subject 2 (Grace Wu)

> Grace's father Hank owed the grocer Sam $800 on a signed note when he died. Under town rules the debt passed to Grace along with $2,000 from his estate. Sam sends Grace a polite letter asking how she would like to settle it.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Hank Wu | 72 | male | False | native | 0 | all 0 |
| 2 | Grace Wu | 45 | female | True | native | 3000 | greed +2, pride +2 |
| 3 | Sam Patel | 58 | male | True | native | 15000 | warmth +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Grace Wu | Sam Patel | 10 | 20 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 9600 | loan | 3 Sam Patel, 1 Hank Wu | 800 | 9960 |  | written |
| e2 | 10300 | death | 1 Hank Wu | 0 |  |  |  |
| e3 | 10300 | inheritance | 1 Hank Wu, 2 Grace Wu | 2000 |  | e2 | cash |
| e4 | 10300 | debt_transfer | 1 Hank Wu, 2 Grace Wu | 800 |  | e1, e3 |  |

| option | label | grade |
|---|---|---|
| `repay` | Pay Sam the $800 from the estate money. | acceptable |
| `ask_extension` | Ask Sam for a year to pay. | acceptable |
| `refuse_inherited` | Write back that her father's debts died with him. | acceptable |
| `work_it_off` | Offer to work weekends at the grocery instead. | - |

*Author note:* The estate covers the debt, so repaying is natural. A greedy heir may stall or refuse, even though town rules transferred the debt. A proud woman with $3,000 working weekends at a grocery is unlikely but not absurd.

## remarriage

### D-remarriage-001

group `G009` · split `dev` · scored `True` · tick 20000 · subject 1 (Clara Finch)

> Clara's husband Dean died four months ago after thirty years of marriage. Hugh, a widower from church, has walked her home every Sunday for seven weeks. Tonight he proposes. Clara's grown children live nearby and like Hugh.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Clara Finch | 58 | female | True | native | 5000 | loyalty +1, warmth +1 |
| 2 | Dean Finch | 61 | male | False | native | 0 | all 0 |
| 3 | Hugh Barr | 60 | male | True | native | 7000 | warmth +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Clara Finch | Dean Finch | 70 | 70 | spouse |
| Clara Finch | Hugh Barr | 55 | 50 | suitor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 19880 | death | 2 Dean Finch | 0 |  |  |  |
| e2 | 19950 | courtship | 3 Hugh Barr, 1 Clara Finch | 0 |  |  |  |
| e3 | 20000 | courtship | 3 Hugh Barr, 1 Clara Finch | 80 |  |  |  |

| option | label | grade |
|---|---|---|
| `accept` | Accept Hugh's proposal. | - |
| `ask_to_wait` | Ask Hugh to wait a year and keep seeing him. | acceptable |
| `decline` | Decline and stay a widow. | acceptable |
| `elope_tonight` | Run off with Hugh tonight without telling her children. | **severe** |

**Contrast** `P005` role `a`: Dean died four months before the proposal in card a and six years before it in card b
- expected a: ask_to_wait, decline
- expected b: accept

*Author note:* Four months after a long marriage, asking for time or declining is expected. Accepting this fast is out of character for a loyal widow but not absurd. Eloping in secret at 58 when her children approve makes no sense.

### D-remarriage-002

group `G009` · split `dev` · scored `True` · tick 20000 · subject 1 (Clara Finch)

> Clara's husband Dean died six years ago after thirty years of marriage. Hugh, a widower from church, has walked her home every Sunday for seven weeks. Tonight he proposes. Clara's grown children live nearby and like Hugh.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Clara Finch | 58 | female | True | native | 5000 | loyalty +1, warmth +1 |
| 2 | Dean Finch | 61 | male | False | native | 0 | all 0 |
| 3 | Hugh Barr | 60 | male | True | native | 7000 | warmth +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Clara Finch | Dean Finch | 70 | 70 | spouse |
| Clara Finch | Hugh Barr | 55 | 50 | suitor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 17810 | death | 2 Dean Finch | 0 |  |  |  |
| e2 | 19950 | courtship | 3 Hugh Barr, 1 Clara Finch | 0 |  |  |  |
| e3 | 20000 | courtship | 3 Hugh Barr, 1 Clara Finch | 80 |  |  |  |

| option | label | grade |
|---|---|---|
| `accept` | Accept Hugh's proposal. | acceptable |
| `ask_to_wait` | Ask Hugh to wait a year and keep seeing him. | acceptable |
| `decline` | Decline and stay a widow. | - |
| `elope_tonight` | Run off with Hugh tonight without telling her children. | **severe** |

**Contrast** `P005` role `b`: Dean died four months before the proposal in card a and six years before it in card b
- expected a: ask_to_wait, decline
- expected b: accept
- structural differences from card a:
  - `context.events[id=e1].tick: 19880 -> 17810`
  - `context.situation: "Clara's husband Dean died four months ago after thirty years of marriage. Hugh, a widower from church, has walked her home every Sunday for seven weeks. Tonight he proposes. Clara's grown children live nearby and like Hugh." -> "Clara's husband Dean died six years ago after thirty years of marriage. Hugh, a widower from church, has walked her home every Sunday for seven weeks. Tonight he proposes. Clara's grown children live nearby and like Hugh."`

*Author note:* Six years on, with a suitor she likes and family approval, accepting is natural; asking for more time after seven weeks is also reasonable. Declining outright is possible but not expected. Secret elopement makes no sense.

### D-remarriage-003

group `G010` · split `dev` · scored `True` · tick 12400 · subject 1 (Leo Banks)

> Leo's wife Ivy died two years ago, leaving him with Finn, 6, and Rue, 4. Ivy's unmarried sister Mae has helped with the children almost every day since. Leo's mother says the children need a stepmother and that he should decide this year.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Leo Banks | 35 | male | True | native | 2500 | loyalty +1, warmth +2 |
| 2 | Ivy Banks | 31 | female | False | native | 0 | all 0 |
| 3 | Mae Hart | 33 | female | True | native | 1800 | warmth +2 |
| 4 | Finn Banks | 6 | male | True | native | 0 | all 0 |
| 5 | Rue Banks | 4 | female | True | native | 0 | all 0 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Leo Banks | Ivy Banks | 80 | 80 | spouse |
| Leo Banks | Mae Hart | 60 | 75 | in_law |
| Leo Banks | Finn Banks | 90 | 60 | child |
| Leo Banks | Rue Banks | 90 | 60 | child |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 11670 | death | 2 Ivy Banks | 0 |  |  |  |
| e2 | 11700 | help | 3 Mae Hart, 1 Leo Banks | 70 |  | e1 |  |
| e3 | 12300 | help | 3 Mae Hart, 1 Leo Banks | 70 |  |  |  |

| option | label | grade |
|---|---|---|
| `propose_to_mae` | Ask Mae to marry him. | acceptable |
| `stay_single` | Stay single and keep things as they are. | acceptable |
| `court_someone_new` | Start courting the new schoolteacher. | acceptable |
| `send_children_away` | Send the children to an aunt out of state so he can date freely. | **severe** |

*Author note:* Any of the three family-centred paths is believable for a warm widower. Sending his small children away to date is cruel and absurd for warmth +2.

## magistrate_ruling

### D-magistrate_ruling-001

group `G011` · split `dev` · scored `True` · tick 9000 · subject 3 (Magistrate Lu)

> Owen died two years ago; Carl is his son. The register places Owen fifth in the rebirth queue, about five years away. He appeals for the next newborn slot, saying his grandson needs him. The rules let the magistrate grant the next slot for a fee of 50 joss paper, grant a slot in three years, or deny.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Owen Stark | 67 | male | False | native | 0 | pride +1 |
| 2 | Carl Stark | 40 | male | True | native | 3000 | loyalty +2, piety +2 |
| 3 | Magistrate Lu | 900 | male | True | official | 0 | greed +3, pride +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Magistrate Lu | Owen Stark | 0 | 0 |  |
| Magistrate Lu | Carl Stark | 0 | 0 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 8270 | death | 1 Owen Stark | 0 |  |  |  |
| e2 | 8990 | offering | 2 Carl Stark, 3 Magistrate Lu | 300 |  |  | joss_paper, private |
| e3 | 9000 | appeal | 1 Owen Stark, 3 Magistrate Lu | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `grant_next_slot` | Grant the next newborn slot for a fee of 50 joss paper. | acceptable |
| `grant_later_slot` | Grant a slot in three years, no fee. | acceptable |
| `deny` | Deny the appeal; the queue stands. | - |
| `strike_from_register` | Strike Owen from the register of souls for asking. | **severe** |

**Contrast** `P006` role `a`: In card a Carl burned 300 joss paper addressed to the magistrate before the hearing; in card b he did not
- expected a: grant_next_slot
- expected b: grant_later_slot, deny

*Author note:* A very greedy magistrate who has just received 300 joss paper from the family grants the request, or at least a softer slot. Erasing a soul over a polite appeal is absurd.

### D-magistrate_ruling-002

group `G011` · split `dev` · scored `True` · tick 9000 · subject 3 (Magistrate Lu)

> Owen died two years ago; Carl is his son. The register places Owen fifth in the rebirth queue, about five years away. He appeals for the next newborn slot, saying his grandson needs him. The rules let the magistrate grant the next slot for a fee of 50 joss paper, grant a slot in three years, or deny.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Owen Stark | 67 | male | False | native | 0 | pride +1 |
| 2 | Carl Stark | 40 | male | True | native | 3000 | loyalty +2, piety +2 |
| 3 | Magistrate Lu | 900 | male | True | official | 0 | greed +3, pride +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Magistrate Lu | Owen Stark | 0 | 0 |  |
| Magistrate Lu | Carl Stark | 0 | 0 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 8270 | death | 1 Owen Stark | 0 |  |  |  |
| e3 | 9000 | appeal | 1 Owen Stark, 3 Magistrate Lu | 0 |  |  |  |

| option | label | grade |
|---|---|---|
| `grant_next_slot` | Grant the next newborn slot for a fee of 50 joss paper. | - |
| `grant_later_slot` | Grant a slot in three years, no fee. | acceptable |
| `deny` | Deny the appeal; the queue stands. | acceptable |
| `strike_from_register` | Strike Owen from the register of souls for asking. | **severe** |

**Contrast** `P006` role `b`: In card a Carl burned 300 joss paper addressed to the magistrate before the hearing; in card b he did not
- expected a: grant_next_slot
- expected b: grant_later_slot, deny
- structural differences from card a:
  - `context.events[id=e2]: {'id': 'e2', 'tick': 8990, 'type': 'offering', 'actors': [2, 3], 'magnitude': 300, 'caused_by': [], 'tags': ['joss_paper', 'private']} -> <absent>`

*Author note:* Without a gift, a greedy magistrate has no reason to skip the queue: deny, or a modest compromise. Granting the next slot for the bare fee is out of character. Erasing a soul is absurd.

### D-magistrate_ruling-003

group `G012` · split `dev` · scored `True` · tick 16500 · subject 4 (Magistrate Fen)

> Ruth appeals that the ghost Silas has haunted her grandson Ben twice this year. Both hauntings were seen by a clerk of the underworld office. Silas once lost a fence dispute to Ben's father. Ben has done nothing to Silas. The rules allow a fine of up to 100 joss paper.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Ruth Coles | 79 | female | False | native | 0 | warmth +2 |
| 2 | Silas Grim | 64 | male | False | native | 0 | vindictiveness +3 |
| 3 | Ben Coles | 22 | male | True | native | 600 | all 0 |
| 4 | Magistrate Fen | 700 | female | True | official | 0 | loyalty +2, pride +1 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Magistrate Fen | Ruth Coles | 10 | 30 |  |
| Magistrate Fen | Silas Grim | -10 | -20 |  |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 15000 | death | 1 Ruth Coles | 0 |  |  |  |
| e2 | 15800 | death | 2 Silas Grim | 0 |  |  |  |
| e3 | 16300 | haunting | 2 Silas Grim, 3 Ben Coles | 60 |  |  | witnessed |
| e4 | 16420 | haunting | 2 Silas Grim, 3 Ben Coles | 70 |  |  | witnessed |
| e5 | 16500 | appeal | 1 Ruth Coles, 4 Magistrate Fen | 0 |  | e3, e4 |  |

| option | label | grade |
|---|---|---|
| `fine_haunter` | Fine Silas 100 joss paper, paid to Ruth, and order him to stop. | acceptable |
| `warn_haunter` | Warn Silas to stop, no fine. | acceptable |
| `dismiss` | Dismiss the appeal for lack of proof. | - |
| `fine_appellant` | Fine Ruth 100 joss paper for a false appeal. | **severe** |

*Author note:* The hauntings are witnessed by the office itself, so a rule-minded magistrate acts against Silas. Dismissing for lack of proof contradicts the record. Punishing Ruth for a proven complaint is absurd.

## sanity

### D-sanity-001

group `G013` · split `dev` · scored `False` · tick 3000 · subject 1 (Amy Rowe)

> Amy lost her wallet on Main Street. Her neighbor Ken found it and brings it to her door with all the cash still inside.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Amy Rowe | 30 | female | True | native | 4000 | loyalty +3, warmth +3 |
| 2 | Ken Ito | 50 | male | True | native | 6000 | warmth +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Amy Rowe | Ken Ito | 60 | 70 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 2990 | help | 2 Ken Ito, 1 Amy Rowe | 50 |  |  |  |

| option | label | grade |
|---|---|---|
| `thank_him` | Thank Ken warmly. | acceptable |
| `accuse_him` | Accuse Ken of stealing it. | **severe** |

*Author note:* Sanity: the only reasonable response is thanks.

### D-sanity-002

group `G013` · split `dev` · scored `False` · tick 3100 · subject 1 (Amy Rowe)

> Ken lent Amy $20 for groceries last month and asked for it back today. Amy has $4,000 in the bank and likes Ken.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Amy Rowe | 30 | female | True | native | 4000 | loyalty +3, warmth +3 |
| 2 | Ken Ito | 50 | male | True | native | 6000 | warmth +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Amy Rowe | Ken Ito | 60 | 70 | neighbor |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 3080 | loan | 2 Ken Ito, 1 Amy Rowe | 20 | 3100 |  | cash, verbal |

| option | label | grade |
|---|---|---|
| `repay` | Pay Ken back the $20. | acceptable |
| `deny_loan` | Say she never borrowed anything. | **severe** |

*Author note:* Sanity: a loyal, well-off neighbor repays $20.

## grudge_detection

### S-grudge_detection-001

group `G015` · split `dev` · scored `True` · tick 17400

> Ada and Roy are siblings; Hazel was their mother. Cy is a neighbor. The log covers the weeks around Hazel's funeral and the year after.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Ada Moss | 50 | female | True | native | 0 | all 0 |
| 2 | Roy Moss | 47 | male | True | native | 0 | all 0 |
| 3 | Cy Lane | 60 | male | True | native | 0 | all 0 |
| 4 | Hazel Moss | 82 | female | False | native | 0 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e100 | 16990 | death | 4 Hazel Moss | 0 |  |  |  |
| e101 | 16995 | help | 3 Cy Lane, 1 Ada Moss | 60 |  | e100 |  |
| e102 | 17000 | insult | 2 Roy Moss, 1 Ada Moss | 80 |  | e100 | public |
| e103 | 17000 | quarrel | 1 Ada Moss, 2 Roy Moss | 70 |  | e102 | public |

**Output schema:** `grudge_v1`

Must include:
- from=1, to=2, level=["medium", "high"], evidence_any=["e102", "e103"]

Must not include:
- from=1, to=3

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- reversed_direction: from=2, to=1, level="high"
- contradicts_fact: from=1, to=3, level=["medium", "high"]

**Contrast** `P007` role `a`: Card b adds Roy's public apology to Ada and a gift to her, months after the funeral
- expected a: include [from=1, to=2, level=["medium", "high"]] exclude [-]
- expected b: include [-] exclude [from=1, to=2, level=["medium", "high"]]

*Author note:* A public insult at her mother's funeral, never repaired, leaves Ada with a real grudge against Roy. Cy only helped Ada. Roy was the aggressor, so a high grudge from Roy to Ada reverses the story.

### S-grudge_detection-002

group `G015` · split `dev` · scored `True` · tick 17400

> Ada and Roy are siblings; Hazel was their mother. Cy is a neighbor. The log covers the weeks around Hazel's funeral and the year after.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Ada Moss | 50 | female | True | native | 0 | all 0 |
| 2 | Roy Moss | 47 | male | True | native | 0 | all 0 |
| 3 | Cy Lane | 60 | male | True | native | 0 | all 0 |
| 4 | Hazel Moss | 82 | female | False | native | 0 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e100 | 16990 | death | 4 Hazel Moss | 0 |  |  |  |
| e101 | 16995 | help | 3 Cy Lane, 1 Ada Moss | 60 |  | e100 |  |
| e102 | 17000 | insult | 2 Roy Moss, 1 Ada Moss | 80 |  | e100 | public |
| e103 | 17000 | quarrel | 1 Ada Moss, 2 Roy Moss | 70 |  | e102 | public |
| e104 | 17200 | apology | 2 Roy Moss, 1 Ada Moss | 70 |  | e102 | public |
| e105 | 17200 | gift | 2 Roy Moss, 1 Ada Moss | 200 |  | e104 |  |

**Output schema:** `grudge_v1`

Must include:
- (none)

Must not include:
- from=1, to=2, level="high"
- from=1, to=3

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- reversed_direction: from=2, to=1, level="high"
- contradicts_fact: from=1, to=3, level=["medium", "high"]

**Contrast** `P007` role `b`: Card b adds Roy's public apology to Ada and a gift to her, months after the funeral
- expected a: include [from=1, to=2, level=["medium", "high"]] exclude [-]
- expected b: include [-] exclude [from=1, to=2, level=["medium", "high"]]
- structural differences from card a:
  - `context.events[id=e104]: <absent> -> {'id': 'e104', 'tick': 17200, 'type': 'apology', 'actors': [2, 1], 'magnitude': 70, 'caused_by': ['e102'], 'tags': ['public']}`
  - `context.events[id=e105]: <absent> -> {'id': 'e105', 'tick': 17200, 'type': 'gift', 'actors': [2, 1], 'magnitude': 200, 'caused_by': ['e104'], 'tags': []}`

*Author note:* After a public apology and a gift, a lingering low grudge or none is reasonable; medium is tolerated by the gold but fails the pair direction; high ignores the apology.

### S-grudge_detection-003

group `G016` · split `dev` · scored `True` · tick 9300

> Kurt arrived in town this year in a body assigned by the underworld office. The theft of Lisa's toolbox was private: neither Lisa nor Kurt knows who took it. Lisa blamed Kurt in public and sued him.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Kurt Vale | 30 | male | True | possessed | 0 | all 0 |
| 2 | Lisa Webb | 45 | female | True | native | 0 | all 0 |
| 3 | Moe Grant | 70 | male | True | native | 0 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e201 | 9000 | possession | 1 Kurt Vale | 0 |  |  |  |
| e202 | 9100 | theft | 3 Moe Grant, 2 Lisa Webb | 60 |  |  | private |
| e203 | 9100 | insult | 2 Lisa Webb, 1 Kurt Vale | 70 |  | e202 | public |
| e204 | 9150 | lawsuit | 2 Lisa Webb, 1 Kurt Vale | 300 |  | e203 | public |
| e205 | 9250 | help | 3 Moe Grant, 1 Kurt Vale | 20 |  |  |  |

**Output schema:** `grudge_v1`

Must include:
- from=1, to=2, level=["medium", "high"], evidence_any=["e203", "e204"]

Must not include:
- from=2, to=3
- from=1, to=3

Severe conditions: invented_event_id, invented_person, self_reference

*Author note:* Kurt was publicly accused and sued for something he did not do, so he resents Lisa. The theft was private, so neither Lisa nor Kurt knows Moe did it; a grudge against Moe uses knowledge the characters do not have. A grudge from Lisa to Kurt (she believes he stole) is allowed but not required.

## debt_chain

### S-debt_chain-001

group `G017` · split `dev` · scored `True` · tick 12700

> Otto borrowed from Ned and later died. Pia is Otto's daughter and sole heir. Rhea is Otto's sister; she inherited nothing. Under town rules an heir takes on the dead person's debts.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Ned Ford | 60 | male | True | native | 0 | all 0 |
| 2 | Otto Lake | 66 | male | False | native | 0 | all 0 |
| 3 | Pia Lake | 34 | female | True | native | 0 | all 0 |
| 4 | Rhea Lake | 62 | female | True | native | 0 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e301 | 12000 | loan | 1 Ned Ford, 2 Otto Lake | 3000 | 12365 |  | written |
| e302 | 12200 | repayment | 2 Otto Lake, 1 Ned Ford | 1000 |  | e301 | partial |
| e303 | 12500 | death | 2 Otto Lake | 0 |  |  |  |
| e304 | 12500 | inheritance | 2 Otto Lake, 3 Pia Lake | 5000 |  | e303 | house |
| e305 | 12500 | debt_transfer | 2 Otto Lake, 3 Pia Lake | 2000 |  | e301, e304 |  |

**Output schema:** `debt_chain_v1`

Must include:
- debtor=2, creditor=1, status="transferred", origin_event="e301"
- debtor=3, creditor=1, status="open", amount=2000, origin_event="e301", transferred_from=2, evidence_any=["e305"]

Must not include:
- debtor=4
- debtor=2, status="open"

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, wrong_debt_holder, contradicts_fact
- wrong_debt_holder: debtor=4
- reversed_direction: debtor=1, creditor=[2, 3]
- contradicts_fact: debtor=2, status="open"

**Contrast** `P008` role `a`: Card b adds Ned forgiving Pia's inherited debt
- expected a: include [debtor=3, creditor=1, status="open"] exclude [debtor=3, status="forgiven"]
- expected b: include [debtor=3, creditor=1, status="forgiven"] exclude [debtor=3, status="open"]

*Author note:* $3,000 minus a $1,000 partial repayment leaves $2,000, which passed to Pia at Otto's death. Rhea never owed anything. Otto's own obligation is closed by the transfer.

### S-debt_chain-002

group `G017` · split `dev` · scored `True` · tick 12700

> Otto borrowed from Ned and later died. Pia is Otto's daughter and sole heir. Rhea is Otto's sister; she inherited nothing. Under town rules an heir takes on the dead person's debts.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Ned Ford | 60 | male | True | native | 0 | all 0 |
| 2 | Otto Lake | 66 | male | False | native | 0 | all 0 |
| 3 | Pia Lake | 34 | female | True | native | 0 | all 0 |
| 4 | Rhea Lake | 62 | female | True | native | 0 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e301 | 12000 | loan | 1 Ned Ford, 2 Otto Lake | 3000 | 12365 |  | written |
| e302 | 12200 | repayment | 2 Otto Lake, 1 Ned Ford | 1000 |  | e301 | partial |
| e303 | 12500 | death | 2 Otto Lake | 0 |  |  |  |
| e304 | 12500 | inheritance | 2 Otto Lake, 3 Pia Lake | 5000 |  | e303 | house |
| e305 | 12500 | debt_transfer | 2 Otto Lake, 3 Pia Lake | 2000 |  | e301, e304 |  |
| e306 | 12600 | debt_forgiven | 1 Ned Ford, 3 Pia Lake | 2000 |  | e305 |  |

**Output schema:** `debt_chain_v1`

Must include:
- debtor=3, creditor=1, status="forgiven", origin_event="e301", evidence_any=["e306"]

Must not include:
- debtor=4
- debtor=2, status="open"
- debtor=3, status="open"

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, wrong_debt_holder, contradicts_fact
- wrong_debt_holder: debtor=4
- reversed_direction: debtor=1, creditor=[2, 3]
- contradicts_fact: debtor=2, status="open"

**Contrast** `P008` role `b`: Card b adds Ned forgiving Pia's inherited debt
- expected a: include [debtor=3, creditor=1, status="open"] exclude [debtor=3, status="forgiven"]
- expected b: include [debtor=3, creditor=1, status="forgiven"] exclude [debtor=3, status="open"]
- structural differences from card a:
  - `context.events[id=e306]: <absent> -> {'id': 'e306', 'tick': 12600, 'type': 'debt_forgiven', 'actors': [1, 3], 'magnitude': 2000, 'caused_by': ['e305'], 'tags': []}`

*Author note:* Same chain, but Ned forgave Pia's $2,000, so nothing is open. Listing Otto's transferred obligation is optional here.

### S-debt_chain-003

group `G018` · split `dev` · scored `True` · tick 6400

> Sue lent Tim money; a few weeks later Tim lent Uma money. On one day Uma paid Tim back and Tim passed the cash on to Sue.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Sue Park | 55 | female | True | native | 0 | all 0 |
| 2 | Tim Cole | 40 | male | True | native | 0 | all 0 |
| 3 | Uma Reed | 29 | female | True | native | 0 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e401 | 6000 | loan | 1 Sue Park, 2 Tim Cole | 500 | 6200 |  | verbal, cash |
| e402 | 6050 | loan | 2 Tim Cole, 3 Uma Reed | 400 | 6250 |  | verbal, cash |
| e403 | 6240 | repayment | 3 Uma Reed, 2 Tim Cole | 400 |  | e402 |  |
| e404 | 6240 | repayment | 2 Tim Cole, 1 Sue Park | 400 |  | e401, e403 | partial |

**Output schema:** `debt_chain_v1`

Must include:
- debtor=2, creditor=1, status="open", amount=100, origin_event="e401"
- debtor=3, creditor=2, status="repaid", origin_event="e402"

Must not include:
- debtor=3, creditor=1
- debtor=3, status="open"

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, wrong_debt_holder
- wrong_debt_holder: debtor=3, creditor=1
- reversed_direction: debtor=1

*Author note:* Tim still owes Sue $100. Uma repaid Tim in full and never owed Sue anything; making Uma Sue's debtor invents a debt.

## broken_promise

### S-broken_promise-001

group `G019` · split `dev` · scored `True` · tick 20500

> At his mother Vera's deathbed, Wes promised his niece Zoe that he would pay her $1,500 school fees before the school year starts. Later Zoe promised Wes she would paint his fence before winter. The log ends in early autumn.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Vera Nash | 74 | female | False | native | 0 | all 0 |
| 2 | Wes Nash | 45 | male | True | native | 0 | all 0 |
| 3 | Zoe Nash | 16 | female | True | native | 0 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e501 | 20000 | promise | 2 Wes Nash, 3 Zoe Nash | 1500 | 20400 |  | deathbed, witnessed, verbal |
| e502 | 20010 | death | 1 Vera Nash | 0 |  |  |  |
| e503 | 20010 | inheritance | 1 Vera Nash, 2 Wes Nash | 9000 |  | e502 | house |
| e504 | 20200 | promise | 3 Zoe Nash, 2 Wes Nash | 0 | 20600 |  | verbal |

**Output schema:** `broken_promise_v1`

Must include:
- promisor=2, promisee=3, promise_event="e501", status="broken"
- promisor=3, promisee=2, promise_event="e504", status="pending"

Must not include:
- promise_event="e504", status="broken"

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- reversed_direction: promise_event="e501", promisor=3
- contradicts_fact: promisor=1

**Contrast** `P009` role `a`: Card b adds Wes paying the $1,500 before the due day
- expected a: include [promise_event="e501", status="broken"] exclude [-]
- expected b: include [-] exclude [promise_event="e501", status=["broken", "pending"]]

*Author note:* The fees were due on day 20400 and nothing was paid by day 20500: broken. Zoe's fence promise is not due yet: pending. Vera made no promise.

### S-broken_promise-002

group `G019` · split `dev` · scored `True` · tick 20500

> At his mother Vera's deathbed, Wes promised his niece Zoe that he would pay her $1,500 school fees before the school year starts. Later Zoe promised Wes she would paint his fence before winter. The log ends in early autumn.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Vera Nash | 74 | female | False | native | 0 | all 0 |
| 2 | Wes Nash | 45 | male | True | native | 0 | all 0 |
| 3 | Zoe Nash | 16 | female | True | native | 0 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e501 | 20000 | promise | 2 Wes Nash, 3 Zoe Nash | 1500 | 20400 |  | deathbed, witnessed, verbal |
| e502 | 20010 | death | 1 Vera Nash | 0 |  |  |  |
| e503 | 20010 | inheritance | 1 Vera Nash, 2 Wes Nash | 9000 |  | e502 | house |
| e504 | 20200 | promise | 3 Zoe Nash, 2 Wes Nash | 0 | 20600 |  | verbal |
| e505 | 20390 | promise_kept | 2 Wes Nash, 3 Zoe Nash | 1500 |  | e501 |  |

**Output schema:** `broken_promise_v1`

Must include:
- promisor=3, promisee=2, promise_event="e504", status="pending"

Must not include:
- promise_event="e501", status=["broken", "pending"]
- promise_event="e504", status="broken"

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- reversed_direction: promise_event="e501", promisor=3
- contradicts_fact: promisor=1

**Contrast** `P009` role `b`: Card b adds Wes paying the $1,500 before the due day
- expected a: include [promise_event="e501", status="broken"] exclude [-]
- expected b: include [-] exclude [promise_event="e501", status=["broken", "pending"]]
- structural differences from card a:
  - `context.events[id=e505]: <absent> -> {'id': 'e505', 'tick': 20390, 'type': 'promise_kept', 'actors': [2, 3], 'magnitude': 1500, 'caused_by': ['e501'], 'tags': []}`

*Author note:* Wes paid in full ten days before the due day, so the deathbed promise is kept (listing it is optional). The fence promise is still pending.

### S-broken_promise-003

group `G020` · split `dev` · scored `True` · tick 5200

> Ian came to town in a rebuilt body and rents a room from Jude. Jude promised to lower the rent by $100 for one month. Ian promised to repair the whole roof by the end of the season but fixed only the front half.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Ian Frost | 28 | male | True | rebuilt | 0 | all 0 |
| 2 | Jude Marsh | 61 | male | True | native | 0 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e601 | 4900 | rebuild | 1 Ian Frost | 0 |  |  |  |
| e602 | 5000 | promise | 2 Jude Marsh, 1 Ian Frost | 100 | 5030 |  | verbal |
| e603 | 5010 | promise | 1 Ian Frost, 2 Jude Marsh | 0 | 5100 |  | verbal |
| e604 | 5030 | promise_kept | 2 Jude Marsh, 1 Ian Frost | 100 |  | e602 |  |
| e605 | 5090 | promise_kept | 1 Ian Frost, 2 Jude Marsh | 0 |  | e603 | partial |
| e606 | 5090 | quarrel | 2 Jude Marsh, 1 Ian Frost | 50 |  | e605 |  |

**Output schema:** `broken_promise_v1`

Must include:
- promisor=1, promisee=2, promise_event="e603", status="broken"

Must not include:
- promise_event="e602", status=["broken", "pending"]

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction, contradicts_fact
- reversed_direction: promise_event="e603", promisor=2
- contradicts_fact: promise_event="e602", status="broken"

*Author note:* A partial repair by the due day counts as broken under the schema. Jude kept his rent promise on time, so calling it broken contradicts the log.

## relationship_shift

### S-relationship_shift-001

group `G021` · split `dev` · scored `True` · tick 3600

> Kay and Lou are next-door neighbors. The log covers about two years.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Kay Dorn | 40 | female | True | native | 0 | all 0 |
| 2 | Lou Pratt | 42 | male | True | native | 0 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e701 | 3000 | help | 2 Lou Pratt, 1 Kay Dorn | 60 |  |  |  |
| e702 | 3000 | gift | 1 Kay Dorn, 2 Lou Pratt | 40 |  | e701 |  |
| e703 | 3500 | theft | 2 Lou Pratt, 1 Kay Dorn | 80 |  |  | witnessed |

**Output schema:** `relationship_shift_v1`

Must include:
- a=1, b=2, direction=["colder", "reversed"], turning_point="e703"

Must not include:
- a=1, b=2, direction=["warmer", "unchanged"]

Severe conditions: invented_event_id, invented_person, self_reference, contradicts_fact
- contradicts_fact: a=1, b=2, direction="warmer"

**Contrast** `P010` role `a`: Event e703 is a witnessed theft by Lou from Kay in card a and a gift from Lou to Kay in card b
- expected a: include [a=1, b=2, direction=["colder", "reversed"]] exclude [a=1, b=2, direction="warmer"]
- expected b: include [a=1, b=2, direction="warmer"] exclude [a=1, b=2, direction=["colder", "reversed"]]

*Author note:* Help and a thank-you gift, then a witnessed theft: the relationship turns hostile at e703.

### S-relationship_shift-002

group `G021` · split `dev` · scored `True` · tick 3600

> Kay and Lou are next-door neighbors. The log covers about two years.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Kay Dorn | 40 | female | True | native | 0 | all 0 |
| 2 | Lou Pratt | 42 | male | True | native | 0 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e701 | 3000 | help | 2 Lou Pratt, 1 Kay Dorn | 60 |  |  |  |
| e702 | 3000 | gift | 1 Kay Dorn, 2 Lou Pratt | 40 |  | e701 |  |
| e703 | 3500 | gift | 2 Lou Pratt, 1 Kay Dorn | 80 |  |  | witnessed |

**Output schema:** `relationship_shift_v1`

Must include:
- a=1, b=2, direction="warmer"

Must not include:
- a=1, b=2, direction=["colder", "reversed"]

Severe conditions: invented_event_id, invented_person, self_reference, contradicts_fact
- contradicts_fact: a=1, b=2, direction=["colder", "reversed"]

**Contrast** `P010` role `b`: Event e703 is a witnessed theft by Lou from Kay in card a and a gift from Lou to Kay in card b
- expected a: include [a=1, b=2, direction=["colder", "reversed"]] exclude [a=1, b=2, direction="warmer"]
- expected b: include [a=1, b=2, direction="warmer"] exclude [a=1, b=2, direction=["colder", "reversed"]]
- structural differences from card a:
  - `context.events[id=e703].type: 'theft' -> 'gift'`

*Author note:* Every event is friendly, so the relationship only grows warmer. The turning point is not scored.

### S-relationship_shift-003

group `G022` · split `dev` · scored `True` · tick 2000

> Pete is Nell's father. Pete opposed Nell's courtship with Omar; they married anyway. Two years later Pete fell ill.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Nell Ash | 25 | female | True | native | 0 | all 0 |
| 2 | Omar Kidd | 27 | male | True | native | 0 | all 0 |
| 3 | Pete Ash | 58 | male | True | native | 0 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e801 | 1000 | quarrel | 3 Pete Ash, 1 Nell Ash | 60 |  |  |  |
| e802 | 1000 | insult | 3 Pete Ash, 2 Omar Kidd | 70 |  |  | public |
| e803 | 1400 | marriage | 1 Nell Ash, 2 Omar Kidd | 0 |  |  |  |
| e804 | 1800 | illness | 3 Pete Ash | 0 |  |  |  |
| e805 | 1810 | help | 2 Omar Kidd, 3 Pete Ash | 80 |  | e804 |  |
| e806 | 1810 | apology | 3 Pete Ash, 2 Omar Kidd | 70 |  | e805 |  |

**Output schema:** `relationship_shift_v1`

Must include:
- a=3, b=2, direction=["warmer", "reversed"], turning_point=["e805", "e806"]

Must not include:
- a=1, b=2, direction=["colder", "reversed"]

Severe conditions: invented_event_id, invented_person, self_reference, contradicts_fact
- contradicts_fact: a=3, b=2, direction="colder"

*Author note:* Pete and Omar start hostile (public insult) and end reconciled after Omar nursed him and Pete apologized. Nell and Omar married, so calling their relationship colder contradicts the log.

## sanity

### S-sanity-001

group `G014` · split `dev` · scored `False` · tick 200

> Bob robbed Gus in public and mocked him while doing it.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Bob Hall | 40 | male | True | native | 0 | all 0 |
| 2 | Gus Dunn | 41 | male | True | native | 0 | all 0 |
| 3 | Dana Price | 50 | female | True | native | 0 | all 0 |
| 4 | Eve Shaw | 33 | female | True | native | 0 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 100 | theft | 1 Bob Hall, 2 Gus Dunn | 90 |  |  | witnessed, public |
| e2 | 100 | insult | 1 Bob Hall, 2 Gus Dunn | 80 |  | e1 | public |

**Output schema:** `grudge_v1`

Must include:
- from=2, to=1, level=["medium", "high"], evidence_any=["e1", "e2"]

Must not include:
- from=3
- from=4

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction
- reversed_direction: from=1, to=2

*Author note:* Sanity: the robbed man resents the robber; Dana and Eve are not involved.

### S-sanity-002

group `G014` · split `dev` · scored `False` · tick 400

> Dana lent Eve money and Eve paid it all back early, with a small thank-you gift.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Bob Hall | 40 | male | True | native | 0 | all 0 |
| 2 | Gus Dunn | 41 | male | True | native | 0 | all 0 |
| 3 | Dana Price | 50 | female | True | native | 0 | all 0 |
| 4 | Eve Shaw | 33 | female | True | native | 0 | all 0 |

| id | tick | type | actors | magnitude | due | caused_by | tags |
|---|---|---|---|---|---|---|---|
| e1 | 200 | loan | 3 Dana Price, 4 Eve Shaw | 500 | 380 |  | written |
| e2 | 350 | repayment | 4 Eve Shaw, 3 Dana Price | 500 |  | e1 |  |
| e3 | 350 | gift | 4 Eve Shaw, 3 Dana Price | 20 |  | e2 |  |

**Output schema:** `debt_chain_v1`

Must include:
- debtor=4, creditor=3, status="repaid", origin_event="e1"

Must not include:
- debtor=4, status="open"
- debtor=1
- debtor=2

Severe conditions: invented_event_id, invented_person, self_reference, reversed_direction
- reversed_direction: debtor=3, creditor=4

*Author note:* Sanity: a fully repaid loan.
