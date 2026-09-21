import express from "express";
import { z } from "zod";
import { pool, query } from "../db/pool.js";
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
  authorizedPersonName: z.string().optional(),
  authorizedPersonDocument: z.string().optional(),
  validUntil: z.string().min(10).optional().nullable(),
  destinationRole: z.enum(["signer"]).optional().default("signer"),
  items: z.array(orderItemSchema).min(1)
});

const feedbackSchema = z.object({
  message: z.string().min(5)
});

const signatureSchema = z.object({
  keyCount: z.union([z.number(), z.string()])
    .refine((val) => {
      const str = String(val).trim();
      return /^\d+$/.test(str) && Number(str) > 0 && Number.isSafeInteger(Number(str));
    }, { message: "A quantidade de chaves deve ser um número inteiro positivo." })
    .transform((val) => Number(val))
});

function canSeeOrder(user, order) {
  return (
    user.role === "admin" ||
    user.role === "spectator" ||
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
  const [orderType, terminalModels, partNumbers] = await Promise.all([
    query("SELECT id FROM order_types WHERE name = $1 AND active = TRUE", [values.orderType]),
    query("SELECT name FROM terminal_models WHERE active = TRUE"),
    query(
      `SELECT tm.name AS model_name, pn.part_number
       FROM part_numbers pn
       JOIN terminal_models tm ON tm.id = pn.terminal_model_id
       WHERE pn.active = TRUE AND tm.active = TRUE`
    )
  ]);

  if (!orderType.rows[0]) {
    return "Tipo de ordem não cadastrado.";
  }

  const validModels = new Set(terminalModels.rows.map((row) => row.name));
  const validModelPartNumbers = new Set(
    partNumbers.rows.map((row) => `${row.model_name}:::${row.part_number}`)
  );

  for (const item of values.items) {
    if (!validModels.has(item.itemIdentifier)) {
      return `Modelo do terminal não cadastrado: ${item.itemIdentifier}.`;
    }
    const key = `${item.itemIdentifier}:::${item.partNumber}`;
    if (!validModelPartNumbers.has(key)) {
      return `Part Number "${item.partNumber}" não é permitido ou não está cadastrado para o modelo "${item.itemIdentifier}".`;
    }
  }

  return null;
}

async function replaceOrderItems(orderId, items, dbClient = { query }) {
  await dbClient.query("DELETE FROM order_items WHERE service_order_id = $1", [orderId]);

  for (const item of items) {
    await dbClient.query(
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

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT so.*, requester.name AS requester_name,
            (SELECT COALESCE(SUM(quantity), 0)::int FROM order_items WHERE service_order_id = so.id) AS total_quantity,
            (SELECT COUNT(*)::int FROM order_items WHERE service_order_id = so.id) AS item_count,
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

  const values = parsed.data;
  const firstItem = values.items[0];
  const catalogError = await validateCatalogOptions(values);

  if (catalogError) {
    return res.status(400).json({ message: catalogError });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const currentYear = new Date().getFullYear();
    const seqRes = await client.query(
      `INSERT INTO os_sequences (year, last_value)
       VALUES ($1, 1)
       ON CONFLICT (year) DO UPDATE
       SET last_value = os_sequences.last_value + 1
       RETURNING last_value`,
      [currentYear]
    );

    const sequenceNumber = seqRes.rows[0].last_value;
    const formattedSeq = String(sequenceNumber).padStart(4, "0");
    const code = `${formattedSeq}/${currentYear}`;

    // Solicitante é sempre o usuário logado
    const requesterName = req.user.name;

    const { rows } = await client.query(
      `INSERT INTO service_orders (
         code, order_year, order_sequence, order_type, item_name, item_identifier,
         authorized_person_name, authorized_person_document, usage_reason,
         valid_from, valid_until, requester_id, destination_role
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, $10, $11, $12)
       RETURNING *`,
      [
        code,
        currentYear,
        sequenceNumber,
        values.orderType,
        firstItem.itemName,
        firstItem.itemIdentifier,
        requesterName,
        code,
        firstItem.configuration,
        values.validUntil ?? defaultValidUntil(),
        req.user.id,
        "signer"
      ]
    );

    await replaceOrderItems(rows[0].id, values.items, client);

    await client.query("COMMIT");

    await addOrderEvent({
      orderId: rows[0].id,
      actorId: req.user.id,
      eventType: "Criação",
      message: `Ordem ${code} criada por ${requesterName}.`
    });

    return res.status(201).json(rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

ordersRouter.get("/divergent", requireRole("admin"), async (req, res) => {
  const { rows } = await query(
    `SELECT so.*, requester.name AS requester_name,
            (SELECT COALESCE(SUM(quantity), 0)::int FROM order_items WHERE service_order_id = so.id) AS total_quantity,
            (SELECT COUNT(*)::int FROM order_items WHERE service_order_id = so.id) AS item_count,
            (SELECT STRING_AGG(DISTINCT terminal_model, ', ') FROM order_items WHERE service_order_id = so.id) AS terminal_models,
            (SELECT STRING_AGG(DISTINCT part_number, ', ') FROM order_items WHERE service_order_id = so.id) AS part_numbers,
            (SELECT STRING_AGG(DISTINCT client_name, ', ') FROM order_items WHERE service_order_id = so.id) AS client_names,
            (SELECT COUNT(*)::int FROM order_signatures WHERE service_order_id = so.id) AS signature_count,
            div_event.message AS divergence_reason,
            div_event.created_at AS divergence_at,
            div_event.actor_id AS validator_id,
            div_validator.name AS validator_name,
            div_validator.email AS validator_email
     FROM service_orders so
     JOIN users requester ON requester.id = so.requester_id
     LEFT JOIN LATERAL (
       SELECT oe.message, oe.created_at, oe.actor_id
       FROM order_events oe
       WHERE oe.service_order_id = so.id
         AND (oe.event_type ILIKE '%corre%' OR oe.event_type ILIKE '%diverg%')
       ORDER BY oe.created_at DESC
       LIMIT 1
     ) div_event ON TRUE
     LEFT JOIN users div_validator ON div_validator.id = div_event.actor_id
     WHERE so.status::text = 'divergent'
     ORDER BY COALESCE(div_event.created_at, so.updated_at) DESC`
  );

  return res.json(rows);
});

ordersRouter.get("/next-code", async (req, res) => {
  const currentYear = new Date().getFullYear();
  const { rows } = await query(
    "SELECT last_value FROM os_sequences WHERE year = $1",
    [currentYear]
  );
  const nextSeq = (rows[0]?.last_value ?? 0) + 1;
  const nextCode = `${String(nextSeq).padStart(4, "0")}/${currentYear}`;
  return res.json({ nextCode, sequence: nextSeq, year: currentYear });
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
      `SELECT oe.*, users.name AS actor_name, users.email AS actor_email
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
      `SELECT id, item_name, terminal_model, part_number, client_name, quantity, configuration, created_at
       FROM order_items
       WHERE service_order_id = $1
       ORDER BY created_at ASC, id ASC`,
      [order.id]
    )
  ]);

  const isAdmin = req.user.role === "admin";

  // Data Privacy: Ocultar quantidade de chaves informada por terceiros durante o double check e não expor signature_hash
  const sanitizedSignatures = signatures.rows.map((sig) => {
    const { signature_hash, ...sigWithoutHash } = sig;
    if (isAdmin || sig.signer_id === req.user.id) {
      return sigWithoutHash;
    }
    const { key_count, signed_payload, ...rest } = sigWithoutHash;
    let safePayload = null;
    if (signed_payload && typeof signed_payload === "object") {
      const { keyCount, ...payloadRest } = signed_payload;
      safePayload = payloadRest;
    }
    return {
      ...rest,
      key_count: null,
      signed_payload: safePayload
    };
  });

  const sanitizedEvents = events.rows.map((evt) => {
    let safeMessage = evt.message;
    if (!isAdmin && safeMessage && /quantidade de chaves/i.test(safeMessage)) {
      if (evt.event_type === "Assinada") {
        safeMessage = safeMessage.replace(/Quantidade de chaves:\s*\d+\.\s*/i, "");
      }
    }
    let safeMetadata = null;
    if (evt.metadata && typeof evt.metadata === "object") {
      const { signatureHash, ...cleanMeta } = evt.metadata;
      if (isAdmin) {
        safeMetadata = cleanMeta;
      } else {
        const { keyCount, firstKeyCount, secondKeyCount, ...metaRest } = cleanMeta;
        safeMetadata = metaRest;
      }
    }
    return {
      ...evt,
      message: safeMessage,
      metadata: safeMetadata
    };
  });

  let divergence = null;
  if (order.status === "divergent") {
    const divEvent = [...events.rows]
      .reverse()
      .find((e) => e.event_type?.toLowerCase().includes("diverg") || e.event_type?.toLowerCase().includes("corre"));

    if (divEvent) {
      divergence = {
        reason: divEvent.message,
        createdAt: divEvent.created_at,
        validatorId: divEvent.actor_id,
        validatorName: divEvent.actor_name,
        validatorEmail: divEvent.actor_email,
        metadata: isAdmin ? divEvent.metadata : null
      };
    }
  }

  return res.json({
    ...order,
    divergence,
    events: sanitizedEvents,
    signatures: sanitizedSignatures,
    items: items.rows
  });
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
      order.authorized_person_name,
      order.authorized_person_document || order.code,
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
    "UPDATE service_orders SET status = 'pending_signature', updated_at = NOW() WHERE id = $1 RETURNING *",
    [order.id]
  );

  await addOrderEvent({
    orderId: order.id,
    actorId: req.user.id,
    eventType: "Enviada",
    message: "Ordem enviada para todos os usuarios assinadores."
  });

  return res.json(rows[0]);
});

ordersRouter.post("/:id/request-correction", requireRole("signer"), async (req, res) => {
  const order = await findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: "Ordem nao encontrada." });
  }

  if (order.destination_role !== req.user.role) {
    return res.status(403).json({ message: "Permissao insuficiente." });
  }

  if (order.status !== "pending_signature") {
    return res.status(409).json({ message: "Apenas ordens pendentes podem receber devolutiva." });
  }

  const parsed = feedbackSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: "Informe o que precisa ser corrigido." });
  }

  const { rows } = await query(
    "UPDATE service_orders SET status = 'correction_requested', updated_at = NOW() WHERE id = $1 RETURNING *",
    [order.id]
  );

  await query("DELETE FROM order_signatures WHERE service_order_id = $1", [order.id]);

  await addOrderEvent({
    orderId: order.id,
    actorId: req.user.id,
    eventType: "Correção necessária",
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
    return res.status(400).json({ message: parsed.error.issues?.[0]?.message || "Informe uma quantidade de chaves valida." });
  }

  const existingSignatures = await query(
    "SELECT * FROM order_signatures WHERE service_order_id = $1 ORDER BY signed_at ASC",
    [order.id]
  );

  if (existingSignatures.rows.some((signature) => signature.signer_id === req.user.id)) {
    return res.status(409).json({ message: "Este usuario ja assinou esta ordem." });
  }

  const signerName = req.user.name;
  const keyCount = parsed.data.keyCount;
  const isSecondSigner = existingSignatures.rows.length === 1;

  if (isSecondSigner) {
    const firstKeyCount = Number(existingSignatures.rows[0].key_count);
    const secondKeyCount = Number(keyCount);

    if (firstKeyCount !== secondKeyCount) {
      // Divergência identificada no double check
      const { rows } = await query(
        "UPDATE service_orders SET status = 'divergent', updated_at = NOW() WHERE id = $1 RETURNING *",
        [order.id]
      );

      await addOrderEvent({
        orderId: order.id,
        actorId: req.user.id,
        eventType: "Divergência",
        message: "Divergência na quantidade de chaves informada durante o double check.",
        metadata: {
          divergenceType: "key_count_mismatch",
          firstKeyCount,
          secondKeyCount,
          validatorId: req.user.id,
          validatorName: req.user.name
        }
      });

      return res.json({
        divergent: true,
        status: "divergent",
        order: rows[0],
        message: "Divergência identificada: A quantidade de chaves informada nas duas validações não corresponde. A ordem foi encaminhada para divergências."
      });
    }
  }

  const ipAddress = req.ip;
  const userAgent = req.headers["user-agent"] ?? "";
  const { payload, signatureHash } = buildSignature({
    order,
    signer: req.user,
    signerName,
    keyCount,
    ipAddress,
    userAgent
  });

  await query(
    `INSERT INTO order_signatures (service_order_id, signer_id, signer_name, signature_hash, signed_payload, ip_address, user_agent, key_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [order.id, req.user.id, signerName, signatureHash, payload, ipAddress, userAgent, keyCount]
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
    message: signatureCount >= 2
      ? `Ordem aprovada com duas assinaturas no double check.`
      : `Primeira assinatura registrada por ${signerName}. Aguardando segunda assinatura.`,
    metadata: { signatureHash, signerName, signatureCount, keyCount }
  });

  return res.json({ order: rows[0], signatureCount, divergent: false });
});
