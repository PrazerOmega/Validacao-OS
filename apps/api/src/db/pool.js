import pg from "pg";
import "dotenv/config";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
});

// Sem este handler, um erro em uma conexão ociosa (ex.: banco reiniciado) derruba o processo.
pool.on("error", (error) => {
  console.error("[Banco] Erro em conexão ociosa do pool:", error.message);
});

export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Executa `work(client)` dentro de uma transação, com COMMIT em caso de sucesso
 * e ROLLBACK em caso de erro. O cliente é sempre devolvido ao pool.
 */
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
