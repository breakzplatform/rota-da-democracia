import { isPurged } from "./cleanup";
import { clientIp } from "./crypto";
import type { Deps, Env } from "./env";
import { ApiError, type JsonObject } from "./http";
import { verifyTurnstile, type TurnstileAction } from "./turnstile";
import { invalid } from "./validation";

export const REPORT_REASONS: ReadonlySet<string> = new Set(["cobranca", "campanha", "falsa", "outro"]);

export function closed(): ApiError {
  return new ApiError(410, "encerrado", "A eleição acabou e os dados foram apagados. Obrigado por participar!");
}

/** The error for a failed quota reservation: 410 once purged, otherwise the given 429. */
export async function quotaExhausted(env: Env, error: ApiError): Promise<ApiError> {
  return (await isPurged(env.DB)) ? closed() : error;
}

export function turnstile(request: Request, env: Env, deps: Deps, token: unknown, action: TurnstileAction) {
  return verifyTurnstile(
    token,
    { secret: env.TURNSTILE_SECRET, ip: clientIp(request), action, allowedHostnames: env.ALLOWED_HOSTNAMES },
    deps,
  );
}

export function requireTokenShape(token: unknown): asserts token is string {
  if (typeof token !== "string" || token.length < 16 || token.length > 128) {
    throw new ApiError(401, "token_ausente", "Use o link de gerenciamento que você recebeu.");
  }
}

/** Each declaration must be exactly `true`; the first missing one is named in the error. */
export function requireDeclarations(body: JsonObject, declarations: ReadonlyArray<readonly [string, string]>): void {
  for (const [field, message] of declarations) {
    if (body[field] !== true) throw invalid(field, message);
  }
}

export function reportReason(body: JsonObject): string {
  const motivo = body.motivo;
  if (typeof motivo !== "string" || !REPORT_REASONS.has(motivo)) {
    throw invalid("motivo", "Escolha o motivo da denúncia.");
  }
  return motivo;
}
