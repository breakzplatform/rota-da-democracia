import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/config";
import { sha256Hex } from "../src/crypto";
import {
  call,
  clock,
  createOffer,
  list,
  readJson,
  send,
  testEnv,
  TURNSTILE,
  turnstileCalls,
  validOffer,
} from "./helpers";

interface ErrorBody {
  error: string;
  message: string;
  campo?: string;
}

async function expectError(response: Response, status: number, code: string, field?: string): Promise<ErrorBody> {
  expect(response.status).toBe(status);
  const body = await readJson<ErrorBody>(response);
  expect(body.error).toBe(code);
  expect(body.message.length).toBeGreaterThan(0);
  if (field) expect(body.campo).toBe(field);
  return body;
}

describe("POST /api/ofertas", () => {
  it("creates an offer and returns id, token and manage URL", async () => {
    const response = await call("POST", "/api/ofertas", { body: validOffer() });
    expect(response.status).toBe(201);
    const body = await readJson<{ id: string; token: string; editarUrl: string }>(response);
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(body.token.length).toBeGreaterThanOrEqual(32);
    const url = new URL(body.editarUrl);
    expect(url.pathname).toBe("/gerenciar");
    expect(url.searchParams.get("id")).toBe(body.id);
    expect(url.searchParams.get("token")).toBe(body.token);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("stores the token hash, never the token, and the normalized contact", async () => {
    const { id, token } = await createOffer();
    const row = await env.DB.prepare("SELECT * FROM offers WHERE id = ?").bind(id).first<Record<string, unknown>>();
    expect(row?.token_hash).toBe(await sha256Hex(token));
    expect(Object.values(row ?? {})).not.toContain(token);
    expect(row?.contato_tipo).toBe("whatsapp");
    expect(row?.contato).toBe("+5581998765432");
    expect(row).not.toHaveProperty("whatsapp");
    expect(row?.local_nome).toBe("ESCOLA PRAÇA 13 DE MAIO");
    expect(row?.saida).toBe("2026-10-25T13:00:00.000Z");
  });

  it("records the seven declarations with a timestamp", async () => {
    const { id } = await createOffer();
    const row = await env.DB.prepare(
      `SELECT aceite, sem_vinculo, combina_whatsapp, veiculo_particular, sem_pagamento, maior_habilitado,
         um_trajeto, declarado_em FROM offers WHERE id = ?`,
    )
      .bind(id)
      .first<Record<string, unknown>>();
    expect(row).toEqual({
      aceite: 1,
      sem_vinculo: 1,
      combina_whatsapp: 1,
      veiculo_particular: 1,
      sem_pagamento: 1,
      maior_habilitado: 1,
      um_trajeto: 1,
      declarado_em: clock.now.toISOString(),
    });
  });

  const declarations = ["aceite", "semVinculo", "combinaWhatsapp", "veiculoParticular", "semPagamento", "maiorHabilitado", "umTrajeto"];

  it.each(declarations)("requires the %s declaration to be exactly true", async (field) => {
    for (const value of [undefined, false, "true", 1]) {
      const response = await call("POST", "/api/ofertas", { body: validOffer({ [field]: value }) });
      await expectError(response, 400, "campo_invalido", field);
    }
    expect(turnstileCalls).toHaveLength(0);
  });

  it("names each missing declaration in its message", async () => {
    const messages = new Set<string>();
    for (const field of declarations) {
      const response = await call("POST", "/api/ofertas", { body: validOffer({ [field]: false }) });
      messages.add((await readJson<ErrorBody>(response)).message);
    }
    expect(messages.size).toBe(declarations.length);
  });

  it("verifies Turnstile with the secret and the client IP", async () => {
    await createOffer({}, "198.51.100.7");
    expect(turnstileCalls).toEqual([
      { secret: "test-secret", response: "pass:oferecer", remoteip: "198.51.100.7" },
    ]);
  });

  it("rejects a failed, missing or unverifiable Turnstile token", async () => {
    await expectError(await call("POST", "/api/ofertas", { body: validOffer({ turnstile: "fail" }) }), 403, "turnstile_invalido");
    await expectError(await call("POST", "/api/ofertas", { body: validOffer({ turnstile: "" }) }), 400, "turnstile_ausente");
    await expectError(
      await call("POST", "/api/ofertas", { body: validOffer({ turnstile: "unreachable" }) }),
      503,
      "turnstile_indisponivel",
    );
    const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM offers").first<{ total: number }>();
    expect(count?.total).toBe(0);
  });

  it.each([
    ["contatoTipo", { contatoTipo: undefined }],
    ["contatoTipo", { contatoTipo: "telegram" }],
    ["contato", { contato: undefined }],
    ["contato", { contato: "(81) 3456-7890" }],
    ["contato", { contato: 81998765432 }],
    ["contato", { contatoTipo: "email", contato: "(81) 99876-5432" }],
    ["contato", { contatoTipo: "whatsapp_usuario", contato: "maria@exemplo.com" }],
    ["municipio", { municipio: "99999" }],
    ["municipio", { municipio: "../etc" }],
    ["localId", { localId: "9-9999" }],
    ["localId", { localId: "1-1015/../x" }],
    ["vagas", { vagas: 0 }],
    ["vagas", { vagas: 5 }],
    ["vagas", { vagas: 2.5 }],
    ["vagas", { vagas: "3" }],
    ["saida", { saida: "2026-10-25T08:59:00-03:00" }],
    ["saida", { saida: "2026-10-25T17:01:00-03:00" }],
    ["saida", { saida: "2026-10-24T10:00:00-03:00" }],
    ["saida", { saida: "2026-10-25T10:00:00" }],
    ["nome", { nome: "" }],
    ["nome", { nome: "   " }],
    ["nome", { nome: "a".repeat(31) }],
    ["pontoEncontro", { pontoEncontro: "a".repeat(81) }],
    ["bairroSaida", { bairroSaida: "a".repeat(41) }],
    ["nota", { nota: "a".repeat(201) }],
    ["acessivel", { acessivel: "sim" }],
  ])("rejects an invalid %s", async (field, overrides) => {
    const response = await call("POST", "/api/ofertas", { body: validOffer(overrides) });
    await expectError(response, 400, "campo_invalido", field);
  });

  it("accepts the window boundaries and maximum lengths", async () => {
    await createOffer({ saida: "2026-10-25T09:00:00-03:00", vagas: 1 });
    await createOffer({
      saida: "2026-10-25T17:00:00-03:00",
      vagas: 4,
      nome: "a".repeat(30),
      pontoEncontro: "b".repeat(80),
      bairroSaida: "c".repeat(40),
      nota: "d".repeat(200),
      acessivel: true,
    });
  });

  it.each([
    ["nome", "Lula"],
    ["nome", "Bolsonaro"],
    ["pontoEncontro", "Comitê do PT"],
    ["bairroSaida", "vote 13"],
    ["nota", "Só levo quem vota no 22"],
    ["nota", "voto em fulano"],
  ])("rejects campaign content in %s", async (field, text) => {
    const response = await call("POST", "/api/ofertas", { body: validOffer({ [field]: text }) });
    await expectError(response, 422, "conteudo_de_campanha", field);
    expect(turnstileCalls).toHaveLength(0);
  });

  it("accepts addresses that merely contain campaign numbers", async () => {
    await createOffer({ pontoEncontro: "Praça 13 de Maio, em frente à banca", bairroSaida: "Boa Vista" });
  });

  it("limits offers per IP per day", async () => {
    for (let index = 0; index < LIMITS.offersPerIpPerDay; index += 1) await createOffer({}, "198.51.100.1");
    await expectError(
      await call("POST", "/api/ofertas", { body: validOffer(), ip: "198.51.100.1" }),
      429,
      "limite_de_ofertas",
    );
    await createOffer({}, "198.51.100.2");
    clock.now = new Date(clock.now.getTime() + 24 * 60 * 60 * 1000 + 1000);
    await createOffer({}, "198.51.100.1");
  });

  it("stores only a salted hash of the IP", async () => {
    await createOffer({}, "198.51.100.9");
    const { results } = await env.DB.prepare("SELECT ip_hash FROM rate_events").all<{ ip_hash: string }>();
    expect(results).toHaveLength(1);
    expect(results[0]?.ip_hash).toBe(await sha256Hex("test-salt:198.51.100.9"));
    expect(results[0]?.ip_hash).not.toBe(await sha256Hex("198.51.100.9"));
  });

  it("rejects malformed and oversized JSON bodies", async () => {
    await expectError(await call("POST", "/api/ofertas", { rawBody: "{nope" }), 400, "json_invalido");
    await expectError(await call("POST", "/api/ofertas", { rawBody: "[1,2]" }), 400, "json_invalido");
    await expectError(await call("POST", "/api/ofertas", { rawBody: "null" }), 400, "json_invalido");
    await expectError(
      await call("POST", "/api/ofertas", { body: validOffer({ nota: "x".repeat(5000) }) }),
      413,
      "corpo_grande_demais",
    );
  });
});

describe("GET /api/ofertas", () => {
  it("never exposes the contact (any type) or the token", async () => {
    const { token } = await createOffer();
    await createOffer({ contatoTipo: "whatsapp_usuario", contato: "@motorista.secreta" });
    await createOffer({ contatoTipo: "email", contato: "segredo@exemplo.com" });
    const response = await call("GET", "/api/ofertas?municipio=25313");
    const text = await response.text();
    expect((JSON.parse(text) as { ofertas: unknown[] }).ofertas).toHaveLength(3);
    expect(text).not.toContain("contato");
    expect(text).not.toContain("whatsapp");
    expect(text).not.toContain("99876");
    expect(text).not.toContain("motorista.secreta");
    expect(text).not.toContain("segredo");
    expect(text).not.toContain(token);
    expect(text).not.toContain("token");
  });

  it("returns the public fields sorted by departure", async () => {
    await createOffer({ saida: "2026-10-25T15:00:00-03:00", nome: "Bia" });
    await createOffer({ saida: "2026-10-25T09:30:00-03:00", nome: "Caio", nota: "Tenho cadeirinha", acessivel: true });
    const ofertas = await list("municipio=25313");
    expect(ofertas.map((offer) => offer.nome)).toEqual(["Caio", "Bia"]);
    expect(ofertas[0]).toEqual({
      id: expect.any(String),
      nome: "Caio",
      localId: "1-1015",
      localNome: "ESCOLA PRAÇA 13 DE MAIO",
      pontoEncontro: "Em frente à padaria da esquina",
      bairroSaida: "Boa Viagem",
      saida: "2026-10-25T12:30:00.000Z",
      vagasLivres: 3,
      nota: "Tenho cadeirinha",
      acessivel: true,
    });
  });

  it("filters by município, local, bairro (accent/case-insensitive) and time", async () => {
    await createOffer({ localId: "1-1015", bairroSaida: "São José", saida: "2026-10-25T09:00:00-03:00", nome: "A" });
    await createOffer({ localId: "2-200", bairroSaida: "Casa Amarela", saida: "2026-10-25T12:00:00-03:00", nome: "B" });
    await createOffer({ localId: "1-1015", bairroSaida: "Boa Viagem", saida: "2026-10-25T16:00:00-03:00", nome: "C" });

    const names = async (query: string) => (await list(query)).map((offer) => offer.nome);
    expect(await names("municipio=25313")).toEqual(["A", "B", "C"]);
    expect(await names("municipio=12345")).toEqual([]);
    expect(await names("municipio=25313&localId=1-1015")).toEqual(["A", "C"]);
    expect(await names("municipio=25313&bairro=SAO%20JOSE")).toEqual(["A"]);
    expect(await names("municipio=25313&bairro=amarel")).toEqual(["B"]);
    expect(await names("municipio=25313&de=10:00")).toEqual(["B", "C"]);
    expect(await names("municipio=25313&ate=12:00")).toEqual(["A", "B"]);
    expect(await names("municipio=25313&de=10:00&ate=15:00")).toEqual(["B"]);
  });

  it("validates query parameters", async () => {
    await expectError(await call("GET", "/api/ofertas"), 400, "campo_invalido", "municipio");
    await expectError(await call("GET", "/api/ofertas?municipio=abc"), 400, "campo_invalido", "municipio");
    await expectError(await call("GET", "/api/ofertas?municipio=25313&localId=x"), 400, "campo_invalido", "localId");
    await expectError(await call("GET", "/api/ofertas?municipio=25313&de=9h"), 400, "campo_invalido", "de");
    await expectError(await call("GET", "/api/ofertas?municipio=25313&ate=25:00"), 400, "campo_invalido", "ate");
  });

  it("hides full offers and offers more than 30 minutes past departure", async () => {
    const full = await createOffer({ nome: "Cheio" });
    await call("PATCH", `/api/ofertas/${full.id}`, { body: { token: full.token, vagasLivres: 0 } });
    await createOffer({ nome: "Cedo", saida: "2026-10-25T09:00:00-03:00" });
    await createOffer({ nome: "Tarde", saida: "2026-10-25T16:00:00-03:00" });
    expect((await list("municipio=25313")).map((offer) => offer.nome)).toEqual(["Cedo", "Tarde"]);
    clock.now = new Date("2026-10-25T09:30:00-03:00");
    expect((await list("municipio=25313")).map((offer) => offer.nome)).toEqual(["Cedo", "Tarde"]);
    expect(await readJson(await call("GET", "/api/status"))).toMatchObject({ totalOfertas: 2 });
    clock.now = new Date("2026-10-25T09:30:01-03:00");
    expect((await list("municipio=25313")).map((offer) => offer.nome)).toEqual(["Tarde"]);
    expect(await readJson(await call("GET", "/api/status"))).toMatchObject({ totalOfertas: 1 });
  });
});

describe("POST /api/ofertas/:id/contato", () => {
  it("returns the number, a neutral wa.me link and the confirmation notice", async () => {
    const { id } = await createOffer();
    const response = await call("POST", `/api/ofertas/${id}/contato`, { body: { turnstile: TURNSTILE.contato, ciente: true } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await readJson<{ tipo: string; valor: string; link: string; aviso: string }>(response);
    expect(body.tipo).toBe("whatsapp");
    expect(body.valor).toBe("+5581998765432");
    const link = new URL(body.link);
    expect(`${link.origin}${link.pathname}`).toBe("https://wa.me/5581998765432");
    expect(link.searchParams.get("text")).toBe(
      "Oi! Vi sua oferta de carona no Rota da Democracia para o local de votação ESCOLA PRAÇA 13 DE MAIO no domingo. Ainda tem vaga?",
    );
    expect(body.aviso).toBe(
      "A carona só é confirmada entre as pessoas, pelo contato combinado. O site não organiza, confirma, nem garante caronas.",
    );
  });

  it("requires the rider to tick ciente", async () => {
    const { id } = await createOffer();
    for (const ciente of [undefined, false, "true"]) {
      const response = await call("POST", `/api/ofertas/${id}/contato`, { body: { turnstile: TURNSTILE.contato, ciente } });
      await expectError(response, 400, "campo_invalido", "ciente");
    }
    expect(turnstileCalls).toHaveLength(1);
  });

  it("requires a valid Turnstile token", async () => {
    const { id } = await createOffer();
    await expectError(await call("POST", `/api/ofertas/${id}/contato`, { body: { ciente: true } }), 400, "turnstile_ausente");
    await expectError(
      await call("POST", `/api/ofertas/${id}/contato`, { body: { turnstile: "fail", ciente: true } }),
      403,
      "turnstile_invalido",
    );
  });

  it("returns 404 for unknown and hidden offers", async () => {
    await expectError(
      await call("POST", "/api/ofertas/doesnotexist/contato", { body: { turnstile: TURNSTILE.contato, ciente: true } }),
      404,
      "oferta_nao_encontrada",
    );
    const { id, token } = await createOffer();
    await call("PATCH", `/api/ofertas/${id}`, { body: { token, vagasLivres: 0 } });
    await expectError(
      await call("POST", `/api/ofertas/${id}/contato`, { body: { turnstile: TURNSTILE.contato, ciente: true } }),
      404,
      "oferta_nao_encontrada",
    );
  });

  it("limits reveals per IP per hour", async () => {
    const { id } = await createOffer();
    for (let index = 0; index < LIMITS.revealsPerIpPerHour; index += 1) {
      const response = await call("POST", `/api/ofertas/${id}/contato`, { body: { turnstile: TURNSTILE.contato, ciente: true }, ip: "192.0.2.5" });
      expect(response.status).toBe(200);
    }
    await expectError(
      await call("POST", `/api/ofertas/${id}/contato`, { body: { turnstile: TURNSTILE.contato, ciente: true }, ip: "192.0.2.5" }),
      429,
      "limite_de_contatos",
    );
    expect((await call("POST", `/api/ofertas/${id}/contato`, { body: { turnstile: TURNSTILE.contato, ciente: true }, ip: "192.0.2.6" })).status).toBe(200);
    clock.now = new Date(clock.now.getTime() + 60 * 60 * 1000 + 1000);
    expect((await call("POST", `/api/ofertas/${id}/contato`, { body: { turnstile: TURNSTILE.contato, ciente: true }, ip: "192.0.2.5" })).status).toBe(200);
  });
});

describe("contact types", () => {
  async function reveal(id: string) {
    const response = await call("POST", `/api/ofertas/${id}/contato`, { body: { turnstile: TURNSTILE.contato, ciente: true } });
    expect(response.status).toBe(200);
    return readJson<Record<string, unknown>>(response);
  }

  it("WhatsApp username: normalized, revealed with @ and without a link", async () => {
    const { id, token } = await createOffer({ contatoTipo: "whatsapp_usuario", contato: " @Maria.Silva_81 " });
    const row = await env.DB.prepare("SELECT contato_tipo, contato FROM offers WHERE id = ?").bind(id).first();
    expect(row).toEqual({ contato_tipo: "whatsapp_usuario", contato: "maria.silva_81" });
    const body = await reveal(id);
    expect(body).toEqual({
      tipo: "whatsapp_usuario",
      valor: "@maria.silva_81",
      aviso: "A carona só é confirmada entre as pessoas, pelo contato combinado. O site não organiza, confirma, nem garante caronas.",
    });
    const owner = await readJson(await call("GET", `/api/ofertas/${id}?token=${token}`));
    expect(owner).toMatchObject({ contatoTipo: "whatsapp_usuario", contato: "@maria.silva_81" });
  });

  it.each(["ab", "@ab", "12345", "a".repeat(36), "maria silva", "maria-silva", "maria@silva", "@", ""])(
    "rejects the username %j",
    async (contato) => {
      const response = await call("POST", "/api/ofertas", { body: validOffer({ contatoTipo: "whatsapp_usuario", contato }) });
      expect(response.status).toBe(400);
      expect(await readJson(response)).toMatchObject({ error: "campo_invalido", campo: "contato" });
    },
  );

  it("e-mail: lowercased and revealed with a mailto link", async () => {
    const { id, token } = await createOffer({ contatoTipo: "email", contato: "  Maria.Silva+carona@Exemplo.COM.br " });
    const body = await reveal(id);
    expect(body).toMatchObject({ tipo: "email", valor: "maria.silva+carona@exemplo.com.br" });
    expect(body.link).toBe("mailto:maria.silva+carona@exemplo.com.br?subject=Carona%20para%20votar%20no%20domingo");
    const owner = await readJson(await call("GET", `/api/ofertas/${id}?token=${token}`));
    expect(owner).toMatchObject({ contatoTipo: "email", contato: "maria.silva+carona@exemplo.com.br" });
  });

  it.each([
    "maria",
    "maria@",
    "@exemplo.com",
    "maria@exemplo",
    "maria..silva@exemplo.com",
    ".maria@exemplo.com",
    "maria@-exemplo.com",
    "maria silva@exemplo.com",
    "maria@exemplo.com>",
    "mária@exemplo.com",
    `${"a".repeat(90)}@exemplo.com`,
  ])("rejects the e-mail %j", async (contato) => {
    const response = await call("POST", "/api/ofertas", { body: validOffer({ contatoTipo: "email", contato }) });
    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({ error: "campo_invalido", campo: "contato" });
  });

  it.each([
    ["whatsapp_usuario", "@lula2026"],
    ["whatsapp_usuario", "bolsonaro.oficial"],
    ["email", "vote13@exemplo.com"],
    ["email", "lula@exemplo.com"],
    ["email", "maria@pt.org.br"],
  ])("screens %s contacts for campaign content (%s)", async (contatoTipo, contato) => {
    const response = await call("POST", "/api/ofertas", { body: validOffer({ contatoTipo, contato }) });
    expect(response.status).toBe(422);
    expect(await readJson(response)).toMatchObject({ error: "conteudo_de_campanha", campo: "contato" });
  });
});

describe("owner endpoints", () => {
  it("GET returns the full offer with the contact for the right token", async () => {
    const { id, token } = await createOffer();
    const response = await call("GET", `/api/ofertas/${id}?token=${token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await readJson(response);
    expect(body).toMatchObject({
      id,
      contatoTipo: "whatsapp",
      contato: "+5581998765432",
      municipio: "25313",
      vagas: 3,
      vagasLivres: 3,
      denuncias: 0,
      oculta: false,
    });
    expect(body).not.toHaveProperty("token");
    expect(body).not.toHaveProperty("token_hash");
  });

  it("rejects missing, wrong and cross-offer tokens", async () => {
    const first = await createOffer();
    const second = await createOffer();
    await expectError(await call("GET", `/api/ofertas/${first.id}`), 401, "token_ausente");
    await expectError(await call("GET", `/api/ofertas/${first.id}?token=${"x".repeat(32)}`), 403, "token_invalido");
    await expectError(await call("GET", `/api/ofertas/${first.id}?token=${second.token}`), 403, "token_invalido");
    await expectError(
      await call("PATCH", `/api/ofertas/${first.id}`, { body: { token: second.token, vagasLivres: 1 } }),
      403,
      "token_invalido",
    );
    await expectError(await call("DELETE", `/api/ofertas/${first.id}`, { body: { token: second.token } }), 403, "token_invalido");
    await expectError(await call("GET", `/api/ofertas/doesnotexist?token=${first.token}`), 404, "oferta_nao_encontrada");
  });

  it("PATCH updates seats, time, meeting point and note", async () => {
    const { id, token } = await createOffer();
    const response = await call("PATCH", `/api/ofertas/${id}`, {
      body: {
        token,
        vagasLivres: 1,
        saida: "2026-10-25T14:00:00-03:00",
        pontoEncontro: "Portão do parque",
        nota: "Levo cadeira de rodas dobrável",
      },
    });
    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      vagasLivres: 1,
      saida: "2026-10-25T17:00:00.000Z",
      pontoEncontro: "Portão do parque",
      nota: "Levo cadeira de rodas dobrável",
    });
    const cleared = await call("PATCH", `/api/ofertas/${id}`, { body: { token, nota: "" } });
    expect(await readJson(cleared)).toMatchObject({ nota: null });
  });

  it("PATCH validates its fields", async () => {
    const { id, token } = await createOffer({ vagas: 2 });
    const patch = (body: Record<string, unknown>) => call("PATCH", `/api/ofertas/${id}`, { body: { token, ...body } });
    await expectError(await patch({}), 400, "campo_invalido");
    await expectError(await patch({ vagasLivres: 3 }), 400, "campo_invalido", "vagasLivres");
    await expectError(await patch({ vagasLivres: -1 }), 400, "campo_invalido", "vagasLivres");
    await expectError(await patch({ saida: "2026-10-25T18:00:00-03:00" }), 400, "campo_invalido", "saida");
    await expectError(await patch({ pontoEncontro: "" }), 400, "campo_invalido", "pontoEncontro");
    await expectError(await patch({ nota: "a".repeat(201) }), 400, "campo_invalido", "nota");
    await expectError(await patch({ nota: "Bolsonaro" }), 422, "conteudo_de_campanha", "nota");
    await expectError(await patch({ pontoEncontro: "vote 22" }), 422, "conteudo_de_campanha", "pontoEncontro");
  });

  it("DELETE removes the offer and its reports", async () => {
    const { id, token } = await createOffer();
    await call("POST", `/api/ofertas/${id}/denuncia`, { body: { turnstile: TURNSTILE.denuncia, motivo: "outro" } });
    await expectError(await call("DELETE", `/api/ofertas/${id}`, { body: {} }), 401, "token_ausente");
    const response = await call("DELETE", `/api/ofertas/${id}`, { body: { token } });
    expect(response.status).toBe(200);
    expect(await list("municipio=25313")).toEqual([]);
    await expectError(await call("GET", `/api/ofertas/${id}?token=${token}`), 404, "oferta_nao_encontrada");
    const reports = await env.DB.prepare("SELECT COUNT(*) AS total FROM reports").first<{ total: number }>();
    expect(reports?.total).toBe(0);
  });
});

describe("POST /api/ofertas/:id/denuncia", () => {
  it("counts distinct reporters but never hides the offer on its own", async () => {
    const { id, token } = await createOffer();
    const report = (ip: string, motivo = "campanha") =>
      call("POST", `/api/ofertas/${id}/denuncia`, { body: { turnstile: TURNSTILE.denuncia, motivo }, ip });
    expect((await report("192.0.2.1")).status).toBe(202);
    expect((await report("192.0.2.1", "falsa")).status).toBe(202);
    for (let index = 2; index <= 20; index += 1) expect((await report(`192.0.2.${index}`)).status).toBe(202);
    expect(await list("municipio=25313")).toHaveLength(1);
    expect((await call("POST", `/api/ofertas/${id}/contato`, { body: { turnstile: TURNSTILE.contato, ciente: true } })).status).toBe(200);
    const owner = await readJson(await call("GET", `/api/ofertas/${id}?token=${token}`));
    expect(owner).toMatchObject({ denuncias: 20, oculta: false, moderada: false });
  });

  it("validates the reason and the offer", async () => {
    const { id } = await createOffer();
    await expectError(await call("POST", `/api/ofertas/${id}/denuncia`, { body: { turnstile: TURNSTILE.denuncia, motivo: "spam" } }), 400, "campo_invalido", "motivo");
    await expectError(await call("POST", `/api/ofertas/${id}/denuncia`, { body: {} }), 400, "campo_invalido", "motivo");
    await expectError(
      await call("POST", "/api/ofertas/doesnotexist/denuncia", { body: { turnstile: TURNSTILE.denuncia, motivo: "outro" } }),
      404,
      "oferta_nao_encontrada",
    );
  });
});

describe("status, config and routing", () => {
  it("GET /api/status counts visible offers", async () => {
    await createOffer();
    const hidden = await createOffer();
    await call("PATCH", `/api/ofertas/${hidden.id}`, { body: { token: hidden.token, vagasLivres: 0 } });
    expect(await readJson(await call("GET", "/api/status"))).toEqual({ ok: true, encerrado: false, totalOfertas: 1 });
  });

  it("GET /api/config exposes the site key, window and closing time", async () => {
    const response = await call("GET", "/api/config");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await readJson(response)).toEqual({
      turnstileSiteKey: "1x00000000000000000000AA",
      janela: { inicio: "2026-10-25T12:00:00.000Z", fim: "2026-10-25T20:00:00.000Z" },
      encerraEm: "2026-10-25T20:00:00.000Z",
      data: "2026-10-25",
    });
  });

  it("sets security headers on API responses", async () => {
    const response = await call("GET", "/api/status");
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("answers unknown routes and methods with JSON errors", async () => {
    await expectError(await call("GET", "/api/nada"), 404, "nao_encontrado");
    await expectError(await call("PUT", "/api/ofertas"), 405, "metodo_nao_permitido");
    await expectError(await call("POST", "/api/status"), 405, "metodo_nao_permitido");
    await expectError(await call("GET", "/api/ofertas/abcdefgh/contato"), 405, "metodo_nao_permitido");
    await expectError(await call("PUT", "/api/ofertas/abcdefgh"), 405, "metodo_nao_permitido");
  });

  it("returns 410 on offer endpoints after the purge instant", async () => {
    const { id, token } = await createOffer();
    clock.now = new Date("2026-10-25T17:00:00-03:00");
    await expectError(await call("POST", "/api/ofertas", { body: validOffer() }), 410, "encerrado");
    await expectError(await call("GET", "/api/ofertas?municipio=25313"), 410, "encerrado");
    await expectError(await call("POST", `/api/ofertas/${id}/contato`, { body: { turnstile: TURNSTILE.contato, ciente: true } }), 410, "encerrado");
    await expectError(await call("POST", `/api/ofertas/${id}/denuncia`, { body: { turnstile: TURNSTILE.denuncia, motivo: "outro" } }), 410, "encerrado");
    await expectError(await call("PATCH", `/api/ofertas/${id}`, { body: { token, vagasLivres: 1 } }), 410, "encerrado");
    await expectError(await call("DELETE", `/api/ofertas/${id}`, { body: { token } }), 410, "encerrado");
    expect(await readJson(await call("GET", "/api/status"))).toEqual({ ok: true, encerrado: true, totalOfertas: 0 });
  });
});

describe("review hardening", () => {
  it("reserves offer quota atomically under concurrency", async () => {
    const attempts = await Promise.all(
      Array.from({ length: LIMITS.offersPerIpPerDay + 5 }, () =>
        call("POST", "/api/ofertas", { body: validOffer(), ip: "198.51.100.40" }),
      ),
    );
    const statuses = attempts.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(LIMITS.offersPerIpPerDay);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
  });

  it("releases the reservation when the operation fails", async () => {
    for (let index = 0; index < 5; index += 1) {
      const response = await call("POST", "/api/ofertas", { body: validOffer({ turnstile: "fail" }), ip: "198.51.100.41" });
      expect(response.status).toBe(403);
    }
    await call("POST", "/api/ofertas", { body: validOffer({ localId: "9-9999" }), ip: "198.51.100.41" });
    for (let index = 0; index < LIMITS.offersPerIpPerDay; index += 1) await createOffer({}, "198.51.100.41");
  });

  it("aborts a streamed body over the limit without Content-Length", async () => {
    const chunk = new TextEncoder().encode(" ".repeat(1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 10) controller.close();
        else {
          sent += 1;
          controller.enqueue(chunk);
        }
      },
    });
    const request = new Request("https://carona.test/api/ofertas", {
      method: "POST",
      body: stream,
      headers: { "Content-Type": "application/json" },
    });
    expect(request.headers.get("Content-Length")).toBeNull();
    const response = await send(request);
    expect(response.status).toBe(413);
    expect(sent).toBeLessThan(10);
  });

  it("checks the Turnstile hostname and action", async () => {
    const post = (turnstile: string) => call("POST", "/api/ofertas", { body: validOffer({ turnstile }) });
    await expectError(await post("pass:contato"), 403, "turnstile_invalido");
    await expectError(await post("pass:"), 403, "turnstile_invalido");
    await expectError(await post("pass:oferecer@evil.example"), 403, "turnstile_invalido");
    expect((await post("pass:oferecer@localhost")).status).toBe(201);
    const { id } = await createOffer();
    await expectError(
      await call("POST", `/api/ofertas/${id}/contato`, { body: { turnstile: TURNSTILE.oferecer, ciente: true } }),
      403,
      "turnstile_invalido",
    );
    await expectError(
      await call("POST", `/api/ofertas/${id}/denuncia`, { body: { turnstile: TURNSTILE.contato, motivo: "outro" } }),
      403,
      "turnstile_invalido",
    );
  });

  it("rejects every token when no hostname is allowed", async () => {
    const request = new Request("https://carona.test/api/ofertas", {
      method: "POST",
      body: JSON.stringify(validOffer()),
      headers: { "CF-Connecting-IP": "198.51.100.50" },
    });
    const { handleApi } = await import("../src/app");
    const { deps } = await import("./helpers");
    const response = await handleApi(request, { ...testEnv, ALLOWED_HOSTNAMES: undefined }, deps);
    await expectError(response, 403, "turnstile_invalido");
  });

  it("skips hostname and action checks for Cloudflare's dummy secret", async () => {
    const request = new Request("https://carona.test/api/ofertas", {
      method: "POST",
      body: JSON.stringify(validOffer({ turnstile: "pass:@example.com" })),
    });
    const { handleApi } = await import("../src/app");
    const { deps } = await import("./helpers");
    const dummy = { ...testEnv, TURNSTILE_SECRET: "1x0000000000000000000000000000000AA", ALLOWED_HOSTNAMES: undefined };
    expect((await handleApi(request, dummy, deps)).status).toBe(201);
  });

  it("requires Turnstile on reports", async () => {
    const { id } = await createOffer();
    await expectError(await call("POST", `/api/ofertas/${id}/denuncia`, { body: { motivo: "outro" } }), 400, "turnstile_ausente");
    await expectError(
      await call("POST", `/api/ofertas/${id}/denuncia`, { body: { turnstile: "fail", motivo: "outro" } }),
      403,
      "turnstile_invalido",
    );
    const reports = await env.DB.prepare("SELECT COUNT(*) AS total FROM reports").first<{ total: number }>();
    expect(reports?.total).toBe(0);
  });

  it("limits reports per network per day", async () => {
    // Repeated reports of the same offer are ignored but still spend quota.
    const { id } = await createOffer();
    const report = () =>
      call("POST", `/api/ofertas/${id}/denuncia`, { body: { turnstile: TURNSTILE.denuncia, motivo: "outro" }, ip: "192.0.2.99" });
    for (let index = 0; index < LIMITS.reportsPerIpPerDay; index += 1) {
      expect((await report()).status).toBe(202);
    }
    await expectError(await report(), 429, "limite_de_denuncias");
    clock.now = new Date(clock.now.getTime() + 23 * 60 * 60 * 1000);
    await expectError(await report(), 429, "limite_de_denuncias");
    clock.now = new Date(clock.now.getTime() + 60 * 60 * 1000 + 1000);
    expect((await report()).status).toBe(202);
  });

  it("counts IPv6 reporters by /64", async () => {
    const { id, token } = await createOffer();
    const report = (ip: string) =>
      call("POST", `/api/ofertas/${id}/denuncia`, { body: { turnstile: TURNSTILE.denuncia, motivo: "campanha" }, ip });
    await report("2001:db8:1:2::1");
    await report("2001:db8:1:2::2");
    await report("2001:db8:1:2:ffff:ffff:ffff:ffff");
    await report("2001:db8:1:3::1");
    await report("203.0.113.77");
    expect(await readJson(await call("GET", `/api/ofertas/${id}?token=${token}`))).toMatchObject({ denuncias: 3 });
  });

  it("refuses inserts once the purge flag is set, even before the purge instant", async () => {
    const { id } = await createOffer();
    await env.DB.prepare("INSERT INTO system_state (key, value) VALUES ('encerrado', 'x')").run();
    await expectError(await call("POST", "/api/ofertas", { body: validOffer(), ip: "198.51.100.80" }), 410, "encerrado");
    await expectError(
      await call("POST", `/api/ofertas/${id}/denuncia`, { body: { turnstile: TURNSTILE.denuncia, motivo: "outro" } }),
      410,
      "encerrado",
    );
    await expectError(
      await call("POST", `/api/ofertas/${id}/contato`, { body: { turnstile: TURNSTILE.contato, ciente: true } }),
      410,
      "encerrado",
    );
    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM offers) AS offers, (SELECT COUNT(*) FROM reports) AS reports, (SELECT COUNT(*) FROM rate_events) AS events",
    ).first<{ offers: number; reports: number; events: number }>();
    expect(counts).toEqual({ offers: 1, reports: 0, events: 1 });
    expect(await readJson(await call("GET", "/api/status"))).toMatchObject({ encerrado: true });
  });

  it("rejects município codes that are not exactly 5 digits", async () => {
    await expectError(await call("GET", "/api/ofertas?municipio=2531"), 400, "campo_invalido", "municipio");
    await expectError(await call("GET", "/api/ofertas?municipio=253130"), 400, "campo_invalido", "municipio");
    await expectError(await call("POST", "/api/ofertas", { body: validOffer({ municipio: "025313" }) }), 400, "campo_invalido", "municipio");
  });
});

describe("Turnstile timeout", () => {
  it("aborts siteverify after 5 s and answers 503", async () => {
    const { handleApi } = await import("../src/app");
    let signal: AbortSignal | null | undefined;
    const hanging = {
      now: () => clock.now,
      defer: () => undefined,
      fetch: (_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      },
    };
    const pending = handleApi(
      new Request("https://carona.test/api/ofertas", { method: "POST", body: JSON.stringify(validOffer()) }),
      testEnv,
      hanging,
    );
    const response = await pending;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(response.status).toBe(503);
    expect(await readJson(response)).toMatchObject({ error: "turnstile_indisponivel" });
  }, 10_000);
});
