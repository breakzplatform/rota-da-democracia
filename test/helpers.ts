import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";
import { handleApi } from "../src/app";
import type { Deps, Env } from "../src/env";
import { clearMunicipioCache } from "../src/places";
import recife from "./fixtures/m-25313.json";

export const ORIGIN = "https://carona.test";
export const BEFORE_ELECTION = new Date("2026-10-20T12:00:00Z");

const shards: Readonly<Record<string, unknown>> = { "25313": recife };

const fakeAssets = {
  async fetch(input: RequestInfo | URL): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const match = /^\/data\/m\/(\d+)\.json$/.exec(url.pathname);
    const shard = match?.[1] ? shards[match[1]] : undefined;
    if (shard === undefined) return new Response("not found", { status: 404 });
    return Response.json(shard);
  },
  connect(): Socket {
    throw new Error("not supported");
  },
};

export const testEnv: Env = {
  DB: env.DB,
  ASSETS: fakeAssets as unknown as Fetcher,
  TURNSTILE_SITE_KEY: env.TURNSTILE_SITE_KEY,
  // A non-dummy secret so the hostname and action checks run against the fake siteverify.
  TURNSTILE_SECRET: "test-secret",
  IP_SALT: env.IP_SALT,
  ALLOWED_HOSTNAMES: "carona.test, localhost",
};

export const TURNSTILE = {
  oferecer: "pass:oferecer",
  contato: "pass:contato",
  denuncia: "pass:denuncia",
  grupo: "pass:grupo",
  entrar: "pass:entrar",
} as const;

export const clock = { now: BEFORE_ELECTION };
export const turnstileCalls: { secret: string; response: string; remoteip: string | null }[] = [];
export const telegramCalls: { url: string; chatId: unknown; text: string }[] = [];
const deferred: Promise<unknown>[] = [];

export async function flushDeferred(): Promise<void> {
  while (deferred.length > 0) await deferred.shift();
}

// Siteverify stand-in. "pass:<action>[@<hostname>]" succeeds and echoes that action and
// hostname (default carona.test); "fail" and "unreachable" exercise the error paths.
async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : input.toString();
  if (url.startsWith("https://api.telegram.org/")) {
    const payload = JSON.parse(String(init?.body)) as { chat_id: unknown; text: string };
    telegramCalls.push({ url, chatId: payload.chat_id, text: payload.text });
    return Response.json({ ok: true });
  }
  if (url !== "https://challenges.cloudflare.com/turnstile/v0/siteverify") {
    throw new Error(`unexpected fetch ${url}`);
  }
  const form = init?.body;
  if (!(form instanceof FormData)) throw new Error("expected form body");
  const response = String(form.get("response"));
  const remoteip = form.get("remoteip");
  turnstileCalls.push({
    secret: String(form.get("secret")),
    response,
    remoteip: remoteip === null ? null : String(remoteip),
  });
  if (response === "unreachable") throw new TypeError("network down");
  const pass = /^pass:([a-z]*)(?:@(.+))?$/.exec(response);
  if (!pass) return Response.json({ success: false, "error-codes": ["invalid-input-response"] });
  return Response.json({ success: true, action: pass[1], hostname: pass[2] ?? "carona.test" });
}

export const deps: Deps = { now: () => clock.now, fetch: fakeFetch, defer: (task) => void deferred.push(task) };

beforeEach(async () => {
  clock.now = BEFORE_ELECTION;
  turnstileCalls.length = 0;
  telegramCalls.length = 0;
  deferred.length = 0;
  clearMunicipioCache();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reports"),
    env.DB.prepare("DELETE FROM offers"),
    env.DB.prepare("DELETE FROM grupo_reports"),
    env.DB.prepare("DELETE FROM grupos"),
    env.DB.prepare("DELETE FROM rate_events"),
    env.DB.prepare("DELETE FROM system_state"),
  ]);
});

export interface CallOptions {
  body?: unknown;
  rawBody?: string;
  ip?: string;
  // Sent as the Authorization bearer, like the manage pages do.
  token?: string;
}

export function send(request: Request): Promise<Response> {
  return handleApi(request, testEnv, deps);
}

export async function call(method: string, path: string, options: CallOptions = {}): Promise<Response> {
  const headers = new Headers({ "CF-Connecting-IP": options.ip ?? "203.0.113.1" });
  let body: string | undefined;
  if (options.rawBody !== undefined) body = options.rawBody;
  else if (options.body !== undefined) body = JSON.stringify(options.body);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (options.token !== undefined) headers.set("Authorization", `Bearer ${options.token}`);
  return handleApi(new Request(`${ORIGIN}${path}`, { method, headers, body }), testEnv, deps);
}

export async function readJson<T = Record<string, unknown>>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export function validOffer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    turnstile: TURNSTILE.oferecer,
    nome: "Ana",
    contatoTipo: "whatsapp",
    contato: "(81) 99876-5432",
    municipio: "25313",
    localId: "1-1015",
    pontoEncontro: "Em frente à padaria da esquina",
    bairroSaida: "Boa Viagem",
    saida: "2026-10-25T10:00:00-03:00",
    vagas: 3,
    aceite: true,
    semVinculo: true,
    combinaWhatsapp: true,
    veiculoParticular: true,
    semPagamento: true,
    maiorHabilitado: true,
    umTrajeto: true,
    ...overrides,
  };
}

export interface Created {
  id: string;
  token: string;
  editarUrl: string;
}

export async function createOffer(overrides: Record<string, unknown> = {}, ip?: string): Promise<Created> {
  const response = await call("POST", "/api/ofertas", { body: validOffer(overrides), ip });
  if (response.status !== 201) throw new Error(`create failed: ${response.status} ${await response.text()}`);
  return readJson<Created>(response);
}

export interface PublicOffer {
  id: string;
  nome: string;
  localId: string;
  localNome: string;
  pontoEncontro: string;
  bairroSaida: string;
  saida: string;
  vagasLivres: number;
  nota: string | null;
  acessivel: boolean;
}

export async function list(query: string): Promise<PublicOffer[]> {
  const response = await call("GET", `/api/ofertas?${query}`);
  if (response.status !== 200) throw new Error(`list failed: ${response.status}`);
  return (await readJson<{ ofertas: PublicOffer[] }>(response)).ofertas;
}
