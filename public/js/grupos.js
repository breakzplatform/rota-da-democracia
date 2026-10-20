import {
  $, api, closeDialog, copyText, createTurnstile, describeError, guardClosed, NO_TURNSTILE_MESSAGE,
  openDialog, safeHref, setBusy, showMessage, titleCase,
} from "./common.js";
import { initPlacePicker } from "./places.js";

const picker = initPlacePicker({ cityOnly: true });
const modeButton = $("modo-buscar");
function openSearch() {
  $("form-grupos").hidden = false;
  $("resultados-grupos").hidden = false;
  modeButton.setAttribute("aria-expanded", "true");
  const heading = document.querySelector("#seletor-local .step-title");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus();
  }
  $("form-grupos").scrollIntoView({ block: "start" });
}
modeButton.addEventListener("click", openSearch);
if (location.hash === "#buscar") openSearch();
const form = $("form-grupos");
const list = $("lista-grupos");
const status = $("estado-grupos");
const template = $("modelo-grupo");

function renderGroups(groups) {
  list.replaceChildren();
  for (const group of groups) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.id = group.id;
    node.querySelector(".offer-name").textContent = group.nome;
    node.querySelector(".offer-place").textContent = group.bairros;
    const admin = group.admin ?? group.adminNome ?? group.nomeAdmin;
    node.querySelector(".offer-meet").textContent = admin ? `Administra: ${admin}` : "";
    node.querySelectorAll("[data-id]").forEach((el) => {
      el.dataset.id = group.id;
    });
    node.querySelector('[data-acao="entrar"]').dataset.nome = group.nome;
    list.append(node);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("erro-grupos");
  showMessage(error, "");
  const municipio = picker.municipio();
  if (!municipio) {
    showMessage(error, "Escolha a cidade no passo acima.");
    return;
  }
  const params = new URLSearchParams({ municipio: municipio.cd });
  const q = $("q").value.trim();
  if (q) params.set("q", q);
  const submit = form.querySelector('[type="submit"]');
  setBusy(submit, true, "Buscando...");
  status.textContent = "Buscando grupos...";
  try {
    const { grupos } = await api(`/api/grupos?${params}`);
    renderGroups(grupos);
    status.textContent = grupos.length
      ? `${grupos.length === 1 ? "1 grupo" : `${grupos.length} grupos`} em ${titleCase(municipio.nome)}.`
      : `Nenhum grupo em ${titleCase(municipio.nome)} por enquanto. Você pode cadastrar o seu.`;
  } catch (failure) {
    list.replaceChildren();
    status.textContent = "";
    showMessage(error, describeError(failure));
  } finally {
    setBusy(submit, false);
  }
});

// ---- Enter dialog ---------------------------------------------------

const dialog = $("dialogo-entrar");
const ciente = $("ciente-grupo");
const enterError = $("erro-entrar");
const revealButton = $("revelar-grupo");
const groupLink = $("link-grupo");
let turnstile = null;
let session = 0;
let currentId = null;
let busy = false;

function updateState() {
  revealButton.disabled = busy || !ciente.checked || !turnstile?.token();
}

function resetView() {
  groupLink.hidden = true;
  groupLink.removeAttribute("href");
  revealButton.hidden = false;
}

async function reveal() {
  const mine = session;
  const token = turnstile?.token();
  if (busy || !currentId || !ciente.checked) return;
  if (!token) return showMessage(enterError, NO_TURNSTILE_MESSAGE);
  busy = true;
  updateState();
  showMessage(enterError, "");
  try {
    const result = await api(`/api/grupos/${currentId}/entrar`, { method: "POST", body: { turnstile: token, ciente: true } });
    if (mine !== session) return;
    const href = safeHref(result.link, ["https://chat.whatsapp.com/"]);
    if (!href || !/^https:\/\/chat\.whatsapp\.com\//.test(href)) {
      showMessage(enterError, "O link deste grupo não é válido. Denuncie o grupo se achar estranho.");
      return;
    }
    revealButton.hidden = true;
    groupLink.href = href;
    groupLink.hidden = false;
    $("resumo-entrar").textContent = "Pronto. Abra o grupo no WhatsApp e siga as regras.";
    groupLink.focus();
  } catch (failure) {
    if (mine !== session) return;
    showMessage(enterError, describeError(failure));
    turnstile.reset();
  } finally {
    if (mine === session) {
      busy = false;
      updateState();
    }
  }
}

function openEnter(button) {
  session += 1;
  currentId = button.dataset.id;
  busy = false;
  ciente.checked = false;
  resetView();
  showMessage(enterError, "");
  $("resumo-entrar").textContent = `Grupo: ${button.dataset.nome || ""}. Marque o aviso, aguarde a verificação e toque em Ver link do grupo.`;
  openDialog(dialog, button);
  if (turnstile) turnstile.reset();
  else turnstile = createTurnstile($("turnstile-entrar"), "entrar", updateState);
  updateState();
}

ciente.addEventListener("change", updateState);
revealButton.addEventListener("click", reveal);
$("fechar-entrar").addEventListener("click", () => closeDialog(dialog));
dialog.addEventListener("close", () => {
  session += 1;
  currentId = null;
  busy = false;
  ciente.checked = false;
  resetView();
  $("resumo-entrar").textContent = "";
  turnstile?.reset();
  updateState();
});

// ---- Report dialog --------------------------------------------------

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
    await api(`/api/grupos/${$("denuncia-id").value}/denuncia`, {
      method: "POST",
      body: { motivo: $("motivo").value, turnstile: token },
    });
    $("ok-denuncia").hidden = false;
    submit.removeAttribute("aria-busy");
    submit.textContent = submit.dataset.label;
    submit.disabled = true;
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
  if (button.dataset.acao === "entrar") openEnter(button);
  else if (button.dataset.acao === "denunciar") openReport(button);
});

guardClosed(document.querySelector("main .stack"));
