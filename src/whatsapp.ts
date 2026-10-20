// Brazilian area codes (DDD) in use.
const VALID_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68,
  69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95,
  96, 97, 98, 99,
]);

// Prefixes people type before DDD + number: international (+55, 0055, 055) or trunk (0).
// Each is only stripped when the remainder is exactly 11 digits, so DDD 55 stays intact.
const PREFIXES = ["0055", "055", "55", "0"];

/** Returns the E.164 form (`+55DDD9XXXXXXXX`) of a Brazilian mobile number, or null. */
export function normalizeWhatsapp(input: string): string | null {
  if (!/^[\d\s()+.-]{8,25}$/.test(input)) return null;
  let digits = input.replace(/\D/g, "");
  const prefix = PREFIXES.find((candidate) => digits.length === candidate.length + 11 && digits.startsWith(candidate));
  if (prefix) digits = digits.slice(prefix.length);
  if (digits.length !== 11) return null;
  if (!VALID_DDD.has(Number(digits.slice(0, 2)))) return null;
  if (digits[2] !== "9") return null;
  return `+55${digits}`;
}
