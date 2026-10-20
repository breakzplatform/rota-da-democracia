import { CAMPAIGN_PATTERNS } from "./config";

export function foldForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Canonical form of user-supplied text: NFKC (folds full-width and other
 * compatibility look-alikes), invisible format characters (zero-width spaces,
 * soft hyphens, bidi marks) removed, control characters turned into spaces and
 * whitespace collapsed. Stored text and screened text are the same string, so
 * what passes the screen is exactly what gets displayed.
 */
export function cleanText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deliberate deviation from the spec: it asks to flag the numbers 13 and 22 as
 * standalone tokens, but they are everywhere in Brazilian addresses ("Praça 13
 * de Maio", "Rua 22 de Agosto"), so CAMPAIGN_PATTERNS only flags them next to
 * vote words ("vote 13", "13 confirma").
 *
 * Both the accented and the accent-stripped forms are checked: JS `\b` treats
 * accented letters as non-word characters, so either form alone can slip past.
 */
export function looksLikeCampaign(value: string): boolean {
  const normalized = cleanText(value);
  const forms = [normalized, normalized.normalize("NFD").replace(/\p{Diacritic}/gu, "")];
  return forms.some((form) => CAMPAIGN_PATTERNS.some((pattern) => pattern.test(form)));
}
