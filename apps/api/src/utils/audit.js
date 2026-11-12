import { query } from "../db/pool.js";
import { networkNow } from "./networkTime.js";

/**
 * Grava um evento no histórico da OS com a hora oficial (nunca o NOW() do banco).
 * Em transições de status, passar o `client` da transação: assim status e evento
 * são confirmados juntos e nunca sobra uma transição sem registro no histórico.
 */
export async function addOrderEvent({ orderId, actorId, eventType, message, metadata = {} }, client = { query }) {
  const createdAt = await networkNow();
  await client.query(
    `INSERT INTO order_events (service_order_id, actor_id, event_type, message, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [orderId, actorId, eventType, message, metadata, createdAt]
  );
}
