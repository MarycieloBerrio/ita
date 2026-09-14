/** Tab-local recovery journal. Never persisted or replayed automatically. */
export interface PendingOperation {
  actorId: string;
  id: string;
  action: string;
  payload: object;
  signature: string;
  state: 'sending' | 'uncertain';
}
export interface CompletedOperation {
  actorId: string;
  id: string;
  signature: string;
  result?: unknown;
  error?: { message: string; code?: string };
  needsAcknowledgement: boolean;
}
let actorId: string | null = null;
const pending = new Map<string, PendingOperation>();
const completed = new Map<string, CompletedOperation>();
const listeners = new Set<() => void>();
let snapshot: readonly PendingOperation[] = [];
const key = (actor: string, id: string) => `${actor}:${id}`;
function publish() {
  snapshot = [...pending.values()].filter((entry) => entry.actorId === actorId);
  listeners.forEach((listener) => listener());
}
export function setOperationActor(id: string | null) {
  actorId = id;
  publish();
}
export const getOperationActor = () => actorId;
export const getPendingOperations = () => snapshot;
export function subscribeOperations(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const operationSignature = (action: string, payload: object) =>
  JSON.stringify(canonical({ action, payload }));
export function getPendingOperation(actor: string, id: string) {
  return pending.get(key(actor, id));
}
export function getCompletedOperation(id: string, actor = actorId) {
  return actor ? completed.get(key(actor, id)) : undefined;
}
/** Called only by an explicit form submission, never on reconnect or a timer. */
export function findOperationRetry(action: string, payload: object) {
  const signature = operationSignature(action, payload);
  const uncertain = snapshot.find(
    (entry) => entry.signature === signature && entry.state === 'uncertain',
  );
  if (uncertain) return uncertain.id;
  return [...completed.values()].find(
    (entry) =>
      entry.actorId === actorId && entry.signature === signature && entry.needsAcknowledgement,
  )?.id;
}
export function beginOperation(entry: Omit<PendingOperation, 'state'>) {
  pending.set(key(entry.actorId, entry.id), {
    ...entry,
    payload: structuredClone(entry.payload),
    state: 'sending',
  });
  publish();
}
export function markOperationUncertain(actor: string, id: string) {
  const entry = pending.get(key(actor, id));
  if (entry) pending.set(key(actor, id), { ...entry, state: 'uncertain' });
  publish();
}
export function completeOperation(
  actor: string,
  id: string,
  outcome: Pick<CompletedOperation, 'result' | 'error'>,
  recovered = false,
) {
  const entry = pending.get(key(actor, id));
  if (!entry) return;
  completed.set(key(actor, id), {
    actorId: actor,
    id,
    signature: entry.signature,
    ...outcome,
    needsAcknowledgement: recovered,
  });
  // Ordinary successful autosaves must not grow tab memory indefinitely. Recovery outcomes
  // remain available until a form acknowledges them, regardless of this history bound.
  const acknowledged = [...completed.entries()].filter(([, value]) => !value.needsAcknowledgement);
  for (const [oldKey] of acknowledged.slice(0, Math.max(0, acknowledged.length - 100)))
    completed.delete(oldKey);
  pending.delete(key(actor, id));
  publish();
}
export function acknowledgeOperation(actor: string, id: string) {
  const entry = completed.get(key(actor, id));
  if (entry) completed.set(key(actor, id), { ...entry, needsAcknowledgement: false });
}
/** An unresolved operation still needs a warning when its account signs out. */
export const hasUnsettledOperations = () => pending.size > 0;
