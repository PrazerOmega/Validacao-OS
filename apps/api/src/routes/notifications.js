import express from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { MAX_RECIPIENTS } from "../services/emailService.js";
import { rejectInvalidUuid } from "../utils/validation.js";

// Lista de e-mails que recebem automaticamente os alertas de assinatura incorreta.
export const notificationsRouter = express.Router();

notificationsRouter.param("id", rejectInvalidUuid("E-mail não encontrado."));

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido.")
});

notificationsRouter.get("/", requireRole("admin"), async (_req, res) => {
  const { rows } = await query("SELECT id, email, created_at FROM notification_emails ORDER BY email");
  return res.json(rows);
});

notificationsRouter.post("/", requireRole("admin"), async (req, res) => {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Informe um e-mail válido." });
  }

  const { rows: countRows } = await query("SELECT COUNT(*)::int AS total FROM notification_emails");
  if (countRows[0].total >= MAX_RECIPIENTS) {
    return res.status(400).json({ message: `Limite de ${MAX_RECIPIENTS} e-mails cadastrados atingido.` });
  }

  const { rows } = await query(
    `INSERT INTO notification_emails (email) VALUES ($1)
     ON CONFLICT ((LOWER(email))) DO NOTHING
     RETURNING id, email, created_at`,
    [parsed.data.email]
  );

  if (!rows[0]) {
    return res.status(409).json({ message: "Este e-mail já está cadastrado." });
  }
  return res.status(201).json(rows[0]);
});

notificationsRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  const { rowCount } = await query("DELETE FROM notification_emails WHERE id = $1", [req.params.id]);
  if (!rowCount) {
    return res.status(404).json({ message: "E-mail não encontrado." });
  }
  return res.status(204).end();
});

export async function listNotificationEmails() {
  const { rows } = await query("SELECT email FROM notification_emails ORDER BY email");
  return rows.map((row) => row.email);
}
