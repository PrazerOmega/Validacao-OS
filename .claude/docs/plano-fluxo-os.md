# Plano de implementação do fluxo-alvo da OS — Entregas 1 e 2

Referências: `fluxo-os.md` (processo-alvo), `decisoes-fluxo-os.md` (D1–D8), `gap-fluxo-os.md` (divergências).

Mapeamento: Customer = `requester` (Operações); Suporte = `signer`.

Decidido em 2026-11-09: durante o desenvolvimento, os fluxos atual (v1) e novo (v2) convivem por meio de **flag + versão gravada na OS** (`OS_FLOW_V2` + `flow_version`). Em produção, a flag fica desligada até a data de corte da D6.

> **Status deste documento:** as propostas A–D abaixo aguardam aprovação. Depois de aprovadas, devem ser registradas em `decisoes-fluxo-os.md` (resolvendo P2 e P6). Nada aqui foi implementado.

---

## Propostas para aprovação

### A. Origem e tipo na OS (P2)

- Duas colunas novas em `service_orders`, no mesmo padrão de `executor_team` (TEXT + CHECK em `DO $$`, nullable para não quebrar as OS existentes):
  - `request_origin`: `vendas_testes` | `diversos`
  - `terminal_type`: `producao` | `debug_chaves`
- TEXT + CHECK, e não enum, porque esse é o padrão atual e porque valores de enum adicionados não podem ser usados no mesmo script (`schema.sql:271-272`).
- A trilha é derivada dessas duas colunas e nunca gravada. A função `orderTrail(order)` retorna `A`/`B`/`C`/`D`/`null`.
- **`executor_team` vira campo legado derivado:** a API passa a gravá-lo a partir de `terminal_type` (`producao`→`producao`, `debug_chaves`→`suporte`). Assim, abas, filtros, dashboard e ocorrências que dependem dele continuam funcionando sem mudança. O formulário deixa de perguntar "Equipe executora".
  - Se o payload trouxer `executorTeam` incoerente com `terminalType`, a API responde 400.
  - Se trouxer só `executorTeam` (clientes e testes antigos), a API aceita e deixa origem e tipo nulos.
- As OS antigas não recebem backfill (D6: elas terminam no fluxo atual). A remoção de `executor_team` fica para depois da troca.
- Fora deste plano: a referência do pedido do Comercial (gap #16).

### B. Perfis novos (P6): valores de `user_role`

| Técnico | Rótulo | Observação |
|---|---|---|
| `expedition` | Expedição | Atua nas trilhas A/C (D2) |
| `receiving` | Recebimento | Atua nas trilhas B/D (D2) |
| `pcp` | PCP | D3 |
| `production` | Produção | Ator (D7). Perfil novo, em vez de dar ações ao `spectator` |

- `spectator` continua como perfil somente leitura, com o rótulo alterado para "Espectador".
- `stock` continua ativo até a troca, porque é usado só pelo fluxo v1.
- Os usuários `stock`/`spectator` reais precisam ser reatribuídos no corte.

### C. Status novos (P6)

Os nomes são genéricos para que a trilha D os reaproveite, com o Recebimento como ator.

| Técnico | Rótulo | Próximo ator |
|---|---|---|
| `awaiting_planning_release` | Assinada — aguardando liberação ao PCP | Customer |
| `awaiting_availability_check` | Aguardando conferência de disponibilidade | Expedição |
| `availability_checking` | Em conferência de disponibilidade | Expedição |
| `segregating` | Em segregação | Expedição |
| `awaiting_pcp_request` | Aguardando solicitação do PCP | PCP |
| `released_to_production` | Liberada para a Produção | Produção |
| `in_production` | Material na Produção | Produção |
| `line_processing` | Em processamento na linha | Produção |
| `returning_to_expedition` | Retornando à Expedição | Expedição |
| `completed` | Concluída (D8) | — |
| `rectification_required` | Aguardando retificação | Customer |
| `cancellation_required` | Aguardando cancelamento | Customer |

- Status reaproveitados com o mesmo significado: `draft`, `pending_signature` e `cancelled`.
- Os status `stock_*` e `signed` ficam restritos ao v1. Depois da troca, viram legados, como `divergent`.

### D. Correção pelo Suporte (gap #14): confirmar antes da Entrega 2

No fluxograma, a única volta é a retificação. A proposta é **manter `request-correction` no v2**, com o reenvio voltando a `pending_signature` (início da trilha C), e não ao estoque. Sem isso, o Suporte não tem como recusar uma OS errada.

---

## Entrega 1 — Base (sem mudar o fluxo)

**Objetivo:** a OS passa a registrar origem e tipo, e os quatro perfis novos passam a existir e a fazer login. O fluxo atual continua idêntico.

### Schema

Em `apps/api/src/db/schema.sql`, um bloco novo no final, idempotente:
- `ALTER TYPE user_role ADD VALUE IF NOT EXISTS` para `expedition`, `receiving`, `pcp` e `production`.
- `ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS` para `request_origin TEXT` e `terminal_type TEXT`.
- CHECKs em `DO $$ … EXCEPTION WHEN duplicate_object`.
- Índices com `CREATE INDEX IF NOT EXISTS`.

### API

- `utils/validation.js`: incluir os 4 papéis em `USER_ROLES`. Com isso, `users.js` passa a aceitá-los sem outra mudança.
- `db/setup.js`: criar os usuários seed `expedicao@`, `recebimento@`, `pcp@` e `producao@empresa.com`.
- `routes/orders.js`, com mudanças localizadas:
  - `orderSchema`/`orderUpdateSchema` ganham `requestOrigin`/`terminalType`, com aliases snake_case em `normalizeOrderBody`.
  - `executorTeam` passa a ser obrigatório só quando `terminalType` estiver ausente. A derivação e a verificação de coerência seguem a proposta A.
  - O INSERT do `POST /`, o UPDATE do `PUT /:id` (com `COALESCE`) e a mensagem e o metadata do evento "Criação" passam a incluir origem e tipo.
- **Correção de vazamento:** em `visibilityFilters` (`orders.js:188`) e no dashboard (`dashboard.js:16-29`), um papel desconhecido cai no ramo sem filtro e, portanto, vê tudo, como o admin.
  - Adicionar ramos explícitos: `expedition`, `receiving` e `pcp` não veem nada na Entrega 1 (`FALSE`); `production` vê o mesmo que o `spectator`.
  - Aplicar a mesma regra em `canSeeOrder`.

### Web

Em `apps/web/src/main.jsx`:
- `roleOptions` (`:108`): incluir os 4 papéis e mudar o rótulo de `spectator` para "Espectador".
- `OrderForm` (`:1279`): trocar o select "Equipe executora" (`:1389`) por "Origem da solicitação" e "Tipo de terminal", ambos obrigatórios. O estado inicial do formulário (`:154`, `:544`, `:624`) passa a enviar `requestOrigin`/`terminalType`.
- Exibir origem e tipo em `OrderDetails` (perto do `executor-pill`, `:3610`), em `OrderRow` (`:2972`) e na busca/exportação (`:4149`, `:4190`).

### Testes novos

`apps/api/test_order_classification.mjs`, adicionado ao script `test` de `apps/api/package.json`:
- criar com origem e tipo persiste os campos e deriva `executor_team`;
- valores inválidos e combinação incoerente com `executorTeam` retornam 400;
- payload antigo (só `executorTeam`) retorna 201, com origem e tipo nulos;
- `PUT` altera origem e tipo;
- os 4 seeds fazem login, e o admin cria usuário com cada papel novo;
- `expedition`, `receiving` e `pcp` recebem `GET /orders` vazio e dashboard com total 0; `GET /orders/:id` de OS alheia retorna 403.

### Critério de pronto

- `npm run db:setup` roda duas vezes seguidas, em banco novo e em banco existente, sem erro.
- `npm test` passa, incluindo os testes antigos sem alteração.
- O formulário cria a OS com origem e tipo, e o fluxo de estoque e assinatura se comporta como antes.
- Nenhum papel novo enxerga OS que não deveria.

---

## Entrega 2 — Trilha C (Vendas/Testes – Produção)

**Objetivo:** as OS da trilha C criadas com a flag ligada percorrem o fluxograma inteiro:
"Realizar a OS" → assinatura dupla → liberação ao PCP → conferência e segregação pela Expedição → solicitação do PCP → Produção (recebe, processa e devolve) → Expedição confirma o retorno → `completed`.

A entrega inclui cancelamento e retificação.

**Pré-requisito:** aprovação das propostas A–D.

### Convivência v1/v2

- Nova variável `OS_FLOW_V2` em `apps/api/.env.example`, com padrão `false`. **Avisar** que é preciso copiá-la para o `.env` com valor `true` no ambiente de desenvolvimento, para rodar os testes.
- Nova coluna `flow_version TEXT NOT NULL DEFAULT 'v1'`, com CHECK (`v1`/`v2`), gravada no `POST /`:
  - recebe `v2` se a flag estiver ligada **e** `orderTrail()` estiver em `V2_TRAILS = ['C']`;
  - caso contrário, recebe `v1`;
  - a versão não muda depois da criação.
- Os endpoints novos exigem `flow_version = 'v2'`. Os endpoints `stock/*` e `stock-return/*` passam a exigir `v1`. Fora dessas condições, a resposta é 409.

### Schema

Bloco novo no final do `schema.sql`:
- `ADD VALUE IF NOT EXISTS` para os 12 status da proposta C.
- Colunas `flow_version`, `new_terminals_in_stock BOOLEAN`, `cancellation_reason TEXT`, `cancelled_at TIMESTAMPTZ` e `completed_at TIMESTAMPTZ`.
- A conferência reaproveita as colunas existentes: `stock_result` (`complete`/`shortage`), `stock_checker_id`, `stock_checked_at` e os campos `stock_*` de `order_items`.

### API: transições

Regras para todas as transições:
- usar `transitionStatus` (`orders.js:1036`);
- gravar um evento em `order_events` por transição;
- obter os timestamps de negócio com `networkNow()`.

| De | Endpoint | Papel | Para |
|---|---|---|---|
| `draft` | `POST /:id/submit` (já existe; ramifica por `flow_version`) | requester/admin | `pending_signature` |
| `pending_signature` | `POST /:id/sign` (já existe; na 2ª assinatura, o v2 vai para o novo status em vez de `signed`. Double check, ocorrências e sigilo de `key_count` não mudam, D5) | signer | `awaiting_planning_release` |
| `awaiting_planning_release` | `POST /:id/planning-release`: informa o PCP e solicita terminais à Expedição. Envia e-mail aos usuários `pcp` ativos com uma função nova em `services/emailService.js`; falha de e-mail não bloqueia, como em `triggerAutomaticNotification` | requester dono/admin | `awaiting_availability_check` |
| `awaiting_availability_check` | `POST /:id/availability/start` | expedition (trilha C) | `availability_checking` |
| `availability_checking` | `POST /:id/availability/check` `{result: available\|unavailable, items[], newTerminalsInStock?}`. Reaproveita a validação de linhas do `stock/check` (`orders.js:1087-1142`), extraída para uma função local no mesmo arquivo | expedition | `segregating` / `rectification_required` (há terminais novos) / `cancellation_required` (não há) |
| `segregating` | `POST /:id/availability/segregate` | expedition | `awaiting_pcp_request` |
| `awaiting_pcp_request` | `POST /:id/pcp/request-material` | pcp | `released_to_production` |
| `released_to_production` | `POST /:id/production/receive` | production | `in_production` |
| `in_production` | `POST /:id/production/start-line` | production | `line_processing` |
| `line_processing` | `POST /:id/production/finish-line` | production | `returning_to_expedition` |
| `returning_to_expedition` | `POST /:id/expedition/confirm-return` (grava `completed_at`) | expedition | `completed` |
| `rectification_required` | `POST /:id/rectify`: limpa as assinaturas (`order_signatures`, `signer_id`, `second_signer_id`, como em `request-correction`) e a conferência (`clearStockItemCheck`) | requester dono/admin | `draft` → edição pelo `PUT` → `submit` |
| `cancellation_required` | `POST /:id/cancel` `{reason}` (mínimo de 5 caracteres; grava `cancellation_reason` e `cancelled_at`) | requester dono/admin | `cancelled` |

- O ator da conferência vem do helper `availabilityRoleFor(order)`: trilha C → `expedition`. O helper já fica preparado para a trilha D (`receiving`).
- **Visibilidade** (`canSeeOrder`, `visibilityFilters`, `dashboard.js`):
  - `expedition`: status de conferência e de segregação, `returning_to_expedition` e as OS que ela conferiu;
  - `pcp`: OS v2 a partir de `awaiting_availability_check`;
  - `production`: OS a partir de `released_to_production`;
  - `stock`: restrito a `flow_version = 'v1'`;
  - `signer` e `spectator`: sem mudança.
- **Dashboard:** novos contadores `completed`, `cancelled` e "em produção" (soma de `released_to_production`, `in_production` e `line_processing`).

### Web

Alterações localizadas em `main.jsx`:
- `statusLabels`/`statusIcons` (`:49`, `:62`): incluir os status novos.
- `OrderDetails` (flags em `:3463-3473`): ações por papel e status no v2, com componentes novos dentro do próprio `main.jsx`:
  - botão "Liberar para planejamento" para o Customer;
  - `StockCheckPanel` (`:3121`) reaproveitado com uma prop de modo v2: resultado Disponível/Indisponível e a pergunta "Há terminais novos em estoque?";
  - botões de segregação, do PCP, da Produção e de confirmação de retorno;
  - diálogo de cancelamento com motivo obrigatório e confirmação de retificação.
- `StockReturnDecisionPanel` não aparece no v2.
- Toda ação chama `notifyRealtimeSync`.
- `DashboardPanel` (`:1633`): grupos por setor para Expedição, PCP e Produção.

### Testes novos

`apps/api/test_trilha_c_flow.mjs`, adicionado ao script `test`. O teste exige a API rodando com `OS_FLOW_V2=true`; se a OS criada vier como `v1`, ele falha com uma mensagem que explica a flag.

1. Caminho feliz completo: status esperado em cada passo, um evento por transição e `completed_at` preenchido.
2. Em cada passo: papel errado retorna 403, status errado retorna 409 e ação repetida retorna 409 (concorrência).
3. Assinatura divergente no v2 mantém a OS em `pending_signature`, com a tentativa registrada. O par de assinaturas correto leva a `awaiting_planning_release`, e não a `signed`.
4. Retificação: `unavailable` + `newTerminalsInStock=true` → `rectification_required` → `rectify` → `draft` sem assinaturas → `PUT` → `submit` → `pending_signature`.
5. Cancelamento: `unavailable` + `false` → `cancellation_required`. Cancelar sem motivo retorna 400; com motivo, a OS vai para `cancelled` e as ações seguintes retornam 409.
6. Isolamento: OS de outra trilha, ou sem classificação, nasce `v1` e segue o fluxo de estoque. Endpoints v2 em OS v1 retornam 409, e vice-versa.
7. Visibilidade:
   - a Expedição não vê a OS em `pending_signature`;
   - o PCP vê a partir da liberação;
   - a Produção vê a partir de `released_to_production`;
   - `key_count` continua oculto para quem não é admin.

### Critério de pronto

- `db:setup` continua idempotente.
- `npm test` passa com `OS_FLOW_V2=true`, com os testes antigos inalterados (eles criam OS v1).
- Com a flag desligada, a OS da trilha C nasce v1 e segue o fluxo atual.
- Percurso manual na UI com os seeds, do "Realizar a OS" até `completed`, mais um cancelamento e uma retificação.
- Histórico da OS completo: nenhuma transição sem evento.
