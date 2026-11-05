/*! Open Historia Continuum — institution emblem/logo resolution.
 *
 * Canonical institutions own their explicit presentation choice. Historical
 * reference packs may opt into curated authentic emblems through badgeKey. We
 * never infer a real organization from a display name or storage id.
 */

const clean = (value) => String(value ?? "").trim();
const slug = (value) => clean(value)
  .toLocaleLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 72);

// Historical/reference institutions use authentic third-party artwork rather
// than OpenHistoria redraws. These URLs point at the original official or
// archival source assets. Scenario-authored logoUrl/logoAsset values still
// take precedence, and the UI falls back to initials if a remote asset cannot
// be loaded (for example while offline).
export const BUILTIN_INSTITUTION_LOGOS = Object.freeze({
  eu: "https://upload.wikimedia.org/wikipedia/commons/b/b7/Flag_of_Europe.svg",
  nato: "https://upload.wikimedia.org/wikipedia/commons/3/37/Flag_of_NATO.svg",
  csto: "https://upload.wikimedia.org/wikipedia/commons/3/39/Emblem_of_the_Collective_Security_Treaty_Organization.svg",
  cis: "https://upload.wikimedia.org/wikipedia/commons/4/49/Emblem_of_CIS.svg",
  visegrad: "https://upload.wikimedia.org/wikipedia/commons/1/1c/Visegr%C3%A1d_Group_logo.svg",
  asean: "https://asean.org/wp-content/uploads/2024/11/ASEAN-Emblem-300x300.png",
  au: "https://upload.wikimedia.org/wikipedia/commons/5/51/Flag_of_the_African_Union.svg",
  gcc: "https://upload.wikimedia.org/wikipedia/commons/2/29/Emblem_GCC.svg",
  osce: "https://upload.wikimedia.org/wikipedia/commons/3/34/OSCE_logo.svg",
  un: "https://upload.wikimedia.org/wikipedia/commons/5/52/Emblem_of_the_United_Nations.svg",
  "arab-league": "https://upload.wikimedia.org/wikipedia/commons/b/b0/Emblem_of_the_Arab_League.svg",
  // BRICS did not have one timeless permanent emblem in 2014. The Fault Lines
  // save is in July 2014, so use the official Fortaleza summit mark from that
  // month's sixth BRICS summit rather than inventing a generic BRICS badge.
  brics: "https://upload.wikimedia.org/wikipedia/en/d/da/2014_BRICS_summit_logo.png",
  // The compact emblem used by the SCO itself. This file is hosted on Chinese
  // Wikipedia and reproduces the official Chinese/Russian circular emblem.
  sco: "https://upload.wikimedia.org/wikipedia/zh/9/9a/Shanghai_Cooperation_Organisation_(SECTSCO).svg",
  opec: "https://upload.wikimedia.org/wikipedia/commons/3/3f/OPEC_Logo.svg",
  oecd: "https://upload.wikimedia.org/wikipedia/commons/a/a2/OECD_logo.svg",
  wto: "https://upload.wikimedia.org/wikipedia/commons/5/59/WTO_Logo.svg",
  mercosur: "https://upload.wikimedia.org/wikipedia/commons/9/9a/Flag_of_Mercosur.svg",
});

const isAllowedLogoUrl = (value) => {
  const url = clean(value);
  if (!url || url.length > 2400) return false;
  if (/^data:image\/(?:png|jpe?g|webp|gif);/i.test(url)) return true;
  if (/^https?:\/\//i.test(url)) return true;
  if (/^(?:\/|\.\.?\/)/.test(url)) return true;
  // Scenario-relative public asset names such as "logos/my-alliance.png".
  if (/^[a-z0-9][a-z0-9_./%+@() -]*\.(?:svg|png|jpe?g|webp|gif)(?:[?#].*)?$/i.test(url)) return true;
  return false;
};

export const normalizeInstitutionLogoUrl = (value) => {
  const url = clean(value);
  return isAllowedLogoUrl(url) ? url.slice(0, 2400) : "";
};

export const institutionLogoUrl = (institution = {}) => {
  const explicit = normalizeInstitutionLogoUrl(
    institution?.logoUrl
      || institution?.logo
      || institution?.emblemUrl
      || institution?.emblem,
  );
  if (explicit) return explicit;

  if (institution?.logoAsset === true && clean(institution?.id)) {
    return `/api/runtime/institution-logo/${encodeURIComponent(clean(institution.id))}`;
  }

  const key = slug(institution?.badgeKey);
  return key ? (BUILTIN_INSTITUTION_LOGOS[key] || "") : "";
};
