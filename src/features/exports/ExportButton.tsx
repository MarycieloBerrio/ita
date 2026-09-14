import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { query } from '../../lib/api';
import type { ExportManifest, ExportPage, ExportResponse, ExportScope } from '../../lib/contracts';
import { collectExport } from './exportRecords';

export default function ExportButton({
  scope,
  clientId,
}: {
  scope: ExportScope;
  clientId?: string;
}) {
  const controller = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => () => controller.current?.abort(), []);
  async function download() {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setError('');
    setMessage('');
    setProgress('Preparando exportación…');
    try {
      const result = await collectExport(
        (payload, signal) =>
          query<ExportResponse<ExportManifest | ExportPage>>('export', payload, signal),
        scope,
        {
          clientId,
          signal: request.signal,
          onProgress: (done, total) => setProgress(`Preparando ${done} de ${total} registros…`),
        },
      );
      const url = URL.createObjectURL(
        new Blob(result.chunks, { type: 'application/json;charset=utf-8' }),
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `ita-${scope === 'client' ? 'clienta' : 'registros'}-${result.generatedAt.slice(0, 10)}.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Exportación completa preparada para descargar.');
    } catch (cause) {
      if (!request.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'No se pudo generar la exportación.');
    } finally {
      controller.current = null;
      if (!request.signal.aborted) setProgress(null);
    }
  }
  return (
    <div className="stack">
      <button
        type="button"
        className="button-secondary"
        disabled={progress !== null}
        onClick={() => void download()}
      >
        <Download size={17} aria-hidden="true" />
        {progress ??
          (scope === 'client' ? 'Exportar registro integral de clienta' : 'Descargar registros')}
      </button>
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
