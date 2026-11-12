/*! OpenHistoria - live presentation-only GDP display currency.
 * Pure conversion and validation live in server/ for the desktop and web
 * backends; game.json is the only persisted preference owner.
 */
export {
  DEFAULT_ECONOMIC_DISPLAY_CURRENCY, ECONOMIC_DISPLAY_CURRENCIES,
  normalizeEconomicDisplayCurrency, validEconomicDisplayCurrency,
  assertEconomicDisplayCurrencyChoice, economicCurrencyLabel, economicCurrencySymbol,
  economicDisplayRate, economicDisplayUnitLabel, toDisplayCurrency, fromDisplayCurrency,
  formatEconomicDisplayValue,
} from "../../server/economicDisplayCurrency.js";
import {
  DEFAULT_ECONOMIC_DISPLAY_CURRENCY,
  normalizeEconomicDisplayCurrency,
} from "../../server/economicDisplayCurrency.js";

let activeCurrency = DEFAULT_ECONOMIC_DISPLAY_CURRENCY;
const listeners = new Set();
export const getActiveEconomicDisplayCurrency = () => activeCurrency;
export const subscribeEconomicDisplayCurrency = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const setActiveEconomicDisplayCurrency = (value) => {
  const next = normalizeEconomicDisplayCurrency(value);
  if (next === activeCurrency) return;
  activeCurrency = next;
  for (const listener of listeners) listener();
};
