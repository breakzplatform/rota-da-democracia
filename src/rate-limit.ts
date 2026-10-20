import { LIMITS } from "./config";

export type RateKind = "oferta" | "contato" | "denuncia";

const HOUR_MS = 60 * 60 * 1000;

export const RATE_RULES: Readonly<Record<RateKind, { windowMs: number; limit: number }>> = {
  oferta: { windowMs: 24 * HOUR_MS, limit: LIMITS.offersPerIpPerDay },
  contato: { windowMs: HOUR_MS, limit: LIMITS.revealsPerIpPerHour },
  denuncia: { windowMs: HOUR_MS, limit: LIMITS.reportsPerIpPerHour },
};

export interface Reservation {
  release(): Promise<void>;
}

/**
 * Atomically takes one unit of quota: the count and the insert are a single
 * statement, so concurrent requests cannot both pass a "count < limit" check.
 * Returns null when the quota is exhausted or the site was purged.
 *
 * Semantics: the caller keeps the reservation only if the operation succeeds and
 * calls release() on any later failure (bad Turnstile, unknown offer, ...), so
 * only completed operations count against the limit.
 */
export async function reserve(
  db: D1Database,
  kind: RateKind,
  ipHash: string,
  now: Date,
): Promise<Reservation | null> {
  const { windowMs, limit } = RATE_RULES[kind];
  const since = new Date(now.getTime() - windowMs).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO rate_events (kind, ip_hash, created_at)
       SELECT ?1, ?2, ?3
       WHERE (SELECT COUNT(*) FROM rate_events WHERE kind = ?1 AND ip_hash = ?2 AND created_at > ?4) < ?5
         AND NOT EXISTS (SELECT 1 FROM system_state WHERE key = 'encerrado')`,
    )
    .bind(kind, ipHash, now.toISOString(), since, limit)
    .run();
  if (result.meta.changes !== 1) return null;
  const id = result.meta.last_row_id;
  return {
    async release() {
      await db.prepare("DELETE FROM rate_events WHERE id = ?").bind(id).run();
    },
  };
}

export async function withQuota<T>(
  db: D1Database,
  kind: RateKind,
  ipHash: string,
  now: Date,
  onExhausted: () => Promise<Error>,
  operation: () => Promise<T>,
): Promise<T> {
  const reservation = await reserve(db, kind, ipHash, now);
  if (!reservation) throw await onExhausted();
  try {
    return await operation();
  } catch (error) {
    await reservation.release();
    throw error;
  }
}
