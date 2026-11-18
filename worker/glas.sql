-- Novi glas za glasno branje (src/glas.js). Tabeli sta v isti bazi D1 kot spremljanje
-- vozil (vezava SPREMLJANJE_DB), da za glas ni treba novega vira. Vnos (enkrat, varno
-- ponoviti):
--   npx wrangler d1 execute moha-spremljanje --remote --file glas.sql
--
-- glas_povedi: vsaka poved, ki jo je glas kdaj izgovoril. `zvok` je MP3 (64 kbit/s,
-- ~8 kB na sekundo), `casi` JSON [[beseda, začetek v s], …] za rabo zunaj
-- Workerja. `mesec` ('YYYY-MM', Ljubljana) in `krediti` nosita
-- mesečno mejo porabe ElevenLabs.
CREATE TABLE IF NOT EXISTS glas_povedi (
  kljuc      TEXT PRIMARY KEY,
  besedilo   TEXT NOT NULL,
  glas       TEXT NOT NULL,
  model      TEXT NOT NULL,
  zvok       BLOB NOT NULL,
  casi       TEXT NOT NULL,
  znaki      INTEGER NOT NULL,
  krediti    REAL NOT NULL,
  mesec      TEXT NOT NULL,
  ustvarjeno TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS glas_povedi_mesec ON glas_povedi (mesec);
CREATE INDEX IF NOT EXISTS glas_povedi_ustvarjeno ON glas_povedi (ustvarjeno);

-- glas_poraba: krediti ElevenLabs po mesecih. Vrstica se poveča PRED klicem na ElevenLabs
-- (rezervacija ocene) in po njem popravi na dejanski strošek, zato je mesečna meja trda
-- tudi ob hkratnih klicih.
CREATE TABLE IF NOT EXISTS glas_poraba (
  mesec   TEXT PRIMARY KEY,
  krediti REAL NOT NULL
);

-- glas_stanje: stikala. ('vklop', 'off') izklopi novi glas za vse uporabnike; brez
-- vrstice je vklopljen.
CREATE TABLE IF NOT EXISTS glas_stanje (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
