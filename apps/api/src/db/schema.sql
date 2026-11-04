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

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS packaging TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS battery TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS terminal_opening TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS manual TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS charger TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS minbase TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS aesthetic_cover TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS item_index INTEGER DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_packaging_check
    CHECK (packaging IS NULL OR packaging IN ('CAIXA', 'SACO BOLHA'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_battery_check
    CHECK (battery IS NULL OR battery IN ('SIM', 'NÃO'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_terminal_opening_check
    CHECK (terminal_opening IS NULL OR terminal_opening IN ('SIM', 'NÃO'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_manual_check
    CHECK (manual IS NULL OR manual IN ('SIM', 'NÃO'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_charger_check
    CHECK (charger IS NULL OR charger IN ('SIM', 'NÃO'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_minbase_check
    CHECK (minbase IS NULL OR minbase IN ('SIM', 'NÃO'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_label_check
    CHECK (label IS NULL OR label IN ('SIM', 'NÃO'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_aesthetic_cover_check
    CHECK (aesthetic_cover IS NULL OR aesthetic_cover IN ('SIM', 'NÃO'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

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
-- Garante no máximo uma ocorrência ativa (não resolvida) por OS, mesmo com requisições simultâneas
CREATE UNIQUE INDEX IF NOT EXISTS uq_signature_occurrences_active_order
  ON signature_occurrences(service_order_id)
  WHERE status <> 'resolved';


-- Perfil Estoque: conferência de material antes da assinatura do Suporte.
-- Os novos valores de enum não são usados neste script, pois só ficam disponíveis após o commit.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'stock';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'awaiting_stock_check';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'stock_checking';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'stock_picking';
ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'stock_returned';

ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS stock_result TEXT;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS stock_accessories_note TEXT;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS stock_checker_id UUID REFERENCES users(id);
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS stock_checked_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE service_orders ADD CONSTRAINT service_orders_stock_result_check
    CHECK (stock_result IS NULL OR stock_result IN ('complete', 'partial', 'shortage'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_checked_quantity INTEGER;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_note TEXT;

DO $$ BEGIN
  ALTER TABLE order_items ADD CONSTRAINT order_items_stock_checked_quantity_check
    CHECK (stock_checked_quantity IS NULL OR stock_checked_quantity >= 0);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Acessórios que o Estoque confirmou que acompanham cada linha de terminal
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_accessories TEXT[];

-- E-mails cadastrados pelo admin que recebem automaticamente os alertas de ocorrências
CREATE TABLE IF NOT EXISTS notification_emails (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_emails_email ON notification_emails(LOWER(email));

-- Histórico de cada tentativa incorreta de assinatura: quem foi o 1º e o 2º assinante
-- e quantas chaves cada um informou. As quantidades só são exibidas para administradores.
CREATE TABLE IF NOT EXISTS signature_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_order_id UUID NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  error_type TEXT NOT NULL,
  first_signer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  first_signer_name TEXT,
  first_key_count INTEGER,
  second_signer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  second_signer_name TEXT,
  second_key_count INTEGER,
  reported_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reported_by_name TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signature_attempts_order ON signature_attempts(service_order_id, attempt_number);
