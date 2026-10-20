import {
  $, api, attachWhatsappMask, clearInvalid, copyText, createTurnstile, describeError, focusField,
  NO_TURNSTILE_MESSAGE, ApiFailure, setBusy, showMessage, spokenTime, timeToIso, titleCase,
} from "./common.js";
import { initPlacePicker } from "./places.js";

const picker = initPlacePicker();
const form = $("form-oferta");
const errorBox = $("erro-oferta");
attachWhatsappMask($("whatsapp"));

const turnstile = createTurnstile($("turnstile"), "oferecer");

const FIELD_IDS = { municipio: "municipio-busca", localId: "local-busca" };
const DECLARATIONS = ["aceite", "semVinculo", "combinaWhatsapp", "veiculoParticular", "semPagamento", "maiorHabilitado"];

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
  const local = picker.local();
  if (!municipio) return fail("Escolha o município na lista.", "municipio");
  if (!local) return fail("Escolha o local de votação: informe zona e seção, ou busque pelo nome.", "localId");
  const token = turnstile.token();
  if (!token) return fail(NO_TURNSTILE_MESSAGE);

  const body = {
    turnstile: token,
    nome: $("nome").value.trim(),
    whatsapp: $("whatsapp").value.trim(),
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
    fail(describeError(failure), failure instanceof ApiFailure ? failure.field : null);
    turnstile.reset();
  } finally {
    setBusy(submit, false);
  }
});

function showCreated({ id, token }, local, body) {
  const url = `${location.origin}/gerenciar.html?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}`;
  const link = $("oferta-link");
  link.href = url;
  link.textContent = url;

  const hhmm = $("saida").value;
  const text =
    `Ofereço carona gratuita até ${titleCase(local.nome)} no domingo, 25 de outubro. ` +
    `Saída ${spokenTime(hhmm)}, em ${body.pontoEncontro} (${body.bairroSaida}). ` +
    `Sem cobrança e sem pedido de voto. Combine comigo pelo WhatsApp: ${location.origin}/buscar.html`;
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
