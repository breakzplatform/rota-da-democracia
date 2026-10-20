import {
  $, api, closeDialog, createTurnstile, describeError, isoToTime, NO_TURNSTILE_MESSAGE, openDialog,
  setBusy, showMessage, spokenTime, titleCase,
} from "./common.js";
import { initPlacePicker } from "./places.js";

const picker = initPlacePicker();
const form = $("form-busca");
const list = $("lista-ofertas");
const status = $("estado-ofertas");
const template = $("modelo-oferta");

function seatsText(count) {
  return count === 1 ? "1 vaga livre" : `${count} vagas livres`;
}

function renderOffers(offers) {
  list.replaceChildren();
  for (const offer of offers) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.id = offer.id;
    const time = node.querySelector("[data-saida]");
    const hhmm = isoToTime(offer.saida);
    time.textContent = `Sai às ${spokenTime(hhmm)}`;
    time.dateTime = offer.saida;
    node.querySelector(".offer-seats").textContent = seatsText(offer.vagasLivres);
    node.querySelector(".offer-name").textContent = offer.nome;
    node.querySelector(".offer-place").textContent = `Vai para: ${titleCase(offer.localNome)}`;
    node.querySelector(".offer-neighborhood").textContent = `Sai de ${offer.bairroSaida}.`;
    node.querySelector(".offer-meeting").textContent = `Encontro: ${offer.pontoEncontro}.`;
    const note = node.querySelector(".offer-note");
    note.textContent = offer.nota || "";
    note.hidden = !offer.nota;
    const access = node.querySelector(".offer-access");
    if (offer.acessivel) {
      access.textContent = "Consegue levar pessoa com mobilidade reduzida.";
      access.hidden = false;
    }
    node.querySelectorAll("[data-id]").forEach((el) => {
      el.dataset.id = offer.id;
    });
    node.querySelector('[data-acao="contato"]').dataset.local = offer.localNome;
    list.append(node);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const municipio = picker.municipio();
  const error = $("erro-busca");
  showMessage(error, "");
  if (!municipio) {
    showMessage(error, "Escolha o município na lista.");
    $("municipio-busca").focus();
    return;
  }
  const params = new URLSearchParams({ municipio: municipio.cd });
  const local = picker.local();
  if (local) params.set("localId", local.id);
  const bairro = $("bairro").value.trim();
  if (bairro) params.set("bairro", bairro);
  for (const id of ["de", "ate"]) if ($(id).value) params.set(id, $(id).value);

  const submit = form.querySelector('[type="submit"]');
  setBusy(submit, true, "Buscando...");
  status.textContent = "Buscando caronas...";
  try {
    const { ofertas } = await api(`/api/ofertas?${params}`);
    renderOffers(ofertas);
    const where = local ? `até ${titleCase(local.nome)}` : `em ${titleCase(municipio.nome)}`;
    status.textContent = ofertas.length
      ? `${ofertas.length === 1 ? "1 carona" : `${ofertas.length} caronas`} ${where}.`
      : `Nenhuma carona ${where} por enquanto. Volte mais tarde, tente outro horário ou veja o ônibus gratuito em "Como chego".`;
  } catch (failure) {
    list.replaceChildren();
    status.textContent = "";
    showMessage(error, describeError(failure));
  } finally {
    setBusy(submit, false);
  }
});

// ---- Contact dialog ------------------------------------------------

const contactDialog = $("dialogo-contato");
const ciente = $("ciente");
const contactError = $("erro-contato");
const waLink = $("link-whatsapp");
let contactOfferId = null;
let contactBusy = false;
let contactDone = false;
let contactTurnstile = null;

async function tryReveal() {
  if (contactBusy || contactDone || !contactOfferId) return;
  const token = contactTurnstile?.token();
  if (!ciente.checked) return;
  if (!token) {
    showMessage(contactError, "");
    $("resumo-contato").setAttribute("aria-busy", "true");
    return;
  }
  contactBusy = true;
  showMessage(contactError, "");
  try {
    const result = await api(`/api/ofertas/${contactOfferId}/contato`, {
      method: "POST",
      body: { turnstile: token, ciente: true },
    });
    contactDone = true;
    waLink.href = result.waLink;
    waLink.target = "_blank";
    waLink.hidden = false;
    $("resumo-contato").textContent = `WhatsApp: ${result.whatsapp}. ${result.aviso}`;
    waLink.focus();
  } catch (failure) {
    showMessage(contactError, describeError(failure));
    contactTurnstile.reset();
  } finally {
    contactBusy = false;
    $("resumo-contato").removeAttribute("aria-busy");
  }
}

function openContact(button) {
  contactOfferId = button.dataset.id;
  contactDone = false;
  contactBusy = false;
  ciente.checked = false;
  waLink.hidden = true;
  showMessage(contactError, "");
  $("resumo-contato").setAttribute("aria-live", "polite");
  $("resumo-contato").textContent =
    `Carona até ${titleCase(button.dataset.local || "")}. Marque o aviso e aguarde a verificação para ver o contato.`;
  openDialog(contactDialog, button);
  if (contactTurnstile) contactTurnstile.reset();
  else contactTurnstile = createTurnstile($("turnstile"), "contato", () => tryReveal());
}

ciente.addEventListener("change", () => {
  if (ciente.checked && !contactTurnstile?.token()) {
    showMessage(contactError, "");
    $("resumo-contato").textContent = "Aguarde a verificação de segurança terminar. O contato aparece em seguida.";
  }
  tryReveal();
});
$("fechar-contato").addEventListener("click", () => closeDialog(contactDialog));
contactDialog.addEventListener("close", () => {
  waLink.hidden = true;
  contactDone = false;
});

// ---- Report dialog -------------------------------------------------

const reportDialog = $("dialogo-denuncia");
const reportForm = $("form-denuncia");
let reportTurnstile = null;

function openReport(button) {
  $("denuncia-id").value = button.dataset.id;
  $("motivo").value = "";
  showMessage($("erro-denuncia"), "");
  $("ok-denuncia").hidden = true;
  reportForm.querySelector('[type="submit"]').disabled = false;
  openDialog(reportDialog, button);
  if (reportTurnstile) reportTurnstile.reset();
  else reportTurnstile = createTurnstile($("turnstile-denuncia"), "denuncia");
}

reportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("erro-denuncia");
  const token = reportTurnstile?.token();
  if (!token) return showMessage(error, NO_TURNSTILE_MESSAGE);
  const submit = reportForm.querySelector('[type="submit"]');
  setBusy(submit, true, "Enviando...");
  showMessage(error, "");
  try {
    await api(`/api/ofertas/${$("denuncia-id").value}/denuncia`, {
      method: "POST",
      body: { motivo: $("motivo").value, turnstile: token },
    });
    $("ok-denuncia").hidden = false;
    submit.disabled = true;
    submit.removeAttribute("aria-busy");
    submit.textContent = submit.dataset.label;
  } catch (failure) {
    showMessage(error, describeError(failure));
    setBusy(submit, false);
    reportTurnstile.reset();
  }
});
$("fechar-denuncia").addEventListener("click", () => closeDialog(reportDialog));

list.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-acao]");
  if (!button) return;
  if (button.dataset.acao === "contato") openContact(button);
  else if (button.dataset.acao === "denunciar") openReport(button);
});
