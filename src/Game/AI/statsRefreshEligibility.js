// A different day or round is not new economic evidence. Native progression
// owns date movement; AI Refresh only reassesses changed canonical evidence.
export const mayReuseCountryStatsAssessment = ({
  forceReassess = false,
  rebuildNumericBaseline = false,
  previousComplete = false,
  territorialCoverageMatches = false,
  previousStateFingerprint = "",
  previousTerritorialFingerprint = "",
  territorialFingerprint = "",
  unaccountedEconomicEvents = 0,
} = {}) => Boolean(
  !forceReassess &&
  !rebuildNumericBaseline &&
  previousComplete &&
  territorialCoverageMatches &&
  previousStateFingerprint &&
  (!territorialFingerprint || previousTerritorialFingerprint === territorialFingerprint) &&
  unaccountedEconomicEvents === 0
);
