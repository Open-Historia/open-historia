/*! OpenHistoria - shared fixed-reference currency conversion.
 * Canonical GDP, AI and simulation remain in constant 2026 USD.
 * Rates on 2026-01-05: ECB C/2026/46 (https://eur-lex.europa.eu/eli/C/2026/46/oj/eng)
 * 1 EUR = 1.1664 USD, 0.86760 GBP, 8.1478 CNY, 105.3160 INR.
 * RUB: Bank of Russia official rate valid 2026-01-05 (set 2025-12-31);
 * 1 USD = 78.2267 RUB:
 * https://www.cbr.ru/currency_base/daily/?UniDbQuery.Posted=True&UniDbQuery.To=05.01.2026
 * Frozen display-only multipliers, not live FX, PPP or game-era denominations.
 */
export const DEFAULT_ECONOMIC_DISPLAY_CURRENCY = "USD";
export const ECONOMIC_DISPLAY_CURRENCIES = Object.freeze([
  Object.freeze({ code: "USD", name: "US dollar", symbol: "$" }),
  Object.freeze({ code: "EUR", name: "Euro", symbol: "€" }),
  Object.freeze({ code: "GBP", name: "British pound", symbol: "£" }),
  Object.freeze({ code: "RUB", name: "Russian ruble", symbol: "₽" }),
  Object.freeze({ code: "INR", name: "Indian rupee", symbol: "₹" }),
  Object.freeze({ code: "CNY", name: "Chinese yuan", symbol: "¥" }),
]);
const USD_TO_UNITS = Object.freeze({
  USD: 1, EUR: 1 / 1.1664, GBP: 0.86760 / 1.1664,
  RUB: 78.2267, INR: 105.3160 / 1.1664, CNY: 8.1478 / 1.1664,
});
const currencyFor = new Map(ECONOMIC_DISPLAY_CURRENCIES.map((item) => [item.code, item]));
export const normalizeEconomicDisplayCurrency = (value) => {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return currencyFor.has(code) ? code : DEFAULT_ECONOMIC_DISPLAY_CURRENCY;
};
export const validEconomicDisplayCurrency = (value) =>
  typeof value === "string" && currencyFor.has(value);
// Explicit mutations fail closed; missing legacy configuration is not an error.
export const assertEconomicDisplayCurrencyChoice = (patch) => {
  if (!patch || typeof patch !== "object" || !Object.prototype.hasOwnProperty.call(patch, "economicDisplayCurrency")) return;
  if (!validEconomicDisplayCurrency(patch.economicDisplayCurrency)) throw new Error("GDP display currency must be one of USD, EUR, GBP, RUB, INR or CNY.");
};
export const economicCurrencyLabel = (value) => {
  const entry = currencyFor.get(normalizeEconomicDisplayCurrency(value));
  return `${entry.name} (${entry.code})`;
};
export const economicCurrencySymbol = (value) =>
  currencyFor.get(normalizeEconomicDisplayCurrency(value)).symbol;
export const economicDisplayRate = (value) =>
  USD_TO_UNITS[normalizeEconomicDisplayCurrency(value)];
export const economicDisplayUnitLabel = (value) =>
  `2026-${normalizeEconomicDisplayCurrency(value)} equivalent`;
export const toDisplayCurrency = (usdValue, currency = DEFAULT_ECONOMIC_DISPLAY_CURRENCY) => {
  if (typeof usdValue !== "number" || !Number.isFinite(usdValue)) return null;
  return usdValue * economicDisplayRate(currency);
};
export const fromDisplayCurrency = (shownValue, currency = DEFAULT_ECONOMIC_DISPLAY_CURRENCY) => {
  if (typeof shownValue !== "number" || !Number.isFinite(shownValue)) return null;
  return shownValue / economicDisplayRate(currency);
};
const compactNumber = (value) => {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(abs >= 100e12 ? 0 : 1)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(abs >= 100e9 ? 0 : 1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 100e6 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 100e3 ? 0 : 1)}K`;
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
};
export const formatEconomicDisplayValue = (usdValue, currency, { compact = false, perCapita = false } = {}) => {
  const converted = toDisplayCurrency(usdValue, currency);
  if (converted === null) return "—";
  const symbol = economicCurrencySymbol(currency);
  return `${symbol}${compact ? compactNumber(converted) : perCapita ? Math.round(converted).toLocaleString() : converted.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};
