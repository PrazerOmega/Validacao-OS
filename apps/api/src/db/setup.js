import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { pool, query } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "schema.sql");

const users = [
  { name: "Administrador", email: "admin@empresa.com", role: "admin" },
  { name: "Solicitante", email: "solicitante@empresa.com", role: "requester" },
  { name: "Assinante", email: "assinante@empresa.com", role: "signer" },
  { name: "Espectador", email: "espectador@empresa.com", role: "spectator" }
];

async function main() {
  const schema = await fs.readFile(schemaPath, "utf8");
  await query(schema);

  const passwordHash = await bcrypt.hash("123456", 10);

  for (const user of users) {
    await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, role = EXCLUDED.role, active = TRUE`,
      [user.name, user.email, passwordHash, user.role]
    );
  }

  console.log("Banco configurado com sucesso.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
