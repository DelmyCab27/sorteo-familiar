-- ============================================================
-- SORTEO FAMILIAR — Esquema de base de datos
-- Ejecutar en: Supabase Dashboard > SQL Editor
-- ============================================================

-- Extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLA: events
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_token  TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  event_date   TEXT,
  budget       TEXT,
  is_active    BOOLEAN DEFAULT TRUE,
  sorteo_done  BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLA: participants
-- ============================================================
CREATE TABLE IF NOT EXISTS participants (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  token          TEXT UNIQUE NOT NULL,
  pin_hash       TEXT,
  pin_salt       TEXT,
  has_pin        BOOLEAN DEFAULT FALSE,
  assigned_to_id UUID REFERENCES participants(id),
  wishlist       TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLA: restrictions
-- ============================================================
CREATE TABLE IF NOT EXISTS restrictions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  participant_a_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  participant_b_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE
);

-- ============================================================
-- TABLA: pin_attempts
-- ============================================================
CREATE TABLE IF NOT EXISTS pin_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token        TEXT NOT NULL,
  attempt_time TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_participants_token     ON participants(token);
CREATE INDEX IF NOT EXISTS idx_participants_event     ON participants(event_id);
CREATE INDEX IF NOT EXISTS idx_events_admin_token     ON events(admin_token);
CREATE INDEX IF NOT EXISTS idx_pin_attempts_token_time ON pin_attempts(token, attempt_time);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pin_attempts ENABLE ROW LEVEL SECURITY;
