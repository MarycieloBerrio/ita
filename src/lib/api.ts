import { QueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { requireSupabase } from './supabase';
import type { QueryAction, QueryResults } from './contracts';
import {
  acknowledgeOperation,
  beginOperation,
  completeOperation,
  getCompletedOperation,
  getOperationActor,
  getPendingOperation,
  getPendingOperations,
  markOperationUncertain,
  operationSignature,
} from './pendingOperations';
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, gcTime: 60_000, retry: 1, refetchOnWindowFocus: 'always' },
    mutations: { retry: false, networkMode: 'always' },
  },
});
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}
function translated(message: string): string {
  if (/fetch|network/i.test(message))
    return 'No se pudo confirmar la conexión. Conserva esta página abierta y reintenta al recuperar Internet.';
  return message;
}
export async function query<T>(
  action: string,
  payload: object = {},
  signal?: AbortSignal,
): Promise<T> {
  const request = requireSupabase().rpc('app_query', {
    p_action: action,
    p_payload: payload,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw new ApiError(translated(error.message), error.code);
  return data as T;
}
export async function command<T>(
  action: string,
  payload: object = {},
  operationId: string = crypto.randomUUID(),
  fromRecovery = false,
): Promise<T> {
  if (!navigator.onLine) throw new ApiError('Sin conexión. Los cambios aún no se han guardado.');
  const actor = getOperationActor();
  if (!actor) throw new ApiError('Comprueba tu acceso antes de guardar.', 'AUTH_REQUIRED');
  const signature = operationSignature(action, payload);
  const previous = getCompletedOperation(operationId, actor);
  if (previous) {
    if (previous.signature !== signature)
      throw new ApiError(
        'La confirmación anterior corresponde a otros datos.',
        'OPERATION_MISMATCH',
      );
    if (previous.error) throw new ApiError(previous.error.message, previous.error.code);
    // A result key is not a lasting permission: ownership or the user's role may have changed.
    const authorized = await query<QueryResults['operation']>('operation', {
      operation_id: operationId,
    });
    if (actor !== getOperationActor())
      throw new ApiError('La sesión cambió durante la comprobación.', 'AUTH_CHANGED');
    if (!authorized)
      throw new ApiError(
        'No se pudo recuperar la confirmación anterior. Revisa el registro antes de continuar.',
        'OPERATION_MISSING',
      );
    acknowledgeOperation(actor, operationId);
    return structuredClone(authorized.result) as T;
  }
  const existing = getPendingOperation(actor, operationId);
  if (existing && existing.signature !== signature)
    throw new ApiError(
      'Reintenta la confirmación pendiente con sus datos originales.',
      'OPERATION_MISMATCH',
    );
  if (existing?.state === 'sending')
    throw new ApiError('Esta confirmación ya se está comprobando.', 'OPERATION_BUSY');
  if (
    !existing &&
    getPendingOperations().some((entry) => entry.id !== operationId && entry.state === 'uncertain')
  )
    throw new ApiError(
      'Hay una confirmación incierta. Resuélvela en el aviso superior antes de guardar nuevos cambios.',
      'OPERATION_PENDING',
    );
  const originalPayload = existing?.payload ?? structuredClone(payload);
  beginOperation({ actorId: actor, id: operationId, action, payload: originalPayload, signature });
  try {
    const { data, error } = await requireSupabase().rpc('app_command', {
      p_action: action,
      p_payload: originalPayload,
      p_operation_id: operationId,
    });
    if (error) throw new ApiError(translated(error.message), error.code);
    completeOperation(actor, operationId, { result: structuredClone(data) }, fromRecovery);
    if (actor !== getOperationActor())
      throw new ApiError('La sesión cambió durante la confirmación.', 'AUTH_CHANGED');
    return data as T;
  } catch (cause) {
    if (isDefiniteRejection(cause))
      completeOperation(actor, operationId, {
        error: { message: cause.message, code: cause.code },
      });
    else markOperationUncertain(actor, operationId);
    throw cause;
  }
}
export function isDefiniteRejection(cause: unknown): cause is ApiError {
  return cause instanceof ApiError && /^(?:22|23|28|40|42|P0)[A-Z0-9]{3}$/.test(cause.code ?? '');
}
export async function checkPendingOperation(id: string): Promise<boolean> {
  if (!navigator.onLine)
    throw new ApiError('Sin conexión. Vuelve a comprobar cuando tengas Internet.');
  const actor = getOperationActor();
  if (!actor) throw new ApiError('Comprueba tu acceso antes de continuar.', 'AUTH_REQUIRED');
  const entry = getPendingOperation(actor, id);
  if (!entry || entry.state === 'sending') return false;
  const found = await query<QueryResults['operation']>('operation', { operation_id: id });
  if (actor !== getOperationActor())
    throw new ApiError('La sesión cambió durante la comprobación.', 'AUTH_CHANGED');
  if (found === null) return false; // Absence does not prove a still-running transaction was rolled back.
  completeOperation(actor, id, { result: structuredClone(found.result) }, true);
  await queryClient.invalidateQueries();
  return true;
}
export async function retryPendingOperation(id: string) {
  const actor = getOperationActor();
  const entry = actor ? getPendingOperation(actor, id) : undefined;
  if (!entry) return;
  await command(entry.action, entry.payload, entry.id, true);
  await queryClient.invalidateQueries();
}
export function useAppQuery<T = unknown>(action: string, payload: object = {}) {
  return useQuery<T>({
    queryKey: [action, payload],
    queryFn: ({ signal }) => query<T>(action, payload, signal),
    refetchInterval: ['appointments', 'visit', 'visits'].includes(action) ? 15000 : false,
  });
}
export function useTypedQuery<K extends QueryAction>(action: K, payload: object = {}) {
  return useAppQuery<QueryResults[K]>(action, payload);
}
export function useCommand(action: string) {
  return useMutation({
    mutationFn: (variables: { payload: object; operationId: string }) =>
      command(action, variables.payload, variables.operationId),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
