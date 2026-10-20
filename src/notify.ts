import type { Deps, Env } from "./env";
import { loadMunicipio } from "./places";

const BURST_WINDOW_MS = 10 * 60 * 1000;
const BURST_THRESHOLD = 10;
const BURST_COOLDOWN_MS = 30 * 60 * 1000;
const SNIPPET_MAX = 120;

export interface ReportNotice {
  tipo: "oferta" | "grupo";
  id: string;
  municipio: string;
  motivo: string;
  texto: string;
  total: number;
}

async function sendTelegram(env: Env, deps: Deps, text: string): Promise<void> {
  const response = await deps.fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  });
  if (!response.ok) throw new Error(`telegram sendMessage returned ${response.status}`);
}

function snippet(text: string): string {
  return text.length > SNIPPET_MAX ? `${text.slice(0, SNIPPET_MAX - 1)}…` : text;
}

/**
 * Claims the burst alert slot atomically: the upsert only succeeds when the last
 * alert is older than the cooldown, so concurrent reports send a single alert.
 */
async function claimBurstAlert(db: D1Database, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - BURST_WINDOW_MS).toISOString();
  const recent = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM reports WHERE created_at > ?1)
            + (SELECT COUNT(*) FROM grupo_reports WHERE created_at > ?1) AS total`,
    )
    .bind(since)
    .first<{ total: number }>();
  if ((recent?.total ?? 0) < BURST_THRESHOLD) return false;
  const cooldown = new Date(now.getTime() - BURST_COOLDOWN_MS).toISOString();
  const claimed = await db
    .prepare(
      `INSERT INTO system_state (key, value) VALUES ('alerta_denuncias', ?1)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE system_state.value <= ?2`,
    )
    .bind(now.toISOString(), cooldown)
    .run();
  return claimed.meta.changes === 1;
}

/** Tells the moderators about a report. Silently does nothing when Telegram is not configured. */
export async function notifyReport(env: Env, deps: Deps, notice: ReportNotice): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    const municipio = (await loadMunicipio(env.ASSETS, notice.municipio))?.nome || notice.municipio;
    await sendTelegram(
      env,
      deps,
      `Denúncia (${notice.motivo}) em ${notice.tipo} ${notice.id} — ${municipio} — ${snippet(notice.texto)}. Total: ${notice.total}.`,
    );
    if (await claimBurstAlert(env.DB, deps.now())) {
      await sendTelegram(
        env,
        deps,
        `Possível ataque de denúncias: ${BURST_THRESHOLD} ou mais denúncias nos últimos 10 minutos. Confira a moderação.`,
      );
    }
  } catch (error) {
    console.error("report notification failed", error);
  }
}
