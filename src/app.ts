import { isPurged } from "./cleanup";
import { ELECTION } from "./config";
import { isClosed, purgeAt, windowEnd, windowStart } from "./election";
import type { Deps, Env } from "./env";
import { ApiError, errorResponse, json } from "./http";
import {
  countVisibleOffers,
  createOffer,
  deleteOffer,
  getOwnedOffer,
  listOffers,
  reportOffer,
  revealContact,
  updateOffer,
} from "./offers";

const OFFER_PATH = /^\/api\/ofertas\/([A-Za-z0-9_-]{8,32})(?:\/(contato|denuncia))?$/;

function methodNotAllowed(): ApiError {
  return new ApiError(405, "metodo_nao_permitido", "Método não permitido.");
}

function closed(): ApiError {
  return new ApiError(410, "encerrado", "A eleição acabou e os dados foram apagados. Obrigado por participar!");
}

async function route(request: Request, env: Env, deps: Deps): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;

  if (pathname === "/api/status") {
    if (method !== "GET") throw methodNotAllowed();
    const now = deps.now();
    const encerrado = isClosed(now) || (await isPurged(env.DB));
    return json({ ok: true, encerrado, totalOfertas: encerrado ? 0 : await countVisibleOffers(env, now) });
  }

  if (pathname === "/api/config") {
    if (method !== "GET") throw methodNotAllowed();
    return json(
      {
        turnstileSiteKey: env.TURNSTILE_SITE_KEY,
        janela: { inicio: windowStart.toISOString(), fim: windowEnd.toISOString() },
        encerraEm: purgeAt.toISOString(),
        data: ELECTION.date,
      },
      200,
      "short",
    );
  }

  if (pathname === "/api/ofertas") {
    if (method !== "GET" && method !== "POST") throw methodNotAllowed();
    if (isClosed(deps.now())) throw closed();
    return method === "GET" ? listOffers(request, env, deps) : createOffer(request, env, deps);
  }

  const match = OFFER_PATH.exec(pathname);
  if (match) {
    const [, id, action] = match;
    if (!id) throw new ApiError(404, "nao_encontrado", "Endereço não encontrado.");
    if (isClosed(deps.now())) throw closed();
    if (action === "contato") {
      if (method !== "POST") throw methodNotAllowed();
      return revealContact(request, env, deps, id);
    }
    if (action === "denuncia") {
      if (method !== "POST") throw methodNotAllowed();
      return reportOffer(request, env, deps, id);
    }
    if (method === "GET") return getOwnedOffer(request, env, id);
    if (method === "PATCH") return updateOffer(request, env, deps, id);
    if (method === "DELETE") return deleteOffer(request, env, id);
    throw methodNotAllowed();
  }

  throw new ApiError(404, "nao_encontrado", "Endereço não encontrado.");
}

export async function handleApi(request: Request, env: Env, deps: Deps): Promise<Response> {
  try {
    return await route(request, env, deps);
  } catch (error) {
    if (error instanceof ApiError) return errorResponse(error);
    console.error("unhandled API error", error);
    return errorResponse(new ApiError(500, "erro_interno", "Algo deu errado. Tente de novo em instantes."));
  }
}
