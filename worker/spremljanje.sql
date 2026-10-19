-- Shema baze D1 za spremljanje vozil (src/spremljanje.js).
-- Enkrat ob namestitvi:
--   npx wrangler d1 create moha-spremljanje
--   (izpisani database_id vpiši v wrangler.toml pod [[d1_databases]])
--   npx wrangler d1 execute moha-spremljanje --remote --file spremljanje.sql
--
-- Nadgradnja obstoječe baze (19.10.2026, km po trasi), enkrat:
--   npx wrangler d1 execute moha-spremljanje --remote --command "ALTER TABLE dnevno ADD COLUMN km_trasa REAL NOT NULL DEFAULT 0"
--
-- Ena vrstica na vozilo in dan. Časi so v ms (UTC), dan je koledarski dan v
-- Ljubljani. lat/lon/tpol je zadnji sprejeti položaj (izhodišče za naslednjo
-- razdaljo), pot so točke 't,lat,lon' ločene s ';' (t v sekundah, '!' pred
-- točko = tam se pot prekine).
CREATE TABLE IF NOT EXISTS dnevno (
  dan     TEXT    NOT NULL,
  bus     TEXT    NOT NULL,
  km      REAL    NOT NULL DEFAULT 0,
  km_trasa REAL   NOT NULL DEFAULT 0,   -- del km, izmerjen po trasi GTFS (trase.js)
  prva    INTEGER NOT NULL,
  zadnja  INTEGER NOT NULL,
  lat     REAL    NOT NULL,
  lon     REAL    NOT NULL,
  tpol    INTEGER NOT NULL,
  linije  TEXT    NOT NULL DEFAULT '',
  vzorcev INTEGER NOT NULL DEFAULT 0,
  pot     TEXT,
  PRIMARY KEY (dan, bus)
) WITHOUT ROWID;
