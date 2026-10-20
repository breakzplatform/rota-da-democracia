import { foldText } from "./common.js";
import { validHours } from "./hours.js";

export const ELECTION_DAY = "2026-10-25";
export const MAX_RESULTS = 20;
const BRASILIA_ZONE = "America/Sao_Paulo";
const MIN_VOTES = 60;
const BAND_TOLERANCE = 1.15;
const FLAT_TOLERANCE = 1.25;
const MAX_BAND_HOURS = 3;
const WEEKDAYS = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

const formatters = new Map();
function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric",
    }));
  }
  return formatters.get(timeZone);
}

function wallClock(timeZone, epochMs) {
  const parts = {};
  for (const { type, value } of formatter(timeZone).formatToParts(new Date(epochMs))) parts[type] = Number(value);
  return parts;
}

function wallAsUtc({ year, month, day, hour, minute }) {
  return Date.UTC(year, month - 1, day, hour, minute);
}

/** Brasília wall time of local wall time `date hour:00` in `tz`. */
export function brasiliaTime(tz, hour, date = ELECTION_DAY) {
  const [year, month, day] = date.split("-").map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour);
  let epoch = wanted;
  // Two passes settle the offset even when it changes between the guess and the answer.
  for (let pass = 0; pass < 2; pass++) epoch = wanted - (wallAsUtc(wallClock(tz, epoch)) - epoch);
  const brasilia = wallClock(BRASILIA_ZONE, epoch);
  const dayDelta = Math.round((Date.UTC(brasilia.year, brasilia.month - 1, brasilia.day) - Date.UTC(year, month - 1, day)) / 86400000);
  return { hour: brasilia.hour, minute: brasilia.minute, dayDelta };
}

/** Quietest local band within 8h-16h, or null when the data is invalid or too thin. */
export function quietBand(hours) {
  if (!validHours(hours)) return null;
  const open = hours.slice(0, 8);
  if (open.reduce((sum, count) => sum + count, 0) < MIN_VOTES) return null;
  const min = Math.min(...open);
  let low = open.indexOf(min);
  let high = low;
  while (high - low + 1 < MAX_BAND_HOURS) {
    const left = low > 0 && open[low - 1] <= BAND_TOLERANCE * min ? open[low - 1] : Infinity;
    const right = high < 7 && open[high + 1] <= BAND_TOLERANCE * min ? open[high + 1] : Infinity;
    if (left === Infinity && right === Infinity) break;
    if (right <= left) high++;
    else low--;
  }
  return { start: low + 8, end: high + 9, flat: Math.max(...open) <= FLAT_TOLERANCE * min };
}

export function bandText(band) {
  const range = `${band.start}h–${band.end}h`;
  return band.flat
    ? `Movimento parecido o dia todo; a faixa mais tranquila foi ${range}`
    : `Faixa mais tranquila: ${range} (hora local)`;
}

function dayLabel(dayDelta) {
  const [year, month, day] = ELECTION_DAY.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + dayDelta));
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${WEEKDAYS[date.getUTCDay()]} ${dd}/${mm}`;
}

function clockText({ hour, minute }) {
  return minute ? `${hour}h${String(minute).padStart(2, "0")}` : `${hour}h`;
}

/** `brasilia` is null when the device cannot resolve the time zone. */
export function formatBand(band, tz) {
  const local = `${band.start}h–${band.end}h`;
  let start;
  let end;
  try {
    start = brasiliaTime(tz, band.start);
    end = brasiliaTime(tz, band.end);
  } catch {
    return { local, brasilia: null };
  }
  let brasilia;
  // Early-morning hours read like the next day's night, so they always carry the date.
  if (start.dayDelta === end.dayDelta) {
    const prefix = start.dayDelta || start.hour < 8 ? `${dayLabel(start.dayDelta)}, ` : "";
    brasilia = `${prefix}${clockText(start)}–${clockText(end)}`;
  } else {
    const withDay = (time) => `${dayLabel(time.dayDelta)}, ${clockText(time)}`;
    brasilia = `${withDay(start)}–${withDay(end)}`;
  }
  return { local, brasilia };
}

const TYPE_ORDER = { secao: 0, pais: 1, cidade: 2, local: 3 };

function matchScore(haystacks, query, tokens) {
  let best = Infinity;
  for (const text of haystacks) {
    if (!tokens.every((token) => text.includes(token))) continue;
    let score = 3;
    if (text === query) score = 0;
    else if (text.startsWith(query)) score = 1;
    else if (text.includes(` ${query}`)) score = 2;
    best = Math.min(best, score);
  }
  return best;
}

const indexes = new WeakMap();
function indexOf(data) {
  if (indexes.has(data)) return indexes.get(data);
  const sections = new Map();
  const entries = [];
  for (const country of data.paises) {
    entries.push({ type: "pais", country, haystacks: [foldText(country.nome)] });
    for (const city of country.cidades) {
      entries.push({ type: "cidade", country, city, haystacks: [city.nomeBusca] });
      for (const place of city.locais) {
        entries.push({ type: "local", country, city, place, haystacks: [place.nomeBusca, foldText(place.cidadeLocal)] });
        for (const section of place.secoes) sections.set(section, { country, city, place });
      }
    }
  }
  const index = { sections, entries };
  indexes.set(data, index);
  return index;
}

/**
 * Ranked matches, at most MAX_RESULTS. A digits-only query is an exact section number:
 * `{type: "secao", section, country, city, place}` or `{type: "semsecao", section}` when unknown.
 */
export function searchAbroad(data, query) {
  const folded = foldText(query);
  if (!folded || !data?.paises) return [];
  const index = indexOf(data);
  if (/^\d+$/.test(folded)) {
    const section = Number(folded);
    const found = index.sections.get(section);
    return [found ? { type: "secao", section, ...found } : { type: "semsecao", section }];
  }
  const tokens = folded.split(/\s+/);
  const matches = [];
  for (const entry of index.entries) {
    const score = matchScore(entry.haystacks, folded, tokens);
    if (score < Infinity) matches.push({ score, entry });
  }
  matches.sort((a, b) => a.score - b.score || TYPE_ORDER[a.entry.type] - TYPE_ORDER[b.entry.type]);
  return matches.slice(0, MAX_RESULTS).map(({ entry }) => {
    const { haystacks, ...result } = entry;
    return result;
  });
}
