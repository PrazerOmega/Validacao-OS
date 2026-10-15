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
  return res.data;
}

async function runDashboardTests() {
  console.log("================================================================================");
  console.log("TESTES OBRIGATÓRIOS DO DASHBOARD: SIMPLES, LIMPO E OBJETIVO");
  console.log("================================================================================\n");

  // 1. Autenticação dos perfis
  console.log("▶ [Etapa 1] Autenticando perfis do sistema (Admin, Solicitante, Validador, Estoque)...");
  const requester = await login("solicitante@empresa.com");
  const signer1 = await login("assinante@empresa.com");
  const signer2 = await login("assinante2@empresa.com");
  const spectator = await login("espectador@empresa.com");
  const admin = await login("admin@empresa.com");
  console.log("✔ Autenticação realizada com sucesso para todos os perfis.\n");

  // 2. Testar acesso não autorizado
  console.log("▶ [Etapa 2] Validando proteção de rota (acesso sem token deve ser rejeitado)...");
  const unauthRes = await request("/dashboard");
  assert.equal(unauthRes.status, 401, "A rota /dashboard deve rejeitar requisição sem autenticação com status 401");
  console.log("✔ Rota protegida: acesso sem token retorna 401.\n");

  // 3. Testar formato da resposta e indicadores obrigatórios
  console.log("▶ [Etapa 3] Verificando indicadores nos 4 perfis...");
  const profiles = [
    { name: "Administrador", token: admin.token, role: "admin" },
    { name: "Solicitante", token: requester.token, role: "requester" },
    { name: "Validador (Suporte)", token: signer1.token, role: "signer" },
    { name: "Estoque (Espectador)", token: spectator.token, role: "spectator" }
  ];

  const profileResults = {};

  for (const prof of profiles) {
    const res = await request("/dashboard", {
      headers: { Authorization: `Bearer ${prof.token}` }
    });
    assert.equal(res.status, 200, `Falha ao consultar dashboard como ${prof.name}`);
    assert.ok(res.data.metrics, `Dashboard deve conter campo 'metrics' para ${prof.name}`);

    const m = res.data.metrics;
    assert.ok(typeof m.totalOrders === "number", "totalOrders deve ser número");
    assert.ok(typeof m.awaitingValidation === "number", "awaitingValidation deve ser número");
    assert.ok(typeof m.awaitingCorrection === "number", "awaitingCorrection deve ser número");
    assert.ok(typeof m.approved === "number", "approved deve ser número");
    assert.ok(typeof m.divergent === "number", "divergent deve ser número");

    // Verificar que não existem gráficos pesados nem tabelas de ranking no payload
    assert.equal(res.data.movementTimeline, undefined, "movementTimeline deve ter sido removido");
    assert.equal(res.data.topRequesters, undefined, "topRequesters deve ter sido removido");
    assert.equal(res.data.topSigners, undefined, "topSigners deve ter sido removido");

    profileResults[prof.role] = m;
    console.log(`  → ${prof.name} (${prof.role}): Total=${m.totalOrders}, Aguardando validação=${m.awaitingValidation}, Aguardando correção=${m.awaitingCorrection}, Aprovadas=${m.approved}, Divergências=${m.divergent}`);
  }
  console.log("✔ Todos os perfis retornam exatamente os 5 indicadores numéricos reais.\n");

  // 4. Validar escopo de dados por perfil
  console.log("▶ [Etapa 4] Verificando consistência de regras de negócio e escopo por perfil...");
  // Admin vê todas as ordens
  // Validador vê ordens enviadas ao Suporte (status != draft)
  // Estoque vê ordens não-rascunho
  // Solicitante vê ordens criadas por ele
  const adminMetrics = profileResults["admin"];
  const requesterMetrics = profileResults["requester"];
  const signerMetrics = profileResults["signer"];
  const spectatorMetrics = profileResults["spectator"];

  assert.ok(adminMetrics.totalOrders >= signerMetrics.totalOrders, "Admin deve ver total >= Validador");
  assert.ok(adminMetrics.totalOrders >= spectatorMetrics.totalOrders, "Admin deve ver total >= Espectador");
  console.log("✔ Escopos de perfil validados com sucesso.\n");

  // 5. Testar dinamismo dos números com criação e ciclo de vida de OS
  console.log("▶ [Etapa 5] Validando reflexo imediato no dashboard com ciclo de vida de OS...");

  const catRes = await request("/catalog", {
    headers: { Authorization: `Bearer ${requester.token}` }
  });
  const orderType = catRes.data.orderTypes[0]?.name || "Reparo";
  const modelName = catRes.data.terminalModels[0]?.name || "A910";
  const partNumber = catRes.data.partNumbers[0]?.part_number || "PN-D195-01";

  // 5.1 Criar nova OS como rascunho
  const beforeCreate = await request("/dashboard", {
    headers: { Authorization: `Bearer ${requester.token}` }
  });

  const createRes = await request("/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${requester.token}` },
    body: JSON.stringify({
      orderType,
      executorTeam: "suporte",
      authorizedPersonName: "Teste Dashboard Dinamico",
      authorizedPersonDocument: "0099/2026",
      validFrom: "2026-10-15",
      validUntil: "2026-10-25",
      items: [
        {
          itemName: "Item Teste",
          itemIdentifier: modelName,
          partNumber: partNumber,
          clientName: "Cliente Teste",
          quantity: 2,
          configuration: "Config 1"
        }
      ]
    })
  });
  assert.equal(createRes.status, 201, "Falha ao criar ordem para teste de dashboard");
  const createdOrder = createRes.data;

  const afterCreate = await request("/dashboard", {
    headers: { Authorization: `Bearer ${requester.token}` }
  });
  assert.equal(
    afterCreate.data.metrics.totalOrders,
    beforeCreate.data.metrics.totalOrders + 1,
    "totalOrders do Solicitante deve aumentar em 1 ao criar rascunho"
  );
  console.log("  ✔ Total de OS aumentou dinamicamente no dashboard do Solicitante.");

  // 5.2 Enviar ordem para validação
  const beforeSubmitSigner = await request("/dashboard", {
    headers: { Authorization: `Bearer ${signer1.token}` }
  });

  const submitRes = await request(`/orders/${createdOrder.id}/submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requester.token}` }
  });
  assert.equal(submitRes.status, 200, "Falha ao submeter ordem");

  const afterSubmitSigner = await request("/dashboard", {
    headers: { Authorization: `Bearer ${signer1.token}` }
  });
  assert.equal(
    afterSubmitSigner.data.metrics.awaitingValidation,
    beforeSubmitSigner.data.metrics.awaitingValidation + 1,
    "Aguardando validação do Suporte deve aumentar em 1 após envio"
  );
  console.log("  ✔ 'Aguardando validação' aumentou dinamicamente no dashboard do Suporte.");

  // 5.3 Solicitar correção
  const correctionRes = await request(`/orders/${createdOrder.id}/request-correction`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer1.token}` },
    body: JSON.stringify({ message: "Ajustar descrição" })
  });
  assert.equal(correctionRes.status, 200, "Falha ao solicitar correção");

  const afterCorrection = await request("/dashboard", {
    headers: { Authorization: `Bearer ${requester.token}` }
  });
  assert.equal(
    afterCorrection.data.metrics.awaitingCorrection,
    beforeCreate.data.metrics.awaitingCorrection + 1,
    "Aguardando correção deve aumentar em 1"
  );
  console.log("  ✔ 'Aguardando correção' refletido dinamicamente no dashboard.");

  // 5.4 Reenviar ordem após correção
  await request(`/orders/${createdOrder.id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${requester.token}` },
    body: JSON.stringify({
      orderType,
      executorTeam: "suporte",
      authorizedPersonName: "Teste Dashboard Corrigido",
      authorizedPersonDocument: "0099/2026",
      validFrom: "2026-10-15",
      validUntil: "2026-10-25",
      items: [
        {
          itemName: "Item Teste",
          itemIdentifier: modelName,
          partNumber: partNumber,
          clientName: "Cliente Teste",
          quantity: 2,
          configuration: "Config Corrigida"
        }
      ]
    })
  });
  await request(`/orders/${createdOrder.id}/submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requester.token}` }
  });

  // 5.5 Provocar divergência no double check
  const beforeDivergent = await request("/dashboard", {
    headers: { Authorization: `Bearer ${admin.token}` }
  });
  // Validador 1 assina com 10
  await request(`/orders/${createdOrder.id}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer1.token}` },
    body: JSON.stringify({ keyCount: 10 })
  });
  // Validador 2 assina informando 5 (divergente)
  await request(`/orders/${createdOrder.id}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer2.token}` },
    body: JSON.stringify({ keyCount: 5 })
  });

  const afterDivergent = await request("/dashboard", {
    headers: { Authorization: `Bearer ${admin.token}` }
  });
  assert.equal(
    afterDivergent.data.metrics.divergent,
    beforeDivergent.data.metrics.divergent + 1,
    "Divergências no dashboard deve aumentar em 1 quando houver erro de double check"
  );
  console.log("  ✔ 'Divergências' refletido dinamicamente no dashboard após mismatch de double check.");

  // 5.6 Resolver divergência e aprovar a OS
  const beforeApproved = await request("/dashboard", {
    headers: { Authorization: `Bearer ${admin.token}` }
  });
  // Validador 1 assina novamente com 10
  await request(`/orders/${createdOrder.id}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer1.token}` },
    body: JSON.stringify({ keyCount: 10 })
  });
  // Validador 2 assina concordando com 10
  await request(`/orders/${createdOrder.id}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer2.token}` },
    body: JSON.stringify({ keyCount: 10 })
  });

  const afterApproved = await request("/dashboard", {
    headers: { Authorization: `Bearer ${admin.token}` }
  });
  assert.equal(
    afterApproved.data.metrics.approved,
    beforeApproved.data.metrics.approved + 1,
    "Aprovadas deve aumentar em 1 após aprovação final"
  );
  console.log("  ✔ 'Aprovadas' refletido dinamicamente no dashboard após conclusão das validações.");

  // 6. Confirmar que permissões não foram ampliadas indevidamente
  console.log("\n▶ [Etapa 6] Verificando que nenhuma permissão foi ampliada indevidamente...");
  // Estoque não pode criar ordens
  const spectatorCreate = await request("/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${spectator.token}` },
    body: JSON.stringify({
      orderType,
      authorizedPersonName: "Tentativa Invalida",
      items: [{ itemName: "A", itemIdentifier: modelName, partNumber, clientName: "B", quantity: 1, configuration: "Config" }]
    })
  });
  assert.equal(spectatorCreate.status, 403, "Estoque (espectador) NÃO deve conseguir criar ordens (403)");

  // Solicitante não pode assinar ordens
  const requesterSign = await request(`/orders/${createdOrder.id}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requester.token}` },
    body: JSON.stringify({ keyCount: 10 })
  });
  assert.equal(requesterSign.status, 403, "Solicitante NÃO deve conseguir assinar ordens (403)");

  console.log("✔ Permissões verificadas com sucesso: nenhuma permissão foi alterada ou ampliada indevidamente.");

  console.log("\n================================================================================");
  console.log("🎉 TODOS OS TESTES DO DASHBOARD PASSARAM COM SUCESSO!");
  console.log("================================================================================\n");
}

runDashboardTests().catch((err) => {
  console.error("❌ ERRO NO TESTE DO DASHBOARD:", err);
  process.exit(1);
});
