import { describe, expect, it } from 'vitest';
import {
  aggregateChangeStatus,
  aggregateHours,
  buildIcs,
  calmHours,
  calmestHours,
  changeWarning,
  clockShift,
  closingWarning,
  destinationEpoch,
  googleMapsTransitUrl,
  hoursChart,
  icsTimes,
  movementLabel,
  movementLevel,
  renderQuandoIr,
  routeHint,
  sectionChangeStatus,
  validHours,
} from '../public/js/hours.js';

function createMockDocument() {
  function createMockElement(tag) {
    const listeners = {};
    const classes = new Set();
    const attrs = {};
    return {
      tagName: tag.toUpperCase(),
      id: '',
      style: {},
      children: [],
      hidden: false,
      value: '',
      type: '',
      selected: false,
      get textContent() {
        if (this._text !== undefined) return this._text;
        return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('');
      },
      set textContent(v) {
        this._text = String(v);
        this.children = [];
      },
      get className() {
        return Array.from(classes).join(' ');
      },
      set className(v) {
        classes.clear();
        if (v) v.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
      },
      classList: {
        add(...c) { c.forEach((name) => classes.add(name)); },
        remove(...c) { c.forEach((name) => classes.delete(name)); },
        toggle(name, force) {
          if (force === true) classes.add(name);
          else if (force === false) classes.delete(name);
          else if (classes.has(name)) classes.delete(name);
          else classes.add(name);
        },
        contains(name) { return classes.has(name); },
      },
      setAttribute(k, v) { attrs[k] = String(v); this[k] = String(v); },
      getAttribute(k) { return attrs[k] ?? null; },
      append(...nodes) {
        for (const node of nodes) {
          if (typeof node === 'string') {
            this.children.push({ textContent: node, children: [] });
          } else {
            this.children.push(node);
          }
        }
      },
      replaceChildren(...nodes) {
        this.children = [];
        this._text = undefined;
        this.append(...nodes);
      },
      addEventListener(event, fn) {
        listeners[event] = listeners[event] || [];
        listeners[event].push(fn);
      },
      dispatchEvent(event) {
        const type = typeof event === 'string' ? event : event.type;
        (listeners[type] || []).forEach((fn) => fn(event));
      },
      click() {
        this.dispatchEvent({ type: 'click' });
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const results = [];
        function match(node) {
          let matches = false;
          if (sel.startsWith('.')) {
            matches = node.classList?.contains(sel.slice(1));
          } else if (sel.startsWith('#')) {
            matches = node.id === sel.slice(1);
          } else {
            matches = node.tagName?.toLowerCase() === sel.toLowerCase();
          }
          if (matches) results.push(node);
          for (const child of node.children || []) {
            if (typeof child !== 'string') match(child);
          }
        }
        for (const child of this.children || []) {
          if (typeof child !== 'string') match(child);
        }
        return results;
      },
    };
  }
  return { createElement: createMockElement };
}

describe('hourly turnout', () => {
  it('names all tied quietest hours without treating missing data as zero', () => {
    expect(calmHours([2, 8, 7, 9, 6, 2, 5, 3, 4])).toBe('8h e 13h');
    expect(calmHours([2, 8, 2, 9, 6, 2, 5, 3, 4])).toBe('8h, 10h e 13h');
    expect(calmHours([0, 8, 7, 9, 6, 2, 5, 3, 4])).toBe('8h');
  });

  it('ignores the 16h bucket when finding calmest hours', () => {
    expect(calmHours([2, 8, 7, 9, 6, 2, 5, 3, 0])).toBe('8h e 13h');
    expect(calmHours([5, 5, 5, 5, 5, 5, 5, 2, 0])).toBe('15h');
  });

  it('requires nine nonnegative integers and at least one vote', () => {
    expect(validHours([2, 8, 7, 9, 6, 2, 5, 3, 4])).toBe(true);
    for (const value of [null, [], Array(9).fill(0), Array(9).fill(-1), Array(9).fill(1.5), Array(9).fill('1')]) {
      expect(validHours(value)).toBe(false);
    }
  });

  it('appends closing warning only when 15h is the calmest hour', () => {
    globalThis.document = createMockDocument();
    try {
      const chart15 = hoursChart([5, 5, 5, 5, 5, 5, 5, 2, 0], 1, 10);
      const calm15 = chart15.querySelector('.hours-calm');
      expect(calm15.textContent).toBe('Mais tranquilo: 15h. Chegue antes das 17h, quando a votação fecha.');

      const chart8 = hoursChart([2, 8, 7, 9, 6, 2, 5, 3, 0], 1, 10);
      const calm8 = chart8.querySelector('.hours-calm');
      expect(calm8.textContent).toBe('Mais tranquilo: 8h e 13h.');

      const chartEqual = hoursChart([4, 4, 4, 4, 4, 4, 4, 4, 1], 1, 10);
      const calmEqual = chartEqual.querySelector('.hours-calm');
      expect(calmEqual.textContent).toBe('O movimento foi igual em todas as horas.');
    } finally {
      delete globalThis.document;
    }
  });
});

describe('level labels', () => {
  it('computes level relative to range among hours 8..15 avoiding mislabeling flat profiles', () => {
    // Rio Branco zona 9 seção 50
    const rbrHours = [19, 17, 21, 24, 23, 25, 25, 22, 15];
    // 8..15 min is 17 (at 9h), max is 25 (at 13h, 14h). Range = 8. (25-17)/25 = 0.32 >= 0.2.
    // 9h (c = 17): r = 0 -> "mais tranquilo" (was previously mislabeled as "movimento médio")
    expect(movementLevel(17, rbrHours)).toBe('mais tranquilo');
    // 10h (c = 21): r = 4/8 = 0.5 -> "movimento médio"
    expect(movementLevel(21, rbrHours)).toBe('movimento médio');
    // 13h (c = 25): r = 8/8 = 1.0 -> "mais cheio"
    expect(movementLevel(25, rbrHours)).toBe('mais cheio');
    // 16h bucket (c = 15): r < 0 clamped to 0 -> "mais tranquilo"
    expect(movementLevel(15, rbrHours)).toBe('mais tranquilo');
    // 16h bucket if large (c = 50): r > 1 clamped to 1 -> "mais cheio"
    expect(movementLevel(50, rbrHours)).toBe('mais cheio');
  });

  it('labels every hour as "movimento parecido o dia todo" when (max - min) / max < 0.2', () => {
    const flatHours = [10, 10, 10, 11, 10, 10, 10, 10, 5];
    // eligible min 10, max 11; (11-10)/11 = 1/11 ~= 0.09 < 0.2
    expect(movementLevel(10, flatHours)).toBe('movimento parecido o dia todo');
    expect(movementLevel(11, flatHours)).toBe('movimento parecido o dia todo');
    expect(movementLevel(5, flatHours)).toBe('movimento parecido o dia todo');
  });

  it('formats live movement label with hour prefix', () => {
    const rbrHours = [19, 17, 21, 24, 23, 25, 25, 22, 15];
    expect(movementLabel(7, 17, rbrHours)).toBe('7h: mais tranquilo');
    expect(movementLabel(8, 21, rbrHours)).toBe('8h: movimento médio');
    expect(movementLabel(11, 25, rbrHours)).toBe('11h: mais cheio');
  });
});

describe('calmest hours ranking', () => {
  it('returns the 3 calmest hours among 8h..15h ascending by count and earlier hour for ties', () => {
    const hours = [10, 20, 5, 20, 15, 5, 30, 40, 0];
    expect(calmestHours(hours, 3)).toEqual([10, 13, 8]);
  });

  it('never includes the 16h bucket in calmest hours', () => {
    const hours = [50, 50, 50, 50, 50, 50, 50, 50, 0];
    expect(calmestHours(hours, 3)).toEqual([8, 9, 10]);
  });
});

describe('aggregation and runoff place changes', () => {
  it('aggregates section hours element-wise', () => {
    const data = {
      '1-10': [1, 2, 3, 4, 5, 6, 7, 8, 9],
      '1-11': [10, 20, 30, 40, 50, 60, 70, 80, 90],
      '1-12': [0, 0, 0, 0, 0, 0, 0, 0, 0],
    };
    expect(aggregateHours(data, 1, [10, 11, 12])).toEqual([11, 22, 33, 44, 55, 66, 77, 88, 99]);
    expect(aggregateHours(data, 1, [99])).toBeNull();
  });

  it('handles array-of-arrays input in aggregateHours', () => {
    const h1 = [1, 1, 1, 1, 1, 1, 1, 1, 1];
    const h2 = [2, 2, 2, 2, 2, 2, 2, 2, 2];
    expect(aggregateHours([h1, h2])).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 3]);
  });

  it('detects section and aggregate runoff changes', () => {
    const changes = {
      '1-10': 1050,
      '1-11': null,
    };
    expect(sectionChangeStatus(changes, 1, 10)).toBe(1050);
    expect(sectionChangeStatus(changes, 1, 11)).toBeNull();
    expect(sectionChangeStatus(changes, 1, 12)).toBeUndefined();

    expect(aggregateChangeStatus(changes, 1, [10, 11, 12])).toBe(true);
    expect(aggregateChangeStatus(changes, 1, [11, 12])).toBeNull();
    expect(aggregateChangeStatus(changes, 1, [12, 13])).toBeUndefined();
  });

  it('generates the exact warning text required for runoff changes', () => {
    expect(changeWarning(true)).toBe('O local desta seção mudou para o 2º turno; o movimento do 1º turno pode não se repetir.');
    expect(changeWarning(1234)).toBe('O local desta seção mudou para o 2º turno; o movimento do 1º turno pode não se repetir.');
    expect(changeWarning(null)).toBe('Não foi possível comparar com o local do 1º turno.');
    expect(changeWarning(undefined)).toBeNull();
  });
});

describe('clock shift, destination epoch, and Google Maps URL building', () => {
  it('computes correct clock shift by state and municipality code', () => {
    expect(clockShift('AC', '01392')).toBe(2);
    expect(clockShift('AM', '02917')).toBe(2);
    expect(clockShift('AM', '02550')).toBe(1);
    expect(clockShift('MT', '00001')).toBe(1);
    expect(clockShift('MS', '00001')).toBe(1);
    expect(clockShift('RO', '00001')).toBe(1);
    expect(clockShift('RR', '00001')).toBe(1);
    expect(clockShift('PE', '30015')).toBe(-1);
    expect(clockShift('PE', '24570')).toBe(0);
    expect(clockShift('DF', '97012')).toBe(0);
    expect(clockShift('SP', '71072')).toBe(0);
  });

  it('formats closing warning in local time by shift', () => {
    expect(closingWarning(0)).toBe('Chegue antes das 17h, quando a votação fecha.');
    expect(closingWarning(2)).toBe('Chegue antes das 15h, quando a votação fecha.');
    expect(closingWarning(1)).toBe('Chegue antes das 16h, quando a votação fecha.');
    expect(closingWarning(-1)).toBe('Chegue antes das 18h, quando a votação fecha.');
  });

  it('computes destination epoch for local arrival time on 2026-10-25', () => {
    expect(destinationEpoch(9, 2)).toBe(1792911600);
    expect(destinationEpoch(9, -1)).toBe(1792922400);
    expect(destinationEpoch(9, 0)).toBe(1792918800);
  });

  it('builds verified Google Maps transit URL with arrival epoch', () => {
    const acPlace = { lat: -9.974, lon: -67.807 };
    const url = googleMapsTransitUrl(acPlace, 'Rio Branco, AC', 9, 2);
    expect(url).toBe('https://www.google.com/maps/dir//-9.974,-67.807/data=!4m6!4m5!2m3!6e1!7e2!8j1792911600!3e3');

    const noronhaPlace = { lat: -3.854, lon: -32.423 };
    const noronhaUrl = googleMapsTransitUrl(noronhaPlace, 'Fernando de Noronha, PE', 9, -1);
    expect(noronhaUrl).toBe('https://www.google.com/maps/dir//-3.854,-32.423/data=!4m6!4m5!2m3!6e1!7e2!8j1792922400!3e3');
  });

  it('retains api=1 link without arrival time when coordinates are missing', () => {
    const noCoordsPlace = { lat: null, lon: null };
    const url = googleMapsTransitUrl(noCoordsPlace, 'Escola Municipal, Rio Branco - AC', 9, 2);
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&destination=Escola%20Municipal%2C%20Rio%20Branco%20-%20AC&travelmode=transit');
  });

  it('formats transit route hint according to shift', () => {
    expect(routeHint(9, 0)).toBe('O ônibus abre no Google Maps com chegada às 9h (domingo, 25/10). No app do celular, confira o horário.');
    expect(routeHint(9, 2)).toBe('O ônibus abre no Google Maps com chegada às 7h (horário local, domingo, 25/10). No app do celular, confira o horário.');
    expect(routeHint(null)).toBe('Saia com folga: as seções abrem às 8h e fecham às 17h (horário de Brasília).');
  });
});

describe('ICS times and buildIcs', () => {
  it('computes 1-hour UTC window from Brasília hour (H+3 to H+4)', () => {
    expect(icsTimes(8)).toEqual({
      dtstart: '20261025T110000Z',
      dtend: '20261025T120000Z',
    });
    expect(icsTimes(9)).toEqual({
      dtstart: '20261025T120000Z',
      dtend: '20261025T130000Z',
    });
    expect(icsTimes(15)).toEqual({
      dtstart: '20261025T180000Z',
      dtend: '20261025T190000Z',
    });
    expect(icsTimes(null)).toEqual({
      dtstart: '20261025T110000Z',
      dtend: '20261025T200000Z',
    });
  });

  it('builds valid iCalendar content with 1h alarm before event', () => {
    const ics = buildIcs({ name: 'Escola Exemplo', address: 'Rua A, 100', hour: 9 });
    expect(ics).toContain('DTSTART:20261025T120000Z\r\n');
    expect(ics).toContain('DTEND:20261025T130000Z\r\n');
    expect(ics).toContain('LOCATION:Escola Exemplo\\, Rua A\\, 100\r\n');
    expect(ics).toContain('TRIGGER:-PT1H\r\n');
  });
});

describe('renderQuandoIr interactive component', () => {
  it('renders Google-like bar chart and chips for Brasília (shift = 0)', () => {
    const doc = createMockDocument();
    globalThis.document = doc;
    try {
      const container = doc.createElement('div');
      const hours = [20, 40, 10, 50, 30, 80, 25, 15, 60];
      // Calmest Brasília hours: 10h (10 votes), 15h (15 votes), 8h (20 votes)
      let selectedHour = null;
      let selectedSection = null;

      renderQuandoIr(container, {
        hours,
        shift: 0,
        scopeText: 'Movimento somado das 3 seções deste local',
        sections: [10, 20, 30],
        warning: 'O local desta seção mudou para o 2º turno; o movimento do 1º turno pode não se repetir.',
        onSelectHour(h) { selectedHour = h; },
        onSelectSection(s) { selectedSection = s; },
      });

      const heading = container.querySelector('h3');
      expect(heading.textContent).toBe('Quando ir');
      const warningNode = container.querySelector('.hours-warning');
      expect(warningNode.textContent).toBe('O local desta seção mudou para o 2º turno; o movimento do 1º turno pode não se repetir.');

      // Default selection is calmest: 10h
      const liveLabel = container.querySelector('.quando-ir-live-text');
      expect(liveLabel.textContent).toBe('10h: mais tranquilo');

      // 15h notice is initially hidden
      const notice = container.querySelector('.quando-ir-notice');
      expect(notice.hidden).toBe(true);

      // Chips check (top 3: 10h, 15h, 8h)
      const chips = container.querySelectorAll('.chip');
      expect(chips.length).toBe(3);
      expect(chips[0].textContent).toBe('10h');
      expect(chips[1].textContent).toBe('15h');
      expect(chips[2].textContent).toBe('8h');
      expect(chips[0].getAttribute('aria-pressed')).toBe('true');

      // Click chip 15h
      chips[1].click();
      expect(selectedHour).toBe(15);
      expect(liveLabel.textContent).toBe('15h: mais tranquilo');
      expect(notice.hidden).toBe(false);
      expect(notice.textContent).toBe('Chegue antes das 17h, quando a votação fecha.');

      // Check axis labels: only 8, 10, 12, 14, 16 have labels
      const hourLabels = container.querySelectorAll('.hours-hour').map((n) => n.textContent);
      expect(hourLabels).toEqual(['8h', '', '10h', '', '12h', '', '14h', '', '16h']);

      // Footnote mentions Brasília
      const hints = container.querySelectorAll('.hint');
      const footnote = hints.find((h) => h.textContent.includes('Votos registrados'));
      expect(footnote.textContent).toContain('no horário de Brasília');

      // Click bar for 13h (index 5)
      const barButtons = container.querySelectorAll('.hours-bar-btn');
      barButtons[5].click();
      expect(selectedHour).toBe(13);
      expect(liveLabel.textContent).toBe('13h: mais cheio');
      expect(notice.hidden).toBe(true);

      // Section select check
      const select = container.querySelector('select');
      expect(select).not.toBeNull();
      select.value = '20';
      select.dispatchEvent({ type: 'change' });
      expect(selectedSection).toBe(20);
    } finally {
      delete globalThis.document;
    }
  });

  it('renders local time labels (6h..14h) and AC closing warning for Acre (shift = 2)', () => {
    const doc = createMockDocument();
    globalThis.document = doc;
    try {
      const container = doc.createElement('div');
      // Rio Branco zona 9 seção 50: [19, 17, 21, 24, 23, 25, 25, 22, 15]
      const hours = [19, 17, 21, 24, 23, 25, 25, 22, 15];
      // Calmest Brasília hours: 9h (17 votes), 8h (19 votes), 10h (21 votes)
      // In AC (shift = 2), local hours are: 7h, 6h, 8h
      let selectedHour = null;

      renderQuandoIr(container, {
        hours,
        shift: 2,
        onSelectHour(h) { selectedHour = h; },
      });

      // Axis labels must be local: 6h..14h (alternate columns empty)
      const hourLabels = container.querySelectorAll('.hours-hour').map((n) => n.textContent);
      expect(hourLabels).toEqual(['6h', '', '8h', '', '10h', '', '12h', '', '14h']);

      // Chips must show local hours
      const chips = container.querySelectorAll('.chip');
      expect(chips.length).toBe(3);
      expect(chips[0].textContent).toBe('7h');
      expect(chips[1].textContent).toBe('6h');
      expect(chips[2].textContent).toBe('8h');

      // Default selected hour: Brasília 9h -> local 7h
      const liveLabel = container.querySelector('.quando-ir-live-text');
      expect(liveLabel.textContent).toBe('7h: mais tranquilo');

      // Footnote says "no horário local"
      const hints = container.querySelectorAll('.hint');
      const footnote = hints.find((h) => h.textContent.includes('Votos registrados'));
      expect(footnote.textContent).toContain('no horário local');

      // Select Brasília 15h (local 13h, count 22: r = 5/8 = 0.625 -> "movimento médio")
      const barButtons = container.querySelectorAll('.hours-bar-btn');
      barButtons[7].click(); // index 7 is 15h Brasília (13h local)
      expect(selectedHour).toBe(15);
      expect(liveLabel.textContent).toBe('13h: movimento médio');
      const notice = container.querySelector('.quando-ir-notice');
      expect(notice.hidden).toBe(false);
      expect(notice.textContent).toBe('Chegue antes das 15h, quando a votação fecha.');
    } finally {
      delete globalThis.document;
    }
  });
});
