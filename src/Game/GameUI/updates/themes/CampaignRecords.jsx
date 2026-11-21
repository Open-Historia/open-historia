/*! Open Historia - Campaign records notice, AGPL-3.0-or-later (see LICENSE). */
import React from "react";
import { Brackets, FeatureCards, Plate, Reveal, Rule, motion, noticeDate, useNarrow, useStill } from "../updateKit.jsx";
import { RECORDS as C } from "./campaignRecordsChrome.js";

const serif = "Georgia, 'Times New Roman', serif";
const Lines = ({ x, y, width = 140, count = 5 }) =>
  Array.from({ length: count }, (_, i) => <line key={i} x1={x} y1={y+i*12} x2={x+width-(i%3)*19} y2={y+i*12} stroke={C.ink} opacity=".45" strokeWidth="2"/>);

const Illustration = ({ scene, still }) => (
  <svg viewBox="0 0 720 210" aria-hidden="true" style={{ display:"block", width:"100%", height:"auto", background:C.panel, border:"1px solid "+C.line }}>
    <rect x="12" y="12" width="696" height="186" fill="none" stroke={C.line}/>
    {Array.from({length:28},(_,i)=><line key={i} x1={20+i*25} y1="20" x2={20+i*25} y2="190" stroke={C.line} opacity=".22"/>)}
    {scene === "history" && <g>
      <path d="M93 45 Q223 20 360 54 Q493 20 627 45 V174 Q490 150 360 183 Q222 150 93 174 Z" fill={C.paper} stroke={C.accent} strokeWidth="3"/>
      <path d="M360 54 V183" stroke={C.ink} strokeWidth="3"/>
      <Lines x={124} y={76} width={193} count={7}/><Lines x={389} y={76} width={185} count={7}/>
      <path d="M543 42 V111 L556 101 L569 111 V40" fill={C.red} style={motion(still,"ohUpdFade",900,200)}/>
      <circle cx="360" cy="161" r="8" fill={C.accent} stroke={C.ink}/>
    </g>}
    {scene === "speech" && <g>
      <rect x="100" y="35" width="256" height="142" rx="2" fill={C.paper} stroke={C.accent} strokeWidth="2"/>
      <Lines x={125} y={61} width={182} count={6}/>
      <circle cx="308" cy="151" r="17" fill={C.red}/><path d="M295 151 L305 161 L320 141" stroke={C.paper} fill="none" strokeWidth="3"/>
      <path d="M356 105 H452 M440 94 L452 105 L440 116" stroke={C.accent} strokeWidth="3" fill="none" strokeDasharray="150" style={{"--oh-upd-length":"150",...motion(still,"ohUpdDraw",900,200)}}/>
      {[0,1,2].map(i=><g key={i} transform={"translate("+(490+i*55)+" 105)"}><circle cy="-24" r="15" fill={C.soft}/><path d="M-20 23 V7 Q0 -17 20 7 V23 Z" fill={C.accent}/></g>)}
    </g>}
    {scene === "finance" && <g>
      <rect x="74" y="33" width="294" height="144" fill={C.paper} stroke={C.accent} strokeWidth="2"/>
      {[0,1,2,3,4].map(i=><path key={i} d={"M92 "+(57+i*23)+" H350"} stroke={C.ink} opacity=".35"/>)}
      <path d="M220 40 V170 M294 40 V170" stroke={C.ink} opacity=".35"/>
      <Lines x={102} y={66} width={95} count={7}/>
      <path d="M384 106 H443 M431 95 L443 106 L431 117" stroke={C.accent} strokeWidth="3" fill="none"/>
      <g style={motion(still,"ohUpdRise",650,250)}>
        <path d="M474 166 V95 H517 V166 M524 166 V57 H568 V166 M575 166 V115 H620 V166" fill={C.green} stroke={C.accent} strokeWidth="2"/>
        <path d="M459 166 H639" stroke={C.paper} strokeWidth="3"/>
        <circle cx="545" cy="38" r="16" fill={C.accent} stroke={C.ink}/>
      </g>
    </g>}
    {scene === "scenario" && <g>
      {[[80,62],[80,143],[317,102],[552,60],[552,144]].map(([x,y],i)=><g key={i}><rect x={x} y={y-21} width="88" height="42" rx="2" fill={i===2?C.accent:C.paper} stroke={C.line} strokeWidth="2"/><Lines x={x+10} y={y-6} width={66} count={2}/></g>)}
      <path d="M168 62 H245 V102 H317 M168 143 H245 V102 M405 102 H478 V60 H552 M478 102 V144 H552" fill="none" stroke={C.accent} strokeWidth="3" strokeDasharray="750" style={{"--oh-upd-length":"750",...motion(still,"ohUpdDraw",1100,200)}}/>
    </g>}
  </svg>
);

const CampaignRecords = ({ banner, update }) => {
  const still=useStill();
  const narrow=useNarrow(600);
  return (
    <Plate surface={{ background:C.ground, border:"1px solid "+C.line, borderRadius:"4px" }}>
      <Brackets colour={C.accent} inset="0.6rem" length="1.3rem"/>
      <div style={{padding:narrow?"1.1rem":"1.6rem 2rem",boxSizing:"border-box"}}>
        <Reveal delay={80} style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",color:C.accent,fontFamily:serif,fontSize:"0.78rem"}}>
          <span>Open Historia</span><span>{noticeDate(update.date)}</span>
        </Reveal>
        <Rule colour={C.accent} margin="0.7rem 0"/>
        <Reveal delay={130}>
          <h1 style={{fontFamily:serif,color:C.paper,fontSize:narrow?"clamp(1.7rem,7vw,2.3rem)":"clamp(2rem,4vw,3rem)",lineHeight:1.1,margin:"0.35rem 0"}}>{banner.title}</h1>
          <div style={{color:C.accent,fontSize:"0.69rem",letterSpacing:"0.13em",marginBottom:"0.8rem"}}>{banner.subtitle}</div>
        </Reveal>
        <Illustration scene={banner.scene} still={still}/>
        <Reveal delay={230}><p style={{color:C.soft,fontFamily:serif,lineHeight:1.45,margin:"0.85rem 0"}}>{banner.lead}</p></Reveal>
        <FeatureCards sections={banner.sections??[]} accent={C.accent} soft={C.soft} font={serif} caps={false}
          card={{background:C.panel,border:"1px solid "+C.line,borderRadius:"2px"}} columns={narrow?"1fr":"repeat(2,minmax(0,1fr))"} delay={300} step={100}/>
      </div>
    </Plate>
  );
};
export default CampaignRecords;
