-- One row per mission, keyed by its local start time (YYYY-MM-DDTHH:MM:SS).
CREATE TABLE IF NOT EXISTS runs (
  id             INTEGER PRIMARY KEY,
  run_key        TEXT    NOT NULL UNIQUE,
  outcome        TEXT,
  havoc_rank     INTEGER,
  havoc_mutators TEXT,
  updated_at     TEXT    NOT NULL
);

-- One row per player per mission. Re-uploading a run replaces that player's row.
CREATE TABLE IF NOT EXISTS run_players (
  run_id               INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  player               TEXT    NOT NULL,
  in_game_name         TEXT,
  is_known             INTEGER NOT NULL DEFAULT 0,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  class                TEXT,
  melee_weapon         TEXT,
  ranged_weapon        TEXT,
  blitz                TEXT,
  aura                 TEXT,
  combat_ability       TEXT,
  keystones            TEXT,
  melee_elite_kills    INTEGER NOT NULL DEFAULT 0,
  ranged_elite_kills   INTEGER NOT NULL DEFAULT 0,
  melee_special_kills  INTEGER NOT NULL DEFAULT 0,
  ranged_special_kills INTEGER NOT NULL DEFAULT 0,
  horde_trash_kills    INTEGER NOT NULL DEFAULT 0,
  ranged_trash_kills   INTEGER NOT NULL DEFAULT 0,
  boss_damage          INTEGER NOT NULL DEFAULT 0,
  elite_damage         INTEGER NOT NULL DEFAULT 0,
  horde_damage         INTEGER NOT NULL DEFAULT 0,
  specialist_damage    INTEGER NOT NULL DEFAULT 0,
  revives_done         INTEGER NOT NULL DEFAULT 0,
  needed_revives       INTEGER NOT NULL DEFAULT 0,
  ammo_used            INTEGER NOT NULL DEFAULT 0,
  blitz_uses           INTEGER NOT NULL DEFAULT 0,
  combat_ability_uses  INTEGER NOT NULL DEFAULT 0,
  damage_taken         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, player)
);

-- Single-value settings, e.g. the data version the webapp compares against.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
