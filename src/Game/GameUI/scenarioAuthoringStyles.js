/*! Open Historia - shared Scenario Editor authoring chrome. */
// These styles consume the existing device-local theme tokens. Semantic
// colors (warnings, party colors, relationship scores) remain independent.
export const authoringCardStyle = {
  background: "var(--oh-ui-raised, #171a22)",
  border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.08))",
  borderRadius: "16px",
  marginBottom: "0.95rem",
  padding: "1rem 1.05rem",
};
export const authoringCardRow = { alignItems:"flex-start", display:"flex", flexWrap:"wrap", gap:"0.7rem", justifyContent:"space-between" };
export const authoringCardCopy = { minWidth:0, flex:"1 1 15rem" };
export const authoringTitleStyle = { color:"var(--oh-grey-text)", fontSize:"0.95rem", fontWeight:800 };
export const authoringDescriptionStyle = { color:"var(--oh-grey-muted)", fontSize:"0.7rem", lineHeight:1.5, marginTop:"0.2rem" };
export const authoringMetaStyle = { color:"var(--oh-grey-faint)", fontSize:"0.64rem", marginTop:"0.35rem" };
export const authoringButtonStyle = {
  alignItems:"center", background:"var(--oh-grey-raised)", border:"1px solid var(--oh-grey-border-strong)",
  borderRadius:"9px", color:"var(--oh-grey-text)", cursor:"pointer", display:"inline-flex", fontSize:"0.76rem",
  fontWeight:750, gap:"0.35rem", justifyContent:"center", minHeight:"2rem", padding:"0 0.75rem",
};
export const authoringInputStyle = {
  background:"var(--oh-grey-raised)", border:"1px solid var(--oh-grey-border)", borderRadius:"10px", boxSizing:"border-box",
  color:"var(--oh-grey-text)", fontFamily:"inherit", fontSize:"0.76rem", minWidth:0,
  padding:"0.58rem 0.64rem", width:"100%",
};
export const authoringOptionStyle = { backgroundColor:"var(--oh-grey-surface)", color:"var(--oh-grey-text)" };
export const authoringLabelStyle = { color:"var(--oh-grey-muted)", display:"block", fontSize:"0.62rem", fontWeight:800, letterSpacing:"0.055em", marginBottom:"0.3rem", textTransform:"uppercase" };
export const authoringSectionStyle = { background:"var(--oh-grey-surface)", border:"1px solid var(--oh-grey-border)", borderRadius:"13px", padding:"0.72rem" };
export const authoringShellStyle = {
  background:"var(--oh-grey-bg)", border:"1px solid var(--oh-grey-border-strong)", borderRadius:"20px",
  boxShadow:"0 24px 70px rgba(0,0,0,0.52)", color:"var(--oh-grey-text)", display:"flex", flexDirection:"column",
  height:"calc(100dvh - 1.2rem)", maxHeight:"calc(100dvh - 1.2rem)", overflow:"hidden",
  width:"min(92rem, calc(100vw - 1rem))",
};
export const authoringHeaderStyle = {
  alignItems:"center", background:"var(--oh-grey-surface)", borderBottom:"1px solid var(--oh-grey-border)",
  display:"flex", gap:"0.8rem", justifyContent:"space-between", padding:"0.85rem 1rem", flexShrink:0,
};
export const authoringEyebrowStyle = { color:"var(--oh-grey-muted)", fontSize:"0.63rem", fontWeight:850, letterSpacing:"0.08em", textTransform:"uppercase" };
export const authoringHeadingStyle = { fontSize:"1.15rem", fontWeight:850, letterSpacing:"-0.025em", marginTop:"0.12rem" };
export const authoringSubheadingStyle = { color:"var(--oh-grey-muted)", fontSize:"0.69rem", marginTop:"0.16rem" };
export const authoringCloseStyle = { ...authoringButtonStyle, fontSize:"1rem", minWidth:"2.35rem", padding:0 };
export const authoringSelectedStyle = { background:"var(--oh-ui-active, var(--oh-grey-selected))", borderColor:"var(--oh-ui-accent, var(--oh-grey-border-strong))" };
