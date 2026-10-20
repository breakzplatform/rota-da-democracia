import { createScheduledController } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/config";
import { sha256Hex } from "../src/crypto";
import { GROUP_RULES } from "../src/groups";
import worker from "../src/index";
import { call, clock, createOffer, readJson, testEnv, TURNSTILE, turnstileCalls } from "./helpers";

const LINK = "https://chat.whatsapp.com/AbCdEf1234567890";

function validGroup(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    turnstile: TURNSTILE.grupo,
    municipio: "25313",
    nome: "Caronas Boa Vista",
    bairros: "Zona 1 / Boa Vista, Soledade",
    adminNome: "Rita",
    link: LINK,
    aceite: true,
    semVinculo: true,
    grupoApartidario: true,
    semCaravana: true,
    adminResponsavel: true,
    ...overrides,
  };
}

interface CreatedGroup {
  id: string;
  token: string;
  editarUrl: string;
}

let linkCounter = 0;
async function createGroup(overrides: Record<string, unknown> = {}, ip?: string): Promise<CreatedGroup> {
  linkCounter += 1;
  const link = `https://chat.whatsapp.com/Grupo${String(linkCounter).padStart(8, "0")}`;
  const response = await call("POST", "/api/grupos", { body: validGroup({ link, ...overrides }), ip });
  if (response.status !== 201) throw new Error(`create group failed: ${response.status} ${await response.text()}`);
  return readJson<CreatedGroup>(response);
}

async function listGroups(query = "municipio=25313"): Promise<Record<string, unknown>[]> {
  const response = await call("GET", `/api/grupos?${query}`);
  expect(response.status).toBe(200);
  return (await readJson<{ grupos: Record<string, unknown>[] }>(response)).grupos;
}

async function expectError(response: Response, status: number, code: string, field?: string): Promise<void> {
  expect(response.status).toBe(status);
  const body = await readJson<{ error: string; campo?: string }>(response);
  expect(body.error).toBe(code);
  if (field) expect(body.campo).toBe(field);
}

const enter = (id: string, ip?: string) =>
  call("POST", `/api/grupos/${id}/entrar`, { body: { turnstile: TURNSTILE.entrar, ciente: true }, ip });

describe("POST /api/grupos", () => {
  it("creates a group and stores the token hash and declarations", async () => {
    const response = await call("POST", "/api/grupos", { body: validGroup() });
    expect(response.status).toBe(201);
    const body = await readJson<CreatedGroup>(response);
    const url = new URL(body.editarUrl);
    expect(url.pathname).toBe("/gerenciar-grupo");
    expect(url.searchParams.get("id")).toBe(body.id);
    expect(url.searchParams.get("token")).toBe(body.token);
    const row = await env.DB.prepare("SELECT * FROM grupos WHERE id = ?").bind(body.id).first<Record<string, unknown>>();
    expect(row).toMatchObject({
      token_hash: await sha256Hex(body.token),
      municipio: "25313",
      link: LINK,
      admin_nome: "Rita",
      aceite: 1,
      sem_vinculo: 1,
      grupo_apartidario: 1,
      sem_caravana: 1,
      admin_responsavel: 1,
      declarado_em: clock.now.toISOString(),
    });
    expect(Object.values(row ?? {})).not.toContain(body.token);
    expect(turnstileCalls.at(-1)?.response).toBe("pass:grupo");
  });

  const declarations = ["aceite", "semVinculo", "grupoApartidario", "semCaravana", "adminResponsavel"];
  it.each(declarations)("requires %s to be exactly true", async (field) => {
    for (const value of [undefined, false, "true"]) {
      await expectError(await call("POST", "/api/grupos", { body: validGroup({ [field]: value }) }), 400, "campo_invalido", field);
    }
    expect(turnstileCalls).toHaveLength(0);
  });

  it.each([
    "http://chat.whatsapp.com/AbCdEf1234567890",
    "https://chat.whatsapp.com/short",
    "https://chat.whatsapp.com/AbCdEf1234567890/extra",
    "https://chat.whatsapp.com/AbCdEf1234567890?x=1",
    "https://chat.whatsapp.com.evil.example/AbCdEf1234567890",
    "https://wa.me/5581998765432",
    "https://chat.whatsapp.com/Ab-Cd_Ef1234567890",
    `https://chat.whatsapp.com/${"a".repeat(41)}`,
  ])("rejects the link %s", async (link) => {
    await expectError(await call("POST", "/api/grupos", { body: validGroup({ link }) }), 400, "campo_invalido", "link");
  });

  it.each([
    ["municipio", { municipio: "99999" }],
    ["municipio", { municipio: "2531" }],
    ["nome", { nome: "" }],
    ["nome", { nome: "a".repeat(61) }],
    ["bairros", { bairros: "a".repeat(101) }],
    ["adminNome", { adminNome: "a".repeat(31) }],
  ])("rejects an invalid %s", async (field, overrides) => {
    await expectError(await call("POST", "/api/grupos", { body: validGroup(overrides) }), 400, "campo_invalido", field);
  });

  it.each([
    ["nome", "Caronas do PT"],
    ["nome", "Turma do Bolsonaro"],
    ["bairros", "Boa Vista, vote 13"],
    ["adminNome", "Lula"],
  ])("screens %s for campaign content", async (field, text) => {
    await expectError(await call("POST", "/api/grupos", { body: validGroup({ [field]: text }) }), 422, "conteudo_de_campanha", field);
  });

  it("rejects a link that is already listed", async () => {
    expect((await call("POST", "/api/grupos", { body: validGroup() })).status).toBe(201);
    await expectError(await call("POST", "/api/grupos", { body: validGroup(), ip: "198.51.100.200" }), 409, "grupo_ja_cadastrado", "link");
  });

  it("checks the Turnstile action", async () => {
    await expectError(await call("POST", "/api/grupos", { body: validGroup({ turnstile: TURNSTILE.oferecer }) }), 403, "turnstile_invalido");
  });

  it("limits groups per IP per day", async () => {
    for (let index = 0; index < LIMITS.groupsPerIpPerDay; index += 1) await createGroup({}, "198.51.100.120");
    const response = await call("POST", "/api/grupos", {
      body: validGroup({ link: "https://chat.whatsapp.com/Overflow0000001" }),
      ip: "198.51.100.120",
    });
    await expectError(response, 429, "limite_de_grupos");
  });
});

describe("GET /api/grupos", () => {
  it("lists without the invite link and filters by q", async () => {
    await createGroup({ nome: "Caronas Boa Vista", bairros: "Zona 1 / Boa Vista, Soledade" });
    await createGroup({ nome: "Vizinhos da Várzea", bairros: "Várzea, Caxangá" });
    await createGroup({ municipio: "25313", nome: "Água Fria Solidária", bairros: "Água Fria" });
    const response = await call("GET", "/api/grupos?municipio=25313");
    const text = await response.text();
    expect(text).not.toContain("chat.whatsapp.com");
    expect(text).not.toContain("link");
    const grupos = (JSON.parse(text) as { grupos: Record<string, unknown>[] }).grupos;
    expect(grupos.map((group) => group.nome)).toEqual(["Água Fria Solidária", "Caronas Boa Vista", "Vizinhos da Várzea"]);
    expect(Object.keys(grupos[0] ?? {}).sort()).toEqual(["adminNome", "bairros", "criadoEm", "id", "nome"]);
    expect((await listGroups("municipio=25313&q=VARZEA")).map((group) => group.nome)).toEqual(["Vizinhos da Várzea"]);
    expect((await listGroups("municipio=25313&q=soledade")).map((group) => group.nome)).toEqual(["Caronas Boa Vista"]);
    expect(await listGroups("municipio=12345")).toEqual([]);
    await expectError(await call("GET", "/api/grupos"), 400, "campo_invalido", "municipio");
  });
});

describe("POST /api/grupos/:id/entrar", () => {
  it("reveals the link and the rules", async () => {
    const { id } = await createGroup({ link: LINK });
    const response = await enter(id);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await readJson(response)).toEqual({ link: LINK, regras: GROUP_RULES });
  });

  it("requires ciente and the entrar Turnstile action", async () => {
    const { id } = await createGroup();
    for (const ciente of [undefined, false, "true"]) {
      await expectError(
        await call("POST", `/api/grupos/${id}/entrar`, { body: { turnstile: TURNSTILE.entrar, ciente } }),
        400,
        "campo_invalido",
        "ciente",
      );
    }
    await expectError(
      await call("POST", `/api/grupos/${id}/entrar`, { body: { turnstile: TURNSTILE.contato, ciente: true } }),
      403,
      "turnstile_invalido",
    );
    await expectError(await enter("doesnotexist"), 404, "grupo_nao_encontrado");
  });

  it("shares the reveal quota with offer contacts", async () => {
    const { id } = await createGroup();
    const offer = await createOffer();
    const ip = "192.0.2.150";
    for (let index = 0; index < LIMITS.revealsPerIpPerHour - 1; index += 1) {
      expect((await enter(id, ip)).status).toBe(200);
    }
    const contact = await call("POST", `/api/ofertas/${offer.id}/contato`, {
      body: { turnstile: TURNSTILE.contato, ciente: true },
      ip,
    });
    expect(contact.status).toBe(200);
    await expectError(await enter(id, ip), 429, "limite_de_contatos");
  });
});

describe("group owner and reports", () => {
  it("owner can read and delete with the token only", async () => {
    const first = await createGroup({ link: LINK });
    const second = await createGroup();
    const owner = await readJson(await call("GET", `/api/grupos/${first.id}?token=${first.token}`));
    expect(owner).toMatchObject({ id: first.id, link: LINK, municipio: "25313", denuncias: 0, oculto: false });
    await expectError(await call("GET", `/api/grupos/${first.id}`), 401, "token_ausente");
    await expectError(await call("DELETE", `/api/grupos/${first.id}`, { body: { token: second.token } }), 403, "token_invalido");
    expect((await call("DELETE", `/api/grupos/${first.id}`, { body: { token: first.token } })).status).toBe(200);
    expect((await listGroups()).map((group) => group.id)).toEqual([second.id]);
    await expectError(await enter(first.id), 404, "grupo_nao_encontrado");
  });

  it("counts reports but never hides the group on its own", async () => {
    const { id, token } = await createGroup();
    for (let index = 1; index <= 12; index += 1) {
      const response = await call("POST", `/api/grupos/${id}/denuncia`, {
        body: { turnstile: TURNSTILE.denuncia, motivo: "campanha" },
        ip: `192.0.2.${index}`,
      });
      expect(response.status).toBe(202);
    }
    expect(await listGroups()).toHaveLength(1);
    expect((await enter(id)).status).toBe(200);
    expect(await readJson(await call("GET", `/api/grupos/${id}?token=${token}`))).toMatchObject({ denuncias: 12, oculto: false });
  });

  it("validates reports", async () => {
    const { id } = await createGroup();
    await expectError(
      await call("POST", `/api/grupos/${id}/denuncia`, { body: { turnstile: TURNSTILE.denuncia, motivo: "spam" } }),
      400,
      "campo_invalido",
      "motivo",
    );
    await expectError(await call("POST", `/api/grupos/${id}/denuncia`, { body: { motivo: "outro" } }), 400, "turnstile_ausente");
    await expectError(
      await call("POST", "/api/grupos/doesnotexist/denuncia", { body: { turnstile: TURNSTILE.denuncia, motivo: "outro" } }),
      404,
      "grupo_nao_encontrado",
    );
  });
});

describe("group signup cutoff", () => {
  it("accepts groups until polls open and refuses them from then on", async () => {
    clock.now = new Date("2026-10-25T07:59:59-03:00");
    await createGroup();
    clock.now = new Date("2026-10-25T08:00:00-03:00");
    const response = await call("POST", "/api/grupos", { body: validGroup({ link: `${LINK}x` }) });
    await expectError(response, 403, "cadastro_encerrado");
    const total = await env.DB.prepare("SELECT COUNT(*) AS total FROM grupos").first<{ total: number }>();
    expect(total?.total).toBe(1);
    expect(await listGroups()).toHaveLength(1);
  });
});

describe("group purge", () => {
  it("deletes groups and their reports at the purge instant and returns 410 afterwards", async () => {
    const { id } = await createGroup();
    await call("POST", `/api/grupos/${id}/denuncia`, { body: { turnstile: TURNSTILE.denuncia, motivo: "outro" } });
    await worker.scheduled(
      createScheduledController({ scheduledTime: new Date("2026-10-25T20:00:00Z"), cron: "0 * * * *" }),
      testEnv,
    );
    const counts = await env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM grupos) AS grupos, (SELECT COUNT(*) FROM grupo_reports) AS reports",
    ).first();
    expect(counts).toEqual({ grupos: 0, reports: 0 });

    clock.now = new Date("2026-10-25T20:00:00Z");
    await expectError(await call("GET", "/api/grupos?municipio=25313"), 410, "encerrado");
    await expectError(await call("POST", "/api/grupos", { body: validGroup() }), 410, "encerrado");
    await expectError(await enter(id), 410, "encerrado");
  });

  it("refuses inserts once the purge flag is set", async () => {
    await env.DB.prepare("INSERT INTO system_state (key, value) VALUES ('encerrado', 'x')").run();
    await expectError(await call("POST", "/api/grupos", { body: validGroup() }), 410, "encerrado");
    const total = await env.DB.prepare("SELECT COUNT(*) AS total FROM grupos").first<{ total: number }>();
    expect(total?.total).toBe(0);
  });
});
