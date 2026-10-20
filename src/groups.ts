import { NOT_PURGED } from "./cleanup";
import { notifyReport } from "./notify";
import { LIMITS } from "./config";
import { clientIp, hashIp, randomToken, sha256Hex, tokenMatches } from "./crypto";
import { isSignupClosed } from "./election";
import type { Deps, Env } from "./env";
import { ApiError, json, readJsonObject } from "./http";
import { isMunicipioCode, loadMunicipio } from "./places";
import { withQuota } from "./rate-limit";
import {
  bearerToken,
  closed,
  quotaExhausted,
  reportReason,
  requireDeclarations,
  requireTokenShape,
  signupClosed,
  turnstile,
} from "./shared";
import { cleanText, foldForSearch } from "./text";
import { invalid, requiredText, screenNeutrality } from "./validation";

interface GroupRow {
  id: string;
  token_hash: string;
  municipio: string;
  nome: string;
  bairros: string;
  link: string;
  admin_nome: string;
  declarado_em: string;
  created_at: string;
  oculto: number;
  denuncias: number;
}

const GROUP_LIMITS = { nome: 60, bairros: 100, adminNome: 30, busca: 60 } as const;
const INVITE_LINK = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{10,40}$/;
const MAX_RESULTS = 200;

export const GROUP_RULES: readonly string[] = [
  "O grupo é apartidário: não se pede voto, não se fala de candidato e não circula material de campanha.",
  "Carona é gratuita: ninguém cobra nem divide combustível.",
  "Só carro particular, com no máximo 4 pessoas; nada de caravana ou transporte em grupo organizado.",
  "A carona só é confirmada entre as pessoas, pelo contato combinado. O site não organiza, confirma, nem garante caronas.",
];

const DECLARATIONS = [
  ["aceite", "Para cadastrar o grupo, é preciso aceitar as regras: carona gratuita, sem pedir voto e sem material de campanha."],
  ["semVinculo", "Para cadastrar o grupo, é preciso declarar que você não tem vínculo com candidato, partido ou campanha."],
  ["grupoApartidario", "Para cadastrar o grupo, é preciso confirmar que ele é apartidário: sem pedir voto, sem falar de candidato e sem material de campanha."],
  ["semCaravana", "Para cadastrar o grupo, é preciso confirmar que as caronas são só em carro particular, com até 4 pessoas, sem cobrança e sem caravana."],
  ["adminResponsavel", "Para cadastrar o grupo, é preciso confirmar que você administra o grupo e vai remover quem fizer campanha."],
] as const;

const SELECT_GROUP = `
  SELECT g.*, (SELECT COUNT(*) FROM grupo_reports r WHERE r.grupo_id = g.id) AS denuncias
  FROM grupos g`;

function isVisible(row: GroupRow): boolean {
  return row.oculto === 0;
}

function publicView(row: GroupRow) {
  return { id: row.id, nome: row.nome, bairros: row.bairros, adminNome: row.admin_nome, criadoEm: row.created_at };
}

function ownerView(row: GroupRow) {
  return {
    ...publicView(row),
    municipio: row.municipio,
    link: row.link,
    denuncias: row.denuncias,
    oculto: !isVisible(row),
    declaradoEm: row.declarado_em,
  };
}

export function groupSummary(row: Pick<GroupRow, "nome" | "bairros">): string {
  return `${row.nome} (${row.bairros})`;
}

function notFound(): ApiError {
  return new ApiError(404, "grupo_nao_encontrado", "Esse grupo não está mais na lista.");
}

async function findGroup(env: Env, id: string): Promise<GroupRow> {
  const row = await env.DB.prepare(`${SELECT_GROUP} WHERE g.id = ?`).bind(id).first<GroupRow>();
  if (!row) throw notFound();
  return row;
}

async function authorize(env: Env, id: string, token: unknown): Promise<GroupRow> {
  requireTokenShape(token);
  const row = await findGroup(env, id);
  if (!(await tokenMatches(token, row.token_hash))) {
    throw new ApiError(403, "token_invalido", "Esse link de gerenciamento não vale para este grupo.");
  }
  return row;
}

export async function createGroup(request: Request, env: Env, deps: Deps): Promise<Response> {
  if (isSignupClosed(deps.now())) throw signupClosed();
  const body = await readJsonObject(request);
  requireDeclarations(body, DECLARATIONS);

  if (!isMunicipioCode(body.municipio)) throw invalid("municipio", "Escolha o município.");
  const municipio = body.municipio;
  const nome = requiredText(body, "nome", GROUP_LIMITS.nome, "nome do grupo");
  const bairros = requiredText(body, "bairros", GROUP_LIMITS.bairros, "bairros ou zona");
  const adminNome = requiredText(body, "adminNome", GROUP_LIMITS.adminNome, "seu nome");
  const link = typeof body.link === "string" ? body.link.trim() : "";
  if (!INVITE_LINK.test(link)) {
    throw invalid("link", "Cole o link de convite do grupo, no formato https://chat.whatsapp.com/…");
  }
  screenNeutrality([
    ["nome", nome],
    ["bairros", bairros],
    ["adminNome", adminNome],
  ]);

  const ipHash = await hashIp(clientIp(request), env.IP_SALT);
  const now = deps.now();
  const id = randomToken(9);
  const token = randomToken(24);
  const exhausted = new ApiError(429, "limite_de_grupos", "Você já cadastrou o máximo de grupos por hoje.");

  await withQuota(env.DB, "grupo", ipHash, now, () => quotaExhausted(env, exhausted), async () => {
    await turnstile(request, env, deps, body.turnstile, "grupo");
    if (!(await loadMunicipio(env.ASSETS, municipio))) throw invalid("municipio", "Município não encontrado.");

    const timestamp = now.toISOString();
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO grupos (id, token_hash, municipio, nome, bairros, busca, link, admin_nome, aceite,
         sem_vinculo, grupo_apartidario, sem_caravana, admin_responsavel, declarado_em, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, 1, ?, ?
       WHERE ${NOT_PURGED}`,
    )
      .bind(id, await sha256Hex(token), municipio, nome, bairros, foldForSearch(`${nome} ${bairros}`), link, adminNome, timestamp, timestamp)
      .run();
    if (inserted.meta.changes === 1) return;
    const duplicate = await env.DB.prepare("SELECT 1 FROM grupos WHERE link = ?").bind(link).first();
    if (duplicate) throw new ApiError(409, "grupo_ja_cadastrado", "Esse grupo já está na lista.", "link");
    throw closed();
  });

  const editarUrl = new URL(`/gerenciar-grupo?id=${id}&token=${token}`, request.url).toString();
  return json({ id, token, editarUrl }, 201);
}

export async function listGroups(request: Request, env: Env): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const municipio = params.get("municipio");
  if (!isMunicipioCode(municipio)) throw invalid("municipio", "Escolha o município.");
  const where = ["g.municipio = ?"];
  const binds: (string | number)[] = [municipio];
  const query = foldForSearch(cleanText(params.get("q") ?? ""));
  if (query) {
    if (query.length > GROUP_LIMITS.busca) throw invalid("q", "Busca grande demais.");
    where.push("instr(g.busca, ?) > 0");
    binds.push(query);
  }
  const { results } = await env.DB.prepare(
    `${SELECT_GROUP} WHERE ${where.join(" AND ")}
       AND g.oculto = 0
     ORDER BY g.busca, g.created_at LIMIT ?`,
  )
    .bind(...binds, MAX_RESULTS)
    .all<GroupRow>();
  return json({ grupos: results.map(publicView) });
}

export async function joinGroup(request: Request, env: Env, deps: Deps, id: string): Promise<Response> {
  const body = await readJsonObject(request);
  if (body.ciente !== true) {
    throw invalid(
      "ciente",
      "Para entrar, confirme que entende as regras: grupo apartidário, carona gratuita em carro particular, sem caravana e sem pedir voto.",
    );
  }
  const ipHash = await hashIp(clientIp(request), env.IP_SALT);
  const exhausted = new ApiError(429, "limite_de_contatos", "Muitos pedidos de contato. Tente de novo daqui a pouco.");
  const row = await withQuota(env.DB, "contato", ipHash, deps.now(), () => quotaExhausted(env, exhausted), async () => {
    await turnstile(request, env, deps, body.turnstile, "entrar");
    const group = await findGroup(env, id);
    if (!isVisible(group)) throw notFound();
    return group;
  });
  return json({ link: row.link, regras: GROUP_RULES });
}

export async function getOwnedGroup(request: Request, env: Env, id: string): Promise<Response> {
  return json(ownerView(await authorize(env, id, bearerToken(request))));
}

export async function deleteGroup(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readJsonObject(request);
  await authorize(env, id, body.token);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM grupo_reports WHERE grupo_id = ?").bind(id),
    env.DB.prepare("DELETE FROM grupos WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
}

export async function reportGroup(request: Request, env: Env, deps: Deps, id: string): Promise<Response> {
  const body = await readJsonObject(request);
  const motivo = reportReason(body);
  const ipHash = await hashIp(clientIp(request), env.IP_SALT);
  const now = deps.now();
  const exhausted = new ApiError(429, "limite_de_denuncias", "Você já fez o máximo de denúncias por hoje.");
  const group = await withQuota(env.DB, "denuncia", ipHash, now, () => quotaExhausted(env, exhausted), async () => {
    await turnstile(request, env, deps, body.turnstile, "denuncia");
    await findGroup(env, id);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO grupo_reports (grupo_id, ip_hash, motivo, created_at)
       SELECT ?, ?, ?, ? WHERE ${NOT_PURGED}`,
    )
      .bind(id, ipHash, motivo, now.toISOString())
      .run();
    return findGroup(env, id);
  });
  deps.defer(
    notifyReport(env, deps, {
      tipo: "grupo",
      id,
      municipio: group.municipio,
      motivo,
      texto: groupSummary(group),
      total: group.denuncias,
    }),
  );
  return json({ ok: true }, 202);
}
