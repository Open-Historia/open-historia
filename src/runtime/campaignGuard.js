/*! Open Historia — campaign write guard © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
// A turn reads a campaign's whole state when it starts, spends minutes in the
// model, and writes it back at the end — through the runtime endpoints, which
// switching campaigns in the library has already repointed at the new save. So a
// turn that outlives the switch lands on whichever campaign is open when it
// finishes, overwriting it.
//
// Reported 2026-09-04: a Modern Day jump was still generating when the player
// opened a 1911 campaign, and six months of 2016 — clock, world, events, chats,
// colours — were written over it. The 1911 campaign's own progress was gone, and
// the campaign that generated the turn was left at its starting state.
//
// The rule is one comparison, kept here rather than inline so it can be tested
// without loading the simulation: stamp the campaign a turn belongs to when its
// state is read, and refuse to write if that is no longer the campaign in front
// of the player. Refusing costs the player the generation; writing costs them a
// campaign.
//
// An unknown id on either side (no library state yet, a headless caller) means
// "cannot tell", and a guard that cannot tell must not block an ordinary turn.

const clean = (value) => String(value ?? "").trim();

export const campaignChanged = (startedIn, current) => {
  const from = clean(startedIn);
  const to = clean(current);
  return Boolean(from) && Boolean(to) && from !== to;
};

export const campaignSwitchMessage = (startedIn, current, what = "turn") =>
  `This ${what} was generated for the campaign "${clean(startedIn)}", but "${clean(current)}" is open now, `
  + "so nothing was written. Switching campaigns while a turn is generating would otherwise overwrite the "
  + "campaign you switched to. Finish or cancel a turn before switching.";

// Throws when the campaign has changed, and is a no-op otherwise.
export const assertCampaignUnchanged = (startedIn, current, what = "turn") => {
  if (!campaignChanged(startedIn, current)) return;
  const error = new Error(campaignSwitchMessage(startedIn, current, what));
  error.campaignSwitched = true;
  throw error;
};
