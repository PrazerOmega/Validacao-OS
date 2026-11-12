import express from "express";
import { query } from "../db/pool.js";
import { BRASILIA_TIMEZONE } from "../utils/networkTime.js";

export const dashboardRouter = express.Router();

dashboardRouter.get("/", async (req, res) => {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;

    let baseFilter = "";
    const params = [];

    // O dashboard respeita rigorosamente as permissões de visibilidade de cada perfil
    if (userRole === "requester") {
      params.push(userId);
      baseFilter = `WHERE requester_id = $${params.length}`;
    } else if (userRole === "signer") {
      params.push(userRole);
      baseFilter = `WHERE destination_role = $${params.length} AND status != 'draft'`;
    } else if (userRole === "spectator") {
      baseFilter = "WHERE status != 'draft'";
    } else if (userRole === "stock") {
      // Mesma regra de STOCK_VISIBILITY_SQL em orders.js: rascunho nunca entra
      baseFilter = `WHERE status::text <> 'draft' AND (status::text IN ('awaiting_stock_check', 'stock_checking', 'stock_picking', 'stock_returned') OR stock_checker_id IS NOT NULL)`;
    } else {
      // Admin: visão geral de todas as ordens
      baseFilter = "";
    }

    const sql = `
      SELECT
        COUNT(*)::int AS "totalOrders",
        COUNT(*) FILTER (WHERE status = 'pending_signature')::int AS "awaitingValidation",
        COUNT(*) FILTER (WHERE status = 'correction_requested')::int AS "awaitingCorrection",
        COUNT(*) FILTER (WHERE status = 'signed')::int AS "approved",
        COUNT(*) FILTER (WHERE status = 'divergent' OR incorrect_signatures > 0)::int AS "divergent",
        COUNT(*) FILTER (WHERE status::text IN ('awaiting_stock_check', 'stock_checking'))::int AS "awaitingStockCheck",
        COUNT(*) FILTER (WHERE status::text = 'stock_picking')::int AS "stockPicking",
        COUNT(*) FILTER (WHERE status::text = 'stock_returned')::int AS "stockReturned"
      FROM service_orders
      ${baseFilter}
    `;

    const { rows } = await query(sql, params);
    const metrics = rows[0] || {
      totalOrders: 0,
      awaitingValidation: 0,
      awaitingCorrection: 0,
      approved: 0,
      divergent: 0,
      awaitingStockCheck: 0,
      stockPicking: 0,
      stockReturned: 0
    };

    // 1. Gráfico de notas / ordens de serviço realizadas por período
    const periodParams = userRole === "requester" ? [userId] : [];
    // Últimos 14 dias com ordens concluídas, agrupados pelo dia no calendário de Brasília
    // (o banco roda em UTC) e devolvidos em ordem cronológica.
    const periodSql = `
      SELECT TO_CHAR(day, 'YYYY-MM-DD') AS date, TO_CHAR(day, 'DD/MM') AS label, count
      FROM (
        SELECT
          DATE(updated_at AT TIME ZONE '${BRASILIA_TIMEZONE}') AS day,
          COUNT(*)::int AS count
        FROM service_orders
        ${userRole === "requester" ? "WHERE requester_id = $1 AND status = 'signed'" : "WHERE status = 'signed'"}
        GROUP BY day
        ORDER BY day DESC
        LIMIT 14
      ) recent
      ORDER BY day ASC
    `;

    // 2. Gráfico de assinaturas reais realizadas por pessoa (com nome padronizado de users)
    const personParams = userRole === "requester" ? [userId] : [];
    const personSql = `
      SELECT
        u.name AS "userName",
        COUNT(os.id)::int AS count
      FROM order_signatures os
      JOIN users u ON u.id = os.signer_id
      JOIN service_orders so ON so.id = os.service_order_id
      ${userRole === "requester" ? "WHERE so.requester_id = $1" : ""}
      GROUP BY u.id, u.name
      ORDER BY count DESC, u.name ASC
      LIMIT 10
    `;

    const [periodRes, personRes] = await Promise.all([
      query(periodSql, periodParams),
      query(personSql, personParams)
    ]);

    return res.json({
      userRole,
      metrics,
      charts: {
        ordersCompletedByPeriod: periodRes.rows,
        signaturesByPerson: personRes.rows
      }
    });
  } catch (error) {
    console.error("Erro ao carregar dados do dashboard:", error);
    return res.status(500).json({ message: "Erro ao carregar dados do dashboard." });
  }
});
