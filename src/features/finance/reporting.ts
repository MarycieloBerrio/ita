import type { FinanceResult } from '../../lib/contracts';

export function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  // Control characters before a formula can bypass spreadsheet detection.
  const protectedText =
    // eslint-disable-next-line no-control-regex
    /^[\s\u0000-\u001f]*[=+@-]/.test(text) && typeof value !== 'number' ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}

export function financeCsv(report: FinanceResult): string {
  const rows: (string | number | null | undefined)[][] = [
    ['ita · reporte operativo'],
    ['Desde', report.from, 'Hasta', report.to, 'Zona horaria', 'America/Bogota'],
    ['Moneda', report.currency, 'Generado', report.generated_at],
    [
      'Tipo',
      'Identificador',
      'Cuenta',
      'Fecha real',
      'Concepto / categoría',
      'Método',
      'Importe COP',
      'Estado',
      'Original',
    ],
    ...report.charges.map((item) => [
      'Cargo',
      item.id,
      item.account_id,
      item.confirmed_at,
      `${item.name} / ${item.path}`,
      '',
      item.amount,
      'Confirmado',
      '',
    ]),
    ...report.payments.map((item) => [
      'Cobro',
      item.id,
      item.account_id,
      item.paid_at,
      item.reference,
      item.method_name,
      item.amount,
      item.corrected_by ? 'Rectificado' : 'Válido',
      item.correction_of,
    ]),
    ...report.expenses.map((item) => [
      'Egreso',
      item.id,
      '',
      item.paid_at,
      `${item.concept} / ${item.category}`,
      item.method_name,
      item.amount,
      item.corrected_by ? 'Rectificado' : 'Válido',
      item.correction_of,
    ]),
    ...report.accounts.map((item) => [
      'Saldo de cuenta',
      item.id,
      item.id,
      '',
      '',
      '',
      item.balance,
      item.pending_prices ? `${item.pending_prices} precios pendientes` : item.payment_status,
      '',
    ]),
    ['Cargos confirmados', report.totals.charges],
    ['Cobros válidos', report.totals.collected],
    ['Egresos pagados', report.totals.expenses],
    ['Flujo operativo neto', report.totals.operating_flow],
    ['Saldo pendiente global', report.totals.balance],
    ['Servicios sin valorar', report.totals.pending_prices],
    [
      'Caja',
      'Apertura',
      'Cierre',
      'Efectivo inicial COP',
      'Esperado COP',
      'Contado COP',
      'Diferencia COP',
      'Notas',
    ],
    ...report.cash_sessions.map((item) => [
      item.id,
      item.opened_at,
      item.closed_at,
      item.opening_amount,
      item.expected_amount,
      item.counted_amount,
      item.difference,
      item.notes,
    ]),
    ['Movimiento de caja', 'Caja', 'Fecha', 'Tipo', 'Importe COP', 'Motivo'],
    ...report.cash_movements.map((item) => [
      item.id,
      item.session_id,
      item.created_at,
      item.kind === 'contribution' ? 'Aporte' : 'Retiro',
      item.amount,
      item.reason,
    ]),
  ];
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function bogotaInput(timestamp = new Date().toISOString(), seconds = false): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' as const } : {}),
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}${seconds ? `:${get('second')}` : ''}`;
}

export function fromBogotaInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value))
    throw new Error('Indica fecha y hora válidas en Bogotá.');
  const seconds = value.length === 19;
  const parsed = new Date(`${value}${seconds ? '' : ':00'}-05:00`);
  // Date normalizes impossible dates (for example 30 February) instead of rejecting them.
  if (!Number.isFinite(parsed.getTime()) || bogotaInput(parsed.toISOString(), seconds) !== value)
    throw new Error('Fecha inválida.');
  return parsed.toISOString();
}

/** Preserve the precise original instant if the user has not changed the displayed date. */
export function paymentTimestamp(value: string, original: string): string {
  const displayed = bogotaInput(original, true);
  // Native datetime-local controls can omit a trailing :00 when serializing their value.
  const unchanged =
    value === displayed || (displayed.endsWith(':00') && value === displayed.slice(0, -3));
  return unchanged ? original : fromBogotaInput(value);
}

export function periodRange(
  today: string,
  period: 'day' | 'week' | 'month',
): { from: string; to: string } {
  const start = new Date(`${today}T12:00:00Z`);
  if (period === 'week') start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  if (period === 'month') start.setUTCDate(1);
  const end = new Date(start);
  if (period === 'week') end.setUTCDate(end.getUTCDate() + 6);
  if (period === 'month') {
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
  }
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}
