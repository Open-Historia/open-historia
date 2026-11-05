/*! Open Historia — institution membership presentation helpers. */

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const lower = (value) => clean(value).toLowerCase();
const humanize = (value) => clean(value).replace(/[-_]+/g, " ");

// Status answers "what kind of participant is this polity?" while role answers
// "what position does a full member hold?". A generic role of "member" must not
// hide a more specific canonical status such as observer or candidate.
export const institutionMembershipDisplayLabel = (member = {}) => {
  const status = lower(member?.status || "member");
  if (status && status !== "member") return humanize(status);

  const role = lower(member?.role || "member");
  return humanize(role || "member");
};
