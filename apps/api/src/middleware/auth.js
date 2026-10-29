import jwt from "jsonwebtoken";
import { query } from "../db/pool.js";

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Token ausente." });
  }

  try {
    const token = header.slice("Bearer ".length);
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await query(
      "SELECT id, name, email, role FROM users WHERE id = $1 AND active = TRUE",
      [payload.id]
    );

    if (!rows[0]) {
      return res.status(401).json({ message: "Usuario inativo ou inexistente." });
    }

    req.user = rows[0];
    return next();
  } catch {
    return res.status(401).json({ message: "Token invalido." });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Permissao insuficiente." });
    }

    return next();
  };
}
