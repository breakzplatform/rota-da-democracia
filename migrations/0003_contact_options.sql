-- Replaces the WhatsApp-only `whatsapp` column with a typed contact
-- (contato_tipo + contato). SQLite cannot change a column in place, so offers
-- is rebuilt. reports is set aside first: dropping offers while reports still
-- references it would cascade-delete every report.
PRAGMA defer_foreign_keys = true;

CREATE TABLE reports_backup AS SELECT offer_id, ip_hash, motivo, created_at FROM reports;
DROP TABLE reports;

CREATE TABLE offers_new (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  nome TEXT NOT NULL,
  -- whatsapp: E.164 number; whatsapp_usuario: username without "@"; email: lowercase address.
  contato_tipo TEXT NOT NULL CHECK (contato_tipo IN ('whatsapp', 'whatsapp_usuario', 'email')),
  contato TEXT NOT NULL,
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

INSERT INTO offers_new (id, token_hash, nome, contato_tipo, contato, municipio, local_id, local_nome,
  ponto_encontro, bairro_saida, bairro_busca, saida, vagas, vagas_livres, nota, acessivel, aceite,
  sem_vinculo, combina_whatsapp, veiculo_particular, sem_pagamento, maior_habilitado, declarado_em,
  created_at, updated_at)
SELECT id, token_hash, nome, 'whatsapp', whatsapp, municipio, local_id, local_nome,
  ponto_encontro, bairro_saida, bairro_busca, saida, vagas, vagas_livres, nota, acessivel, aceite,
  sem_vinculo, combina_whatsapp, veiculo_particular, sem_pagamento, maior_habilitado, declarado_em,
  created_at, updated_at
FROM offers;

DROP TABLE offers;
ALTER TABLE offers_new RENAME TO offers;
CREATE INDEX offers_search ON offers (municipio, local_id, saida);
CREATE INDEX offers_saida ON offers (saida);

CREATE TABLE reports (
  offer_id TEXT NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
  ip_hash TEXT NOT NULL,
  motivo TEXT NOT NULL CHECK (motivo IN ('cobranca', 'campanha', 'falsa', 'outro')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (offer_id, ip_hash)
);
INSERT INTO reports SELECT offer_id, ip_hash, motivo, created_at FROM reports_backup;
DROP TABLE reports_backup;
