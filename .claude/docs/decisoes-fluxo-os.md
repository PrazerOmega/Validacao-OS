# Decisões do fluxo-alvo da OS

Registro das decisões de modelagem para implementar `fluxo-os.md`. Divergências entre o código atual e o alvo: `gap-fluxo-os.md`.

Regra: não implementar nada que dependa de uma decisão pendente. Perguntar antes.

## Decididas

| # | Decisão | Consequências |
|---|---|---|
| D1 | O fluxograma (`fluxo-os.md`) é o processo-alvo | Funcionalidade nova de fluxo segue o fluxograma, não o comportamento atual |
| D2 | Expedição e Recebimento são perfis separados | Substituem o perfil `stock`. Expedição atua nas trilhas A e C; Recebimento nas trilhas B e D. Usuários atuais com perfil `stock` precisarão ser reatribuídos |
| D3 | PCP tem perfil próprio e registra a liberação no sistema | PCP é notificado quando a OS é liberada para planejamento e registra a solicitação de material, que libera a saída da Expedição/Recebimento para a Produção |
| D4 | Etapas pós-separação são rastreadas já na 1ª versão | Novos status para: material na Produção, processamento na linha, bipamento e retorno à Expedição |
| D5 | Assinatura dupla e cega (dois assinantes conferindo as chaves) mantida nas OS de Produção | Reaproveita a lógica atual de `POST /orders/:id/sign`. O momento da assinatura segue o fluxograma: antes da conferência de estoque |
| D6 | OS em andamento terminam no fluxo atual antes da troca (sem coexistência e sem migração) | O código não precisa suportar os dois fluxos ao mesmo tempo. A troca exige uma data de corte: parar de criar OS no fluxo atual, esperar as abertas terminarem e então ativar o novo |
| D7 | Cada área marca a própria etapa; quem recebe o material confirma a chegada | PCP registra o pedido de material. Produção confirma o recebimento do material e registra processamento na linha e bipamento. Expedição confirma o retorno do material. Produção deixa de ser somente leitura (`spectator`) e passa a agir |
| D8 | A OS é concluída quando a Expedição confirma o retorno do material | Corresponde ao "Fim" do fluxograma. Substitui `signed` como status final |

## Pendentes

| # | Questão | O que depende dela |
|---|---|---|
| P1 | Informado: "o fluxo para as chaves de teste deve ser o mesmo que o de chaves de produção". Falta definir o alcance: (1) a assinatura dupla atual é o "Suporte prepara os terminais" e A/B mantêm a estrutura; (2) A/B ganham "Suporte assina a OS" no início, como C/D; ou (3) A/B seguem o fluxo completo de C/D, e o fluxograma muda | Desenho das trilhas A e B |
| P2 | Como a OS registra origem (Vendas/Testes × Diversos) e tipo (Produção × Debug)? O `executor_team` é reaproveitado ou substituído? | Escolha da trilha; schema |
| P6 | Nomes técnicos dos novos perfis e status | Schema, API, web |
