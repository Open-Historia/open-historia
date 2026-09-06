Every country has a **stat sheet** — leader, government, stability, six strategic indices,
population and a set of economic figures. Open it from the **Stats** tab of the advisor drawer
(**🧭**, right edge).

It retargets to **whatever country you last clicked on the map**, so it works as a dossier on
anyone, not just yourself.

## National stability

A single 0–100 figure for how firmly the government holds the country together, with a colour
band:

| Stability | |
|---|---|
| 70–100 | Green — solid |
| 40–69 | Amber — strained |
| Below 40 | Red — in trouble |

Stability is the number to watch when you are pushing your own country hard. Wars, austerity,
purges and humiliations all cost it, and a country in the red is one where events start
happening *to* the government rather than because of it.

## Strategic indices

Six measures, each 0–100:

| | Index | What it measures |
|---|---|---|
| ⚑ | **Sovereignty** | How much the country actually decides for itself |
| 🌾 | **Food autonomy** | Whether it can feed itself |
| ⚡ | **Energy autonomy** | Whether it can power itself |
| 🏦 | **Economic independence** | How far it is at the mercy of others economically |
| 🛡 | **Internal security** | Control over its own territory and population |
| 🤝 | **International reputation** | How far it is trusted abroad |

These are the strategic picture in six numbers. A country with high GDP and low food and energy
autonomy is rich and vulnerable; one with high internal security and low sovereignty is a
well-run client state.

**International reputation** is not just a display value — it is a real world field that other
countries respond to. See [countries and identity](/wiki/countries/).

## Intelligence service

A separate 0–100 rating for the country's intelligence apparatus, shown on the same sheet. It is
never written by the model as part of the economic figures — it moves only for concrete reasons
such as a purge, a defection, a new bureau, or a spy ring being exposed.

It is the governing statistic for [espionage](/wiki/espionage/), and worth raising deliberately
before you start relying on agents.

## Population and economy

| Field | |
|---|---|
| **Population** | Total population |
| **GDP** | With growth rate shown beneath |
| **GDP per capita** | With the country's currency |
| **Inflation** | |
| **Unemployment** | |
| **Public debt** | |
| **Budget balance** | Surplus or deficit |

Plus a **GDP breakdown** bar splitting output between **agriculture**, **industry** and
**services**, validated to add up to 100.

Large numbers are displayed compactly — 30,000,000,000 shows as 30.0B — with the currency symbol
preserved.

## There is no treasury

This is the important thing to understand about economics in Open Historia: **the economy is a
description, not a bank account.**

There is no pot of money you spend, no per-turn income to allocate, and no build costs to pay.
GDP, debt and budget balance describe your country's situation and inform how the world treats
your decisions — a country with 140% public debt and a deficit will find an expensive
rearmament programme going badly — but you never "afford" anything by clicking.

You change the economy the way a government does: by ordering policy and living with the
consequences. See [giving orders](/wiki/orders/).

## Where the numbers come from

Stat sheets are generated on demand for the country you are looking at, from the actual world
state, and cached so that reopening the panel does not regenerate them. There is a **↻** control
to force a fresh one.

They then move through events. When a turn changes a country's circumstances, the event carries
the statistical change with it — and only the fields that actually changed, so everything else
keeps its previous value.

That includes **who leads**: a leader overthrown in an event has their successor written to the
sheet in the same breath.

## Reading someone else's

Click any country, open Stats. You get the same sheet for them.

Two caveats. What you see is the world's view of that country, not privileged information — for
that you need [espionage](/wiki/espionage/). And generating a sheet for a country you are
interested in is itself the trigger that gets them an intelligence rating assessed, if they did
not have one.

## The beta version

<p class="beta-note"><b>Beta channel only.</b> The stable release generates a sheet when you ask
for one.</p>

The beta channel adds persistent, tracked statistics: sheets stored per country over time,
automatic refresh on an interval you choose, up to eight countries tracked simultaneously, and a
history you can chart. That turns the stat sheet from a snapshot into a time series.

## Next

- [Countries and identity](/wiki/countries/) — reputation, tags and leaders.
- [The advisor](/wiki/advisor/) — asking someone to interpret all this for you.
- [Espionage](/wiki/espionage/) — the intelligence rating in practice.
