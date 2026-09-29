import { cloneJson } from './browserCompatibility';

/**
 * Tab-scoped recovery journal for commands whose outcome is not yet known.
 *
 * Pending entries (never completed results) are mirrored per actor into sessionStorage so a
 * reload of the same tab still knows the original operation key. Restored entries always come
 * back as `uncertain`, because a request that was in flight when the page unloaded may or may
 * not have committed. Nothing is ever replayed automatically: an entry is only re-sent when the
 * user explicitly retries it from the banner or resubmits a form with an identical signature
 * (see findOperationRetry). The stored copy is removed when the actor signs out or changes, so
 * another account in this tab never sees or inherits it.
 */
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
const STORAGE_PREFIX = 'ita.pendingOperations.v1:';
const pending = new Map<string, PendingOperation>();
const completed = new Map<string, CompletedOperation>();
const listeners = new Set<() => void>();
let snapshot: readonly PendingOperation[] = [];
const key = (actor: string, id: string) => `${actor}:${id}`;
function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
function isStoredOperation(value: unknown, actor: string): value is PendingOperation {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    entry.actorId === actor &&
    typeof entry.id === 'string' &&
    typeof entry.action === 'string' &&
    typeof entry.signature === 'string' &&
    !!entry.payload &&
    typeof entry.payload === 'object'
  );
}
/** Mirror the current actor's unresolved entries. Storage failures only lose the reload aid. */
function persist(actor: string) {
  if (actor !== actorId) return;
  const entries = [...pending.values()].filter((entry) => entry.actorId === actor);
  try {
    const store = storage();
    if (!store) return;
    if (entries.length) store.setItem(STORAGE_PREFIX + actor, JSON.stringify(entries));
    else store.removeItem(STORAGE_PREFIX + actor);
  } catch {
    /* Quota or privacy mode: the in-memory journal still protects this page. */
  }
}
function restore(actor: string) {
  let stored: unknown;
  try {
    const raw = storage()?.getItem(STORAGE_PREFIX + actor);
    stored = raw ? JSON.parse(raw) : [];
  } catch {
    stored = [];
  }
  if (!Array.isArray(stored)) return;
  for (const value of stored) {
    if (!isStoredOperation(value, actor) || pending.has(key(actor, value.id))) continue;
    if (completed.has(key(actor, value.id))) continue;
    pending.set(key(actor, value.id), {
      actorId: actor,
      id: value.id,
      action: value.action,
      payload: value.payload,
      signature: value.signature,
      state: 'uncertain',
    });
  }
}
function forget(actor: string) {
  try {
    storage()?.removeItem(STORAGE_PREFIX + actor);
  } catch {
    /* Nothing else to clean up. */
  }
}
function publish() {
  snapshot = [...pending.values()].filter((entry) => entry.actorId === actorId);
  listeners.forEach((listener) => listener());
}
export function setOperationActor(id: string | null) {
  if (actorId && actorId !== id) forget(actorId);
  actorId = id;
  if (id) {
    restore(id);
    persist(id);
  }
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
    payload: cloneJson(entry.payload),
    state: 'sending',
  });
  persist(entry.actorId);
  publish();
}
export function markOperationUncertain(actor: string, id: string) {
  const entry = pending.get(key(actor, id));
  if (entry) pending.set(key(actor, id), { ...entry, state: 'uncertain' });
  persist(actor);
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
  persist(actor);
  publish();
}
export function acknowledgeOperation(actor: string, id: string) {
  const entry = completed.get(key(actor, id));
  if (entry) completed.set(key(actor, id), { ...entry, needsAcknowledgement: false });
}
/** An unresolved operation still needs a warning when its account signs out. */
export const hasUnsettledOperations = () => pending.size > 0;
