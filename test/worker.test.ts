import { createScheduledController, SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { call, clock, createOffer, testEnv, TURNSTILE } from "./helpers";

async function count(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS total FROM ${table}`).first<{ total: number }>();
  return row?.total ?? 0;
}

async function runCron(at: string): Promise<void> {
  await worker.scheduled(createScheduledController({ scheduledTime: new Date(at), cron: "0 * * * *" }), testEnv);
}

describe("scheduled cleanup", () => {
  it("drops rate events older than 24h and offers 3h after departure", async () => {
    await createOffer({ saida: "2026-10-25T09:00:00-03:00", nome: "Cedo" });
    await createOffer({ saida: "2026-10-25T16:00:00-03:00", nome: "Tarde" });
    expect(await count("rate_events")).toBe(2);

    await runCron("2026-10-21T12:00:01Z");
    expect(await count("rate_events")).toBe(0);
    expect(await count("offers")).toBe(2);

    await runCron("2026-10-25T12:30:00-03:00");
    const { results } = await env.DB.prepare("SELECT nome FROM offers").all<{ nome: string }>();
    expect(results.map((row) => row.nome)).toEqual(["Tarde"]);
  });

  it("deletes everything at the purge instant", async () => {
    const { id } = await createOffer({ saida: "2026-10-25T16:00:00-03:00" });
    await call("POST", `/api/ofertas/${id}/denuncia`, { body: { turnstile: TURNSTILE.denuncia, motivo: "outro" } });
    clock.now = new Date("2026-10-26T14:00:00Z");
    await call("POST", `/api/ofertas/${id}/contato`, { body: { turnstile: TURNSTILE.contato, ciente: true } });

    await runCron("2026-10-26T14:59:59Z");
    expect(await count("rate_events")).toBe(1);

    await runCron("2026-10-26T15:00:00Z");
    expect(await count("offers")).toBe(0);
    expect(await count("reports")).toBe(0);
    expect(await count("rate_events")).toBe(0);
    const flag = await env.DB.prepare("SELECT value FROM system_state WHERE key = 'encerrado'").first<{ value: string }>();
    expect(flag?.value).toBe("2026-10-26T15:00:00.000Z");
  });
});

describe("deployed entry point", () => {
  it("routes /api/* to the API", async () => {
    const response = await SELF.fetch("https://carona.test/api/status");
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; encerrado: boolean }>();
    expect(body.ok).toBe(true);
    expect(typeof body.encerrado).toBe("boolean");

    const config = await SELF.fetch("https://carona.test/api/config");
    expect(await config.json()).toMatchObject({ turnstileSiteKey: "1x00000000000000000000AA" });
  });

  it("returns JSON 404 for unknown API paths", async () => {
    const response = await SELF.fetch("https://carona.test/api/missing");
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "nao_encontrado" });
  });
});
