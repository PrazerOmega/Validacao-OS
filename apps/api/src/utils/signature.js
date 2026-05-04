import crypto from "node:crypto";

export function buildSignature({ order, signer, ipAddress, userAgent }) {
  const signedAt = new Date().toISOString();
  const payload = {
    orderId: order.id,
    code: order.code,
    itemName: order.item_name,
    itemIdentifier: order.item_identifier,
    authorizedPersonName: order.authorized_person_name,
    authorizedPersonDocument: order.authorized_person_document,
    usageReason: order.usage_reason,
    validFrom: order.valid_from,
    validUntil: order.valid_until,
    signerId: signer.id,
    signerEmail: signer.email,
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
