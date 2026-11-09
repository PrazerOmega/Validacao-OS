# Fluxo da OS — processo operacional

Transcrição em texto de `fluxo-os.png`. Em caso de dúvida sobre a transcrição, o PNG é a referência original.

Este fluxograma descreve o **processo operacional completo**, incluindo etapas físicas (retirada e movimentação de material) e de áreas que não necessariamente operam no sistema (Comercial, PCP, linha de produção). Ele não é uma máquina de estados: não usa os códigos de status do sistema.

## Diagrama

```mermaid
flowchart TD
    INICIO(["Início"]) --> DEC_ORIGEM_SOL{"Origem da solicitação?"}
    DEC_ORIGEM_SOL -->|"Diversos"| DEC_TIPO{"Tipo de terminal?"}
    DEC_ORIGEM_SOL -->|"Vendas/Testes"| RECEBE_COMERCIAL["CUSTOMER - Recebe pedido do Comercial"]
    DEC_TIPO -->|"Produção"| REALIZA_OS["CUSTOMER - Realizar a OS"]
    DEC_TIPO -->|"Debug / Chaves de teste"| REALIZA_OS
    RECEBE_COMERCIAL --> REALIZA_OS
    REALIZA_OS --> DEC_ORIGEM_OS{"Origem da OS?"}

    %% Trilha A: Vendas/Testes - Debug / Chaves de teste
    DEC_ORIGEM_OS -->|"Vendas/Testes - Debug / Chaves de teste"| TA1["CUSTOMER - Solicitar separação à Expedição"]
    TA1 --> TA2["Expedição confere disponibilidade em estoque"]
    TA2 --> TA_DEC{"Terminais disponíveis?"}
    TA_DEC -->|"Sim"| TA3["CUSTOMER - Retirar os terminais"]
    TA_DEC -->|"Não"| CANCELA["CUSTOMER - Cancelar o pedido"]
    TA3 --> SUP1

    %% Trilha B: Diversos - Debug / Chaves de teste
    DEC_ORIGEM_OS -->|"Diversos - Debug / Chaves de teste"| TB1["Retirar terminais no Recebimento"]
    TB1 --> SUP1

    %% Etapa comum das trilhas A e B (Suporte)
    SUP1["CUSTOMER - Disponibilizar OS e terminais ao Suporte"] --> SUP2["Suporte prepara os terminais"]
    SUP2 --> SUP3["Suporte devolve ao Customer"]
    SUP3 --> SUP_DEC{"Origem?"}
    SUP_DEC -->|"Diversos"| SUP4["Customer leva os terminais à Produção"]
    SUP4 --> SUP5["Produção realiza o bipamento no processo"]
    SUP5 --> DESCE
    SUP_DEC -->|"Vendas/Testes"| DESCE

    %% Trilha C: Vendas/Testes - Produção
    DEC_ORIGEM_OS -->|"Vendas/Testes - Produção"| TC1["Suporte assina a OS"]
    TC1 --> TC2["Customer recebe a OS"]
    TC2 --> TC3["Customer informa ao PCP que a OS está liberada para planejamento"]
    TC3 --> TC4["CUSTOMER - Solicitar terminais à Expedição"]
    TC4 --> TC5["Expedição confere disponibilidade dos equipamentos"]
    TC5 --> TC_DEC{"Equipamentos disponíveis?"}
    TC_DEC -->|"Sim"| TC6["Expedição segrega os equipamentos"]
    TC6 --> TC7["EXPEDIÇÃO - Aguardar solicitação do PCP"]
    TC7 --> SOBE
    TC_DEC -->|"Não"| TC_DEC2{"Existem terminais novos em estoque?"}
    TC_DEC2 -->|"Não"| CANCELA
    TC_DEC2 -->|"Sim"| RETIFICA

    %% Trilha D: Diversos - Produção
    DEC_ORIGEM_OS -->|"Diversos - Produção"| TD1["Suporte assina a OS"]
    TD1 --> TD2["Customer recebe a OS"]
    TD2 --> TD3["Customer informa ao PCP que a OS está liberada para planejamento"]
    TD3 --> TD4["CUSTOMER - Entregar ao Recebimento"]
    TD4 --> TD5["Recebimento confere disponibilidade do material"]
    TD5 --> TD_DEC{"Material disponível?"}
    TD_DEC -->|"Sim"| TD6["Recebimento segrega o material"]
    TD6 --> TD7["RECEBIMENTO - Aguardar solicitação do PCP"]
    TD7 --> SOBE
    TD_DEC -->|"Não"| RETIFICA

    %% Produção (trilhas C e D)
    SOBE["Material sobe para a Produção"] --> LINHA["Processamento na linha"]
    LINHA --> DESCE

    %% Desfechos
    DESCE["Material desce para a Expedição"] --> FIM(["Fim"])
    CANCELA --> FIM_CANCELADO(["Fim - Pedido cancelado"])
    RETIFICA["CUSTOMER - Retificar a OS"] --> CORRIGE["CUSTOMER - Conferir e corrigir as informações da OS"]
    CORRIGE --> REALIZA_OS
```

## Classificação da OS

A trilha é definida por duas dimensões:

| Origem \ Tipo de terminal | Debug / Chaves de teste | Produção |
|---|---|---|
| **Vendas/Testes** (pedido do Comercial) | Trilha A | Trilha C |
| **Diversos** | Trilha B | Trilha D |

## Trilhas

### Trilha A — Vendas/Testes, Debug / Chaves de teste
1. Customer solicita separação à Expedição.
2. Expedição confere disponibilidade em estoque.
3. Terminais disponíveis? **Não** → Customer cancela o pedido (fim). **Sim** → Customer retira os terminais.
4. Segue para a etapa do Suporte.

### Trilha B — Diversos, Debug / Chaves de teste
1. Retirar terminais no Recebimento (ator não indicado no diagrama).
2. Segue para a etapa do Suporte.

### Etapa do Suporte (trilhas A e B)
1. Customer disponibiliza OS e terminais ao Suporte.
2. Suporte prepara os terminais e devolve ao Customer.
3. Origem **Diversos** → Customer leva os terminais à Produção → Produção realiza o bipamento no processo.
4. Material desce para a Expedição (fim).

### Trilha C — Vendas/Testes, Produção
1. Suporte assina a OS → Customer recebe a OS → Customer informa ao PCP que a OS está liberada para planejamento.
2. Customer solicita terminais à Expedição; Expedição confere disponibilidade.
3. Equipamentos disponíveis? **Sim** → Expedição segrega e aguarda solicitação do PCP.
   **Não** → existem terminais novos em estoque? **Sim** → retificação da OS. **Não** → Customer cancela o pedido (fim).
4. Material sobe para a Produção → processamento na linha → material desce para a Expedição (fim).

### Trilha D — Diversos, Produção
1. Suporte assina a OS → Customer recebe a OS → Customer informa ao PCP que a OS está liberada para planejamento.
2. Customer entrega ao Recebimento; Recebimento confere disponibilidade do material.
3. Material disponível? **Sim** → Recebimento segrega e aguarda solicitação do PCP. **Não** → retificação da OS.
4. Material sobe para a Produção → processamento na linha → material desce para a Expedição (fim).

## Desfechos

| Desfecho | Quando ocorre |
|---|---|
| Fim | Material desce para a Expedição |
| Pedido cancelado | Trilha A sem terminais disponíveis; trilha C sem equipamentos e sem terminais novos em estoque |
| Retificação | Trilha C com terminais novos em estoque; trilha D sem material. Customer retifica, confere e corrige a OS, e o fluxo recomeça em "Realizar a OS" |
