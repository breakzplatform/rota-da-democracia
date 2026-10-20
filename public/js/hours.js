// First-round votes completed per Brasilia hour; not a queue-length estimate.
const cache = new Map();
export const source = 'https://dadosabertos.tse.jus.br/dataset/resultados-2026-arquivos-transmitidos-para-totalizacao';

export const AM_TWO_HOURS = new Set([
  '02917', '02054', '02135', '02291', '02313', '02020',
  '02399', '98370', '02496', '02755', '98477',
]);

export function validHours(hours) {
  return Array.isArray(hours) && hours.length === 9 &&
    hours.every((count) => Number.isSafeInteger(count) && count >= 0) && hours.some((count) => count > 0);
}

export function movementLevel(count, hoursOrMax) {
  if (typeof hoursOrMax === 'number') {
    const ratio = hoursOrMax > 0 ? count / hoursOrMax : 0;
    if (ratio <= 1 / 3) return 'mais tranquilo';
    if (ratio <= 2 / 3) return 'movimento médio';
    return 'mais cheio';
  }
  const hours = hoursOrMax;
  if (!Array.isArray(hours) || hours.length < 8) {
    return 'movimento médio';
  }
  const eligible = hours.slice(0, 8);
  const min = Math.min(...eligible);
  const max = Math.max(...eligible);

  if (max === 0 || (max - min) / max < 0.2) {
    return 'movimento parecido o dia todo';
  }

  const rawR = (count - min) / (max - min);
  const r = Math.max(0, Math.min(1, rawR));

  if (r <= 1 / 3) {
    return 'mais tranquilo';
  }
  if (r <= 2 / 3) {
    return 'movimento médio';
  }
  return 'mais cheio';
}

export function movementLabel(hour, count, hoursOrMax) {
  return `${hour}h: ${movementLevel(count, hoursOrMax)}`;
}

export function calmHours(hours) {
  const eligible = hours.slice(0, 8);
  const minimum = Math.min(...eligible);
  const labels = eligible.flatMap((count, index) => count === minimum ? [`${index + 8}h`] : []);
  return labels.length < 2 ? labels[0] : `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`;
}

export function calmestHours(hours, limit = 3) {
  const eligible = hours.slice(0, 8);
  const items = eligible.map((count, index) => ({ hour: index + 8, count }));
  items.sort((a, b) => a.count - b.count || a.hour - b.hour);
  return items.slice(0, limit).map((item) => item.hour);
}

export function aggregateHours(data, zone, sections) {
  if (Array.isArray(data) && Array.isArray(data[0])) {
    let totals = null;
    for (const counts of data) {
      if (validHours(counts)) {
        if (!totals) totals = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (let i = 0; i < 9; i++) {
          totals[i] += counts[i];
        }
      }
    }
    return totals;
  }
  if (!data || !sections || !sections.length) return null;
  let totals = null;
  for (const sec of sections) {
    const key = `${zone}-${sec}`;
    const counts = data[key];
    if (validHours(counts)) {
      if (!totals) totals = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 9; i++) {
        totals[i] += counts[i];
      }
    }
  }
  return totals;
}

export function sectionChangeStatus(changes, zone, section) {
  if (!changes) return undefined;
  const key = `${zone}-${section}`;
  if (!(key in changes)) return undefined;
  return changes[key];
}

export function aggregateChangeStatus(changes, zone, sections) {
  if (!changes || !sections) return undefined;
  let hasNull = false;
  for (const sec of sections) {
    const key = `${zone}-${sec}`;
    if (key in changes) {
      const val = changes[key];
      if (val !== null && val !== undefined && val !== false) {
        return true;
      }
      if (val === null) {
        hasNull = true;
      }
    }
  }
  if (hasNull) return null;
  return undefined;
}

export function changeWarning(status) {
  if (status === null) {
    return 'Não foi possível comparar com o local do 1º turno.';
  }
  if (status !== undefined && status !== false) {
    return 'O local desta seção mudou para o 2º turno; o movimento do 1º turno pode não se repetir.';
  }
  return null;
}

export function clockShift(uf, municipalityCode) {
  const state = uf ? String(uf).toUpperCase() : '';
  const cd = municipalityCode !== undefined && municipalityCode !== null
    ? String(municipalityCode).padStart(5, '0')
    : '';
  if (state === 'AC' || (state === 'AM' && AM_TWO_HOURS.has(cd))) {
    return 2;
  }
  if (state === 'AM' || state === 'MT' || state === 'MS' || state === 'RO' || state === 'RR') {
    return 1;
  }
  if (state === 'PE' && cd === '30015') {
    return -1;
  }
  return 0;
}

export function destinationEpoch(hour, shift = 0) {
  const localH = hour - shift;
  return Math.floor(Date.UTC(2026, 9, 25, localH, 0, 0) / 1000);
}

export function googleMapsTransitUrl(local, addressText, hour, shift = 0) {
  const hasCoords = local && local.lat !== null && local.lat !== undefined && local.lon !== null && local.lon !== undefined;
  if (!hasCoords || hour === undefined || hour === null) {
    const destination = hasCoords ? `${local.lat},${local.lon}` : addressText;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=transit`;
  }
  const epoch = destinationEpoch(hour, shift);
  return `https://www.google.com/maps/dir//${local.lat},${local.lon}/data=!4m6!4m5!2m3!6e1!7e2!8j${epoch}!3e3`;
}

export function routeHint(hour, shift = 0) {
  if (hour === undefined || hour === null) {
    return 'Saia com folga: as seções abrem às 8h e fecham às 17h (horário de Brasília).';
  }
  const localH = hour - shift;
  const timeDesc = shift !== 0
    ? `${localH}h (horário local, domingo, 25/10)`
    : `${hour}h (domingo, 25/10)`;
  return `O ônibus abre no Google Maps com chegada às ${timeDesc}. No app do celular, confira o horário.`;
}

export function icsTimes(hour) {
  if (hour === undefined || hour === null) {
    return {
      dtstart: '20261025T110000Z',
      dtend: '20261025T200000Z',
    };
  }
  const utcStart = hour + 3;
  const utcEnd = utcStart + 1;
  const startStr = String(utcStart).padStart(2, '0');
  const endStr = String(utcEnd).padStart(2, '0');
  return {
    dtstart: `20261025T${startStr}0000Z`,
    dtend: `20261025T${endStr}0000Z`,
  };
}

function icsEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function buildIcs({ name, address, hour }) {
  const { dtstart, dtend } = icsTimes(hour);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Rota da Democracia//PT',
    'BEGIN:VEVENT',
    `UID:votar-2026-10-25-${Date.now()}@rota-da-democracia`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    'SUMMARY:Votar no 2º turno',
    `LOCATION:${icsEscape(`${name}, ${address}`)}`,
    'DESCRIPTION:Leve documento oficial com foto ou o e-Título. As seções abrem às 8h e fecham às 17h (horário de Brasília).',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Hora de sair para votar',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

export function loadHours(municipality) {
  const cd = String(municipality).padStart(5, '0');
  if (!cache.has(cd)) {
    const promise = Promise.all(['h', 'h-changes'].map(async (directory) => {
      const response = await fetch(`/data/${directory}/${encodeURIComponent(cd)}.json`);
      if (!response.ok) throw new Error('hours');
      return response.json();
    })).catch((error) => {
      cache.delete(cd);
      throw error;
    });
    cache.set(cd, promise);
  }
  return cache.get(cd);
}

export function closingWarning(shift = 0) {
  const localClosing = 17 - shift;
  return `Chegue antes das ${localClosing}h, quando a votação fecha.`;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderQuandoIr(container, {
  hours,
  selectedHour,
  warning = null,
  scopeText = '',
  sections = null,
  currentSection = null,
  shift = 0,
  onSelectSection = () => {},
  onSelectHour = () => {},
}) {
  container.replaceChildren();

  const title = element('h3', 'quando-ir-title', 'Quando ir');
  container.append(title);

  if (sections && sections.length > 1) {
    const selectWrap = element('div', 'quando-ir-select-wrap');
    const label = element('label', '', 'Ver só a minha seção:');
    label.setAttribute('for', 'secao-quando-ir');
    const select = element('select', '');
    select.id = 'secao-quando-ir';

    const defaultOpt = element('option', '', `Todas as seções (${sections.length})`);
    defaultOpt.value = '';
    select.append(defaultOpt);

    for (const sec of sections) {
      const opt = element('option', '', `Seção ${sec}`);
      opt.value = String(sec);
      if (currentSection !== null && String(currentSection) === String(sec)) {
        opt.selected = true;
      }
      select.append(opt);
    }

    select.addEventListener('change', () => {
      const val = select.value ? Number(select.value) : null;
      onSelectSection(val);
    });

    selectWrap.append(label, select);
    container.append(selectWrap);
  }

  if (scopeText) {
    container.append(element('p', 'hint', scopeText));
  }

  if (warning) {
    container.append(element('p', 'hours-warning', warning));
  }

  const calmHoursList = calmestHours(hours, 3);
  let activeHour = selectedHour !== undefined && selectedHour !== null ? selectedHour : calmHoursList[0];

  const calmContainer = element('div', 'quando-ir-calm');
  calmContainer.append(element('span', 'quando-ir-calm-label', 'Horas mais tranquilas:'));
  const chipsWrap = element('div', 'quando-ir-chips');
  const chipButtons = [];

  for (const h of calmHoursList) {
    const localH = h - shift;
    const chip = element('button', 'chip', `${localH}h`);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', h === activeHour ? 'true' : 'false');
    if (h === activeHour) chip.classList.add('is-selected');
    chip.addEventListener('click', () => {
      selectHour(h);
    });
    chipButtons.push({ hour: h, node: chip });
    chipsWrap.append(chip);
  }
  calmContainer.append(chipsWrap);
  container.append(calmContainer);

  const maximum = Math.max(...hours);
  const liveLabel = element('p', 'quando-ir-live');
  liveLabel.setAttribute('aria-live', 'polite');
  const liveText = element('span', 'quando-ir-live-text');
  liveLabel.append(liveText);
  container.append(liveLabel);

  const closingNotice = element('p', 'quando-ir-notice', closingWarning(shift));
  container.append(closingNotice);

  const chartList = element('div', 'hours-bars');
  chartList.setAttribute('role', 'region');
  chartList.setAttribute('aria-label', 'Gráfico de movimento por hora no 1º turno');
  const barButtons = [];

  hours.forEach((count, index) => {
    const hour = index + 8;
    const localHour = hour - shift;
    const col = element('div', 'hours-column');
    const btn = element('button', 'hours-bar-btn');
    btn.type = 'button';
    btn.setAttribute('aria-pressed', hour === activeHour ? 'true' : 'false');
    if (hour === activeHour) btn.classList.add('is-selected');

    const srLabel = `${localHour}h${hour === 16 ? ' em diante, incluindo votos após as 17h' : ` às ${localHour + 1}h`}: ${count} votos`;
    btn.append(element('span', 'sr-only', srLabel));

    const track = element('span', 'hours-track');
    track.setAttribute('aria-hidden', 'true');
    const bar = element('span', 'hours-bar');
    const pct = maximum > 0 ? (count / maximum) * 100 : 0;
    bar.style.height = `${pct}%`;
    track.append(bar);

    const axisText = [8, 10, 12, 14, 16].includes(hour) ? `${localHour}h` : '';
    const hourLabel = element('span', 'hours-hour', axisText);
    hourLabel.setAttribute('aria-hidden', 'true');

    btn.append(track, hourLabel);
    btn.addEventListener('click', () => {
      selectHour(hour);
    });

    barButtons.push({ hour, node: btn });
    col.append(btn);
    chartList.append(col);
  });
  container.append(chartList);

  const timeZoneName = shift !== 0 ? 'no horário local' : 'no horário de Brasília';
  container.append(element('p', 'hint', `Votos registrados por hora no 1º turno (04/10), ${timeZoneName}. Não mede o tempo de fila.`));
  const credit = element('p', 'hint');
  const link = element('a', '', 'TSE — arquivos transmitidos para totalização');
  link.href = source;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  credit.append('Fonte: ', link);
  container.append(credit);

  function updateDisplay() {
    const count = hours[activeHour - 8];
    const localHour = activeHour - shift;
    liveText.textContent = movementLabel(localHour, count, hours);
    closingNotice.textContent = closingWarning(shift);
    closingNotice.hidden = activeHour !== 15;

    for (const item of barButtons) {
      const isSelected = item.hour === activeHour;
      item.node.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      item.node.classList.toggle('is-selected', isSelected);
    }
    for (const item of chipButtons) {
      const isSelected = item.hour === activeHour;
      item.node.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      item.node.classList.toggle('is-selected', isSelected);
    }
  }

  function selectHour(h) {
    activeHour = h;
    updateDisplay();
    onSelectHour(h);
  }

  updateDisplay();
}

export function hoursChart(hours, zone, section, changed) {
  const chart = element('section', 'hours-card');
  const title = element('h3', '', 'Movimento no 1º turno');
  chart.setAttribute('aria-label', `Movimento no 1º turno: zona ${zone}, seção ${section}`);
  chart.append(title, element('p', 'hint', `Zona ${zone}, seção ${section} · 04/10/2026`));
  if (changed !== undefined) {
    chart.append(element('p', 'hours-warning', changed === null
      ? 'Não foi possível comparar o local com o do 1º turno. O movimento pode ser diferente.'
      : 'O local desta seção mudou para o 2º turno. O movimento e a fila do 1º turno podem não se repetir.'));
  }
  const list = element('ol', 'hours-bars');
  list.setAttribute('aria-label', 'Votos computados por hora, no horário de Brasília');
  const maximum = Math.max(...hours);
  hours.forEach((count, index) => {
    const hour = index + 8;
    const item = element('li', 'hours-column');
    const label = `${hour}h${hour === 16 ? ' em diante, incluindo votos após as 17h' : ` às ${hour + 1}h`}: ${count} votos`;
    item.append(element('span', 'sr-only', label));
    const visual = element('span', 'hours-visual');
    visual.setAttribute('aria-hidden', 'true');
    const track = element('span', 'hours-track');
    const bar = element('span', 'hours-bar');
    bar.style.height = `${count / maximum * 100}%`;
    track.append(bar);
    visual.append(element('span', 'hours-count', String(count)), track, element('span', 'hours-hour', `${hour}h`));
    item.append(visual);
    list.append(item);
  });
  const calm = calmHours(hours);
  const closingNotice = calm === '15h' ? ' Chegue antes das 17h, quando a votação fecha.' : '';
  chart.append(list, element('p', 'hours-calm', hours.slice(0, 8).every((count) => count === hours[0])
    ? 'O movimento foi igual em todas as horas.' : `Mais tranquilo: ${calm}.${closingNotice}`));
  chart.append(element('p', 'hint', 'Votos computados por hora, no horário de Brasília. A barra das 16h inclui quem votou após as 17h, ainda na fila.'));
  chart.append(element('p', 'hint', 'Isso não mede o tempo de espera. O movimento pode mudar no 2º turno.'));
  const credit = element('p', 'hint');
  const link = element('a', '', 'TSE — arquivos transmitidos para totalização');
  link.href = source;
  credit.append('Fonte: ', link);
  chart.append(credit);
  return chart;
}

export async function showHours(mount, municipality, zone, section) {
  const request = {};
  mount.hoursRequest = request;
  mount.hidden = true;
  mount.replaceChildren();
  if (!section) return;
  try {
    const [data, changes] = await loadHours(municipality);
    if (mount.hoursRequest !== request || !mount.isConnected) return;
    const key = `${zone}-${section}`;
    if (validHours(data[key])) {
      mount.append(hoursChart(data[key], zone, section, changes[key]));
      mount.hidden = false;
    }
  } catch {
    // Missing or unavailable data must not obstruct finding the polling place.
  }
}
