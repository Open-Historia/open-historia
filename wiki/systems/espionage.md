Espionage runs in both directions. You plant agents in other countries and read their private
diplomacy; other countries plant agents in you and read yours. It is the most mechanically
explicit system in the game — the rolls are real numbers, and they are deterministic.

Find it in the **💬 Chat** panel, **Spy** tab.

![The Spy tab](/wiki/img/espionage-spy-tab.jpg)
*The Spy tab before anything is deployed — your service rating, and the three slots you have to spend.*

## Intelligence rating

Every country has an intelligence rating from **0 to 100**. It is the single number that decides
how good its service is at everything below: planting agents, catching yours, turning the ones
it catches, noticing when its own have been turned, and reading intercepted traffic.

The default is **40** — deliberately "ordinary", not "none". A country with no rating yet gets
one assessed the first time it matters: when you open its stats, send an agent there, read an
intercept from it, or have an agent caught by it.

Your own rating is on the **Stats** tab of the advisor drawer. Raising it is a matter of
governing that way — order intelligence expansion, fund the service, make it a priority — and
it moves like any other national statistic.

## Limits

| | |
|---|---|
| Agents you can have active | **3** |
| Foreign agents inside you at once | **3** |
| Agents per target country | **1** |
| Spying on yourself | Not possible |

Three is not many. Choosing where those three go is most of the strategy.

## Sending an agent

From the **Spy** tab, deploy to a target country. You can also just write it as an order —
*"deploy a spy in Germany"* — and the next time skip executes it through exactly the same rules
and caps.

An active agent reports: it feeds you the target's private diplomatic traffic, subject to how
much of it you can actually read.

You can give an agent a **cover story**, **recall** it at any time, and see everything it has
sent.

![An agent in the field](/wiki/img/espionage-active-agent.jpg)
*An agent in Germany. Both services are shown, because the gap between them is what the detection roll turns on.*

## Getting caught

Every jump, each of your agents is rolled against the target's service.

The chance of detection is driven mostly by the **gap** between the two services:

```
detection = 0.04 + (target/100 − yours/100) × 0.25 + (target/100) × 0.10
            clamped to between 2% and 60%
```

Read that as: a service much better than yours will find your agent quickly; a service much
worse will mostly not. But there is a floor of 2% — a brilliant agent in an incompetent country
is never perfectly safe — and a ceiling of 60%, so even a hopeless agent is not guaranteed to be
caught on day one.

Some worked numbers, per jump:

| Your service | Their service | Chance your agent is caught |
|---|---|---|
| 40 | 40 | 8% |
| 40 | 80 | 22% |
| 80 | 20 | 2% (the floor) |

## Caught, then what

A caught agent becomes **discovered** and stops reporting. The target then either **turns** it
or **expels** it:

```
turn chance = (target intelligence / 100) × 0.6
              clamped to between 5% and 60%
```

Turning takes skill. An ordinary service mostly just throws your agent out; a very good one
keeps it.

### The turned agent

This is the part worth understanding properly.

**You are never told that your agent has been turned.** From your side it looks like it is still
reporting. What it is actually sending is material the target wrote for you.

Each jump, your own service gets a chance to notice:

```
suspicion = 0.05 + (yours/100 − target/100) × 0.3
            clamped to between 2% and 50%
```

So a service better than the one that turned your agent will usually spot it eventually. A
service much worse may never.

The game itself always knows — reports produced while an agent was turned are permanently marked
as planted — but that mark is not shown to you. It exists so that the consequences are consistent
later.

The practical lesson: **intelligence you cannot corroborate is not intelligence.** If a single
agent is telling you something convenient, and your service is weaker than theirs, consider that
you may be reading fiction written for you.

## Being spied on

Other countries plant agents in you, on their own initiative, every jump:

```
deploy chance = (their intelligence / 100) × 0.12 + hostility × 0.2
                capped at 40%
```

A capable service does it as a matter of course. A hostile one goes looking. At most three
foreign agents can be inside you at once.

When you catch one, it appears in the Spy tab and **waits for your decision**:

- **Expel** it. Clean, final, and it tells the other country you found them.
- **Turn** it. It becomes a double agent, and from then on *you* write what it reports home.
  The country that sent it is not told.

Turning is the more interesting option and the more useful one, but it requires you to keep
feeding it plausible material.

## Reading intercepts

You rarely get a clean transcript. How much of an intercepted message you can read depends on
both services:

```
clarity = 0.12 + (yours/100) × 0.88 − (theirs/100) × 0.35
          clamped to between 6% and 100%
```

Unreadable words are blanked out, but punctuation and sentence rhythm survive, so you can often
tell the shape of what was said even when you cannot read it. Raising your intelligence rating
only ever reveals *more* of a message you have already seen — it never re-hides anything.

| Your service | Their service | How much you can read |
|---|---|---|
| 40 | 40 | 33% |
| 80 | 40 | 68% |
| 20 | 80 | 6% (the floor — essentially nothing) |

Intercepts are stored separately from the rest of your save and **encrypted at rest** with a key
unique to your campaign. They are decrypted only to show you and to inform the simulation.

## Agents report in real time

Agents do not only report at a time skip. While the game is open and the tab is visible, each
deployed agent is rolled roughly once a minute, working out to about **one report every twenty
minutes per agent**. They also report after every jump.

This is deliberate and it is why there is no "gather intelligence" button: an agent is a trickle
of information you receive over time, not a resource to farm on demand. Leaving the game open
during a tense period genuinely gets you more.

## Playing it well

- **Raise the rating before you rely on the service.** At 40 you can barely read what you steal
  and you are caught reasonably often. Intelligence capability is worth ordering as a programme.
- **Three agents means three priorities.** Put them where a surprise would actually hurt you.
- **Recall an agent that has done its job.** Every jump it stays is another detection roll.
- **Turn the agents you catch** rather than expelling them, if you can afford the attention.
- **Distrust a lone source**, especially against a stronger service.

## Next

- [Diplomacy](/wiki/diplomacy/) — the conversations your agents are reading.
- [National statistics](/wiki/statistics/) — where the intelligence rating lives.
- [Projects and operations](/wiki/projects/) — running covert work as a long programme (beta).
