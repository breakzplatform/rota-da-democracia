// Shared helpers: API calls, time, formatting, Turnstile, dialogs.

export const ELECTION_DATE = "2026-10-25";
const BRT_OFFSET = "-03:00";
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;

export const $ = (id) => document.getElementById(id);

export function foldText(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const SMALL_WORDS = new Set(["de", "da", "do", "das", "dos", "e"]);
export function titleCase(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(" ")
    .map((word, index) => (index > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

// ---- API -------------------------------------------------------------

export class ApiFailure extends Error {
  constructor(status, body) {
    super(body?.message || "Algo deu errado. Tente de novo em instantes.");
    this.status = status;
    this.code = body?.error || "erro";
    this.field = body?.campo || null;
  }
}

export async function api(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, { message: "Sem conexão com o servidor. Verifique a internet e tente de novo." });
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    // Non-JSON body: fall through to a generic message.
  }
  if (!response.ok) throw new ApiFailure(response.status, data);
  return data;
}

let configPromise;
export function loadConfig() {
  configPromise ??= api("/api/config");
  return configPromise;
}

/** Returns `url` only when it starts with one of the allowed prefixes; otherwise null. */
export function safeHref(url, prefixes) {
  return typeof url === "string" && prefixes.some((prefix) => url.startsWith(prefix)) ? url : null;
}

export const CLOSED_MESSAGE =
  "A eleição passou. Obrigado por ajudar alguém a votar. Os dados foram apagados.";

/** When the site is closed, replaces `target`'s content with a thank-you message. */
export async function guardClosed(target) {
  try {
    const status = await api("/api/status");
    if (status.encerrado) showClosed(target);
    return Boolean(status.encerrado);
  } catch (failure) {
    if (failure instanceof ApiFailure && failure.code === "encerrado") showClosed(target);
    return false;
  }
}

export function showClosed(target) {
  if (!target) return;
  const box = document.createElement("section");
  box.className = "panel";
  box.setAttribute("role", "status");
  const heading = document.createElement("h2");
  heading.textContent = "Obrigado!";
  const text = document.createElement("p");
  text.textContent = CLOSED_MESSAGE;
  box.append(heading, text);
  target.replaceChildren(box);
}

// Mirrors ELECTION.signupClosesAt; the server enforces it, this only spares a doomed form.
const SIGNUP_CLOSES_AT = new Date("2026-10-25T07:59:00-03:00");
export const SIGNUP_CLOSED_MESSAGE =
  "Os cadastros de carona e de grupos foram encerrados antes de as urnas abrirem. Procure as ofertas já publicadas ou o transporte público.";

export function signupIsClosed() {
  return Date.now() >= SIGNUP_CLOSES_AT.getTime();
}

/** Swaps the deadline banner's text for the closed notice once the cutoff has passed. */
export function updateSignupDeadline() {
  if (!signupIsClosed()) return;
  for (const banner of document.querySelectorAll("[data-signup-deadline] p")) {
    banner.textContent = SIGNUP_CLOSED_MESSAGE;
  }
}

/** Replaces a signup form with the closed-signups notice. */
export function showSignupClosed(form) {
  const box = document.createElement("section");
  box.className = "panel";
  box.setAttribute("role", "status");
  const heading = document.createElement("h2");
  heading.textContent = "Cadastros encerrados";
  const text = document.createElement("p");
  text.textContent = SIGNUP_CLOSED_MESSAGE;
  box.append(heading, text);
  form.replaceWith(box);
}

// ---- Time (election day, BRT) ---------------------------------------

/** "09:40" -> "2026-10-25T09:40:00-03:00" */
export function timeToIso(hhmm) {
  return `${ELECTION_DATE}T${hhmm}:00${BRT_OFFSET}`;
}

/** ISO instant -> "09:40" in BRT (UTC-3, no DST in Brazil in 2026). */
export function isoToTime(iso) {
  return new Date(new Date(iso).getTime() - BRT_OFFSET_MS).toISOString().slice(11, 16);
}

/** "09:40" -> "9h40"; "10:00" -> "10h". */
export function spokenTime(hhmm) {
  const [hours, minutes] = hhmm.split(":");
  return minutes === "00" ? `${Number(hours)}h` : `${Number(hours)}h${minutes}`;
}

// ---- WhatsApp --------------------------------------------------------

export function maskWhatsapp(raw) {
  let digits = String(raw).replace(/\D/g, "");
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : "";
  const area = digits.slice(0, 2);
  const rest = digits.slice(2);
  const split = rest.length > 8 ? 5 : 4;
  const head = rest.slice(0, split);
  const tail = rest.slice(split);
  return `(${area}) ${head}${tail ? `-${tail}` : ""}`;
}

export function attachWhatsappMask(input) {
  input.addEventListener("input", () => {
    input.value = maskWhatsapp(input.value);
  });
}

// ---- Messages --------------------------------------------------------

export function showMessage(element, text) {
  if (!element) return;
  element.textContent = text;
  element.hidden = !text;
}

export function setBusy(button, busy, busyLabel) {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    if (busyLabel) button.textContent = busyLabel;
  } else if (button.dataset.label) {
    button.textContent = button.dataset.label;
  }
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
}

/** Marks the field named by an API `campo` and focuses it. */
export function focusField(fieldName, aliases = {}) {
  const id = aliases[fieldName] || fieldName;
  const element = id && $(id);
  document.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
  if (element && typeof element.focus === "function") {
    element.setAttribute("aria-invalid", "true");
    element.focus();
  }
}

export function clearInvalid() {
  document.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

// ---- Dialogs ---------------------------------------------------------

/** Opens a <dialog> and returns focus to `opener` when it closes. */
export function openDialog(dialog, opener) {
  const restore = () => {
    dialog.removeEventListener("close", restore);
    if (opener && document.contains(opener)) opener.focus();
  };
  dialog.addEventListener("close", restore);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

export function closeDialog(dialog) {
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

// ---- Turnstile -------------------------------------------------------

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
// Note: elements with id="turnstile" also appear as window.turnstile, so only trust `render`.
let turnstileScript;

function loadTurnstileScript() {
  turnstileScript ??= new Promise((resolve, reject) => {
    const whenReady = (tries = 0) => {
      if (typeof window.turnstile?.render === "function") resolve(window.turnstile);
      else if (tries > 100) reject(new Error("turnstile-init"));
      else setTimeout(() => whenReady(tries + 1), 100);
    };
    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.onload = () => whenReady();
    script.onerror = () => {
      turnstileScript = undefined;
      reject(new Error("turnstile-load"));
    };
    document.head.append(script);
  });
  return turnstileScript;
}

/**
 * Renders a Turnstile widget (explicit) with the site key from /api/config.
 * `onChange(token|null)` fires when a token is issued or lost.
 * Returns { token(), reset(), remove(), ready } where `ready` resolves once rendered.
 */
export function createTurnstile(container, action, onChange = () => {}) {
  let widgetId = null;
  let current = null;
  const set = (value) => {
    current = value;
    onChange(value);
  };
  const ready = (async () => {
    const [{ turnstileSiteKey }, turnstile] = await Promise.all([loadConfig(), loadTurnstileScript()]);
    widgetId = turnstile.render(container, {
      sitekey: turnstileSiteKey,
      action,
      language: "pt-br",
      callback: (token) => set(token),
      "expired-callback": () => set(null),
      "error-callback": () => set(null),
    });
  })();
  ready.catch((error) => {
    console.error("turnstile", error);
    container.textContent = "Não foi possível carregar a verificação. Recarregue a página.";
  });
  return {
    ready,
    token: () => current,
    reset() {
      set(null);
      if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
    },
    remove() {
      if (widgetId !== null && window.turnstile) window.turnstile.remove(widgetId);
      widgetId = null;
      set(null);
    },
  };
}

export const NO_TURNSTILE_MESSAGE = "Aguarde a verificação de segurança terminar e tente de novo.";

export function describeError(error) {
  if (error instanceof ApiFailure) return error.message;
  return "Algo deu errado. Tente de novo em instantes.";
}
