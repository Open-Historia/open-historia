/*! Open Historia - one read-only national Statistics renderer for player and editor.
 * Edit handles are presentation-only; metric readings always use canonical bindings.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { dashboardColumnsForWidth, projectDashboardGrid, snapDashboardWidgetSize } from '../../runtime/statsDashboardLayout.js';
import { dashboardMetricFor, dashboardMetricHistory, dashboardRecordedChange } from '../../runtime/statsDashboardReadings.js';
export { dashboardMetricFor, dashboardMetricHistory } from '../../runtime/statsDashboardReadings.js';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const compact = (number, digits = 1) => {
  if (!finite(number)) return '—';
  const abs = Math.abs(number);
  for (const [scale, suffix] of [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']]) {
    if (abs >= scale) return `${(number / scale).toFixed(digits)}${suffix}`;
  }
  return number.toLocaleString(undefined, { maximumFractionDigits: digits });
};
const formatted = (metric) => {
  if (metric?.reading?.status !== 'ready') return '—';
  const dec = metric.decimals ?? (metric.kind === 'currency' ? 1 : metric.kind === 'index' ? 0 : 1);
  return `${metric.prefix || ''}${compact(metric.reading.value, dec)}${metric.kind === 'index' ? '/100' : metric.suffix || ''}`;
};
export const canShowDashboardBar = (metric) => Boolean(metric && ['index', 'percentage'].includes(metric.kind)
  && finite(metric.minimum) && finite(metric.maximum)
  && metric.maximum > metric.minimum && metric.maximum <= 100);
const changeText = (recorded, metric) => {
  if (!recorded) return 'Baseline reading';
  const sign = recorded.delta >= 0 ? '+' : '−';
  const unit = metric?.kind === 'currency' ? '€' : '';
  const suffix = metric?.kind === 'percentage' ? ' pp' : metric?.kind === 'index' ? ' pts' : '';
  return `${sign}${unit}${compact(Math.abs(recorded.delta))}${suffix} (${recorded.from} → ${recorded.to})`;
};
const ACCENT_COLORS = Object.freeze({ neutral: '#b8c6d0', green: '#34d399', blue: '#60a5fa', amber: '#eab308', red: '#fb7185' });
const accentColor = (widget, metric) => ACCENT_COLORS[widget?.accent] || metric?.color || '#34d399';
const valueColor = (metric) => metric?.source === 'native:gdp' ? '#edf8f4' : '#f1f5f9';

function MiniChart({ points, color = '#34d399' }) {
  const enough = points.length >= 2;
  const values = points.map(point => point.value);
  const low = enough ? Math.min(...values) : 0;
  const high = enough ? Math.max(...values) : 1;
  const spread = high - low || Math.max(1, Math.abs(high) * 0.04);
  const coords = enough ? values.map((v, i) => [
    Number((i * 100 / (values.length - 1)).toFixed(2)),
    Number((42 - ((v - low) / spread) * 31).toFixed(2)),
  ]) : [];
  const line = coords.map(([x, y]) => `${x},${y}`).join(' ');
  const region = enough ? `0,46 ${line} 100,46` : '';
  return <div className="oh-stats-chart" style={{ height: '100%', minHeight: 42, position: 'relative',
    overflow: 'hidden', borderTop: '1px solid rgba(255,255,255,.07)' }}>
    <svg viewBox="0 0 100 48" preserveAspectRatio="none" role="img"
      aria-label={enough ? 'Recorded historical trend' : 'No recorded historical trend'}
      style={{ height: '100%', width: '100%', display: 'block' }}>
      {[14, 29, 44].map(y => <line key={y} x1="0" x2="100" y1={y} y2={y}
        stroke="rgba(188,211,204,.13)" strokeWidth=".35" strokeDasharray="1.4 2" />)}
      {enough && <>
        <polygon points={region} fill={color} opacity=".13" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="1.6"
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </>}
    </svg>
    {!enough && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: 11, color: '#a1a1aa' }}>Not recorded</div>}
  </div>;
}

const STYLE = `
  .oh-stats-dashboard .oh-dashboard-card { transition: border-color .16s ease, box-shadow .16s ease, background-color .16s ease; }
  .oh-stats-dashboard.is-editing .oh-dashboard-card.is-selected { box-shadow: 0 0 0 1px rgba(147,183,176,.40), 0 5px 18px rgba(0,0,0,.18); }
  .oh-stats-dashboard.is-editing .oh-dashboard-card { cursor: grab; touch-action: none; }
  .oh-stats-dashboard.is-editing .oh-dashboard-card:active { cursor: grabbing; }
  .oh-stats-dashboard .oh-dashboard-card:focus-visible { outline: 2px solid #8eaece; outline-offset: 2px; }
  .oh-stats-dashboard .oh-dashboard-edge { position: absolute; z-index: 2; border: 0; background: transparent;
    border-radius: 5px; opacity: 0; transition: opacity .12s ease, background-color .12s ease; touch-action: none; }
  .oh-stats-dashboard .oh-dashboard-edge::after { content: ''; position: absolute; inset: 0; margin: auto;
    background: #b7c8c6; border-radius: 4px; }
  .oh-stats-dashboard .oh-dashboard-edge.width { right: 0; top: 18%; height: 64%; width: 12px; cursor: ew-resize; }
  .oh-stats-dashboard .oh-dashboard-edge.width::after { width: 3px; height: 30px; }
  .oh-stats-dashboard .oh-dashboard-edge.height { bottom: 0; left: 18%; width: 64%; height: 12px; cursor: ns-resize; }
  .oh-stats-dashboard .oh-dashboard-edge.height::after { width: 30px; height: 3px; }
  .oh-stats-dashboard .oh-dashboard-edge.corner { right: 0; bottom: 0; width: 23px; height: 23px; cursor: nwse-resize; }
  .oh-stats-dashboard .oh-dashboard-edge.corner::after { width: 9px; height: 9px; border-right: 2px solid #b7c8c6;
    border-bottom: 2px solid #b7c8c6; border-radius: 0; background: transparent; top: auto; left: auto; right: 5px; bottom: 5px; }
  .oh-stats-dashboard .oh-dashboard-card:hover .oh-dashboard-edge,
  .oh-stats-dashboard .oh-dashboard-card:focus-within .oh-dashboard-edge,
  .oh-stats-dashboard .oh-dashboard-card.is-selected .oh-dashboard-edge { opacity: .8; }
  .oh-stats-dashboard .oh-dashboard-edge:focus-visible { opacity: 1; outline: 2px solid #93c5fd; outline-offset: -2px; }
  .oh-stats-dashboard .oh-dashboard-edge:hover { background: rgba(170,220,214,.10); opacity: 1; }
  @media (pointer: coarse) { .oh-stats-dashboard.is-editing .oh-dashboard-edge { opacity: .65; } }
  @media (prefers-reduced-motion: reduce) { .oh-stats-dashboard .oh-dashboard-card,
    .oh-stats-dashboard .oh-dashboard-edge { transition: none; } }
`;

// These illustrative rows are editor fixtures, not military state or a second power formula.
const MILITARY_PREVIEW_ROWS = Object.freeze(['Troop quality', 'Technology', 'Spending', 'Manpower share',
  'War weariness', 'War resources', 'Land', 'Naval', 'Air']);
export function DashboardMilitaryPreview({ suppliesEnabled = true } = {}) {
  return <div style={{ width: '100%', padding: '0.65rem 0.7rem', border: '1px solid rgba(255,255,255,.1)', borderRadius: 9 }}>
    <div style={{display:'flex',justifyContent:'space-between',fontWeight:800,fontSize:12}}>
      <span>Military power</span><span data-no-translate>15.3</span>
    </div>
    <div style={{fontSize:10,color:'#a6acb1',margin:'5px 0 10px'}}>Illustrative values</div>
    {MILITARY_PREVIEW_ROWS.map((title,i) => <div key={title} style={{display:'grid',gridTemplateColumns:'6.2rem 1fr 2.7rem',gap:5,alignItems:'center',fontSize:10,marginBottom:8}}>
      <span>{title}</span>
      {title === 'War resources' && !suppliesEnabled
        ? <span style={{gridColumn:'2 / 4',color:'#a6acb1',fontStyle:'italic'}}>Supplies disabled</span>
        : <>
          <div style={{height:5,borderRadius:4,background:'#34383d'}}><div style={{height:'100%',width:`${[50,50,50,12,0,100,50,50,50][i]}%`,background:'#8a9ca7'}}/></div>
          <span style={{textAlign:'right'}}>{[50,50,50,12,0,100,50,50,50][i]}{i === 3 ? '%' : '/100'}</span>
        </>}
    </div>)}
  </div>;
}
function DashboardBreakdown({ sheet }) {
  const raw = sheet?.gdpBreakdown;
  const entries = [['agriculture','Agriculture','#22c55e'],['industry','Industry','#3b82f6'],['services','Services','#f59e0b']];
  const available = entries.every(([key]) => typeof raw?.[key] === 'number' && Number.isFinite(raw[key]) && raw[key] >= 0)
    && entries.reduce((sum,[key]) => sum+raw[key],0) > 0;
  const total = available ? entries.reduce((sum,[key]) => sum+raw[key],0) : 0;
  return <div style={{padding:'0.45rem 0.2rem'}}>
    <div style={{fontSize:12,fontWeight:750,marginBottom:10}}>GDP breakdown</div>
    {available ? <>
      <div style={{display:'flex',height:10,overflow:'hidden',borderRadius:9,marginBottom:10}}>
        {entries.map(([key,,color])=><div key={key} style={{background:color,width:`${raw[key]/total*100}%`}}/>)}
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:9}}>
        {entries.map(([key,label,color])=><span key={key} style={{fontSize:10.5,color:'#b5bec5'}}>
          <span aria-hidden="true" style={{display:'inline-block',width:7,height:7,borderRadius:2,background:color,marginRight:4}}/>
          {label} <span data-no-translate>{raw[key]}%</span></span>)}
      </div>
    </> : <div style={{fontSize:11,color:'#a1a1aa'}}>Not recorded</div>}
  </div>;
}

export default function StatsDashboard({ dashboard, definition, sheet, history = [], page = 'overview', editable = false,
  onPointerStart, onResizeStart, onPointerMove, onPointerEnd, onPointerCancel,
  onWidgetAction, onWidgetSelect, onWidgetDoubleClick, onWidgetContextMenu, selectedId = null, previewWidget = null, invalidWidget = false,
  militaryCard = null, intelligence = null, sampleModules = false, sampleSuppliesEnabled = true }) {
  const container = useRef(null);
  const lastRects = useRef(new Map());
  const lastPage = useRef(page);
  const [columns, setColumns] = useState(6);
  useEffect(() => {
    if (editable) { setColumns(6); return undefined; }
    const node = container.current;
    if (!node) return undefined;
    const update = width => setColumns(dashboardColumnsForWidth(width));
    update(node.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(entries => update(entries[0]?.contentRect?.width || node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, [editable]);
  const display = useMemo(() => editable ? dashboard.widgets.filter(w => w.page === page)
    : projectDashboardGrid(dashboard.widgets, columns, page), [dashboard, columns, page, editable]);
  // Animate committed grid changes; never animate intermediate pointer frames or
  // when the player prefers reduced motion. This never modifies the saved grid.
  useLayoutEffect(() => {
    if (!editable || !container.current || typeof window === 'undefined') return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const currentRects = new Map();
    for (const node of container.current.querySelectorAll('[data-widget-id]')) {
      currentRects.set(node.dataset.widgetId, node.getBoundingClientRect());
    }
    if (!reducedMotion && !previewWidget && lastPage.current === page) {
      for (const node of container.current.querySelectorAll('[data-widget-id]')) {
        const from = lastRects.current.get(node.dataset.widgetId);
        const to = currentRects.get(node.dataset.widgetId);
        if (!from || !to || typeof node.animate !== 'function') continue;
        const dx = from.left - to.left, dy = from.top - to.top;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        node.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
          { duration: 155, easing: 'cubic-bezier(.2,.7,.2,1)' });
      }
    }
    lastRects.current = currentRects;
    lastPage.current = page;
  }, [dashboard, editable, page, previewWidget]);
  const rows = Math.max(1, ...display.map(w => w.y + w.h));
  const keyboard = (event, original) => {
    if (!editable || !onWidgetAction || event.target !== event.currentTarget) return;
    const arrow = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!arrow || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (event.shiftKey) {
      const size = snapDashboardWidgetSize(original, arrow[0], arrow[1]);
      onWidgetAction(original.id, size);
    } else onWidgetAction(original.id, { x: original.x + arrow[0], y: original.y + arrow[1] });
  };
  return <div ref={container} className={`oh-stats-dashboard${editable ? ' is-editing' : ''}`}
    style={{ minWidth: 0, width: '100%', overflowX: editable ? 'auto' : undefined }}>
    <style>{STYLE}</style>
    {!display.length && <div role="status" style={{ fontSize: 12, color: '#a1a1aa', padding: '1rem' }}>No widgets on this tab.</div>}
    <div role="list" data-dashboard-canvas="true" tabIndex={editable ? 0 : undefined} aria-label="National Statistics dashboard"
      style={{ display: 'grid', gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`,
        gridTemplateRows: `repeat(${rows},68px)`, gap: 6, minWidth: editable ? 600 : 0 }}>
      {display.map(widget => {
        const original = dashboard.widgets.find(entry => entry.id === widget.id);
        const current = editable && previewWidget?.id === widget.id ? previewWidget : original;
        const view = editable ? current : widget;
        const systemCard = ['intelligence', 'breakdown', 'military'].includes(widget.style);
        const heading = widget.style === 'heading';
        const summary = widget.style === 'change';
        const metric = heading || systemCard ? null : dashboardMetricFor(widget.source, definition, sheet);
        const points = heading ? [] : dashboardMetricHistory(metric, history);
        const recordedChange = summary ? dashboardRecordedChange(metric, history) : null;
        const selected = editable && selectedId === original.id;
        const accent = accentColor(widget, metric);
        const bad = editable && invalidWidget && previewWidget?.id === widget.id;
        const bar = widget.style === 'bar';
        const trend = widget.style === 'trend';
        const barPossible = canShowDashboardBar(metric);
        const percent = barPossible && metric?.reading?.status === 'ready'
          ? Math.max(0, Math.min(100, ((metric.reading.value - metric.minimum) / (metric.maximum - metric.minimum)) * 100)) : 0;
        return <div key={widget.id} role="listitem" data-widget-id={widget.id}
          tabIndex={editable ? 0 : undefined} aria-label={editable ? `${widget.label || metric?.label || widget.source}: ${widget.style} card, selected ${selected}` : undefined}
          className={`oh-dashboard-card${selected ? ' is-selected' : ''}`}
          onPointerDown={editable ? event => {
            if (event.button !== 0 || event.target.closest('button,input,select,textarea')) return;
            onWidgetSelect?.(original.id);
            onPointerStart?.(event, original);
          } : undefined}
          onPointerMove={editable ? onPointerMove : undefined}
          onPointerUp={editable ? onPointerEnd : undefined}
          onPointerCancel={editable ? onPointerCancel : undefined}
          onKeyDown={event => keyboard(event, original)}
          onDoubleClick={editable ? event => { event.preventDefault(); onWidgetDoubleClick?.(original.id); } : undefined}
          onContextMenu={editable ? event => { event.preventDefault(); onWidgetContextMenu?.(event, original.id); } : undefined}
          onClick={editable ? () => onWidgetSelect?.(original.id) : undefined}
          style={{ gridColumn: `${view.x + 1} / span ${view.w}`, gridRow: `${view.y + 1} / span ${view.h}`,
            minWidth: 0, position: 'relative', overflow: 'hidden', borderRadius: 10,
            padding: systemCard ? '0.15rem' : heading ? '0.55rem 0.1rem 0.18rem' : bar ? '0.45rem 0.25rem'
              : summary ? '0.5rem 0.15rem' : trend ? '0.7rem 0.75rem 0.5rem' : '0.55rem 0.6rem',
            display: 'flex', flexDirection: 'column', gap: 4,
            background: heading || summary || bar || systemCard ? 'transparent' : widget.accent && widget.accent !== 'auto' && widget.accent !== 'neutral' ? '#202a2b' : widget.source === 'native:gdp' && (view.w >= 3 || trend) ? '#1b2c29' : '#202326',
            border: `1px solid ${bad ? '#f87171' : selected ? accent : heading || summary || bar || systemCard ? 'transparent' : 'rgba(255,255,255,0.115)'}`,
            ...(widget.accent && widget.accent !== 'auto' ? { borderLeft: `3px solid ${accent}` } : {}),
            boxShadow: selected ? '0 0 0 1px rgba(147,183,176,.25)' : undefined }}>
          {systemCard ? widget.style === 'military'
            ? (sampleModules ? <DashboardMilitaryPreview suppliesEnabled={sampleSuppliesEnabled} /> : militaryCard || <div><span>Military power</span> <span data-no-translate>{'—'}</span></div>)
            : widget.style === 'intelligence' ? <div style={{padding:'0.55rem 0.7rem',background:'#202326',borderRadius:9}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,fontWeight:750,marginBottom:9}}>
                  <span>Intelligence service</span><span data-no-translate>{Number.isFinite(intelligence) ? `${intelligence}/100` : '—'}</span>
                </div>
                <div style={{height:6,background:'#363b3e',borderRadius:6}}><div style={{height:'100%',borderRadius:6,background:'#38bdf8',width:`${Number.isFinite(intelligence)?Math.max(0,Math.min(100,intelligence)):0}%`}} /></div>
              </div> : <DashboardBreakdown sheet={sheet}/>
          : heading ? <div style={{ color: '#f0f3f4', fontSize: 12, fontWeight: 800, marginTop: 'auto' }}>
            {widget.label}
          </div> : summary ? <>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#edf1f3' }}>Change</div>
            <div data-no-translate style={{ color: '#a1abae', fontSize: 11 }}>
              {changeText(recordedChange, metric)}
            </div>
          </> : <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
            color: '#aeb8b7', fontSize: 10.5, fontWeight: 700, justifyContent: 'space-between' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{widget.label || metric?.label || widget.source}</span>
            {bar && <span data-no-translate style={{ color: '#f1f5f9', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{formatted(metric)}</span>}
            {trend && <span style={{ marginLeft: 'auto', color: '#9caaa8', fontSize: 9, fontWeight: 500 }}>HISTORY</span>}
          </div>
          {!bar && <div data-no-translate style={{ fontSize: view.w >= 3 && view.h >= 2 ? 24 : view.w >= 2 ? 17 : 14,
            letterSpacing: '-.02em', fontWeight: 800, color: valueColor(metric), lineHeight: 1.22,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatted(metric)}</div>}
          {metric?.reading?.status === 'review-required' && <div style={{ fontSize: 10, color: '#fca5a5' }}>Legacy value requires author review</div>}
          {bar && <div style={{ marginTop: 'auto', paddingTop: 5 }}>
            {barPossible ? <>
              <div role="meter" aria-label={`${metric?.label || 'Metric'} progress`}
                aria-valuemin={metric.minimum} aria-valuemax={metric.maximum}
                aria-valuenow={metric?.reading?.status === 'ready' ? metric.reading.value : undefined}
                style={{ height: 6, background: '#363b3e', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ width: `${percent}%`, height: '100%', background: accent, borderRadius: 5 }} />
              </div>
            </> : <div style={{ fontSize: 10, color: '#f4b4a4' }}>Progress needs a bounded index or percentage</div>}
          </div>}
          {trend && <div style={{ flex: 1, minHeight: 38, marginTop: 5 }}>
            <MiniChart points={points} color={accent} />
          </div>}
          {widget.source === 'native:totalPopulation' && finite(sheet?.population?.otherTerritories)
            && sheet.population.otherTerritories > 0 && finite(sheet?.population?.coreIntegrated)
            && <div data-no-translate style={{color:'#9ca9af',fontSize:10,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {`Core/integrated ${compact(sheet.population.coreIntegrated)} · Other territories ${compact(sheet.population.otherTerritories)}`}
            </div>}
          {!trend && !bar && view.h > 1 && <div style={{ color: '#9da8a6', fontSize: 10, marginTop: 'auto' }}>Current national reading</div>}
          </>}
          {editable && !heading && !summary && !systemCard && <>
            {['width', 'height', 'corner'].map(edge => <button key={edge} type="button"
              className={`oh-dashboard-edge ${edge}`} title={`Resize ${edge}`}
              aria-label={`Resize ${edge}`} onPointerDown={event => {
                event.stopPropagation();
                onWidgetSelect?.(original.id);
                onResizeStart?.(event, original, edge);
              }} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerCancel} />)}
          </>}
        </div>;
      })}
    </div>
  </div>;
}
