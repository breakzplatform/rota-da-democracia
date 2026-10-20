import { isClosed } from "./election";
import type { Env } from "./env";
import { RATE_RULES } from "./rate-limit";

// Offers stay listed for the owner a little after departure, then are deleted.
const OFFER_RETENTION_MS = 3 * 60 * 60 * 1000;

export const NOT_PURGED = "NOT EXISTS (SELECT 1 FROM system_state WHERE key = 'encerrado')";

export async function isPurged(db: D1Database): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM system_state WHERE key = 'encerrado'").first()) !== null;
}

export async function purgeAll(env: Env, now: Date): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO system_state (key, value) VALUES ('encerrado', ?)").bind(now.toISOString()),
    env.DB.prepare("DELETE FROM reports"),
    env.DB.prepare("DELETE FROM offers"),
    env.DB.prepare("DELETE FROM grupo_reports"),
    env.DB.prepare("DELETE FROM grupos"),
    env.DB.prepare("DELETE FROM rate_events"),
  ]);
}

export async function cleanup(env: Env, now: Date): Promise<void> {
  if (isClosed(now)) {
    await purgeAll(env, now);
    return;
  }
  const longestWindow = Math.max(...Object.values(RATE_RULES).map((rule) => rule.windowMs));
  const rateCutoff = new Date(now.getTime() - longestWindow).toISOString();
  const offerCutoff = new Date(now.getTime() - OFFER_RETENTION_MS).toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rate_events WHERE created_at <= ?").bind(rateCutoff),
    env.DB.prepare("DELETE FROM reports WHERE offer_id IN (SELECT id FROM offers WHERE saida < ?)").bind(offerCutoff),
    env.DB.prepare("DELETE FROM offers WHERE saida < ?").bind(offerCutoff),
  ]);
}
