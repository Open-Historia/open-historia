/*! Open Historia — scenario-defined metric display, AGPL-3.0-or-later. */
import { readCustomStatNumber } from "../../runtime/statIndexDefinitions.js";

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

export const formatCustomStatValue = (stat, value, { locale } = {}) => {
    const number = readCustomStatNumber(value);
    if (number === null) return "—";
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
    const prefix = String(stat?.prefix || "");
    const suffix = String(stat?.suffix || "");
    const suffixText = suffix ? (/^[%°]/.test(suffix) ? suffix : ` ${suffix}`) : "";
    return `${prefix}${body}${suffixText}`;
};
