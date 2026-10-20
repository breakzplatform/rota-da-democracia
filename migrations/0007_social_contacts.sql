-- Allows Instagram and Bluesky handles and an allowlisted messaging link
-- ("outro", with its app name in contato_rotulo) as contacts. SQLite cannot alter a
-- CHECK constraint, so offers is rebuilt as in 0003, with reports set aside
-- first so dropping offers does not cascade-delete them.
PRAGMA defer_foreign_keys = true;

CREATE TABLE reports_backup AS SELECT offer_id, ip_hash, motivo, created_at, revisado_em FROM reports;
DROP TABLE reports;

CREATE TABLE offers_new (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  nome TEXT NOT NULL,
  -- whatsapp: E.164 number; email: lowercase address; whatsapp_usuario, instagram, bluesky: lowercase handle without "@".
  contato_tipo TEXT NOT NULL CHECK (contato_tipo IN ('whatsapp', 'whatsapp_usuario', 'email', 'instagram', 'bluesky', 'outro')),
  contato TEXT NOT NULL,
  -- Only for outro: the app name the driver typed, such as "Telegram".
  contato_rotulo TEXT CHECK ((contato_tipo = 'outro') = (contato_rotulo IS NOT NULL)),
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
  -- Audit trail of the mandatory declarations ticked by the driver.
  aceite INTEGER NOT NULL CHECK (aceite = 1),
  sem_vinculo INTEGER NOT NULL CHECK (sem_vinculo = 1),
  combina_whatsapp INTEGER NOT NULL CHECK (combina_whatsapp = 1),
  veiculo_particular INTEGER NOT NULL CHECK (veiculo_particular = 1),
  sem_pagamento INTEGER NOT NULL CHECK (sem_pagamento = 1),
  maior_habilitado INTEGER NOT NULL CHECK (maior_habilitado = 1),
  declarado_em TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  oculta INTEGER NOT NULL DEFAULT 0 CHECK (oculta IN (0, 1)),
  um_trajeto INTEGER NOT NULL DEFAULT 0 CHECK (um_trajeto IN (0, 1))
);

INSERT INTO offers_new (id, token_hash, nome, contato_tipo, contato, municipio, local_id, local_nome,
  ponto_encontro, bairro_saida, bairro_busca, saida, vagas, vagas_livres, nota, acessivel, aceite,
  sem_vinculo, combina_whatsapp, veiculo_particular, sem_pagamento, maior_habilitado, declarado_em,
  created_at, updated_at, oculta, um_trajeto)
SELECT id, token_hash, nome, contato_tipo, contato, municipio, local_id, local_nome,
  ponto_encontro, bairro_saida, bairro_busca, saida, vagas, vagas_livres, nota, acessivel, aceite,
  sem_vinculo, combina_whatsapp, veiculo_particular, sem_pagamento, maior_habilitado, declarado_em,
  created_at, updated_at, oculta, um_trajeto
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
  revisado_em TEXT,
  PRIMARY KEY (offer_id, ip_hash)
);
INSERT INTO reports SELECT offer_id, ip_hash, motivo, created_at, revisado_em FROM reports_backup;
DROP TABLE reports_backup;
