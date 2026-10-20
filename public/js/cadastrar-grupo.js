import {
  $, api, ApiFailure, clearInvalid, copyText, createTurnstile, describeError, focusField, guardClosed, showSignupClosed, signupIsClosed,
  NO_TURNSTILE_MESSAGE, setBusy, showMessage,
} from "./common.js";
import { initPlacePicker } from "./places.js";

const picker = initPlacePicker({ cityOnly: true });
const form = $("form-grupo");
const errorBox = $("erro-grupo");
const turnstile = createTurnstile($("turnstile"), "grupo");
const FIELD_IDS = { municipio: "seletor-local", adminNome: "admin" };
const DECLARATIONS = ["aceite", "semVinculo", "grupoApartidario", "semCaravana", "adminResponsavel"];
const INVITE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}$/;

function fail(message, field) {
  showMessage(errorBox, message);
  if (field) focusField(field, FIELD_IDS);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearInvalid();
  showMessage(errorBox, "");
  const municipio = picker.municipio();
  if (!municipio) return fail("Escolha a cidade no passo acima.");
  const link = $("link").value.trim();
  if (!INVITE.test(link)) return fail("Cole o link de convite do WhatsApp, que começa com https://chat.whatsapp.com/", "link");
  const token = turnstile.token();
  if (!token) return fail(NO_TURNSTILE_MESSAGE);

  const body = {
    turnstile: token,
    municipio: municipio.cd,
    nome: $("nome").value.trim(),
    bairros: $("bairros").value.trim(),
    link,
    adminNome: $("admin").value.trim(),
  };
  for (const name of DECLARATIONS) body[name] = $(name).checked;

  const submit = form.querySelector('[type="submit"]');
  setBusy(submit, true, "Cadastrando...");
  try {
    const created = await api("/api/grupos", { method: "POST", body });
    const url = `${location.origin}/gerenciar-grupo?id=${encodeURIComponent(created.id)}&token=${encodeURIComponent(created.token)}`;
    $("grupo-link").href = url;
    $("grupo-link").textContent = url;
    form.hidden = true;
    const section = $("grupo-criado");
    section.hidden = false;
    section.setAttribute("tabindex", "-1");
    section.focus();
    const button = $("copiar-link");
    button.onclick = async () => {
      button.textContent = (await copyText(url)) ? "Link copiado" : "Selecione e copie manualmente";
    };
  } catch (failure) {
    if (failure instanceof ApiFailure && failure.code === "cadastro_encerrado") return showSignupClosed(form);
    fail(describeError(failure), failure instanceof ApiFailure ? failure.field : null);
    turnstile.reset();
  } finally {
    setBusy(submit, false);
  }
});

if (signupIsClosed()) showSignupClosed(form);
guardClosed(document.querySelector("main .stack"));
