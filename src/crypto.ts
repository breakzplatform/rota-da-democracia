async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function sha256Hex(value: string): Promise<string> {
  return [...(await sha256(value))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compares a token against a stored SHA-256 hex digest in constant time. */
export async function tokenMatches(token: string, storedHex: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(storedHex)) return false;
  const stored = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    stored[index] = Number.parseInt(storedHex.slice(index * 2, index * 2 + 2), 16);
  }
  return crypto.subtle.timingSafeEqual(await sha256(token), stored);
}

export function randomToken(bytes: number): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

function expandIpv6(address: string): string[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const split = (part: string | undefined) => (part ? part.split(":") : []);
  const head = split(halves[0]);
  const tail = split(halves[1]);
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 1 ? 0 : missing).fill("0"), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => group.padStart(4, "0"));
}

/**
 * The unit a person controls: the full address for IPv4, the /64 prefix for
 * IPv6 (one subscriber usually gets a whole /64 and can rotate freely inside it).
 */
export function networkKey(ip: string): string {
  const address = (ip.trim().toLowerCase().split("%")[0] ?? "").replace(/^\[|\]$/g, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped?.[1]) return mapped[1];
  if (!address.includes(":")) return address;
  const groups = expandIpv6(address);
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : address;
}

export function hashIp(ip: string, salt: string): Promise<string> {
  return sha256Hex(`${salt}:${networkKey(ip)}`);
}

/** Constant-time comparison of two secrets of any length (both are hashed to fixed-size digests). */
export async function secretMatches(given: string, expected: string): Promise<boolean> {
  return crypto.subtle.timingSafeEqual(await sha256(given), await sha256(expected));
}
