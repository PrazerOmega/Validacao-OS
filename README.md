# Ordens de Servico Digital

Aplicacao para criar, revisar, assinar digitalmente e manter historico de ordens de servico vinculadas ao uso autorizado de itens.

## Perfis

- `requester`: cria, edita e envia ordens para assinatura.
- `signer`: assina ordens pendentes ou solicita correcao.
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

## Fluxo principal

1. Solicitante cria ordem em rascunho.
2. Solicitante envia a ordem para assinatura.
3. Assinante pode assinar ou pedir correcao.
4. Solicitante corrige e reenvia.
5. Todas as mudancas geram eventos no historico.

## Assinatura digital

Nesta primeira versao, a assinatura gera um hash SHA-256 com os dados da ordem, usuario, data/hora, IP e user-agent. Esse registro cria trilha de auditoria. Para assinatura com validade juridica avancada, o proximo passo natural e integrar certificado ICP-Brasil ou provedor externo de assinatura.
