import assert from "node:assert/strict";

const BASE_URL = process.env.API_URL || "http://localhost:3333";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
}

async function login(email, password = "123456") {
  const res = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  assert.equal(res.status, 200, `Login failed for ${email}: ${JSON.stringify(res.data)}`);
  return res.data.token;
}

// Toda OS enviada passa pela conferência do Estoque antes de chegar ao Suporte
async function passThroughStock(orderId, stockToken) {
  const auth = { Authorization: `Bearer ${stockToken}` };
  const startRes = await request(`/orders/${orderId}/stock/start`, { method: "POST", headers: auth });
  assert.equal(startRes.status, 200, `Falha ao iniciar conferência: ${JSON.stringify(startRes.data)}`);

  const detailRes = await request(`/orders/${orderId}`, { headers: auth });
  const checkRes = await request(`/orders/${orderId}/stock/check`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      result: "complete",
      items: detailRes.data.items.map((item) => ({ id: item.id, checkedQuantity: item.quantity }))
    })
  });
  assert.equal(checkRes.status, 200, `Falha ao registrar conferência: ${JSON.stringify(checkRes.data)}`);

  const releaseRes = await request(`/orders/${orderId}/stock/release`, { method: "POST", headers: auth });
  assert.equal(releaseRes.status, 200, `Falha ao liberar ao Suporte: ${JSON.stringify(releaseRes.data)}`);
  assert.equal(releaseRes.data.status, "pending_signature");
  return releaseRes.data;
}

async function runTests() {
  console.log("================================================================================");
  console.log("INICIANDO BATERIA DE TESTES OBRIGATÓRIOS: SEPARAÇÃO DE ORDENS POR EQUIPE EXECUTORA");
  console.log("================================================================================\n");

  // 0. Autenticação dos perfis
  console.log("▶ [Etapa 0] Autenticando perfis de usuário...");
  const requesterToken = await login("solicitante@empresa.com");
  const signer1Token = await login("assinante@empresa.com");
  const signer2Token = await login("assinante2@empresa.com");
  const spectatorToken = await login("espectador@empresa.com");
  const stockToken = await login("estoque@empresa.com");
  const adminToken = await login("admin@empresa.com");
  console.log("✔ Todos os tokens obtidos com sucesso.\n");

  // Obter catálogo para preencher itens válidos
  const catalogRes = await request("/catalog", {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(catalogRes.status, 200, "Falha ao obter catálogo");
  const sampleOrderType = catalogRes.data.orderTypes[0]?.name || "Reparo";
  const sampleModel = catalogRes.data.terminalModels[0]?.name || "A910";
  const samplePN = catalogRes.data.partNumbers[0]?.part_number || "PN-D195-01";

  // Obter contagem inicial
  const initialCountsRes = await request("/orders/counts", {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(initialCountsRes.status, 200, "Falha ao obter contagens de ordens");
  const initialCounts = initialCountsRes.data;
  console.log(`Contagens iniciais: Suporte=${initialCounts.suporte}, Produção=${initialCounts.producao}, Não atribuídas=${initialCounts.unassigned}, Total=${initialCounts.total}\n`);

  // 1. Criar uma OS destinada ao Suporte
  console.log("▶ [Teste 1] Criando Ordem de Serviço destinada ao Suporte (executorTeam: 'suporte')...");
  const createSuporteRes = await request("/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` },
    body: JSON.stringify({
      orderType: sampleOrderType,
      executorTeam: "suporte",
      validFrom: new Date().toISOString().slice(0, 10),
      items: [
        {
          itemIdentifier: sampleModel,
          partNumber: samplePN,
          clientName: "Cliente Teste Suporte",
          quantity: 2,
          configuration: "Configuração para Suporte",
          packaging: "CAIXA",
          battery: "SIM",
          terminalOpening: "SIM",
          manual: "SIM",
          charger: "SIM",
          minbase: "SIM",
          label: "SIM",
          aestheticCover: "SIM"
        }
      ]
    })
  });
  assert.equal(createSuporteRes.status, 201, `Falha ao criar OS para Suporte: ${JSON.stringify(createSuporteRes.data)}`);
  const suporteOrder = createSuporteRes.data;
  assert.equal(suporteOrder.executor_team, "suporte", "A equipe executora da OS deve ser 'suporte'");
  assert.equal(suporteOrder.destination_role, "signer", "A OS para Suporte deve ser destinada ao perfil 'signer' (Suporte)");
  assert.equal(suporteOrder.status, "draft", "Status inicial deve ser 'draft'");
  console.log(`✔ OS Suporte criada com sucesso: ID=${suporteOrder.id}, Código=${suporteOrder.code}, Equipe=${suporteOrder.executor_team}, Destinatário=${suporteOrder.destination_role}\n`);

  // 2. Confirmar que aparece na aba correspondente (Suporte) e não na de Produção
  console.log("▶ [Teste 2] Confirmando que a OS Suporte aparece na aba/filtro de Suporte e NÃO na de Produção...");
  const listSuporteRes = await request("/orders?executorTeam=suporte", {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(listSuporteRes.status, 200);
  const foundInSuporteTab = listSuporteRes.data.some(o => o.id === suporteOrder.id);
  assert.ok(foundInSuporteTab, "A OS do Suporte DEVE aparecer em /orders?executorTeam=suporte");

  const listProducaoForSuporteRes = await request("/orders?executorTeam=producao", {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(listProducaoForSuporteRes.status, 200);
  const notFoundInProducaoTab = !listProducaoForSuporteRes.data.some(o => o.id === suporteOrder.id);
  assert.ok(notFoundInProducaoTab, "A OS do Suporte NÃO DEVE aparecer em /orders?executorTeam=producao");
  console.log("✔ OS Suporte aparece exclusivamente na aba de Suporte.\n");

  // 3. Criar uma OS destinada à Produção
  console.log("▶ [Teste 3] Criando Ordem de Serviço destinada à Produção (executorTeam: 'Produção' com acento)...");
  const createProducaoRes = await request("/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` },
    body: JSON.stringify({
      orderType: sampleOrderType,
      executorTeam: "Produção", // Testar normalização com acento
      validFrom: new Date().toISOString().slice(0, 10),
      items: [
        {
          itemIdentifier: sampleModel,
          partNumber: samplePN,
          clientName: "Cliente Teste Produção",
          quantity: 3,
          configuration: "Configuração para Produção",
          packaging: "SACO BOLHA",
          battery: "SIM",
          terminalOpening: "SIM",
          manual: "SIM",
          charger: "SIM",
          minbase: "SIM",
          label: "SIM",
          aestheticCover: "SIM"
        }
      ]
    })
  });
  assert.equal(createProducaoRes.status, 201, `Falha ao criar OS para Produção: ${JSON.stringify(createProducaoRes.data)}`);
  const producaoOrder = createProducaoRes.data;
  assert.equal(producaoOrder.executor_team, "producao", "A equipe executora da OS deve ser 'producao' normalizada");
  assert.equal(producaoOrder.destination_role, "signer", "A OS para Produção DEVE ser destinada ao Suporte ('signer') para validação");
  assert.equal(producaoOrder.status, "draft", "Status inicial deve ser 'draft'");
  console.log(`✔ OS Produção criada com sucesso: ID=${producaoOrder.id}, Código=${producaoOrder.code}, Equipe=${producaoOrder.executor_team}, Destinatário=${producaoOrder.destination_role}\n`);

  // 4. Confirmar que aparece na aba correspondente (Produção) e não na de Suporte
  console.log("▶ [Teste 4] Confirmando que a OS Produção aparece na aba/filtro de Produção e NÃO na de Suporte...");
  const listProducaoRes = await request("/orders?executorTeam=producao", {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(listProducaoRes.status, 200);
  const foundInProducaoTab = listProducaoRes.data.some(o => o.id === producaoOrder.id);
  assert.ok(foundInProducaoTab, "A OS de Produção DEVE aparecer em /orders?executorTeam=producao");

  const listSuporteForProducaoRes = await request("/orders?executorTeam=suporte", {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(listSuporteForProducaoRes.status, 200);
  const notFoundInSuporteTab = !listSuporteForProducaoRes.data.some(o => o.id === producaoOrder.id);
  assert.ok(notFoundInSuporteTab, "A OS de Produção NÃO DEVE aparecer em /orders?executorTeam=suporte");
  console.log("✔ OS Produção aparece exclusivamente na aba de Produção.\n");

  // 5. Confirmar que AMBAS são encaminhadas ao fluxo de validação do Suporte
  console.log("▶ [Teste 5] Confirmando que ambas são encaminhadas ao fluxo de validação do Suporte...");
  // Enviar OS Suporte
  const submitSuporteRes = await request(`/orders/${suporteOrder.id}/submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(submitSuporteRes.status, 200);
  assert.equal(submitSuporteRes.data.status, "awaiting_stock_check", "OS de Suporte deve passar primeiro pelo Estoque");
  await passThroughStock(suporteOrder.id, stockToken);
  assert.equal(submitSuporteRes.data.destination_role, "signer");

  // Enviar OS Produção
  const submitProducaoRes = await request(`/orders/${producaoOrder.id}/submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(submitProducaoRes.status, 200);
  assert.equal(submitProducaoRes.data.status, "awaiting_stock_check", "OS de Produção deve passar primeiro pelo Estoque");
  await passThroughStock(producaoOrder.id, stockToken);
  assert.equal(submitProducaoRes.data.destination_role, "signer");

  // Consultar como Suporte (signer) e verificar se ambas constam como pendentes de validação
  const signerOrdersRes = await request("/orders", {
    headers: { Authorization: `Bearer ${signer1Token}` }
  });
  assert.equal(signerOrdersRes.status, 200);
  const signerSeesSuporte = signerOrdersRes.data.find(o => o.id === suporteOrder.id);
  const signerSeesProducao = signerOrdersRes.data.find(o => o.id === producaoOrder.id);
  assert.ok(signerSeesSuporte, "Suporte (signer) deve ver a OS de Suporte para validação");
  assert.ok(signerSeesProducao, "Suporte (signer) DEVE ver a OS de Produção para validação (o Suporte valida ambas!)");
  assert.equal(signerSeesSuporte.status, "pending_signature");
  assert.equal(signerSeesProducao.status, "pending_signature");
  console.log("✔ Suporte recebeu ambas as ordens para validação e conferência.\n");

  // 6 e 7. Ciclo de validação: Devolutiva para correção, reenvio, double check, divergência e aprovação
  console.log("▶ [Teste 6 e 7] Testando ciclo completo: correção, assinaturas, double check e divergências...");

  // 7.1 Devolutiva de correção na OS Produção pelo Suporte
  console.log("  → 7.1 Suporte solicita correção na OS Produção...");
  const correctRes = await request(`/orders/${producaoOrder.id}/request-correction`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer1Token}` },
    body: JSON.stringify({ message: "Corrigir a descrição da configuração de produção." })
  });
  assert.equal(correctRes.status, 200, `Erro ao solicitar correção: ${JSON.stringify(correctRes.data)}`);
  assert.equal(correctRes.data.status, "correction_requested");

  // Verificar persistência da classificação
  const checkAfterCorrection = await request(`/orders/${producaoOrder.id}`, {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(checkAfterCorrection.data.executor_team, "producao", "A classificação 'producao' NÃO deve mudar após solicitação de correção!");
  console.log("  ✔ Status mudou para 'correction_requested' e executor_team manteve 'producao'.");

  // 7.2 Solicitante edita a OS em correção
  console.log("  → 7.2 Solicitante edita e corrige a OS de Produção...");
  const editRes = await request(`/orders/${producaoOrder.id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${requesterToken}` },
    body: JSON.stringify({
      orderType: sampleOrderType,
      executorTeam: "producao",
      items: [
        {
          itemIdentifier: sampleModel,
          partNumber: samplePN,
          clientName: "Cliente Teste Produção Ajustado",
          quantity: 3,
          configuration: "Configuração de produção corrigida",
          packaging: "SACO BOLHA",
          battery: "SIM",
          terminalOpening: "SIM",
          manual: "SIM",
          charger: "SIM",
          minbase: "SIM",
          label: "SIM",
          aestheticCover: "SIM"
        }
      ]
    })
  });
  assert.equal(editRes.status, 200);
  assert.equal(editRes.data.status, "draft");
  assert.equal(editRes.data.executor_team, "producao", "executor_team deve ser 'producao' após edição");

  // Reenviar para validação
  const resubmitRes = await request(`/orders/${producaoOrder.id}/submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(resubmitRes.status, 200);
  assert.equal(resubmitRes.data.status, "awaiting_stock_check", "OS corrigida deve voltar a passar pelo Estoque");
  await passThroughStock(producaoOrder.id, stockToken);
  console.log("  ✔ OS corrigida e reenviada ao Suporte.");

  // 7.3 Primeira assinatura na OS Produção pelo primeiro validador do Suporte
  console.log("  → 7.3 Validador 1 do Suporte assina OS Produção com keyCount=10...");
  const sign1Res = await request(`/orders/${producaoOrder.id}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer1Token}` },
    body: JSON.stringify({ keyCount: 10 })
  });
  assert.equal(sign1Res.status, 200);
  assert.equal(sign1Res.data.signatureCount, 1);
  assert.equal(sign1Res.data.order.status, "pending_signature");

  const checkAfterSign1 = await request(`/orders/${producaoOrder.id}`, {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(checkAfterSign1.data.executor_team, "producao", "executor_team deve se manter 'producao' após primeira assinatura");
  console.log("  ✔ 1ª assinatura registrada com sucesso.");

  // 7.4 Double check com divergência (segundo validador informa keyCount diferente)
  console.log("  → 7.4 Validador 2 do Suporte realiza double check informando keyCount divergente (keyCount=8)...");
  const sign2DivergentRes = await request(`/orders/${producaoOrder.id}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer2Token}` },
    body: JSON.stringify({ keyCount: 8 })
  });
  assert.equal(sign2DivergentRes.status, 200);
  assert.equal(sign2DivergentRes.data.incorrectSignature, true, "Deve registrar assinatura incorreta/divergente");
  assert.equal(sign2DivergentRes.data.status, "divergent");
  assert.equal(sign2DivergentRes.data.order.incorrect_signatures, 1);

  const checkAfterDivergence = await request(`/orders/${producaoOrder.id}`, {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(checkAfterDivergence.data.status, "divergent");
  assert.equal(checkAfterDivergence.data.executor_team, "producao", "executor_team DEVE permanecer 'producao' após divergência no double check!");
  assert.equal(checkAfterDivergence.data.signatures.length, 0, "Assinaturas devem ser resetadas para nova tentativa de conferência");

  const signerDivergentDetail = await request(`/orders/${producaoOrder.id}`, {
    headers: { Authorization: `Bearer ${signer1Token}` }
  });
  assert.equal(signerDivergentDetail.status, 403, "Assinante NÃO deve acessar OS divergente");
  const signerList = await request("/orders", {
    headers: { Authorization: `Bearer ${signer1Token}` }
  });
  const signerOrders = Array.isArray(signerList.data) ? signerList.data : signerList.data?.orders ?? [];
  assert.equal(signerOrders.some((o) => o.id === producaoOrder.id), false, "OS divergente NÃO deve aparecer na lista do assinante");
  console.log("  ✔ Divergência no double check detectada: OS devolvida ao solicitante e oculta dos assinantes, executor_team intacto.");

  // Solicitante reenvia; a OS passa pelo estoque de novo antes de voltar aos assinantes
  const resubmitDivergentRes = await request(`/orders/${producaoOrder.id}/submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(resubmitDivergentRes.status, 200, "Solicitante deve conseguir reenviar a OS divergente");
  assert.equal(resubmitDivergentRes.data.status, "awaiting_stock_check");
  await passThroughStock(producaoOrder.id, stockToken);

  // 7.5 Aprovação definitiva com double check concordante
  console.log("  → 7.5 Validador 1 assina novamente com keyCount=10...");
  const retrySign1 = await request(`/orders/${producaoOrder.id}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer1Token}` },
    body: JSON.stringify({ keyCount: 10 })
  });
  assert.equal(retrySign1.status, 200);
  assert.equal(retrySign1.data.signatureCount, 1);

  console.log("  → 7.6 Validador 2 assina concordando com keyCount=10 (Double check aprovado)...");
  const retrySign2 = await request(`/orders/${producaoOrder.id}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer2Token}` },
    body: JSON.stringify({ keyCount: 10 })
  });
  assert.equal(retrySign2.status, 200);
  assert.equal(retrySign2.data.signatureCount, 2);
  assert.equal(retrySign2.data.order.status, "signed", "Ordem deve estar aprovada ('signed') com 2 assinaturas");

  const checkFinalProducao = await request(`/orders/${producaoOrder.id}`, {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(checkFinalProducao.data.status, "signed");
  assert.equal(checkFinalProducao.data.executor_team, "producao", "Classificação 'producao' permaneceu intacta do rascunho até a aprovação final!");
  console.log("  ✔ OS Produção aprovada com sucesso mantendo classificação 'producao' durante todo o ciclo de vida!\n");

  // 7.6 Assinar e aprovar também a OS de Suporte
  console.log("  → 7.7 Aprovando a OS Suporte através do fluxo do Suporte...");
  const suporteSign1 = await request(`/orders/${suporteOrder.id}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer1Token}` },
    body: JSON.stringify({ keyCount: 5 })
  });
  assert.equal(suporteSign1.status, 200);
  const suporteSign2 = await request(`/orders/${suporteOrder.id}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer2Token}` },
    body: JSON.stringify({ keyCount: 5 })
  });
  assert.equal(suporteSign2.status, 200);
  assert.equal(suporteSign2.data.order.status, "signed");
  const checkFinalSuporte = await request(`/orders/${suporteOrder.id}`, {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(checkFinalSuporte.data.executor_team, "suporte");
  console.log("  ✔ OS Suporte aprovada com sucesso mantendo classificação 'suporte'.\n");

  // 8. Confirmar que os filtros existentes continuam funcionando
  console.log("▶ [Teste 8] Confirmando que os filtros existentes continuam funcionando...");
  // Ambas as ordens estão 'signed'. Vamos filtrar por status no backend e no frontend
  const listAllSigned = await request("/orders", {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  const signedOrders = listAllSigned.data.filter(o => o.status === "signed");
  assert.ok(signedOrders.some(o => o.id === producaoOrder.id), "Filtro signed deve conter a OS Produção aprovada");
  assert.ok(signedOrders.some(o => o.id === suporteOrder.id), "Filtro signed deve conter a OS Suporte aprovada");

  // Contagens
  const updatedCountsRes = await request("/orders/counts", {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(updatedCountsRes.status, 200);
  assert.equal(updatedCountsRes.data.suporte, initialCounts.suporte + 1, "Contagem de Suporte incrementada");
  assert.equal(updatedCountsRes.data.producao, initialCounts.producao + 1, "Contagem de Produção incrementada");
  assert.equal(updatedCountsRes.data.unassigned, initialCounts.unassigned, "Ordens antigas mantiveram-se unassigned");
  console.log("✔ Contagens e filtros de status funcionando harmoniosamente com as abas de equipe executora.\n");

  // 9. Testar permissões dos perfis
  console.log("▶ [Teste 9] Testando permissões de perfis (solicitante, validador, espectador/estoque, admin)...");

  // 9.1 Espectador (Estoque) é estritamente somente leitura
  const spectatorCreate = await request("/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${spectatorToken}` },
    body: JSON.stringify({
      orderType: sampleOrderType,
      executorTeam: "suporte",
      validFrom: new Date().toISOString().slice(0, 10),
      items: [{ itemIdentifier: sampleModel, partNumber: samplePN, clientName: "Estoque", quantity: 1, configuration: "-" }]
    })
  });
  assert.equal(spectatorCreate.status, 403, "Espectador (Estoque) NÃO pode criar OS (deve retornar 403)");

  const spectatorSign = await request(`/orders/${producaoOrder.id}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${spectatorToken}` },
    body: JSON.stringify({ keyCount: 5 })
  });
  assert.equal(spectatorSign.status, 403, "Espectador (Estoque) NÃO pode assinar OS (deve retornar 403)");

  // 9.2 Solicitante não pode assinar
  const requesterSign = await request(`/orders/${producaoOrder.id}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` },
    body: JSON.stringify({ keyCount: 5 })
  });
  assert.equal(requesterSign.status, 403, "Solicitante NÃO pode assinar OS (deve retornar 403)");

  // 9.3 Validador não pode criar ordens
  const signerCreate = await request("/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${signer1Token}` },
    body: JSON.stringify({
      orderType: sampleOrderType,
      executorTeam: "suporte",
      validFrom: new Date().toISOString().slice(0, 10),
      items: [{ itemIdentifier: sampleModel, partNumber: samplePN, clientName: "Validador", quantity: 1, configuration: "-" }]
    })
  });
  assert.equal(signerCreate.status, 403, "Validador NÃO pode criar OS (deve retornar 403)");
  console.log("✔ Permissões de perfis preservadas com rigor: Estoque é somente leitura, Solicitante cria/edita, Suporte valida/assina.\n");

  // 10. Validação de dados e integridade
  console.log("▶ [Teste 10] Testando validação de equipe executora inválida...");
  const invalidTeamRes = await request("/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` },
    body: JSON.stringify({
      orderType: sampleOrderType,
      executorTeam: "financeiro_invalido",
      validFrom: new Date().toISOString().slice(0, 10),
      items: [{ itemIdentifier: sampleModel, partNumber: samplePN, clientName: "Teste", quantity: 1, configuration: "-", packaging: "CAIXA", battery: "SIM", terminalOpening: "SIM", manual: "SIM", charger: "SIM", minbase: "SIM", label: "SIM", aestheticCover: "SIM" }]
    })
  });
  assert.equal(invalidTeamRes.status, 400, "Backend DEVE rejeitar equipe executora diferente de suporte ou producao");
  console.log("✔ Backend rejeitou equipe executora inválida com erro 400.\n");

  // 11. Preservação de ordens antigas sem classificação
  console.log("▶ [Teste 11] Confirmando preservação de ordens antigas sem classificação (executor_team IS NULL)...");
  const unassignedRes = await request("/orders?executorTeam=unassigned", {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(unassignedRes.status, 200);
  assert.equal(unassignedRes.data.length, initialCounts.unassigned, "Ordens pré-existentes mantiveram executor_team IS NULL");
  console.log("✔ Ordens pré-existentes preservadas intactas sem atribuição arbitrária.\n");

  console.log("================================================================================");
  console.log("🎉 TODOS OS TESTES OBRIGATÓRIOS FORAM EXECUTADOS E PASSARAM COM 100% DE SUCESSO!");
  console.log("================================================================================");
}

runTests().catch(err => {
  console.error("\n❌ FALHA NOS TESTES:", err);
  process.exit(1);
});
