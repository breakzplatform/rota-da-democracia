// Shared constants for the runoff of 25 Oct 2026 (Brazil, UTC-3).
export const ELECTION = {
  date: "2026-10-25",
  rideWindowStart: "2026-10-25T09:00:00-03:00",
  rideWindowEnd: "2026-10-25T17:00:00-03:00",
  // New offers and groups are refused from this instant (Sun 25 Oct 07:59 BRT, before polls open).
  signupClosesAt: "2026-10-25T07:59:00-03:00",
  // Everything is deleted at this instant (Sun 25 Oct 17:00 BRT, when polls close).
  purgeAt: "2026-10-25T17:00:00-03:00",
} as const;

export const LIMITS = {
  nome: 30,
  pontoEncontro: 80,
  bairroSaida: 40,
  nota: 200,
  vagasMin: 1,
  vagasMax: 4,
  // Mobile carriers put many voters behind one IPv4 (CGNAT); Turnstile already stops bots.
  offersPerIpPerDay: 30,
  revealsPerIpPerHour: 200,
  reportsPerIpPerDay: 5,
  groupsPerIpPerDay: 10,
} as const;

// Standalone tokens and phrases that make an offer look like campaigning.
export const CAMPAIGN_PATTERNS: readonly RegExp[] = [
  // Bare numbers are too common in addresses ("Praça 13 de Maio"); only flag them next to vote words.
  /\b(vot\w*|n[uú]mero|confirma)\W{0,3}(13|22)\b/i,
  /\b(13|22)\W{0,3}(confirma|nele|neles|nela)\b/i,
  /\bvot(e|a|em|ar)\s+(n[oa]s?|em)\b/i,
  /\bvoto\s+(n[oa]|em)\b/i,
  /\b(lula|bolsonaro|alfredo\s+gaspar|tarc[ií]sio|haddad|alckmin|mar[cç]al)/i,
  /\b(pt|pl|psdb|mdb|psol|pdt|partido novo|uni[aã]o brasil|republicanos|psd|pcdob|pc do b|psb)\b/i,
  /\b(petista|bolsonarista|lulista|esquerdista|direitista|mito|lul[aã]o)\b/i,
];

export const SITE_NAME = "Rota da Democracia";
