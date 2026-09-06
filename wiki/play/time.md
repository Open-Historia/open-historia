Open Historia has no tick. There is no clock running in the background, nothing accumulates
while you think, and no timer forces your hand. The world advances **only** when you press the
button, and only as far as you tell it to.

Open the time panel with **»** on the date pill, top right.

## Fixed jumps
![The time skip panel](/wiki/img/time-skip-panel.jpg)
*Each preset shows the date you will land on.*


| Jump | Days |
|---|---|
| 6 hours | 0.25 |
| 1 day | 1 |
| 3 days | 3 |
| 1 week | 7 |
| 1 month | 30 |
| 3 months | 90 |
| 6 months | 180 |
| 1 year | 365 |

Each one shows the date you will land on, so you can see what you are committing to.

Note that a "month" is a flat 30 days and a "year" is 365 — the game does not track calendar
month lengths for jump sizing.

## Custom jumps

Type an amount and pick a unit: **hours, days, weeks, months** or **years**. The conversions are
the same flat ones — an hour is 1/24 of a day, a week is 7, a month is 30, a year is 365.

Useful when you want to land on a specific date, or when a fixed preset is slightly wrong for
what is happening.

## Auto-jump

Instead of choosing a distance, let the model choose it. Auto-jump looks at the state of the
world and skips to the next moment it thinks you would want to be present for — which might be
three days if a crisis is breaking, or eight months if nothing is happening.

Good for quiet stretches. Less good when you have something specific in motion that you want to
watch closely.

## How far should I skip?

The world has to fit everything that happens into one turn's worth of events. Skip a year and
twelve months get compressed into a handful of paragraphs; skip a week and you get the texture.

- **Something is actively unfolding** — a war opening, an ultimatum running out, a coup —
  6 hours to 3 days.
- **Normal play** — 1 week to 1 month. This is where most campaigns live.
- **Building toward something** — 3 to 6 months.
- **Nothing needs you** — 1 year, or auto-jump.

A common early mistake is skipping a year on turn one and wondering why the campaign feels
thin. Start with months.

## While it runs

A time skip takes a while — the model is simulating the world. The panel shows it working, and
there is a **Cancel** button. Cancelling aborts the request cleanly and leaves the world exactly
as it was.

If jumps routinely hang, turn on **Limit AI generation** in Settings → AI. It gives up on a
stalled generation and falls back to a canned event rather than waiting indefinitely. It watches
for *silence* rather than total elapsed time, so a slow-but-working model is not cut off
mid-answer.

## Undo

**↩ Undo last turn** is in the time panel, and it tells you how many turns can be undone.

Undo restores the world, the game state, the events, your action queue, the chat history and the
colours to exactly how they were before that jump. The game keeps up to **12** turns of
snapshots, so you can step back repeatedly.

Use it freely. A time skip is partly a roll of the dice, and rewinding a turn that produced
something absurd is how the game is meant to be played, not a workaround.

For jumping back further than the recent stack, the [cheats panel](/wiki/cheats/) has a
**roll back turn** tool that restores the start of any earlier turn — discarding everything
after it.

## Rounds and dates

Every jump increments the **round** counter, which starts at 1. The round is what the game uses
internally to seed deterministic outcomes such as espionage rolls and combat, which is why the
same save always replays the same way.

The date is stored as plain text, so scenarios can use non-Gregorian dates such as "1200 BCE"
without the clock breaking. Loosely formatted dates get repaired rather than rejected.

## The first turn is special

On round 1, a scenario that has a *World Before Round One* briefing generates its own backstory
before play begins — the recent history that led to the situation you have inherited. It happens
once, and it gives the world something to refer back to.

## Next

- [Events and history](/wiki/events/) — reading what a jump produced.
- [Giving orders](/wiki/orders/) — what to queue before you jump.
- [Saves and rollback](/wiki/saves/) — how snapshots and autosave actually work.
