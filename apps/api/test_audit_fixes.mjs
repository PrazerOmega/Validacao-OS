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
  assert.equal(res.status, 200, `Login failed for ${email}`);
  return res.data.token;
}

async function runAuditValidationTests() {
  console.log("================================================================================");
  console.log("TESTES ESPECÍFICOS DAS CORREÇÕES DA AUDITORIA");
  console.log("================================================================================");

  // 1. Obter tokens reais dos usuários existentes
  const adminToken = await login("admin@empresa.com");
  const requesterToken = await login("solicitante@empresa.com");
  const signerToken = await login("assinante@empresa.com");
  const signer2Token = await login("assinante2@empresa.com");

  // Teste 1: Duplicação de e-mail retorna 409 amigável
  console.log("▶ [Fix 1] Testando tratamento de e-mail duplicado...");
  const dupRes = await request("/users", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({
      name: "Teste Duplicado",
      email: "solicitante@empresa.com",
      password: "password123",
      role: "requester"
    })
  });
  assert.equal(dupRes.status, 409, "Deveria retornar 409 Conflict para e-mail duplicado");
  assert.equal(dupRes.data.message, "Este e-mail já está em uso por outro usuário.");
  console.log("  ✔ E-mail duplicado tratado com status 409 e mensagem clara.");

  // Teste 2: Catálogo não poluído por part number customizado
  console.log("▶ [Fix 2] Testando proteção do catálogo contra injeção de Part Number...");
  const customPn = `PN-CUSTOM-${Date.now()}`;
  const createOrderRes = await request("/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` },
    body: JSON.stringify({
      orderType: "Reparo",
      executorTeam: "suporte",
      validUntil: "2026-12-31",
      items: [
        {
          itemIdentifier: "D195",
          partNumber: customPn,
          clientName: "Cliente Audit",
          quantity: 2,
          configuration: "Config Audit",
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
  assert.equal(createOrderRes.status, 201, "Ordem com PN customizado criada com sucesso");
  const orderId = createOrderRes.data.id;

  const catalogRes = await request("/catalog", {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  const catalogHasPn = catalogRes.data.partNumbers.some((pn) => pn.part_number === customPn);
  assert.equal(catalogHasPn, false, "Catálogo global NÃO deve conter part number customizado");
  console.log("  ✔ Catálogo protegido: Part Number customizado gravado na OS mas não inserido na tabela global.");

  // Teste 3: Preenchimento de signer_id e second_signer_id na tabela service_orders
  console.log("▶ [Fix 3] Testando preenchimento de signer_id e second_signer_id no double check...");
  await request(`/orders/${orderId}/submit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` }
  });

  const sign1Res = await request(`/orders/${orderId}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signerToken}` },
    body: JSON.stringify({ keyCount: 5 })
  });
  assert.equal(sign1Res.status, 200);
  assert.ok(sign1Res.data.order.signer_id, "signer_id deve ser preenchido na 1ª assinatura");

  const sign2Res = await request(`/orders/${orderId}/sign`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signer2Token}` },
    body: JSON.stringify({ keyCount: 5 })
  });
  assert.equal(sign2Res.status, 200);
  assert.ok(sign2Res.data.order.second_signer_id, "second_signer_id deve ser preenchido na 2ª assinatura");
  assert.equal(sign2Res.data.order.status, "signed");
  console.log("  ✔ signer_id e second_signer_id preenchidos corretamente no banco de dados.");

  // Teste 4: Tentativa não autorizada de revogar assinatura por usuário não-admin
  console.log("▶ [Fix 4] Testando restrição de revogação de ordem assinada por não-admin...");
  const revokeSignerRes = await request(`/orders/${orderId}/incorrect-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${signerToken}` }
  });
  assert.equal(revokeSignerRes.status, 403, "Validador comum não pode revogar ordem já assinada");
  console.log("  ✔ Revogação arbitrária bloqueada com erro 403 para usuários não-administradores.");

  // Teste 5: GET /orders/divergent lista ordens com apontamentos divergentes
  console.log("▶ [Fix 5] Testando endpoint GET /orders/divergent...");
  const divergentListRes = await request("/orders/divergent", {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(divergentListRes.status, 200);
  assert.ok(Array.isArray(divergentListRes.data), "Deve retornar array de divergências");
  console.log(`  ✔ GET /orders/divergent retornou ${divergentListRes.data.length} ordens divergentes com dados auditados.`);

  console.log("================================================================================");
  console.log("🎉 TODOS OS TESTES ESPECÍFICOS DE AUDITORIA PASSARAM COM 100% DE SUCESSO!");
  console.log("================================================================================");
}

runAuditValidationTests().catch((err) => {
  console.error("❌ Erro no teste de auditoria:", err);
  process.exit(1);
});
