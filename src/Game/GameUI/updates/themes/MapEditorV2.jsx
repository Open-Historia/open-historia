/*! Open Historia — Map Editor V2: the cartographer's workshop notice © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// Three illustrated pages in the existing update-notice system. Flat ink and
// parchment only. The drawing and the identity overlay are illustrations:
// they never edit the user's scenario. Motion respects the native setting.
import React, { useState } from "react";

import { Brackets, FeatureCards, Plate, Reveal, Rule, motion, forever, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import { ATLAS as C } from "./mapEditorV2Chrome.js";

const SERIF = "Georgia, 'Times New Roman', serif";
const MONO = "'Consolas', 'Courier New', monospace";
const SCENES = {
  draft: { number: "01 / 03", kicker: "THE CARTOGRAPHER'S TABLE", side: "A NEW WORKSHOP", stamp: "SURVEY / EDIT / DRAW" },
  polities: { number: "02 / 03", kicker: "THE POLITICAL ATLAS", side: "NAMES & IDENTITIES", stamp: "IDENTITY / GOVERNMENT" },
  publish: { number: "03 / 03", kicker: "THE WORLD ARCHIVE", side: "PRESERVE & CREATE", stamp: "RECOVER / PUBLISH / PLAY" },
};

const horizontal = (x1, x2, y, color = "rgba(33,51,50,0.13)") => (
  <line x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth="1" />
);

// A deliberately invented atlas, not real geopolitical borders: no historical
// assertions are made by this illustration. Label is rendered inside the SVG.
const Cartography = ({ edited = false, still = false }) => (
  <g className="oh-upd-svg">
    <rect fill={C.paper} x="0" y="0" width="650" height="250" rx="2" />
    <rect fill="none" stroke="#aa9269" strokeWidth="1.5" x="9" y="9" width="632" height="232" />
    {Array.from({ length: 11 }, (_, i) => <line key={"v" + i} x1={36 + i * 57} x2={36 + i * 57} y1="10" y2="240" stroke="#bba786" strokeWidth="0.75" opacity="0.44" />)}
    {Array.from({ length: 4 }, (_, i) => horizontal(11, 639, 45 + i * 51, "#cbb997")).map((line, i) => <g key={"h" + i} opacity="0.45">{line}</g>)}
    <path fill="#a4bbb2" d="M10 54 C71 23 103 24 158 43 C220 59 267 45 297 14 L638 14 L638 238 L10 238 Z" opacity="0.85" />
    <path fill="#789c8e" stroke="#304f49" strokeWidth="3" d="M16 168 L41 157 L59 110 L97 113 L136 73 L181 85 L211 51 L259 62 L293 34 L339 73 L381 57 L413 85 L457 79 L483 108 L516 116 L559 158 L603 147 L635 189 L635 238 L16 238 Z" />
    <path fill="#a8ac7f" stroke="#3f5847" strokeWidth="1.5" d="M38 190 L103 151 L160 168 L198 119 L258 131 L292 95 L357 117 L384 171 L348 234 L38 234 Z" />
    <path fill="#cdac77" stroke="#586651" strokeWidth="1.5" d="M389 117 L451 98 L517 132 L566 175 L599 229 L409 231 L366 182 Z" />
    <path fill="#5c8073" d="M90 130 L133 103 L153 129 L129 151 L89 151 Z M236 80 L278 75 L292 98 L266 114 L222 107 Z M458 137 L484 126 L513 157 L480 185 L447 168 Z" />
    <path fill="none" stroke="#f3e3c6" strokeWidth="4.5" d={edited ? "M270 60 L285 112 L335 133 L353 177 L336 238" : "M296 36 L296 111 L313 154 L303 235"} />
    <path fill="none" stroke="#2d4e45" strokeWidth="1.75" d={edited ? "M270 60 L285 112 L335 133 L353 177 L336 238" : "M296 36 L296 111 L313 154 L303 235"} />
    <path fill="none" stroke="#f3e3c6" strokeWidth="4" d="M91 152 L158 170 L207 157 L260 182 L300 192 M383 170 L434 178 L485 193 L524 224" />
    <path fill="none" stroke="#476058" strokeWidth="1.5" d="M91 152 L158 170 L207 157 L260 182 L300 192 M383 170 L434 178 L485 193 L524 224" />
    <g fill={C.ink} fontFamily={SERIF} fontWeight="700" letterSpacing="2">
      <text x="153" y="204" textAnchor="middle" fontSize="15">NORTHLAND</text>
      <text x="440" y="211" textAnchor="middle" fontSize="14">{edited ? "NEW UNION" : "EASTERN MARCH"}</text>
    </g>
    <g stroke="#3d5a53" fill={C.paperSoft} strokeWidth="1.4">
      <circle cx="182" cy="147" r="6" /><circle cx="445" cy="167" r="6" />
      <circle cx="317" cy="116" r="4.5" />
    </g>
    <g fill={C.ink} fontFamily={MONO} fontSize="9.5" letterSpacing="1">
      <text x="185" y="135">CAPITAL</text>
      <text x="457" y="153">CITY</text>
    </g>
    <path d="M69 42 L69 81 M49 61 L89 61 M57 49 L81 73 M81 49 L57 73" stroke={C.ink} strokeWidth="1.6" />
    <circle cx="69" cy="61" r="24" fill="none" stroke={C.ink} opacity="0.6" />
    <text x="69" y="29" textAnchor="middle" fontSize="11" fontFamily={SERIF} fill={C.ink}>N</text>
    <text x="570" y="37" textAnchor="middle" fontSize="9" letterSpacing="2" fontFamily={MONO} fill={C.ink}>ATLAS // 02</text>
    <path d="M409 28 L609 28" stroke={C.ink} opacity="0.35" strokeDasharray="2 6" />
    {edited && (
      <g>
        <path d="M270 60 L285 112 L335 133 L353 177" stroke={C.brass} strokeWidth="3" fill="none" strokeDasharray="1100" style={{ "--oh-upd-length": "1100", ...motion(still, "ohUpdDraw", 1700, 100) }} />
        {[ [270,60], [285,112], [335,133], [353,177] ].map(([x,y],i) => <g key={i}><circle cx={x} cy={y} r="8" fill={C.brass} stroke={C.ink} strokeWidth="2"/><circle cx={x} cy={y} r="2" fill={C.ink}/></g>)}
      </g>
    )}
  </g>
);

const BrassCompass = ({ still }) => (
  <g className="oh-upd-svg" transform="translate(847 156)">
    <circle r="70" fill="#243335" stroke="#a18b64" strokeWidth="2"/>
    <circle r="61" fill="none" stroke={C.brass} strokeWidth="1" strokeDasharray="3 7"/>
    <g style={forever(still, "ohUpdSpin", 24000)}>
      <path d="M0 -49 L8 -8 L48 0 L8 8 L0 49 L-8 8 L-48 0 L-8 -8 Z" fill={C.brass}/>
      <path d="M0 -49 L8 -8 L0 0 L-8 -8 Z M48 0 L8 8 L0 0 L8 -8 Z" fill={C.paper}/>
      <circle r="5" fill={C.ink} stroke={C.paper} strokeWidth="1.6"/>
    </g>
    <g fontFamily={MONO} fontSize="11" fill={C.paper} textAnchor="middle">
      <text y="-56">N</text><text y="66">S</text>
      <text x="-59" y="4">W</text><text x="59" y="4">E</text>
    </g>
  </g>
);

const DraftScene = ({ still }) => (
  <>
    <rect x="58" y="18" width="706" height="278" rx="3" fill="#11181a" stroke={C.brass} strokeWidth="1" opacity="0.55" />
    <g transform="translate(72 30)"><Cartography still={still}/></g>
    <g transform="translate(752 33)" fill={C.paperSoft} fontFamily={MONO}>
      <text y="0" fontSize="10" letterSpacing="2">DRAWING</text>
      <text y="17" fontSize="10" letterSpacing="2">INSTRUMENTS</text>
      {["01   BORDER", "02   REGION", "03   PLACE", "04   POLITY"].map((line,i)=><text key={line} y={41 + i*18} fontSize="10" fill={i===1?C.brass:C.muted}>{line}</text>)}
    </g>
    <BrassCompass still={still}/>
    <path d="M767 267 L887 267" stroke={C.brass} strokeWidth="2" />
    {Array.from({length:11},(_,i)=><line key={i} x1={771+i*11} x2={771+i*11} y1="257" y2={i%5===0?"274":"269"} stroke={C.brass} strokeWidth="1"/>)}
    <text x="830" y="291" fill={C.muted} fontSize="9" fontFamily={MONO} textAnchor="middle" letterSpacing="1.5">SCALE / 50 KM</text>
  </>
);

const PolitiesScene = ({ still, edited }) => (
  <>
    <rect fill={C.paper} stroke="#c59d68" strokeWidth="2" x="49" y="23" width="679" height="272" rx="3"/>
    <g transform="translate(60 35) scale(1.01)"><Cartography edited={edited} still={still}/></g>
    <g>
      <rect fill="#172527" stroke={C.brass} strokeWidth="1.5" x="707" y="49" width="213" height="207" rx="3"/>
      <path stroke={C.brass} d="M721 76 H902" strokeWidth="1" opacity=".6" />
      <text x="723" y="67" fill={C.brass} fontFamily={MONO} fontSize="10" letterSpacing="1.5">POLITY RECORD / 014</text>
      <text x="724" y="101" fill={C.paperSoft} fontSize="17" fontFamily={SERIF} fontWeight="700">{edited?"New Union":"Eastern March"}</text>
      <text x="724" y="120" fill={C.muted} fontSize="10" fontFamily={MONO}>STABLE COUNTRY RECORD</text>
      <path stroke={C.line} d="M723 132 H901" />
      <text x="723" y="153" fill={C.muted} fontSize="10" fontFamily={MONO}>COUNTRY NAME</text>
      <text x="902" y="153" fill={C.paperSoft} fontSize="10" fontFamily={MONO} textAnchor="end">{edited?"Edited":"Original"}</text>
      <text x="723" y="181" fill={C.muted} fontSize="10" fontFamily={MONO}>GOVERNMENT</text>
      <text x="902" y="181" fill={C.paperSoft} fontSize="10" fontFamily={MONO} textAnchor="end">Editable</text>
      <text x="723" y="209" fill={C.muted} fontSize="10" fontFamily={MONO}>TERRITORY</text>
      <text x="902" y="209" fill={C.paperSoft} fontSize="10" fontFamily={MONO} textAnchor="end">Linked</text>
      <path stroke={C.line} d="M723 221 H901" />
      <circle cx="734" cy="238" r="5" fill={edited?C.brass:C.green} />
      <text x="747" y="242" fill={C.paperSoft} fontFamily={MONO} fontSize="10">{edited?"CHANGE PREVIEW":"SOURCE RECORD"}</text>
    </g>
  </>
);

// A bounded miniature atlas. Do not nest the large Cartography illustration
// under a scaled SVG group: the notice kit's fill-box transform origins would
// move that group beyond its archive card and over neighbouring cards.
const ArchiveMap = ({ newWorld }) => (
  <>
    <rect x="22" y="52" width="340" height="168" fill="#a4bbb2" stroke="#9e8b6d"/>
    {Array.from({length:5},(_,i)=><line key={i} x1={55+i*61} x2={55+i*61} y1="53" y2="219" stroke={C.paper} strokeWidth="1" opacity="0.43"/>)}
    {Array.from({length:3},(_,i)=><line key={i} x1="23" x2="361" y1={91+i*42} y2={91+i*42} stroke={C.paper} opacity="0.43"/>)}
    <path d="M23 149 L42 138 L56 101 L96 107 L122 77 L153 89 L188 63 L221 89 L255 83 L283 107 L320 131 L361 150 L361 219 L23 219 Z"
      fill={newWorld?"#6d9687":"#819d90"} stroke={C.ink} strokeWidth="2"/>
    <path d={newWorld?"M25 169 L93 148 L134 169 L185 143 L214 171 L208 219 L25 219 Z":"M25 169 L94 147 L145 173 L189 142 L187 219 L25 219 Z"}
      fill="#a6aa7e" stroke="#45594a" strokeWidth="1"/>
    <path d="M220 148 L270 127 L320 158 L356 215 L225 218 Z" fill="#d0aa76" stroke="#586452" strokeWidth="1"/>
    <path d={newWorld?"M187 64 L193 120 L214 171 L208 219":"M188 63 L188 121 L187 169 L187 219"}
      stroke={C.paperSoft} strokeWidth="3.5" fill="none"/>
    <path d={newWorld?"M187 64 L193 120 L214 171 L208 219":"M188 63 L188 121 L187 169 L187 219"}
      stroke={C.ink} strokeWidth="1.5" fill="none"/>
    <circle cx="114" cy="160" r="4" fill={C.paperSoft} stroke={C.ink}/>
    <circle cx="291" cy="160" r="4" fill={C.paperSoft} stroke={C.ink}/>
    {newWorld && <g stroke={C.ink} fill={C.brass}>{[[187,64],[193,120],[214,171]].map(([px,py],i)=><circle key={i} cx={px} cy={py} r="4.5"/>)}</g>}
    <g fill={C.ink} fontSize="10" fontFamily={SERIF} fontWeight="700" letterSpacing="1.5">
      <text x="66" y="199">NORTHLAND</text>
      <text x="245" y="199">{newWorld?"NEW UNION":"EASTERN MARCH"}</text>
    </g>
  </>
);
const MiniArchive = ({ x, title, stamp, newWorld = false }) => (
  <g className="oh-upd-svg" transform={"translate(" + x + " 26)"}>
    <rect x="0" y="0" width="384" height="265" rx="4" fill="#293638" stroke={newWorld?C.brass:"#6c8b86"} strokeWidth="2"/>
    <rect x="14" y="16" width="356" height="233" rx="2" fill={C.paper}/>
    <ArchiveMap newWorld={newWorld}/>
    <rect x="14" y="16" width="356" height="29" fill={C.ink}/>
    <text x="27" y="35" fill={C.paperSoft} fontFamily={MONO} fontSize="12" fontWeight="700" letterSpacing="1.7">{title}</text>
    <rect x="23" y="225" width="338" height="16" fill={newWorld?"#d5b075":"#9cb6ac"}/>
    <text x="31" y="237" fill={C.ink} fontFamily={MONO} fontSize="10" letterSpacing="1">{stamp}</text>
    <circle cx="353" cy="35" r="5" fill={newWorld?C.brass:C.water}/>
  </g>
);
const PublishScene = ({ still }) => (
  <>
    <MiniArchive x={32} title="01  ORIGINAL SCENARIO" stamp="HISTORY PRESERVED"/>
    <MiniArchive x={540} title="02  NEW SCENARIO" stamp="A WORLD OF ITS OWN" newWorld/>
    <g className="oh-upd-svg">
      <rect x="421" y="129" width="115" height="56" rx="2" fill={C.ink} stroke={C.brass} strokeWidth="1.5"/>
      <path d="M432 156 H518 M507 147 L518 156 L507 165" fill="none" stroke={C.brass} strokeWidth="3" strokeLinecap="square" style={{ "--oh-upd-length":"150", ...motion(still,"ohUpdDraw",1200,350) }} strokeDasharray="150"/>
      <circle cx="479" cy="198" r="15" fill="#293638" stroke={C.brass}/>
      <path d="M471 197 l6 6 11 -14" stroke={C.brass} strokeWidth="2.6" fill="none" />
      <text x="479" y="229" textAnchor="middle" fontFamily={MONO} fontSize="10" fill={C.paperSoft} letterSpacing="1.3">SAFE COPY</text>
    </g>
  </>
);

// A flat-ink illustration that scales with the notice. On phones the central
// cartography is kept readable by cropping the edge ornament, never squashing.
const AtlasScene = ({ scene, narrow, still, edited }) => (
  <div style={{ border: "1px solid " + C.line, background:C.stage, marginTop:"1.1rem", overflow:"hidden", position:"relative" }}>
    <svg className="oh-upd-svg" aria-hidden="true" role="presentation" viewBox={narrow ? (scene === "draft" ? "105 0 590 315" : scene === "polities" ? "315 0 590 315" : "185 0 590 315") : "0 0 960 315"} style={{ display:"block", width:"100%", height:"auto" }} preserveAspectRatio="xMidYMid meet">
      <rect width="960" height="315" fill={C.stage}/>
      {Array.from({length:16},(_,i)=><line key={i} x1="0" x2="960" y1={11+i*19} y2={11+i*19} stroke={C.paperSoft} opacity="0.035"/>)}
      {scene==="draft" ? <DraftScene still={still}/> : scene==="polities" ? <PolitiesScene edited={edited} still={still}/> : <PublishScene still={still}/>}
      <path d="M0 1 H960 M0 314 H960" stroke={C.brass} opacity=".55" />
    </svg>
    <span style={{ position:"absolute", right:10, bottom:8, background:"rgba(20,28,30,0.86)", border:"1px solid "+C.line, color:C.brass, fontFamily:MONO, fontSize:9, letterSpacing:"0.1em", padding:"4px 7px" }}>
      {SCENES[scene]?.stamp}
    </span>
  </div>
);

const MapEditorV2 = ({ banner, update }) => {
  const still=useStill();
  const narrow=useNarrow(600);
  const [edited,setEdited]=useState(false);
  const scene=SCENES[banner.scene]?banner.scene:"draft";
  const info=SCENES[scene];
  return (
    <Plate surface={{ background:C.desk, border:"1px solid "+C.line, borderRadius:"5px" }}>
      <Brackets colour={C.brass} inset="0.6rem" length="1.35rem" thickness={1.5}/>
      <div style={{ boxSizing:"border-box", padding:narrow?"1.3rem 1.15rem 1.2rem":"1.6rem 2.2rem 1.9rem" }}>
        <Reveal delay={100} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" }}>
          <span style={{ color:C.brass, fontFamily:MONO, fontSize:"0.65rem", letterSpacing:"0.16em", fontWeight:700 }}>OPENHISTORIA  /  CARTOGRAPHER'S EDITION</span>
          <span style={{ color:C.muted, fontFamily:MONO, fontSize:"0.64rem", letterSpacing:"0.10em" }}>BETA  /  {noticeDate(update.date)}</span>
        </Reveal>
        <Rule colour={C.brass} margin="0.75rem 0 0.9rem"/>
        <Reveal delay={185} style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12 }}>
          <div style={{ minWidth:0 }}>
            <div style={{ color:C.brass, fontFamily:MONO, fontSize:"0.69rem", fontWeight:700, letterSpacing:"0.18em" }}>{info.kicker}</div>
            <h1 style={{ color:C.paperSoft, fontFamily:SERIF, fontWeight:700, letterSpacing:"-0.035em", fontSize:narrow?"clamp(1.65rem, 8vw, 2.45rem)":"clamp(2.1rem, 4.2vw, 3.05rem)", lineHeight:1.08, margin:"0.4rem 0 0.25rem" }}>{banner.title}</h1>
            <div style={{ color:C.brass, fontFamily:MONO, fontSize:narrow?"0.65rem":"0.74rem", letterSpacing:"0.12em" }}>{banner.subtitle}</div>
          </div>
          <div aria-hidden="true" style={{ color:C.muted, fontFamily:MONO, fontSize:narrow?"0.66rem":"0.76rem", flexShrink:0, letterSpacing:"0.06em", paddingTop:3, textAlign:"right" }}>
            <div>{info.number}</div>
            {!narrow&&<div style={{marginTop:9,color:C.brass,fontSize:"0.6rem",letterSpacing:"0.14em"}}>{info.side}</div>}
          </div>
        </Reveal>
        <AtlasScene scene={scene} narrow={narrow} still={still} edited={edited}/>
        {scene==="polities" && (
          <Reveal delay={350} style={{ display:"flex", justifyContent:"flex-end", marginTop:"0.55rem" }}>
            <button type="button" className="oh-tap" aria-label={edited?"View original borders and polity name":"Preview edited borders and polity name"} aria-pressed={edited} onClick={()=>setEdited(v=>!v)}
              style={{ border:"1px solid "+C.brass, color:C.brass, background:C.stage, fontFamily:MONO, fontSize:"0.68rem", letterSpacing:"0.08em", padding:"0.55rem 0.8rem", cursor:"pointer" }}>
              {edited?"VIEW ORIGINAL  ↺":"PREVIEW AN EDIT  ↗"}
            </button>
          </Reveal>
        )}
        <Reveal delay={260}>
          <p style={{ color:C.muted, fontFamily:SERIF, fontSize:narrow?"0.92rem":"1.04rem", lineHeight:1.45, maxWidth:"51rem", margin:"0.9rem 0 1rem" }}>{banner.lead}</p>
        </Reveal>
        <FeatureCards sections={banner.sections||[]} accent={C.brass} soft={C.muted} font={SERIF} caps={false}
          card={{background:"#202d2e",border:"1px solid "+C.line,borderRadius:"2px"}}
          columns={narrow?"1fr":"repeat(2,minmax(0,1fr))"} delay={380} step={120}/>
        <Reveal delay={570} style={{ display:"flex", justifyContent:"space-between", flexWrap:"wrap", gap:6, borderTop:"1px solid "+C.line, marginTop:"1.1rem", paddingTop:"0.7rem" }}>
          <span style={{ color:C.muted, fontFamily:MONO, fontSize:"0.59rem", letterSpacing:"0.1em" }}>A NEW WAY TO DRAW YOUR WORLD</span>
          <span style={{ color:C.brass, fontFamily:MONO, fontSize:"0.59rem", letterSpacing:"0.1em" }}>{info.number}</span>
        </Reveal>
      </div>
    </Plate>
  );
};

export default MapEditorV2;
