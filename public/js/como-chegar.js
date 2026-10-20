import { $, showMessage, titleCase } from "./common.js";
import { initPlacePicker } from "./places.js";

const result = $("resultado-local");
const status = $("estado-local");
const form = $("form-local");
let tarifas = [];

const picker = initPlacePicker({
  onMunicipio(entry) {
    result.hidden = true;
    renderTarifaFor(entry);
  },
  onPlace: showPlace,
});

function formatCep(cep) {
  return cep && cep.length === 8 ? `CEP ${cep.slice(0, 5)}-${cep.slice(5)}` : "";
}

function showPlace(local, shard) {
  const municipio = picker.municipio();
  const hasCoords = local.lat !== null && local.lon !== null;
  const addressText = `${titleCase(local.nome)}, ${titleCase(local.endereco)}, ${titleCase(shard.nome)} - ${shard.uf}`;
  const destination = hasCoords ? `${local.lat},${local.lon}` : addressText;

  $("local-nome").textContent = titleCase(local.nome);
  $("local-endereco").textContent = titleCase(local.endereco);
  $("local-bairro").textContent = titleCase(local.bairro);
  $("local-cep").textContent = formatCep(local.cep);
  $("local-acesso").textContent = local.acessivel
    ? "Este local tem seções com acessibilidade."
    : "O TSE não informa acessibilidade neste local. Em caso de dúvida, fale com o cartório eleitoral.";

  $("rota-google").href =
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=transit`;
  const moovit = new URLSearchParams({ to: addressText, lang: "pt" });
  let moovitUrl = `https://moovitapp.com/?${moovit}`;
  if (hasCoords) moovitUrl += `&tll=${local.lat}_${local.lon}`;
  $("rota-moovit").href = moovitUrl;
  $("local-mapa").href = hasCoords
    ? `https://www.google.com/maps/search/?api=1&query=${local.lat},${local.lon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressText)}`;

  result.hidden = false;
  status.textContent = `Local encontrado: ${titleCase(local.nome)}.`;
  result.scrollIntoView({ block: "start", behavior: "smooth" });
  if (municipio) renderTarifaFor(municipio);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const error = $("erro-local");
  showMessage(error, "");
  if (!picker.municipio()) {
    showMessage(error, "Escolha o município na lista.");
    $("municipio-busca").focus();
    return;
  }
  if (picker.local()) return showPlace(picker.local(), picker.shard());
  if ($("zona").value && $("secao").value) {
    if (picker.lookupBySection()) return;
    return showMessage(error, "Não achamos essa zona e seção neste município. Confira os números no comprovante ou no e-Título.");
  }
  showMessage(error, "Informe zona e seção, ou busque o local pelo nome.");
});

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

function renderTarifaList() {
  const list = $("tarifa-zero-lista");
  const template = $("modelo-tarifa");
  list.replaceChildren();
  for (const entry of tarifas) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.cd = entry.cd;
    node.querySelector(".fare-uf").textContent = entry.uf;
    node.querySelector(".fare-city").textContent = entry.municipio;
    node.querySelector(".fare-note").textContent = tarifaNote(entry);
    const source = node.querySelector(".fare-source");
    source.href = entry.fonte;
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    source.textContent = `Fonte${entry.fonteData ? ` (${entry.fonteData.split("-").reverse().join("/")})` : ""}`;
    list.append(node);
  }
}

function renderTarifaFor(entry) {
  const note = $("estado-tarifa");
  if (!entry) {
    note.textContent = "Quando uma prefeitura confirma, o aviso entra nesta lista.";
    return;
  }
  const match = tarifas.find((item) => item.cd === entry.cd);
  note.textContent = match
    ? `${match.municipio}: ${tarifaNote(match)}`
    : `Não temos confirmação específica para ${titleCase(entry.nome)}. Pela Resolução TSE 23.751/2026, art. 23, o transporte coletivo urbano deve ser gratuito nos dias de votação. Confira horários e linhas com a prefeitura.`;
  document.querySelectorAll("#tarifa-zero-lista .fare").forEach((node) => {
    node.classList.toggle("is-selected", node.dataset.cd === entry.cd);
  });
}

fetch("/data/tarifa-zero.json")
  .then((response) => (response.ok ? response.json() : Promise.reject(new Error("tarifa"))))
  .then((data) => {
    tarifas = data;
    $("tarifa-zero-fallback").hidden = true;
    renderTarifaList();
    renderTarifaFor(picker.municipio());
  })
  .catch(() => {
    $("estado-tarifa").textContent = "Não foi possível carregar a lista de capitais. Confira com a prefeitura.";
  });
