import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';

/** Route error boundary: never a blank screen, always a way back. */
export default function RouteError() {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : '';
  return (
    <section className="card stack" role="alert" aria-labelledby="route-error-title">
      <h1 id="route-error-title">
        <AlertCircle aria-hidden="true" /> Algo no salió como esperábamos
      </h1>
      <p>
        No se pudo mostrar esta pantalla. Los datos ya confirmados están a salvo; lo que no se haya
        guardado puede haberse perdido. Recarga la página para continuar. Si la aplicación se
        actualizó, la recarga descargará la versión nueva.
      </p>
      {detail ? <p className="small muted">Detalle técnico: {detail}</p> : null}
      <div className="actions">
        <button type="button" className="button" onClick={() => window.location.reload()}>
          Recargar la página
        </button>
        <a className="button-secondary" href="/">
          Ir al inicio
        </a>
      </div>
    </section>
  );
}
