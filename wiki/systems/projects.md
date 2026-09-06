Some things a country does cannot happen in one turn. A nuclear programme, a canal, a rearmament
plan, a decade-long insurgency, a covert operation to destabilise a neighbour — these are
*efforts*, not actions, and the beta channel gives them their own board.

Open it from the toolbar alongside Chat and Actions.

This is also where research and technology live. There is no tech tree; there is a research
programme with milestones that either progresses or stalls.

## Projects and operations

Two kinds:

- **Projects** — construction, research, industrial and political programmes. Building
  something, generally.
- **Operations** — military and covert undertakings. Doing something to someone, generally.

Each carries a status:

| Status | |
|---|---|
| `proposed` | Suggested, not yet under way |
| `active` | Running |
| `stalled` | Running, but not moving |
| `paused` | Deliberately halted |
| `complete` | Finished successfully |
| `failed` | Finished unsuccessfully |
| `cancelled` | Abandoned |

The first four are **open** and appear on the default board. The last three are closed and live
behind a separate view.

## Secrecy

| | |
|---|---|
| `public` | Everyone can see it |
| 🔒 `restricted` | Known, but not openly |
| 🕵 `covert` | Hidden |

A covert operation you can see on your own board is not visible to the country it targets —
unless their intelligence service finds it.

## Milestones

A project carries up to **8 milestones**, each dated and either pending, done or missed. The
next pending one is what the board shows you as the thing to watch.

Milestones can **repeat** — weekly, monthly, quarterly, annual or biennial. Marking a repeating
milestone done advances it by one interval from *its own* date, so an annual exercise on 1 June
stays on 1 June rather than drifting. A missed occurrence is deliberately **not** rolled
forward: it stays pending and is flagged as missed, because a drill you skipped is a fact about
your country, not a scheduling inconvenience.

A project marked **ongoing** is a standing effort with no planned end. It has no target date and
can never be overdue.

## What you actually control

Two things, and this is deliberate:

**Priority.** `high`, `normal` or `low`. High means the advisor briefs it first and the
simulation is told to keep it moving. Low means it is allowed to drift.

**Abandoning it.** Which routes through cancellation — the project stays on the board under
**Closed**, with the progress it actually reached.

You do **not** author a project's content. Projects are written *by* the world — by events, by
your intelligence service, and by the advisor — in response to what your country is doing. You
steer them; you do not type them into existence.

Closing keeps the record. Completing marks pending milestones done and forces progress to 100%;
failing or cancelling marks them missed and preserves the real progress reached. Only an explicit
delete erases a project entirely.

## Completion has consequences

A project can carry changes that release **only on successful completion** — never on
cancellation, never on failure. This is how a five-year programme to build up your intelligence
service actually raises your rating: not gradually, but when it finishes.

It is also why abandoning a project at 90% gets you nothing except the record that you tried.

## Foreign projects, and whether to believe them

The board shows projects belonging to *other* countries too, when your intelligence tells you
about them. Those carry a **verification** state:

| Badge | Meaning |
|---|---|
| *(none)* | Learned openly; the ordinary case |
| **Doubtful** | The agent it came from is compromised |
| **Confirmed** | Corroborated by a clean source |
| **Fabricated** | Established as false |

The loop this creates is the best thing on the board. A [turned agent](/wiki/espionage/) feeds
you planted material. A foreign project opens on your board from it. Later, your
counter-intelligence realises that source was compromised, and the entry is stamped
**Doubtful** — the engine can raise the doubt but it cannot settle it.

The only way to resolve it is to get a **fresh** agent into that country and look again. Until
you do, you are planning against something that may not exist.

## Limits

| | |
|---|---|
| Projects | **120** |
| Milestones per project | **8** |
| Linked events per project | **12** |

The board warns you when you are within ten of the project limit. Past it, **finished work is
evicted first**, oldest by last update — your active programmes are never dropped to make room.

## Filtering

The board filters by owner (yours or foreign), free text, and tag chips, with several sort
orders and a separate **Closed** view. On a long campaign with a busy intelligence service you
will need them.

## On the stable release

None of this exists. Long-running efforts happen, but they live in the narrative and in your
own head — an event refers back to the programme you started six turns ago because the
[event history](/wiki/events/) remembers it, not because anything is tracking milestones.

If you want the board, install the beta build. It sits alongside the stable app and keeps its own
saves.

## Next

- [Espionage](/wiki/espionage/) — where the foreign entries and the doubt come from.
- [Giving orders](/wiki/orders/) — how efforts get started.
- [Relations, treaties and war](/wiki/war/) — the other half of the beta model.
