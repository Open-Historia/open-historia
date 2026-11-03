/*! Open Historia - validated, scenario-owned national Statistics presentation grid.
 * Widgets contain ONLY presentation references; no numeric copies or native writers.
 */
export const STAT_DASHBOARD_COLUMNS = 6;
// A full native Details preset needs 31 cards with Overview; leave authoring headroom.
// This remains a bounded presentation-only schema, not a countryStats limit.
export const MAX_STAT_DASHBOARD_WIDGETS = 48;
// The normal Country Panel is around 345px: keep the six authored columns so
// three two-cell tiles remain a single strip. Only very narrow panels reflow.
export const dashboardColumnsForWidth = width => width >= 300 ? 6 : width >= 210 ? 3 : 2;
export const DASHBOARD_STYLES = Object.freeze(['value', 'bar', 'trend', 'heading', 'change', 'intelligence', 'breakdown', 'military']);
// System views are read-only projections owned by their existing engines,
// not writable native or custom countryStats fields.
export const DASHBOARD_SYSTEM_SOURCES = Object.freeze({
  intelligence: 'system:intelligence',
  breakdown: 'system:gdpBreakdown',
  military: 'system:military',
});
export const dashboardSystemStyle = (style) => Object.hasOwn(DASHBOARD_SYSTEM_SOURCES, style);
export const dashboardSystemSource = (style) => DASHBOARD_SYSTEM_SOURCES[style] || null;
// The Wars & Fronts military readout is mandatory presentation of native
// systems, never a custom Statistics ledger. Existing dashboards without this
// tile remain valid: Country Details supplies the same live readout separately.
export const isRequiredMilitaryWidget = (widget) =>
  widget?.style === 'military' && widget?.source === DASHBOARD_SYSTEM_SOURCES.military;
export const DASHBOARD_PAGES = Object.freeze(['overview', 'details']);
// Presentation accents are bounded identifiers, never arbitrary CSS values.
export const DASHBOARD_ACCENTS = Object.freeze(['auto', 'neutral', 'green', 'blue', 'amber', 'red']);
// Authoring uses discrete, legible card footprints; the schema still accepts
// older P4A dimensions non-destructively until their author edits that widget.
export const DASHBOARD_CARD_SIZES = Object.freeze({
  value: Object.freeze({ widths: Object.freeze([2, 3, 6]), heights: Object.freeze([1, 2]) }),
  bar: Object.freeze({ widths: Object.freeze([2, 3, 6]), heights: Object.freeze([1, 2]) }),
  trend: Object.freeze({ widths: Object.freeze([3, 6]), heights: Object.freeze([2, 3]) }),
  heading: Object.freeze({ widths: Object.freeze([6]), heights: Object.freeze([1]) }),
  change: Object.freeze({ widths: Object.freeze([6]), heights: Object.freeze([1]) }),
  intelligence: Object.freeze({ widths: Object.freeze([6]), heights: Object.freeze([1]) }),
  breakdown: Object.freeze({ widths: Object.freeze([6]), heights: Object.freeze([2]) }),
  military: Object.freeze({ widths: Object.freeze([6]), heights: Object.freeze([6]) }),
});
const stepAxis = (choices, oldSize, delta) => {
  if (!delta) return oldSize;
  const wanted = oldSize + delta;
  if (delta > 0) return choices.find((size) => size >= wanted) ?? choices[choices.length - 1];
  return [...choices].reverse().find((size) => size <= wanted) ?? choices[0];
};
export const snapDashboardWidgetSize = (widget, widthDelta = 0, heightDelta = 0) => {
  const sizes = DASHBOARD_CARD_SIZES[widget.style] || DASHBOARD_CARD_SIZES.value;
  return { w: stepAxis(sizes.widths, widget.w, widthDelta),
    h: stepAxis(sizes.heights, widget.h, heightDelta) };
};
const ID = /^[A-Za-z][A-Za-z0-9-]{0,39}$/;
const occupied = (a, b) => a.page === b.page && a.x < b.x + b.w && a.x + a.w > b.x
  && a.y < b.y + b.h && a.y + a.h > b.y;
export const canPlaceDashboardWidget = (widgets, widget, exceptId = widget.id) =>
  widget.x >= 0 && widget.y >= 0 && widget.y <= 40 && widget.w >= 1 && widget.h >= 1
  && widget.w <= STAT_DASHBOARD_COLUMNS && widget.h <= (widget.style === 'military' ? 6 : 4)
  && widget.x + widget.w <= STAT_DASHBOARD_COLUMNS && widget.y + widget.h <= 44
  && !widgets.some((other) => other.id !== exceptId && occupied(other, widget));

export const normalizeStatsDashboard = (input, { allowedSources } = {}) => {
  if (input === undefined || input === null) return null;
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1
    || !Array.isArray(input.widgets) || input.widgets.length > MAX_STAT_DASHBOARD_WIDGETS) {
    throw new Error('Invalid national Statistics dashboard schema.');
  }
  const widgets = [];
  const ids = new Set();
  for (const row of input.widgets) {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || typeof row.id !== 'string' || !ID.test(row.id) || ids.has(row.id)
      || typeof row.source !== 'string'
      || (row.style === 'heading' ? row.source !== '' : dashboardSystemStyle(row.style)
        ? row.source !== dashboardSystemSource(row.style) : !allowedSources?.has(row.source))
      || !DASHBOARD_STYLES.includes(row.style) || !DASHBOARD_PAGES.includes(row.page)
      || !['x', 'y', 'w', 'h'].every((key) => Number.isInteger(row[key]))) {
      throw new Error('Invalid national Statistics widget identity, source or coordinates.');
    }
    const widget = { id: row.id, source: row.source, style: row.style, page: row.page,
      x: row.x, y: row.y, w: row.w, h: row.h };
    if (widget.style === 'heading' && (widget.w !== 6 || widget.h !== 1
      || typeof row.label !== 'string' || !row.label.trim()))
      throw new Error('National Statistics section headings require a title and one complete grid row.');
    if (dashboardSystemStyle(widget.style) && (widget.w !== 6 ||
      widget.h !== DASHBOARD_CARD_SIZES[widget.style].heights[0]))
      throw new Error('System Statistics views require their defined footprint.');
    if (widget.style === 'change' && (widget.w !== 6 || widget.h !== 1))
      throw new Error('National Statistics change summaries require one complete grid row.');
    if (!canPlaceDashboardWidget(widgets, widget)) throw new Error('National Statistics widgets overlap or extend outside the grid.');
    if (row.accent !== undefined) {
      if (!DASHBOARD_ACCENTS.includes(row.accent)) throw new Error('Invalid national Statistics card accent.');
      if (row.accent !== 'auto') widget.accent = row.accent;
    }
    if (row.label !== undefined) {
      if (typeof row.label !== 'string' || row.label.trim() !== row.label || row.label.length > 60)
        throw new Error('Invalid national Statistics widget label.');
      if (row.label) widget.label = row.label;
    }
    ids.add(widget.id);
    widgets.push(widget);
  }
  return { version: 1, widgets };
};

// Compact into supported panel widths while preserving author-defined visual
// order and avoiding all overlaps. Responsive changes never mutate authored data.
export const projectDashboardGrid = (widgets, columns = STAT_DASHBOARD_COLUMNS, page = 'overview') => {
  if (![2, 3, 6].includes(columns)) throw new Error('Unsupported Statistics dashboard width.');
  // At full six-column capacity, author placement is already valid. Preserve
  // row breaks and headings, rather than compacting intentional composition.
  if (columns === STAT_DASHBOARD_COLUMNS) return widgets.filter(widget => widget.page === page)
    .map(widget => ({ ...widget }));
  const result = [];
  const ordered = widgets.filter((widget) => widget.page === page)
    .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  for (const item of ordered) {
    const w = Math.max(1, Math.min(columns, Math.round(item.w * columns / STAT_DASHBOARD_COLUMNS))), h = item.h;
    let found = null;
    for (let y = 0; y < 128 && !found; y++) {
      for (let x = 0; x <= columns - w; x++) {
        if (!result.some((entry) => entry.x < x + w && entry.x + entry.w > x
          && entry.y < y + h && entry.y + entry.h > y)) { found = { ...item, x, y, w, h }; break; }
      }
    }
    if (!found) throw new Error('Statistics dashboard responsive projection exceeded bounds.');
    result.push(found);
  }
  return result;
};

export const updateDashboardWidget = (dashboard, id, patch) => {
  const original = dashboard?.widgets?.find((widget) => widget.id === id);
  if (!original) return null;
  const next = { ...original, ...patch };
  // The editor is not the only caller of these layout mutation helpers. A
  // required Wars & Fronts view stays on Details even when an operation is
  // invoked programmatically; historic Overview layouts remain readable.
  if (isRequiredMilitaryWidget(original) && original.page === 'details'
    && next.page !== 'details') return null;
  if (dashboardSystemStyle(next.style)) {
    if (next.source !== dashboardSystemSource(next.style) || next.w !== 6
      || next.h !== DASHBOARD_CARD_SIZES[next.style].heights[0]) return null;
  } else if (dashboardSystemStyle(original.style) || original.source.startsWith('system:')
    || next.source.startsWith('system:')) return null;
  if (next.accent !== undefined && !DASHBOARD_ACCENTS.includes(next.accent)) return null;
  if (!canPlaceDashboardWidget(dashboard.widgets, next, id)) return null;
  return { ...dashboard, widgets: dashboard.widgets.map((row) => row.id === id ? next : row) };
};


// A pasted card is another view of an existing source, never another numeric ledger.
// Search near the selection first, then the rest of its tab deterministically.
export const insertDashboardWidget = (dashboard, original, page = undefined) => {
  if (!dashboard || !original || dashboard.widgets.length >= MAX_STAT_DASHBOARD_WIDGETS) return null;
  // A native military power module is a singleton system readout, not a
  // reusable numerical tile. Copy, paste, and duplicate share this helper.
  if (isRequiredMilitaryWidget(original)) return null;
  const targetPage = page || original.page;
  if (!DASHBOARD_PAGES.includes(targetPage)) return null;
  const taken = new Set(dashboard.widgets.map(widget => widget.id));
  let number = 1;
  while (taken.has(`tile${number}`)) number++;
  const id = `tile${number}`;
  const candidate = { ...original, id, page: targetPage };
  for (let offset = 0; offset <= 44; offset++) {
    const y = (original.y + offset) % 45;
    for (let step = 0; step <= STAT_DASHBOARD_COLUMNS - candidate.w; step++) {
      const x = (original.x + step + 1) % (STAT_DASHBOARD_COLUMNS - candidate.w + 1);
      const next = { ...candidate, x, y };
      if (canPlaceDashboardWidget(dashboard.widgets, next))
        return { dashboard: { ...dashboard, widgets: [...dashboard.widgets, next] }, id };
    }
  }
  return null;
};

export const duplicateDashboardWidget = (dashboard, sourceId, page) =>
  insertDashboardWidget(dashboard, dashboard?.widgets?.find(widget => widget.id === sourceId), page);

// Moving one card onto a same-footprint neighbor swaps their slots instead
// of forcing authors to clear space manually. No other layout is repacked.
export const placeDashboardWidget = (dashboard, id, patch) => {
  const original = dashboard?.widgets.find(widget => widget.id === id);
  if (!original) return null;
  const next = { ...original, ...patch };
  if (canPlaceDashboardWidget(dashboard.widgets, next, id))
    return updateDashboardWidget(dashboard, id, patch);
  if (next.w !== original.w || next.h !== original.h || next.page !== original.page) return null;
  const collisions = dashboard.widgets.filter(widget => widget.id !== id && occupied(widget, next));
  if (collisions.length !== 1) return null;
  const other = collisions[0];
  if (other.page !== next.page || other.w !== next.w || other.h !== next.h
    || other.x !== next.x || other.y !== next.y) return null;
  const swapped = { ...other, x: original.x, y: original.y };
  const remaining = dashboard.widgets.filter(widget => widget.id !== id && widget.id !== other.id);
  if (!canPlaceDashboardWidget(remaining, next) || !canPlaceDashboardWidget(remaining, swapped)) return null;
  return { ...dashboard, widgets: dashboard.widgets.map(widget =>
    widget.id === id ? next : widget.id === other.id ? swapped : widget) };
};

export const DEFAULT_NATIONAL_DASHBOARD = Object.freeze({ version: 1, widgets: Object.freeze([
  { id: 'gross-output', source: 'native:gdp', page: 'overview', style: 'trend', x: 0, y: 0, w: 6, h: 2 },
  { id: 'population', source: 'native:totalPopulation', page: 'overview', style: 'value', x: 0, y: 2, w: 2, h: 1 },
  { id: 'employment', source: 'native:unemployment', page: 'overview', style: 'value', x: 2, y: 2, w: 2, h: 1 },
  { id: 'debt', source: 'native:publicDebt', page: 'overview', style: 'value', x: 4, y: 2, w: 2, h: 1 },
  { id: 'condition-heading', source: '', page: 'overview', style: 'heading', label: 'National condition', x: 0, y: 3, w: 6, h: 1 },
  { id: 'stability', source: 'native:nationalStability', page: 'overview', style: 'bar', x: 0, y: 4, w: 6, h: 1 },
  { id: 'economic-autonomy', source: 'native:economicIndependence', page: 'overview', style: 'bar', x: 0, y: 5, w: 6, h: 1 },
  { id: 'food-autonomy', source: 'native:foodAutonomy', page: 'overview', style: 'bar', x: 0, y: 6, w: 6, h: 1 },
  { id: 'energy-autonomy', source: 'native:energyAutonomy', page: 'overview', style: 'bar', x: 0, y: 7, w: 6, h: 1 },
  { id: 'change-summary', source: 'native:gdp', page: 'overview', style: 'change', x: 0, y: 8, w: 6, h: 1 },
  // Details is the complete national readout, not a second miniature Economy tab.
  // Keep the 32-widget cap: eleven Overview cards and twenty-one Details cards.
  { id: 'd-stability', source: 'native:nationalStability', page: 'details', style: 'bar', x: 0, y: 0, w: 6, h: 1 },
  { id: 'd-intelligence', source: 'system:intelligence', page: 'details', style: 'intelligence', x: 0, y: 1, w: 6, h: 1 },
  { id: 'd-strategic', source: '', page: 'details', style: 'heading', label: 'Strategic indices', x: 0, y: 2, w: 6, h: 1 },
  { id: 'd-sovereignty', source: 'native:sovereignty', page: 'details', style: 'bar', x: 0, y: 3, w: 6, h: 1 },
  { id: 'd-food', source: 'native:foodAutonomy', page: 'details', style: 'bar', x: 0, y: 4, w: 6, h: 1 },
  { id: 'd-energy', source: 'native:energyAutonomy', page: 'details', style: 'bar', x: 0, y: 5, w: 6, h: 1 },
  { id: 'd-economic-independence', source: 'native:economicIndependence', page: 'details', style: 'bar', x: 0, y: 6, w: 6, h: 1 },
  { id: 'd-security', source: 'native:internalSecurity', page: 'details', style: 'bar', x: 0, y: 7, w: 6, h: 1 },
  { id: 'd-reputation', source: 'native:internationalReputation', page: 'details', style: 'bar', x: 0, y: 8, w: 6, h: 1 },
  { id: 'd-population-heading', source: '', page: 'details', style: 'heading', label: 'Population', x: 0, y: 9, w: 6, h: 1 },
  { id: 'd-population', source: 'native:totalPopulation', page: 'details', style: 'value', x: 0, y: 10, w: 6, h: 1 },
  { id: 'd-economy-heading', source: '', page: 'details', style: 'heading', label: 'Economy', x: 0, y: 11, w: 6, h: 1 },
  { id: 'd-gdp', source: 'native:gdp', page: 'details', style: 'value', x: 0, y: 12, w: 3, h: 1 },
  { id: 'd-capita', source: 'native:gdpPerCapita', page: 'details', style: 'value', x: 3, y: 12, w: 3, h: 1 },
  { id: 'd-growth', source: 'native:gdpGrowth', page: 'details', style: 'value', x: 0, y: 13, w: 3, h: 1 },
  { id: 'd-inflation', source: 'native:inflation', page: 'details', style: 'value', x: 3, y: 13, w: 3, h: 1 },
  { id: 'd-unemployment', source: 'native:unemployment', page: 'details', style: 'value', x: 0, y: 14, w: 3, h: 1 },
  { id: 'd-debt', source: 'native:publicDebt', page: 'details', style: 'value', x: 3, y: 14, w: 3, h: 1 },
  { id: 'd-budget', source: 'native:budgetBalance', page: 'details', style: 'value', x: 0, y: 15, w: 3, h: 1 },
  { id: 'd-breakdown', source: 'system:gdpBreakdown', page: 'details', style: 'breakdown', x: 0, y: 16, w: 6, h: 2 },
  { id: 'd-military', source: 'system:military', page: 'details', style: 'military', x: 0, y: 18, w: 6, h: 6 },
]) });

// An uncustomized national sheet uses the modern preset without requiring a
// redundant stats.json upload. Custom sheets without an authored dashboard
// retain their explicit sheet presentation; neither path changes countryStats.
export const nationalDashboardForDisplay = (definition) =>
  definition?.dashboard ?? (definition?.custom ? null : DEFAULT_NATIONAL_DASHBOARD);

// The Country panel's standalone military card is a fallback only. Derive
// ownership from the displayed dashboard, not an optional authored definition.
export const shouldShowStandaloneMilitaryCard = (dashboard, page) =>
  !dashboard || (page === 'details' &&
    !dashboard.widgets.some((widget) => widget.style === 'military' && widget.page === 'details'));
