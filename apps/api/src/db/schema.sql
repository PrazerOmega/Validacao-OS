CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'requester', 'signer');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'spectator';

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('draft', 'pending_signature', 'correction_requested', 'signed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'divergent';

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
  item_name TEXT,
  item_identifier TEXT NOT NULL,
  authorized_person_name TEXT NOT NULL,
  authorized_person_document TEXT NOT NULL,
  usage_reason TEXT NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'Reparo',
  executor_team TEXT,
  valid_from DATE NOT NULL,
  valid_until DATE NOT NULL,
  signature_due_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 day'),
  status order_status NOT NULL DEFAULT 'draft',
  requester_id UUID NOT NULL REFERENCES users(id),
  destination_role user_role NOT NULL DEFAULT 'signer',
  signer_id UUID REFERENCES users(id),
  second_signer_id UUID REFERENCES users(id),
  incorrect_signatures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  item_name TEXT,
  terminal_model TEXT NOT NULL,
  part_number TEXT NOT NULL,
  client_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  configuration TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'Reparo';
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS executor_team TEXT;
DO $$ BEGIN
  ALTER TABLE service_orders ADD CONSTRAINT service_orders_executor_team_check
  CHECK (executor_team IS NULL OR executor_team IN ('suporte', 'producao'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS idx_service_orders_executor_team ON service_orders(executor_team);
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS destination_role user_role;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS signature_due_at TIMESTAMPTZ;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS second_signer_id UUID REFERENCES users(id);
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS incorrect_signatures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE service_orders ALTER COLUMN item_name DROP NOT NULL;
ALTER TABLE order_items ALTER COLUMN item_name DROP NOT NULL;
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

-- Sequência anual para numeração concorrente de OS
CREATE TABLE IF NOT EXISTS os_sequences (
  year INTEGER PRIMARY KEY,
  last_value INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS order_year INTEGER;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS order_sequence INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_orders_year_seq ON service_orders(order_year, order_sequence);

ALTER TABLE order_signatures ADD COLUMN IF NOT EXISTS key_count INTEGER;

-- Part numbers por modelo de terminal
CREATE TABLE IF NOT EXISTS part_numbers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  terminal_model_id UUID NOT NULL REFERENCES terminal_models(id) ON DELETE CASCADE,
  part_number TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_model_part_number UNIQUE (terminal_model_id, part_number)
);

CREATE INDEX IF NOT EXISTS idx_part_numbers_model ON part_numbers(terminal_model_id);

-- Sementes iniciais para os modelos existentes
INSERT INTO part_numbers (terminal_model_id, part_number)
SELECT tm.id, pn.part_number
FROM terminal_models tm
CROSS JOIN (
  VALUES
    ('D195', 'PN-D195-01'),
    ('D195', 'PN-D195-02'),
    ('S920', 'PN-S920-01'),
    ('S920', 'PN-S920-02'),
    ('Q92x', 'PN-Q92X-01'),
    ('Q92x', 'PN-Q92X-02'),
    ('A910', 'PN-A910-01'),
    ('A910', 'PN-A910-02'),
    ('P2',   'PN-P2-01'),
    ('P2',   'PN-P2-02')
) AS pn(model_name, part_number)
WHERE tm.name = pn.model_name
ON CONFLICT (terminal_model_id, part_number) DO NOTHING;

-- Tabela de registro persistente de ocorrências (ex: 2 tentativas incorretas de assinatura)
CREATE TABLE IF NOT EXISTS signature_occurrences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  order_code TEXT NOT NULL,
  user_id UUID REFERENCES users(id),
  user_name TEXT NOT NULL,
  error_type TEXT NOT NULL DEFAULT 'two_incorrect_attempts',
  attempt_count INTEGER NOT NULL DEFAULT 2,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  email_sent_at TIMESTAMPTZ,
  email_recipient TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signature_occurrences_order ON signature_occurrences(service_order_id);
CREATE INDEX IF NOT EXISTS idx_signature_occurrences_status ON signature_occurrences(status);

