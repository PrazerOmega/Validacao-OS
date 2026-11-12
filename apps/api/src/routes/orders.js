import express from "express";
import { z } from "zod";
import { pool, query, withTransaction } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { addOrderEvent } from "../utils/audit.js";
import { buildSignature } from "../utils/signature.js";
import { sendOccurrenceEmail } from "../services/emailService.js";
import { listNotificationEmails } from "./notifications.js";
import { formatOrderCode, orderYearFor } from "../utils/orderCode.js";
import { BRASILIA_TIMEZONE, addDaysToDateKey, brasiliaDateKey, networkNow } from "../utils/networkTime.js";
import { rejectInvalidUuid } from "../utils/validation.js";

export const ordersRouter = express.Router();

// Campos de opção "SIM"/"NÃO" do item (aceita "NAO" sem acento e normaliza para "NÃO")
function yesNoField(label) {
  return z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
    z.enum(["SIM", "NÃO", "NAO"], {
      errorMap: () => ({ message: `A opção ${label} deve ser 'SIM' ou 'NÃO'.` })
    }).transform((v) => (v === "NAO" ? "NÃO" : v))
  );
}

const orderItemSchema = z.object({
  itemName: z.string().optional().nullable().transform((val) => val?.trim() || ""),
  itemIdentifier: z.string().trim().min(1, "Modelo do terminal é obrigatório."),
  partNumber: z.string().trim().min(1, "Part Number é obrigatório."),
  clientName: z.string().trim().min(1, "Cliente é obrigatório."),
  quantity: z.coerce.number().int().positive("A quantidade deve ser um número inteiro positivo."),
  configuration: z.string().min(1, "Configuração é obrigatória."),
  packaging: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
    z.enum(["CAIXA", "SACO BOLHA"], {
      errorMap: () => ({ message: "A opção EMBALAGEM deve ser 'CAIXA' ou 'SACO BOLHA'." })
    })
  ),
  battery: yesNoField("BATERIA"),
  terminalOpening: yesNoField("ABERTURA DE TERMINAL"),
  manual: yesNoField("MANUAL"),
  charger: yesNoField("CARREGADOR"),
  minbase: yesNoField("MINBASE"),
  label: yesNoField("LABEL"),
  aestheticCover: yesNoField("COBRE ESTÉTICO")
});

function normalizeItemBody(item) {
  if (item && typeof item === "object") {
    if (item.terminalOpening === undefined && item.terminal_opening !== undefined) {
      item.terminalOpening = item.terminal_opening;
    }
    if (item.aestheticCover === undefined && item.aesthetic_cover !== undefined) {
      item.aestheticCover = item.aesthetic_cover;
    }
    if (item.itemIdentifier === undefined && item.terminal_model !== undefined) {
      item.itemIdentifier = item.terminal_model;
    }
    if (item.partNumber === undefined && item.part_number !== undefined) {
      item.partNumber = item.part_number;
    }
    if (item.clientName === undefined && item.client_name !== undefined) {
      item.clientName = item.client_name;
    }
    if (item.itemName === undefined && item.item_name !== undefined) {
      item.itemName = item.item_name;
    }
  }
  return item;
}

function normalizeOrderBody(body) {
  if (body && typeof body === "object") {
    if (body.executorTeam === undefined && body.executor_team !== undefined) {
      body.executorTeam = body.executor_team;
    }
    if (Array.isArray(body.items)) {
      body.items = body.items.map(normalizeItemBody);
    }
  }
  return body;
}

function formatZodError(error) {
  const issue = error.issues?.[0];
  if (!issue) return "Dados da ordem invalidos.";

  if (issue.path?.[0] === "items" && typeof issue.path?.[1] === "number") {
    const itemNum = issue.path[1] + 1;
    return `Item ${itemNum}: ${issue.message}`;
  }

  return issue.message;
}

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

// Acessórios que podem acompanhar o terminal na conferência do Estoque
const STOCK_ACCESSORY_LABELS = {
  battery: "Bateria",
  charger: "Carregador",
  manual: "Manual",
  minbase: "Minbase",
  label: "Label",
  aesthetic_cover: "Cobre estético",
  packaging: "Embalagem"
};
const STOCK_ACCESSORIES = Object.keys(STOCK_ACCESSORY_LABELS);

const stockCheckSchema = z.object({
  result: z.enum(["complete", "partial", "shortage"], {
    errorMap: () => ({ message: "O resultado da conferência deve ser completo, parcial ou pendência de estoque." })
  }),
  accessoriesNote: z.string().optional().nullable().transform((val) => val?.trim() || null),
  items: z.array(z.object({
    id: z.string().uuid("Item inválido."),
    checkedQuantity: z.coerce.number().int("A quantidade conferida deve ser um número inteiro.").min(0, "A quantidade conferida não pode ser negativa."),
    note: z.string().optional().nullable().transform((val) => val?.trim() || null),
    accessories: z.array(z.enum(STOCK_ACCESSORIES, {
      errorMap: () => ({ message: "Acessório inválido na conferência." })
    })).optional().default([]).transform((list) => [...new Set(list)])
  })).min(1, "Informe a conferência de todos os itens.")
});

const stockForwardSchema = z.object({
  justification: z.string().trim().min(5, "A justificativa é obrigatória (mínimo de 5 caracteres).")
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

const STOCK_STATUSES = ["awaiting_stock_check", "stock_checking", "stock_picking", "stock_returned"];
// O Estoque vê as ordens em conferência e as que já passaram por ele
// Rascunho nunca entra (mesma regra de canSeeOrder): uma OS conferida e depois editada volta a draft
// mas mantém stock_checker_id, e sem essa exclusão apareceria na lista do Estoque com 403 ao abrir.
const STOCK_VISIBILITY_SQL = `(so.status::text <> 'draft' AND (so.status::text IN (${STOCK_STATUSES.map((status) => `'${status}'`).join(", ")}) OR so.stock_checker_id IS NOT NULL))`;

const STOCK_RESULT_LABELS = {
  complete: "completo",
  partial: "parcial",
  shortage: "pendência de estoque"
};

function canSeeOrder(user, order) {
  if (user.role === "admin") return true;
  if (order.requester_id === user.id) return true;
  if (order.status === "draft") return false;
  if (user.role === "stock") return STOCK_STATUSES.includes(order.status) || Boolean(order.stock_checker_id);
  return user.role === "spectator" || order.destination_role === user.role;
}

ordersRouter.param("id", rejectInvalidUuid("Registro nao encontrado."));

// Filtros de visibilidade da listagem de ordens por perfil (alias "so" = service_orders)
function visibilityFilters(user) {
  const filters = [];
  const params = [];

  if (user.role === "requester") {
    params.push(user.id);
    filters.push(`so.requester_id = $${params.length}`);
  } else if (user.role === "signer") {
    params.push(user.role);
    filters.push(`so.destination_role = $${params.length} AND so.status != 'draft'`);
  } else if (user.role === "spectator") {
    filters.push("so.status != 'draft'");
  } else if (user.role === "stock") {
    filters.push(STOCK_VISIBILITY_SQL);
  }

  return { filters, params };
}

// Normaliza o motivo opcional informado em apontamentos de assinatura incorreta
function normalizeReason(raw) {
  return typeof raw === "string" ? raw.trim() || null : null;
}

// Limpa o resultado da conferência por item (nova conferência do Estoque)
function clearStockItemCheck(dbClient, orderId) {
  return dbClient.query(
    "UPDATE order_items SET stock_checked_quantity = NULL, stock_note = NULL, stock_accessories = NULL WHERE service_order_id = $1",
    [orderId]
  );
}

/**
 * Registra (ou atualiza) de forma atômica a ocorrência ativa de uma OS.
 * O índice único parcial uq_signature_occurrences_active_order garante uma única
 * ocorrência não resolvida por OS, mesmo com requisições simultâneas.
 * A descrição nunca contém quantidades de chaves, para não comprometer o double check cego.
 */
async function upsertActiveOccurrence(client, { order, user, errorType, attemptCount, description }) {
  // created_at da ocorrência aparece no e-mail de alerta: vem da hora oficial, não do NOW() do banco
  const createdAt = await networkNow();
  await client.query(
    `INSERT INTO signature_occurrences (
       service_order_id, order_code, user_id, user_name, error_type, attempt_count, description, status, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
     ON CONFLICT (service_order_id) WHERE status <> 'resolved'
     DO UPDATE SET
       attempt_count = GREATEST(signature_occurrences.attempt_count, EXCLUDED.attempt_count),
       user_id = EXCLUDED.user_id,
       user_name = EXCLUDED.user_name,
       error_type = EXCLUDED.error_type,
       description = EXCLUDED.description,
       updated_at = NOW()`,
    [order.id, order.code, user.id, user.name, errorType, attemptCount, description, createdAt]
  );
}

/**
 * Registra no histórico uma tentativa incorreta de assinatura, com os dois assinantes
 * envolvidos e a quantidade de chaves que cada um informou.
 */
async function recordSignatureAttempt(client, { orderId, attemptNumber, errorType, signatures, reportedBy, reason = null }) {
  const [first, second] = signatures;
  const createdAt = await networkNow();
  await client.query(
    `INSERT INTO signature_attempts (
       service_order_id, attempt_number, error_type,
       first_signer_id, first_signer_name, first_key_count,
       second_signer_id, second_signer_name, second_key_count,
       reported_by_id, reported_by_name, reason, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      orderId,
      attemptNumber,
      errorType,
      first?.signerId ?? null,
      first?.signerName ?? null,
      first?.keyCount ?? null,
      second?.signerId ?? null,
      second?.signerName ?? null,
      second?.keyCount ?? null,
      reportedBy.id,
      reportedBy.name,
      reason,
      createdAt
    ]
  );
}

// Assinaturas atuais da OS (ordem de assinatura) com o nome do usuário
async function loadSignaturesForAttempt(client, orderId) {
  const { rows } = await client.query(
    `SELECT os.signer_id, COALESCE(u.name, os.signer_name) AS signer_name, os.key_count
     FROM order_signatures os
     LEFT JOIN users u ON u.id = os.signer_id
     WHERE os.service_order_id = $1
     ORDER BY os.signed_at ASC`,
    [orderId]
  );
  return rows.map((row) => ({ signerId: row.signer_id, signerName: row.signer_name, keyCount: row.key_count }));
}

/**
 * Envia automaticamente o alerta da ocorrência ativa da OS para todos os e-mails
 * cadastrados pelo admin. Roda após o COMMIT e nunca derruba a requisição de assinatura.
 */
async function notifyOccurrenceAutomatically(orderId, actorId) {
  const occRes = await query(
    "SELECT * FROM signature_occurrences WHERE service_order_id = $1 AND status <> 'resolved'",
    [orderId]
  );
  const occurrence = occRes.rows[0];
  if (!occurrence) return;

  const recipients = await listNotificationEmails();
  if (recipients.length === 0 && !process.env.NOTIFICATION_EMAIL) {
    console.warn(`[Notificação automática] OS ${occurrence.order_code}: nenhum e-mail cadastrado para receber alertas.`);
    return;
  }

  const orderRes = await query("SELECT * FROM service_orders WHERE id = $1", [orderId]);
  const result = await sendOccurrenceEmail({
    // O e-mail nunca leva quantidades de chaves (double check cego)
    occurrence: sanitizeOccurrence(occurrence, { role: "system" }),
    order: orderRes.rows[0] || {},
    recipient: recipients.join(", ")
  });

  if (result.success) {
    await query(
      `UPDATE signature_occurrences
       SET status = CASE WHEN status = 'resolved' THEN status ELSE 'email_sent' END,
           email_sent_at = $3, email_recipient = $1, updated_at = NOW()
       WHERE id = $2`,
      [result.recipient, occurrence.id, result.sentAt]
    );
    await addOrderEvent({
      orderId,
      actorId,
      eventType: "Ocorrência notificada",
      message: `Alerta de ${occurrence.attempt_count} tentativas incorretas enviado automaticamente para ${result.recipient}.`,
      metadata: { automatic: true }
    });
    return;
  }

  console.warn(`[Notificação automática] OS ${occurrence.order_code}: ${result.reason}`);
  if (result.errorCode === "send_failed") {
    await addOrderEvent({
      orderId,
      actorId,
      eventType: "Falha na notificação",
      message: `Não foi possível enviar automaticamente o alerta de tentativas incorretas para ${result.recipient}.`,
      metadata: { automatic: true }
    });
  }
}

function triggerAutomaticNotification(orderId, actorId) {
  notifyOccurrenceAutomatically(orderId, actorId).catch((error) => {
    console.error("[Notificação automática] Erro inesperado:", error);
  });
}

// Remove quantidades de chaves de descrições antigas (ex.: "(4 vs 1)") para perfis não administradores
function sanitizeOccurrence(occurrence, user) {
  if (user.role === "admin") return occurrence;
  return {
    ...occurrence,
    description: String(occurrence.description || "").replace(/\s*\(\d+\s*vs\s*\d+\)/gi, "")
  };
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

// Dia seguinte no calendário de Brasília, a partir da hora oficial da rede.
function defaultValidUntil(now) {
  return addDaysToDateKey(brasiliaDateKey(now), 1);
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

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    await dbClient.query(
      `INSERT INTO order_items (
         service_order_id, item_index, item_name, terminal_model, part_number, client_name, quantity, configuration,
         packaging, battery, terminal_opening, manual, charger, minbase, label, aesthetic_cover
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        orderId,
        i,
        item.itemName,
        item.itemIdentifier,
        item.partNumber,
        item.clientName,
        item.quantity,
        item.configuration,
        item.packaging ?? null,
        item.battery ?? null,
        item.terminalOpening ?? item.terminal_opening ?? null,
        item.manual ?? null,
        item.charger ?? null,
        item.minbase ?? null,
        item.label ?? null,
        item.aestheticCover ?? item.aesthetic_cover ?? null
      ]
    );
  }
}

ordersRouter.get("/", async (req, res) => {
  const { filters, params } = visibilityFilters(req.user);

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

// Remove todas as ordens e reinicia a numeração (disponível em DELETE /all e POST /clear-all)
async function clearAllOrders(_req, res) {
  try {
    await withTransaction(async (client) => {
      await client.query("DELETE FROM service_orders");
      await client.query("DELETE FROM os_sequences");
    });
    return res.json({ message: "Todas as ordens de serviço foram limpas com sucesso." });
  } catch (error) {
    console.error("Erro ao limpar ordens:", error);
    return res.status(500).json({ message: "Erro ao limpar todas as ordens de serviço." });
  }
}

ordersRouter.delete("/all", requireRole("admin"), clearAllOrders);
ordersRouter.post("/clear-all", requireRole("admin"), clearAllOrders);

ordersRouter.post("/", requireRole("requester", "admin"), async (req, res) => {
  const parsed = orderSchema.safeParse(normalizeOrderBody(req.body));

  if (!parsed.success) {
    return res.status(400).json({ message: formatZodError(parsed.error) });
  }

  const values = parsed.data;
  const firstItem = values.items[0];
  const catalogError = await validateCatalogOptions(values);

  if (catalogError) {
    return res.status(400).json({ message: catalogError });
  }

  // Data/hora oficial de Brasília obtida pela rede (nunca do relógio da máquina).
  const now = await networkNow();
  const currentYear = orderYearFor(now);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const seqRes = await client.query(
      `INSERT INTO os_sequences (year, last_value)
       VALUES ($1, 1)
       ON CONFLICT (year) DO UPDATE
       SET last_value = os_sequences.last_value + 1
       RETURNING last_value`,
      [currentYear]
    );

    const sequenceNumber = seqRes.rows[0].last_value;
    const code = formatOrderCode(sequenceNumber, currentYear);

    // Solicitante é sempre o usuário logado
    const requesterName = req.user.name;
    const teamLabel = values.executorTeam === "producao" ? "Produção" : "Suporte";

    const { rows } = await client.query(
      `INSERT INTO service_orders (
         code, order_year, order_sequence, order_type, executor_team, item_name, item_identifier,
         authorized_person_name, authorized_person_document, usage_reason,
         valid_from, valid_until, requester_id, destination_role, created_at, updated_at, signature_due_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $14, $11, $12, $13, $15, $15, $16)
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
        values.validUntil ?? defaultValidUntil(now),
        req.user.id,
        "signer",
        brasiliaDateKey(now),
        now,
        // Prazo de assinatura: 1 dia a partir da hora oficial (antes vinha do DEFAULT NOW() do banco)
        new Date(now.getTime() + 24 * 60 * 60 * 1000)
      ]
    );

    await replaceOrderItems(rows[0].id, values.items, client);

    await addOrderEvent({
      orderId: rows[0].id,
      actorId: req.user.id,
      eventType: "Criação",
      message: `Ordem ${code} criada por ${requesterName} (Equipe executora: ${teamLabel}).`,
      metadata: { executorTeam: values.executorTeam }
    }, client);

    await client.query("COMMIT");

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
  const currentYear = orderYearFor(await networkNow());
  const { rows } = await query(
    "SELECT last_value FROM os_sequences WHERE year = $1",
    [currentYear]
  );
  const nextSeq = (rows[0]?.last_value ?? 0) + 1;
  const nextCode = formatOrderCode(nextSeq, currentYear);
  return res.json({ nextCode, sequence: nextSeq, year: currentYear });
});

ordersRouter.get("/counts", async (req, res) => {
  const { filters, params } = visibilityFilters(req.user);
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

ordersRouter.get("/occurrences", requireRole("admin", "signer"), async (req, res) => {
  const { rows } = await query(
    `SELECT so_occ.*, so.order_type, so.executor_team, so.status AS order_status,
            COALESCE(req_u.name, so.authorized_person_name) AS authorized_person_name,
            req_u.name AS requester_name
     FROM signature_occurrences so_occ
     JOIN service_orders so ON so.id = so_occ.service_order_id
     LEFT JOIN users req_u ON req_u.id = so.requester_id
     ORDER BY so_occ.created_at DESC`
  );

  // Histórico das tentativas incorretas de cada OS (1º e 2º assinante de cada tentativa)
  const orderIds = [...new Set(rows.map((row) => row.service_order_id))];
  const attemptsByOrder = new Map();
  if (orderIds.length > 0) {
    const attemptsRes = await query(
      `SELECT * FROM signature_attempts
       WHERE service_order_id = ANY($1::uuid[])
       ORDER BY attempt_number ASC, created_at ASC`,
      [orderIds]
    );
    const isAdmin = req.user.role === "admin";
    for (const attempt of attemptsRes.rows) {
      // Quantidades de chaves só para o admin, para não quebrar o double check cego
      const visible = isAdmin ? attempt : { ...attempt, first_key_count: null, second_key_count: null };
      if (!attemptsByOrder.has(attempt.service_order_id)) attemptsByOrder.set(attempt.service_order_id, []);
      attemptsByOrder.get(attempt.service_order_id).push(visible);
    }
  }

  return res.json(
    rows.map((row) => ({
      ...sanitizeOccurrence(row, req.user),
      attempts: attemptsByOrder.get(row.service_order_id) ?? []
    }))
  );
});

ordersRouter.post("/occurrences/:id/send-email", requireRole("admin", "signer"), async (req, res) => {
  const occRes = await query("SELECT * FROM signature_occurrences WHERE id = $1", [req.params.id]);
  const occurrence = occRes.rows[0];
  if (!occurrence) {
    return res.status(404).json({ message: "Ocorrência não encontrada." });
  }

  // Evita notificações duplicadas: reenvio só com confirmação explícita
  if (occurrence.status === "email_sent" && req.body?.resend !== true) {
    return res.status(409).json({
      message: `Esta ocorrência já foi notificada para ${occurrence.email_recipient} em ${new Date(occurrence.email_sent_at).toLocaleString("pt-BR", { timeZone: BRASILIA_TIMEZONE })}.`
    });
  }

  const orderRes = await query("SELECT * FROM service_orders WHERE id = $1", [occurrence.service_order_id]);
  const order = orderRes.rows[0] || {};

  // Em branco: envia para todos os e-mails cadastrados pelo admin
  const typedRecipient = typeof req.body?.recipient === "string" ? req.body.recipient.trim() : "";
  const recipient = typedRecipient || (await listNotificationEmails()).join(", ");
  const result = await sendOccurrenceEmail({ occurrence: sanitizeOccurrence(occurrence, req.user), order, recipient });

  if (result.errorCode === "invalid_recipient" || result.errorCode === "missing_recipient") {
    return res.status(400).json({ message: result.reason });
  }

  if (result.errorCode === "send_failed") {
    return res.status(502).json({ message: result.reason });
  }

  // Só marca como notificada quando o servidor SMTP efetivamente aceitou a mensagem
  if (result.success) {
    await query(
      `UPDATE signature_occurrences
       SET status = CASE WHEN status = 'resolved' THEN status ELSE 'email_sent' END,
           email_sent_at = $3, email_recipient = $1, updated_at = NOW()
       WHERE id = $2`,
      [result.recipient, occurrence.id, result.sentAt]
    );

    await addOrderEvent({
      orderId: occurrence.service_order_id,
      actorId: req.user.id,
      eventType: "Ocorrência notificada",
      message: `Ocorrência de assinatura incorreta notificada por e-mail para ${result.recipient}.`
    });
  }

  return res.json(result);
});

ordersRouter.post("/occurrences/:id/resolve", requireRole("admin", "signer"), async (req, res) => {
  const occRes = await query("SELECT * FROM signature_occurrences WHERE id = $1", [req.params.id]);
  const occurrence = occRes.rows[0];

  if (!occurrence) {
    return res.status(404).json({ message: "Ocorrência não encontrada." });
  }

  if (occurrence.status === "resolved") {
    return res.status(409).json({ message: "Esta ocorrência já está resolvida." });
  }

  // O validador envolvido na ocorrência não pode encerrar a própria ocorrência
  if (req.user.role !== "admin" && occurrence.user_id === req.user.id) {
    return res.status(403).json({ message: "O usuário envolvido não pode resolver a própria ocorrência." });
  }

  const resolved = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE signature_occurrences
       SET status = 'resolved', updated_at = NOW()
       WHERE id = $1 AND status <> 'resolved'
       RETURNING *`,
      [occurrence.id]
    );
    if (rows[0]) {
      await addOrderEvent({
        orderId: occurrence.service_order_id,
        actorId: req.user.id,
        eventType: "Ocorrência resolvida",
        message: "Ocorrência de assinatura incorreta marcada como resolvida."
      }, client);
    }
    return rows[0];
  });

  if (!resolved) {
    return res.status(409).json({ message: "Esta ocorrência já está resolvida." });
  }

  return res.json(sanitizeOccurrence(resolved, req.user));
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
      `SELECT id, item_index, item_name, terminal_model, part_number, client_name, quantity, configuration,
              packaging, battery, terminal_opening, manual, charger, minbase, label, aesthetic_cover,
              stock_checked_quantity, stock_note, stock_accessories, created_at
       FROM order_items
       WHERE service_order_id = $1
       ORDER BY item_index ASC, created_at ASC, id ASC`,
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

    // Quando a ordem está concluída (assinada), exibir os nomes dos validadores normalmente,
    // mas a contagem de chaves continua visível somente para admin (regra de sigilo)
    if (order.status === "signed") {
      const { signed_payload, key_count, ...rest } = sigWithoutHash;
      return { ...rest, key_count: null };
    }

    // Para terceiros / segundo assinante durante double check pendente: omitir dados para evitar viés
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
    if (!isAdmin && evt.event_type === "Assinada" && /quantidade de chaves/i.test(safeMessage ?? "")) {
      safeMessage = safeMessage.replace(/Quantidade de chaves:\s*\d+\.\s*/i, "");
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

    return { ...evt, message: safeMessage, metadata: safeMetadata };
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

  if (!["draft", "correction_requested", "divergent", "stock_returned"].includes(order.status)) {
    return res.status(409).json({ message: "Apenas rascunhos, ordens em correcao ou devolvidas pelo estoque podem ser editadas." });
  }

  const parsed = orderUpdateSchema.safeParse(normalizeOrderBody(req.body));

  if (!parsed.success) {
    return res.status(400).json({ message: formatZodError(parsed.error) });
  }

  const values = parsed.data;
  const firstItem = values.items[0];
  const catalogError = await validateCatalogOptions(values);

  if (catalogError) {
    return res.status(400).json({ message: catalogError });
  }

  const validUntil = values.validUntil ?? order.valid_until ?? defaultValidUntil(await networkNow());

  // Cabeçalho e itens são gravados juntos: nunca sobra uma ordem com itens pela metade.
  // A condição de status evita sobrescrever uma ordem que mudou de etapa nesse meio-tempo.
  const updated = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE service_orders
       SET order_type = $1, executor_team = COALESCE($2, executor_team), item_name = $3, item_identifier = $4, authorized_person_name = $5,
           authorized_person_document = $6, usage_reason = $7, valid_from = $8,
           valid_until = $9, destination_role = $10, status = 'draft', updated_at = NOW()
       WHERE id = $11 AND status = $12
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
        validUntil,
        "signer",
        order.id,
        order.status
      ]
    );

    if (rows[0]) {
      await replaceOrderItems(order.id, values.items, client);
      const fromStockReturn = order.status === "stock_returned";
      await addOrderEvent({
        orderId: order.id,
        actorId: req.user.id,
        eventType: "Atualizada",
        message: fromStockReturn
          ? "Operações optou por editar a ordem devolvida pelo estoque. Ordem retornou para rascunho."
          : "Ordem atualizada.",
        metadata: fromStockReturn ? { decision: "edit_order", previousStockResult: order.stock_result } : {}
      }, client);
    }
    return rows[0];
  });

  if (!updated) {
    return res.status(409).json({ message: "A ordem mudou de etapa enquanto era editada. Recarregue e tente novamente." });
  }

  return res.json(updated);
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

  // Toda OS enviada (inclusive após correção do Suporte) passa pela conferência do Estoque
  const submitted = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE service_orders
       SET status = 'awaiting_stock_check', stock_result = NULL, stock_accessories_note = NULL,
           stock_checker_id = NULL, stock_checked_at = NULL, updated_at = NOW()
       WHERE id = $1 AND status::text IN ('draft', 'correction_requested', 'divergent')
       RETURNING *`,
      [order.id]
    );
    if (rows[0]) {
      await clearStockItemCheck(client, order.id);
      await addOrderEvent({
        orderId: order.id,
        actorId: req.user.id,
        eventType: "Enviada",
        message: "Ordem enviada para conferência do estoque."
      }, client);
    }
    return rows[0];
  });

  if (!submitted) {
    return res.status(409).json({ message: "Ordem nao pode ser enviada neste status." });
  }

  return res.json(submitted);
});

/**
 * Muda o status de forma atômica: só atualiza se a OS ainda estiver no status esperado,
 * evitando que duas ações simultâneas avancem a mesma ordem.
 */
async function transitionStatus(dbClient, orderId, fromStatus, toStatus, extraSet = "", extraParams = []) {
  const { rows } = await dbClient.query(
    `UPDATE service_orders
     SET status = $1${extraSet ? `, ${extraSet}` : ""}, updated_at = NOW()
     WHERE id = $2 AND status = $3
     RETURNING *`,
    [toStatus, orderId, fromStatus, ...extraParams]
  );
  return rows[0];
}

ordersRouter.post("/:id/stock/start", requireRole("stock"), async (req, res) => {
  const order = await findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: "Ordem nao encontrada." });
  }

  if (order.status !== "awaiting_stock_check") {
    return res.status(409).json({ message: "Apenas ordens aguardando conferência podem ter a conferência iniciada." });
  }

  const updated = await withTransaction(async (client) => {
    const row = await transitionStatus(
      client, order.id, "awaiting_stock_check", "stock_checking", "stock_checker_id = $4", [req.user.id]
    );
    if (row) {
      await addOrderEvent({
        orderId: order.id,
        actorId: req.user.id,
        eventType: "Conferência iniciada",
        message: "Estoque iniciou a conferência do material."
      }, client);
    }
    return row;
  });

  if (!updated) {
    return res.status(409).json({ message: "A conferência desta ordem já foi iniciada." });
  }

  return res.json(updated);
});

ordersRouter.post("/:id/stock/check", requireRole("stock"), async (req, res) => {
  const order = await findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: "Ordem nao encontrada." });
  }

  if (order.status !== "stock_checking") {
    return res.status(409).json({ message: "Apenas ordens em conferência podem receber o resultado." });
  }

  const parsed = stockCheckSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message || "Dados da conferência inválidos." });
  }

  const { result, accessoriesNote } = parsed.data;
  const { rows: orderItems } = await query(
    `SELECT id, terminal_model, quantity FROM order_items
     WHERE service_order_id = $1
     ORDER BY item_index ASC, created_at ASC, id ASC`,
    [order.id]
  );

  const checkedById = new Map(parsed.data.items.map((item) => [item.id, item]));
  const coversAllItems =
    checkedById.size === parsed.data.items.length &&
    checkedById.size === orderItems.length &&
    orderItems.every((item) => checkedById.has(item.id));

  if (!coversAllItems) {
    return res.status(400).json({ message: "Informe a conferência de cada linha de terminal da ordem, sem repetir itens." });
  }

  const lines = orderItems.map((item, index) => {
    const checked = checkedById.get(item.id);
    return {
      id: item.id,
      line: index + 1,
      terminalModel: item.terminal_model,
      requested: item.quantity,
      checked: checked.checkedQuantity,
      note: checked.note,
      accessories: checked.accessories
    };
  });

  const overLine = lines.find((line) => line.checked > line.requested);
  if (overLine) {
    return res.status(400).json({
      message: `Item ${overLine.line}: a quantidade conferida (${overLine.checked}) não pode ser maior que a solicitada (${overLine.requested}).`
    });
  }

  const missingLines = lines.filter((line) => line.checked < line.requested);

  // "Completo" exige todas as linhas atendidas; havendo falta, a decisão cabe a Operações
  if (result === "complete" && missingLines.length > 0) {
    return res.status(409).json({
      message: "Não é possível concluir como completo com itens em falta. Registre a conferência como parcial ou pendência de estoque para decisão de Operações."
    });
  }

  if (result !== "complete" && missingLines.length === 0) {
    return res.status(400).json({ message: "Todos os itens foram conferidos integralmente. Registre o resultado como completo." });
  }

  const nextStatus = result === "complete" ? "stock_picking" : "stock_returned";
  // Hora oficial obtida antes de abrir a transação, para não segurar a linha travada esperando a rede
  const checkedAt = await networkNow();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const updated = await transitionStatus(
      client,
      order.id,
      "stock_checking",
      nextStatus,
      "stock_result = $4, stock_accessories_note = $5, stock_checker_id = $6, stock_checked_at = $7",
      [result, accessoriesNote, req.user.id, checkedAt]
    );

    if (!updated) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "A conferência desta ordem já foi registrada." });
    }

    for (const line of lines) {
      await client.query(
        "UPDATE order_items SET stock_checked_quantity = $1, stock_note = $2, stock_accessories = $3 WHERE id = $4",
        [line.checked, line.note, line.accessories, line.id]
      );
    }

    const missingSummary = missingLines.length
      ? ` Itens em falta: ${missingLines.map((line) => `item ${line.line} (${line.terminalModel}) ${line.checked}/${line.requested}`).join("; ")}.`
      : "";
    const accompanyingSummary = ` Acompanham o terminal: ${lines
      .map((line) => `item ${line.line}: ${line.accessories.map((key) => STOCK_ACCESSORY_LABELS[key]).join(", ") || "nenhum"}`)
      .join("; ")}.`;

    await addOrderEvent({
      orderId: order.id,
      actorId: req.user.id,
      eventType: "Conferência registrada",
      message: `Conferência do estoque: ${STOCK_RESULT_LABELS[result]}.${missingSummary}${accompanyingSummary}${accessoriesNote ? ` Acessórios: ${accessoriesNote}` : ""}`,
      metadata: {
        result,
        accessoriesNote,
        items: lines.map(({ id, line, requested, checked, note, accessories }) => ({ id, line, requested, checked, note, accessories }))
      }
    }, client);

    await client.query("COMMIT");
    return res.json(updated);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

ordersRouter.post("/:id/stock/release", requireRole("stock"), async (req, res) => {
  const order = await findOrder(req.params.id);

  if (!order) {
    return res.status(404).json({ message: "Ordem nao encontrada." });
  }

  if (order.status !== "stock_picking") {
    return res.status(409).json({ message: "Apenas ordens em separação podem ser liberadas ao Suporte." });
  }

  const updated = await withTransaction(async (client) => {
    const row = await transitionStatus(client, order.id, "stock_picking", "pending_signature");
    if (row) {
      await addOrderEvent({
        orderId: order.id,
        actorId: req.user.id,
        eventType: "Separação concluída",
        message: "Material separado pelo estoque. Ordem enviada para assinatura do Suporte."
      }, client);
    }
    return row;
  });

  if (!updated) {
    return res.status(409).json({ message: "Esta ordem já foi liberada." });
  }

  return res.json(updated);
});

// Ações de Operações sobre OS devolvidas pelo Estoque por falta de material
async function findReturnedOrder(req, res) {
  const order = await findOrder(req.params.id);

  if (!order) {
    res.status(404).json({ message: "Ordem nao encontrada." });
    return null;
  }

  if (req.user.role !== "admin" && order.requester_id !== req.user.id) {
    res.status(403).json({ message: "Permissao insuficiente." });
    return null;
  }

  if (order.status !== "stock_returned") {
    res.status(409).json({ message: "Apenas ordens devolvidas pelo estoque aceitam esta ação." });
    return null;
  }

  return order;
}

ordersRouter.post("/:id/stock-return/forward", requireRole("requester", "admin"), async (req, res) => {
  const order = await findReturnedOrder(req, res);
  if (!order) return;

  const parsed = stockForwardSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message });
  }

  const updated = await withTransaction(async (client) => {
    const row = await transitionStatus(client, order.id, "stock_returned", "pending_signature");
    if (row) {
      await addOrderEvent({
        orderId: order.id,
        actorId: req.user.id,
        eventType: "Encaminhada com falta de material",
        message: `Operações encaminhou ao Suporte com conferência ${STOCK_RESULT_LABELS[order.stock_result] ?? "incompleta"}. Justificativa: ${parsed.data.justification}`,
        metadata: { decision: "forward_to_support", stockResult: order.stock_result, justification: parsed.data.justification }
      }, client);
    }
    return row;
  });

  if (!updated) {
    return res.status(409).json({ message: "Esta ordem já recebeu uma decisão." });
  }

  return res.json(updated);
});

ordersRouter.post("/:id/stock-return/recheck", requireRole("requester", "admin"), async (req, res) => {
  const order = await findReturnedOrder(req, res);
  if (!order) return;

  const note = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const updated = await withTransaction(async (client) => {
    const row = await transitionStatus(
      client,
      order.id,
      "stock_returned",
      "awaiting_stock_check",
      "stock_result = NULL, stock_accessories_note = NULL, stock_checker_id = NULL, stock_checked_at = NULL"
    );
    if (row) {
      await clearStockItemCheck(client, order.id);
      await addOrderEvent({
        orderId: order.id,
        actorId: req.user.id,
        eventType: "Devolvida ao estoque",
        message: `Operações devolveu a ordem para nova conferência do estoque.${note ? ` Observação: ${note}` : ""}`,
        metadata: { decision: "return_to_stock", previousStockResult: order.stock_result }
      }, client);
    }
    return row;
  });

  if (!updated) {
    return res.status(409).json({ message: "Esta ordem já recebeu uma decisão." });
  }

  return res.json(updated);
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

  // Status e assinaturas mudam juntos; a condição de status impede duas devolutivas simultâneas.
  const updated = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE service_orders
       SET status = 'correction_requested', signer_id = NULL, second_signer_id = NULL, updated_at = NOW()
       WHERE id = $1 AND status::text IN ('pending_signature', 'divergent')
       RETURNING *`,
      [order.id]
    );
    if (rows[0]) {
      await client.query("DELETE FROM order_signatures WHERE service_order_id = $1", [order.id]);
      await addOrderEvent({
        orderId: order.id,
        actorId: req.user.id,
        eventType: "Correção necessária",
        message: parsed.data.message
      }, client);
    }
    return rows[0];
  });

  if (!updated) {
    return res.status(409).json({ message: "Apenas ordens pendentes ou divergentes podem receber devolutiva." });
  }

  return res.json(updated);
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

    // Quem assinou fica identificado pelo e-mail do usuario logado, sem edicao manual
    const signerName = req.user.email;
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

        const [firstSignature] = await loadSignaturesForAttempt(client, order.id);

        // Limpa as assinaturas para que a OS retorne para a etapa de assinatura e fique novamente disponível
        await client.query("DELETE FROM order_signatures WHERE service_order_id = $1", [order.id]);

        const incorrectCount = rows[0].incorrect_signatures;

        await recordSignatureAttempt(client, {
          orderId: order.id,
          attemptNumber: incorrectCount,
          errorType: "divergencia_double_check",
          signatures: [firstSignature, { signerId: req.user.id, signerName: req.user.name, keyCount: secondKeyCount }],
          reportedBy: req.user
        });

        if (incorrectCount >= 2) {
          const occDesc = `Identificadas ${incorrectCount} tentativas de assinatura com divergência no double check.`;
          await upsertActiveOccurrence(client, {
            order,
            user: req.user,
            errorType: "divergencia_double_check",
            attemptCount: incorrectCount,
            description: occDesc
          });
        }

        await addOrderEvent({
          orderId: order.id,
          actorId: req.user.id,
          eventType: "Assinatura incorreta",
          message: `Assinatura realizada incorretamente (${incorrectCount}ª tentativa). As quantidades de chaves divergiram no double check. Ordem retornada para nova assinatura.`,
          metadata: {
            divergenceType: "key_count_mismatch",
            incorrectCount
          }
        }, client);

        await client.query("COMMIT");

        if (incorrectCount >= 2) {
          triggerAutomaticNotification(order.id, req.user.id);
        }

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
      `SELECT terminal_model, part_number, client_name, quantity, configuration,
              packaging, battery, terminal_opening, manual, charger, minbase, label, aesthetic_cover
       FROM order_items WHERE service_order_id = $1 ORDER BY item_index ASC, created_at ASC, id ASC`,
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
      items: itemsRes.rows,
      signedAt: (await networkNow()).toISOString()
    });

    await client.query(
      `INSERT INTO order_signatures (service_order_id, signer_id, signer_name, signature_hash, signed_payload, ip_address, user_agent, key_count, signed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [order.id, req.user.id, signerName, signatureHash, payload, ipAddress, userAgent, keyCount, payload.signedAt]
    );

    const signatureCount = existingSignatures.rows.length + 1;
    const nextStatus = signatureCount >= 2 ? "signed" : "pending_signature";

    const updateSql = signatureCount === 1
      ? "UPDATE service_orders SET signer_id = $1, status = $2, updated_at = NOW() WHERE id = $3 RETURNING *"
      : "UPDATE service_orders SET second_signer_id = $1, status = $2, updated_at = NOW() WHERE id = $3 RETURNING *";

    const { rows } = await client.query(updateSql, [req.user.id, nextStatus, order.id]);

    await addOrderEvent({
      orderId: order.id,
      actorId: req.user.id,
      eventType: "Assinada",
      message: signatureCount >= 2
        ? "Ordem aprovada com duas assinaturas no double check."
        : "Primeira assinatura registrada. Aguardando segunda assinatura.",
      metadata: { signatureHash, signatureCount, keyCount }
    }, client);

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

  const reasonText = normalizeReason(req.body?.reason);
  const reason = reasonText ? ` Motivo: ${reasonText}.` : "";
  // Status permitidos no momento da escrita (mesma regra validada acima, aplicada de forma atômica)
  const allowedStatuses = req.user.role === "admin" ? ["pending_signature", "signed"] : ["pending_signature"];

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
       WHERE id = $1 AND status::text = ANY($2::text[])
       RETURNING *`,
      [order.id, allowedStatuses]
    );

    if (!rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ message: "A ordem mudou de etapa. Recarregue e tente novamente." });
    }

    const signaturesBefore = await loadSignaturesForAttempt(client, order.id);

    await client.query("DELETE FROM order_signatures WHERE service_order_id = $1", [order.id]);

    const incorrectCount = rows[0].incorrect_signatures;

    await recordSignatureAttempt(client, {
      orderId: order.id,
      attemptNumber: incorrectCount,
      errorType: "assinatura_incorreta",
      signatures: signaturesBefore,
      reportedBy: req.user,
      reason: reasonText
    });

    if (incorrectCount >= 2) {
      const occDesc = `Identificadas ${incorrectCount} tentativas incorretas de assinatura.${reason}`;
      await upsertActiveOccurrence(client, {
        order,
        user: req.user,
        errorType: "assinatura_incorreta",
        attemptCount: incorrectCount,
        description: occDesc
      });
    }

    await addOrderEvent({
      orderId: order.id,
      actorId: req.user.id,
      eventType: "Assinatura incorreta",
      message: `Assinatura realizada incorretamente (${incorrectCount}ª tentativa).${reason} Ordem retornada para a etapa de assinatura.`,
      metadata: {
        incorrectCount,
        reason: reasonText
      }
    }, client);

    await client.query("COMMIT");

    if (incorrectCount >= 2) {
      triggerAutomaticNotification(order.id, req.user.id);
    }

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
