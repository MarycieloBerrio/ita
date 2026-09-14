const cop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0,
});
export const money = (value: number | null | undefined) =>
  value == null ? 'Por definir' : cop.format(value);
export function bogotaDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function localDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return parts.replace(' ', 'T');
}
export const toIso = (value: string) => new Date(`${value}:00-05:00`).toISOString();
export function dateLabel(value: string, time = true) {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(time ? ({ hour: '2-digit', minute: '2-digit' } as const) : {}),
  }).format(new Date(value.length === 10 ? `${value}T12:00:00-05:00` : value));
}
export const statusLabel: Record<string, string> = {
  draft: 'Borrador',
  in_progress: 'En atención',
  completed: 'Finalizada',
  void: 'Anulada por error',
  scheduled: 'Programada',
  confirmed: 'Confirmada',
  cancelled: 'Cancelada',
  no_show: 'No asistió',
  unpaid: 'Sin pagar',
  partial: 'Pago parcial',
  paid: 'Pagado',
  pending_prices: 'Precios pendientes',
  discarded: 'Descartada',
};
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'No se pudo completar la operación.';
