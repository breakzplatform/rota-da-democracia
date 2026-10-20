// First-round votes completed per Brasilia hour; not a queue-length estimate.
const cache = new Map();
const source = 'https://dadosabertos.tse.jus.br/dataset/resultados-2026-arquivos-transmitidos-para-totalizacao';

export function validHours(hours) {
  return Array.isArray(hours) && hours.length === 9 &&
    hours.every((count) => Number.isSafeInteger(count) && count >= 0) && hours.some((count) => count > 0);
}

export function calmHours(hours) {
  const minimum = Math.min(...hours);
  const labels = hours.flatMap((count, index) => count === minimum ? [`${index + 8}h`] : []);
  return labels.length < 2 ? labels[0] : `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`;
}

function loadHours(municipality) {
  if (!cache.has(municipality)) {
    const promise = Promise.all(['h', 'h-changes'].map(async (directory) => {
      const response = await fetch(`/data/${directory}/${encodeURIComponent(municipality)}.json`);
      if (!response.ok) throw new Error('hours');
      return response.json();
    })).catch((error) => {
      cache.delete(municipality);
      throw error;
    });
    cache.set(municipality, promise);
  }
  return cache.get(municipality);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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
  chart.append(list, element('p', 'hours-calm', hours.every((count) => count === hours[0])
    ? 'O movimento foi igual em todas as horas.' : `Mais tranquilo: ${calmHours(hours)}.`));
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
  // A selection change must invalidate an earlier request, even when it fails.
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
