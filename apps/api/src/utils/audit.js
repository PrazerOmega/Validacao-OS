import { query } from "../db/pool.js";

export async function addOrderEvent({ orderId, actorId, eventType, message, metadata = {} }) {
  await query(
    `INSERT INTO order_events (service_order_id, actor_id, event_type, message, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [orderId, actorId, eventType, message, metadata]
  );
}
