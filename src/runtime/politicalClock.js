/*! Open Historia — native political background clock (Continuum) */

export const POLITICAL_SIMULATION_CLOCK_VERSION = 1;
export const MAX_POLITICAL_RESPONSE_TICKS_PER_ADVANCE = 24;
const AVERAGE_MONTH_DAYS = 365.2425 / 12;

const clean = (value) => String(value ?? "").trim();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const round4 = (value) => Math.round(Number(value) * 10000) / 10000;

const parseDateParts = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { text: `${match[1]}-${match[2]}-${match[3]}`, time: date.getTime() };
};

export const politicalDaysBetween = (fromDate, toDate) => {
  const from = parseDateParts(fromDate);
  const to = parseDateParts(toDate);
  if (!from || !to || to.time <= from.time) return 0;
  return Math.max(0, Math.round((to.time - from.time) / 86400000));
};

export const normalizePoliticalSimulationClock = (value) => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const lastProcessedDate = parseDateParts(source.lastProcessedDate)?.text || "";
  const lastProcessedRound = Number(source.lastProcessedRound);
  const remainder = Number(source.responseRemainderMonths);
  return {
    schemaVersion: POLITICAL_SIMULATION_CLOCK_VERSION,
    ...(lastProcessedDate ? { lastProcessedDate } : {}),
    ...(Number.isInteger(lastProcessedRound) && lastProcessedRound >= 0 ? { lastProcessedRound } : {}),
    responseRemainderMonths: Number.isFinite(remainder) ? round4(clamp(remainder, 0, 0.9999)) : 0,
  };
};

export const buildPoliticalClockPlan = ({ clock, fromDate = "", toDate = "", round = 0 } = {}) => {
  const current = normalizePoliticalSimulationClock(clock);
  const to = parseDateParts(toDate);
  const fallbackFrom = parseDateParts(fromDate);
  const clockFrom = parseDateParts(current.lastProcessedDate);

  let effectiveFrom = fallbackFrom;
  if (clockFrom && to && clockFrom.time <= to.time) effectiveFrom = clockFrom;

  if (!to || !effectiveFrom || to.time <= effectiveFrom.time) {
    return {
      elapsedDays: 0,
      elapsedMonths: 0,
      responseTicks: 0,
      droppedResponseTicks: 0,
      effectiveFromDate: effectiveFrom?.text || "",
      toDate: to?.text || clean(toDate),
      nextClock: current,
    };
  }

  const elapsedDays = Math.max(0, Math.round((to.time - effectiveFrom.time) / 86400000));
  const elapsedMonths = round4(elapsedDays / AVERAGE_MONTH_DAYS);
  const accumulated = Math.max(0, current.responseRemainderMonths + elapsedMonths);
  const wholeTicks = Math.max(0, Math.floor(accumulated + 1e-9));
  const responseTicks = Math.min(MAX_POLITICAL_RESPONSE_TICKS_PER_ADVANCE, wholeTicks);
  const droppedResponseTicks = Math.max(0, wholeTicks - responseTicks);
  const remainder = round4(accumulated - wholeTicks);

  return {
    elapsedDays,
    elapsedMonths,
    responseTicks,
    droppedResponseTicks,
    effectiveFromDate: effectiveFrom.text,
    toDate: to.text,
    nextClock: normalizePoliticalSimulationClock({
      lastProcessedDate: to.text,
      lastProcessedRound: Math.max(0, Math.trunc(Number(round) || 0)),
      responseRemainderMonths: remainder,
    }),
  };
};
