import express from "express";
import { z } from "zod";
import { pool, query } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { addOrderEvent } from "../utils/audit.js";
import { buildSignature } from "../utils/signature.js";
import { sendOccurrenceEmail } from "../services/emailService.js";

export const ordersRouter = express.Router();

const orderItemSchema = z.object({
  itemName: z.string().optional().nullable().transform((val) => val?.trim() || ""),
  itemIdentifier: z.string().trim().min(1),
  partNumber: z.string().trim().min(1),
  clientName: z.string().trim().min(1),
  quantity: z.coerce.number().int().positive(),
  configuration: z.string().min(1)
});

const executorTeamSchema = z.preprocess(
  (val) => {
    if (typeof val === "string") {
      const s = val.trim().toLowerCase();
      if (s === "produção" || s === "producao") return "producao";
      if (s === "suporte") return "suporte";
    }
    return val;
  },
  z.enum(["suporte", "producao"], {
    errorMap: () => ({ message: "A equipe executora deve ser 'suporte' ou 'producao'." })
  })
);

function normalizeOrderBody(body) {
  if (body && typeof body === "object") {
    if (body.executorTeam === undefined && body.executor_team !== undefined) {
      body.executorTeam = body.executor_team;
    }
  }
  return body;
}

const orderSchema = z.object({
  orderType: z.string().trim().min(1),
  executorTeam: executorTeamSchema,
  authorizedPersonName: z.string().optional(),
  authorizedPersonDocument: z.string().optional(),
  validUntil: z.string().min(10).optional().nullable(),
  destinationRole: z.enum(["signer"]).optional().nullable().default("signer").transform((val) => val || "signer"),
  items: z.array(orderItemSchema).min(1)
});

const orderUpdateSchema = orderSchema.extend({
  executorTeam: executorTeamSchema.optional()
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
  if (user.role === "admin") return true;
  if (order.requester_id === user.id) return true;
  if (order.status === "draft") return false;
  return user.role === "spectator" || order.destination_role === user.role;
}

async function findOrder(id) {
  const { rows } = await query(
    `SELECT so.*, requester.name AS requester_name,
            COALESCE(requester.name, so.authorized_person_name) AS authorized_person_name
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
    return "Tipo de ordem não cadastrado.";
  }

  const validModels = new Set(terminalModels.rows.map((row) => row.name));

  for (const item of values.items) {
    if (!validModels.has(item.itemIdentifier)) {
      return `Modelo do terminal não cadastrado: ${item.itemIdentifier}.`;
    }
    if (!item.partNumber || !item.partNumber.trim()) {
      return `Part Number deve ser informado para o modelo "${item.itemIdentifier}".`;
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
    filters.push(`so.destination_role = $${params.length} AND so.status != 'draft'`);
  }

  if (req.user.role === "spectator") {
    filters.push("so.status != 'draft'");
  }

  const executorTeam = req.query.executorTeam || req.query.executor_team;
  if (executorTeam) {
    const normalized = String(executorTeam).trim().toLowerCase();
    if (["suporte", "producao"].includes(normalized)) {
      params.push(normalized);
      filters.push(`so.executor_team = $${params.length}`);
    } else if (normalized === "unassigned" || normalized === "null") {
      filters.push("so.executor_team IS NULL");
    }
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT so.*, requester.name AS requester_name,
            COALESCE(requester.name, so.authorized_person_name) AS authorized_person_name,
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

ordersRouter.delete("/all", requireRole("admin"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM service_orders");
    await client.query("DELETE FROM os_sequences");
    await client.query("COMMIT");
    return res.json({ message: "Todas as ordens de serviço foram limpas com sucesso." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao limpar ordens:", error);
    return res.status(500).json({ message: "Erro ao limpar todas as ordens de serviço." });
  } finally {
    client.release();
  }
});

ordersRouter.post("/clear-all", requireRole("admin"), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM service_orders");
    await client.query("DELETE FROM os_sequences");
    await client.query("COMMIT");
    return res.json({ message: "Todas as ordens de serviço foram limpas com sucesso." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao limpar ordens:", error);
    return res.status(500).json({ message: "Erro ao limpar todas as ordens de serviço." });
  } finally {
    client.release();
  }
});

ordersRouter.post("/", requireRole("requester", "admin"), async (req, res) => {
  const parsed = orderSchema.safeParse(normalizeOrderBody(req.body));

  if (!parsed.success) {
    const issue = parsed.error.issues?.[0];
    return res.status(400).json({ message: issue?.message || "Dados da ordem invalidos." });
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
    const teamLabel = values.executorTeam === "producao" ? "Produção" : "Suporte";

    const { rows } = await client.query(
      `INSERT INTO service_orders (
         code, order_year, order_sequence, order_type, executor_team, item_name, item_identifier,
         authorized_person_name, authorized_person_document, usage_reason,
         valid_from, valid_until, requester_id, destination_role
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_DATE, $11, $12, $13)
       RETURNING *`,
      [
        code,
        currentYear,
        sequenceNumber,
        values.orderType,
        values.executorTeam,
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
      message: `Ordem ${code} criada por ${requesterName} (Equipe executora: ${teamLabel}).`,
      metadata: { executorTeam: values.executorTeam }
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
         AND (oe.event_type ILIKE '%corre%' OR oe.event_type ILIKE '%diverg%' OR oe.event_type ILIKE '%incorret%')
       ORDER BY oe.created_at DESC
       LIMIT 1
     ) div_event ON TRUE
     LEFT JOIN users div_validator ON div_validator.id = div_event.actor_id
     WHERE (so.status::text = 'divergent' OR COALESCE(so.incorrect_signatures, 0) > 0)
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

ordersRouter.get("/counts", async (req, res) => {
  const filters = [];
  const params = [];

  if (req.user.role === "requester") {
    params.push(req.user.id);
    filters.push(`so.requester_id = $${params.length}`);
  }

  if (req.user.role === "signer") {
    params.push(req.user.role);
    filters.push(`so.destination_role = $${params.length} AND so.status != 'draft'`);
  }

  if (req.user.role === "spectator") {
    filters.push("so.status != 'draft'");
  }

  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT so.executor_team, COUNT(*)::int AS count
     FROM service_orders so
     ${where}
     GROUP BY so.executor_team`,
    params
  );

  const counts = { suporte: 0, producao: 0, unassigned: 0, total: 0 };
  for (const row of rows) {
    const c = Number(row.count);
    counts.total += c;
    if (row.executor_team === "suporte") counts.suporte = c;
    else if (row.executor_team === "producao") counts.producao = c;
    else counts.unassigned += c;
  }

  return res.json(counts);
});

ordersRouter.get("/occurrences", requireRole("admin", "signer"), async (_req, res) => {
  const { rows } = await query(
    `SELECT so_occ.*, so.order_type, so.executor_team, so.status AS order_status,
            COALESCE(req_u.name, so.authorized_person_name) AS authorized_person_name,
            req_u.name AS requester_name
     FROM signature_occurrences so_occ
     JOIN service_orders so ON so.id = so_occ.service_order_id
     LEFT JOIN users req_u ON req_u.id = so.requester_id
     ORDER BY so_occ.created_at DESC`
  );
  return res.json(rows);
});

ordersRouter.post("/occurrences/:id/send-email", requireRole("admin", "signer"), async (req, res) => {
  const occRes = await query("SELECT * FROM signature_occurrences WHERE id = $1", [req.params.id]);
  const occurrence = occRes.rows[0];
  if (!occurrence) {
    return res.status(404).json({ message: "Ocorrência não encontrada." });
  }

  const orderRes = await query("SELECT * FROM service_orders WHERE id = $1", [occurrence.service_order_id]);
  const order = orderRes.rows[0] || {};

  const recipient = req.body?.recipient || null;
  const result = await sendOccurrenceEmail({ occurrence, order, recipient });

  if (result.configured) {
    await query(
      `UPDATE signature_occurrences
       SET status = 'email_sent', email_sent_at = NOW(), email_recipient = $1, updated_at = NOW()
       WHERE id = $2`,
      [result.recipient, occurrence.id]
    );
  }

  return res.json(result);
});

ordersRouter.post("/occurrences/:id/resolve", requireRole("admin", "signer"), async (req, res) => {
  const { rows } = await query(
    `UPDATE signature_occurrences
     SET status = 'resolved', updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [req.params.id]
  );

  if (!rows[0]) {
    return res.status(404).json({ message: "Ocorrência não encontrada." });
  }

  return res.json(rows[0]);
});

ordersRouter.get("/:id", async (req, res) => {
  const order = await findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: "Ordem nao encontrada." });
  }

  if (!canSeeOrder(req.user, order)) {
    return res.status(403).json({ message: "Permissao insuficiente." });
  }

  const [events, signatures, items, occurrences] = await Promise.all([
    query(
      `SELECT oe.*, users.name AS actor_name, users.email AS actor_email
       FROM order_events oe
       JOIN users ON users.id = oe.actor_id
       WHERE service_order_id = $1
       ORDER BY oe.created_at ASC`,
      [order.id]
    ),
    query(
      `SELECT os.*, COALESCE(users.name, os.signer_name) AS display_signer_name,
              COALESCE(users.name, os.signer_name) AS signer_name,
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
    ),
    query(
      `SELECT * FROM signature_occurrences
       WHERE service_order_id = $1
       ORDER BY created_at DESC`,
      [order.id]
    )
  ]);

  const isAdmin = req.user.role === "admin";

  // Data Privacy: Ocultar quantidade de chaves informada por terceiros durante o double check e não expor signature_hash
  // Data Privacy: Ocultar dados do primeiro assinante para o segundo assinante e não expor signature_hash
  const sanitizedSignatures = signatures.rows.map((sig, index) => {
    const { signature_hash, ...sigWithoutHash } = sig;
    if (isAdmin) {
      return sigWithoutHash;
    }
    const isOwnSignature = sig.signer_id === req.user.id;
    if (isOwnSignature) {
      return sigWithoutHash;
    }

    // Para terceiros / segundo assinante: omitir completamente nome, email, usuário, id e payload do primeiro assinante
    const {
      key_count,
      signed_payload,
      signer_name,
      display_signer_name,
      user_name,
      signer_email,
      signer_id,
      ...rest
    } = sigWithoutHash;

    return {
      ...rest,
      signer_id: null,
      signer_name: null,
      display_signer_name: null,
      user_name: null,
      signer_email: null,
      key_count: null,
      signed_payload: null
    };
  });

  const sanitizedEvents = events.rows.map((evt) => {
    let safeMessage = evt.message;
    let safeActorName = evt.actor_name;
    let safeActorEmail = evt.actor_email;
    let safeActorId = evt.actor_id;

    if (!isAdmin) {
      if (safeMessage) {
        // Remove referências a nomes de assinantes nas mensagens
        safeMessage = safeMessage.replace(/registrada por [^.]+\./i, "registrada.");
        if (/quantidade de chaves/i.test(safeMessage) && evt.event_type === "Assinada") {
          safeMessage = safeMessage.replace(/Quantidade de chaves:\s*\d+\.\s*/i, "");
        }
      }

      // Se a ordem estiver em andamento no double check, ocultar dados do primeiro assinante para evitar viés; após conclusão, exibir nome real padronizado
      if (order.status === "pending_signature" && evt.event_type === "Assinada" && evt.actor_id !== req.user.id) {
        safeActorName = "Assinante";
        safeActorEmail = null;
        safeActorId = null;
      }
    }

    let safeMetadata = null;
    if (evt.metadata && typeof evt.metadata === "object") {
      const { signatureHash, ...cleanMeta } = evt.metadata;
      if (isAdmin) {
        safeMetadata = cleanMeta;
      } else {
        const { keyCount, firstKeyCount, secondKeyCount, signerName, validatorName, validatorEmail, ...metaRest } = cleanMeta;
        safeMetadata = metaRest;
      }
    }

    return {
      ...evt,
      actor_id: safeActorId,
      actor_name: safeActorName,
      actor_email: safeActorEmail,
      message: safeMessage,
      metadata: safeMetadata
    };
  });

  let divergence = null;
  if (order.status === "divergent" || Number(order.incorrect_signatures) > 0) {
    const divEvent = [...events.rows]
      .reverse()
      .find((e) => e.event_type?.toLowerCase().includes("diverg") || e.event_type?.toLowerCase().includes("corre") || e.event_type?.toLowerCase().includes("incorret"));

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
    items: items.rows,
    occurrences: occurrences.rows
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

  if (!["draft", "correction_requested", "divergent"].includes(order.status)) {
    return res.status(409).json({ message: "Apenas rascunhos ou ordens em correcao podem ser editadas." });
  }

  const parsed = orderUpdateSchema.safeParse(normalizeOrderBody(req.body));

  if (!parsed.success) {
    const issue = parsed.error.issues?.[0];
    return res.status(400).json({ message: issue?.message || "Dados da ordem invalidos." });
  }

  const values = parsed.data;
  const firstItem = values.items[0];
  const catalogError = await validateCatalogOptions(values);

  if (catalogError) {
    return res.status(400).json({ message: catalogError });
  }

  const { rows } = await query(
    `UPDATE service_orders
     SET order_type = $1, executor_team = COALESCE($2, executor_team), item_name = $3, item_identifier = $4, authorized_person_name = $5,
         authorized_person_document = $6, usage_reason = $7, valid_from = $8,
         valid_until = $9, destination_role = $10, status = 'draft', updated_at = NOW()
     WHERE id = $11
     RETURNING *`,
    [
      values.orderType,
      values.executorTeam ?? null,
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

  if (!["draft", "correction_requested", "divergent"].includes(order.status)) {
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

  if (!["pending_signature", "divergent"].includes(order.status)) {
    return res.status(409).json({ message: "Apenas ordens pendentes ou divergentes podem receber devolutiva." });
  }

  const parsed = feedbackSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: "Informe o que precisa ser corrigido." });
  }

  const { rows } = await query(
    "UPDATE service_orders SET status = 'correction_requested', signer_id = NULL, second_signer_id = NULL, updated_at = NOW() WHERE id = $1 RETURNING *",
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
  const parsed = signatureSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues?.[0]?.message || "Informe uma quantidade de chaves valida." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderRes = await client.query(
      `SELECT so.*, requester.name AS requester_name, requester.email AS requester_email
       FROM service_orders so
       JOIN users requester ON requester.id = so.requester_id
       WHERE so.id = $1
       FOR UPDATE`,
      [req.params.id]
    );

    const order = orderRes.rows[0];

    if (!order) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Ordem nao encontrada." });
    }

    if (order.destination_role !== req.user.role) {
      await client.query("ROLLBACK");
      return res.status(403).json({ message: "Permissao insuficiente." });
    }

    if (order.status !== "pending_signature") {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Apenas ordens pendentes podem ser assinadas." });
    }

    const existingSignatures = await client.query(
      "SELECT * FROM order_signatures WHERE service_order_id = $1 ORDER BY signed_at ASC",
      [order.id]
    );

    if (existingSignatures.rows.some((signature) => signature.signer_id === req.user.id)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "Este usuario ja assinou esta ordem." });
    }

    const signerName = req.user.name;
    const keyCount = parsed.data.keyCount;
    const isSecondSigner = existingSignatures.rows.length === 1;

    if (isSecondSigner) {
      const firstKeyCount = Number(existingSignatures.rows[0].key_count);
      const secondKeyCount = Number(keyCount);

      if (firstKeyCount !== secondKeyCount) {
        // Assinatura incorreta identificada no double check
        const { rows } = await client.query(
          `UPDATE service_orders
           SET status = 'pending_signature',
               signer_id = NULL,
               second_signer_id = NULL,
               incorrect_signatures = COALESCE(incorrect_signatures, 0) + 1,
               updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [order.id]
        );

        // Limpa as assinaturas para que a OS retorne para a etapa de assinatura e fique novamente disponível
        await client.query("DELETE FROM order_signatures WHERE service_order_id = $1", [order.id]);

        const incorrectCount = rows[0].incorrect_signatures;

        if (incorrectCount >= 2) {
          const existingOcc = await client.query(
            "SELECT id FROM signature_occurrences WHERE service_order_id = $1 AND status = 'pending'",
            [order.id]
          );
          const occDesc = `Identificadas ${incorrectCount} tentativas de assinatura com divergência no double check (${firstKeyCount} vs ${secondKeyCount}).`;
          if (existingOcc.rows.length === 0) {
            await client.query(
              `INSERT INTO signature_occurrences (
                 service_order_id, order_code, user_id, user_name, error_type, attempt_count, description, status
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
              [
                order.id,
                order.code,
                req.user.id,
                req.user.name,
                "divergencia_double_check",
                incorrectCount,
                occDesc
              ]
            );
          } else {
            await client.query(
              `UPDATE signature_occurrences
               SET attempt_count = $1, user_id = $2, user_name = $3, description = $4, updated_at = NOW()
               WHERE id = $5`,
              [incorrectCount, req.user.id, req.user.name, occDesc, existingOcc.rows[0].id]
            );
          }
        }

        await client.query(
          `INSERT INTO order_events (service_order_id, actor_id, event_type, message, metadata)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            order.id,
            req.user.id,
            "Assinatura incorreta",
            `Assinatura realizada incorretamente (${incorrectCount}ª tentativa). As quantidades de chaves divergiram no double check. Ordem retornada para nova assinatura.`,
            {
              divergenceType: "key_count_mismatch",
              incorrectCount
            }
          ]
        );

        await client.query("COMMIT");

        return res.json({
          incorrectSignature: true,
          divergent: false,
          status: "pending_signature",
          order: rows[0],
          message: `Assinatura incorreta identificada (${incorrectCount}ª tentativa). A quantidade de chaves informada não corresponde. A ordem retornou para a etapa de assinatura.`
        });
      }
    }

    const itemsRes = await client.query(
      "SELECT terminal_model, part_number, client_name, quantity, configuration FROM order_items WHERE service_order_id = $1 ORDER BY id ASC",
      [order.id]
    );

    const ipAddress = req.ip;
    const userAgent = req.headers["user-agent"] ?? "";
    const { payload, signatureHash } = buildSignature({
      order,
      signer: req.user,
      signerName,
      keyCount,
      ipAddress,
      userAgent,
      items: itemsRes.rows
    });

    await client.query(
      `INSERT INTO order_signatures (service_order_id, signer_id, signer_name, signature_hash, signed_payload, ip_address, user_agent, key_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [order.id, req.user.id, signerName, signatureHash, payload, ipAddress, userAgent, keyCount]
    );

    const signatureCount = existingSignatures.rows.length + 1;
    const nextStatus = signatureCount >= 2 ? "signed" : "pending_signature";

    const updateSql = signatureCount === 1
      ? "UPDATE service_orders SET signer_id = $1, status = $2, updated_at = NOW() WHERE id = $3 RETURNING *"
      : "UPDATE service_orders SET second_signer_id = $1, status = $2, updated_at = NOW() WHERE id = $3 RETURNING *";

    const { rows } = await client.query(updateSql, [req.user.id, nextStatus, order.id]);

    await client.query(
      `INSERT INTO order_events (service_order_id, actor_id, event_type, message, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        order.id,
        req.user.id,
        "Assinada",
        signatureCount >= 2
          ? "Ordem aprovada com duas assinaturas no double check."
          : "Primeira assinatura registrada. Aguardando segunda assinatura.",
        { signatureHash, signatureCount, keyCount }
      ]
    );

    await client.query("COMMIT");

    return res.json({ order: rows[0], signatureCount, divergent: false });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao registrar assinatura:", error);
    return res.status(500).json({ message: "Erro ao registrar assinatura." });
  } finally {
    client.release();
  }
});

ordersRouter.post("/:id/incorrect-signature", requireRole("signer", "admin"), async (req, res) => {
  const order = await findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: "Ordem nao encontrada." });
  }

  if (!canSeeOrder(req.user, order)) {
    return res.status(403).json({ message: "Permissao insuficiente." });
  }

  if (!["pending_signature", "signed"].includes(order.status)) {
    return res.status(409).json({ message: "Apenas ordens pendentes ou assinadas podem receber apontamento de assinatura incorreta." });
  }

  if (order.status === "signed" && req.user.role !== "admin") {
    return res.status(403).json({ message: "Apenas administradores podem invalidar assinaturas de ordens já concluídas." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `UPDATE service_orders
       SET status = 'pending_signature',
           signer_id = NULL,
           second_signer_id = NULL,
           incorrect_signatures = COALESCE(incorrect_signatures, 0) + 1,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [order.id]
    );

    await client.query("DELETE FROM order_signatures WHERE service_order_id = $1", [order.id]);

    const incorrectCount = rows[0].incorrect_signatures;
    const reason = req.body?.reason ? ` Motivo: ${req.body.reason}.` : "";

    if (incorrectCount >= 2) {
      const existingOcc = await client.query(
        "SELECT id FROM signature_occurrences WHERE service_order_id = $1 AND status = 'pending'",
        [order.id]
      );
      const occDesc = `Identificadas ${incorrectCount} tentativas incorretas de assinatura.${reason}`;
      if (existingOcc.rows.length === 0) {
        await client.query(
          `INSERT INTO signature_occurrences (
             service_order_id, order_code, user_id, user_name, error_type, attempt_count, description, status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
          [
            order.id,
            order.code,
            req.user.id,
            req.user.name,
            "assinatura_incorreta",
            incorrectCount,
            occDesc
          ]
        );
      } else {
        await client.query(
          `UPDATE signature_occurrences
           SET attempt_count = $1, user_id = $2, user_name = $3, description = $4, updated_at = NOW()
           WHERE id = $5`,
          [incorrectCount, req.user.id, req.user.name, occDesc, existingOcc.rows[0].id]
        );
      }
    }

    await client.query(
      `INSERT INTO order_events (service_order_id, actor_id, event_type, message, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        order.id,
        req.user.id,
        "Assinatura incorreta",
        `Assinatura realizada incorretamente (${incorrectCount}ª tentativa).${reason} Ordem retornada para a etapa de assinatura.`,
        {
          incorrectCount,
          reason: req.body?.reason || null
        }
      ]
    );

    await client.query("COMMIT");

    return res.json({
      incorrectSignature: true,
      status: "pending_signature",
      order: rows[0],
      message: `Assinatura incorreta registrada (${incorrectCount}ª tentativa). A ordem retornou para a etapa de assinatura.`
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Erro ao registrar assinatura incorreta:", error);
    return res.status(500).json({ message: "Erro ao registrar assinatura incorreta." });
  } finally {
    client.release();
  }
});
