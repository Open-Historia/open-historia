import { foldName, isPendingAction } from "./regionFocus.js";

const clean = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

const ANNEX_ORDER = /\b(annex\w*|incorporat\w*)\b/i;
const ANNEX_DONE = /\b(annexe[sd]|annexing|formally annexe[sd]|completes? the annexation|annexation (?:of [^.!?]{0,80})?(?:is|was) (?:complete|completed|finali[sz]ed|formali[sz]ed|proclaimed)|incorporate[sd] into|(?:is|was|are|were) incorporated)\b/i;
const NOT_DONE = /\b(plan\w*|propos\w*|threat\w*|refus\w*|reject\w*|fail\w*|block\w*|delay\w*|postpon\w*|consider\w*|demand\w*|seek\w*|attempt\w*|calls? for|vote on|would|could|might|will|intend\w*|prepar\w*|halt\w*|suspend\w*|abandon\w*|condemn\w*|protest\w*|not|never|no longer)\b/i;

const sentencesOf = (text) => clean(text).split(/(?<=[.!?;])\s+/).filter(Boolean);
export const narratesAnnexation = (event) => sentencesOf(`${clean(event?.title)}. ${clean(event?.description)}`)
  .some((sentence) => ANNEX_DONE.test(sentence) && !NOT_DONE.test(sentence));

export const orderedAnnexations = ({ events = [], actions = [], playerCountry = "", regions = [], ownerOf = () => "", polities = [] } = {}) => {
  const player = clean(playerCountry);
  if (!player) return [];
  const orders = new Map(list(actions)
    .filter((action) => isPendingAction(action) && clean(action?.id))
    .map((action) => [clean(action.id), [action.title, action.description, action.rawInput, action.text].filter(Boolean).join(" ")])
    .filter(([, text]) => ANNEX_ORDER.test(text)));
  if (orders.size === 0) return [];
  const byName = new Map();
  for (const region of list(regions)) {
    const name = foldName(region?.name);
    if (name.length < 4) continue;
    const ids = byName.get(name) ?? [];
    ids.push(region);
    byName.set(name, ids);
  }
  const playerKey = foldName(player);
  const out = [];
  list(events).forEach((event, index) => {
    const impacts = event?.impacts && typeof event.impacts === "object" ? event.impacts : {};
    if (list(impacts.regionTransfers).length || list(impacts.regionControlOps).length) return;
    const ordered = list(impacts.actionIds).map(clean).filter((id) => orders.has(id));
    if (!ordered.length || !narratesAnnexation(event)) return;
    const transfers = [];
    for (const id of ordered) {
      const text = ` ${foldName(orders.get(id))} `;
      const named = [...byName.entries()].filter(([name]) => text.includes(` ${name} `)).map(([, matches]) => matches);
      const regionsNamed = named.filter((matches) => matches.length === 1).map(([region]) => region);
      for (const region of regionsNamed) {
        const owner = clean(ownerOf(region.id));
        if (!owner || foldName(owner) === playerKey || transfers.some((entry) => entry.regionId === clean(region.id))) continue;
        transfers.push({ regionId: clean(region.id), regionName: clean(region.name) || clean(region.id), fromCode: owner, toCode: player, basis: "annexation", note: "The player's order to annex it, which this event carries out." });
      }
      if (regionsNamed.length || named.length) continue;
      for (const polity of list(polities).map(clean).filter(Boolean)) {
        const key = foldName(polity);
        if (!key || key === playerKey || !text.includes(` ${key} `) || transfers.some((entry) => entry.fromCode === polity && entry.wholeCountry)) continue;
        transfers.push({ regionId: `country: ${polity}`, regionName: polity, fromCode: polity, toCode: player, wholeCountry: true, basis: "annexation", note: "The player's order to annex it, which this event carries out." });
      }
    }
    if (transfers.length) out.push({ index, transfers });
  });
  return out;
};

export const hasAnnexOrders = (actions) => list(actions).some((action) => isPendingAction(action) && ANNEX_ORDER.test([action?.title, action?.description, action?.rawInput, action?.text].filter(Boolean).join(" ")));
