# A trained staff for countries nobody plays (experiment)

Lab only. Branch `experiment/strategy-nn` of the private lab. Nothing here is in the public game.

The owner asked, on 2026-10-13:

> separately in the lab lets experiment with training an rnn or other type of nn to learn military stratagy so it powers the game engine for ai countries. it should factor in needing to defend its own territory

then, for how it is trained:

> train the ais against each other and which ever wins advances. add penalties for losing city territory, for losing troops, and for losing land, have the models train across various different country combos, add bonuses for taking enemy cities, encompassing, taking troops, and taking land

and on 2026-10-14:

> adjust the weights, taking a city should matter much more tactically. make sure taking land doesnt mean claiming a territory, it should be consistant by an actual certain amount of area of land. losing a capital city should matter even more
>
> train the model to manage individual troops to turn it into a strategic master.

## In short

- Two kinds of network have been trained by self-play against each other and against the engine's scripted staff. The first orders a side's whole line, with one of four words. The second orders **every troop by itself**, with one of nine orders.
- Both beat the scripted staff by a wide margin. **Neither beats the plain habit of always advancing along the whole line.** The troop-by-troop champion is level with it: −3.0 a war, with a standard error of 4.8, over 150 wars it never saw.
- So no "strategic master" came out of this. What did come out is a fact about the engine. In it, attacking everywhere is as good as any plan these networks could find. Holding or digging in is very much worse, even for the weaker side. Section 4 says what that means and what would change it.
- **On the Wars and Fronts Pt.2 engine** (troops that tire, each country's own figures, levies over weeks, weather, hard ground, fortified lines, air wings: branch `feature/wars-and-fronts-2`), a third network was trained for two hours. It beats the scripted staff (+12.8 a war, standard error 5.2) and is **worse than always advancing** (−14.5, standard error 4.9), over 150 wars it never saw. It pushed with 98% of its orders. Section 3 has the figures.
- On the Pt.2 branch the networks are **not shipped**: the earlier champion was made for a troop's 28 numbers and a troop is now shown 34, and the new one is not level with plain advancing.
- **What did beat everything was a search, not a network** (section 0): a staff that tries its plans out on a copy of the battle before it gives any. It beats every habit in fair duels nearly every time, and it is what leads the lab game's sides nobody plays.

## 0. The staff that looks ahead (2026-10-14 and 15)

The owner, on 2026-10-14: "make it the stockfish of Open historia", with full control of every troop and an understanding of everything on the battlefield; train it on even, randomized fields, not in a game scenario; and then "do a training run that trains models against it until they consistently beat it and every other stratagy to create even better models to build off of".

**How it decides** (`src/runtime/fronts/mind/planner.js`). Every five days it draws up about a dozen whole plans for its side, troop by troop:
- keep what it was doing; its own learnt judgement of each troop (a net over what each troop sees: troops.js plus the nearest enemy and how nearly it is surrounded), as it is, digging in where it would only hold, or resting the worn;
- push everywhere; dig in everywhere;
- the nearest half on one of the three weakest places in the other side's line; everyone on the weakest; a pincer round its largest mass; the towns; the walls.

Each plan is fought out for six days on a COPY of the battle with the real engine (`engine.js rehearsal`, `rehearseOrders`, `rehearseDay`: a test proves the copy's days are the war's own, and that the war is not touched), the battle each leaves is weighed (ground by lawful home, towns, capitals, strength, troops cut off, wear, supply, troops in their works: eight weights), and the best is given. Then its four largest bodies of troops are each tried told otherwise (an attack made a digging in and the other way about), keeping each change that weighs better.

**The fair duels** (`duel.mjs`): a board drawn at random from a seed (3 to 8 rows of regions, 6 to 14 columns, one against one or two against two, towns anywhere, hard ground, walls, air wings, any age, month and latitude), the same for both sides turned half round, with the same armies; each fought twice, each side beginning it once. `duels.mjs` measures a staff in them, `compare.mjs` and `versus.mjs` two settings of the planner against each other.

**Plain weights, 40 duels each** (`runs/planner/eval-plain-40.json`):

| against | margin a duel | won |
|---|---|---|
| always advancing | +65.1 | 31 of 40 |
| the scripted staff | +84.5 | 38 of 40 |
| always digging in | +119.2 | 40 of 40 |
| every troop for a town | +111.6 | 35 of 40 |
| every troop down one route to the capital | +144.8 | 39 of 40 |

**The ladder** (`ladder.mjs`, run `runs/planner/ladder-1`): a challenger is tuned by evolution strategies in duels, half against the champion and half against every habit; every five generations it is tried on 16 duels it never trained on, and promoted when it beats the champion in 65% of them and every habit in 85% (one that beats the champion in fewer than half begins again from the champion's weights). Champion 1 came at generation 5: the plain weights 11/16, always advancing 15/16, the scripted staff 14/16, digging in 15/16, towns 16/16, the route 16/16. Since then four trials have come out level with it (7, 9, 8, 8 of 16) while still beating every habit 15 or 16 times in 16: the weights have converged for this search, and what has paid since is the search itself (with champion 1's weights, the dozen plans and the refinement beat the first search by +34.6 a duel over 24 duels, 13 won and 7 lost).

**In the lab game** (`mind/trained.js`, `plannerWeights.js`): the sides nobody plays are led by it, with champion 1's weights, in the page only and unless `localStorage.setItem("oh:strategyNet", "0")`. A war's fronts then run a day at a time. On the largest frame (251 x 251 cells) a month costs about 17 s against 2.6 s for the scripted staff.

**Where the ladder stopped** (2026-10-15, 10:20): eight trials after champion 1 none beat it (7, 9, 8, 8, 9, 8, 9 and 3 of 16), and the generation-35 challenger, fought against it at length (`headtohead.mjs`, 40 duels), won 18 and lost 15 (+19.7 a duel, SE 13.8): close to it, not consistently better. The weights have converged for this search.

**Champion 1 with the search as shipped**, 40 fair duels each it never trained on (`runs/planner/eval-champion1-40.json`):

| against | margin a duel | won / lost |
|---|---|---|
| always advancing | +136.2 (SE 25.0) | 36 / 4 |
| the scripted staff | +126.8 (SE 16.3) | 37 / 3 |
| always digging in | +138.7 (SE 19.6) | 32 / 7 |
| every troop for a town | +197.4 (SE 18.2) | 40 / 0 |
| every troop down one route to the capital | +197.7 (SE 18.6) | 39 / 1 |

**Beyond the land battle**: an admiral (`runtime/naval/admiral.js`) chooses the postures of the fleets of countries nobody plays by fighting the period's war at sea out with each (blockading a coast nobody defends, keeping an outmatched fleet out of the battle it would lose), and an engineer (`runtime/fronts/engineer.js`) has an outmatched country build a fortified line behind its front, by the war room's own op, on its own ground. Both run where the staff that looks ahead leads. Air wings are not commanded: they support the nearest battle by themselves, and the staff weighs what they do.

## 1. The reward (as of 2026-10-14)

Everything is counted as things stand at the end of the war (`arena.mjs REWARD`):

| | weight |
|---|---|
| land taken: every **thousand square kilometres** of the other team's home ground its troops hold | +0.2 |
| land lost: every thousand km² of its own the other team holds | −0.3 |
| a town of the other team's whose ground it holds (one of 100,000 or more counts 1.5) | +4 |
| a town of its own the other team holds | −5 |
| the other team's capital, held | **+12** |
| its own capital, held by the other team | **−30** |
| the other team's losses, as a share of the strength it began with | +3 |
| its own losses | −4 |
| encompassing: the largest share of the other team's troops it had cut off at once, plus a quarter for each pocket of them that gave up | +2 |

- **Land is area, not regions.** The engine already moves the front a cell at a time, by troops walking over ground. The reward counts the cells of the other team's home ground that a team holds, each by the area it covers (`kmAt(row)²`). That is an absolute amount: the same ground is worth the same whichever country it is in and however large that country is.
  - The first league counted land as a share of the enemy's home ground, which made a small country's border strip worth as much as half of a great power.
  - Home ground is read by sovereignty, so ground lost stays "its own".
  - A region changing hands on the map counts for nothing by itself.
- **Cities count far more than ground.**
  - A town is worth as much as 20,000 km² of ground.
  - Taking a capital is worth 60,000 km².
  - Losing your own capital costs as much as losing 100,000 km², which is more than anything else in the table.
  - A city counts if its cell is held at the end, so a city taken and lost again counts for nothing.
- **What was measured before the weights were set**: the scripted staff's wars, and always advancing against it, over 60 wars. A team takes about 15,000 km² a war, and none at all in half of them. It takes about one town in two wars and a capital in about one war in two (the arena's countries are small).

## 2. A staff that orders every troop by itself

Files: `src/runtime/fronts/mind/troops.js`, the head in `net.js`, and `createTroopPolicy` in `policy.js`.

**What a troop may be told**, at each of the staff's looks (every ten days):

| order | what the troop does |
|---|---|
| hold | stays, and fights what comes |
| dig in | digs in where it stands |
| push | goes straight out into the other side's ground (what "advance" does for the whole line) |
| strike | goes at the weakest place in the other side's line near it, and through it |
| go round | goes past the flank of the nearest mass of the other side's troops and in behind it. Troops either side of the same mass go round opposite flanks, which closes a ring |
| take a city | goes for the nearest city the other side holds |
| take a capital | goes for the nearest capital the other side holds, its own or one it took |
| guard a city | goes to the city of the side's own that is most in danger near it |
| shore up | goes to where the side's own line is weakest near it |

**The places a troop may be sent** are worked out once a look for the whole side. They are up to four weak places in the enemy line, two enemy masses, the cities, and four weak places in the side's own line. A place more than 250 km away is not a troop's to go for.

**What each troop is shown** (28 numbers):

- its strength, kind, supply, whether it is cut off or dug in, and how deep behind its own line it stands;
- the odds round it, its own troops round it and the other side's;
- for each place it could be sent: how far it is, and how strongly held it is (or how much in danger, for a city of its own);
- how far back it stands among its own troops, whether it is attacking now, and whether it stands at a city of its own.

**The network**: 2,162 weights in all.

- The side's recurrent network, as before, is shown the side as a whole (the 28 side numbers, own home ground lost included). It keeps the memory from one look to the next and says how the whole side leans (nine numbers).
- A **head** of 16 units, the same weights for every troop, is shown that troop's 28 numbers and the side's memory. It adds what that troop makes of each order to how the side leans. Each troop is given the order with the highest score among those it may be given.
- Troops sent to the same place go as one body: one order on the battlefield, at most twelve bodies at once.

**In the engine** (`engine.js orderTroopsByMind`, `MIND_MARK`):

- Nothing stands for a stretch of the side's line any more. Each body is an order for the troops picked out, marked `mind`.
- What the staff ordered last time is over when it looks again. A body sent on to where it was already going sets off without waiting.
- **A route the network draws never takes the war into a country outside it.** In the engine a hand-drawn route into a neutral country's land declares war on it. A test checks both sides of this: the same route without the mark brings the neutral country into the war, and with it nobody new is attacked.

## 3. What happened

### The troop-by-troop league (2026-10-14)

Settings: 120 minutes, 630 rounds, 3,480 networks (`runs/troops/log.jsonl`).

- **Opponents**: matches of five *contested* wars (two to one or closer: in more lopsided ones what is ordered hardly matters), each fought twice with the teams exchanged.
- **Gatekeepers**: the scripted staff, always advancing, going for the cities troop by troop, the first league's champion, and the league's own past champions.
- **Picking the champion**: every fifteen rounds the four networks with the longest runs of wins are tried on 24 contested wars kept aside. The champion is from round 285.

It was then tested on 150 wars nobody trained on, each fought twice with the teams exchanged (`runs/troops/evaluation.json`):

| the network against | margin a war | standard error | better / level / worse |
|---|---|---|---|
| the scripted staff | +47.1 | 8.4 | 92 / 0 / 58 |
| always advancing | **−3.0** | 4.8 | 85 / 0 / 65 |
| always holding | +160.6 | 6.8 | 150 / 0 / 0 |
| always digging in | +134.2 | 6.9 | 147 / 0 / 3 |
| going for the cities, troop by troop | +53.4 | 8.1 | 93 / 0 / 57 |
| the first league's champion (orders the whole side) | +3.8 | 5.1 | 77 / 0 / 73 |
| *(always advancing against the scripted staff)* | *+48.9* | *8.5* | *69 / 0 / 81* |

- Against always advancing, by the kind of war:
  - contested wars (85): −5.6, better in 47 and worse in 38;
  - lopsided wars (65): +0.4.
- Against the scripted staff, nearly all of the margin is in wars that are about even (+143.6 a war over 47 wars). In lopsided ones it is +2 to +4.
- **What it told its troops**: push 72%, go round 16%, strike 8%, dig in 2%, take a city 1%, guard a city 1%; hold, take a capital and shore up almost never.
- It does not ignore cities: its margins come with more towns and capitals taken than the scripted staff takes, and fewer lost. But it gets them by pushing everywhere, as always advancing does, not by sending bodies at them. When the hand-written habit sends every troop that can go at a city, it does worse than pushing (−53 against the champion).

**Over the run**, its margin over always advancing in the trials moved between −22 and +28 on 24 wars, without a trend upward. The league found variations on pushing that are as good as pushing, and none that is better.

### On the Wars and Fronts Pt.2 engine (2026-10-14, evening)

The Pt.2 update changed what a war is in the engine (`docs/world-state.md`, "Wars and Fronts Pt.2"): a troop tires as it marches and fights and recovers at rest; each country fights by its own quality, technology, arms and unit mix; a war's levies come in over weeks along a mustering curve; seasons and weather slow, chill and ground aircraft; ground can be hard to cross; fortified lines must be broken through; air wings fight over the battlefield. The arena fights its wars with all of it on, drawing each country's figures, a unit mix, a mustering curve, a start month, now and then a band of hard ground or a fortified line, and air wings after 1914.

- **What a troop is shown** grew from 28 numbers to 34: its fatigue, the nearest standing enemy wall ahead (how far, how strong), the day's weather's pace, and who holds the sky over it.
- **Two more orders**: *rest* (fall back a little and recover) and *breach* (go at the nearest wall, siege first). Eleven in all.
- **The league**: 121 minutes, 212 rounds, 1,226 networks (`runs/pt2/log.jsonl`), the same gatekeepers as before less the earlier champions, whose shape no longer fits. The champion is from round 75; in the trials it was +28 over the scripted staff, −23 against always advancing and +87 over going for the cities, on 24 wars each, and no later trial came near it.

Tested on 150 wars nobody trained on, each fought twice with the teams exchanged (`runs/pt2/evaluation.json`):

| the network against | margin a war | standard error | better / level / worse |
|---|---|---|---|
| the scripted staff | +12.8 | 5.2 | 88 / 1 / 61 |
| always advancing | **−14.5** | 4.9 | 59 / 1 / 90 |
| always holding | +165.8 | 6.3 | 150 / 0 / 0 |
| always digging in | +183.8 | 6.9 | 150 / 0 / 0 |
| going for the cities, troop by troop | +33.5 | 6.2 | 108 / 1 / 41 |
| the first league's champion (orders the whole side) | −13.0 | 4.6 | 58 / 1 / 91 |
| *(always advancing against the scripted staff)* | *+29.5* | *7.0* | *97 / 0 / 53* |

- **What it told its troops**: push 98%, dig in 1%, strike 1%; rest and breach never. It learnt to push, as the others did, and pushes a little worse than the plain habit.
- **What Pt.2 changed**: always advancing still wins, but by less. Its margin over the scripted staff fell from +48.9 a war on the old engine to +29.5 on this one: tired troops, walls and weather do cost an attacker who pushes everywhere, just not enough for any other plan the league found to pay more.
- Not shipped: it is not level with always advancing, which was the bar.
- Its wars were fought under the first weather odds, in which a polar winter was clear one spell in twenty; clear skies were made the likeliest weather of every season after the run, so a war now sees fewer days of mud, snow and storm than the league's did.

### The first league (2026-10-13), ordering the whole side

The first league ran under the older reward: shares of the enemy's home ground, towns weighed by share, a capital counting three. Its runs (`runs/first`, `runs/lean`, `runs/league`) cannot be re-run with the arena as it now is.

- 40 minutes, 237 rounds.
- Its champion said "advance" 94% of the time.
- On 150 unseen wars it was +1.84 a war over the scripted staff (standard error 0.31) and −0.27 against always advancing (0.20).
- An evolution strategy before it collapsed to exactly "always advance".

## 4. What it shows, and what it does not

1. **Neither network learned a strategy better than attacking everywhere.**
   - That holds for both answer sets: four words for the whole line, and nine orders troop by troop, with routes, flanking moves and city objectives.
   - It holds for both training methods: an evolution strategy, and a self-play league in which the winner advances.
   - It holds for both rewards.
   - A "strategic master" is not what came out.
2. **In this engine attacking everywhere is as good as any plan found, and standing still is far worse even when weaker.**
   - Always holding lost every one of 150 wars to the champion, and always digging in 147.
   - The arena's wars are four to six months long. Holding and digging in protect no ground and take none, and the engine gives a defender too little for it.
   - Pulling troops off the line to strike, go round or make for a city leaves gaps, and the enemy's straight push goes through them. That is why the hand-written strike habit does far worse than pushing.
   - That is a fact about the game's front engine more than about the networks. A staff can only be as clever as the engine lets cleverness pay.
3. **The scripted staff is the weak link in the game as it is.** Both networks and the plain habit beat it by the same margin, almost all of it in even wars. In those wars it holds, its enemy attacks, and it loses ground, towns and capitals it need not. Making the scripted staff attack at even odds (a few constants in `staff.js`) would capture nearly all of what the networks gain, with no network at all. Nobody has asked for that and it has not been done.
4. **What might let a strategy pay**, if this is taken further:
   - give dug-in troops and cities a real defensive edge, so that holding a city line against a stronger enemy can work;
   - make a failed attack cost the attacker more than it does now;
   - longer wars, with supply that runs out for a side that over-extends;
   - targets that matter beyond their ground (a capital lost should collapse a side's supply or its will to fight);
   - routes found over the ground (the network's routes are straight lines, and walls stop them).

   Then train again. With the engine as it is, more training of the same kind is unlikely to find more: 120 minutes and 3,480 networks did not move the margin over always advancing.

## Trying it in a game

On the Wars and Fronts Pt.2 branch no network is shipped (`src/runtime/fronts/mind/weights.js` holds none), so the lab's switch leads the sides nobody plays with the staff that looks ahead (section 0), with the champion's weights (`plannerWeights.js`). There it is ON in the game's page unless turned off: `localStorage.setItem("oh:strategyNet", "0")`. What follows is of `experiment/strategy-nn`, where the troop-by-troop champion is shipped (`src/runtime/fronts/mind/weights.js`) behind a switch that is off. In that lab build, in the browser's console:

```js
localStorage.setItem("oh:strategyNet", "1")   // on: sides nobody plays are led by the network, troop by troop
localStorage.removeItem("oh:strategyNet")     // off: the engine's scripted staff, as ever
```

- There is no setting for it, and no scenario can ask for it.
- With it on, expect countries nobody plays to attack nearly everywhere, with some troops going round the flanks of the enemy's masses.
- A side a person plays is never led by it. An order the story gave a side still stands for 45 days, as with the scripted staff.
- Its bodies of troops are orders for troops picked out, as a player's routes are. A war room that can see an enemy's plans would show them as routes.
- Its routes are straight lines. On a real map they may be stopped by sea or mountains; an order that stops getting nearer is dropped when the turn is saved, and the staff orders afresh ten days later.
- Nothing of it has been tried in a running game in the browser. It has been run only in the engine, by the tests and the arena.

## Running it

```bash
node tools/strategy-nn/peek.mjs 1 8                                     # a look at eight wars
node tools/strategy-nn/league.mjs --name troops --minutes 120 --workers 12
node tools/strategy-nn/league.mjs --name side --kind side --minutes 40  # the kind that orders the whole side
node tools/strategy-nn/evaluate.mjs --name troops --wars 150 --workers 12
node tools/strategy-nn/league.mjs --name pt2 --minutes 120 --workers 10 --trial 15   # the Pt.2 run
node tools/strategy-nn/evaluate.mjs --name pt2 --wars 150 --workers 12
node tools/strategy-nn/export.mjs --name troops                         # ship a champion behind the switch
node tools/strategy-nn/export.mjs --none                                # take it out again
node --test src/runtime/fronts/mind/mind.test.js
```

- A war takes 0.5 to 2 seconds. A round of the league takes about ten seconds on twelve workers.
