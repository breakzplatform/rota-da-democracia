import {
  $, api, closeDialog, createTurnstile, describeError, isoToTime, NO_TURNSTILE_MESSAGE, openDialog,
  setBusy, showMessage, spokenTime, titleCase, copyText, safeHref, guardClosed,
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
  const resolved = picker.resolve();
  if (!resolved.ok) {
    showMessage(error, "Escolha o local de votação nos passos acima antes de buscar.");
    return;
  }
  const params = new URLSearchParams({ municipio: municipio.cd });
  const local = resolved.local;
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
const revealButton = $("revelar-contato");
const copyButton = $("copiar-contato");
const summary = $("resumo-contato");
summary.setAttribute("aria-live", "polite");
let contactTurnstile = null;
// Each open gets its own session; late responses from an older one are dropped.
let contactSession = 0;
let contactOffer = null;
let contactBusy = false;

function updateRevealState() {
  revealButton.disabled = contactBusy || !ciente.checked || !contactTurnstile?.token();
}

function resetContactView() {
  waLink.hidden = true;
  waLink.removeAttribute("href");
  copyButton.hidden = true;
  copyButton.onclick = null;
  revealButton.hidden = false;
}

function renderContact(result) {
  const { tipo, valor, link, aviso } = result;
  revealButton.hidden = true;
  const note = aviso ? ` ${aviso}` : "";
  if (tipo === "whatsapp") {
    const href = safeHref(link, ["https://wa.me/"]);
    summary.textContent = `WhatsApp: ${valor}.${note}`;
    if (href) {
      waLink.href = href;
      waLink.textContent = "Abrir conversa no WhatsApp";
      waLink.target = "_blank";
      waLink.hidden = false;
      waLink.focus();
    }
  } else if (tipo === "whatsapp_usuario") {
    summary.textContent = `Usuário do WhatsApp: ${valor}. Abra o WhatsApp e procure por ${valor}.${note}`;
    copyButton.hidden = false;
    copyButton.textContent = "Copiar usuário";
    copyButton.onclick = async () => {
      copyButton.textContent = (await copyText(valor)) ? "Usuário copiado" : "Copie manualmente";
    };
    copyButton.focus();
  } else if (tipo === "email") {
    const href = safeHref(link, ["mailto:"]);
    summary.textContent = `E-mail: ${valor}.${note}`;
    if (href) {
      waLink.href = href;
      waLink.textContent = "Escrever e-mail";
      waLink.removeAttribute("target");
      waLink.hidden = false;
      waLink.focus();
    }
  } else {
    summary.textContent = `Contato: ${valor}.${note}`;
  }
}

async function reveal() {
  const session = contactSession;
  const offerId = contactOffer;
  const token = contactTurnstile?.token();
  if (contactBusy || !offerId || !ciente.checked) return;
  if (!token) return showMessage(contactError, NO_TURNSTILE_MESSAGE);
  contactBusy = true;
  updateRevealState();
  showMessage(contactError, "");
  try {
    const result = await api(`/api/ofertas/${offerId}/contato`, {
      method: "POST",
      body: { turnstile: token, ciente: true },
    });
    if (session !== contactSession) return;
    renderContact(result);
  } catch (failure) {
    if (session !== contactSession) return;
    showMessage(contactError, describeError(failure));
    contactTurnstile.reset();
  } finally {
    if (session === contactSession) {
      contactBusy = false;
      updateRevealState();
    }
  }
}

function openContact(button) {
  contactSession += 1;
  contactOffer = button.dataset.id;
  contactBusy = false;
  ciente.checked = false;
  resetContactView();
  showMessage(contactError, "");
  summary.textContent =
    `Carona até ${titleCase(button.dataset.local || "")}. Marque o aviso, aguarde a verificação e toque em Ver contato.`;
  openDialog(contactDialog, button);
  if (contactTurnstile) contactTurnstile.reset();
  else contactTurnstile = createTurnstile($("turnstile"), "contato", updateRevealState);
  updateRevealState();
}

ciente.addEventListener("change", updateRevealState);
revealButton.addEventListener("click", reveal);
$("fechar-contato").addEventListener("click", () => closeDialog(contactDialog));
contactDialog.addEventListener("close", () => {
  contactSession += 1;
  contactOffer = null;
  contactBusy = false;
  ciente.checked = false;
  resetContactView();
  summary.textContent = "";
  contactTurnstile?.reset();
  updateRevealState();
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

guardClosed(document.querySelector("main .stack"));
