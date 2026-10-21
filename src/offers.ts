import { LIMITS, SITE_NAME } from "./config";
import { NOT_PURGED } from "./cleanup";
import { notifyReport } from "./notify";
import {
  CONTACT_ERRORS,
  contactLink,
  displayContact,
  isContactType,
  LINK_LABEL_MAX,
  normalizeContact,
  type ContactType,
} from "./contact";
import { clientIp, hashIp, randomToken, sha256Hex, tokenMatches } from "./crypto";
import { electionDayTime, isSignupClosed } from "./election";
import type { Deps, Env } from "./env";
import { ApiError, json, readJsonObject, type JsonObject } from "./http";
import { isMunicipioCode, loadMunicipio } from "./places";
import { withQuota } from "./rate-limit";
import { cleanText, foldForSearch } from "./text";
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
import {
  departure,
  integerInRange,
  invalid,
  optionalBoolean,
  optionalText,
  requiredText,
  screenNeutrality,
  seats,
} from "./validation";

interface OfferRow {
  id: string;
  token_hash: string;
  nome: string;
  contato_tipo: ContactType;
  contato: string;
  contato_rotulo: string | null;
  municipio: string;
  local_id: string;
  local_nome: string;
  ponto_encontro: string;
  bairro_saida: string;
  saida: string;
  vagas: number;
  vagas_livres: number;
  nota: string | null;
  acessivel: number;
  declarado_em: string;
  created_at: string;
  oculta: number;
  denuncias: number;
}

export const CONFIRMATION_NOTICE =
  "A carona só é confirmada entre as pessoas, pelo contato combinado. O site não organiza, confirma, nem garante caronas.";
const LOCAL_ID = /^\d{1,4}-\d{1,6}$/;
const MAX_RESULTS = 200;
// Offers stay listed this long after departure, for riders running a little late.
export const DEPARTURE_GRACE_MS = 30 * 60 * 1000;

function listedSince(now: Date): string {
  return new Date(now.getTime() - DEPARTURE_GRACE_MS).toISOString();
}

const SELECT_OFFER = `
  SELECT o.*, (SELECT COUNT(*) FROM reports r WHERE r.offer_id = o.id) AS denuncias
  FROM offers o`;

function isVisible(row: OfferRow): boolean {
  return row.vagas_livres > 0 && row.oculta === 0;
}

function publicView(row: OfferRow) {
  return {
    id: row.id,
    nome: row.nome,
    localId: row.local_id,
    localNome: row.local_nome,
    pontoEncontro: row.ponto_encontro,
    bairroSaida: row.bairro_saida,
    saida: row.saida,
    vagasLivres: row.vagas_livres,
    nota: row.nota,
    acessivel: row.acessivel === 1,
  };
}

function ownerView(row: OfferRow) {
  return {
    ...publicView(row),
    contatoTipo: row.contato_tipo,
    contato: displayContact(row.contato_tipo, row.contato),
    ...(row.contato_rotulo ? { contatoRotulo: row.contato_rotulo } : {}),
    municipio: row.municipio,
    vagas: row.vagas,
    denuncias: row.denuncias,
    // True when full or hidden by a moderator; reports alone never hide an offer.
    oculta: !isVisible(row),
    moderada: row.oculta === 1,
    criadaEm: row.created_at,
    declaradoEm: row.declarado_em,
  };
}

export function offerSummary(row: Pick<OfferRow, "nome" | "ponto_encontro" | "local_nome" | "nota">): string {
  return [`${row.nome}: ${row.ponto_encontro} → ${row.local_nome}`, row.nota].filter(Boolean).join(" · ");
}

function notFound(): ApiError {
  return new ApiError(404, "oferta_nao_encontrada", "Essa oferta não existe mais.");
}

async function findOffer(env: Env, id: string): Promise<OfferRow> {
  const row = await env.DB.prepare(`${SELECT_OFFER} WHERE o.id = ?`).bind(id).first<OfferRow>();
  if (!row) throw notFound();
  return row;
}

async function authorize(env: Env, id: string, token: unknown): Promise<OfferRow> {
  requireTokenShape(token);
  const row = await findOffer(env, id);
  if (!(await tokenMatches(token, row.token_hash))) {
    throw new ApiError(403, "token_invalido", "Esse link de gerenciamento não vale para esta oferta.");
  }
  return row;
}

const DECLARATIONS = [
  ["aceite", "Para oferecer carona, é preciso aceitar as regras: carona gratuita, sem pedir voto e sem material de campanha."],
  ["maiorHabilitado", "Para oferecer carona, é preciso confirmar que você tem 18 anos ou mais e carteira de motorista válida."],
  ["semVinculo", "Para oferecer carona, é preciso declarar que você não tem vínculo com candidato, partido ou campanha."],
  ["combinaWhatsapp", "Para oferecer carona, é preciso confirmar que só vai levar quem combinar antes com você pelo contato que deixou."],
  ["veiculoParticular", "Para oferecer carona, é preciso confirmar que o carro é particular, seu ou da sua família, e sem propaganda."],
  ["semPagamento", "Para oferecer carona, é preciso confirmar que você não recebe nada por ela e que não é caravana."],
  ["umTrajeto", "Para oferecer carona, é preciso confirmar que vai dar carona só no seu trajeto, uma ida e uma volta, sem ficar indo e voltando para levar várias pessoas."],
] as const;

export async function createOffer(request: Request, env: Env, deps: Deps): Promise<Response> {
  if (isSignupClosed(deps.now())) throw signupClosed();
  const body = await readJsonObject(request);
  requireDeclarations(body, DECLARATIONS);

  const nome = requiredText(body, "nome", LIMITS.nome, "nome");
  const contatoTipo = body.contatoTipo;
  if (!isContactType(contatoTipo)) {
    throw invalid("contatoTipo", "Escolha como as pessoas vão falar com você: e-mail, usuário do WhatsApp, Instagram, Bluesky, outro link ou número do WhatsApp.");
  }
  const contato = typeof body.contato === "string" ? normalizeContact(contatoTipo, body.contato) : null;
  if (!contato) throw invalid("contato", CONTACT_ERRORS[contatoTipo]);
  const contatoRotulo =
    contatoTipo === "outro" ? requiredText(body, "contatoRotulo", LINK_LABEL_MAX, "nome do aplicativo") : null;
  if (!isMunicipioCode(body.municipio)) throw invalid("municipio", "Escolha o município.");
  const municipio = body.municipio;
  const localId = body.localId;
  if (typeof localId !== "string" || !LOCAL_ID.test(localId)) {
    throw invalid("localId", "Escolha o local de votação.");
  }
  const pontoEncontro = requiredText(body, "pontoEncontro", LIMITS.pontoEncontro, "ponto de encontro");
  const bairroSaida = requiredText(body, "bairroSaida", LIMITS.bairroSaida, "bairro de saída");
  const saida = departure(body.saida);
  const vagas = seats(body.vagas);
  const nota = optionalText(body, "nota", LIMITS.nota, "observação");
  const acessivel = optionalBoolean(body, "acessivel");
  screenNeutrality([
    ["nome", nome],
    ["pontoEncontro", pontoEncontro],
    ["bairroSaida", bairroSaida],
    ["nota", nota],
    ["contato", contatoTipo === "whatsapp" ? null : contato],
    ["contatoRotulo", contatoRotulo],
  ]);

  const ipHash = await hashIp(clientIp(request), env.IP_SALT);
  const now = deps.now();
  const id = randomToken(9);
  const token = randomToken(24);
  const exhausted = new ApiError(429, "limite_de_ofertas", "Você já cadastrou o máximo de ofertas por hoje.");

  await withQuota(env.DB, "oferta", ipHash, now, () => quotaExhausted(env, exhausted), async () => {
    await turnstile(request, env, deps, body.turnstile, "oferecer");

    const shard = await loadMunicipio(env.ASSETS, municipio);
    if (!shard) throw invalid("municipio", "Município não encontrado.");
    const local = shard.locais.find((place) => place.id === localId);
    if (!local) throw invalid("localId", "Local de votação não encontrado nesse município.");

    const timestamp = now.toISOString();
    const inserted = await env.DB.prepare(
      `INSERT INTO offers (id, token_hash, nome, contato_tipo, contato, contato_rotulo, municipio, local_id, local_nome, ponto_encontro,
         bairro_saida, bairro_busca, saida, vagas, vagas_livres, nota, acessivel, aceite, sem_vinculo,
         combina_whatsapp, veiculo_particular, sem_pagamento, maior_habilitado, um_trajeto, declarado_em, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1, 1, 1, 1, ?, ?, ?
       WHERE ${NOT_PURGED}`,
    )
      .bind(
        id,
        await sha256Hex(token),
        nome,
        contatoTipo,
        contato,
        contatoRotulo,
        municipio,
        local.id,
        local.nome,
        pontoEncontro,
        bairroSaida,
        foldForSearch(bairroSaida),
        saida.toISOString(),
        vagas,
        vagas,
        nota,
        acessivel ? 1 : 0,
        timestamp,
        timestamp,
        timestamp,
      )
      .run();
    if (inserted.meta.changes !== 1) throw closed();
  });

  const editarUrl = new URL(`/gerenciar?id=${id}&token=${token}`, request.url).toString();
  return json({ id, token, editarUrl }, 201);
}

export async function listOffers(request: Request, env: Env, deps: Deps): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const municipio = params.get("municipio");
  if (!isMunicipioCode(municipio)) throw invalid("municipio", "Escolha o município.");

  const where = ["o.municipio = ?", "o.saida >= ?", "o.vagas_livres > 0"];
  const binds: (string | number)[] = [municipio, listedSince(deps.now())];

  const localId = params.get("localId");
  if (localId) {
    if (!LOCAL_ID.test(localId)) throw invalid("localId", "Local de votação inválido.");
    where.push("o.local_id = ?");
    binds.push(localId);
  }
  const bairro = foldForSearch(cleanText(params.get("bairro") ?? ""));
  if (bairro) {
    if (bairro.length > LIMITS.bairroSaida) throw invalid("bairro", "Bairro grande demais.");
    where.push("instr(o.bairro_busca, ?) > 0");
    binds.push(bairro);
  }
  for (const [param, operator] of [
    ["de", ">="],
    ["ate", "<="],
  ] as const) {
    const value = params.get(param);
    if (!value) continue;
    const instant = electionDayTime(value);
    if (!instant) throw invalid(param, "Use o formato HH:MM.");
    where.push(`o.saida ${operator} ?`);
    binds.push(instant.toISOString());
  }

  const { results } = await env.DB.prepare(
    `${SELECT_OFFER} WHERE ${where.join(" AND ")}
       AND o.oculta = 0
     ORDER BY o.saida, o.created_at LIMIT ?`,
  )
    .bind(...binds, MAX_RESULTS)
    .all<OfferRow>();
  return json({ ofertas: results.map(publicView) });
}

export async function revealContact(request: Request, env: Env, deps: Deps, id: string): Promise<Response> {
  const body = await readJsonObject(request);
  if (body.ciente !== true) {
    throw invalid(
      "ciente",
      "Para ver o contato, confirme que entende que a carona é gratuita, combinada direto com quem oferece, e sem falar de candidato nem pedir voto.",
    );
  }
  const ipHash = await hashIp(clientIp(request), env.IP_SALT);
  const exhausted = new ApiError(429, "limite_de_contatos", "Muitos pedidos de contato. Tente de novo daqui a pouco.");
  const row = await withQuota(env.DB, "contato", ipHash, deps.now(), () => quotaExhausted(env, exhausted), async () => {
    await turnstile(request, env, deps, body.turnstile, "contato");
    const offer = await findOffer(env, id);
    if (!isVisible(offer)) throw notFound();
    return offer;
  });

  const link = contactLink(row.contato_tipo, row.contato, row.local_nome, SITE_NAME);
  return json({
    tipo: row.contato_tipo,
    valor: displayContact(row.contato_tipo, row.contato),
    ...(row.contato_rotulo ? { rotulo: row.contato_rotulo } : {}),
    ...(link ? { link } : {}),
    aviso: CONFIRMATION_NOTICE,
  });
}

export async function getOwnedOffer(request: Request, env: Env, id: string): Promise<Response> {
  return json(ownerView(await authorize(env, id, bearerToken(request))));
}

export async function updateOffer(request: Request, env: Env, deps: Deps, id: string): Promise<Response> {
  const body = await readJsonObject(request);
  const row = await authorize(env, id, body.token);

  const changes: string[] = [];
  const binds: (string | number | null)[] = [];
  // Re-checked inside the UPDATE so a concurrent change cannot slip an invalid value in.
  const guards = ["id = ?", "token_hash = ?"];
  const guardBinds: (string | number)[] = [id, row.token_hash];
  if (body.vagasLivres !== undefined) {
    const vagasLivres = integerInRange(body.vagasLivres, "vagasLivres", 0, row.vagas, seatsMessage(row));
    changes.push("vagas_livres = ?");
    binds.push(vagasLivres);
    guards.push("? BETWEEN 0 AND vagas");
    guardBinds.push(vagasLivres);
  }
  if (body.saida !== undefined) {
    changes.push("saida = ?");
    binds.push(departure(body.saida).toISOString());
  }
  let pontoEncontro: string | null = null;
  if (body.pontoEncontro !== undefined) {
    pontoEncontro = requiredText(body, "pontoEncontro", LIMITS.pontoEncontro, "ponto de encontro");
    changes.push("ponto_encontro = ?");
    binds.push(pontoEncontro);
  }
  let nota: string | null = null;
  if (body.nota !== undefined) {
    nota = optionalText(body, "nota", LIMITS.nota, "observação");
    changes.push("nota = ?");
    binds.push(nota);
  }
  if (changes.length === 0) throw invalid("corpo", "Nada para alterar.");
  screenNeutrality([
    ["pontoEncontro", pontoEncontro],
    ["nota", nota],
  ]);

  const updated = await env.DB.prepare(
    `UPDATE offers SET ${changes.join(", ")}, updated_at = ? WHERE ${guards.join(" AND ")}`,
  )
    .bind(...binds, deps.now().toISOString(), ...guardBinds)
    .run();
  if (updated.meta.changes !== 1) {
    const current = await findOffer(env, id);
    throw invalid("vagasLivres", seatsMessage(current));
  }
  return json(ownerView(await findOffer(env, id)));
}

function seatsMessage(row: OfferRow): string {
  return `Informe de 0 a ${row.vagas} vagas livres.`;
}

export async function deleteOffer(request: Request, env: Env, id: string): Promise<Response> {
  const body = await readJsonObject(request);
  await authorize(env, id, body.token);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reports WHERE offer_id = ?").bind(id),
    env.DB.prepare("DELETE FROM offers WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
}

export async function reportOffer(request: Request, env: Env, deps: Deps, id: string): Promise<Response> {
  const body = await readJsonObject(request);
  const motivo = reportReason(body);
  // Hashed per network (IPv6 /64), so one subscriber cannot count as several reporters.
  const ipHash = await hashIp(clientIp(request), env.IP_SALT);
  const now = deps.now();
  const exhausted = new ApiError(429, "limite_de_denuncias", "Você já fez o máximo de denúncias por hoje.");
  const offer = await withQuota(env.DB, "denuncia", ipHash, now, () => quotaExhausted(env, exhausted), async () => {
    await turnstile(request, env, deps, body.turnstile, "denuncia");
    await findOffer(env, id);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO reports (offer_id, ip_hash, motivo, created_at)
       SELECT ?, ?, ?, ? WHERE ${NOT_PURGED}`,
    )
      .bind(id, ipHash, motivo, now.toISOString())
      .run();
    return findOffer(env, id);
  });
  deps.defer(
    notifyReport(env, deps, {
      tipo: "oferta",
      id,
      municipio: offer.municipio,
      motivo,
      texto: offerSummary(offer),
      total: offer.denuncias,
    }),
  );
  return json({ ok: true }, 202);
}

export async function countVisibleOffers(env: Env, now: Date): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM offers o
     WHERE o.vagas_livres > 0 AND o.oculta = 0 AND o.saida >= ?`,
  )
    .bind(listedSince(now))
    .first<{ total: number }>();
  return row?.total ?? 0;
}
