import { displayContact, type ContactType } from "./contact";
import { secretMatches } from "./crypto";
import type { Deps, Env } from "./env";
import { groupSummary } from "./groups";
import { ApiError, json } from "./http";
import { offerSummary } from "./offers";

const ITEM_PATH = /^\/api\/admin\/(ofertas|grupos)\/([A-Za-z0-9_-]{8,32})\/(ocultar|restaurar)$/;

interface ReportStats {
  total: number;
  pendentes: number;
  cobranca: number;
  campanha: number;
  falsa: number;
  outro: number;
  ultima: string;
}

interface OfferReportRow extends ReportStats {
  id: string;
  municipio: string;
  nome: string;
  ponto_encontro: string;
  local_nome: string;
  nota: string | null;
  oculta: number;
  contato_tipo: ContactType;
  contato: string;
}

interface GroupReportRow extends ReportStats {
  id: string;
  municipio: string;
  nome: string;
  bairros: string;
  oculto: number;
  link: string;
}

const STATS = `COUNT(*) AS total,
  SUM(r.revisado_em IS NULL) AS pendentes,
  SUM(r.motivo = 'cobranca') AS cobranca,
  SUM(r.motivo = 'campanha') AS campanha,
  SUM(r.motivo = 'falsa') AS falsa,
  SUM(r.motivo = 'outro') AS outro,
  MAX(r.created_at) AS ultima`;

function notFound(): ApiError {
  return new ApiError(404, "nao_encontrado", "Endereço não encontrado.");
}

async function requireAdmin(request: Request, env: Env): Promise<void> {
  // Without the secret the moderation API does not exist at all.
  if (!env.ADMIN_TOKEN) throw notFound();
  const header = request.headers.get("Authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!given || !(await secretMatches(given, env.ADMIN_TOKEN))) {
    throw new ApiError(401, "nao_autorizado", "Acesso restrito à moderação.");
  }
}

function stats(row: ReportStats) {
  return {
    total: row.total,
    pendentes: row.pendentes,
    motivos: { cobranca: row.cobranca, campanha: row.campanha, falsa: row.falsa, outro: row.outro },
    ultimaEm: row.ultima,
  };
}

async function listPending(request: Request, env: Env): Promise<Response> {
  const detalhe = new URL(request.url).searchParams.get("detalhe") === "1";
  const [offers, groups] = await Promise.all([
    env.DB.prepare(
      `SELECT o.id, o.municipio, o.nome, o.ponto_encontro, o.local_nome, o.nota, o.oculta, o.contato_tipo, o.contato,
         ${STATS}
       FROM offers o JOIN reports r ON r.offer_id = o.id
       GROUP BY o.id HAVING pendentes > 0`,
    ).all<OfferReportRow>(),
    env.DB.prepare(
      `SELECT g.id, g.municipio, g.nome, g.bairros, g.oculto, g.link, ${STATS}
       FROM grupos g JOIN grupo_reports r ON r.grupo_id = g.id
       GROUP BY g.id HAVING pendentes > 0`,
    ).all<GroupReportRow>(),
  ]);
  const denuncias = [
    ...offers.results.map((row) => ({
      tipo: "oferta" as const,
      id: row.id,
      municipio: row.municipio,
      texto: offerSummary(row),
      oculta: row.oculta === 1,
      ...stats(row),
      ...(detalhe ? { contatoTipo: row.contato_tipo, contato: displayContact(row.contato_tipo, row.contato) } : {}),
    })),
    ...groups.results.map((row) => ({
      tipo: "grupo" as const,
      id: row.id,
      municipio: row.municipio,
      texto: groupSummary(row),
      oculta: row.oculto === 1,
      ...stats(row),
      ...(detalhe ? { link: row.link } : {}),
    })),
  ].sort((first, second) => second.ultimaEm.localeCompare(first.ultimaEm));
  return json({ denuncias });
}

async function moderate(env: Env, deps: Deps, kind: "ofertas" | "grupos", id: string, hide: boolean): Promise<Response> {
  const [table, flag, reports, key] =
    kind === "ofertas"
      ? (["offers", "oculta", "reports", "offer_id"] as const)
      : (["grupos", "oculto", "grupo_reports", "grupo_id"] as const);
  const [updated] = await env.DB.batch([
    env.DB.prepare(`UPDATE ${table} SET ${flag} = ? WHERE id = ?`).bind(hide ? 1 : 0, id),
    env.DB.prepare(`UPDATE ${reports} SET revisado_em = ? WHERE ${key} = ? AND revisado_em IS NULL`).bind(
      deps.now().toISOString(),
      id,
    ),
  ]);
  if (updated?.meta.changes !== 1) throw notFound();
  return json({ ok: true, id, oculta: hide });
}

export async function handleAdmin(request: Request, env: Env, deps: Deps, pathname: string): Promise<Response> {
  await requireAdmin(request, env);
  if (pathname === "/api/admin/denuncias") {
    if (request.method !== "GET") throw new ApiError(405, "metodo_nao_permitido", "Método não permitido.");
    return listPending(request, env);
  }
  const match = ITEM_PATH.exec(pathname);
  const [, kind, id, action] = match ?? [];
  if ((kind !== "ofertas" && kind !== "grupos") || !id) throw notFound();
  if (request.method !== "POST") throw new ApiError(405, "metodo_nao_permitido", "Método não permitido.");
  return moderate(env, deps, kind, id, action === "ocultar");
}
