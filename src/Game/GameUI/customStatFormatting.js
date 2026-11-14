/*! Open Historia — scenario-defined metric display, AGPL-3.0-or-later. */
import { readCustomStatNumber } from "../../runtime/statIndexDefinitions.js";
import {
    economicCurrencySymbol,
    fromDisplayCurrency,
    toDisplayCurrency,
    validEconomicDisplayCurrency,
} from "../../runtime/economicDisplayCurrency.js";

// Only the GDP and GDP-per-capita monetary metrics (by their keys, `gdp` and
// `gdpPerCapita`) use the campaign display currency. Scenario-defined
// currencies for treasuries, trade and historical currencies remain
// author-controlled. Its label is the author's words, in any language, and is
// never read: a GDP labelled "PIB" or "ВВП" converts as one labelled "GDP"
// does, and a stat under the gdp key is GDP whatever it is called.
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
const GDP_KEYS = new Set(["gdp", "gdpPerCapita"]);
export const customGdpSourceCurrency = (stat) => {
    if (stat?.kind !== "currency" || String(stat?.suffix || "").trim()) return null;
    return GDP_KEYS.has(stat.key) ? GDP_SOURCE_BY_PREFIX[String(stat.prefix || "")] || null : null;
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
