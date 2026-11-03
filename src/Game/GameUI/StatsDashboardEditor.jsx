/*! Open Historia - visual scenario authoring for existing canonical national metrics. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import StatsDashboard, { DashboardMilitaryPreview, canShowDashboardBar, dashboardMetricFor } from './StatsDashboard.jsx';
import { NATIONAL_NATIVE_METRICS, normalizeStatSheetDefinition } from '../../runtime/statIndexDefinitions.js';
import { warSettingsOf } from '../../runtime/warSettings.js';
import { canPlaceDashboardWidget, DEFAULT_NATIONAL_DASHBOARD, DASHBOARD_CARD_SIZES,
  MAX_STAT_DASHBOARD_WIDGETS, DASHBOARD_ACCENTS, duplicateDashboardWidget, insertDashboardWidget,
  placeDashboardWidget, snapDashboardWidgetSize, updateDashboardWidget,
  dashboardSystemStyle, dashboardSystemSource, isRequiredMilitaryWidget,
  nationalDashboardForDisplay, shouldShowStandaloneMilitaryCard } from '../../runtime/statsDashboardLayout.js';

const labels = { gdp: 'GDP', gdpPerCapita: 'GDP per capita', totalPopulation: 'Population',
  inflation: 'Inflation', unemployment: 'Unemployment', publicDebt: 'Public debt',
  budgetBalance: 'Budget balance', nationalStability: 'National stability', gdpGrowth: 'GDP growth',
  sovereignty:'Sovereignty',foodAutonomy:'Food autonomy',energyAutonomy:'Energy autonomy',
  economicIndependence:'Economic independence',internalSecurity:'Internal security',
  internationalReputation:'International reputation' };
const control = { background: '#24282e', color: '#e8edf0', border: '1px solid rgba(255,255,255,.14)',
  borderRadius: 8, padding: '0.47rem 0.65rem', fontSize: 12, minHeight: 33 };
const labelStyle = { fontSize: 11, color: '#a9b2b8', fontWeight: 650, marginBottom: 5, display: 'block' };
// These illustrative values exist ONLY inside the editor. Nothing below is saved
// to scenario.world, observed history, or a running campaign.
const exampleSheet = { economy: { gdp: 169000000000, gdpPerCapita: 21700, unemployment: 3.7,
  publicDebt: 62.9, inflation: 2.2, gdpGrowth: 1.6, budgetBalance: -2.5 },
  population: { total: 78300000 }, gdpBreakdown: { agriculture: 33, industry: 38, services: 29 }, stability: 70,
  indices: { economicIndependence: 80, foodAutonomy: 70, energyAutonomy: 65, sovereignty: 77,
    internalSecurity: 74, internationalReputation: 72 }, customStats: {} };
const sampleHistory = [
  147000000000, 149000000000, 151000000000, 150000000000, 153000000000, 157000000000,
  159000000000, 161000000000, 165000000000, 166000000000, 169000000000,
].map((gdp, i) => ({ date: `1912-${String(i + 1).padStart(2, '0')}-01`, gdp,
  population: 77900000 + i * 40000, unemployment: 4.6 - i * .09,
  publicDebt: 66 - i * .3, stability: 67 + i * .3 }));
const presentation = [ ['value', 'Number card'], ['bar', 'Progress bar'], ['trend', 'History chart'], ['change', 'Recorded change'] ];
const systemPresentations = [ ['intelligence','Intelligence service'], ['breakdown','GDP breakdown'], ['military','Military power'] ];
const choosePage = [ ['overview', 'Overview'], ['details', 'Details'] ];
const ACCENTS = [ ['auto','Metric color'], ['neutral','Neutral'], ['green','Green'], ['blue','Blue'], ['amber','Amber'], ['red','Red'] ];
const accentSwatch = { auto:'#8195a2',neutral:'#b8c6d0',green:'#34d399',blue:'#60a5fa',amber:'#eab308',red:'#fb7185' };
// Keep size labels as independently translated words. Building label variants
// with a template literal bypasses the committed catalog and locale packs.
const SIZE_WIDTH_LABELS = { 2: 'Compact', 3: 'Wide', 6: 'Full' };
const SIZE_HEIGHT_LABELS = { 2: 'Tall', 3: 'Extra tall' };
const textField = element => Boolean(element?.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]'));

// An authored layout may predate the mandatory native military presentation.
// Show the same non-removable Details fallback the player receives, using only
// illustrative editor values, never a second military power calculation.
const RequiredMilitaryPreview = ({ suppliesEnabled }) => <section aria-label="Required military readout"
  style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,.09)', paddingTop: 9 }}>
  <div style={{ fontSize: 10.5, fontWeight: 750, color: '#b7c5cd', marginBottom: 7 }}>
    Required by Wars & Fronts
  </div>
  <DashboardMilitaryPreview suppliesEnabled={suppliesEnabled} />
</section>;


export default function StatsDashboardEditor({ value, onChange, warSettings = null, advancedEditor = null }) {
  const suppliesEnabled = warSettingsOf({ warSettings }).mechanics.supply;
  const definition = useMemo(() => normalizeStatSheetDefinition(value), [value]);
  const dashboard = nationalDashboardForDisplay(definition);
  const [page, setPage] = useState('overview');
  const [source, setSource] = useState('native:gdp');
  const [style, setStyle] = useState('value');
  const [showAdd, setShowAdd] = useState(false);
  const [sectionTitle, setSectionTitle] = useState('National condition');
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const [notice, setNotice] = useState('');
  const undoRef = useRef([]);
  const redoRef = useRef([]);
  const clipboardRef = useRef(null);
  const dragRef = useRef(null);
  const editorRef = useRef(null);
  const metricSelectRef = useRef(null);
  const [contextMenu, setContextMenu] = useState(null);
  const options = useMemo(() => [
    ...Object.keys(NATIONAL_NATIVE_METRICS).map(key => ({ value: `native:${key}`, label: labels[key] || key })),
    ...(definition.custom ? definition.sections.flatMap(section => section.stats.filter(row => !row.nativeMetric)
      .map(row => ({ value: `custom:${row.key}`, label: row.label }))) : []),
  ], [definition]);
  const sampleSheet = useMemo(() => ({ ...exampleSheet, customStats: Object.fromEntries(
    (definition.custom ? definition.sections.flatMap(s => s.stats) : [])
      .filter(stat => !stat.nativeMetric).map(stat => [stat.key, stat.kind === 'currency' ? 120000 : 67]),
  ) }), [definition]);
  const selected = dashboard?.widgets.find(widget => widget.id === selectedId) || null;
  const commit = (next) => {
    if (!next) return;
    undoRef.current = [...undoRef.current.slice(-31), dashboard];
    redoRef.current = [];
    onChange({ ...value, dashboard: next });
    setDraft(null); setInvalid(false); setNotice('');
  };
  const useClassic = () => {
    commit(structuredClone(DEFAULT_NATIONAL_DASHBOARD));
    setSelectedId('gross-output'); setPage('overview');
  };
  const enable = () => {
    const initial = definition.custom ? { version: 1, widgets: [] } : structuredClone(DEFAULT_NATIONAL_DASHBOARD);
    commit(initial);
    setSelectedId(initial.widgets[0]?.id || null);
  };
  const disable = () => {
    if (!window.confirm('Restore the previous Statistics layout? Widget arrangement will be removed.')) return;
    undoRef.current = [...undoRef.current.slice(-31), dashboard];
    redoRef.current = [];
    const next = { ...value }; delete next.dashboard; onChange(next);
    setSelectedId(null); setDraft(null);
  };
  const undo = () => {
    if (!undoRef.current.length) return;
    const previous = undoRef.current.pop();
    redoRef.current.push(dashboard);
    const next = { ...value }; if (previous) next.dashboard = previous; else delete next.dashboard;
    onChange(next); setDraft(null); setInvalid(false); setNotice('');
  };
  const redo = () => {
    if (!redoRef.current.length) return;
    const nextDashboard = redoRef.current.pop();
    undoRef.current.push(dashboard);
    const next = { ...value }; if (nextDashboard) next.dashboard = nextDashboard; else delete next.dashboard;
    onChange(next); setDraft(null); setInvalid(false); setNotice('');
  };
  const available = options.some(item => item.value === source) ? source : options[0]?.value;
  const isBounded = (candidate) => canShowDashboardBar(dashboardMetricFor(candidate, definition, sampleSheet));
  const add = (kind = style) => {
    if (!dashboard || dashboard.widgets.length >= MAX_STAT_DASHBOARD_WIDGETS
      || (kind !== 'heading' && !dashboardSystemStyle(kind) && !available)) return;
    if (kind === 'heading' && (!sectionTitle.trim() || sectionTitle.trim().length > 60)) {
      setNotice('Section heading must have a title of up to 60 characters.'); return;
    }
    if (kind === 'bar' && !isBounded(available)) {
      setNotice('Progress bars require a bounded index or percentage (0-100).'); return;
    }
    if (kind === 'military' && (page !== 'details' || dashboard.widgets.some(isRequiredMilitaryWidget))) {
      setNotice('Military power is a required Details module. It cannot be duplicated or placed on Overview.'); return;
    }
    const occupied = new Set(dashboard.widgets.map(row => row.id));
    let id = 'tile1'; for (let i = 1; occupied.has(id); i++) id = `tile${i + 1}`;
    const w = ['heading', 'change'].includes(kind) || dashboardSystemStyle(kind) ? 6 : kind === 'trend' ? 3 : 2;
    const h = dashboardSystemStyle(kind) ? DASHBOARD_CARD_SIZES[kind].heights[0] : kind === 'trend' ? 2 : 1;
    for (let y = 0; y <= 40; y++) for (let x = 0; x <= 6 - w; x++) {
      const widget = { id, source: kind === 'heading' ? '' : dashboardSystemStyle(kind) ? dashboardSystemSource(kind) : available, style: kind, page, x, y, w, h,
        ...(kind === 'heading' ? { label: sectionTitle.trim() } : {}) };
      if (canPlaceDashboardWidget(dashboard.widgets, widget)) {
        commit({ ...dashboard, widgets: [...dashboard.widgets, widget] });
        setSelectedId(id); setShowAdd(false); return;
      }
    }
    setNotice('No available space on this dashboard tab.');
  };
  const editWidget = (id, patch) => {
    const next = updateDashboardWidget(dashboard, id, patch);
    if (!next) { setNotice('That position or size overlaps another card or exceeds the grid.'); return; }
    commit(next);
  };
  const remove = id => {
    const widget = dashboard?.widgets.find(row => row.id === id);
    if (isRequiredMilitaryWidget(widget)) {
      setNotice('Military power is required by Wars & Fronts and cannot be removed.'); return;
    }
    // Keep keyboard focus inside the editor after the focused card disappears.
    editorRef.current?.querySelector('[data-dashboard-canvas]')?.focus({ preventScroll: true });
    commit({ ...dashboard, widgets: dashboard.widgets.filter(widget => widget.id !== id) });
    setSelectedId(null);
  };
  const copyCard = (widget = selected) => {
    if (!widget) return;
    if (isRequiredMilitaryWidget(widget)) {
      setNotice('Military power is a required system module, not a duplicable statistic.'); return;
    }
    clipboardRef.current = { ...widget };
    setNotice('Card copied. Paste it on either tab.');
  };
  const pasteCard = (template = clipboardRef.current) => {
    if (!dashboard || !template) { setNotice('Select a card to copy first.'); return; }
    if (isRequiredMilitaryWidget(template)) {
      setNotice('Military power is a required system module, not a duplicable statistic.'); return;
    }
    // The clipboard holds only presentation metadata, never a national reading.
    const result = insertDashboardWidget(dashboard, template, page);
    if (!result) { setNotice('No room for the pasted card, or the dashboard is full.'); return; }
    commit(result.dashboard); setSelectedId(result.id);
  };
  const duplicateCard = (widget = selected) => {
    if (!widget || !dashboard) return;
    if (isRequiredMilitaryWidget(widget)) {
      setNotice('Military power is a required system module, not a duplicable statistic.'); return;
    }
    const result = duplicateDashboardWidget(dashboard, widget.id);
    if (!result) { setNotice('No room to duplicate this card.'); return; }
    commit(result.dashboard); setSelectedId(result.id);
  };
  const cutCard = (widget = selected) => {
    if (!widget) return;
    if (isRequiredMilitaryWidget(widget)) {
      setNotice('Military power is required by Wars & Fronts and cannot be removed.'); return;
    }
    clipboardRef.current = { ...widget };
    remove(widget.id);
  };
  const setCardStyle = (widget, nextStyle) => {
    if (nextStyle === widget.style) return;
    if (nextStyle === 'bar' && !isBounded(widget.source)) {
      setNotice('Progress bars require a bounded index or percentage (0-100).'); return;
    }
    const sizes = DASHBOARD_CARD_SIZES[nextStyle];
    if (!sizes || nextStyle === 'heading' || widget.style === 'heading'
      || dashboardSystemStyle(nextStyle) || dashboardSystemStyle(widget.style)) return;
    const w = sizes.widths.includes(widget.w) ? widget.w : sizes.widths[0];
    const h = sizes.heights.includes(widget.h) ? widget.h : sizes.heights[0];
    const patch = { style: nextStyle, w, h };
    const atPosition = updateDashboardWidget(dashboard, widget.id, patch);
    if (atPosition) { commit(atPosition); return; }
    // A style switch shouldn't require deleting the original card: find room.
    for (let y = 0; y <= 40; y++) for (let x = 0; x <= 6-w; x++) {
      const relocated = updateDashboardWidget(dashboard, widget.id, { ...patch, x, y });
      if (relocated) { commit(relocated); return; }
    }
    setNotice('No room for that card style. Make space or choose another size.');
  };
  const cardSize = (widget, w, h) => {
    const next = updateDashboardWidget(dashboard, widget.id, { w, h });
    if (next) commit(next);
    else setNotice('That size overlaps another card. Move it to an open area first.');
  };
  const sizePresets = widget => {
    const sizes = DASHBOARD_CARD_SIZES[widget.style];
    if (!sizes) return [];
    const footprints = sizes.widths.flatMap(w => sizes.heights.map(h => ({ w, h })));
    return footprints.filter(({w,h}) => (w === 2 && h === 1) || (w === 3 && h === 1)
      || (w === 6 && h === 1) || (w === 3 && h === 2) || (w === 6 && h === 2) || (w === 6 && h === 3));
  };
  const onCardContextMenu = (event, id) => {
    setSelectedId(id);
    setContextMenu({ id, x: Math.min(event.clientX, window.innerWidth - 175), y: Math.min(event.clientY, window.innerHeight - 190) });
  };
  const changeTab = (widget, nextPage) => {
    if (widget.page === nextPage) return;
    if (isRequiredMilitaryWidget(widget)) {
      setNotice('Military power is required on Details and cannot be moved to another tab.'); return;
    }
    const siblings = dashboard.widgets.filter(w => w.id !== widget.id);
    for (let y = 0; y <= 40; y++) for (let x = 0; x <= 6 - widget.w; x++) {
      const moved = { ...widget, page: nextPage, x, y };
      if (canPlaceDashboardWidget(siblings, moved)) { editWidget(widget.id, { page: nextPage, x, y }); setPage(nextPage); return; }
    }
    setNotice('No available space in the other tab.');
  };
  const start = (event, widget, mode = 'move') => {
    if (event.button !== 0) return;
    event.preventDefault();
    // PreventDefault disables the browser's normal click-to-focus path. Focus
    // the card explicitly so canvas shortcuts work immediately after a drag.
    event.currentTarget.closest('[data-widget-id]')?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { widget, startX: event.clientX, startY: event.clientY, mode, cancelled: false };
    setContextMenu(null);
    setDraft(widget); setInvalid(false);
  };
  const move = event => {
    const drag = dragRef.current;
    if (!drag || !dashboard || drag.cancelled) return;
    const canvas = event.currentTarget.closest('.oh-stats-dashboard')?.querySelector('[data-dashboard-canvas]');
    const width = canvas?.getBoundingClientRect().width || 600;
    const dx = Math.round((event.clientX - drag.startX) / ((width - 30) / 6 + 6));
    const dy = Math.round((event.clientY - drag.startY) / 74);
    const widget = drag.widget;
    const next = drag.mode === 'move'
      ? { ...widget, x: Math.max(0, Math.min(6 - widget.w, widget.x + dx)),
        y: Math.max(0, Math.min(40, widget.y + dy)) }
      : { ...widget, ...snapDashboardWidgetSize(widget,
        drag.mode === 'height' ? 0 : dx, drag.mode === 'width' ? 0 : dy) };
    drag.latest = next;
    setDraft(next);
    setInvalid(!(drag.mode === 'move' ? placeDashboardWidget(dashboard, next.id, {x:next.x,y:next.y}) : canPlaceDashboardWidget(dashboard.widgets, next, next.id)));
  };
  const end = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.cancelled) return;
    const candidate = drag.latest || drag.widget;
    if (['x', 'y', 'w', 'h'].some(key => candidate[key] !== drag.widget[key])) {
      const next = drag.mode === 'move' ? placeDashboardWidget(dashboard, candidate.id,
        { x: candidate.x, y: candidate.y }) : updateDashboardWidget(dashboard, candidate.id,
        { w: candidate.w, h: candidate.h });
      if (next) commit(next);
      else setNotice('That space is occupied. Try another position or size.');
    }
    setDraft(null); setInvalid(false);
  };
  const cancel = () => {
    if (dragRef.current) dragRef.current.cancelled = true;
    dragRef.current = null; setDraft(null); setInvalid(false);
  };
  useEffect(() => {
    const keydown = event => {
      if (!editorRef.current?.contains(event.target)) return;
      if (event.key === 'Escape') {
        if (dragRef.current) { event.preventDefault(); cancel(); }
        else { setContextMenu(null); setSelectedId(null); }
        return;
      }
      if (textField(event.target) || event.altKey) return;
      // Scope shortcuts strictly to the canvas/card surface. Form controls,
      // browser pages and campaign Undo keep their existing behavior.
      if (!event.target.closest?.('[data-dashboard-canvas]')) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      let handled = false;
      if (modifier && key === 'z' && event.shiftKey) { redo(); handled = true; }
      else if (modifier && key === 'z') { undo(); handled = true; }
      else if (modifier && key === 'y') { redo(); handled = true; }
      else if (modifier && key === 'c') { copyCard(); handled = true; }
      else if (modifier && key === 'x') { cutCard(); handled = true; }
      else if (modifier && key === 'v') { pasteCard(); handled = true; }
      else if (modifier && key === 'd') { duplicateCard(); handled = true; }
      else if (!modifier && (key === 'delete' || key === 'backspace') && selected) {
        remove(selected.id); handled = true;
      }
      if (handled) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  });
  useEffect(() => {
    if (!contextMenu) return undefined;
    const dismiss = event => {
      if (!event.target.closest?.('[role="menu"][aria-label="Card actions"]')) setContextMenu(null);
    };
    window.addEventListener('pointerdown', dismiss, true);
    return () => window.removeEventListener('pointerdown', dismiss, true);
  }, [contextMenu]);
  const editorButton = (text, action, disabled = false) => <button type="button" style={control}
    disabled={disabled} onClick={action}>{text}</button>;
  return <section ref={editorRef} aria-label="Statistics dashboard editor" style={{ marginTop: 14, border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 13, padding: 15, background: '#191c20', color: '#e8edf0' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
      <div>
        <strong style={{ fontSize: 15 }}>Statistics dashboard</strong>
        <div style={{ marginTop: 4, fontSize: 12, color: '#9ea8ae' }}>Design the national panel. Metrics keep their existing values.</div>
        <div style={{ marginTop: 4, fontSize: 11, color: '#b1c5ca' }}>Military power is required by Wars & Fronts and cannot be removed.</div>
      </div>
      {!dashboard ? editorButton('Customize dashboard', enable)
        : <div style={{ display: 'flex', gap: 7 }}>
          {editorButton('Classic layout', useClassic)}
          {editorButton('Undo', undo, !undoRef.current.length)}
          {editorButton('Redo', redo, !redoRef.current.length)}
          {editorButton('Restore original layout', disable)}
        </div>}
    </div>
    {dashboard && <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginTop: 17, marginBottom: 14 }}>
        <div role="group" aria-label="Dashboard tab" style={{ display: 'flex', padding: 3, borderRadius: 9,
          background: '#25292e', border: '1px solid rgba(255,255,255,.09)' }}>
          {choosePage.map(([tab, text]) => <button key={tab} type="button" aria-pressed={page === tab}
            onClick={() => { setPage(tab); setSelectedId(null); }}
            style={{ ...control, background: page === tab ? '#364349' : 'transparent', border: 0,
              color: page === tab ? '#fff' : '#9faab1' }}>{text}</button>)}
        </div>
        <span style={{ fontSize: 11, color: '#9da8a6' }}>Drag cards to move · resize at the edge · Ctrl+Z to undo · Right-click for actions</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {editorButton('+ Section', () => { setShowAdd(true); setStyle('heading'); })}
          {editorButton(showAdd ? 'Close picker' : '+ Add card', () => { setShowAdd(!showAdd); setStyle('value'); })}
        </div>
      </div>
      {showAdd && <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap',
        background: '#20252a', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: 12, marginBottom: 13 }}>
        {style === 'heading' || dashboardSystemStyle(style) ? (style === 'heading' ? <label style={{ flex: '2 1 190px' }}><span style={labelStyle}>Section title</span>
          <input value={sectionTitle} maxLength={60} onChange={e => setSectionTitle(e.target.value)} style={{ ...control, width: '100%' }} />
        </label> : <span style={{fontSize:12,color:'#b9c5ca',alignSelf:'center'}}>{systemPresentations.find(([key])=>key===style)?.[1]}</span>) : <label style={{ flex: '2 1 190px' }}><span style={labelStyle}>Reading</span>
          <select aria-label="Metric source" value={available} onChange={e => setSource(e.target.value)} style={{ ...control, width: '100%' }}>
            {options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select></label>}
        {style !== 'heading' && <label style={{ flex: '1 1 130px' }}><span style={labelStyle}>Card style</span>
          <select aria-label="Widget presentation" value={style} onChange={e => setStyle(e.target.value)} style={{ ...control, width: '100%' }}>
            {[...presentation,...systemPresentations].map(([key, text]) => <option key={key} value={key}>{text}</option>)}
          </select></label>}
        {editorButton(style === 'heading' ? 'Add section' : 'Add to dashboard', () => add(style), dashboard.widgets.length >= MAX_STAT_DASHBOARD_WIDGETS)}
      </div>}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 580px', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 2px', marginBottom: 8 }}>
            <strong style={{ fontSize: 12 }}>Canvas</strong>
            <span style={{ fontSize: 11, color: '#929da3' }}>Snap grid · 6 columns</span>
          </div>
          <div style={{ border: '1px solid rgba(255,255,255,.09)', borderRadius: 11, padding: 10,
            background: '#15191d', overflowX: 'auto' }}>
            <StatsDashboard dashboard={dashboard} definition={definition} sheet={sampleSheet} history={sampleHistory}
              page={page} editable sampleModules sampleSuppliesEnabled={suppliesEnabled} intelligence={58} selectedId={selectedId} onWidgetSelect={setSelectedId}
              previewWidget={draft} invalidWidget={invalid} onPointerStart={start}
              onResizeStart={(event, widget, edge) => start(event, widget, edge)}
              onPointerMove={move} onPointerEnd={end} onPointerCancel={cancel}
              onWidgetAction={editWidget}
              onWidgetDoubleClick={id => { setSelectedId(id); setTimeout(() => metricSelectRef.current?.focus(), 0); }}
              onWidgetContextMenu={onCardContextMenu} />
            {page === 'details' && shouldShowStandaloneMilitaryCard(dashboard, page) && <RequiredMilitaryPreview suppliesEnabled={suppliesEnabled} />}
          </div>
          {selected && <div style={{ marginTop: 12, background: '#22282d', border: '1px solid rgba(255,255,255,.09)',
            borderRadius: 10, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div><strong style={{ fontSize: 13 }}>Card settings</strong>
                <div style={{ fontSize: 11, color: '#a9b2b8', marginTop: 3 }}>Change this card without adding another one.</div></div>
              <div style={{ display:'flex', gap: 6 }}>
                {editorButton('Duplicate', () => duplicateCard(selected), isRequiredMilitaryWidget(selected))}
                {editorButton('Remove', () => remove(selected.id), isRequiredMilitaryWidget(selected))}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9, marginTop: 10, alignItems: 'flex-end' }}>
              {selected.style === 'heading' ? <label style={{ flex: '1 1 190px' }}>
                <span style={labelStyle}>Section title</span>
                <input value={selected.label || ''} maxLength={60} style={{ ...control, width: '100%' }}
                  onChange={event => { const title = event.target.value; if (title.trim()) editWidget(selected.id, {label: title.trim()}); }} />
              </label> : dashboardSystemStyle(selected.style) ? <><div style={{fontSize:12,color:'#b9c5ca',padding:'7px 0'}}>{systemPresentations.find(([key])=>key===selected.style)?.[1]}</div>
                <label style={{flex:'1 1 100px'}}><span style={labelStyle}>Tab</span><select value={selected.page} aria-label="Widget tab" disabled={isRequiredMilitaryWidget(selected)} style={{...control,width:'100%'}} onChange={e=>changeTab(selected,e.target.value)}>{choosePage.map(([key,text])=><option value={key} key={key}>{text}</option>)}</select></label></> : <>
              <label style={{ flex: '1 1 135px' }}><span style={labelStyle}>Metric</span>
                <select ref={metricSelectRef} value={selected.source} aria-label="Selected card metric" style={{ ...control, width: '100%' }}
                  onChange={event => {
                    if (selected.style === 'bar' && !isBounded(event.target.value)) {
                      setNotice('Switch to a number card before selecting an unbounded metric.'); return;
                    }
                    editWidget(selected.id, { source: event.target.value });
                  }}>
                  {options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select></label>
              <label style={{ flex: '1 1 130px' }}><span style={labelStyle}>Card appearance</span>
                <select value={selected.style} aria-label="Selected card style" style={{ ...control, width: '100%' }}
                  onChange={event => setCardStyle(selected, event.target.value)}>{presentation.map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></label>
              <label style={{ flex: '1 1 100px' }}><span style={labelStyle}>Tab</span>
                <select value={selected.page} aria-label="Widget tab" style={{ ...control, width: '100%' }}
                  onChange={e => changeTab(selected, e.target.value)}>
                  {choosePage.map(([key, text]) => <option value={key} key={key}>{text}</option>)}
                </select></label></>}
            </div>
            {selected.style !== 'heading' && selected.style !== 'change' && <div style={{ marginTop: 13 }}>
              <div style={labelStyle}>Accent</div>
              <div role="group" aria-label="Card accent" style={{display:'flex', flexWrap:'wrap', gap:8}}>
                {ACCENTS.filter(([key]) => DASHBOARD_ACCENTS.includes(key)).map(([key, title]) =>
                  <button key={key} type="button" title={title} aria-label={`${title} accent`}
                    aria-pressed={(selected.accent || 'auto') === key}
                    onClick={() => editWidget(selected.id, {accent:key})}
                    style={{background:accentSwatch[key],width:27,height:27,borderRadius:'50%',cursor:'pointer',
                      border:(selected.accent||'auto')===key?'3px solid #f8fafc':'2px solid #373d43',
                      boxShadow:(selected.accent||'auto')===key?'0 0 0 2px #253137':undefined}} />)}
              </div>
            </div>}
            {selected.style !== 'heading' && selected.style !== 'change' && !dashboardSystemStyle(selected.style) && <div style={{marginTop:12}}>
              <div style={labelStyle}>Card size</div>
              <div role="group" aria-label="Card size" style={{display:'flex',flexWrap:'wrap',gap:7}}>
                {sizePresets(selected).map(({w,h}) => {
                  const chosen = selected.w === w && selected.h === h;
                  return <button key={`${w}x${h}`} type="button" aria-pressed={chosen}
                    style={{ ...control, background: chosen ? '#34464b' : control.background,
                      borderColor: chosen ? '#70a6a5' : 'rgba(255,255,255,.14)' }}
                    onClick={() => cardSize(selected,w,h)}>
                    <span>{SIZE_WIDTH_LABELS[w]}</span>
                    {h > 1 && <><span aria-hidden="true"> · </span><span>{SIZE_HEIGHT_LABELS[h]}</span></>}
                    {chosen && <span aria-hidden="true"> ✓</span>}
                  </button>;
                })}
              </div>
            </div>}
            <div style={{marginTop:11,fontSize:11,color:'#9da8a6'}}>
              Drag or use the arrow keys to move. Shift + arrow keys resizes to the next supported size.
              Ctrl+C / Ctrl+V copy and paste cards; Ctrl+Z / Ctrl+Y undo and redo.
            </div>
          </div>}
          {notice && <p role="status" style={{ color: '#f6b8a8', fontSize: 12, marginTop: 8 }}>{notice}</p>}
          {contextMenu && <div role="menu" aria-label="Card actions" onPointerDown={event => event.stopPropagation()}
            style={{position:'fixed',left:Math.max(0,contextMenu.x),top:Math.max(0,contextMenu.y),
              zIndex:99999,background:'#242b30',border:'1px solid #46535b',padding:6,borderRadius:10,
              boxShadow:'0 10px 30px #0008',display:'grid',gap:3}}>
            {[['Edit card', () => {setSelectedId(contextMenu.id);metricSelectRef.current?.focus();}],
              ['Copy card', () => copyCard(dashboard.widgets.find(w=>w.id===contextMenu.id))],
              ['Duplicate', () => duplicateCard(dashboard.widgets.find(w=>w.id===contextMenu.id))],
              ['Paste', () => pasteCard()],
              ['Remove', () => remove(contextMenu.id)]].map(([text,action]) =>
              <button key={text} type="button" role="menuitem" style={{...control,textAlign:'left',minWidth:145}}
                disabled={isRequiredMilitaryWidget(dashboard.widgets.find(w=>w.id===contextMenu.id))
                  && ['Copy card', 'Duplicate', 'Remove'].includes(text)}
                onClick={()=>{action();setContextMenu(null);}}>{text}</button>)}
          </div>}
        </div>
        <aside style={{ flex: '0 1 345px', minWidth: 'min(100%, 285px)' }} aria-label="Player panel preview">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <strong style={{ fontSize: 12 }}>Player panel preview</strong>
            <span style={{ fontSize: 10.5, color: '#a7b1b7' }}>Illustrative values</span>
          </div>
          <div style={{ background: '#181b1c', border: '1px solid rgba(255,255,255,.15)', borderRadius: 12,
            padding: '18px 13px 20px', maxWidth: 345, boxSizing: 'border-box' }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: '#f1f5f9' }}>Economy</div>
            <div style={{ fontSize: 10.5, color: '#a6adaf', marginTop: 3, marginBottom: 12 }}>Sample · January 1912</div>
            <StatsDashboard dashboard={dashboard} definition={definition} sheet={sampleSheet}
              history={sampleHistory} page={page} sampleModules sampleSuppliesEnabled={suppliesEnabled} intelligence={58} />
            {page === 'details' && shouldShowStandaloneMilitaryCard(dashboard, page) && <RequiredMilitaryPreview suppliesEnabled={suppliesEnabled} />}
            <div style={{ marginTop: 13, borderRadius: 10, border: '1px solid #31465d',
              background: '#1b2530', padding: '0.7rem 0.8rem', fontSize: 12, fontWeight: 700 }}>
              📊 Advanced statistics <span style={{ float: 'right' }}>↗</span>
            </div>
            <div style={{ marginTop: 10, textAlign: 'right', color: '#9ca5b0', fontSize: 11 }}>
              ⚙ Historical tracking
            </div>
          </div>
          <p style={{ fontSize: 10.5, color: '#929da3', lineHeight: 1.45, marginTop: 9 }}>
            The player uses the same card layout and metric bindings. Historical readings here are illustrative only.
          </p>
        </aside>
      </div>
    </>}
    {advancedEditor && <details style={{marginTop:15,background:'#20252a',padding:14,borderRadius:11,
      border:'1px solid rgba(255,255,255,.1)'}}>
      <summary style={{cursor:'pointer',fontWeight:750,fontSize:13}}>Metric definitions and custom readings</summary>
      <p style={{fontSize:11,color:'#a7b0b7',lineHeight:1.5}}>
        Create or edit scenario-specific metrics here. Arrange their cards above. Changing a card never changes the stored reading.
      </p>
      {advancedEditor}
    </details>}
  </section>;
}
