/*!
 * Open Historia Map Editor - country overview uses only real authored state.
 * Editor actions remain with their existing native Country Details sections.
 */
import { countryOverviewFacts } from "./countryOverviewFacts.js";

const surface = {
  background: "var(--oh-ui-raised, rgba(255,255,255,0.04))",
  border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.12))",
  borderRadius: 11,
  padding: "12px",
  display: "grid",
  gap: 8,
};
const secondary = { fontSize: 11, lineHeight: 1.5, color: "var(--oh-ui-muted, rgba(255,255,255,0.66))" };

const DetailRow = ({ label, value }) => (
  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8, justifyContent: "space-between", borderBottom: "1px solid var(--oh-ui-line, rgba(255,255,255,0.08))", paddingBottom: 6 }}>
    <span style={secondary}>{label}</span>
    <span style={{ maxWidth: "100%", fontSize: 11.5, fontWeight: 650, textAlign: "right", overflowWrap: "anywhere" }}>{value}</span>
  </div>
);
const DetailCard = ({ title, tab, onTabChange, children }) => (
  <section style={surface}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <strong style={{ fontSize: 12.5 }}>{title}</strong>
      <button type="button" onClick={() => onTabChange(tab)}
        aria-label={`Edit ${title}`}
        style={{
          borderRadius: 7, border: "1px solid var(--oh-ui-line, rgba(255,255,255,0.15))",
          background: "var(--oh-ui-active, rgba(255,255,255,0.08))",
          color: "var(--oh-ui-text, white)", cursor: "pointer",
          fontSize: 11.5, fontWeight: 700, padding: "5px 8px",
        }}>Edit</button>
    </div>
    {children}
  </section>
);

const listText = (list) => list.length ? list.join(", ") : "Not added";

export default function CountryOverview({ current, flags, tags, polities, puppets, onTabChange }) {
  const facts = countryOverviewFacts({ current, flags, tags, polities, puppets });
  return (
    <section aria-label="Country overview" style={{ display: "grid", gap: 11, paddingTop: 5 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
        {[
          ["Owned regions", facts.regionCount],
          ["Territorial claims", facts.claimantCount],
        ].map(([label, value]) => (
          <div key={label} style={{ ...surface, gap: 4 }}>
            <strong style={{ fontSize: 21, lineHeight: 1.2 }}>{value}</strong>
            <span style={secondary}>{label}</span>
          </div>
        ))}
      </div>
      <DetailCard title="Names & identity" tab="names" onTabChange={onTabChange}>
        <DetailRow label="Current name" value={current.name} />
        <DetailRow label="Alternative names" value={listText(facts.aliases)} />
        <DetailRow label="Former names" value={listText(facts.formerNames)} />
      </DetailCard>
      <DetailCard title="Territory" tab="territory" onTabChange={onTabChange}>
        <DetailRow label="Regions owned" value={facts.regionCount} />
        <DetailRow label="Claims recorded" value={facts.claimantCount} />
        {!facts.regionCount && <span style={secondary}>This country has no territory assigned yet. It can still be edited.</span>}
      </DetailCard>
      <DetailCard title="Government & forces" tab="governance" onTabChange={onTabChange}>
        <DetailRow label="Dependency" value={facts.overlord ? `${facts.overlord} (${facts.dependencyKind || "subject"})` : "Independent"} />
        <DetailRow label="Dependent countries" value={listText(facts.dependentNames)} />
        <DetailRow label="Starting population" value={facts.population || "Not authored"} />
        <DetailRow label="Military figures" value={facts.militaryFields ? `${facts.militaryFields} authored` : "Not authored"} />
        <DetailRow label="Country note" value={facts.note || "Not authored"} />
        <span style={secondary}>Political parties, ideology and government institutions are configured in the Scenario Editor, not inferred from a country's name or aliases.</span>
      </DetailCard>
      <DetailCard title="Appearance" tab="appearance" onTabChange={onTabChange}>
        <DetailRow label="Scenario flag" value={facts.flagSet ? "Selected" : "Not set"} />
        <DetailRow label="Country tags" value={listText(facts.tags)} />
      </DetailCard>
      <span style={secondary}>
        These are the values currently authored for this country. No missing population, military or political facts are filled in automatically.
      </span>
    </section>
  );
}
