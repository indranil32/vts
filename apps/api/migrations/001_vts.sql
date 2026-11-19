-- VTS centre schema. One deployment = one VTS centre (its area, zones and operators).

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  roles text[] NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL
);

-- Static/voyage data per MMSI (AIS type 5/19/24, enriched from the PCS)
CREATE TABLE vessels (
  mmsi char(9) PRIMARY KEY,
  imo char(7),
  name text,
  call_sign text,
  ship_type int,
  ship_type_text text,
  length numeric(6,1), beam numeric(5,1), draught numeric(4,1),
  destination text,
  ais_class char(1) NOT NULL DEFAULT 'A',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Latest dynamic state per target (the live traffic image)
CREATE TABLE targets (
  mmsi char(9) PRIMARY KEY,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  sog numeric(4,1), cog numeric(4,1), heading int, rot int,
  nav_status text,
  source text NOT NULL,
  zones text[] NOT NULL DEFAULT '{}',
  traffic_status text,
  anchor_lat double precision, anchor_lon double precision,
  at timestamptz NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now()
);

-- Track history (thinned) for replay and incident investigation
CREATE TABLE track_points (
  id bigserial PRIMARY KEY,
  mmsi char(9) NOT NULL,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  sog numeric(4,1), cog numeric(4,1), heading int,
  at timestamptz NOT NULL
);
CREATE INDEX ON track_points (at);
CREATE INDEX ON track_points (mmsi, at);

CREATE TABLE zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  polygon jsonb NOT NULL,            -- [[lat,lon],...]
  max_speed numeric(4,1),            -- knots (speed-limit zones)
  min_depth numeric(4,1),            -- charted depth (grounding risk)
  pcs_berth_code text,               -- BERTH zones: matching PCS berth
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reporting_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  line jsonb NOT NULL,               -- [[lat,lon],[lat,lon]]
  direction text NOT NULL DEFAULT 'BOTH',
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  severity text NOT NULL,            -- INFO / WARNING / ALARM
  key text NOT NULL,                 -- de-duplication key (type + mmsi / pair)
  mmsi char(9), mmsi2 char(9),
  message text NOT NULL,
  data jsonb,
  status text NOT NULL DEFAULT 'OPEN', -- OPEN / ACKNOWLEDGED / CLOSED / AUTO_CLEARED
  raised_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ack_by uuid, ack_at timestamptz, ack_note text,
  closed_at timestamptz
);
CREATE UNIQUE INDEX alerts_open_key ON alerts (key) WHERE status IN ('OPEN', 'ACKNOWLEDGED');
CREATE INDEX ON alerts (raised_at DESC);

-- VTS log (journal): automatic events + operator entries (VHF communications, instructions, incidents)
CREATE TABLE vts_log (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  category text NOT NULL,            -- EVENT / VHF / INSTRUCTION / INCIDENT / CLEARANCE / PCS / NOTE
  mmsi char(9),
  text text NOT NULL,
  user_id uuid,
  author text NOT NULL DEFAULT 'system'
);
CREATE INDEX ON vts_log (at DESC);

-- Traffic clearances issued by the VTS operator
CREATE TABLE clearances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mmsi char(9) NOT NULL,
  type text NOT NULL,
  remarks text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE / USED / REVOKED / EXPIRED
  issued_by uuid, issued_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Port call information mirrored from the PCS (expected arrivals, permits, berth, clearance state)
CREATE TABLE pcs_calls (
  id uuid PRIMARY KEY,               -- PCS vessel call id
  call_no text NOT NULL,
  mmsi char(9), imo char(7),
  vessel_name text,
  agent_name text,
  status text NOT NULL,
  berth_code text,
  eta timestamptz, etd timestamptz, ata timestamptz, atd timestamptz, berthed_at timestamptz,
  entry_permit_no text,
  departure_clearance_no text,
  dangerous_goods boolean,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON pcs_calls (mmsi);

-- Reliable delivery of movement reports to the PCS (retried until accepted)
CREATE TABLE pcs_outbox (
  id bigserial PRIMARY KEY,
  call_id uuid NOT NULL,
  action text NOT NULL,              -- arrived / berthed / departed
  at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  UNIQUE (call_id, action)
);

CREATE TABLE seed_state (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);
