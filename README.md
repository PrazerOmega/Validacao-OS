# Ordens de Servico Digital

Aplicacao para criar, revisar, assinar digitalmente e manter historico de ordens de servico vinculadas ao uso autorizado de itens.

## Perfis

- `requester` (Operacoes): cria, edita e envia ordens para o estoque.
- `stock` (Estoque): confere a quantidade de cada linha de item e os acessorios que acompanham o terminal (bateria, carregador, etc.), registra o resultado (completo, parcial ou pendencia de estoque) e libera a ordem ao suporte.
- `signer` (Suporte): assina ordens pendentes ou solicita correcao.
- `spectator` (Producao): visualiza as ordens como guia para preparar os terminais, sem poder alterar.
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
- Assinante 2: `assinante2@empresa.com`
- Espectador: `espectador@empresa.com`
- Estoque: `estoque@empresa.com`

## Fluxo principal

1. Operacoes cria ordem em rascunho.
2. Operacoes envia a ordem; toda OS (suporte ou producao) vai para o estoque (`awaiting_stock_check`).
3. Estoque inicia a conferencia (`stock_checking`) e registra, por linha, a quantidade conferida, observacoes e os acessorios que acompanham o terminal.
   - Resultado **completo**: a ordem vai para separacao (`stock_picking`) e, ao liberar, segue para assinatura (`pending_signature`). Completo nao e aceito com item faltando.
   - Resultado **parcial** ou **pendencia de estoque**: a ordem volta para Operacoes (`stock_returned`).
4. Com a ordem em retorno do estoque, Operacoes pode: encaminhar ao suporte com justificativa obrigatoria (registrada no historico), devolver ao estoque para nova conferencia ou editar a OS (volta a rascunho).
5. Suporte assina (duas assinaturas) ou pede correcao.
6. Operacoes corrige e reenvia; a ordem passa de novo pelo estoque.
7. Todas as mudancas geram eventos no historico.

## Testes

Com a API rodando (`npm run dev:api`) e o banco preparado (`npm run db:setup`):

```bash
npm test
```

## Assinatura digital

Nesta primeira versao, a assinatura gera um hash SHA-256 com os dados da ordem, usuario, data/hora, IP e user-agent. Esse registro cria trilha de auditoria. Para assinatura com validade juridica avancada, o proximo passo natural e integrar certificado ICP-Brasil ou provedor externo de assinatura.
