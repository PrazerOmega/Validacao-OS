# Ordens de Serviço Digital (Validação de OS)

Aplicação para criar, conferir, assinar digitalmente e manter o histórico de ordens de serviço (OS) vinculadas ao uso autorizado de terminais e itens.

Este guia está dividido em três partes:

1. [Instalação e execução](#1-instalação-e-execução): como preparar a máquina e colocar o sistema no ar.
2. [Perfis de acesso](#2-perfis-de-acesso): quem faz o quê.
3. [Fluxo completo de uma OS](#3-fluxo-completo-de-uma-os): o passo a passo de todas as etapas, do rascunho à aprovação.

---

## Stack

| Camada    | Tecnologia                                   |
| --------- | -------------------------------------------- |
| API       | Node.js + Express (`apps/api`)               |
| Web       | React + Vite (`apps/web`)                    |
| Banco     | PostgreSQL 16 (via Docker)                   |
| E-mail    | Nodemailer + Mailpit (SMTP de teste local)   |
| Hora      | NTP.br (hora oficial de Brasília pela rede)  |

---

## 1. Instalação e execução

### 1.1 Pré-requisitos

- **Node.js 22.15 ou superior** (recomendado: 24). A API usa a opção `--use-system-ca`, que não existe em versões anteriores.
- **Docker Desktop** instalado **e aberto**: o banco e o servidor de e-mail de teste rodam em containers.
- **Git**, para clonar e atualizar o projeto.

### 1.2 Baixar o projeto

```bash
git clone <url-do-repositorio>
cd Validacao-OS
```

Se o projeto já estiver na máquina, basta atualizar:

```bash
git pull
```

### 1.3 Instalar as dependências

Na raiz do projeto (instala API e Web de uma vez, pois é um monorepo com workspaces):

```bash
npm install
```

> Rode `npm install` de novo sempre que um `git pull` alterar algum `package.json`.

### 1.4 Subir o banco de dados e o e-mail de teste

Com o Docker Desktop aberto:

```bash
docker compose up -d
```

Isso cria dois containers:

| Container                  | Para quê                                   | Endereço                  |
| -------------------------- | ------------------------------------------ | ------------------------- |
| `ordens_servico_postgres`  | Banco PostgreSQL                           | `localhost:5432`          |
| `ordens_servico_mailpit`   | Caixa de entrada dos e-mails de teste      | http://localhost:8025     |

> Se aparecer o erro `failed to connect to the docker API`, o Docker Desktop não está aberto. Abra-o, espere ele terminar de iniciar e repita o comando.

### 1.5 Configurar as variáveis de ambiente da API

Copie o arquivo de exemplo:

```bash
# Windows (cmd / PowerShell)
copy apps\api\.env.example apps\api\.env

# Linux / macOS / Git Bash
cp apps/api/.env.example apps/api/.env
```

O que cada variável faz:

| Variável        | Descrição                                                                 |
| --------------- | ------------------------------------------------------------------------- |
| `PORT`          | Porta da API (padrão `3333`).                                             |
| `DATABASE_URL`  | Conexão com o PostgreSQL (já aponta para o container do Docker).          |
| `JWT_SECRET`    | Segredo dos tokens de login. **Troque em produção.** Sem ele a API não sobe. |
| `CORS_ORIGIN`   | Endereço(s) do frontend autorizados a chamar a API.                       |
| `NTP_SERVERS`   | Servidores de hora oficial (NTP.br).                                      |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` | Servidor de envio de e-mail. Os valores de exemplo usam o Mailpit local. |
| `SMTP_FROM`     | Remetente dos e-mails de alerta.                                          |

> Ao atualizar o projeto, compare seu `.env` com o `.env.example`: variáveis novas precisam ser copiadas manualmente.

### 1.6 Criar as tabelas e os usuários iniciais

```bash
npm run db:setup
```

Deve aparecer `Banco configurado com sucesso.`. O comando pode ser executado novamente sem perder dados: ele só cria o que estiver faltando e reativa os usuários iniciais.

### 1.7 Rodar o sistema

API e Web juntas, num único terminal:

```bash
npm run dev
```

Ou separadas, em dois terminais:

```bash
npm run dev:api
npm run dev:web
```

| Serviço          | Endereço                    |
| ---------------- | --------------------------- |
| Web (sistema)    | http://localhost:5173       |
| API              | http://localhost:3333       |
| Saúde da API     | http://localhost:3333/health |
| E-mails (Mailpit)| http://localhost:8025       |

Ao iniciar, a API mostra `API ouvindo em http://localhost:3333` e, logo depois, a sincronização da hora oficial (`[Hora oficial] sincronizada via ntp:a.ntp.br`).

> **Acesso por outros computadores da rede:** o Vite já publica na rede local (endereços `Network:` exibidos no terminal). Nesse caso, defina `VITE_API_URL=http://<ip-da-maquina>:3333` para o frontend encontrar a API.

### 1.8 Usuários iniciais

Senha padrão de todos: **`123456`**

| Perfil      | E-mail                     |
| ----------- | -------------------------- |
| Admin       | `admin@empresa.com`        |
| Operações   | `solicitante@empresa.com`  |
| Suporte     | `assinante@empresa.com`    |
| Suporte 2   | `assinante2@empresa.com`   |
| Produção    | `espectador@empresa.com`   |
| Estoque     | `estoque@empresa.com`      |

> São necessários **dois** usuários de Suporte diferentes para concluir uma assinatura (double check).

### 1.9 Testes automatizados

Com a API rodando e o banco preparado:

```bash
npm test
```

### 1.10 Build e publicação do frontend

```bash
npm run build
```

Gera os arquivos em `apps/web/dist`. O `firebase.json` já está configurado para publicar essa pasta no Firebase Hosting (`firebase deploy`). A API precisa estar hospedada separadamente e acessível pelo `VITE_API_URL` usado no build.

### 1.11 Parar tudo

- Servidores de desenvolvimento: `Ctrl + C` no terminal.
- Containers: `docker compose down` (os dados do banco são mantidos no volume `postgres_data`).

---

## 2. Perfis de acesso

| Perfil (código)        | Nome na tela | O que pode fazer |
| ---------------------- | ------------ | ---------------- |
| `requester`            | Operações    | Cria, edita e envia OS. Decide o que fazer quando o Estoque devolve uma OS. Corrige OS devolvidas pelo Suporte. Vê apenas as próprias OS. |
| `stock`                | Estoque      | Confere a quantidade de cada item e os acessórios, registra o resultado da conferência e libera a OS para o Suporte. |
| `signer`               | Suporte      | Assina as OS (double check com dois assinantes) ou devolve para correção. Acompanha as ocorrências de assinatura. |
| `spectator`            | Produção     | Apenas visualiza as OS (exceto rascunhos), como guia para preparar os terminais. Não altera nada. |
| `admin`                | Admin        | Vê tudo. Gerencia usuários, catálogos (tipos de OS, modelos de terminal, part numbers), e-mails de alerta e ocorrências. Pode invalidar assinaturas de OS já aprovadas. |

---

## 3. Fluxo completo de uma OS

### Visão geral

```
 Operações            Estoque                            Suporte (2 assinantes)
 ─────────            ───────                            ──────────────────────
 Rascunho ──Enviar──► Aguardando conferência
                         │ Iniciar conferência
                         ▼
                      Em conferência
                         │
            ┌────────────┴─────────────┐
       Completo                Parcial / Pendência
            ▼                          ▼
      Em separação             Retorno do estoque ──► Operações decide:
            │ Liberar                                  • encaminhar ao Suporte (com justificativa)
            ▼                                          • devolver ao Estoque (nova conferência)
   Pendente validação ◄────────────────────────────── • editar a OS (volta a rascunho)
            │
   1ª assinatura ─► 2ª assinatura
            │
   ┌────────┴──────────────┐
 Chaves iguais        Chaves diferentes
   ▼                       ▼
 Aprovada            Assinatura incorreta → volta a "Pendente validação"
                     (2ª tentativa incorreta gera uma Ocorrência + e-mail de alerta)

 Suporte pode também "Solicitar correção" → Aguardando correção → Operações corrige e reenvia
```

### Situações (status) da OS

| Código                  | Nome na tela            | Quem age    |
| ----------------------- | ----------------------- | ----------- |
| `draft`                 | Rascunho                | Operações   |
| `awaiting_stock_check`  | Aguardando conferência  | Estoque     |
| `stock_checking`        | Em conferência          | Estoque     |
| `stock_picking`         | Em separação            | Estoque     |
| `stock_returned`        | Retorno do estoque      | Operações   |
| `pending_signature`     | Pendente validação      | Suporte     |
| `correction_requested`  | Aguardando correção     | Operações   |
| `signed`                | Aprovada                | —           |
| `divergent`             | Divergente (legado)     | Operações / Suporte |
| `cancelled`             | Cancelada               | —           |

### Etapa 1 — Criar a OS (Operações)

1. Entre com um usuário de **Operações**.
2. Clique em **Nova ordem**.
3. Preencha:
   - **Tipo da ordem** (Reparo, Atualização, Teste ou outros cadastrados pelo admin).
   - **Equipe executora**: **Produção** ou **Suporte**. Isso define em qual aba a OS aparece ("Requisições para Produção" / "Requisições para Suporte").
   - **Itens**: modelo do terminal, part number, quantidade e os acessórios que devem acompanhar (bateria, carregador, manual, minbase, label, cobre estético, embalagem).
4. Salve. A OS fica como **Rascunho** e pode ser editada à vontade.

**Numeração:** cada OS recebe um código no formato `NN/AAAA` (ex.: `01/2026`). A sequência reinicia todo ano, e o ano é calculado pela **hora oficial de Brasília**, nunca pelo relógio do computador.

### Etapa 2 — Enviar para o Estoque (Operações)

1. Abra o rascunho e clique em **Enviar**.
2. A OS passa para **Aguardando conferência**.

> Toda OS, seja de Produção ou de Suporte, passa obrigatoriamente pelo Estoque, inclusive quando é reenviada após uma correção.

### Etapa 3 — Conferência do Estoque (Estoque)

1. Entre com o usuário de **Estoque**. As OS aguardando aparecem priorizadas no painel.
2. Abra a OS e clique em **Iniciar conferência**. A situação muda para **Em conferência** e a OS fica reservada para você.
3. Para **cada linha de item**, informe:
   - a **quantidade conferida** (não pode ser maior que a solicitada);
   - os **acessórios** que vão junto com o terminal;
   - observações, se houver.
4. Escolha o **resultado**:
   - **Completo**: tudo foi encontrado. Só é aceito se nenhuma linha estiver com falta.
   - **Parcial**: parte dos itens foi encontrada.
   - **Pendência de estoque**: há itens indisponíveis.
5. Registre a conferência:
   - **Completo** → a OS vai para **Em separação** (siga para a etapa 4).
   - **Parcial / Pendência** → a OS volta para Operações como **Retorno do estoque** (siga para a etapa 5).

### Etapa 4 — Separação e liberação (Estoque)

1. Separe fisicamente o material.
2. Clique em **Liberar**. A OS passa para **Pendente validação** e fica disponível para o Suporte assinar.

### Etapa 5 — Retorno do estoque (Operações)

Quando o Estoque registra conferência parcial ou pendência, Operações escolhe uma das opções:

| Opção                       | O que acontece |
| --------------------------- | -------------- |
| **Encaminhar ao Suporte**   | A OS segue para **Pendente validação** mesmo incompleta. A **justificativa é obrigatória** e fica gravada no histórico. |
| **Devolver ao Estoque**     | A conferência anterior é apagada e a OS volta para **Aguardando conferência**, para ser conferida de novo (ex.: o material chegou). |
| **Editar a OS**             | A OS volta para **Rascunho** para ajustar itens/quantidades. Depois, é enviada de novo (etapa 2). |

### Etapa 6 — Assinatura com double check (Suporte)

A assinatura exige **dois usuários diferentes do Suporte**, e cada um conta as chaves **sem ver o número informado pelo outro** (double check cego).

1. O **1º assinante** abre a OS em **Pendente validação**, informa a **quantidade de chaves** e assina.
2. O **2º assinante** (outro usuário) faz o mesmo, informando a quantidade que contou.
3. O sistema compara as duas quantidades:
   - **Iguais** → a OS fica **Aprovada**. ✅
   - **Diferentes** → é registrada uma **assinatura incorreta**: as duas assinaturas são descartadas e a OS volta para **Pendente validação** para uma nova tentativa.

Cada assinatura gera um **hash SHA-256** com os dados da OS, o usuário (identificado pelo e-mail de login), a data/hora oficial, o IP e o navegador. Isso forma a trilha de auditoria.

**Outras ações do Suporte nesta etapa:**

- **Solicitar correção**: devolve a OS para Operações com a descrição do que precisa ser ajustado. A situação muda para **Aguardando correção** e as assinaturas já feitas são descartadas.
- **Apontar assinatura incorreta**: marca manualmente que uma assinatura está errada (com motivo). A OS volta para **Pendente validação**. Em OS já **Aprovada**, somente o **Admin** pode fazer isso.

### Etapa 7 — Correção (Operações)

1. A OS aparece como **Aguardando correção**, com a mensagem do Suporte no histórico.
2. Operações edita o que foi pedido e clica em **Enviar**.
3. A OS recomeça na **etapa 2**: passa novamente pelo Estoque e depois pelo Suporte.

### Etapa 8 — Ocorrências de assinatura incorreta (Admin / Suporte)

Quando uma mesma OS acumula **2 ou mais tentativas incorretas de assinatura**, o sistema:

1. Cria (ou atualiza) uma **Ocorrência** para aquela OS, com situação **Pendente**.
2. Envia **automaticamente um e-mail de alerta** para todos os endereços cadastrados pelo admin. Ao enviar, a ocorrência passa para **E-mail enviado**.

> Por segurança do double check, nem a descrição da ocorrência nem o e-mail mostram as quantidades de chaves. Só o **Admin** vê, na tela de ocorrências, quantas chaves cada assinante informou.

**Para tratar uma ocorrência:**

1. Acesse o menu **Ocorrências**.
2. Use os cards de resumo ou as abas (Todas / Pendentes / Notificadas / Resolvidas) e a busca (por OS, usuário ou motivo) para encontrar a ocorrência.
3. Clique no card para **expandir** e ver:
   - a descrição completa;
   - tipo da ordem, equipe executora, situação da OS, solicitante, usuário envolvido, data do registro e envio de e-mail;
   - o **histórico das tentativas incorretas** (1º e 2º assinante de cada tentativa, e as chaves informadas — apenas para o admin).
   Use **Expandir todas / Recolher todas** para abrir ou fechar a lista inteira.
4. Ações disponíveis:
   - **E-mail**: prepara e reenvia o alerta, opcionalmente para outro destinatário.
   - **Resolver**: encerra a ocorrência após a apuração.
   - **Abrir OS**: abre os detalhes da ordem.

**Cadastrar quem recebe os alertas (Admin):** no topo da tela de Ocorrências, no cartão de e-mails de notificação, adicione ou remova os endereços. Sem nenhum e-mail cadastrado, os alertas automáticos não são enviados.

> Em ambiente local, os e-mails não saem para a internet: eles chegam no Mailpit, em http://localhost:8025.

### Etapa 9 — Acompanhamento e histórico (todos)

- **Dashboard**: métricas agrupadas por setor responsável (Operações, Estoque, Suporte), em seções que podem ser recolhidas. Cada perfil vê apenas os números das OS que lhe dizem respeito. Para o Estoque, a seção do Estoque aparece primeiro.
- **Abas por equipe**: a lista de OS é separada em **Requisições para Produção** e **Requisições para Suporte**, com contadores.
- **Histórico da OS**: toda mudança (envio, conferência, decisões, assinaturas, correções, tentativas incorretas, e-mails) fica registrada na OS com data, hora oficial e autor.
- **Produção** acompanha as OS em modo somente leitura para preparar os terminais.

### Administração (Admin)

- **Usuários**: criar, editar (nome, e-mail, perfil, senha), ativar ou desativar.
- **Catálogos**: cadastrar tipos de ordem, modelos de terminal e part numbers usados no formulário da OS.
- **Ocorrências** e **e-mails de alerta**: veja a etapa 8.

---

## Hora oficial

Todas as datas do sistema (numeração anual, assinaturas, histórico, ocorrências) usam a **hora oficial de Brasília**, obtida da rede pelo **NTP.br** (Observatório Nacional), nunca do relógio do computador. A API ressincroniza a cada 10 minutos. Se não conseguir obter a hora oficial, as operações que dependem dela respondem com erro em vez de gravar um horário errado. Para consultar a hora em uso: http://localhost:3333/time.

## Assinatura digital

Nesta versão, a assinatura gera um hash SHA-256 com os dados da ordem, o usuário, a data/hora, o IP e o user-agent, formando uma trilha de auditoria. Para assinatura com validade jurídica avançada, o próximo passo natural é integrar certificado ICP-Brasil ou um provedor externo de assinatura.

---

## Problemas comuns

| Sintoma | Causa provável / solução |
| ------- | ------------------------ |
| `failed to connect to the docker API` | Docker Desktop fechado. Abra-o e rode `docker compose up -d` de novo. |
| API encerra com `JWT_SECRET não definido` | Falta o arquivo `apps/api/.env`. Veja o passo 1.5. |
| Erro de conexão com o banco (`ECONNREFUSED 5432`) | Container do Postgres parado. Rode `docker compose up -d`. |
| Login não funciona logo após instalar | Rode `npm run db:setup` para criar os usuários iniciais. |
| Erro "Não foi possível obter o horário oficial" | Sem acesso aos servidores NTP. Verifique a internet/firewall (porta UDP 123) ou ajuste `NTP_SERVERS`. |
| Alertas de ocorrência não chegam | Nenhum e-mail cadastrado na tela de Ocorrências, ou SMTP mal configurado no `.env`. Localmente, confira em http://localhost:8025. |
| Frontend não acessa a API em outro computador | Defina `VITE_API_URL` com o IP da máquina da API. |
