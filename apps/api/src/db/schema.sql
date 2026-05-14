CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'requester', 'signer');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('draft', 'pending_signature', 'correction_requested', 'signed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  item_name TEXT NOT NULL,
  item_identifier TEXT NOT NULL,
  authorized_person_name TEXT NOT NULL,
  authorized_person_document TEXT NOT NULL,
  usage_reason TEXT NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'Reparo',
  valid_from DATE NOT NULL,
  valid_until DATE NOT NULL,
  signature_due_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 day'),
  status order_status NOT NULL DEFAULT 'draft',
  requester_id UUID NOT NULL REFERENCES users(id),
  destination_role user_role NOT NULL DEFAULT 'signer',
  signer_id UUID REFERENCES users(id),
  second_signer_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'Reparo';
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS destination_role user_role;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS signature_due_at TIMESTAMPTZ;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS second_signer_id UUID REFERENCES users(id);
UPDATE service_orders SET destination_role = 'signer' WHERE destination_role IS NULL;
ALTER TABLE service_orders ALTER COLUMN destination_role SET DEFAULT 'signer';
ALTER TABLE service_orders ALTER COLUMN destination_role SET NOT NULL;
ALTER TABLE service_orders ALTER COLUMN signature_due_at SET DEFAULT (NOW() + INTERVAL '1 day');
UPDATE service_orders SET signature_due_at = created_at + INTERVAL '1 day' WHERE signature_due_at IS NULL;
ALTER TABLE service_orders ALTER COLUMN signature_due_at SET NOT NULL;
ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS service_orders_order_type_check;
ALTER TABLE service_orders ADD CONSTRAINT service_orders_order_type_check CHECK (order_type IN ('Reparo', 'Atualizacao', 'Teste'));
ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS service_orders_item_identifier_check;
UPDATE service_orders SET item_identifier = 'D195' WHERE item_identifier NOT IN ('D195', 'S920', 'Q92x', 'A910', 'P2');
ALTER TABLE service_orders ADD CONSTRAINT service_orders_item_identifier_check CHECK (item_identifier IN ('D195', 'S920', 'Q92x', 'A910', 'P2'));

CREATE TABLE IF NOT EXISTS order_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL,
  message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_signatures (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  signer_id UUID NOT NULL REFERENCES users(id),
  signer_name TEXT,
  signature_hash TEXT NOT NULL UNIQUE,
  signed_payload JSONB NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE order_signatures ADD COLUMN IF NOT EXISTS signer_name TEXT;

CREATE INDEX IF NOT EXISTS idx_service_orders_status ON service_orders(status);
CREATE INDEX IF NOT EXISTS idx_service_orders_requester ON service_orders(requester_id);
CREATE INDEX IF NOT EXISTS idx_service_orders_destination_role ON service_orders(destination_role);
CREATE INDEX IF NOT EXISTS idx_service_orders_signer ON service_orders(signer_id);
CREATE INDEX IF NOT EXISTS idx_service_orders_second_signer ON service_orders(second_signer_id);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(service_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_signatures_order_signer ON order_signatures(service_order_id, signer_id);
