CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'requester', 'signer');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'spectator';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'stock';

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('draft', 'pending_signature', 'correction_requested', 'signed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'awaiting_stock';

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS terminal_models (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO order_types (name)
VALUES ('Reparo'), ('Atualizacao'), ('Teste')
ON CONFLICT (name) DO NOTHING;

INSERT INTO terminal_models (name)
VALUES ('D195'), ('S920'), ('Q92x'), ('A910'), ('P2')
ON CONFLICT (name) DO NOTHING;

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

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  terminal_model TEXT NOT NULL,
  part_number TEXT NOT NULL,
  client_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  configuration TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS service_orders_item_identifier_check;

INSERT INTO order_items (
  service_order_id, item_name, terminal_model, part_number, client_name, quantity, configuration
)
SELECT id, item_name, item_identifier, '-', '-', 1, usage_reason
FROM service_orders so
WHERE NOT EXISTS (
  SELECT 1 FROM order_items oi WHERE oi.service_order_id = so.id
);

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_note TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_updated_at TIMESTAMPTZ;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_updated_by UUID REFERENCES users(id);
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_stock_status_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_stock_status_check
  CHECK (stock_status IN ('pending', 'unavailable', 'separating', 'separated'));

-- Ordens que ja passaram do estoque no fluxo antigo ficam com os itens como separados.
UPDATE order_items SET stock_status = 'separated'
WHERE stock_status <> 'separated'
  AND service_order_id IN (SELECT id FROM service_orders WHERE status IN ('pending_signature', 'signed'));

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
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(service_order_id);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(service_order_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_signatures_order_signer ON order_signatures(service_order_id, signer_id);
