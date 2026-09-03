// OpenHistoria Continuum — timeline ordering R1
// Pure mechanical canonicalization for model-emitted event arrays.

const normalizeString = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

const isRealIsoDate = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalizeString(value));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= daysInMonth[month - 1];
};

export const sortTimelineEventsChronologically = (candidate) => {
  if (!candidate || typeof candidate !== "object") return false;
  const events = Array.isArray(candidate?.events) ? candidate.events : [];
  if (events.length < 2) return false;

  const rows = events.map((event, index) => ({
    event,
    index,
    date: normalizeString(event?.date),
  }));
  if (rows.some((row) => !isRealIsoDate(row.date))) return false;

  const sorted = [...rows].sort((a, b) =>
    a.date.localeCompare(b.date) || a.index - b.index
  );
  const changed = sorted.some((row, index) => row.index !== index);
  if (!changed) return false;

  candidate.events = sorted.map((row) => row.event);
  return true;
};
