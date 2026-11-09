# Ordens de Serviço Digital

Sistema para criar, conferir estoque, assinar em dupla checagem e auditar ordens de serviço (OS) de terminais/itens.

Monorepo com npm workspaces:
- `apps/api` — Node + Express 5 + `pg` + zod, ESM, sem build. Regras em `apps/api/CLAUDE.md`.
- `apps/web` — React 19 + Vite, JSX puro. Regras em `apps/web/CLAUDE.md`.
- PostgreSQL 16 e Mailpit rodam via Docker.
- `.claude/docs/` — fluxogramas de referência.

## Comandos

Tudo na raiz. Requer Node ≥ 22.15 (por causa de `--use-system-ca`) e Docker Desktop rodando.

```bash
npm install
docker compose up -d                      # postgres :5432, mailpit SMTP :1025 / UI :8025
cp apps/api/.env.example apps/api/.env    # variáveis novas no .env.example precisam ser copiadas manualmente
npm run db:setup                          # idempotente: aplica schema.sql + upsert dos usuários seed
npm run dev                               # API :3333 + web :5173
npm run dev:api | npm run dev:web
npm run build                             # web → apps/web/dist (Firebase Hosting via firebase.json)
npm test                                  # testes de integração da API (exigem API rodando e banco com seed)
```

Usuários seed (senha `123456`, domínio `@empresa.com`): `admin`, `solicitante` (requester), `assinante` / `assinante2` (signer), `espectador` (spectator), `estoque` (stock).

## Fluxo da OS

O processo-alvo da OS está em `.claude/docs/fluxo-os.md` (transcrição de `fluxo-os.png`). O sistema está em transição para segui-lo: o código atual implementa um fluxo diferente, descrito no resumo abaixo.

- Antes de alterar status, transições ou permissões por papel (API ou web), ler `.claude/docs/fluxo-os.md`.
- Funcionalidade nova de fluxo segue o fluxograma, não o comportamento atual.
- Não alinhar ao fluxograma partes do código fora do escopo da tarefa. Se a tarefa tocar uma divergência conhecida, apontá-la e perguntar antes de mudar.
- O fluxograma não define detalhes de sistema (nomes de status, campos, papéis). Seguir as decisões registradas em `.claude/docs/decisoes-fluxo-os.md`; o que não estiver decidido ali, perguntar.
- Divergências mapeadas entre código atual e alvo: `.claude/docs/gap-fluxo-os.md`.
- Regras de negócio do comportamento atual: README, seção 3.

Resumo dos status (comportamento ATUAL do código):
`draft` → submit → `awaiting_stock_check` → `stock_checking` → (completa) `stock_picking` → release → `pending_signature` → `signed`.
Conferência parcial/pendente → `stock_returned`, onde o solicitante encaminha aos assinantes (justificativa obrigatória), devolve ao estoque (limpa a conferência anterior) ou edita (volta a `draft`).
Assinante pode pedir correção → `correction_requested` → solicitante reenvia, sempre passando pelo estoque de novo.
`divergent` é legado. `executor_team` (`producao` / `suporte`) só separa listagens/abas; o fluxo é o mesmo.

## Regras gerais

- Textos de UI, comentários, mensagens de commit e README em português (pt-BR).
- Usar somente `npm`. Não gerar outro lockfile.
- Datas e horários de negócio vêm sempre do relógio oficial, nunca de `new Date()` / `Date.now()`. Detalhes em cada app.
- Não editar arquivos `.env`. Variável nova vai no `.env.example` e deve ser avisada.
- `apps/api/src/routes/orders.js` e `apps/web/src/main.jsx` são arquivos grandes. Fazer alterações localizadas; não dividir nem refatorar sem pedido explícito.
- Ao concluir alteração na API, rodar `npm test` (cria dados reais no banco de desenvolvimento).
