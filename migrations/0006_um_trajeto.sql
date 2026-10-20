-- Drivers now also declare they give rides only on their own trip (one way
-- and back), not shuttling voters. Offers created before this stay at 0.
ALTER TABLE offers ADD COLUMN um_trajeto INTEGER NOT NULL DEFAULT 0 CHECK (um_trajeto IN (0, 1));
