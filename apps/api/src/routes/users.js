import bcrypt from "bcryptjs";
import express from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { requireRole } from "../middleware/auth.js";
import { USER_ROLES, rejectInvalidUuid } from "../utils/validation.js";

export const usersRouter = express.Router();

usersRouter.param("id", rejectInvalidUuid("Usuario nao encontrado."));

// UUID é aceito em maiúsculas pela rota, mas o Postgres devolve em minúsculas
const isSelf = (req) => req.params.id.toLowerCase() === String(req.user.id).toLowerCase();

const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(USER_ROLES)
});

const userUpdateSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  role: z.enum(USER_ROLES).optional(),
  active: z.boolean().optional()
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

  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);
    const { rows } = await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, active, created_at`,
      [parsed.data.name, parsed.data.email, passwordHash, parsed.data.role]
    );

    return res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ message: "Este e-mail já está em uso por outro usuário." });
    }
    throw error;
  }
});

usersRouter.patch("/:id", requireRole("admin"), async (req, res) => {
  const parsed = userUpdateSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: "Dados de usuario invalidos." });
  }

  if (isSelf(req) && (parsed.data.role || parsed.data.active === false)) {
    return res.status(409).json({ message: "Nao altere seu proprio tipo nem remova seu proprio usuario." });
  }

  try {
    const { rows } = await query(
      `UPDATE users
       SET name = COALESCE($1, name),
           email = COALESCE($2, email),
           role = COALESCE($3::user_role, role),
           active = COALESCE($4::boolean, active)
       WHERE id = $5
       RETURNING id, name, email, role, active, created_at`,
      [
        parsed.data.name ?? null,
        parsed.data.email ?? null,
        parsed.data.role ?? null,
        typeof parsed.data.active === "boolean" ? parsed.data.active : null,
        req.params.id
      ]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: "Usuario nao encontrado." });
    }

    return res.json(rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ message: "Este e-mail já está em uso por outro usuário." });
    }
    throw error;
  }
});

usersRouter.delete("/:id", requireRole("admin"), async (req, res) => {
  if (isSelf(req)) {
    return res.status(409).json({ message: "Nao remova seu proprio usuario." });
  }

  const { rows } = await query(
    `UPDATE users
     SET active = FALSE
     WHERE id = $1
     RETURNING id, name, email, role, active, created_at`,
    [req.params.id]
  );

  if (!rows[0]) {
    return res.status(404).json({ message: "Usuario nao encontrado." });
  }

  return res.json(rows[0]);
});
