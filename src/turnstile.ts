import type { Deps } from "./env";
import { ApiError } from "./http";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 5000;

export type TurnstileAction = "oferecer" | "contato" | "denuncia" | "grupo" | "entrar";

// Cloudflare's documented dummy secrets answer with a fixed hostname and no
// action, so those two checks only run with a real secret.
const DUMMY_SECRET = /^[123]x0{31}AA$/;

export interface TurnstileCheck {
  secret: string;
  ip: string;
  action: TurnstileAction;
  allowedHostnames: string | undefined;
}

function rejected(): ApiError {
  return new ApiError(403, "turnstile_invalido", "A verificação falhou. Recarregue a página e tente de novo.");
}

export function parseHostnames(list: string | undefined): Set<string> {
  return new Set(
    (list ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
  );
}

export async function verifyTurnstile(token: unknown, check: TurnstileCheck, deps: Deps): Promise<void> {
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    throw new ApiError(400, "turnstile_ausente", "Confirme que você não é um robô.");
  }
  const form = new FormData();
  form.append("secret", check.secret);
  form.append("response", token);
  if (check.ip !== "unknown") form.append("remoteip", check.ip);
  let outcome: unknown;
  try {
    const response = await deps.fetch(SITEVERIFY_URL, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    outcome = await response.json();
  } catch {
    throw new ApiError(503, "turnstile_indisponivel", "Não conseguimos verificar agora. Tente de novo em instantes.");
  }
  if (typeof outcome !== "object" || outcome === null) throw rejected();
  const result = outcome as Record<string, unknown>;
  if (result.success !== true) throw rejected();
  if (DUMMY_SECRET.test(check.secret)) return;
  const hostname = typeof result.hostname === "string" ? result.hostname.toLowerCase() : "";
  if (!parseHostnames(check.allowedHostnames).has(hostname)) throw rejected();
  if (result.action !== check.action) throw rejected();
}
