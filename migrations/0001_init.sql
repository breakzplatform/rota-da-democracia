-- Ride offers. Times are ISO-8601 UTC strings produced by Date#toISOString,
-- so lexicographic comparison matches chronological order.
CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  nome TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  municipio TEXT NOT NULL,
  local_id TEXT NOT NULL,
  local_nome TEXT NOT NULL,
  ponto_encontro TEXT NOT NULL,
  bairro_saida TEXT NOT NULL,
  bairro_busca TEXT NOT NULL,
  saida TEXT NOT NULL,
  vagas INTEGER NOT NULL CHECK (vagas BETWEEN 1 AND 4),
  vagas_livres INTEGER NOT NULL CHECK (vagas_livres BETWEEN 0 AND vagas),
  nota TEXT,
  acessivel INTEGER NOT NULL DEFAULT 0 CHECK (acessivel IN (0, 1)),
  -- Audit trail of the six mandatory declarations ticked by the driver.
  aceite INTEGER NOT NULL CHECK (aceite = 1),
  sem_vinculo INTEGER NOT NULL CHECK (sem_vinculo = 1),
  combina_whatsapp INTEGER NOT NULL CHECK (combina_whatsapp = 1),
  veiculo_particular INTEGER NOT NULL CHECK (veiculo_particular = 1),
  sem_pagamento INTEGER NOT NULL CHECK (sem_pagamento = 1),
  maior_habilitado INTEGER NOT NULL CHECK (maior_habilitado = 1),
  declarado_em TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX offers_search ON offers (municipio, local_id, saida);
CREATE INDEX offers_saida ON offers (saida);

-- One row per (offer, reporter IP hash): distinct reporters are counted by row count.
CREATE TABLE reports (
  offer_id TEXT NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
  ip_hash TEXT NOT NULL,
  motivo TEXT NOT NULL CHECK (motivo IN ('cobranca', 'campanha', 'falsa', 'outro')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (offer_id, ip_hash)
);

-- Rate-limit ledger; rows older than the longest window are purged hourly.
CREATE TABLE rate_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX rate_events_lookup ON rate_events (kind, ip_hash, created_at);
