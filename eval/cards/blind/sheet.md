# Blind check: reviewer sheet

Grade every option of every card from the card alone, before seeing any answer key:

- **A**: a reasonable choice for this person in this situation.
- **N**: out of character, but not absurd.
- **S**: absurd or offensive on screen given these facts.

Each card needs at least one A. One tick is one day. Traits run from -3 to +3; 0 is ordinary.

## B01 · D-dream_interpretation-006

Decision maker: Fern Bishop (id 2)

> Amos Bishop planted the birches on the south lot himself. Since he died five years ago Fern has left the woodlot untouched. A logger has offered $4,000 for the standing timber and the offer closes Friday. Fern owes $900 in property tax by the end of the month and has $200 in the bank. She dreamed of Amos last night.

| id | name | age | sex | alive | origin | wealth | traits |
|---|---|---|---|---|---|---|---|
| 1 | Amos Bishop | 71 | male | False | native | 0 | pride +2, warmth +1 |
| 2 | Fern Bishop | 63 | female | True | native | 200 | loyalty +3, pride +1, piety +2 |

| from | to | affinity | trust | tags |
|---|---|---|---|---|
| Fern Bishop | Amos Bishop | 85 | 80 | spouse |

| id | tick | type | actors | magnitude | due | tags |
|---|---|---|---|---|---|---|
| e1 | 26400 | death | Amos Bishop | 0 |  |  |
| e2 | 26405 | offering | Fern Bishop, Amos Bishop | 15 |  | joss_paper |
| e3 | 28230 | dream | Amos Bishop, Fern Bishop | 0 |  |  |

Player's dream (forbid): Amos stands at the edge of the birches with his arms crossed, blocking the path. He says: not these trees, Fern.

Current tick: 28230

| option | label | your grade |
|---|---|---|
| `refuse_sale` | Turn down the timber offer and find another way to pay the tax. | |
| `sell_timber` | Sign the logger's offer and pay the tax with the money. | |

## B02 · D-dream_interpretation-007

Decision maker: Della Blake (id 3)

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

| id | tick | type | actors | magnitude | due | tags |
|---|---|---|---|---|---|---|
| e1 | 28435 | death | Pearl Blake | 0 |  |  |
| e2 | 28470 | inheritance | Pearl Blake, Dexter Blake | 6000 |  | cash, written |
| e3 | 28800 | dream | Pearl Blake, Della Blake | 0 |  |  |

Player's dream (reveal): Pearl sits on the edge of the bed and says: the money was sewn into the mattress ticking, Della. Dexter took it out the night before the funeral.

Current tick: 28800

| option | label | your grade |
|---|---|---|
| `confront_dexter` | Tell Dexter what the dream said and ask him to explain. | |
| `accuse_church` | Accuse Dexter of taking the money in front of the congregation on Sunday. | |
| `let_it_go` | Treat it as a dream and say nothing to anyone. | |
| `break_in` | Break into Dexter's house at night and search it for the money. | |
| `check_mattress` | Cut open the mattress ticking and check whether the seam was opened. | |

## B03 · D-will_execution-004

Decision maker: Alta Fletcher (id 2)

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

| id | tick | type | actors | magnitude | due | tags |
|---|---|---|---|---|---|---|
| e1 | 30900 | help | Sonny Garrison, Gideon Fletcher | 60 |  |  |
| e2 | 31499 | will | Gideon Fletcher, Sonny Garrison, Tillie Garrison | 42000 |  | verbal, deathbed, witnessed, land |
| e3 | 31499 | will | Gideon Fletcher, Alta Fletcher | 0 |  | verbal, deathbed, witnessed, heirloom |
| e4 | 31502 | death | Gideon Fletcher | 0 |  |  |

Current tick: 31512

| option | label | your grade |
|---|---|---|
| `keep_farm` | Keep the farm as next of kin and pay the Garrisons for two years of care. | |
| `sign_over` | Sign the farm over to the Garrisons and take the silver and the photographs. | |

## B04 · D-will_execution-005

Decision maker: Cleo Ingram (id 2)

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

| id | tick | type | actors | magnitude | due | tags |
|---|---|---|---|---|---|---|
| e1 | 28660 | marriage | Hobart Ingram, Mabel Ingram | 0 |  |  |
| e2 | 29800 | will | Hobart Ingram, Cleo Ingram | 31000 |  | written, witnessed, house |
| e3 | 30120 | death | Hobart Ingram | 0 |  |  |

Current tick: 30180

| option | label | your grade |
|---|---|---|
| `refuse_mill` | Refuse the mill rather than keep Mabel in the house. | |
| `challenge` | Take the mill and ask a lawyer to strike the condition. | |
| `clear_room` | Take the mill and put Mabel's things on the porch this week. | |
| `take_terms` | Take the mill and keep Mabel's room and the monthly sum as the will says. | |
| `take_and_stop` | Take the mill, pay Mabel for a year, then stop. | |

## B05 · D-reconcile_or_revenge-010

Decision maker: Harlan Ramsey (id 1)

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

| id | tick | type | actors | magnitude | due | tags |
|---|---|---|---|---|---|---|
| e1 | 10980 | quarrel | Emory Ramsey, Enoch Thorne | 60 |  | land |
| e2 | 11010 | lawsuit | Emory Ramsey, Enoch Thorne | 3000 |  | land |
| e3 | 17200 | death | Emory Ramsey | 0 |  |  |
| e4 | 20140 | death | Enoch Thorne | 0 |  |  |
| e5 | 24460 | quarrel | Whit Ramsey, Ulysses Thorne | 50 |  | public |

Current tick: 24500

| option | label | your grade |
|---|---|---|
| `drown_meadow` | Open his ditch gate so the water stays on the Thorne meadow. | |
| `clear_free` | Send the dragline and two hands to clear the lane for nothing. | |
| `quote_price` | Name a price of $600 and clear the lane. | |
| `ask_creek_strip` | Clear the lane in exchange for the creek strip. | |

## B06 · D-reconcile_or_revenge-012

Decision maker: Warren Walsh (id 1)

> Twelve years ago Warren Walsh's brother Jasper sold the family woodlot and kept Warren's $3,000 share. Jasper died a year ago. Since the burial a lamp goes out in Warren's kitchen most nights, and Jasper stands at the foot of the bed in his dreams. Jasper's widow Lenore inherited $1,200 and has said nothing about the money. In this town, joss paper burned in a person's name is understood to settle accounts with them.

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

| id | tick | type | actors | magnitude | due | tags |
|---|---|---|---|---|---|---|
| e1 | 20160 | theft | Jasper Walsh, Warren Walsh | 3000 |  | land, private |
| e2 | 24185 | death | Jasper Walsh | 0 |  |  |
| e3 | 24195 | inheritance | Jasper Walsh, Lenore Walsh | 1200 |  | cash |
| e4 | 24500 | haunting | Jasper Walsh, Warren Walsh | 45 |  |  |
| e5 | 24540 | dream | Jasper Walsh, Warren Walsh | 30 |  |  |

Current tick: 24550

| option | label | your grade |
|---|---|---|
| `burn_paper` | Burn joss paper for Jasper and let the $3,000 go. | |
| `bill_widow` | Tell Lenore the joss paper must come out of her $1,200. | |
| `seal_ghost` | Petition the magistrate to seal Jasper's ghost out of the house. | |
| `open_grave` | Open the grave and sell the goods he was buried with. | |

## B07 · D-debt_repayment-008

Decision maker: Bram Fairley (id 1)

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

| id | tick | type | actors | magnitude | due | tags |
|---|---|---|---|---|---|---|
| e1 | 19880 | loan | Eben Gentry, Bram Fairley | 600 | 19960 | cash, verbal |
| e2 | 19880 | loan | Eben Gentry, Caleb Fairley | 900 | 19960 | cash, written |

Current tick: 20000

| option | label | your grade |
|---|---|---|
| `work_it_off` | Ask Eben to take the $600 out of farm work over the winter. | |
| `sell_stock` | Sell his tools and the milk cow and pay Eben in full. | |

## B08 · D-debt_repayment-010

Decision maker: Wade Hollis (id 1)

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

| id | tick | type | actors | magnitude | due | tags |
|---|---|---|---|---|---|---|
| e1 | 22675 | loan | Adele Jarvis, Wade Hollis | 2500 | 23040 | cash, written |
| e2 | 23770 | repayment | Wade Hollis, Adele Jarvis | 200 |  | partial, cash |

Current tick: 24500

| option | label | your grade |
|---|---|---|
| `pay_rest` | Pay the $2,300 still owed, today. | |
| `offer_plan` | Offer $300 a month until the note is clear. | |
| `stall_again` | Say the woodlot money is spoken for and leave it at that. | |
| `dispute_note` | Say the note was for $1,500 and refuse the rest. | |

## B09 · D-remarriage-008

Decision maker: Murray Talbot (id 1)

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

| id | tick | type | actors | magnitude | due | tags |
|---|---|---|---|---|---|---|
| e1 | 7000 | death | Jean Talbot | 0 |  |  |
| e2 | 7040 | offering | Murray Talbot, Jean Talbot | 10 |  | joss_paper |
| e3 | 7350 | help | Lucille Varner, Murray Talbot | 50 |  |  |
| e4 | 7420 | courtship | Lucille Varner, Murray Talbot | 60 |  |  |

Current tick: 7425

| option | label | your grade |
|---|---|---|
| `propose_now` | Ask Lucille to marry him and face Geneva's suit. | |
| `ask_blessing` | Ask Geneva's blessing first, then propose to Lucille. | |
| `wait_for_school` | Wait until Clementine starts school before deciding. | |
| `send_children` | Send Clementine and Nelson to Geneva and marry Lucille. | |

## B10 · D-remarriage-010

Decision maker: Helen Upton (id 1)

> Helen's husband Barrett died three years ago. She is 44 and keeps his hardware store, where Horace Maddox has worked since he came. Horace, 46, arrived in a body assigned by the underworld office two years ago. He asks her to marry him this month. The office registers a marriage only for a householder, and a possessed man needs its leave to head one. The licence costs 40 joss paper and the next hearing is in eight months.

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

| id | tick | type | actors | magnitude | due | tags |
|---|---|---|---|---|---|---|
| e1 | 5000 | death | Barrett Upton | 0 |  |  |
| e2 | 5400 | possession | Horace Maddox | 0 |  |  |
| e3 | 5900 | courtship | Horace Maddox, Helen Upton | 0 |  |  |
| e4 | 6100 | help | Horace Maddox, Helen Upton | 60 |  |  |

Current tick: 6120

| option | label | your grade |
|---|---|---|
| `marry_and_register_later` | Marry him this month and register the household after the hearing. | |
| `wait_for_hearing` | Wait for the office's hearing and marry afterwards. | |
| `ask_office_first` | Ask the office for leave now and set a date for when it comes. | |
| `decline_outsider` | Decline because he is an outsider. | |
| `sell_store_for_licence` | Sell the store to raise the money for the licence. | |

## B11 · D-magistrate_ruling-004

Decision maker: Magistrate Qin (id 4)

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

| id | tick | type | actors | magnitude | due | tags |
|---|---|---|---|---|---|---|
| e1 | 5000 | death | Floyd Wade | 0 |  |  |
| e2 | 5200 | death | Bert Crane | 0 |  |  |
| e3 | 8000 | offering | Vada Wade, Floyd Wade | 200 |  | joss_paper, witnessed |
| e4 | 8060 | appeal | Floyd Wade, Magistrate Qin | 0 |  |  |

Current tick: 8070

| option | label | your grade |
|---|---|---|
| `move_up_monthly` | Move Floyd up one place for each month the credit was lost. | |
| `fine_the_clerk` | Leave the order as it stands and fine the clerk 100 joss paper. | |
| `next_newborn_slot` | Grant Floyd the next newborn slot instead. | |
| `strike_both` | Strike both souls from the register and restart their waiting. | |
| `restore_place` | Move Floyd up twenty places and strike the other credit. | |

## B12 · D-magistrate_ruling-009

Decision maker: Magistrate Yao (id 1)

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

| id | tick | type | actors | magnitude | due | tags |
|---|---|---|---|---|---|---|
| e1 | 1700 | possession | Milo Hollister | 0 |  |  |
| e2 | 8990 | appeal | Milo Hollister, Magistrate Yao | 0 |  |  |

Current tick: 9000

| option | label | your grade |
|---|---|---|
| `refuse_entry` | Refuse the application and leave him on the lease. | |
| `waive_the_fee` | Enter him in the register and waive the fee. | |
| `withdraw_body` | Withdraw the body's licence and return him to the queue. | |
| `grant_entry` | Enter him in the register for the fee of 60 joss paper. | |
| `grant_provisional` | Enter him provisionally for two years and review him again. | |
