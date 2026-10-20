import {
  $, api, maskWhatsapp, guardClosed, showSignupClosed, signupIsClosed, updateSignupDeadline, clearInvalid, copyText, createTurnstile, describeError, focusField,
  NO_TURNSTILE_MESSAGE, ApiFailure, setBusy, showMessage, spokenTime, timeToIso, titleCase,
} from "./common.js";
import { initPlacePicker } from "./places.js";

updateSignupDeadline();
const picker = initPlacePicker();
const form = $("form-oferta");
const errorBox = $("erro-oferta");

const CONTACT_KINDS = {
  whatsapp: { label: "Número do WhatsApp", type: "tel", mode: "tel", complete: "tel", placeholder: "(81) 9 0000-0000", help: "Com DDD. O contato não aparece na lista. Só aparece para quem pede a vaga, depois de uma checagem contra robôs." },
  whatsapp_usuario: { label: "Usuário do WhatsApp", type: "text", mode: "text", complete: "off", placeholder: "@maria.silva", help: "O nome de usuário que você criou no WhatsApp. Só aparece para quem pede a vaga, depois de uma checagem contra robôs." },
  email: { label: "E-mail", type: "email", mode: "email", complete: "email", placeholder: "maria@exemplo.com", help: "Só aparece para quem pede a vaga, depois de uma checagem contra robôs." },
};
const contactInput = $("contato");
const selectedKind = () => document.querySelector('input[name="contatoTipo"]:checked').value;
function applyKind() {
  const kind = CONTACT_KINDS[selectedKind()];
  contactInput.type = kind.type;
  contactInput.inputMode = kind.mode;
  contactInput.autocomplete = kind.complete;
  contactInput.placeholder = kind.placeholder;
  contactInput.value = "";
  $("contato-rotulo").textContent = kind.label;
  $("contato-ajuda").textContent = kind.help;
}
document.querySelectorAll('input[name="contatoTipo"]').forEach((radio) => radio.addEventListener("change", applyKind));
contactInput.addEventListener("input", () => {
  if (selectedKind() === "whatsapp") contactInput.value = maskWhatsapp(contactInput.value);
});
applyKind();

const turnstile = createTurnstile($("turnstile"), "oferecer");

const FIELD_IDS = { municipio: "municipio-busca", localId: "local-busca", contatoTipo: "contatoTipo-whatsapp" };
const DECLARATIONS = ["aceite", "semVinculo", "combinaWhatsapp", "veiculoParticular", "semPagamento", "maiorHabilitado", "umTrajeto"];

function fail(message, field) {
  showMessage(errorBox, message);
  if (field) focusField(field, FIELD_IDS);
  else errorBox.scrollIntoView({ block: "nearest" });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearInvalid();
  showMessage(errorBox, "");
  const municipio = picker.municipio();
  const { local } = picker.resolve();
  if (!municipio || !local) return fail("Escolha onde você vota nos passos acima.");
  const token = turnstile.token();
  if (!token) return fail(NO_TURNSTILE_MESSAGE);

  const body = {
    turnstile: token,
    nome: $("nome").value.trim(),
    contatoTipo: selectedKind(),
    contato: contactInput.value.trim(),
    municipio: municipio.cd,
    localId: local.id,
    pontoEncontro: $("pontoEncontro").value.trim(),
    bairroSaida: $("bairroSaida").value.trim(),
    saida: $("saida").value ? timeToIso($("saida").value) : "",
    vagas: Number($("vagas").value),
    nota: $("nota").value.trim() || undefined,
    acessivel: $("acessivel").checked,
  };
  for (const name of DECLARATIONS) body[name] = $(name).checked;

  const submit = form.querySelector('[type="submit"]');
  setBusy(submit, true, "Publicando...");
  try {
    const created = await api("/api/ofertas", { method: "POST", body });
    showCreated(created, local, body);
  } catch (failure) {
    if (failure instanceof ApiFailure && failure.code === "cadastro_encerrado") return showSignupClosed(form);
    fail(describeError(failure), failure instanceof ApiFailure ? failure.field : null);
    turnstile.reset();
  } finally {
    setBusy(submit, false);
  }
});

function showCreated({ id, token }, local, body) {
  const url = `${location.origin}/gerenciar?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
  const link = $("oferta-link");
  link.href = url;
  link.textContent = url;

  const hhmm = $("saida").value;
  const text =
    `Ofereço carona gratuita até ${titleCase(local.nome)} no domingo, 25 de outubro. ` +
    `Saída ${spokenTime(hhmm)}, em ${body.pontoEncontro} (${body.bairroSaida}). ` +
    `Sem cobrança e sem pedido de voto. Combine comigo pelo contato que deixei na oferta: ${location.origin}/buscar`;
  $("texto-compartilhar").textContent = text;

  form.hidden = true;
  const section = $("oferta-criada");
  section.hidden = false;
  section.setAttribute("tabindex", "-1");
  section.focus();
  section.scrollIntoView({ block: "start" });

  const wire = (buttonId, value, done) => {
    const button = $(buttonId);
    button.onclick = async () => {
      const ok = await copyText(value);
      const original = button.dataset.original ?? button.textContent;
      button.dataset.original = original;
      button.textContent = ok ? done : "Selecione e copie manualmente";
      setTimeout(() => {
        button.textContent = original;
      }, 2500);
    };
  };
  wire("copiar-link", url, "Link copiado");
  wire("copiar-texto", text, "Texto copiado");

  if (navigator.share && !$("compartilhar-texto")) {
    const share = document.createElement("button");
    share.type = "button";
    share.className = "btn";
    share.id = "compartilhar-texto";
    share.textContent = "Compartilhar";
    share.addEventListener("click", () => navigator.share({ text }).catch(() => {}));
    $("copiar-texto").after(share);
  }
}

if (signupIsClosed()) showSignupClosed(form);
guardClosed(document.querySelector("main .stack"));
