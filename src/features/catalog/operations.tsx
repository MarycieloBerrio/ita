export type { Category } from '../../lib/contracts';
import type { Category } from '../../lib/contracts';

export const cop = (value: number | null | undefined) =>
  value == null
    ? 'Pendiente'
    : new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      }).format(value);
export const bogotaDate = (value: string) =>
  new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(new Date(value));
export const todayBogota = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export const integerAmount = (value: string, allowZero = false): number => {
  if (!/^\d+$/.test(value)) throw new Error('Introduce un importe en pesos enteros.');
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount > 9_000_000_000_000 || amount < (allowZero ? 0 : 1))
    throw new Error('El importe debe ser positivo y válido.');
  return amount;
};

export function categoryPath(categories: Category[], id: string | null): string {
  if (!id) return 'Sin categoría';
  const names: string[] = [];
  const seen = new Set<string>();
  let node = categories.find((category) => category.id === id);
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    names.unshift(node.name);
    node = categories.find((category) => category.id === node?.parent_id);
  }
  return names.join(' / ') || 'Categoría archivada';
}

export function categoryContains(
  categories: Category[],
  ancestor: string,
  id: string | null,
): boolean {
  if (!ancestor) return true;
  const seen = new Set<string>();
  let current = id;
  while (current && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    current = categories.find((category) => category.id === current)?.parent_id ?? null;
  }
  return false;
}

/** Single implementation lives in src/lib; re-exported so catalog-era importers keep working. */
export { useOperation } from '../../lib/useOperation';

export function OperationFeedback({ error, success }: { error?: string; success?: string }) {
  return (
    <>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {success && !error ? (
        <p className="success" role="status">
          {success}
        </p>
      ) : null}
    </>
  );
}

export function QueryFeedback({
  pending,
  error,
  retry,
}: {
  pending: boolean;
  error: Error | null;
  retry: () => unknown;
}) {
  if (pending)
    return (
      <p className="muted" role="status">
        Cargando información…
      </p>
    );
  if (error)
    return (
      <div className="error" role="alert">
        <p>{error.message}</p>
        <button className="button-secondary" onClick={() => void retry()}>
          Volver a intentar
        </button>
      </div>
    );
  return null;
}
