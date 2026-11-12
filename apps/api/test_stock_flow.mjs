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

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

function buildItem(sample, overrides = {}) {
  return {
    itemIdentifier: sample.model,
    partNumber: sample.partNumber,
    clientName: "Cliente Teste Estoque",
    quantity: 3,
    configuration: "Configuração para conferência do estoque",
    packaging: "CAIXA",
    battery: "SIM",
    terminalOpening: "NÃO",
    manual: "SIM",
    charger: "SIM",
    minbase: "NÃO",
    label: "SIM",
    aestheticCover: "NÃO",
    ...overrides
  };
}

async function createAndSubmit(requesterToken, sample, executorTeam, items) {
  const createRes = await request("/orders", {
    method: "POST",
    headers: auth(requesterToken),
    body: JSON.stringify({
      orderType: sample.orderType,
      executorTeam,
      validFrom: new Date().toISOString().slice(0, 10),
      items
    })
  });
  assert.equal(createRes.status, 201, `Falha ao criar OS: ${JSON.stringify(createRes.data)}`);

  const submitRes = await request(`/orders/${createRes.data.id}/submit`, {
    method: "POST",
    headers: auth(requesterToken)
  });
  assert.equal(submitRes.status, 200, `Falha ao enviar OS: ${JSON.stringify(submitRes.data)}`);
  assert.equal(submitRes.data.status, "awaiting_stock_check", "OS enviada deve aguardar conferência do Estoque");
  return createRes.data;
}

async function getOrder(orderId, token) {
  const res = await request(`/orders/${orderId}`, { headers: auth(token) });
  assert.equal(res.status, 200, `Falha ao consultar OS: ${JSON.stringify(res.data)}`);
  return res.data;
}

async function startCheck(orderId, stockToken) {
  const res = await request(`/orders/${orderId}/stock/start`, { method: "POST", headers: auth(stockToken) });
  assert.equal(res.status, 200, `Falha ao iniciar conferência: ${JSON.stringify(res.data)}`);
  assert.equal(res.data.status, "stock_checking");
}

async function registerCheck(orderId, stockToken, result, quantities, accessoriesNote, accessoriesByLine = []) {
  const detail = await getOrder(orderId, stockToken);
  return request(`/orders/${orderId}/stock/check`, {
    method: "POST",
    headers: auth(stockToken),
    body: JSON.stringify({
      result,
      accessoriesNote,
      items: detail.items.map((item, index) => ({
        id: item.id,
        checkedQuantity: quantities[index] ?? item.quantity,
        accessories: accessoriesByLine[index] ?? []
      }))
    })
  });
}

async function runStockTests() {
  console.log("================================================================================");
  console.log("TESTES OBRIGATÓRIOS: PERFIL ESTOQUE E CONFERÊNCIA DE MATERIAL");
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

  const catalogRes = await request("/catalog", { headers: auth(requesterToken) });
  assert.equal(catalogRes.status, 200, "Falha ao obter catálogo");
  const sample = {
    orderType: catalogRes.data.orderTypes[0]?.name || "Reparo",
    model: catalogRes.data.terminalModels[0]?.name || "A910",
    partNumber: catalogRes.data.partNumbers[0]?.part_number || "PN-D195-01"
  };

  // 1. Fluxo completo: OS de Produção passa pelo Estoque e chega ao Suporte
  console.log("▶ [Teste 1] Fluxo completo de uma OS de Produção pelo Estoque até a assinatura...");
  const fullOrder = await createAndSubmit(requesterToken, sample, "producao", [
    buildItem(sample, { quantity: 2 }),
    buildItem(sample, { quantity: 4, clientName: "Cliente Linha 2" })
  ]);

  const stockList = await request("/orders", { headers: auth(stockToken) });
  assert.ok(stockList.data.some((o) => o.id === fullOrder.id), "Estoque deve ver a OS aguardando conferência");

  const signerSignEarly = await request(`/orders/${fullOrder.id}/sign`, {
    method: "POST",
    headers: auth(signer1Token),
    body: JSON.stringify({ keyCount: 5 })
  });
  assert.equal(signerSignEarly.status, 409, "Suporte NÃO deve assinar OS ainda em conferência do Estoque");

  const checkBeforeStart = await registerCheck(fullOrder.id, stockToken, "complete", []);
  assert.equal(checkBeforeStart.status, 409, "Conferência não pode ser registrada antes de ser iniciada");

  await startCheck(fullOrder.id, stockToken);

  const duplicateStart = await request(`/orders/${fullOrder.id}/stock/start`, { method: "POST", headers: auth(stockToken) });
  assert.equal(duplicateStart.status, 409, "Conferência já iniciada não pode ser iniciada novamente");

  const invalidAccessory = await registerCheck(fullOrder.id, stockToken, "complete", [], null, [["fone"]]);
  assert.equal(invalidAccessory.status, 400, "Acessório fora da lista deve ser recusado");

  const completeRes = await registerCheck(fullOrder.id, stockToken, "complete", [], "Carregadores conferidos", [
    ["battery", "charger", "packaging", "battery"],
    []
  ]);
  assert.equal(completeRes.status, 200, `Falha ao registrar conferência completa: ${JSON.stringify(completeRes.data)}`);
  assert.equal(completeRes.data.status, "stock_picking");
  assert.equal(completeRes.data.stock_result, "complete");

  const releaseRes = await request(`/orders/${fullOrder.id}/stock/release`, { method: "POST", headers: auth(stockToken) });
  assert.equal(releaseRes.status, 200);
  assert.equal(releaseRes.data.status, "pending_signature");

  const sign1 = await request(`/orders/${fullOrder.id}/sign`, {
    method: "POST",
    headers: auth(signer1Token),
    body: JSON.stringify({ keyCount: 6 })
  });
  assert.equal(sign1.status, 200, `Falha na 1ª assinatura: ${JSON.stringify(sign1.data)}`);
  const sign2 = await request(`/orders/${fullOrder.id}/sign`, {
    method: "POST",
    headers: auth(signer2Token),
    body: JSON.stringify({ keyCount: 6 })
  });
  assert.equal(sign2.status, 200, `Falha na 2ª assinatura: ${JSON.stringify(sign2.data)}`);
  assert.equal(sign2.data.order.status, "signed");

  const fullDetail = await getOrder(fullOrder.id, adminToken);
  assert.deepEqual(fullDetail.items.map((i) => i.stock_checked_quantity), [2, 4], "Quantidade conferida deve ser gravada por linha");
  assert.equal(fullDetail.stock_accessories_note, "Carregadores conferidos");
  assert.deepEqual(fullDetail.items[0].stock_accessories, ["battery", "charger", "packaging"], "Acessórios que acompanham o terminal devem ser gravados por linha, sem repetição");
  assert.deepEqual(fullDetail.items[1].stock_accessories, [], "Linha sem acessórios deve ficar registrada como vazia");
  const checkEvent = fullDetail.events.find((e) => e.event_type === "Conferência registrada");
  assert.ok(checkEvent.message.includes("item 1: Bateria, Carregador, Embalagem"), "Histórico deve listar os acessórios enviados");
  const eventTypes = fullDetail.events.map((e) => e.event_type);
  for (const expected of ["Enviada", "Conferência iniciada", "Conferência registrada", "Separação concluída"]) {
    assert.ok(eventTypes.includes(expected), `Histórico deve conter o evento '${expected}'`);
  }

  const stockAfterSigned = await getOrder(fullOrder.id, stockToken);
  assert.equal(stockAfterSigned.status, "signed", "Estoque continua vendo a OS que conferiu");
  console.log("✔ OS conferida, separada, liberada ao Suporte e assinada, com histórico registrado.\n");

  // 2. Validações da conferência
  console.log("▶ [Teste 2] Validando regras da conferência (falta de item, quantidades, cobertura das linhas)...");
  const shortOrder = await createAndSubmit(requesterToken, sample, "suporte", [
    buildItem(sample, { quantity: 3 }),
    buildItem(sample, { quantity: 2, clientName: "Cliente Linha 2" })
  ]);
  await startCheck(shortOrder.id, stockToken);

  const completeWithShortage = await registerCheck(shortOrder.id, stockToken, "complete", [1, 2]);
  assert.equal(completeWithShortage.status, 409, "Completo com item em falta deve ser bloqueado");

  const partialWithoutShortage = await registerCheck(shortOrder.id, stockToken, "partial", [3, 2]);
  assert.equal(partialWithoutShortage.status, 400, "Parcial sem nenhuma falta deve ser recusado");

  const overQuantity = await registerCheck(shortOrder.id, stockToken, "partial", [5, 2]);
  assert.equal(overQuantity.status, 400, "Quantidade conferida maior que a solicitada deve ser recusada");

  const shortDetail = await getOrder(shortOrder.id, stockToken);
  const missingLine = await request(`/orders/${shortOrder.id}/stock/check`, {
    method: "POST",
    headers: auth(stockToken),
    body: JSON.stringify({ result: "partial", items: [{ id: shortDetail.items[0].id, checkedQuantity: 1 }] })
  });
  assert.equal(missingLine.status, 400, "Conferência deve cobrir todas as linhas de terminal");

  const stillChecking = await getOrder(shortOrder.id, stockToken);
  assert.equal(stillChecking.status, "stock_checking", "Tentativas recusadas não devem alterar o status");
  console.log("✔ Regras da conferência validadas no backend.\n");

  // 3. Conferência parcial → Operações devolve ao Estoque → nova conferência completa
  console.log("▶ [Teste 3] Conferência parcial e devolução ao Estoque por Operações...");
  const partialRes = await registerCheck(shortOrder.id, stockToken, "partial", [1, 2], "Faltam 2 baterias");
  assert.equal(partialRes.status, 200, `Falha ao registrar parcial: ${JSON.stringify(partialRes.data)}`);
  assert.equal(partialRes.data.status, "stock_returned");
  assert.equal(partialRes.data.stock_result, "partial");

  const releaseReturned = await request(`/orders/${shortOrder.id}/stock/release`, { method: "POST", headers: auth(stockToken) });
  assert.equal(releaseReturned.status, 409, "OS devolvida não pode ser liberada ao Suporte pelo Estoque");

  const stockTriesDecision = await request(`/orders/${shortOrder.id}/stock-return/recheck`, { method: "POST", headers: auth(stockToken) });
  assert.equal(stockTriesDecision.status, 403, "Estoque não pode tomar a decisão de Operações");

  const recheckRes = await request(`/orders/${shortOrder.id}/stock-return/recheck`, {
    method: "POST",
    headers: auth(requesterToken),
    body: JSON.stringify({ message: "Material chegou, favor reconferir" })
  });
  assert.equal(recheckRes.status, 200, `Falha ao devolver ao Estoque: ${JSON.stringify(recheckRes.data)}`);
  assert.equal(recheckRes.data.status, "awaiting_stock_check");
  assert.equal(recheckRes.data.stock_result, null, "Resultado anterior deve ser limpo para nova conferência");

  await startCheck(shortOrder.id, stockToken);
  const recheckComplete = await registerCheck(shortOrder.id, stockToken, "complete", [3, 2]);
  assert.equal(recheckComplete.status, 200);
  assert.equal(recheckComplete.data.status, "stock_picking");
  console.log("✔ OS devolvida ao Estoque, reconferida e concluída como completa.\n");

  // 4. Pendência de estoque → Operações encaminha ao Suporte com justificativa obrigatória
  console.log("▶ [Teste 4] Pendência de estoque e encaminhamento ao Suporte com justificativa...");
  const pendingOrder = await createAndSubmit(requesterToken, sample, "producao", [buildItem(sample, { quantity: 5 })]);
  await startCheck(pendingOrder.id, stockToken);
  const shortageRes = await registerCheck(pendingOrder.id, stockToken, "shortage", [0]);
  assert.equal(shortageRes.status, 200);
  assert.equal(shortageRes.data.status, "stock_returned");
  assert.equal(shortageRes.data.stock_result, "shortage");

  const forwardNoJustification = await request(`/orders/${pendingOrder.id}/stock-return/forward`, {
    method: "POST",
    headers: auth(requesterToken),
    body: JSON.stringify({ justification: "  " })
  });
  assert.equal(forwardNoJustification.status, 400, "Encaminhar ao Suporte exige justificativa");

  const forwardRes = await request(`/orders/${pendingOrder.id}/stock-return/forward`, {
    method: "POST",
    headers: auth(requesterToken),
    body: JSON.stringify({ justification: "Cliente aceitou entrega sem os terminais em falta" })
  });
  assert.equal(forwardRes.status, 200, `Falha ao encaminhar: ${JSON.stringify(forwardRes.data)}`);
  assert.equal(forwardRes.data.status, "pending_signature");

  const forwardDetail = await getOrder(pendingOrder.id, adminToken);
  const forwardEvent = forwardDetail.events.find((e) => e.event_type === "Encaminhada com falta de material");
  assert.ok(forwardEvent, "Encaminhamento deve ficar no histórico");
  assert.ok(forwardEvent.message.includes("Cliente aceitou entrega"), "Justificativa deve constar no histórico");
  assert.equal(forwardEvent.metadata.decision, "forward_to_support");
  console.log("✔ Justificativa obrigatória validada e registrada no histórico.\n");

  // 5. Parcial → Operações edita a OS (volta para rascunho) e reenvia
  console.log("▶ [Teste 5] Operações edita a OS devolvida pelo Estoque...");
  const editOrder = await createAndSubmit(requesterToken, sample, "suporte", [buildItem(sample, { quantity: 4 })]);
  await startCheck(editOrder.id, stockToken);
  const editPartial = await registerCheck(editOrder.id, stockToken, "partial", [2]);
  assert.equal(editPartial.status, 200);

  const editRes = await request(`/orders/${editOrder.id}`, {
    method: "PUT",
    headers: auth(requesterToken),
    body: JSON.stringify({
      orderType: sample.orderType,
      executorTeam: "suporte",
      items: [buildItem(sample, { quantity: 2 })]
    })
  });
  assert.equal(editRes.status, 200, `Falha ao editar OS devolvida: ${JSON.stringify(editRes.data)}`);
  assert.equal(editRes.data.status, "draft");

  const stockSeesDraft = await request(`/orders/${editOrder.id}`, { headers: auth(stockToken) });
  assert.equal(stockSeesDraft.status, 403, "Estoque não deve ver rascunhos");
  // O rascunho mantém stock_checker_id da conferência anterior; mesmo assim não pode aparecer na lista do Estoque
  const stockListAfterEdit = await request("/orders", { headers: auth(stockToken) });
  assert.ok(!stockListAfterEdit.data.some((o) => o.id === editOrder.id), "Rascunho já conferido não deve aparecer na lista do Estoque");

  const resubmitEdited = await request(`/orders/${editOrder.id}/submit`, { method: "POST", headers: auth(requesterToken) });
  assert.equal(resubmitEdited.data.status, "awaiting_stock_check", "OS editada volta a passar pelo Estoque");
  const editEvents = (await getOrder(editOrder.id, adminToken)).events;
  assert.ok(editEvents.some((e) => e.metadata?.decision === "edit_order"), "Decisão de editar deve ficar no histórico");
  console.log("✔ OS devolvida editada, retornou a rascunho e voltou ao Estoque no reenvio.\n");

  // 6. Correção pedida pelo Suporte → OS corrigida volta a passar pelo Estoque
  console.log("▶ [Teste 6] OS corrigida após devolutiva do Suporte volta ao Estoque...");
  await request(`/orders/${shortOrder.id}/stock/release`, { method: "POST", headers: auth(stockToken) });
  const correctionRes = await request(`/orders/${shortOrder.id}/request-correction`, {
    method: "POST",
    headers: auth(signer1Token),
    body: JSON.stringify({ message: "Ajustar configuração dos terminais." })
  });
  assert.equal(correctionRes.status, 200);
  const resubmitCorrected = await request(`/orders/${shortOrder.id}/submit`, { method: "POST", headers: auth(requesterToken) });
  assert.equal(resubmitCorrected.status, 200);
  assert.equal(resubmitCorrected.data.status, "awaiting_stock_check", "OS corrigida deve voltar ao Estoque");
  const correctedDetail = await getOrder(shortOrder.id, stockToken);
  assert.ok(correctedDetail.items.every((i) => i.stock_checked_quantity === null), "Conferência anterior deve ser limpa no reenvio");
  console.log("✔ OS corrigida retornou à conferência do Estoque.\n");

  // 7. Permissões validadas no backend
  console.log("▶ [Teste 7] Validando permissões dos demais perfis nas rotas do Estoque...");
  for (const [name, token] of [["Operações", requesterToken], ["Suporte", signer1Token], ["Espectador", spectatorToken], ["Admin", adminToken]]) {
    const res = await request(`/orders/${resubmitCorrected.data.id}/stock/start`, { method: "POST", headers: auth(token) });
    assert.equal(res.status, 403, `${name} NÃO deve iniciar conferência do Estoque`);
  }

  const stockCreate = await request("/orders", {
    method: "POST",
    headers: auth(stockToken),
    body: JSON.stringify({ orderType: sample.orderType, executorTeam: "suporte", items: [buildItem(sample)] })
  });
  assert.equal(stockCreate.status, 403, "Estoque NÃO deve criar ordens");

  for (const [name, token] of [["Suporte", signer1Token], ["Espectador", spectatorToken]]) {
    const res = await request(`/orders/${editOrder.id}/stock-return/forward`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ justification: "Tentativa indevida" })
    });
    assert.equal(res.status, 403, `${name} NÃO deve decidir sobre OS devolvida pelo Estoque`);
  }

  const stockDashboard = await request("/dashboard", { headers: auth(stockToken) });
  assert.equal(stockDashboard.status, 200);
  assert.equal(stockDashboard.data.userRole, "stock");
  assert.ok(stockDashboard.data.metrics.awaitingStockCheck >= 2, "Dashboard do Estoque deve contar OS aguardando conferência");
  console.log("✔ Permissões do Estoque e de Operações validadas no backend.\n");

  console.log("================================================================================");
  console.log("🎉 TODOS OS TESTES DO PERFIL ESTOQUE PASSARAM COM 100% DE SUCESSO!");
  console.log("================================================================================");
}

runStockTests().catch((err) => {
  console.error("\n❌ FALHA NOS TESTES:", err);
  process.exit(1);
});
