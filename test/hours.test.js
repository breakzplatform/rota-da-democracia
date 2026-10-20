import { describe, expect, it } from 'vitest';
import { calmHours, validHours } from '../public/js/hours.js';

describe('hourly turnout', () => {
  it('names all tied quietest hours without treating missing data as zero', () => {
    expect(calmHours([2, 8, 7, 9, 6, 2, 5, 3, 4])).toBe('8h e 13h');
    expect(calmHours([2, 8, 2, 9, 6, 2, 5, 3, 4])).toBe('8h, 10h e 13h');
    expect(calmHours([0, 8, 7, 9, 6, 2, 5, 3, 4])).toBe('8h');
  });

  it('requires nine nonnegative integers and at least one vote', () => {
    expect(validHours([2, 8, 7, 9, 6, 2, 5, 3, 4])).toBe(true);
    for (const value of [null, [], Array(9).fill(0), Array(9).fill(-1), Array(9).fill(1.5), Array(9).fill('1')]) {
      expect(validHours(value)).toBe(false);
    }
  });
});
