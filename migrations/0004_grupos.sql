-- WhatsApp groups that organize rides by region. The invite link is only
-- revealed through POST /api/grupos/:id/entrar, never in listings.
CREATE TABLE grupos (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  municipio TEXT NOT NULL,
  nome TEXT NOT NULL,
  bairros TEXT NOT NULL,
  -- Accent/case-folded "nome bairros", for the q= search.
  busca TEXT NOT NULL,
  link TEXT NOT NULL UNIQUE,
  admin_nome TEXT NOT NULL,
  -- Audit trail of the five mandatory declarations ticked by the admin.
  aceite INTEGER NOT NULL CHECK (aceite = 1),
  sem_vinculo INTEGER NOT NULL CHECK (sem_vinculo = 1),
  grupo_apartidario INTEGER NOT NULL CHECK (grupo_apartidario = 1),
  sem_caravana INTEGER NOT NULL CHECK (sem_caravana = 1),
  admin_responsavel INTEGER NOT NULL CHECK (admin_responsavel = 1),
  declarado_em TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX grupos_municipio ON grupos (municipio, nome);

-- One row per (group, reporter network); the group is hidden at LIMITS.reportsToHide rows.
CREATE TABLE grupo_reports (
  grupo_id TEXT NOT NULL REFERENCES grupos (id) ON DELETE CASCADE,
  ip_hash TEXT NOT NULL,
  motivo TEXT NOT NULL CHECK (motivo IN ('cobranca', 'campanha', 'falsa', 'outro')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (grupo_id, ip_hash)
);
