import { $ } from "./common.js";
import { bandText, formatBand, quietBand, searchAbroad } from "./abroad.js";
import { renderQuandoIr, validHours } from "./hours.js";

const PLACE_KEY = /^\d{1,6}\/\d{1,4}-\d{1,6}$/;
const SECTION = /^\d{1,6}$/;
const NO_DATA = "Sem dado do 1º turno";
const PAPER = "Sem dado: votação em cédula";
const FEW_DATA = "Poucos dados do 1º turno";

const search = $("busca-exterior");
const status = $("estado-exterior");
const results = $("resultados-exterior");
const listing = $("lista-exterior");
const placeNodes = new Map();
const countryNodes = new Map();
const cityHeadings = new Map();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const placeKey = (city, place) => `${city.cd}/${place.id}`;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function bandSummary(place) {
  if (!validHours(place.horas)) return { text: place.cedula.length === place.secoes.length ? PAPER : NO_DATA };
  const band = quietBand(place.horas);
  if (!band) return { text: FEW_DATA };
  const { local, brasilia } = formatBand(band, place.tz);
  return { band, brasilia, text: brasilia ? `${local} (local) · ${brasilia} (Brasília)` : `${local} (local)` };
}

function sectionNote(place, section) {
  if (place.cedula.includes(section)) return PAPER;
  return place.semDado.includes(section) ? NO_DATA : null;
}

function renderDetail(container, place, focusSection) {
  container.replaceChildren();
  const summary = bandSummary(place);
  const note = sectionNote(place, focusSection);
  const noteText = note ? `Seção ${focusSection}: ${note}.` : null;
  if (validHours(place.horas)) {
    container.append(element("p", "chosen", summary.band
      ? `${bandText(summary.band)}.${summary.brasilia ? ` Em Brasília: ${summary.brasilia}.` : ""}`
      : `${FEW_DATA}: não dá para indicar uma faixa.`));
    const chart = element("section", "quando-ir");
    chart.setAttribute("aria-label", `Movimento no 1º turno em ${place.nome}, na hora local`);
    renderQuandoIr(chart, {
      hours: place.horas,
      warning: noteText,
      scopeText: "Soma das seções com dado",
      clockLabel: "no horário local",
      recommend: false,
    });
    container.append(chart);
  } else {
    if (noteText) container.append(element("p", "hours-warning", noteText));
    const parts = [`${NO_DATA}.`];
    if (place.cedula.length) parts.push(`${PAPER} (${plural(place.cedula.length, "seção", "seções")}: ${place.cedula.join(", ")}).`);
    if (place.semDado.length) parts.push(`Sem registro das urnas: ${place.semDado.join(", ")}.`);
    container.append(element("p", "chosen", parts.join(" ")));
  }
  const facts = element("dl", "resumo");
  const fact = (label, value) => {
    const row = element("div");
    row.append(element("dt", "", label), element("dd", "", value));
    facts.append(row);
  };
  fact("Endereço", place.endereco);
  fact("Cidade", place.cidadeLocal);
  fact("Fuso", `Horário local de ${place.cidadeLocal} (${place.tz})`);
  fact("Seções", `${plural(place.secoes.length, "seção", "seções")}: ${place.secoes.join(", ")}`);
  fact("Eleitores", place.eleitores.toLocaleString("pt-BR"));
  if (validHours(place.horas)) {
    if (place.cedula.length) fact("Cédula", `${place.cedula.join(", ")}. ${PAPER}.`);
    if (place.semDado.length) fact("Sem dado", `${place.semDado.join(", ")}. ${NO_DATA}.`);
  }
  container.append(facts);
}

function summaryRow(...children) {
  const row = element("summary");
  const inner = element("span", "abroad-summary");
  inner.append(...children);
  row.append(inner);
  return row;
}

function buildPlace(country, city, place) {
  const details = element("details", "abroad-place");
  const summary = bandSummary(place);
  const heading = summaryRow(
    element("span", "abroad-place-name", place.nome),
    element("span", summary.band ? "abroad-place-band" : "abroad-place-band is-empty", summary.text),
  );
  const body = element("div", "abroad-place-body");
  details.append(heading, body);
  let focusSection = null;
  details.addEventListener("toggle", () => {
    if (details.open && !body.hasChildNodes()) renderDetail(body, place, focusSection);
  });
  placeNodes.set(placeKey(city, place), {
    country,
    details,
    show(section) {
      focusSection = section;
      renderDetail(body, place, focusSection);
    },
  });
  return details;
}

function buildListing(data) {
  const fragment = document.createDocumentFragment();
  for (const country of data.paises) {
    const group = element("details", "abroad-country");
    const total = country.cidades.reduce((sum, city) => sum + city.locais.length, 0);
    group.append(summaryRow(
      element("span", "abroad-country-name", country.nome),
      element("span", "abroad-count", plural(total, "local", "locais")),
    ));
    for (const city of country.cidades) {
      const section = element("section", "abroad-city");
      const heading = element("h3", "", city.nome);
      heading.tabIndex = -1;
      cityHeadings.set(city, heading);
      section.append(heading);
      for (const place of city.locais) section.append(buildPlace(country, city, place));
      group.append(section);
    }
    countryNodes.set(country, group);
    fragment.append(group);
  }
  listing.replaceChildren(fragment);
}

function setUrl(name, value) {
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set(name, value);
  history.replaceState(null, "", url);
}

function reveal(node, focusTarget = node) {
  node.scrollIntoView({ block: "start" });
  focusTarget.focus();
}

function revealPlace(key, section = null, focus = true) {
  const entry = placeNodes.get(key);
  if (!entry) return;
  countryNodes.get(entry.country).open = true;
  entry.details.open = true;
  entry.show(section);
  if (focus) reveal(entry.details, entry.details.querySelector("summary"));
  else entry.details.scrollIntoView({ block: "start" });
  if (section === null) setUrl("local", key);
  else setUrl("secao", String(section));
}

function resultButton(label, detail, onClick) {
  const item = element("li");
  const button = element("button");
  button.type = "button";
  button.append(element("span", "", label), element("span", "hint", detail));
  button.addEventListener("click", onClick);
  item.append(button);
  return item;
}

function showEmpty(message) {
  status.textContent = "Nenhum resultado.";
  results.append(element("p", "hint", message));
}

function renderResults(data, query) {
  results.replaceChildren();
  if (!query.trim()) {
    status.textContent = "";
    return;
  }
  const found = searchAbroad(data, query);
  const [first] = found;
  if (first?.type === "semsecao") {
    showEmpty(`Não achamos a seção ${first.section}. Confira o número no título ou no e-Título.`);
    return;
  }
  if (!found.length) {
    showEmpty("Nenhum local encontrado. Tente o nome da cidade, do país ou o número da seção.");
    return;
  }
  status.textContent = `${plural(found.length, "resultado", "resultados")}.`;
  const list = element("ul", "nearby-list");
  for (const hit of found) {
    if (hit.type === "pais") {
      list.append(resultButton(hit.country.nome, "País ou território", () => {
        const node = countryNodes.get(hit.country);
        node.open = true;
        reveal(node, node.querySelector("summary"));
      }));
    } else if (hit.type === "cidade") {
      list.append(resultButton(hit.city.nome, `Cidade · ${hit.country.nome}`, () => {
        countryNodes.get(hit.country).open = true;
        reveal(cityHeadings.get(hit.city));
      }));
    } else {
      const section = hit.type === "secao" ? hit.section : null;
      const label = section === null ? hit.place.nome : `Seção ${section}: ${hit.place.nome}`;
      list.append(resultButton(label, `${hit.place.cidadeLocal}, ${hit.country.nome}`, () => revealPlace(placeKey(hit.city, hit.place), section)));
    }
  }
  results.append(list);
}

function applyUrl(data) {
  const params = new URLSearchParams(location.search);
  const local = params.get("local");
  const section = params.get("secao");
  if (local && PLACE_KEY.test(local)) {
    revealPlace(local, null, false);
  } else if (section && SECTION.test(section)) {
    const [hit] = searchAbroad(data, section);
    if (hit?.type === "secao") revealPlace(placeKey(hit.city, hit.place), hit.section, false);
    else if (hit) showEmpty(`Não achamos a seção ${hit.section}. Confira o número no título ou no e-Título.`);
  }
}

async function init() {
  try {
    const response = await fetch("/data/exterior.json");
    if (!response.ok) throw new Error("exterior");
    const data = await response.json();
    buildListing(data);
    search.disabled = false;
    status.textContent = "";
    search.addEventListener("input", () => renderResults(data, search.value));
    search.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      results.querySelector("button")?.click();
    });
    applyUrl(data);
  } catch {
    status.textContent = "Não foi possível carregar os locais agora. Recarregue a página em instantes.";
    listing.replaceChildren(element("p", "hint", "A lista de locais não carregou."));
  }
}

init();
