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
  assert.equal(res.status, 200, `Login falhou para ${email}: ${JSON.stringify(res.data)}`);
  return res.data.token;
}

async function runTests() {
  console.log("================================================================================");
  console.log("TESTES OBRIGATÓRIOS: OPÇÕES OBRIGATÓRIAS EM CADA ITEM DA OS");
  console.log("================================================================================\n");

  // 1. Autenticação do Solicitante
  console.log("▶ [Etapa 1] Autenticando usuário Solicitante...");
  const requesterToken = await login("solicitante@empresa.com");
  console.log("✔ Solicitante autenticado com sucesso.\n");

  // Obter catálogo para garantir modelo e PN válidos
  const catalogRes = await request("/catalog", {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(catalogRes.status, 200);
  const sampleModel = catalogRes.data.terminalModels[0]?.name || "D195";
  const samplePn = catalogRes.data.partNumbers[0]?.part_number || "PN-D195-01";

  const validOptions1 = {
    packaging: "CAIXA",
    battery: "SIM",
    terminalOpening: "SIM",
    manual: "NÃO",
    charger: "SIM",
    minbase: "NÃO",
    label: "SIM",
    aestheticCover: "NÃO"
  };

  const validOptions2 = {
    packaging: "SACO BOLHA",
    battery: "NÃO",
    terminalOpening: "NÃO",
    manual: "SIM",
    charger: "NÃO",
    minbase: "SIM",
    label: "NÃO",
    aestheticCover: "SIM"
  };

  // 2. Validação no backend com campos pendentes ou inválidos
  console.log("▶ [Etapa 2] Testando bloqueio e validação no backend para campos pendentes/inválidos...");

  // 2.1 Sem EMBALAGEM
  const withoutPackaging = { ...validOptions1 };
  delete withoutPackaging.packaging;
  const res1 = await request("/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` },
    body: JSON.stringify({
      orderType: "Reparo",
      executorTeam: "suporte",
      validFrom: "2026-10-22",
      items: [{ itemIdentifier: sampleModel, partNumber: samplePn, clientName: "Cliente A", quantity: 1, configuration: "C1", ...withoutPackaging }]
    })
  });
  assert.equal(res1.status, 400, "Deve retornar 400 quando EMBALAGEM não for informada");
  assert.match(res1.data.message, /EMBALAGEM/i, "Mensagem deve mencionar EMBALAGEM");
  assert.match(res1.data.message, /Item 1/i, "Mensagem deve indicar que o erro é no Item 1");
  console.log("  ✔ Bloqueio correto para ausência de EMBALAGEM:", res1.data.message);

  // 2.2 EMBALAGEM inválida
  const invalidPackaging = { ...validOptions1, packaging: "PLASTICO" };
  const res2 = await request("/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` },
    body: JSON.stringify({
      orderType: "Reparo",
      executorTeam: "suporte",
      validFrom: "2026-10-22",
      items: [{ itemIdentifier: sampleModel, partNumber: samplePn, clientName: "Cliente A", quantity: 1, configuration: "C1", ...invalidPackaging }]
    })
  });
  assert.equal(res2.status, 400, "Deve retornar 400 para embalagem inválida");
  console.log("  ✔ Bloqueio correto para EMBALAGEM inválida:", res2.data.message);

  // 2.3 Sem BATERIA no Item 2
  const res3 = await request("/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` },
    body: JSON.stringify({
      orderType: "Reparo",
      executorTeam: "suporte",
      validFrom: "2026-10-22",
      items: [
        { itemIdentifier: sampleModel, partNumber: samplePn, clientName: "Cliente A", quantity: 1, configuration: "C1", ...validOptions1 },
        { itemIdentifier: sampleModel, partNumber: samplePn, clientName: "Cliente B", quantity: 1, configuration: "C2", ...validOptions2, battery: "" }
      ]
    })
  });
  assert.equal(res3.status, 400, "Deve retornar 400 para item com BATERIA pendente");
  assert.match(res3.data.message, /Item 2/i, "Mensagem deve indicar Item 2");
  assert.match(res3.data.message, /BATERIA/i, "Mensagem deve indicar campo BATERIA");
  console.log("  ✔ Bloqueio correto indicando Item 2 e campo BATERIA:", res3.data.message);

  // 2.4 Opção binária com valor inválido
  const res4 = await request("/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` },
    body: JSON.stringify({
      orderType: "Reparo",
      executorTeam: "suporte",
      validFrom: "2026-10-22",
      items: [
        { itemIdentifier: sampleModel, partNumber: samplePn, clientName: "Cliente A", quantity: 1, configuration: "C1", ...validOptions1, charger: "TALVEZ" }
      ]
    })
  });
  assert.equal(res4.status, 400, "Deve rejeitar valor diferente de SIM/NÃO");
  assert.match(res4.data.message, /CARREGADOR/i);
  console.log("  ✔ Bloqueio correto para valor binário inválido:", res4.data.message);

  // 3. Criação de OS com múltiplos itens e respostas independentes
  console.log("\n▶ [Etapa 3] Criando OS com múltiplos itens e respostas distintas por item...");
  const createRes = await request("/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${requesterToken}` },
    body: JSON.stringify({
      orderType: "Reparo",
      executorTeam: "producao",
      validFrom: "2026-10-22",
      items: [
        {
          itemIdentifier: sampleModel,
          partNumber: samplePn,
          clientName: "Cliente Multi Item 1",
          quantity: 2,
          configuration: "Configuração Item 1",
          ...validOptions1
        },
        {
          itemIdentifier: sampleModel,
          partNumber: samplePn,
          clientName: "Cliente Multi Item 2",
          quantity: 5,
          configuration: "Configuração Item 2",
          ...validOptions2
        }
      ]
    })
  });
  assert.equal(createRes.status, 201, `Falha ao criar OS: ${JSON.stringify(createRes.data)}`);
  const createdOrder = createRes.data;
  console.log(`✔ OS criada com sucesso: ID=${createdOrder.id}, Código=${createdOrder.code}`);

  // 4. Consulta e validação da recuperação das opções por item
  console.log("\n▶ [Etapa 4] Consultando a OS e validando a integridade das opções em cada item...");
  const getRes = await request(`/orders/${createdOrder.id}`, {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(getRes.status, 200);
  const items = getRes.data.items;
  assert.equal(items.length, 2, "A OS deve possuir exatamente 2 itens");

  const item1 = items[0];
  const item2 = items[1];

  console.log("  → Item 1 recuperado:", {
    packaging: item1.packaging,
    battery: item1.battery,
    terminal_opening: item1.terminal_opening,
    manual: item1.manual,
    charger: item1.charger,
    minbase: item1.minbase,
    label: item1.label,
    aesthetic_cover: item1.aesthetic_cover
  });

  console.log("  → Item 2 recuperado:", {
    packaging: item2.packaging,
    battery: item2.battery,
    terminal_opening: item2.terminal_opening,
    manual: item2.manual,
    charger: item2.charger,
    minbase: item2.minbase,
    label: item2.label,
    aesthetic_cover: item2.aesthetic_cover
  });

  // Validar Item 1
  assert.equal(item1.packaging, "CAIXA", "Item 1 packaging deve ser CAIXA");
  assert.equal(item1.battery, "SIM", "Item 1 battery deve ser SIM");
  assert.equal(item1.terminal_opening, "SIM", "Item 1 terminal_opening deve ser SIM");
  assert.equal(item1.manual, "NÃO", "Item 1 manual deve ser NÃO");
  assert.equal(item1.charger, "SIM", "Item 1 charger deve ser SIM");
  assert.equal(item1.minbase, "NÃO", "Item 1 minbase deve ser NÃO");
  assert.equal(item1.label, "SIM", "Item 1 label deve ser SIM");
  assert.equal(item1.aesthetic_cover, "NÃO", "Item 1 aesthetic_cover deve ser NÃO");

  // Validar Item 2 (respostas completamente independentes)
  assert.equal(item2.packaging, "SACO BOLHA", "Item 2 packaging deve ser SACO BOLHA");
  assert.equal(item2.battery, "NÃO", "Item 2 battery deve ser NÃO");
  assert.equal(item2.terminal_opening, "NÃO", "Item 2 terminal_opening deve ser NÃO");
  assert.equal(item2.manual, "SIM", "Item 2 manual deve ser SIM");
  assert.equal(item2.charger, "NÃO", "Item 2 charger deve ser NÃO");
  assert.equal(item2.minbase, "SIM", "Item 2 minbase deve ser SIM");
  assert.equal(item2.label, "NÃO", "Item 2 label deve ser NÃO");
  assert.equal(item2.aesthetic_cover, "SIM", "Item 2 aesthetic_cover deve ser SIM");
  console.log("✔ Todos os campos do Item 1 e Item 2 foram persistidos e recuperados de forma 100% independente.");

  // 5. Teste de Edição (PUT /orders/:id)
  console.log("\n▶ [Etapa 5] Testando atualização das opções via PUT /orders/:id...");
  const updateRes = await request(`/orders/${createdOrder.id}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${requesterToken}` },
    body: JSON.stringify({
      orderType: "Reparo",
      executorTeam: "producao",
      items: [
        {
          itemIdentifier: sampleModel,
          partNumber: samplePn,
          clientName: "Cliente Atualizado",
          quantity: 3,
          configuration: "Config Atualizada",
          packaging: "SACO BOLHA", // alterado de CAIXA para SACO BOLHA
          battery: "NÃO",          // alterado de SIM para NÃO
          terminalOpening: "NÃO",
          manual: "SIM",
          charger: "NÃO",
          minbase: "SIM",
          label: "NÃO",
          aestheticCover: "SIM"
        }
      ]
    })
  });
  assert.equal(updateRes.status, 200, "Edição deve ter sucesso");

  const getUpdated = await request(`/orders/${createdOrder.id}`, {
    headers: { Authorization: `Bearer ${requesterToken}` }
  });
  assert.equal(getUpdated.data.items.length, 1);
  assert.equal(getUpdated.data.items[0].packaging, "SACO BOLHA");
  assert.equal(getUpdated.data.items[0].battery, "NÃO");
  console.log("✔ Edição de opções atualizada com sucesso no banco de dados.");

  console.log("\n================================================================================");
  console.log("🎉 TODOS OS TESTES DE OPÇÕES OBRIGATÓRIAS EM ITENS PASSARAM COM 100% DE SUCESSO!");
  console.log("================================================================================\n");
}

runTests().catch((err) => {
  console.error("❌ Falha nos testes de opções obrigatórias:", err);
  process.exit(1);
});
