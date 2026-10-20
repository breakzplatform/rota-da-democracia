export const MAX_BODY_BYTES = 4096;

export type CachePolicy = "no-store" | "short";

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

export function json(body: unknown, status = 200, cache: CachePolicy = "no-store"): Response {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Cache-Control", cache === "short" ? "public, max-age=300" : "no-store");
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export function errorResponse(error: ApiError): Response {
  const body: Record<string, string> = { error: error.code, message: error.message };
  if (error.field) body.campo = error.field;
  return json(body, error.status);
}

export type JsonObject = Record<string, unknown>;

// Reads the body incrementally so an oversized or unannounced (chunked) upload is
// aborted as soon as it crosses the limit instead of being buffered whole.
async function readLimitedBody(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw tooLarge();
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const body = new Uint8Array(MAX_BODY_BYTES);
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > MAX_BODY_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    body.set(value, size);
    size += value.byteLength;
  }
  return body.subarray(0, size);
}

export async function readJsonObject(request: Request): Promise<JsonObject> {
  const bytes = await readLimitedBody(request);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "json_invalido", "Não conseguimos ler os dados enviados.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(400, "json_invalido", "Não conseguimos ler os dados enviados.");
  }
  return parsed as JsonObject;
}

function tooLarge(): ApiError {
  return new ApiError(413, "corpo_grande_demais", "Os dados enviados são grandes demais.");
}
