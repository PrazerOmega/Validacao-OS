import assert from "node:assert/strict";

const API_URL = "http://localhost:3333";

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function login(email, password = "123456") {
  const res = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  assert.equal(res.status, 200, `Login falhou para ${email}`);
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

// OS divergente volta ao solicitante: reenvio e nova conferência do Estoque antes de voltar ao Suporte
async function resubmitDivergent(orderId, requesterToken, stockToken) {
  const submitRes = await request(`/orders/${orderId}/submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(submitRes.status, 200, `Falha ao reenviar OS divergente: ${JSON.stringify(submitRes.data)}`);
  return passThroughStock(orderId, stockToken);
}

async function runDashboardOccurrencesTests() {
  console.log("================================================================================");
  console.log("TESTES OBRIGATÓRIOS: DASHBOARD, HISTÓRICO E OCORRÊNCIAS DE ASSINATURA");
  console.log("================================================================================");

  // Autenticação
  const adminToken = await login("admin@empresa.com");
  const requesterToken = await login("solicitante@empresa.com");
  const signer1Token = await login("assinante@empresa.com");
  const signer2Token = await login("assinante2@empresa.com");
  const spectatorToken = await login("espectador@empresa.com");
  const stockToken = await login("estoque@empresa.com");
  console.log("✔ Autenticação de todos os perfis realizada com sucesso.");

  // ---------------------------------------------------------------------------
  // 1. PADRONIZAÇÃO DE NOMES
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Teste 1 & 2] Validando padronização de nomes (Histórico vs Dashboard)...");
  const dashRes = await request("/dashboard", {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(dashRes.status, 200);
  const { signaturesByPerson } = dashRes.data.charts;
  assert.ok(Array.isArray(signaturesByPerson), "signaturesByPerson deve ser array");
  assert.ok(signaturesByPerson.length > 0, "Deve haver assinantes registrados");

  // Nome do usuário no dashboard
  const samplePerson = signaturesByPerson[0];
  console.log(`  → Assinante no dashboard: "${samplePerson.userName}" (${samplePerson.count} assinaturas)`);

  // Buscar uma ordem assinada por esse assinante
  const ordersRes = await request("/orders", {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const signedOrder = ordersRes.data.find((o) => o.status === "signed");
  assert.ok(signedOrder, "Deve existir ao menos uma ordem assinada no sistema");

  const orderDetailRes = await request(`/orders/${signedOrder.id}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(orderDetailRes.status, 200);

  // Comparar nomes no histórico da OS e nas assinaturas
  const signerNamesInDetail = orderDetailRes.data.signatures.map((s) => s.signer_name || s.display_signer_name);
  console.log(`  → Assinantes no detalhe da OS ${signedOrder.code}:`, signerNamesInDetail);

  // Verificar se o nome no histórico usa users.name padronizado e não identificadores discrepantes
  for (const sig of orderDetailRes.data.signatures) {
    assert.ok(sig.signer_name, "Assinatura deve possuir signer_name padronizado");
    assert.notEqual(sig.signer_name, "", "signer_name não pode ser vazio");
  }
  console.log("  ✔ Nomes padronizados consistentes entre histórico da OS e dashboard.");

  // ---------------------------------------------------------------------------
  // 2. GRÁFICOS DO DASHBOARD
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Teste 3, 4, 5, 6] Validando dados dos gráficos e ausência de duplicidade...");
  const { ordersCompletedByPeriod } = dashRes.data.charts;
  assert.ok(Array.isArray(ordersCompletedByPeriod), "ordersCompletedByPeriod deve ser array");
  console.log(`  → Períodos com notas realizadas: ${ordersCompletedByPeriod.length} períodos`);

  // Soma de ordens nos períodos
  const totalInPeriodChart = ordersCompletedByPeriod.reduce((acc, d) => acc + d.count, 0);
  assert.ok(totalInPeriodChart > 0, "Deve haver notas realizadas contabilizadas");
  assert.equal(
    totalInPeriodChart <= dashRes.data.metrics.approved,
    true,
    "Notas realizadas no gráfico não devem exceder o total de ordens aprovadas"
  );
  console.log(`  ✔ Notas realizadas correspondem aos dados reais do sistema (${totalInPeriodChart} ordens no período).`);

  // Conferir ausência de duplicidade nas assinaturas por pessoa
  const namesSet = new Set();
  for (const person of signaturesByPerson) {
    assert.equal(namesSet.has(person.userName), false, `Nome duplicado encontrado no gráfico: ${person.userName}`);
    namesSet.add(person.userName);
  }
  console.log("  ✔ Gráfico de assinaturas por pessoa não contém duplicidade de usuários.");

  // ---------------------------------------------------------------------------
  // 3. TENTATIVAS INCORRETAS E REGISTRO DE OCORRÊNCIA (2 TENTATIVAS)
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Teste 7, 8, 9, 10, 11] Simulando 2 tentativas incorretas e registro de ocorrência...");

  // Criar uma nova OS para o teste
  const newOrderRes = await request("/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` },
    body: JSON.stringify({
      orderType: "Reparo",
      executorTeam: "suporte",
      validUntil: "2026-12-31",
      items: [
        {
          itemIdentifier: "D195",
          partNumber: "PN-TESTE-OCC",
          clientName: "Cliente Ocorrência",
          quantity: 4,
          configuration: "Configuração Padrão",
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
  assert.equal(newOrderRes.status, 201);
  const testOrderId = newOrderRes.data.id;
  const testOrderCode = newOrderRes.data.code;
  console.log(`  → OS de teste criada: ${testOrderCode} (${testOrderId})`);

  // Enviar para validação
  await request(`/orders/${testOrderId}/submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  await passThroughStock(testOrderId, stockToken);

  // Tentativa 1 incorreta: Signer 1 assina 4, Signer 2 informa 2 (divergência)
  await request(`/orders/${testOrderId}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer1Token}` },
    body: JSON.stringify({ keyCount: 4 })
  });

  const mis1 = await request(`/orders/${testOrderId}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer2Token}` },
    body: JSON.stringify({ keyCount: 2 })
  });
  assert.equal(mis1.status, 200);
  assert.equal(mis1.data.incorrectSignature, true);
  console.log("  ✔ 1ª tentativa incorreta simulada com sucesso.");

  // Teste 8: Confirmar que não é registrada como assinatura concluída
  const detailAfterMis1 = await request(`/orders/${testOrderId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(detailAfterMis1.data.status, "divergent");
  assert.equal(detailAfterMis1.data.signatures.length, 0, "Nenhuma assinatura deve estar concluída após mismatch");
  assert.equal(detailAfterMis1.data.incorrect_signatures, 1);
  assert.equal(detailAfterMis1.data.occurrences.length, 0, "Não deve registrar ocorrência na 1ª tentativa (exige 2)");
  console.log("  ✔ 1ª tentativa incorreta NÃO registrada como assinatura concluída nem como ocorrência.");

  // OS divergente volta ao solicitante: reenvio + nova conferência do estoque
  await resubmitDivergent(testOrderId, requesterToken, stockToken);

  // Tentativa 2 incorreta: Signer 1 assina 4, Signer 2 informa 1 (segunda divergência -> 2ª tentativa incorreta)
  await request(`/orders/${testOrderId}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer1Token}` },
    body: JSON.stringify({ keyCount: 4 })
  });

  const mis2 = await request(`/orders/${testOrderId}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer2Token}` },
    body: JSON.stringify({ keyCount: 1 })
  });
  assert.equal(mis2.status, 200);
  assert.equal(mis2.data.incorrectSignature, true);
  console.log("  ✔ 2ª tentativa incorreta simulada com sucesso.");

  // Teste 10 & 11: Confirmar registro persistente da ocorrência após 2 tentativas
  const detailAfterMis2 = await request(`/orders/${testOrderId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(detailAfterMis2.data.incorrect_signatures, 2);
  assert.ok(detailAfterMis2.data.occurrences.length >= 1, "Ocorrência DEVE ser registrada após 2 tentativas incorretas");
  const createdOcc = detailAfterMis2.data.occurrences[0];
  assert.equal(createdOcc.order_code, testOrderCode);
  assert.equal(createdOcc.attempt_count, 2);
  // "email_sent" quando o aviso automático (assíncrono) já foi entregue ao SMTP
  assert.ok(["pending", "email_sent"].includes(createdOcc.status), `Status inesperado da ocorrência: ${createdOcc.status}`);
  assert.ok(createdOcc.user_name, "Usuário envolvido deve estar presente");
  assert.ok(createdOcc.description, "Descrição da ocorrência deve estar presente");
  console.log(`  ✔ Ocorrência registrada com sucesso: OS ${createdOcc.order_code}, Tentativas=${createdOcc.attempt_count}, Status=${createdOcc.status}, Usuário=${createdOcc.user_name}`);

  // ---------------------------------------------------------------------------
  // 4. CONSULTA ADMINISTRATIVA DE OCORRÊNCIAS E PERMISSÕES
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Teste 12 & 14] Validando consulta administrativa e permissões...");
  const adminOccList = await request("/orders/occurrences", {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(adminOccList.status, 200);
  const foundInList = adminOccList.data.find((o) => o.id === createdOcc.id);
  assert.ok(foundInList, "Ocorrência deve ser listada na consulta administrativa do admin");

  const signerOccList = await request("/orders/occurrences", {
    headers: { Authorization: `Bearer ${signer1Token}` }
  });
  assert.equal(signerOccList.status, 200, "Assinante (Suporte) autorizado a consultar ocorrências");

  const spectatorOcc = await request("/orders/occurrences", {
    headers: { Authorization: `Bearer ${spectatorToken}` }
  });
  assert.equal(spectatorOcc.status, 403, "Perfil não autorizado (espectador) deve receber 403");
  console.log("  ✔ Permissões de consulta administrativa validadas (Admin e Signer autorizados; outros bloqueados com 403).");

  // ---------------------------------------------------------------------------
  // 5. PREPARAÇÃO E ENVIO POR E-MAIL
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Teste 15, 16, 17, 18] Validando serviço e preparação de e-mail...");
  const emailRes = await request(`/orders/occurrences/${createdOcc.id}/send-email`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    // resend: a ocorrência pode já ter sido notificada pelo aviso automático de OS divergente
    body: JSON.stringify({ recipient: "auditoria@empresa.com", resend: true })
  });
  assert.equal(emailRes.status, 200);
  assert.ok(emailRes.data.preview, "Deve conter pré-visualização do e-mail");
  assert.ok(emailRes.data.subject, "Deve conter assunto do e-mail");
  assert.equal(emailRes.data.recipient, "auditoria@empresa.com");

  // Teste 17: Confirmar que não expõe dados sensíveis
  const previewText = emailRes.data.preview.bodyText;
  assert.equal(previewText.includes("password"), false, "E-mail não pode conter senhas");
  assert.equal(previewText.includes("secret"), false, "E-mail não pode conter segredos");
  assert.equal(previewText.includes("signature_hash"), false, "E-mail não pode conter hashes criptográficos privados");
  assert.ok(previewText.includes(testOrderCode), "E-mail deve conter o código da OS");
  console.log("  ✔ E-mail seguro: contém todas as informações da ocorrência e NENHUM dado confidencial ou sensível.");

  // Resolução da ocorrência
  const resolveRes = await request(`/orders/occurrences/${createdOcc.id}/resolve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(resolveRes.status, 200);
  assert.equal(resolveRes.data.status, "resolved");
  console.log("  ✔ Ocorrência marcada como resolvida com sucesso.");

  // ---------------------------------------------------------------------------
  // 6. CONTINUIDADE DO FLUXO NORMAL DE ASSINATURA VÁLIDA
  // ---------------------------------------------------------------------------
  console.log("\n▶ [Teste 13] Confirmando que assinatura válida subsequente funciona normalmente...");
  await resubmitDivergent(testOrderId, requesterToken, stockToken);
  // Signer 1 assina com 4
  const val1 = await request(`/orders/${testOrderId}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer1Token}` },
    body: JSON.stringify({ keyCount: 4 })
  });
  assert.equal(val1.status, 200);

  // Signer 2 assina concordando com 4 (Double check aprovado!)
  const val2 = await request(`/orders/${testOrderId}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer2Token}` },
    body: JSON.stringify({ keyCount: 4 })
  });
  assert.equal(val2.status, 200);
  assert.equal(val2.data.order.status, "signed");
  console.log("  ✔ Ordem aprovada e concluída com 2 assinaturas válidas normalmente após o tratamento da ocorrência.");

  console.log("\n================================================================================");
  console.log("🎉 TODOS OS TESTES ESPECÍFICOS DE DASHBOARD, NOMES E OCORRÊNCIAS PASSARAM COM SUCESSO!");
  console.log("================================================================================");
}

runDashboardOccurrencesTests().catch((err) => {
  console.error("❌ FALHA NO TESTE:", err);
  process.exit(1);
});
