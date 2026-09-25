/**
 * SQLSTATE classes that prove the database rolled the transaction back: data exceptions (22),
 * integrity violations (23), authorization (28), transaction rollback (40), syntax/access (42)
 * and PL/pgSQL raise_exception (P0). Connection (08) and transport failures stay uncertain.
 */
const DEFINITE_REJECTION = /^(?:22|23|28|40|42|P0)[A-Z0-9]{3}$/;
/** Client-side refusals raised before anything was sent to the server. */
const LOCAL_REFUSALS = ['OPERATION_PENDING', 'AUTH_REQUIRED', 'AUTH_CHANGED'];

function codeOf(cause: unknown): string {
  if (!cause || typeof cause !== 'object') return '';
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

export function isDefiniteRejectionCode(code: string | null | undefined): boolean {
  return DEFINITE_REJECTION.test(code ?? '');
}

/** True when a retry may use a fresh operation key because the previous one never applied. */
export function releasesOperationKey(cause: unknown): boolean {
  const code = codeOf(cause);
  return isDefiniteRejectionCode(code) || LOCAL_REFUSALS.includes(code);
}
