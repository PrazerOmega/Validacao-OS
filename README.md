# Ordens de Servico Digital

Aplicacao para criar, revisar, assinar digitalmente e manter historico de ordens de servico vinculadas ao uso autorizado de itens.

## Perfis

- `requester` (Operacoes): cria, edita e envia ordens para o estoque.
- `stock` (Estoque): marca a separacao de cada item (Pendente, Sem estoque, Em separacao, Separado), envia para assinatura ou devolve para operacoes.
- `signer` (Suporte): assina ordens pendentes ou solicita correcao.
- `spectator` (Producao): visualiza as ordens como guia para preparar os terminais.
- `admin`: gerencia usuarios e acompanha todas as ordens.

## Stack

- Node.js + Express
- React + Vite
- PostgreSQL

## Como rodar

1. Instale as dependencias:

```bash
npm install
```

2. Crie o banco com Docker:

```bash
docker compose up -d
```

3. Configure a API:

```bash
copy apps\api\.env.example apps\api\.env
```

4. Crie tabelas e usuarios iniciais:

```bash
npm run db:setup
```

5. Rode API e frontend:

```bash
npm run dev:api
npm run dev:web
```

API: `http://localhost:3333`

Web: `http://localhost:5173`

## Usuarios iniciais

Senha padrao: `123456`

- Admin: `admin@empresa.com`
- Solicitante: `solicitante@empresa.com`
- Assinante: `assinante@empresa.com`
- Estoque: `estoque@empresa.com`

## Fluxo principal

1. Operacoes cria ordem em rascunho.
2. Operacoes envia a ordem ao estoque (`awaiting_stock`).
3. Estoque marca a separacao de cada item. Com todos os itens separados, envia para assinatura; se faltar terminal, pode devolver para operacoes.
4. Suporte assina (duas assinaturas) ou pede correcao.
5. Operacoes corrige e reenvia (a ordem volta ao estoque).
6. Todas as mudancas geram eventos no historico.

## Assinatura digital

Nesta primeira versao, a assinatura gera um hash SHA-256 com os dados da ordem, usuario, data/hora, IP e user-agent. Esse registro cria trilha de auditoria. Para assinatura com validade juridica avancada, o proximo passo natural e integrar certificado ICP-Brasil ou provedor externo de assinatura.
