import { $, copyText, titleCase, safeHref } from "./common.js";
import { initPlacePicker } from "./places.js";
import {
  buildIcs,
  loadHours,
  renderQuandoIr,
  clockShift,
  googleMapsTransitUrl,
  routeHint,
  aggregateHours,
  aggregateChangeStatus,
  sectionChangeStatus,
  changeWarning,
  validHours,
  calmestHours,
} from "./hours.js";

const result = $("resultado-local");
const status = $("estado-local");
const quandoIrEl = $("quando-ir");
let tarifas = [];
let plan = null;

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
  let hourPart = "";
  if (plan.hour !== null && plan.hour !== undefined) {
    const localH = plan.hour - (plan.shift || 0);
    const suffix = plan.shift ? " (horário local)" : "";
    hourPart = `Chegar ao local às ${localH}h${suffix}. `;
  }
  const text =
    `Meu plano para votar no domingo, 25 de outubro (2º turno): ${plan.name}, ${plan.address}. ${hourPart}` +
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

function showPlace(local, shard, initialSection = null) {
  if (!local) {
    result.hidden = true;
    status.textContent = "O endereço aparece aqui depois da busca.";
    if (quandoIrEl) {
      quandoIrEl.hidden = true;
      quandoIrEl.replaceChildren();
    }
    const planoHorario = $("plano-horario");
    if (planoHorario) planoHorario.textContent = "Horário em que vou sair: ______";
    const dicaRota = $("dica-rota");
    if (dicaRota) dicaRota.textContent = routeHint(null);
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

  plan = { name: titleCase(local.nome), address: `${titleCase(local.endereco)}, ${titleCase(shard.nome)} - ${shard.uf}`, hour: null };
  const planoHorario = $("plano-horario");
  if (planoHorario) planoHorario.textContent = "Horário em que vou sair: ______";
  const dicaRota = $("dica-rota");
  if (dicaRota) dicaRota.textContent = routeHint(null);

  result.hidden = false;
  status.textContent = `Local encontrado: ${titleCase(local.nome)}.`;
  if (municipio) renderTarifaFor(municipio);

  if (quandoIrEl) {
    const request = {};
    quandoIrEl.hoursRequest = request;
    quandoIrEl.hidden = true;
    quandoIrEl.replaceChildren();

    loadHours(shard.cd)
      .then(([data, changes]) => {
        if (quandoIrEl.hoursRequest !== request || !quandoIrEl.isConnected) return;
        setupQuandoIrFlow({ local, shard, addressText, data, changes, initialSection });
      })
      .catch(() => {
        if (quandoIrEl.hoursRequest !== request) return;
        // Requirement 6: No data -> hide "Quando ir" entirely and keep current route links.
        quandoIrEl.hidden = true;
        quandoIrEl.replaceChildren();
      });
  }
}

function setupQuandoIrFlow({ local, shard, addressText, data, changes, initialSection }) {
  let activeSection = initialSection;
  const shift = clockShift(shard.uf, shard.cd);

  function applyHour(h) {
    if (plan) {
      plan.hour = h;
      plan.shift = shift;
    }
    const localH = h - shift;
    const planoHorario = $("plano-horario");
    if (planoHorario) planoHorario.textContent = `Chegar ao local às ${localH}h`;
    $("rota-google").href = googleMapsTransitUrl(local, addressText, h, shift);
    const dicaRota = $("dica-rota");
    if (dicaRota) dicaRota.textContent = routeHint(h, shift);
  }

  function refresh(targetHour = null) {
    let hours;
    let scopeText;
    let changeStatus;

    if (activeSection !== null) {
      const key = `${local.zona}-${activeSection}`;
      hours = data?.[key];
      scopeText = `Seção ${activeSection} · Zona ${local.zona}`;
      changeStatus = sectionChangeStatus(changes, local.zona, activeSection);
    } else {
      hours = aggregateHours(data, local.zona, local.secoes);
      const total = local.secoes?.length || 0;
      scopeText = `Movimento somado das ${total} seções deste local`;
      changeStatus = aggregateChangeStatus(changes, local.zona, local.secoes);
    }

    if (!validHours(hours)) {
      quandoIrEl.hidden = true;
      quandoIrEl.replaceChildren();
      return;
    }

    quandoIrEl.hidden = false;
    const warning = changeWarning(changeStatus);

    renderQuandoIr(quandoIrEl, {
      hours,
      selectedHour: targetHour,
      warning,
      scopeText,
      sections: initialSection === null ? local.secoes : null,
      currentSection: activeSection,
      shift,
      onSelectSection(sec) {
        activeSection = sec;
        refresh();
      },
      onSelectHour(h) {
        applyHour(h);
      },
    });

    const calmest = calmestHours(hours, 3);
    const chosen = targetHour !== null ? targetHour : calmest[0];
    applyHour(chosen);
  }

  refresh();
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
