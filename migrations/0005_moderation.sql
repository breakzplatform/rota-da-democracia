-- Reports never hide anything automatically; a moderator does, through the
-- admin endpoints. revisado_em marks reports already handled by a moderator.
ALTER TABLE offers ADD COLUMN oculta INTEGER NOT NULL DEFAULT 0 CHECK (oculta IN (0, 1));
ALTER TABLE grupos ADD COLUMN oculto INTEGER NOT NULL DEFAULT 0 CHECK (oculto IN (0, 1));
ALTER TABLE reports ADD COLUMN revisado_em TEXT;
ALTER TABLE grupo_reports ADD COLUMN revisado_em TEXT;
