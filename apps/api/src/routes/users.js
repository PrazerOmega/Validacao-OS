import bcrypt from "bcryptjs";
import express from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";

export const usersRouter = express.Router();

const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(["admin", "requester", "signer"])
});

usersRouter.get("/", requireRole("admin"), async (_req, res) => {
  const { rows } = await query(
    "SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at DESC"
  );
  return res.json(rows);
});

usersRouter.get("/signers", async (_req, res) => {
  const { rows } = await query(
    "SELECT id, name, email FROM users WHERE role = 'signer' AND active = TRUE ORDER BY name"
  );
  return res.json(rows);
});

usersRouter.post("/", requireRole("admin"), async (req, res) => {
  const parsed = userSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: "Dados de usuario invalidos." });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, email, role, active, created_at`,
    [parsed.data.name, parsed.data.email, passwordHash, parsed.data.role]
  );

  return res.status(201).json(rows[0]);
});
