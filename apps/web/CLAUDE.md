# Web (React 19 + Vite)

JSX puro, sem router e sem biblioteca de estado. Roda em `:5173`.

## Organização

- Quase todo o app está em `src/main.jsx` (~4.3k linhas). `App` guarda sessão e estado; os painéis (`OrderForm`, `OrderDetails`, `StockCheckPanel`, `StockReturnDecisionPanel`, `OccurrencesPanel`, `DashboardPanel`, `AdminConsole`, …) são componentes no mesmo arquivo.
- Estilos em `src/styles.css`, arquivo único. Tema claro/escuro via `app_theme` no localStorage.
- Seguir esse padrão. Não criar router, biblioteca de estado nem novos arquivos de componente sem pedido explícito.

## Comunicação com a API

- `useApi(session, onUnauthorized)` encapsula o `fetch` para `VITE_API_URL` (padrão `http://localhost:3333`) com o token bearer. Toda chamada à API passa por ele.
- Sessão fica no localStorage em `ordens:session`.
- Abas do mesmo navegador sincronizam via `BroadcastChannel` (`notifyRealtimeSync`). Ações que alteram uma OS devem notificar.
- Para acessar de outra máquina da rede local: `VITE_API_URL=http://<ip>:3333`. O CORS da API já aceita localhost, faixas privadas de LAN e `CORS_ORIGIN`.

## Hora oficial

`src/officialTime.js` espelha o relógio do servidor via `GET /time`. Usar `officialNow()` / `todayKey()` em vez de `Date.now()` em qualquer coisa relacionada a data.

## Fluxo da OS na interface

Os botões e painéis disponíveis dependem do status da OS e do papel do usuário. Ao alterar o que cada papel pode fazer em cada status, conferir o fluxograma citado no `CLAUDE.md` da raiz. A API é quem garante as permissões; a UI apenas reflete.
