# API (Express 5)

Node + Express 5 + `pg` + zod, ESM, sem etapa de build. Roda em `:3333` com `node --watch`.

## Schema e "migrações"

Não há ferramenta de migração. `src/db/schema.sql` é a fonte única e é reexecutado inteiro a cada `npm run db:setup`. Portanto, toda mudança deve ser idempotente e adicionada ao final:
- `CREATE ... IF NOT EXISTS`
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- `ALTER TYPE ... ADD VALUE IF NOT EXISTS`
- constraints dentro de `DO $$ ... EXCEPTION WHEN duplicate_object`

Nunca alterar instruções anteriores de forma que quebre bancos existentes.

## Autenticação e papéis

- `server.js` monta os routers. Tudo, exceto `/auth`, `/health` e `/time`, passa por `requireAuth` (JWT → recarrega o usuário do banco, rejeita inativos).
- Autorização por rota com `requireRole(...)`.
- Papéis: `admin`, `requester` (Operações), `stock` (Estoque), `signer` (Suporte), `spectator` (Produção, somente leitura).

## Rotas de OS (`src/routes/orders.js`)

- Contém toda a máquina de estados da OS (~1.6k linhas). Conferir o fluxograma citado no `CLAUDE.md` da raiz antes de mexer em transições.
- Rotas estáticas (`/divergent`, `/next-code`, `/counts`, `/occurrences`, `/all`, `/clear-all`) ficam declaradas antes de `/:id`. Rota estática nova também.
- Parâmetros `:id` passam por `rejectInvalidUuid` (`utils/validation.js`), para que IDs inválidos retornem 404 e não 500 do Postgres.
- Escritas com múltiplas instruções usam `withTransaction(client => ...)` de `db/pool.js`.
- Toda mudança de estado grava uma linha em `order_events` (`utils/audit.js` ou insert inline). O histórico da OS na UI é montado a partir dela; uma transição sem evento é bug.

## Hora oficial

- Nunca usar `new Date()` para timestamps de negócio. Usar `await networkNow()` de `utils/networkTime.js` (NTP.br via UDP, fallback no header `Date` de HTTPS, ressincroniza a cada 10 min).
- Se indisponível, lança `NetworkTimeUnavailableError`, que o handler global converte em 503.
- Códigos de OS `NN/AAAA` (`utils/orderCode.js`, tabela `os_sequences`) usam o ano de Brasília desse relógio.

## Assinatura (`POST /orders/:id/sign`)

- Dupla checagem cega por dois assinantes diferentes.
- Cada assinatura guarda um hash SHA-256 (`utils/signature.js`) de dados da OS + assinante + hora oficial + IP + UA.
- Contagens divergentes: descartam as duas assinaturas, incrementam `incorrect_signatures` e registram `signature_attempts`.
- A partir da 2ª tentativa incorreta: cria/atualiza `signature_occurrences` e envia e-mails de alerta (`services/emailService.js`, destinatários em `notification_emails`).

## Regra de sigilo: contagem de chaves

Somente `admin` pode ver valores de `key_count` (histórico de tentativas, ocorrências). Para os demais papéis, esses valores retornam `null`. Eles nunca podem aparecer em e-mails, descrições de ocorrência ou mensagens de evento. Preservar isso ao alterar essas consultas.

## Testes

- Não há linter nem framework de testes unitários.
- Testes são scripts em `test_*.mjs` usando `node:assert` + `fetch` contra a API rodando e o banco com seed. Eles criam dados reais.
- Rodar um teste: `node apps/api/test_stock_flow.mjs` (a variável `API_URL` sobrescreve `http://localhost:3333`).
- Arquivo de teste novo deve ser adicionado ao script `test` em `apps/api/package.json`.
