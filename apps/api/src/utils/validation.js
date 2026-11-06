export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const USER_ROLES = ["admin", "requester", "signer", "spectator", "stock"];

/**
 * Middleware para `router.param("id", ...)`: IDs que não são UUID retornam 404
 * em vez de provocar erro 500 no PostgreSQL.
 */
export function rejectInvalidUuid(notFoundMessage) {
  return (_req, res, next, id) => {
    if (!UUID_REGEX.test(id)) {
      return res.status(404).json({ message: notFoundMessage });
    }
    return next();
  };
}
