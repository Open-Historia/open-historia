/*! Open Historia — the player's character: a read-only sheet for the person the player plays © 2026 Nicholas Krol, AGPL-3.0-or-later (see LICENSE). */
// The sheet is a readout. The character task writes it (gameplay.js); the player
// reads it here and cannot change it, the same rule the Projects board keeps for
// the events that author its content.
import React, { useMemo } from "react";
import { useRuntimeState } from "../../runtime/useRuntimeState.js";
import { normalizeCharacters, purseReconciliation } from "../../runtime/characters.js";

const selectCountry = (game) => String(game?.country ?? "");
const selectCharacters = (world) => normalizeCharacters(world?.characters);

const sectionStyle = { display: "grid", gap: 4, padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,.08)" };
const labelStyle = { color: "rgba(255,255,255,.55)", fontSize: 12, textTransform: "uppercase", letterSpacing: ".04em" };
const valueStyle = { color: "rgba(255,255,255,.92)", fontSize: 14, lineHeight: 1.4 };

const Section = ({ label, children }) => (
  <div style={sectionStyle}>
    <div style={labelStyle}>{label}</div>
    <div style={valueStyle}>{children}</div>
  </div>
);

const SKILL_ORDER = ["diplomacy", "martial", "stewardship", "intrigue", "learning", "prowess"];

export const CharacterPanel = () => {
  const country = useRuntimeState("game", selectCountry);
  const characters = useRuntimeState("world", selectCharacters);
  const character = characters.byPolity[country] ?? null;

  const ledger = useMemo(
    () => (character ? purseReconciliation(character) : null),
    [character],
  );

  if (!character) {
    return (
      <div style={{ ...sectionStyle, borderTop: "none" }}>
        <div style={valueStyle}>No character yet. One is written when the first events touch the person.</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflowY: "auto" }}>
      <div style={{ ...sectionStyle, borderTop: "none" }}>
        <div style={{ ...valueStyle, fontSize: 18, fontWeight: 600 }}>{character.name}</div>
        <div style={labelStyle}>
          {[character.birthdate && `born ${character.birthdate}`, character.sex, character.culture, character.faith]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <Section label="Titles">{character.titles.length ? character.titles.join(", ") : "None"}</Section>
      <Section label="Location">{character.location || "Unknown"}</Section>
      <Section label="Skills">
        {SKILL_ORDER.map((skill) => `${skill} ${character.skills[skill]}`).join(" · ")}
      </Section>
      <Section label="Traits">{character.traits.length ? character.traits.join(", ") : "None"}</Section>
      <Section label="Reputation">
        {`piety ${character.reputation.piety || "—"} · renown ${character.reputation.renown || "—"} · honour ${character.reputation.honour || "—"}`}
      </Section>
      <Section label={`Health: ${character.health.status}`}>
        {character.health.injuries.length
          ? character.health.injuries.map((injury) => (
              <div key={injury.id}>{`${injury.type}: ${injury.location}${injury.effects ? ` (${injury.effects})` : ""}`}</div>
            ))
          : "No injuries"}
      </Section>
      <Section label="Purse">
        {`${character.purse.amount} ${character.purse.currency}`}
        {ledger && (
          <div style={{ ...labelStyle, textTransform: "none", letterSpacing: 0, marginTop: 4 }}>
            {`start of period ${ledger.start} + income ${ledger.income} − expenses ${ledger.expenses} = ${ledger.end}`}
            {ledger.balanced ? "" : " (does not reconcile)"}
          </div>
        )}
      </Section>
      <Section label="Inventory">
        {character.inventory.length
          ? character.inventory.map((item) => (
              <div key={item.id}>{`${item.name}${item.qty > 1 ? ` ×${item.qty}` : ""} (${item.rarity})`}</div>
            ))
          : "Nothing carried"}
      </Section>
    </div>
  );
};

export const CharacterTabIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="5" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M3 14c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
