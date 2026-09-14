import type { ReactNode } from 'react';
import { AlertCircle, LoaderCircle, CheckCircle2, Flower2 } from 'lucide-react';
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={24} /> Cargando tu espacio…
    </div>
  );
}
export function ErrorState({ error, retry }: { error: Error | null; retry?: () => void }) {
  return (
    <div className="error" role="alert">
      <AlertCircle size={20} />
      <span>{error?.message || 'No se pudo cargar la información.'}</span>
      {retry && (
        <button className="button-secondary" onClick={retry}>
          Reintentar
        </button>
      )}
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Flower2 size={32} strokeWidth={1.2} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function Saved({ children = 'Guardado confirmado' }: { children?: ReactNode }) {
  return (
    <span className="saved" role="status">
      <CheckCircle2 size={16} />
      {children}
    </span>
  );
}
