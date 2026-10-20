import { $, copyText, titleCase, safeHref } from "./common.js";
import { initPlacePicker } from "./places.js";

const result = $("resultado-local");
const status = $("estado-local");
let tarifas = [];
let plan = null;

function icsEscape(text) {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function buildIcs({ name, address }) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Rota da Democracia//PT",
    "BEGIN:VEVENT",
    `UID:votar-2026-10-25-${Date.now()}@rota-da-democracia`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    // 08:00 BRT = 11:00 UTC; polls close 17:00 BRT = 20:00 UTC.
    "DTSTART:20261025T110000Z",
    "DTEND:20261025T200000Z",
    "SUMMARY:Votar no 2º turno",
    `LOCATION:${icsEscape(`${name}, ${address}`)}`,
    "DESCRIPTION:Leve documento oficial com foto ou o e-Título. As seções abrem às 8h e fecham às 17h (horário de Brasília).",
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Hora de sair para votar",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.join("\r\n")}\r\n`;
}

$("baixar-ics").addEventListener("click", () => {
  if (!plan) return;
  const blob = new Blob([buildIcs(plan)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "votar-25-de-outubro.ics";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("estado-plano").textContent = "Arquivo do calendário baixado.";
});

$("compartilhar-plano").addEventListener("click", async () => {
  if (!plan) return;
  const text =
    `Meu plano para votar no domingo, 25 de outubro (2º turno): ${plan.name}, ${plan.address}. ` +
    "As seções abrem às 8h e fecham às 17h (horário de Brasília). Levar documento oficial com foto ou o e-Título. " +
    "O ônibus é de graça no domingo, pela Resolução TSE 23.751/2026. Quer ir junto? " +
    `Veja como chegar: ${location.origin}/como-chegar`;
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
  }
  $("estado-plano").textContent = (await copyText(text)) ? "Texto do plano copiado." : "Não foi possível copiar. Selecione e copie manualmente.";
});

$("imprimir-plano").addEventListener("click", () => window.print());

const picker = initPlacePicker({
  onMunicipio(entry) {
    result.hidden = true;
    renderTarifaFor(entry);
  },
  onPlace: showPlace,
});

function showPlace(local, shard) {
  if (!local) {
    result.hidden = true;
    status.textContent = "O endereço aparece aqui depois da busca.";
    return;
  }
  const municipio = picker.municipio();
  const hasCoords = local.lat !== null && local.lon !== null;
  const addressText = `${titleCase(local.nome)}, ${titleCase(local.endereco)}, ${titleCase(shard.nome)} - ${shard.uf}`;
  const destination = hasCoords ? `${local.lat},${local.lon}` : addressText;

  const dir = (mode) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=${mode}`;
  $("rota-google").href = dir("transit");
  $("rota-pe").href = dir("walking");
  $("rota-bike").href = dir("bicycling");
  $("rota-carro").href = dir("driving");
  $("rota-waze").href = hasCoords
    ? `https://waze.com/ul?ll=${local.lat},${local.lon}&navigate=yes`
    : `https://waze.com/ul?q=${encodeURIComponent(addressText)}&navigate=yes`;
  const moovit = new URLSearchParams({ to: addressText, lang: "pt" });
  let moovitUrl = `https://moovitapp.com/?${moovit}`;
  if (hasCoords) moovitUrl += `&tll=${local.lat}_${local.lon}`;
  $("rota-moovit").href = moovitUrl;
  $("local-mapa").href = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${local.lat},${local.lon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}`;
  plan = { name: titleCase(local.nome), address: `${titleCase(local.endereco)}, ${titleCase(shard.nome)} - ${shard.uf}` };

  result.hidden = false;
  status.textContent = `Local encontrado: ${titleCase(local.nome)}.`;
  if (municipio) renderTarifaFor(municipio);
}

// ---- Tarifa zero -----------------------------------------------------

function tarifaNote(entry) {
  const parts = [];
  parts.push(
    entry.turno2
      ? "Confirmado para o 2º turno (25/10)."
      : "Confirmado só para o 1º turno; para o 2º turno ainda não há aviso da prefeitura. A regra do TSE vale mesmo assim: confira com a prefeitura.",
  );
  if (entry.modos) parts.push(`Modos: ${entry.modos}.`);
  if (entry.horario) parts.push(`Horário: ${entry.horario}.`);
  if (entry.observacao) parts.push(entry.observacao);
  return parts.join(" ");
}

function tarifaItem(entry, highlight = false) {
  const node = $("modelo-tarifa").content.firstElementChild.cloneNode(true);
  node.dataset.cd = entry.cd;
  node.classList.toggle("is-selected", highlight);
  node.querySelector(".fare-uf").textContent = entry.uf;
  node.querySelector(".fare-city").textContent = entry.municipio === "(estado)" ? "Estado inteiro" : entry.municipio;
  node.querySelector(".fare-note").textContent = tarifaNote(entry);
  const source = node.querySelector(".fare-source");
  const href = safeHref(entry.fonte, ["https://", "http://"]);
  if (href) {
    source.href = href;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
  } else {
    source.removeAttribute("href");
  }
  source.textContent = `Fonte${entry.fonteData ? ` (${entry.fonteData.split("-").reverse().join("/")})` : ""}`;
  return node;
}

function renderTarifaFor(entry) {
  const note = $("estado-tarifa");
  const list = $("tarifa-zero-lista");
  const others = $("tarifa-zero-outras");
  list.replaceChildren();
  others.replaceChildren();
  if (!entry) {
    const states = new Set(tarifas.map((item) => item.uf)).size;
    note.textContent = tarifas.length
      ? `Anúncios de ônibus grátis em ${tarifas.length} cidades e estados (${states} UFs). Escolha sua cidade para ver a sua.`
      : "Escolha sua cidade acima para ver o aviso dela.";
    return;
  }
  const mine = tarifas.find((item) => item.cd && item.cd === entry.cd);
  const stateWide = tarifas.filter((item) => item.uf === entry.uf && item.municipio === "(estado)");
  const rest = tarifas.filter((item) => item.uf === entry.uf && item !== mine && item.municipio !== "(estado)");
  if (mine) {
    note.textContent = `${titleCase(entry.nome)}: ${tarifaNote(mine)}`;
    list.append(tarifaItem(mine, true));
  } else {
    note.textContent = `Sem anúncio encontrado para ${titleCase(entry.nome)}. Pela Resolução TSE 23.751/2026, art. 23, o transporte coletivo deve ser gratuito nos dias de votação: confirme horários e linhas com a prefeitura.`;
  }
  for (const item of stateWide) list.append(tarifaItem(item));
  if (rest.length) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `Outras cidades de ${entry.uf} (${rest.length})`;
    const inner = document.createElement("ul");
    inner.className = "fare-list";
    for (const item of rest) inner.append(tarifaItem(item));
    details.append(summary, inner);
    others.append(details);
  }
}

fetch("/data/tarifa-zero.json")
  .then((response) => (response.ok ? response.json() : Promise.reject(new Error("tarifa"))))
  .then((data) => {
    tarifas = data;
    $("tarifa-zero-fallback").hidden = true;
    renderTarifaFor(picker.municipio());
  })
  .catch(() => {
    $("estado-tarifa").textContent = "Não foi possível carregar os anúncios de transporte gratuito. Confira com a prefeitura.";
  });
