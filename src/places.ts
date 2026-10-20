export interface PollingPlace {
  id: string;
  nome: string;
}

interface MunicipioShard {
  cd: string;
  locais: PollingPlace[];
}

const MUNICIPIO_CODE = /^\d{5}$/;
const cache = new Map<string, MunicipioShard | null>();
const CACHE_LIMIT = 200;

export function isMunicipioCode(value: unknown): value is string {
  return typeof value === "string" && MUNICIPIO_CODE.test(value);
}

/** Reads `public/data/m/<cd>.json` through the assets binding; null when unknown. */
export async function loadMunicipio(assets: Fetcher, cd: string): Promise<MunicipioShard | null> {
  if (!isMunicipioCode(cd)) return null;
  const cached = cache.get(cd);
  if (cached !== undefined) return cached;
  const response = await assets.fetch(new Request(`https://assets.invalid/data/m/${cd}.json`));
  let shard: MunicipioShard | null = null;
  if (response.ok) {
    const parsed: unknown = await response.json();
    shard = parseShard(parsed);
  } else {
    await response.body?.cancel();
    // Only definitive misses are cached; transient failures are retried next time.
    if (response.status !== 404) throw new Error(`assets returned ${response.status} for municipio ${cd}`);
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(cd, shard);
  return shard;
}

export function clearMunicipioCache(): void {
  cache.clear();
}

function parseShard(value: unknown): MunicipioShard | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.cd !== "string" || !Array.isArray(record.locais)) return null;
  const locais: PollingPlace[] = [];
  for (const item of record.locais as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const local = item as Record<string, unknown>;
    if (typeof local.id === "string" && typeof local.nome === "string") {
      locais.push({ id: local.id, nome: local.nome });
    }
  }
  return { cd: record.cd, locais };
}
