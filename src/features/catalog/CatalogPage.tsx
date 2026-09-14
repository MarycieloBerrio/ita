import { useState } from 'react';
import { Plus, Scissors, Search } from 'lucide-react';
import { useAppQuery } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { QueryResults, Service } from '../../lib/contracts';
import CategoryManager from './CategoryManager';
import ServiceEditor from './ServiceEditor';
import {
  categoryContains,
  categoryPath,
  cop,
  integerAmount,
  OperationFeedback,
  QueryFeedback,
  useOperation,
} from './operations';
import './catalog.css';

const formNames = { general: 'General', color: 'Color', keratin: 'Keratina' };

export function PriceCell({ service, owner }: { service: Service; owner: boolean }) {
  const [draft, setDraft] = useState<{ price: string; original: string; version: number } | null>(
    null,
  );
  const latestPrice = service.fixed_price == null ? '' : String(service.fixed_price);
  const price = draft?.price ?? latestPrice;
  const operation = useOperation();
  if (service.price_mode === 'custom') return <span>Se define en cada visita</span>;
  if (!owner) return <strong>{cop(service.fixed_price)}</strong>;
  const dirty = draft !== null && price !== draft.original;
  async function save() {
    try {
      const result = await operation.run(
        'service.save',
        {
          ...service,
          version: draft?.version ?? service.version,
          fixed_price: integerAmount(price),
        },
        'Tarifa guardada',
      );
      if (result !== undefined) setDraft(null);
    } catch (cause) {
      operation.setError(cause instanceof Error ? cause.message : 'Revisa la tarifa.');
    }
  }
  return (
    <div>
      <div className="inline-price">
        <label>
          <span className="sr-only">Tarifa de {service.name}</span>
          <input
            inputMode="numeric"
            value={price}
            placeholder="Pendiente"
            onChange={(event) =>
              setDraft((previous) => ({
                price: event.target.value,
                original: previous?.original ?? latestPrice,
                version: previous?.version ?? service.version,
              }))
            }
          />
        </label>
        <button
          className="button-secondary"
          disabled={!dirty || operation.pending}
          onClick={() => void save()}
        >
          {operation.pending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      {dirty ? <small className="muted">Cambios pendientes</small> : null}
      {dirty && draft.version !== service.version ? (
        <div className="error" role="alert">
          <p>
            Otra sesión cambió esta tarifa a {cop(service.fixed_price)}. Conservamos lo escrito;
            revisa la tarifa vigente antes de guardar.
          </p>
          <button
            type="button"
            className="button-secondary"
            disabled={operation.pending}
            onClick={() => setDraft(null)}
          >
            Descartar edición y cargar tarifa vigente
          </button>
        </div>
      ) : null}
      <OperationFeedback error={operation.error} success={operation.success} />
    </div>
  );
}

export default function CatalogPage() {
  const { profile } = useAuth();
  const owner = profile?.role === 'owner';
  const request = useAppQuery<QueryResults['catalog']>('catalog', { include_archived: owner });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [order, setOrder] = useState('catalog');
  const [editor, setEditor] = useState<Service | 'new' | null>(null);
  const [tab, setTab] = useState<'services' | 'categories'>('services');
  const [page, setPage] = useState(0);
  const operation = useOperation();
  const categories = request.data?.categories ?? [];
  const services = (request.data?.services ?? [])
    .filter(
      (service) =>
        (showArchived || service.active) &&
        categoryContains(categories, category, service.category_id) &&
        `${service.name} ${categoryPath(categories, service.category_id)}`
          .toLocaleLowerCase('es')
          .includes(search.toLocaleLowerCase('es')),
    )
    .sort((a, b) =>
      order === 'name'
        ? a.name.localeCompare(b.name, 'es')
        : order === 'price'
          ? (a.fixed_price ?? Infinity) - (b.fixed_price ?? Infinity)
          : a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'es'),
    );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(services.length / 25) - 1));
  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <p className="muted">Catálogo del salón</p>
          <h1>
            <Scissors aria-hidden="true" /> Servicios y precios
          </h1>
          <p>Cada servicio, su ficha y su valor.</p>
        </div>
        {owner ? (
          <button
            className="button"
            onClick={() => {
              setTab('services');
              setEditor('new');
            }}
          >
            <Plus size={20} aria-hidden="true" /> Nuevo servicio
          </button>
        ) : null}
      </header>
      <QueryFeedback pending={request.isPending} error={request.error} retry={request.refetch} />
      {owner ? (
        <nav className="operation-tabs" aria-label="Catálogo">
          <button
            className={tab === 'services' ? 'button' : 'button-secondary'}
            onClick={() => setTab('services')}
          >
            Servicios
          </button>
          <button
            className={tab === 'categories' ? 'button' : 'button-secondary'}
            onClick={() => setTab('categories')}
          >
            Categorías
          </button>
        </nav>
      ) : null}
      {tab === 'categories' && owner ? (
        <CategoryManager categories={categories} catalog="services" />
      ) : (
        <>
          {editor !== null && owner ? (
            <ServiceEditor
              key={editor === 'new' ? 'new' : `${editor.id}-${editor.version}`}
              service={editor === 'new' ? null : editor}
              categories={categories}
              onClose={() => setEditor(null)}
            />
          ) : null}
          <section className="card stack">
            <div className="operations-filters">
              <label className="field">
                <span>
                  <Search size={16} aria-hidden="true" /> Buscar servicio
                </span>
                <input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(0);
                  }}
                  placeholder="Nombre, categoría o método"
                />
              </label>
              <label className="field">
                Categoría
                <select
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">Todas las categorías</option>
                  {categories
                    .filter((item) => item.active || showArchived)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {categoryPath(categories, item.id)}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Ordenar
                <select value={order} onChange={(event) => setOrder(event.target.value)}>
                  <option value="catalog">Orden del catálogo</option>
                  <option value="name">Nombre</option>
                  <option value="price">Tarifa fija</option>
                </select>
              </label>
            </div>
            {owner ? (
              <label className="actions">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                />{' '}
                Mostrar archivados
              </label>
            ) : null}
            <OperationFeedback error={operation.error} success={operation.success} />
            {!request.isPending && !request.error && services.length === 0 ? (
              <div className="empty">
                <h2>{search || category ? 'No hay coincidencias' : 'Tu catálogo comienza aquí'}</h2>
                <p>
                  {owner
                    ? 'Crea categorías y servicios. Define tus propias tarifas o elige precio personalizado.'
                    : 'La dueña todavía no ha añadido servicios activos a esta selección.'}
                </p>
              </div>
            ) : null}
            {services.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Servicio</th>
                      <th>Ficha / duración</th>
                      <th>Precio</th>
                      {owner ? <th>Administrar</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {services.slice(currentPage * 25, (currentPage + 1) * 25).map((service) => (
                      <tr key={service.id}>
                        <td>
                          <strong>{service.name}</strong>
                          <p className="muted">{categoryPath(categories, service.category_id)}</p>
                          {!service.active ? <span className="badge">Archivado</span> : null}
                        </td>
                        <td>
                          {formNames[service.form_type]}
                          <p className="muted">{service.duration_minutes} min</p>
                        </td>
                        <td>
                          <PriceCell key={service.id} service={service} owner={owner} />
                        </td>
                        {owner ? (
                          <td>
                            <div className="actions">
                              <button
                                className="button-secondary"
                                onClick={() => setEditor(service)}
                              >
                                Editar
                              </button>
                              {service.active ? (
                                <button
                                  className="button-secondary"
                                  disabled={operation.pending}
                                  onClick={() =>
                                    void operation.run(
                                      'service.archive',
                                      { id: service.id, version: service.version },
                                      'Servicio archivado',
                                    )
                                  }
                                >
                                  Archivar
                                </button>
                              ) : null}
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {services.length > 25 ? (
              <div className="actions">
                <button
                  className="button-secondary"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Anterior
                </button>
                <span>
                  Página {currentPage + 1} de {Math.ceil(services.length / 25)}
                </span>
                <button
                  className="button-secondary"
                  disabled={(currentPage + 1) * 25 >= services.length}
                  onClick={() => setPage(currentPage + 1)}
                >
                  Siguiente
                </button>
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
