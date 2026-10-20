import { describe, expect, it } from "vitest";
import { handleApi } from "../src/app";
import type { Env } from "../src/env";
import { call, clock, createOffer, deps, flushDeferred, readJson, telegramCalls, testEnv, TURNSTILE } from "./helpers";

const ADMIN = "s3cret-admin-token";
const adminEnv: Env = { ...testEnv, ADMIN_TOKEN: ADMIN };
const telegramEnv: Env = { ...testEnv, TELEGRAM_BOT_TOKEN: "123:abc", TELEGRAM_CHAT_ID: "-100" };

function admin(method: string, path: string, token: string | null = ADMIN, env: Env = adminEnv): Promise<Response> {
  const headers = new Headers();
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  return handleApi(new Request(`https://carona.test${path}`, { method, headers }), env, deps);
}

function reportAs(env: Env, path: string, ip: string, motivo = "campanha"): Promise<Response> {
  return handleApi(
    new Request(`https://carona.test${path}`, {
      method: "POST",
      headers: { "CF-Connecting-IP": ip },
      body: JSON.stringify({ turnstile: TURNSTILE.denuncia, motivo }),
    }),
    env,
    deps,
  );
}

async function createGroup(): Promise<{ id: string; token: string }> {
  const response = await call("POST", "/api/grupos", {
    body: {
      turnstile: TURNSTILE.grupo,
      municipio: "25313",
      nome: "Caronas Boa Vista",
      bairros: "Boa Vista",
      adminNome: "Rita",
      link: "https://chat.whatsapp.com/Moderacao0001",
      aceite: true,
      semVinculo: true,
      grupoApartidario: true,
      semCaravana: true,
      adminResponsavel: true,
    },
  });
  return readJson(response);
}

describe("admin authentication", () => {
  it("answers 404 when ADMIN_TOKEN is unset", async () => {
    const response = await admin("GET", "/api/admin/denuncias", ADMIN, testEnv);
    expect(response.status).toBe(404);
  });

  it("requires the bearer token", async () => {
    expect((await admin("GET", "/api/admin/denuncias", null)).status).toBe(401);
    expect((await admin("GET", "/api/admin/denuncias", "wrong")).status).toBe(401);
    expect((await admin("GET", "/api/admin/denuncias", `${ADMIN}x`)).status).toBe(401);
    expect((await admin("GET", "/api/admin/denuncias")).status).toBe(200);
  });
});

describe("moderation", () => {
  it("lists pending reports without contact or link unless detalhe=1", async () => {
    const offer = await createOffer({ nota: "Saio pontualmente" });
    const group = await createGroup();
    await call("POST", `/api/ofertas/${offer.id}/denuncia`, { body: { turnstile: TURNSTILE.denuncia, motivo: "cobranca" }, ip: "192.0.2.1" });
    await call("POST", `/api/ofertas/${offer.id}/denuncia`, { body: { turnstile: TURNSTILE.denuncia, motivo: "campanha" }, ip: "192.0.2.2" });
    clock.now = new Date(clock.now.getTime() + 1000);
    await call("POST", `/api/grupos/${group.id}/denuncia`, { body: { turnstile: TURNSTILE.denuncia, motivo: "falsa" }, ip: "192.0.2.3" });

    const response = await admin("GET", "/api/admin/denuncias");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain("99876");
    expect(text).not.toContain("chat.whatsapp.com");
    const { denuncias } = JSON.parse(text) as { denuncias: Record<string, unknown>[] };
    expect(denuncias).toEqual([
      expect.objectContaining({ tipo: "grupo", id: group.id, texto: "Caronas Boa Vista (Boa Vista)", total: 1, pendentes: 1, oculta: false }),
      expect.objectContaining({
        tipo: "oferta",
        id: offer.id,
        municipio: "25313",
        texto: "Ana: Em frente à padaria da esquina → ESCOLA PRAÇA 13 DE MAIO · Saio pontualmente",
        total: 2,
        pendentes: 2,
        motivos: { cobranca: 1, campanha: 1, falsa: 0, outro: 0 },
      }),
    ]);

    const detailed = await readJson<{ denuncias: Record<string, unknown>[] }>(await admin("GET", "/api/admin/denuncias?detalhe=1"));
    expect(detailed.denuncias[0]).toMatchObject({ link: "https://chat.whatsapp.com/Moderacao0001" });
    expect(detailed.denuncias[1]).toMatchObject({ contatoTipo: "whatsapp", contato: "+5581998765432" });
  });

  it("hides and restores an offer, marking its reports as reviewed", async () => {
    const { id, token } = await createOffer();
    await call("POST", `/api/ofertas/${id}/denuncia`, { body: { turnstile: TURNSTILE.denuncia, motivo: "campanha" } });

    const hidden = await admin("POST", `/api/admin/ofertas/${id}/ocultar`);
    expect(await readJson(hidden)).toEqual({ ok: true, id, oculta: true });
    expect((await readJson<{ ofertas: unknown[] }>(await call("GET", "/api/ofertas?municipio=25313"))).ofertas).toEqual([]);
    expect((await call("POST", `/api/ofertas/${id}/contato`, { body: { turnstile: TURNSTILE.contato, ciente: true } })).status).toBe(404);
    expect(await readJson(await call("GET", `/api/ofertas/${id}`, { token: token }))).toMatchObject({ oculta: true, moderada: true });
    expect((await readJson<{ denuncias: unknown[] }>(await admin("GET", "/api/admin/denuncias"))).denuncias).toEqual([]);

    await admin("POST", `/api/admin/ofertas/${id}/restaurar`);
    expect((await readJson<{ ofertas: unknown[] }>(await call("GET", "/api/ofertas?municipio=25313"))).ofertas).toHaveLength(1);
  });

  it("hides and restores a group", async () => {
    const { id } = await createGroup();
    await admin("POST", `/api/admin/grupos/${id}/ocultar`);
    expect((await readJson<{ grupos: unknown[] }>(await call("GET", "/api/grupos?municipio=25313"))).grupos).toEqual([]);
    expect((await call("POST", `/api/grupos/${id}/entrar`, { body: { turnstile: TURNSTILE.entrar, ciente: true } })).status).toBe(404);
    await admin("POST", `/api/admin/grupos/${id}/restaurar`);
    expect((await readJson<{ grupos: unknown[] }>(await call("GET", "/api/grupos?municipio=25313"))).grupos).toHaveLength(1);
  });

  it("rejects unknown items, kinds and methods", async () => {
    expect((await admin("POST", "/api/admin/ofertas/doesnotexist/ocultar")).status).toBe(404);
    expect((await admin("POST", "/api/admin/usuarios/abcdefgh/ocultar")).status).toBe(404);
    expect((await admin("GET", "/api/admin/ofertas/abcdefgh/ocultar")).status).toBe(405);
    expect((await admin("POST", "/api/admin/denuncias")).status).toBe(405);
  });
});

describe("report notifications", () => {
  it("skips silently when Telegram is not configured", async () => {
    const { id } = await createOffer();
    expect((await reportAs(testEnv, `/api/ofertas/${id}/denuncia`, "192.0.2.1")).status).toBe(202);
    await flushDeferred();
    expect(telegramCalls).toEqual([]);
  });

  it("sends one plain-text message per report with the running total", async () => {
    const { id } = await createOffer();
    await reportAs(telegramEnv, `/api/ofertas/${id}/denuncia`, "192.0.2.1", "cobranca");
    await reportAs(telegramEnv, `/api/ofertas/${id}/denuncia`, "192.0.2.2", "campanha");
    const group = await createGroup();
    await reportAs(telegramEnv, `/api/grupos/${group.id}/denuncia`, "192.0.2.3", "falsa");
    await flushDeferred();
    expect(telegramCalls.map((message) => message.url)).toEqual(
      Array(3).fill("https://api.telegram.org/bot123:abc/sendMessage"),
    );
    expect(telegramCalls.map((message) => message.chatId)).toEqual(["-100", "-100", "-100"]);
    expect(telegramCalls.map((message) => message.text)).toEqual([
      `Denúncia (cobranca) em oferta ${id} — RECIFE — Ana: Em frente à padaria da esquina → ESCOLA PRAÇA 13 DE MAIO. Total: 1.`,
      `Denúncia (campanha) em oferta ${id} — RECIFE — Ana: Em frente à padaria da esquina → ESCOLA PRAÇA 13 DE MAIO. Total: 2.`,
      `Denúncia (falsa) em grupo ${group.id} — RECIFE — Caronas Boa Vista (Boa Vista). Total: 1.`,
    ]);
  });

  it("sends a single burst alert at 10 reports in 10 minutes, then waits 30 minutes", async () => {
    const offers = await Promise.all(Array.from({ length: 3 }, (_, index) => createOffer({}, `198.51.100.${index + 1}`)));
    let reporter = 0;
    const reportOnce = async () => {
      reporter += 1;
      const offer = offers[reporter % offers.length];
      await reportAs(telegramEnv, `/api/ofertas/${offer?.id}/denuncia`, `192.0.2.${reporter}`);
      await flushDeferred();
    };
    const alerts = () => telegramCalls.filter((message) => message.text.startsWith("Possível ataque de denúncias")).length;

    for (let index = 0; index < 9; index += 1) await reportOnce();
    expect(alerts()).toBe(0);
    await reportOnce();
    expect(alerts()).toBe(1);
    for (let index = 0; index < 5; index += 1) await reportOnce();
    expect(alerts()).toBe(1);

    clock.now = new Date(clock.now.getTime() + 31 * 60 * 1000);
    for (let index = 0; index < 9; index += 1) await reportOnce();
    expect(alerts()).toBe(0 + 1);
    await reportOnce();
    expect(alerts()).toBe(2);
  });
});
