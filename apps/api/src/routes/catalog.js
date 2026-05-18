import express from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";

export const catalogRouter = express.Router();

const itemSchema = z.object({
  name: z.string().trim().min(1).max(80)
});

async function listCatalog() {
  const [orderTypes, terminalModels] = await Promise.all([
    query("SELECT id, name, active, created_at FROM order_types WHERE active = TRUE ORDER BY name"),
    query("SELECT id, name, active, created_at FROM terminal_models WHERE active = TRUE ORDER BY name")
  ]);

  return {
    orderTypes: orderTypes.rows,
    terminalModels: terminalModels.rows
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
