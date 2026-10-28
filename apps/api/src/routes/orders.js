import express from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { addOrderEvent } from "../utils/audit.js";
import { buildSignature } from "../utils/signature.js";

export const ordersRouter = express.Router();

const orderItemSchema = z.object({
  itemName: z.string().min(1),
  itemIdentifier: z.string().trim().min(1),
  partNumber: z.string().trim().min(1),
  clientName: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive(),
  configuration: z.string().min(1)
});

const orderSchema = z.object({
  orderType: z.string().trim().min(1),
  authorizedPersonName: z.string().min(2),
  authorizedPersonDocument: z.string().min(3),
  validUntil: z.string().min(10).optional().nullable(),
  destinationRole: z.enum(["signer"]).optional().default("signer"),
  items: z.array(orderItemSchema).min(1)
});

const feedbackSchema = z.object({
  message: z.string().min(5)
});

const signatureSchema = z.object({
  signerName: z.string().min(2)
});

const stockStatusSchema = z.object({
  status: z.enum(["pending", "unavailable", "separating", "separated"]),
  note: z.string().trim().max(500).optional().nullable()
});

const stockStatusLabels = {
  pending: "Pendente",
  unavailable: "Sem estoque",
  separating: "Em separacao",
  separated: "Separado"
};

function canSeeOrder(user, order) {
  return (
    user.role === "admin" ||
    user.role === "spectator" ||
    (user.role === "stock" && order.status !== "draft") ||
    order.requester_id === user.id ||
    order.destination_role === user.role
  );
}

async function findOrder(id) {
  const { rows } = await query(
    `SELECT so.*, requester.name AS requester_name
     FROM service_orders so
     JOIN users requester ON requester.id = so.requester_id
     WHERE so.id = $1`,
    [id]
  );
  return rows[0];
}

function defaultValidUntil() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}

async function validateCatalogOptions(values) {
  const [orderType, terminalModels] = await Promise.all([
    query("SELECT id FROM order_types WHERE name = $1 AND active = TRUE", [values.orderType]),
    query("SELECT name FROM terminal_models WHERE active = TRUE")
  ]);

  if (!orderType.rows[0]) {
    return "Tipo de ordem nao cadastrado.";
  }

  const validModels = new Set(terminalModels.rows.map((row) => row.name));
  const invalidModel = values.items.find((item) => !validModels.has(item.itemIdentifier));

  if (invalidModel) {
    return `Modelo do terminal nao cadastrado: ${invalidModel.itemIdentifier}.`;
  }

  return null;
}

async function replaceOrderItems(orderId, items) {
  await query("DELETE FROM order_items WHERE service_order_id = $1", [orderId]);

  for (const item of items) {
    await query(
      `INSERT INTO order_items (
         service_order_id, item_name, terminal_model, part_number, client_name, quantity, configuration
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        orderId,
        item.itemName,
        item.itemIdentifier,
        item.partNumber,
        item.clientName,
        item.quantity,
        item.configuration
      ]
    );
  }
}

ordersRouter.get("/", async (req, res) => {
  const filters = [];
  const params = [];

  if (req.user.role === "requester") {
    params.push(req.user.id);
    filters.push(`so.requester_id = $${params.length}`);
  }

  if (req.user.role === "signer") {
    params.push(req.user.role);
    filters.push(`so.destination_role = $${params.length}`);
  }

  if (req.user.role === "spectator") {
    filters.push("TRUE");
  }

  if (req.user.role === "stock") {
    filters.push("so.status <> 'draft'");
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT so.*, requester.name AS requester_name,
            (SELECT COALESCE(SUM(quantity), 0)::int FROM order_items WHERE service_order_id = so.id) AS total_quantity,
            (SELECT COUNT(*)::int FROM order_items WHERE service_order_id = so.id) AS item_count,
            (SELECT COUNT(*)::int FROM order_items WHERE service_order_id = so.id AND stock_status = 'separated') AS separated_count,
            (SELECT STRING_AGG(DISTINCT terminal_model, ', ') FROM order_items WHERE service_order_id = so.id) AS terminal_models,
            (SELECT STRING_AGG(DISTINCT part_number, ', ') FROM order_items WHERE service_order_id = so.id) AS part_numbers,
            (SELECT STRING_AGG(DISTINCT client_name, ', ') FROM order_items WHERE service_order_id = so.id) AS client_names,
            (SELECT COUNT(*)::int FROM order_signatures WHERE service_order_id = so.id) AS signature_count
     FROM service_orders so
     JOIN users requester ON requester.id = so.requester_id
     ${where}
     GROUP BY so.id, requester.name
     ORDER BY so.updated_at DESC`,
    params
  );

  return res.json(rows);
});

ordersRouter.post("/", requireRole("requester", "admin"), async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: "Dados da ordem invalidos." });
  }

  const code = `OS-${Date.now()}`;
  const values = parsed.data;
  const firstItem = values.items[0];
  const catalogError = await validateCatalogOptions(values);

  if (catalogError) {
    return res.status(400).json({ message: catalogError });
  }

  const { rows } = await query(
    `INSERT INTO service_orders (
       code, order_type, item_name, item_identifier, authorized_person_name,
       authorized_person_document, usage_reason, valid_from, valid_until,
       requester_id, destination_role
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, $8, $9, $10)
     RETURNING *`,
    [
      code,
      values.orderType,
      firstItem.itemName,
      firstItem.itemIdentifier,
      values.authorizedPersonName,
      values.authorizedPersonDocument,
      firstItem.configuration,
      values.validUntil ?? defaultValidUntil(),
      req.user.id,
      "signer"
    ]
  );

  await replaceOrderItems(rows[0].id, values.items);

  await addOrderEvent({
    orderId: rows[0].id,
    actorId: req.user.id,
    eventType: "Criação",
    message: "Ordem criada."
  });

  return res.status(201).json(rows[0]);
});

ordersRouter.get("/:id", async (req, res) => {
  const order = await findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: "Ordem nao encontrada." });
  }

  if (!canSeeOrder(req.user, order)) {
    return res.status(403).json({ message: "Permissao insuficiente." });
  }

  const [events, signatures, items] = await Promise.all([
    query(
      `SELECT oe.*, users.name AS actor_name
       FROM order_events oe
       JOIN users ON users.id = oe.actor_id
       WHERE service_order_id = $1
       ORDER BY oe.created_at ASC`,
      [order.id]
    ),
    query(
      `SELECT os.*, COALESCE(os.signer_name, users.name) AS display_signer_name,
              users.name AS user_name, users.email AS signer_email
       FROM order_signatures os
       JOIN users ON users.id = os.signer_id
       WHERE service_order_id = $1
       ORDER BY os.signed_at DESC`,
      [order.id]
    ),
    query(
      `SELECT oi.id, oi.item_name, oi.terminal_model, oi.part_number, oi.client_name, oi.quantity,
              oi.configuration, oi.created_at, oi.stock_status, oi.stock_note, oi.stock_updated_at,
              stock_user.name AS stock_updated_by_name
       FROM order_items oi
       LEFT JOIN users stock_user ON stock_user.id = oi.stock_updated_by
       WHERE oi.service_order_id = $1
       ORDER BY oi.created_at ASC, oi.id ASC`,
      [order.id]
    )
  ]);

  return res.json({ ...order, events: events.rows, signatures: signatures.rows, items: items.rows });
});

ordersRouter.put("/:id", requireRole("requester", "admin"), async (req, res) => {
  const order = await findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: "Ordem nao encontrada." });
  }

  if (req.user.role !== "admin" && order.requester_id !== req.user.id) {
    return res.status(403).json({ message: "Permissao insuficiente." });
  }

  if (!["draft", "correction_requested"].includes(order.status)) {
    return res.status(409).json({ message: "Apenas rascunhos ou ordens em correcao podem ser editadas." });
  }

  const parsed = orderSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: "Dados da ordem invalidos." });
  }

  const values = parsed.data;
  const firstItem = values.items[0];
  const catalogError = await validateCatalogOptions(values);

  if (catalogError) {
    return res.status(400).json({ message: catalogError });
  }

  const { rows } = await query(
    `UPDATE service_orders
     SET order_type = $1, item_name = $2, item_identifier = $3, authorized_person_name = $4,
         authorized_person_document = $5, usage_reason = $6, valid_from = $7,
         valid_until = $8, destination_role = $9, status = 'draft', updated_at = NOW()
     WHERE id = $10
     RETURNING *`,
    [
      values.orderType,
      firstItem.itemName,
      firstItem.itemIdentifier,
      values.authorizedPersonName,
      values.authorizedPersonDocument,
      firstItem.configuration,
      order.valid_from,
      values.validUntil ?? order.valid_until ?? defaultValidUntil(),
      "signer",
      order.id
    ]
  );

  await replaceOrderItems(order.id, values.items);

  await addOrderEvent({
    orderId: order.id,
    actorId: req.user.id,
    eventType: "Atualizada",
    message: "Ordem atualizada."
  });

  return res.json(rows[0]);
});

ordersRouter.post("/:id/submit", requireRole("requester", "admin"), async (req, res) => {
  const order = await findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: "Ordem nao encontrada." });
  }

  if (req.user.role !== "admin" && order.requester_id !== req.user.id) {
    return res.status(403).json({ message: "Permissao insuficiente." });
  }

  if (!["draft", "correction_requested"].includes(order.status)) {
    return res.status(409).json({ message: "Ordem nao pode ser enviada neste status." });
  }

  const { rows } = await query(
    "UPDATE service_orders SET status = 'awaiting_stock', updated_at = NOW() WHERE id = $1 RETURNING *",
    [order.id]
  );

  await addOrderEvent({
    orderId: order.id,
    actorId: req.user.id,
    eventType: "Enviada ao estoque",
    message: "Ordem enviada ao estoque para separacao dos terminais."
  });

  return res.json(rows[0]);
});

ordersRouter.patch("/:id/items/:itemId/stock", requireRole("stock"), async (req, res) => {
  const order = await findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: "Ordem nao encontrada." });
  }

  if (order.status !== "awaiting_stock") {
    return res.status(409).json({ message: "Apenas ordens aguardando estoque podem ter a separacao alterada." });
  }

  const parsed = stockStatusSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: "Status de separacao invalido." });
  }

  const note = parsed.data.note || null;
  const { rows } = await query(
    `UPDATE order_items
     SET stock_status = $1, stock_note = $2, stock_updated_at = NOW(), stock_updated_by = $3
     WHERE id = $4 AND service_order_id = $5
     RETURNING *`,
    [parsed.data.status, note, req.user.id, req.params.itemId, order.id]
  );

  if (!rows[0]) {
    return res.status(404).json({ message: "Item nao encontrado nesta ordem." });
  }

  await query("UPDATE service_orders SET updated_at = NOW() WHERE id = $1", [order.id]);

  const item = rows[0];
  await addOrderEvent({
    orderId: order.id,
    actorId: req.user.id,
    eventType: "Estoque",
    message: `${item.terminal_model} (PN ${item.part_number}, qtd ${item.quantity}): ${stockStatusLabels[item.stock_status]}${note ? ` - ${note}` : ""}`,
    metadata: { itemId: item.id, stockStatus: item.stock_status }
  });

  return res.json(item);
});

ordersRouter.post("/:id/send-to-signature", requireRole("stock"), async (req, res) => {
  const order = await findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: "Ordem nao encontrada." });
  }

  if (order.status !== "awaiting_stock") {
    return res.status(409).json({ message: "Apenas ordens aguardando estoque podem ser enviadas para assinatura." });
  }

  const pending = await query(
    "SELECT COUNT(*)::int AS count FROM order_items WHERE service_order_id = $1 AND stock_status <> 'separated'",
    [order.id]
  );

  if (pending.rows[0].count > 0) {
    return res.status(409).json({ message: "Todos os itens precisam estar separados antes de enviar para assinatura." });
  }

  const { rows } = await query(
    "UPDATE service_orders SET status = 'pending_signature', updated_at = NOW() WHERE id = $1 RETURNING *",
    [order.id]
  );

  await addOrderEvent({
    orderId: order.id,
    actorId: req.user.id,
    eventType: "Enviada",
    message: "Terminais separados. Ordem enviada para assinatura do suporte."
  });

  return res.json(rows[0]);
});

ordersRouter.post("/:id/request-correction", requireRole("signer", "stock"), async (req, res) => {
  const order = await findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: "Ordem nao encontrada." });
  }

  const isStock = req.user.role === "stock";

  if (!isStock && order.destination_role !== req.user.role) {
    return res.status(403).json({ message: "Permissao insuficiente." });
  }

  if (order.status !== (isStock ? "awaiting_stock" : "pending_signature")) {
    return res.status(409).json({ message: "Apenas ordens pendentes podem receber devolutiva." });
  }

  const parsed = feedbackSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: "Informe uma devolutiva." });
  }

  const { rows } = await query(
    "UPDATE service_orders SET status = 'correction_requested', updated_at = NOW() WHERE id = $1 RETURNING *",
    [order.id]
  );

  await query("DELETE FROM order_signatures WHERE service_order_id = $1", [order.id]);

  await addOrderEvent({
    orderId: order.id,
    actorId: req.user.id,
    eventType: "Correção nescessaria",
    message: parsed.data.message
  });

  return res.json(rows[0]);
});

ordersRouter.post("/:id/sign", requireRole("signer"), async (req, res) => {
  const order = await findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: "Ordem nao encontrada." });
  }

  if (order.destination_role !== req.user.role) {
    return res.status(403).json({ message: "Permissao insuficiente." });
  }

  if (order.status !== "pending_signature") {
    return res.status(409).json({ message: "Apenas ordens pendentes podem ser assinadas." });
  }

  const parsed = signatureSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: "Informe o nome de quem esta assinando." });
  }

  const existingSignatures = await query(
    "SELECT * FROM order_signatures WHERE service_order_id = $1 ORDER BY signed_at ASC",
    [order.id]
  );

  if (existingSignatures.rows.some((signature) => signature.signer_id === req.user.id)) {
    return res.status(409).json({ message: "Este usuario ja assinou esta ordem." });
  }

  const ipAddress = req.ip;
  const userAgent = req.headers["user-agent"] ?? "";
  const { payload, signatureHash } = buildSignature({
    order,
    signer: req.user,
    signerName: parsed.data.signerName,
    ipAddress,
    userAgent
  });

  await query(
    `INSERT INTO order_signatures (service_order_id, signer_id, signer_name, signature_hash, signed_payload, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [order.id, req.user.id, parsed.data.signerName, signatureHash, payload, ipAddress, userAgent]
  );

  const signatureCount = existingSignatures.rows.length + 1;
  const nextStatus = signatureCount >= 2 ? "signed" : "pending_signature";
  const { rows } = await query(
    "UPDATE service_orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
    [nextStatus, order.id]
  );

  await addOrderEvent({
    orderId: order.id,
    actorId: req.user.id,
    eventType: "Assinada",
    message: signatureCount >= 2 ? "Ordem aprovada com duas assinaturas." : "Primeira assinatura registrada. Aguardando segunda assinatura.",
    metadata: { signatureHash, signerName: parsed.data.signerName, signatureCount }
  });

  return res.json({ order: rows[0], signatureHash, signatureCount });
});
