import express from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";

export const catalogRouter = express.Router();

const itemSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

async function listCatalog() {
  const [orderTypes, terminalModels, partNumbers] = await Promise.all([
    query("SELECT id, name, active, created_at FROM order_types WHERE active = TRUE ORDER BY name"),
    query("SELECT id, name, active, created_at FROM terminal_models WHERE active = TRUE ORDER BY name"),
    query(`SELECT pn.id, pn.terminal_model_id, tm.name AS terminal_model_name, tm.name AS model_name, pn.part_number, pn.active, pn.created_at
           FROM part_numbers pn
           JOIN terminal_models tm ON tm.id = pn.terminal_model_id
           WHERE pn.active = TRUE AND tm.active = TRUE
           ORDER BY tm.name, pn.part_number`)
  ]);

  return {
    orderTypes: orderTypes.rows,
    terminalModels: terminalModels.rows,
    partNumbers: partNumbers.rows
  };
}

catalogRouter.get("/", async (_req, res) => {
  return res.json(await listCatalog());
});

catalogRouter.post("/order-types", requireRole("admin"), async (req, res) => {
  const parsed = itemSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: "Informe um tipo de ordem valido." });
  }

  const { rows } = await query(
    `INSERT INTO order_types (name)
     VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET active = TRUE
     RETURNING id, name, active, created_at`,
    [parsed.data.name]
  );

  return res.status(201).json(rows[0]);
});

catalogRouter.post("/terminal-models", requireRole("admin"), async (req, res) => {
  const parsed = itemSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: "Informe um modelo de terminal valido." });
  }

  const { rows } = await query(
    `INSERT INTO terminal_models (name)
     VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET active = TRUE
     RETURNING id, name, active, created_at`,
    [parsed.data.name]
  );

  return res.status(201).json(rows[0]);
});

const partNumberSchema = z.object({
  terminalModelId: z.string().uuid().optional(),
  terminalModelName: z.string().trim().min(1).optional(),
  partNumber: z.string().trim().min(1).max(80)
});

catalogRouter.post("/part-numbers", requireRole("admin"), async (req, res) => {
  const parsed = partNumberSchema.safeParse(req.body);

  if (!parsed.success || (!parsed.data.terminalModelId && !parsed.data.terminalModelName)) {
    return res.status(400).json({ message: "Informe o modelo e um Part Number valido." });
  }

  let modelId = parsed.data.terminalModelId;
  if (!modelId && parsed.data.terminalModelName) {
    const modelRes = await query("SELECT id FROM terminal_models WHERE name = $1 AND active = TRUE", [parsed.data.terminalModelName]);
    if (!modelRes.rows[0]) {
      return res.status(400).json({ message: "Modelo de terminal nao encontrado." });
    }
    modelId = modelRes.rows[0].id;
  }

  const { rows } = await query(
    `INSERT INTO part_numbers (terminal_model_id, part_number)
     VALUES ($1, $2)
     ON CONFLICT (terminal_model_id, part_number) DO UPDATE SET active = TRUE
     RETURNING id, terminal_model_id, part_number, active, created_at`,
    [modelId, parsed.data.partNumber]
  );

  return res.status(201).json(rows[0]);
});
