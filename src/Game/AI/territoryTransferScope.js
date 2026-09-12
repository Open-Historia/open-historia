const clean = (value) => String(value ?? "").trim();

// wholeCountry is a scope statement, not a region selector. The losing polity
// therefore comes from fromCode whenever the model supplied it. Older payloads
// sometimes put the polity name in regionId, so keep that as a compatibility
// fallback only when fromCode is absent.
export const wholeCountrySourceToken = (transfer) =>
  clean(transfer?.fromCode) || clean(transfer?.regionId) || clean(transfer?.regionName);

export const expandWholeCountryTransfer = (transfer, {
  catalog = [],
  resolveOwnerName = (value) => clean(value),
  canonicalOwnerKey = (value) => clean(value).toLowerCase(),
  ownerKeyOf = () => "",
} = {}) => {
  const sourceToken = wholeCountrySourceToken(transfer);
  if (!sourceToken) return [];

  const sourceName = clean(resolveOwnerName(sourceToken)) || sourceToken;
  const sourceKey = clean(canonicalOwnerKey(sourceName));
  const toKey = clean(canonicalOwnerKey(transfer?.toCode));
  if (!sourceKey) return [];

  return (Array.isArray(catalog) ? catalog : [])
    .filter((region) => {
      const ownerKey = clean(ownerKeyOf(region?.id));
      return ownerKey === sourceKey && ownerKey !== toKey;
    })
    .map((region) => ({
      ...transfer,
      fromCode: clean(resolveOwnerName(transfer?.fromCode)) || sourceName,
      regionId: clean(region?.id),
      regionName: clean(region?.name) || clean(region?.id),
      wholeCountry: undefined,
    }))
    .filter((entry) => entry.regionId);
};
