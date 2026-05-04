import express from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { addOrderEvent } from "../utils/audit.js";
import { buildSignature } from "../utils/signature.js";

export const ordersRouter = express.Router();

const orderSchema = z.object({
  itemName: z.string().min(2),
  itemIdentifier: z.string().min(1),
  authorizedPersonName: z.string().min(2),
  authorizedPersonDocument: z.string().min(3),
  usageReason: z.string().min(5),
  validFrom: z.string().min(10),
  validUntil: z.string().min(10),
  signerId: z.string().uuid().optional().nullable()
});

const feedbackSchema = z.object({
  message: z.string().min(5)
});

function canSeeOrder(user, order) {
  return (
    user.role === "admin" ||
    order.requester_id === user.id ||
    order.signer_id === user.id
  );
}

async function findOrder(id) {
  const { rows } = await query(
    `SELECT so.*, requester.name AS requester_name, signer.name AS signer_name
     FROM service_orders so
     JOIN users requester ON requester.id = so.requester_id
     LEFT JOIN users signer ON signer.id = so.signer_id
     WHERE so.id = $1`,
    [id]
  );
  return rows[0];
}

ordersRouter.get("/", async (req, res) => {
  const filters = [];
  const params = [];

  if (req.user.role === "requester") {
    params.push(req.user.id);
    filters.push(`so.requester_id = $${params.length}`);
  }

  if (req.user.role === "signer") {
    params.push(req.user.id);
    filters.push(`so.signer_id = $${params.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT so.*, requester.name AS requester_name, signer.name AS signer_name
     FROM service_orders so
     JOIN users requester ON requester.id = so.requester_id
     LEFT JOIN users signer ON signer.id = so.signer_id
     ${where}
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
  const { rows } = await query(
    `INSERT INTO service_orders (
       code, item_name, item_identifier, authorized_person_name,
       authorized_person_document, usage_reason, valid_from, valid_until,
       requester_id, signer_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      code,
      values.itemName,
      values.itemIdentifier,
      values.authorizedPersonName,
      values.authorizedPersonDocument,
      values.usageReason,
      values.validFrom,
      values.validUntil,
      req.user.id,
      values.signerId
    ]
  );

  await addOrderEvent({
    orderId: rows[0].id,
    actorId: req.user.id,
    eventType: "created",
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

  const [events, signatures] = await Promise.all([
    query(
      `SELECT oe.*, users.name AS actor_name
       FROM order_events oe
       JOIN users ON users.id = oe.actor_id
       WHERE service_order_id = $1
       ORDER BY oe.created_at ASC`,
      [order.id]
    ),
    query(
      `SELECT os.*, users.name AS signer_name, users.email AS signer_email
       FROM order_signatures os
       JOIN users ON users.id = os.signer_id
       WHERE service_order_id = $1
       ORDER BY os.signed_at DESC`,
      [order.id]
    )
  ]);

  return res.json({ ...order, events: events.rows, signatures: signatures.rows });
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
  const { rows } = await query(
    `UPDATE service_orders
     SET item_name = $1, item_identifier = $2, authorized_person_name = $3,
         authorized_person_document = $4, usage_reason = $5, valid_from = $6,
         valid_until = $7, signer_id = $8, status = 'draft', updated_at = NOW()
     WHERE id = $9
     RETURNING *`,
    [
      values.itemName,
      values.itemIdentifier,
      values.authorizedPersonName,
      values.authorizedPersonDocument,
      values.usageReason,
      values.validFrom,
      values.validUntil,
      values.signerId,
      order.id
    ]
  );

  await addOrderEvent({
    orderId: order.id,
    actorId: req.user.id,
    eventType: "updated",
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

  if (!order.signer_id) {
    return res.status(409).json({ message: "Selecione um assinante antes de enviar." });
  }

  if (!["draft", "correction_requested"].includes(order.status)) {
    return res.status(409).json({ message: "Ordem nao pode ser enviada neste status." });
  }

  const { rows } = await query(
    "UPDATE service_orders SET status = 'pending_signature', updated_at = NOW() WHERE id = $1 RETURNING *",
    [order.id]
  );

  await addOrderEvent({
    orderId: order.id,
    actorId: req.user.id,
    eventType: "submitted",
    message: "Ordem enviada para assinatura."
  });

  return res.json(rows[0]);
});

ordersRouter.post("/:id/request-correction", requireRole("signer", "admin"), async (req, res) => {
  const order = await findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: "Ordem nao encontrada." });
  }

  if (req.user.role !== "admin" && order.signer_id !== req.user.id) {
    return res.status(403).json({ message: "Permissao insuficiente." });
  }

  if (order.status !== "pending_signature") {
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

  await addOrderEvent({
    orderId: order.id,
    actorId: req.user.id,
    eventType: "correction_requested",
    message: parsed.data.message
  });

  return res.json(rows[0]);
});

ordersRouter.post("/:id/sign", requireRole("signer", "admin"), async (req, res) => {
  const order = await findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: "Ordem nao encontrada." });
  }

  if (req.user.role !== "admin" && order.signer_id !== req.user.id) {
    return res.status(403).json({ message: "Permissao insuficiente." });
  }

  if (order.status !== "pending_signature") {
    return res.status(409).json({ message: "Apenas ordens pendentes podem ser assinadas." });
  }

  const ipAddress = req.ip;
  const userAgent = req.headers["user-agent"] ?? "";
  const { payload, signatureHash } = buildSignature({
    order,
    signer: req.user,
    ipAddress,
    userAgent
  });

  await query(
    `INSERT INTO order_signatures (service_order_id, signer_id, signature_hash, signed_payload, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [order.id, req.user.id, signatureHash, payload, ipAddress, userAgent]
  );

  const { rows } = await query(
    "UPDATE service_orders SET status = 'signed', updated_at = NOW() WHERE id = $1 RETURNING *",
    [order.id]
  );

  await addOrderEvent({
    orderId: order.id,
    actorId: req.user.id,
    eventType: "signed",
    message: "Ordem assinada digitalmente.",
    metadata: { signatureHash }
  });

  return res.json({ order: rows[0], signatureHash });
});
