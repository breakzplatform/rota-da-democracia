import { normalizeWhatsapp } from "./whatsapp";

export const CONTACT_TYPES = ["whatsapp", "whatsapp_usuario", "email"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export function isContactType(value: unknown): value is ContactType {
  return typeof value === "string" && (CONTACT_TYPES as readonly string[]).includes(value);
}

const EMAIL_MAX = 100;
const USERNAME = /^[a-z0-9._]{3,35}$/;
// Pragmatic subset of RFC 5322: dot-atom local part, LDH domain labels, at least one dot.
const EMAIL =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function normalizeUsername(input: string): string | null {
  const username = input.trim().replace(/^@/, "").toLowerCase();
  return USERNAME.test(username) && /[a-z]/.test(username) ? username : null;
}

function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return email.length <= EMAIL_MAX && EMAIL.test(email) ? email : null;
}

/** Canonical stored form of a contact, or null when invalid for its type. */
export function normalizeContact(type: ContactType, input: string): string | null {
  if (type === "whatsapp") return normalizeWhatsapp(input);
  if (type === "whatsapp_usuario") return normalizeUsername(input);
  return normalizeEmail(input);
}

/** How the contact is shown to people (usernames carry their "@"). */
export function displayContact(type: ContactType, stored: string): string {
  return type === "whatsapp_usuario" ? `@${stored}` : stored;
}

export function contactLink(type: ContactType, stored: string, localNome: string, siteName: string): string | null {
  if (type === "whatsapp") {
    const message =
      `Oi! Vi sua oferta de carona no ${siteName} para o local de votação ` +
      `${localNome} no domingo. Ainda tem vaga?`;
    return `https://wa.me/${stored.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
  }
  if (type === "email") return `mailto:${stored}?subject=${encodeURIComponent("Carona para votar no domingo")}`;
  return null;
}

export const CONTACT_ERRORS: Readonly<Record<ContactType, string>> = {
  whatsapp: "Informe um celular brasileiro com DDD, como (81) 91234-5678.",
  whatsapp_usuario: "Informe um nome de usuário do WhatsApp válido, como @maria.silva (letras, números, ponto e _).",
  email: "Informe um e-mail válido, como maria@exemplo.com.",
};
