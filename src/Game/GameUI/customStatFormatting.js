/*! Open Historia — scenario-defined metric display, AGPL-3.0-or-later. */
import { readCustomStatNumber } from "../../runtime/statIndexDefinitions.js";
import {
    economicCurrencySymbol,
    fromDisplayCurrency,
    toDisplayCurrency,
    validEconomicDisplayCurrency,
} from "../../runtime/economicDisplayCurrency.js";

// Only explicit GDP/GDP-per-capita monetary metrics use the campaign display
// currency. Scenario-defined currencies for treasuries, trade, historical
// currencies, and metrics whose GDP key was repurposed remain author-controlled.
// An authored prefix supplies the legacy metric's source display currency;
// the default $ GDP prefix follows OpenHistoria's 2026-USD convention.
// Changing display never rewrites saved values. Bare ¥ is excluded because
// it can mean Japanese yen or Chinese yuan.
const GDP_SOURCE_BY_PREFIX = Object.freeze({
    "$": "USD",
    "US$": "USD",
    "€": "EUR",
    "£": "GBP",
    "₽": "RUB",
    "₹": "INR",
    "CN¥": "CNY",
    "CNY ": "CNY",
});
export const customGdpSourceCurrency = (stat) => {
    if (stat?.kind !== "currency" || String(stat?.suffix || "").trim()) return null;
    const eligible = (stat.key === "gdp" && /^gdp$/i.test(String(stat.label || "").trim()))
        || (stat.key === "gdpPerCapita" && /^gdp\s*(?:\/\s*capita|per\s+capita)$/i.test(String(stat.label || "").trim()));
    return eligible ? GDP_SOURCE_BY_PREFIX[String(stat.prefix || "")] || null : null;
};

const formatCompactNumber = (value, { digits = 1, locale } = {}) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    const abs = Math.abs(number);
    if (abs >= 1e12) return `${(number / 1e12).toFixed(abs >= 100e12 ? 0 : digits)}T`;
    if (abs >= 1e9) return `${(number / 1e9).toFixed(abs >= 100e9 ? 0 : digits)}B`;
    if (abs >= 1e6) return `${(number / 1e6).toFixed(abs >= 100e6 ? 0 : digits)}M`;
    if (abs >= 1e3) return `${(number / 1e3).toFixed(abs >= 100e3 ? 0 : digits)}K`;
    return Number.isInteger(number) ? number.toLocaleString(locale) : number.toLocaleString(locale, { maximumFractionDigits: 2 });
};

export const formatCustomStatValue = (stat, value, { locale, economicDisplayCurrency } = {}) => {
    let number = readCustomStatNumber(value);
    if (number === null) return "—";
    let prefix = String(stat?.prefix || "");
    const sourceCurrency = customGdpSourceCurrency(stat);
    if (sourceCurrency && validEconomicDisplayCurrency(economicDisplayCurrency)) {
        // Preserve the author's numeric source denomination for existing custom
        // sheets instead of assuming legacy euro-prefixed figures were USD.
        number = toDisplayCurrency(fromDisplayCurrency(number, sourceCurrency), economicDisplayCurrency);
        prefix = economicCurrencySymbol(economicDisplayCurrency);
    }
    const decimals = Math.max(0, Math.min(4, Math.trunc(Number(stat?.decimals) || 0)));
    let body;
    if (stat?.compact) {
        body = formatCompactNumber(number, { digits: Math.min(2, decimals || 1), locale });
    } else {
        body = number.toLocaleString(locale, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        });
    }
    const suffix = String(stat?.suffix || "");
    const suffixText = suffix ? (/^[%°]/.test(suffix) ? suffix : ` ${suffix}`) : "";
    return `${prefix}${body}${suffixText}`;
};
