import type {
  ExportManifest,
  ExportPage,
  ExportRequest,
  ExportResponse,
  ExportScope,
} from '../../lib/contracts';

export type ExportReader = (
  payload: ExportRequest,
  signal?: AbortSignal,
) => Promise<ExportResponse<ExportManifest | ExportPage>>;

/** Build JSON as bounded page fragments. No download exists until every page and
 * the final server revision have been verified; partial responses are discarded. */
export async function collectExport(
  read: ExportReader,
  scope: ExportScope,
  options: {
    clientId?: string;
    signal?: AbortSignal;
    onProgress?: (completed: number, total: number) => void;
  } = {},
) {
  const base: ExportRequest = { scope, ...(options.clientId ? { id: options.clientId } : {}) };
  const initial = await read(base, options.signal);
  const manifest = initial.data;
  if (!('tables' in manifest) || manifest.format_version !== 1 || manifest.scope !== scope)
    throw new Error('No se pudo verificar el contenido de la exportación.');
  const revision = manifest.revision;
  const tables = manifest.tables;
  const total = tables.reduce((sum, table) => sum + table.count, 0);
  let completed = 0;
  const chunks = [
    JSON.stringify({
      application: 'ita',
      format_version: 1,
      scope,
      client_id: manifest.client_id,
      generated_at: initial.generated_at,
      currency: initial.currency,
      timezone: initial.timezone,
      counts: Object.fromEntries(tables.map((table) => [table.name, table.count])),
    }).slice(0, -1),
    ',"data":{',
  ];
  for (const [index, table] of tables.entries()) {
    if (!Number.isSafeInteger(table.count) || table.count < 0)
      throw new Error('El recuento de registros no es válido.');
    chunks.push(`${index ? ',' : ''}${JSON.stringify(table.name)}:[`);
    let offset = 0;
    let first = true;
    while (offset < table.count) {
      options.signal?.throwIfAborted();
      const response = await read(
        { ...base, revision, table: table.name, offset, limit: 50 },
        options.signal,
      );
      const page = response.data;
      if (
        !('items' in page) ||
        page.table !== table.name ||
        page.total !== table.count ||
        page.items.length === 0 ||
        page.items.length > table.count - offset ||
        JSON.stringify(page.revision) !== JSON.stringify(revision)
      )
        throw new Error('La exportación quedó incompleta. Vuelve a descargarla.');
      for (const row of page.items) {
        chunks.push(`${first ? '' : ','}${JSON.stringify(row)}`);
        first = false;
      }
      offset += page.items.length;
      const expectedNext = offset < table.count ? offset : null;
      if (page.next_offset !== expectedNext)
        throw new Error('La exportación quedó incompleta. Vuelve a descargarla.');
      completed += page.items.length;
      options.onProgress?.(completed, total);
    }
    chunks.push(']');
  }
  // Validates the owner profile again and detects edits made while gathering pages.
  await read({ ...base, revision }, options.signal);
  options.signal?.throwIfAborted();
  chunks.push('}}');
  return { generatedAt: initial.generated_at, chunks };
}
