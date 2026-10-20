import { describe, expect, it } from 'vitest';
import { bandText, brasiliaTime, formatBand, MAX_RESULTS, quietBand, searchAbroad } from '../public/js/abroad.js';
import fixture from './fixtures/exterior.json';

describe('brasiliaTime', () => {
  const cases = [
    ['Asia/Tokyo', 8, { hour: 20, minute: 0, dayDelta: -1 }],
    ['Europe/Lisbon', 8, { hour: 5, minute: 0, dayDelta: 0 }],
    ['Asia/Kolkata', 8, { hour: 23, minute: 30, dayDelta: -1 }],
    ['Asia/Kathmandu', 8, { hour: 23, minute: 15, dayDelta: -1 }],
    ['America/Los_Angeles', 8, { hour: 12, minute: 0, dayDelta: 0 }],
    ['Australia/Sydney', 8, { hour: 18, minute: 0, dayDelta: -1 }],
    ['Pacific/Auckland', 8, { hour: 16, minute: 0, dayDelta: -1 }],
    ['America/Denver', 8, { hour: 11, minute: 0, dayDelta: 0 }],
  ];
  it.each(cases)('%s at %ih local', (tz, hour, expected) => {
    expect(brasiliaTime(tz, hour)).toEqual(expected);
  });

  it('uses the offset in force on the given date', () => {
    expect(brasiliaTime('Europe/Lisbon', 8, '2026-10-24')).toEqual({ hour: 4, minute: 0, dayDelta: 0 });
    expect(brasiliaTime('America/Sao_Paulo', 17)).toEqual({ hour: 17, minute: 0, dayDelta: 0 });
  });

  it('can cross into the next Brasilia day', () => {
    expect(brasiliaTime('America/Los_Angeles', 17)).toEqual({ hour: 21, minute: 0, dayDelta: 0 });
    expect(brasiliaTime('Pacific/Honolulu', 17)).toEqual({ hour: 0, minute: 0, dayDelta: 1 });
  });
});

describe('quietBand', () => {
  it('rejects invalid or thin data', () => {
    expect(quietBand(null)).toBeNull();
    expect(quietBand([1, 2, 3])).toBeNull();
    expect(quietBand([5, 5, 5, 5, 5, 5, 5, 5, 5])).toBeNull();
    expect(quietBand([0, 0, 0, 0, 0, 0, 0, 0, 100])).toBeNull();
    expect(quietBand([7, 7, 7, 7, 7, 7, 7, 7, 500])).toBeNull();
    expect(quietBand(Array(9).fill(0))).toBeNull();
  });

  it('starts at the earliest minimum and extends to close neighbours', () => {
    expect(quietBand([120, 70, 64, 66, 90, 95, 110, 130, 60])).toEqual({ start: 9, end: 12, flat: false });
    expect(quietBand([100, 40, 90, 90, 90, 90, 90, 100, 5])).toEqual({ start: 9, end: 10, flat: false });
  });

  it('caps the band at three hours and ignores the 16h bucket', () => {
    expect(quietBand([100, 100, 100, 100, 100, 100, 100, 100, 1])).toEqual({ start: 8, end: 11, flat: true });
    expect(quietBand([100, 100, 100, 100, 100, 100, 100, 100, 0]).end).toBe(11);
  });

  it('marks a flat profile', () => {
    expect(quietBand([100, 105, 110, 120, 100, 100, 105, 100, 50]).flat).toBe(true);
    expect(quietBand([100, 130, 110, 120, 100, 100, 105, 100, 50]).flat).toBe(false);
  });

  it('names the band in local time', () => {
    expect(bandText({ start: 13, end: 15, flat: false })).toBe('Faixa mais tranquila: 13h–15h (hora local)');
    expect(bandText({ start: 13, end: 15, flat: true })).toBe('Movimento parecido o dia todo; a faixa mais tranquila foi 13h–15h');
  });
});

describe('formatBand', () => {
  it('shows Brasilia time with a day marker when the date differs', () => {
    expect(formatBand({ start: 9, end: 12 }, 'Asia/Tokyo')).toEqual({ local: '9h–12h', brasilia: 'sáb. 24/10, 21h–dom. 25/10, 0h' });
    expect(formatBand({ start: 13, end: 15 }, 'America/Denver')).toEqual({ local: '13h–15h', brasilia: '16h–18h' });
  });

  it('prefixes the date for early-morning Brasilia hours', () => {
    expect(formatBand({ start: 8, end: 10 }, 'Europe/Lisbon').brasilia).toBe('dom. 25/10, 5h–7h');
    expect(formatBand({ start: 10, end: 12 }, 'Europe/Lisbon').brasilia).toBe('dom. 25/10, 7h–9h');
    expect(formatBand({ start: 12, end: 14 }, 'Europe/Lisbon').brasilia).toBe('9h–11h');
  });

  it('shows minutes for fractional offsets', () => {
    expect(formatBand({ start: 12, end: 14 }, 'Asia/Kathmandu').brasilia).toBe('dom. 25/10, 3h15–5h15');
    expect(formatBand({ start: 8, end: 10 }, 'Asia/Kolkata').brasilia).toBe('sáb. 24/10, 23h30–dom. 25/10, 1h30');
  });

  it('marks each end when the band spans midnight in Brasilia', () => {
    expect(formatBand({ start: 8, end: 10 }, 'Asia/Kolkata').brasilia).toContain('–');
    expect(formatBand({ start: 6, end: 8 }, 'Pacific/Honolulu').brasilia).toBe('13h–15h');
  });
});

describe('formatBand with an unknown time zone', () => {
  it('returns the local band only instead of throwing', () => {
    expect(formatBand({ start: 13, end: 15 }, 'Mars/Olympus')).toEqual({ local: '13h–15h', brasilia: null });
  });
});

describe('searchAbroad', () => {
  it('finds a section by exact number', () => {
    const [hit] = searchAbroad(fixture, '652');
    expect(hit.type).toBe('secao');
    expect(hit.place.id).toBe('1-1234');
    expect(hit.country.iso).toBe('JP');
  });

  it('reports an unknown section', () => {
    expect(searchAbroad(fixture, '12345')).toEqual([{ type: 'semsecao', section: 12345 }]);
  });

  it('matches country, city and place ignoring accents and case', () => {
    expect(searchAbroad(fixture, 'JAPAO')[0]).toMatchObject({ type: 'pais' });
    expect(searchAbroad(fixture, 'toq')[0]).toMatchObject({ type: 'cidade' });
    const salt = searchAbroad(fixture, 'salt lake');
    expect(salt).toHaveLength(1);
    expect(salt[0]).toMatchObject({ type: 'local', place: { id: '1-4001' } });
    expect(searchAbroad(fixture, 'embaixada toquio')[0]).toMatchObject({ type: 'local' });
  });

  it('returns nothing for empty or unmatched queries and caps the list', () => {
    expect(searchAbroad(fixture, '  ')).toEqual([]);
    expect(searchAbroad(fixture, 'zzzz')).toEqual([]);
    const big = { paises: Array.from({ length: 30 }, (_, i) => ({ iso: 'XX', nome: `Pais ${i}`, cidades: [] })) };
    expect(searchAbroad(big, 'pais')).toHaveLength(MAX_RESULTS);
  });
});
