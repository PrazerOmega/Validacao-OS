import crypto from "node:crypto";

export function buildSignature({ order, signer, signerName, keyCount, ipAddress, userAgent }) {
  const signedAt = new Date().toISOString();
  const payload = {
    orderId: order.id,
    code: order.code,
    orderType: order.order_type,
    itemName: order.item_name,
    itemIdentifier: order.item_identifier,
    authorizedPersonName: order.authorized_person_name,
    authorizedPersonDocument: order.authorized_person_document,
    usageReason: order.usage_reason,
    validFrom: order.valid_from,
    validUntil: order.valid_until,
    signatureDueAt: order.signature_due_at,
    signerId: signer.id,
    signerEmail: signer.email,
    signerName,
    keyCount: keyCount ?? null,
    signedAt,
    ipAddress,
    userAgent
  };

  const signatureHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");

  return { payload, signatureHash };
}
