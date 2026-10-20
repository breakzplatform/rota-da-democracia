import { normalizeWhatsapp } from "./whatsapp";

export const CONTACT_TYPES = ["whatsapp", "whatsapp_usuario", "email", "instagram", "bluesky", "outro"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export function isContactType(value: unknown): value is ContactType {
  return typeof value === "string" && (CONTACT_TYPES as readonly string[]).includes(value);
}

const EMAIL_MAX = 100;
const USERNAME = /^[a-z0-9._]{3,35}$/;
// Pragmatic subset of RFC 5322: dot-atom local part, LDH domain labels, at least one dot.
const EMAIL =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
// Instagram: 1-30 of letters, digits, "." and "_"; no leading, trailing or doubled dot.
const INSTAGRAM = /^(?!\.)(?!.*\.\.)(?!.*\.$)[a-z0-9._]{1,30}$/;
// AT Protocol handle: LDH domain labels, at least two, the last one not starting with a digit.
const BLUESKY = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const BLUESKY_MAX = 100;
export const LINK_MAX = 200;
export const LINK_LABEL_MAX = 20;
// Messaging hosts only, so the "other link" option cannot carry arbitrary or phishing URLs.
const LINK_HOSTS: Readonly<Record<string, RegExp>> = {
  "t.me": /^\/[^/]/,
  "telegram.me": /^\/[^/]/,
  "signal.me": /^\//,
  "signal.group": /^\//,
  "wa.me": /^\/[^/]/,
  "ig.me": /^\/m\/[^/]/,
  "m.me": /^\/[^/]/,
  "bsky.app": /^\/profile\/[^/]/,
  "matrix.to": /^\//,
  "discord.gg": /^\/[^/]/,
  "discord.com": /^\/invite\/[^/]/,
};

function normalizeUsername(input: string): string | null {
  const username = input.trim().replace(/^@/, "").toLowerCase();
  return USERNAME.test(username) && /[a-z]/.test(username) ? username : null;
}

function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return email.length <= EMAIL_MAX && EMAIL.test(email) ? email : null;
}

/** Accepts "@handle", "handle" or a pasted profile URL. */
function normalizeInstagram(input: string): string | null {
  const handle = input
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^@/, "");
  return INSTAGRAM.test(handle) ? handle : null;
}

/** Accepts "@handle", "handle" or a pasted bsky.app profile URL. */
function normalizeBluesky(input: string): string | null {
  const handle = input
    .trim()
    .toLowerCase()
    .replace(/^(?:https?:\/\/)?bsky\.app\/profile\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^@/, "");
  return handle.length <= BLUESKY_MAX && BLUESKY.test(handle) ? handle : null;
}

/** https URL on an allowlisted messaging host, without credentials or port. */
function normalizeLink(input: string): string | null {
  const raw = input.trim();
  if (raw.length > LINK_MAX || !/^https:\/\//i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const path = LINK_HOSTS[url.hostname];
  if (url.protocol !== "https:" || url.username || url.password || url.port || !path || !path.test(url.pathname)) {
    return null;
  }
  return url.href.length <= LINK_MAX ? url.href : null;
}

/** Canonical stored form of a contact, or null when invalid for its type. */
export function normalizeContact(type: ContactType, input: string): string | null {
  switch (type) {
    case "whatsapp":
      return normalizeWhatsapp(input);
    case "whatsapp_usuario":
      return normalizeUsername(input);
    case "instagram":
      return normalizeInstagram(input);
    case "bluesky":
      return normalizeBluesky(input);
    case "email":
      return normalizeEmail(input);
    case "outro":
      return normalizeLink(input);
  }
}

/** How the contact is shown to people (handles carry their "@"). */
export function displayContact(type: ContactType, stored: string): string {
  return type === "whatsapp" || type === "email" || type === "outro" ? stored : `@${stored}`;
}

export function contactLink(type: ContactType, stored: string, localNome: string, siteName: string): string | null {
  switch (type) {
    case "whatsapp": {
      const message =
        `Oi! Vi sua oferta de carona no ${siteName} para o local de votação ` +
        `${localNome} no domingo. Ainda tem vaga?`;
      return `https://wa.me/${stored.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
    }
    case "email":
      return `mailto:${stored}?subject=${encodeURIComponent("Carona para votar no domingo")}`;
    case "instagram":
      return `https://ig.me/m/${stored}`;
    // Bluesky has no DM deep link; the conversation starts from the profile.
    case "bluesky":
      return `https://bsky.app/profile/${stored}`;
    case "outro":
      return stored;
    case "whatsapp_usuario":
      return null;
  }
}

export const CONTACT_ERRORS: Readonly<Record<ContactType, string>> = {
  whatsapp: "Informe um celular brasileiro com DDD, como (81) 91234-5678.",
  whatsapp_usuario: "Informe um nome de usuário do WhatsApp válido, como @maria.silva (letras, números, ponto e _).",
  email: "Informe um e-mail válido, como maria@exemplo.com.",
  instagram: "Informe um usuário do Instagram válido, como @maria.silva (até 30 letras, números, ponto e _, sem ponto no começo ou no fim).",
  outro:
    "Informe um link https de mensagem, como https://t.me/maria ou https://signal.me/#eu/... (Telegram, Signal, Messenger, Matrix ou Discord).",
  bluesky: "Informe um usuário do Bluesky válido, como @maria.bsky.social ou o seu domínio.",
};
