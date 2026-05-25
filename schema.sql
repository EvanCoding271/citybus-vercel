-- ============================================================
-- CityBus Transport — Supabase PostgreSQL Schema
-- Run this in: Supabase → SQL Editor → New query → Run
-- ============================================================

CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'passenger',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (role IN ('passenger', 'admin', 'operator', 'finance'))
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role_id INT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS buses (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  plate_number TEXT NOT NULL UNIQUE,
  capacity INT NOT NULL CHECK (capacity > 0),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (status IN ('active', 'maintenance', 'idle'))
);

CREATE TABLE IF NOT EXISTS routes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  origin TEXT NOT NULL,
  destination TEXT NOT NULL,
  base_fare NUMERIC(10,2) NOT NULL CHECK (base_fare >= 0),
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (status IN ('active', 'inactive', 'maintenance'))
);

CREATE TABLE IF NOT EXISTS schedules (
  id SERIAL PRIMARY KEY,
  bus_id INT NOT NULL REFERENCES buses(id) ON DELETE CASCADE,
  route_id INT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  departure_time TIMESTAMPTZ NOT NULL,
  arrival_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (status IN ('active', 'cancelled', 'maintenance'))
);

CREATE TABLE IF NOT EXISTS seats (
  id SERIAL PRIMARY KEY,
  schedule_id INT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  seat_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (schedule_id, seat_label),
  CHECK (status IN ('available', 'reserved', 'occupied'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule_id INT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  booking_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  booking_status TEXT NOT NULL DEFAULT 'pending',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (booking_status IN ('pending', 'confirmed', 'cancelled', 'refunded')),
  CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded'))
);

CREATE TABLE IF NOT EXISTS booking_seats (
  id SERIAL PRIMARY KEY,
  booking_id INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  seat_id INT NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  seat_label TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (booking_id, seat_id),
  UNIQUE (seat_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  booking_id INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (status IN ('pending', 'completed', 'failed', 'refunded'))
);

CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  booking_id INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  qr_code TEXT NOT NULL UNIQUE,
  ticket_status TEXT NOT NULL DEFAULT 'issued',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (booking_id),
  CHECK (ticket_status IN ('issued', 'used', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance_reports (
  id SERIAL PRIMARY KEY,
  report_date DATE NOT NULL,
  total_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_expenses NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_profit NUMERIC(14,2) NOT NULL DEFAULT 0,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refund_logs (
  id SERIAL PRIMARY KEY,
  booking_id INT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  processed_by INT REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (status IN ('pending', 'processed', 'rejected'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  employee_id INT REFERENCES employees(id),
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Auto-update updated_at triggers ──────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_users') THEN
    CREATE TRIGGER set_updated_at_users BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_employees') THEN
    CREATE TRIGGER set_updated_at_employees BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_buses') THEN
    CREATE TRIGGER set_updated_at_buses BEFORE UPDATE ON buses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_routes') THEN
    CREATE TRIGGER set_updated_at_routes BEFORE UPDATE ON routes FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_schedules') THEN
    CREATE TRIGGER set_updated_at_schedules BEFORE UPDATE ON schedules FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_seats') THEN
    CREATE TRIGGER set_updated_at_seats BEFORE UPDATE ON seats FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_bookings') THEN
    CREATE TRIGGER set_updated_at_bookings BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_payments') THEN
    CREATE TRIGGER set_updated_at_payments BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_tickets') THEN
    CREATE TRIGGER set_updated_at_tickets BEFORE UPDATE ON tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_finance_reports') THEN
    CREATE TRIGGER set_updated_at_finance_reports BEFORE UPDATE ON finance_reports FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_refund_logs') THEN
    CREATE TRIGGER set_updated_at_refund_logs BEFORE UPDATE ON refund_logs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ── Seed roles ────────────────────────────────────────────────────────
INSERT INTO roles (name, description) VALUES
  ('admin',     'Admin access for system operations'),
  ('operator',  'Bus operator access for boarding and trip validation'),
  ('finance',   'Finance access for revenue and refund reporting'),
  ('passenger', 'Passenger access for booking and profile')
ON CONFLICT (name) DO NOTHING;
