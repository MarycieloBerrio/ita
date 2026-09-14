import { describe, expect, it, vi } from 'vitest';
import { collectExport, type ExportReader } from '../src/features/exports/exportRecords';
import type { ExportManifest, ExportPage, ExportResponse } from '../src/lib/contracts';

const metadata = {
  generated_at: '2026-09-13T15:00:00Z',
  currency: 'COP',
  timezone: 'America/Bogota',
} as const;
const revision = { audit_count: 112, audit_max: 112 };
const manifest: ExportManifest = {
  format_version: 1,
  scope: 'global',
  client_id: null,
  revision,
  tables: [
    { name: 'clients', count: 55 },
    { name: 'payments', count: 0 },
  ],
};
const entries = Array.from({ length: 55 }, (_, i) => ({
  id: String(i),
  notes: i === 0 ? '</script><img src=x> “fórmula”\n=1+1' : '',
  price: null,
}));
const reader: ExportReader = async (payload) => {
  if (!payload.table) return { ...metadata, data: manifest };
  const offset = payload.offset ?? 0;
  const items = entries.slice(offset, offset + 50);
  const page: ExportPage = {
    format_version: 1,
    scope: 'global',
    client_id: null,
    revision,
    table: 'clients',
    items,
    total: 55,
    next_offset: offset + items.length < 55 ? offset + items.length : null,
  };
  return { ...metadata, data: page };
};

describe('Exportación integral en páginas', () => {
  it('reúne más de 50 registros exactamente una vez y conserva texto libre como JSON', async () => {
    const read = vi.fn(reader);
    const progress = vi.fn();
    const result = await collectExport(read, 'global', { onProgress: progress });
    const document = JSON.parse(result.chunks.join(''));
    expect(document.data.clients).toEqual(entries);
    expect(document.data.payments).toEqual([]);
    expect(document.counts.clients).toBe(55);
    expect(document.timezone).toBe('America/Bogota');
    expect(read).toHaveBeenCalledTimes(4);
    expect(read.mock.calls.at(-1)?.[0]).toEqual({ scope: 'global', revision });
    expect(progress).toHaveBeenLastCalledWith(55, 55);
  });
  it('no entrega un archivo parcial si el servidor rechaza una revisión concurrente', async () => {
    const read: ExportReader = vi.fn(async (payload) => {
      if (payload.offset === 50) throw new Error('Los registros cambiaron durante la exportación.');
      return reader(payload);
    });
    await expect(collectExport(read, 'global')).rejects.toThrow(/cambiaron/);
  });
  it('detecta páginas incompletas en vez de omitir registros silenciosamente', async () => {
    const read: ExportReader = async (payload) => {
      const response = await reader(payload);
      if ('items' in response.data) response.data.next_offset = null;
      return response;
    };
    await expect(collectExport(read, 'global')).rejects.toThrow(/incompleta/);
  });
  it('comprueba el permiso y revisión una vez más antes de entregar la descarga', async () => {
    const read: ExportReader = async (payload) => {
      if (!payload.table && payload.revision) throw new Error('Acceso no autorizado');
      return reader(payload);
    };
    await expect(collectExport(read, 'global')).rejects.toThrow(/no autorizado/);
  });
  it('cancela la preparación al abandonar la pantalla', async () => {
    const controller = new AbortController();
    const read: ExportReader = async (payload) => {
      controller.abort();
      return reader(payload);
    };
    await expect(collectExport(read, 'global', { signal: controller.signal })).rejects.toThrow();
  });
  it('envía el ámbito y UUID de clienta en cada página', async () => {
    const read: ExportReader = vi.fn(
      async () =>
        ({
          ...metadata,
          data: { ...manifest, scope: 'client', client_id: 'client-id', tables: [] },
        }) as ExportResponse<ExportManifest>,
    );
    await collectExport(read, 'client', { clientId: 'client-id' });
    expect(read).toHaveBeenLastCalledWith(
      { scope: 'client', id: 'client-id', revision },
      undefined,
    );
  });
});
