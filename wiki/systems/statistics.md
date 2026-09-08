Every country has a **stat sheet** — leader, government, stability, six strategic indices,
population and a set of economic figures. Open it from the **Stats** tab of the advisor drawer
(**🧭**, right edge).

It retargets to **whatever country you last clicked on the map**, so it works as a dossier on
anyone, not just yourself.

![A country stat sheet](/wiki/img/statistics-sheet.jpg)
*Poland's sheet. Note the intelligence service at 40 — the default for a country nobody has assessed.*

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

<p class="beta-note"><b>Beta channel only.</b> Everything in this section is beta. On the stable
release the sheet is a snapshot generated when you ask for one, with no history, no charts and
no diplomacy block.</p>

The beta channel turns the stat sheet from a snapshot into a record, and splits it into two
tabs — **🤝 Diplomacy** and **📈 Economy**. Everything on the stable sheet is under Economy;
Diplomacy is entirely new.

### Tracked history

The sheet re-generates itself as the campaign runs, so you can watch a country's debt climb or
its energy autonomy recover across a decade instead of re-reading a number.

| | |
|---|---|
| **Refresh interval** | Manual only, or every **3, 6, 12 or 24 months** of game time |
| **Countries tracked at once** | **8** |
| **History kept** | Up to **1200** samples |

Your own country is always included once an interval is set. Everything else you add yourself
from the tracked-countries list; there is a **✕** on each to stop tracking it again.

### Advanced Statistics

Once there is history to draw, **Advanced statistics** at the foot of the Economy tab opens a
full-screen chart over it. Pick a metric and it plots every snapshot taken, dated in game time:

| Group | Metrics |
|---|---|
| **Headline economy** | GDP · GDP per capita · Population |
| **Economic conditions** | GDP growth · Inflation · Unemployment · Public debt · Budget balance |
| **Strategic indices** | National stability, and all six indices above |
| **GDP sectors** | Agriculture · Industry · Services, as a share of GDP |

![Advanced statistics](/wiki/img/stats-advanced.jpg)
*Six years of British GDP, with the 2020 collapse and the rebound. The range buttons narrow it to
the last year, five or ten.*

You can put up to **four** metrics on one chart, as long as they share a scale — tick a metric on
a different scale and the chart switches to it rather than drawing a meaningless second axis. The
range buttons across the top limit it to the last **1, 5 or 10 years** of game time.

Money is charted in a **2026-EUR equivalent** so that countries with different currencies can be
compared on one axis. Ancient scenarios chart correctly too — BC dates run backwards through the
missing year zero, so a campaign starting in 218 BC plots in the right order.

### The diplomacy block

Every sheet now carries a **🤝 Diplomacy** section, which is where beta's
[relation ledgers](/wiki/war/) actually become visible. Three counts across the top — relations,
active agreements, conflicts — and then the detail:

**Bilateral relations.** Every tracked relationship this country has, scored **−100 to +100**,
each with a one-line summary, a meter, and a badge the game derives from the score — friendly,
cordial, cautious, hostile. This is the single most useful screen in the game for working out
who someone's real friends are before you approach them.

![Bilateral relations on the stat sheet](/wiki/img/stats-diplomacy.jpg)
*The United Kingdom's relations, sorted best to worst. The summary line is why the number is
what it is.*

**Formal agreements** and **current conflicts** follow underneath: the treaty register with each
agreement's type, parties, status and the date it last changed, and then who this country is
currently fighting, taken from the war ledger.

![The treaty register](/wiki/img/stats-agreements.jpg)
*Agreements are listed active first. A suspended treaty stays on the register rather than
disappearing — the relationship still has a history.*

An empty list means no record exists, which is **not** the same as neutrality — a pair of
countries that have never interacted simply has nothing written down yet.

### Also on beta

**Countries with overseas territories** get a per-capita figure twice: for the core and
integrated territory, and for the **whole polity** including dependencies. The two can differ
sharply, and the sheet shows both rather than picking one.

**Landless polities work.** A government-in-exile, a rebel movement or an organisation with no
mapped territory used to fail to produce a sheet at all. They now get a valid one.

## Next

- [Countries and identity](/wiki/countries/) — reputation, tags and leaders.
- [The advisor](/wiki/advisor/) — asking someone to interpret all this for you.
- [Espionage](/wiki/espionage/) — the intelligence rating in practice.
