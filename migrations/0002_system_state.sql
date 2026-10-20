-- Persistent flags. The 'encerrado' row is written in the same batch as the
-- final purge; every insert is conditional on it so in-flight requests cannot
-- re-create data after the purge.
CREATE TABLE system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
