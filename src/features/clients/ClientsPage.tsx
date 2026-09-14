import { useDeferredValue, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Phone, Cake } from 'lucide-react';
import { useTypedQuery } from '../../lib/api';
import { Loading, ErrorState, Empty } from '../../components/Feedback';
import ClientEditor from './ClientEditor';
export default function ClientsPage() {
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const [page, setPage] = useState(0);
  const [create, setCreate] = useState(false);
  const [archived, setArchived] = useState(false);
  const navigate = useNavigate();
  const q = useTypedQuery('clients', {
    search: deferred,
    offset: page * 24,
    limit: 24,
    include_archived: archived,
  });
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">RELACIONES QUE CRECEN</p>
          <h1>Clientas</h1>
          <p>Cada historia de belleza empieza con una persona.</p>
        </div>
        <button className="button" onClick={() => setCreate(true)}>
          <Plus size={18} />
          Nueva clienta
        </button>
      </div>
      {create ? (
        <div className="card">
          <ClientEditor
            onCancel={() => setCreate(false)}
            onSaved={(id) => navigate(`/clientas/${id}`)}
          />
        </div>
      ) : (
        <>
          <div className="search-toolbar">
            <input
              type="search"
              aria-label="Buscar clientas"
              placeholder="Buscar por nombre o teléfono…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => {
                  setArchived(e.target.checked);
                  setPage(0);
                }}
              />
              Incluir archivadas
            </label>
          </div>
          {q.isPending ? (
            <Loading />
          ) : q.error ? (
            <ErrorState error={q.error} retry={() => void q.refetch()} />
          ) : !q.data?.items.length ? (
            <div className="card">
              <Empty title="Aquí comienza su historia">
                <p>Registra la primera clienta para guardar sus visitas y tratamientos.</p>
              </Empty>
            </div>
          ) : (
            <>
              <div className="client-grid">
                {q.data.items.map((client) => (
                  <Link className="card client-card" key={client.id} to={`/clientas/${client.id}`}>
                    <div className="actions">
                      <div className="client-initial">{client.name.slice(0, 1)}</div>
                      {!client.active && <span className="badge">Archivada</span>}
                    </div>
                    <h3>{client.name}</h3>
                    <p className="muted small actions">
                      <Phone size={14} />
                      {client.phone || 'Teléfono sin registrar'}
                    </p>
                    <p className="muted small actions">
                      <Cake size={14} />
                      {client.birth_day
                        ? `${client.birth_day}/${client.birth_month}`
                        : 'Cumpleaños sin registrar'}
                    </p>
                  </Link>
                ))}
              </div>
              <div className="pagination">
                <span>
                  {q.data.total} clientas · Página {page + 1}
                </span>
                <div className="actions">
                  <button
                    className="button-secondary"
                    disabled={!page}
                    onClick={() => setPage(page - 1)}
                  >
                    Anterior
                  </button>
                  <button
                    className="button-secondary"
                    disabled={(page + 1) * 24 >= q.data.total}
                    onClick={() => setPage(page + 1)}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
