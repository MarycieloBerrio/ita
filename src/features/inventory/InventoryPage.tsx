import { useState } from 'react';
import { Package, Plus } from 'lucide-react';
import { useAppQuery } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Product, QueryResults, StockMovement } from '../../lib/contracts';
import CategoryManager from '../catalog/CategoryManager';
import {
  bogotaDate,
  categoryContains,
  categoryPath,
  cop,
  OperationFeedback,
  QueryFeedback,
  useOperation,
} from '../catalog/operations';
import ProductEditor from './ProductEditor';
import StockEditor, { movementLabels } from './StockEditor';
import StandaloneSales from './StandaloneSales';
import '../catalog/catalog.css';

export default function InventoryPage() {
  const { profile } = useAuth();
  const owner = profile?.role === 'owner';
  const request = useAppQuery<QueryResults['inventory']>('inventory', { include_archived: owner });
  const [tab, setTab] = useState<'products' | 'categories' | 'movements' | 'sales'>('products');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [usage, setUsage] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<Product | 'new' | null>(null);
  const [stockEditor, setStockEditor] = useState<{
    product?: string;
    correction?: StockMovement;
  } | null>(null);
  const operation = useOperation();
  const categories = request.data?.categories ?? [];
  const products = request.data?.products ?? [];
  const filtered = products.filter(
    (item) =>
      (archived || item.active) &&
      categoryContains(categories, category, item.category_id) &&
      (!usage || item.usage === usage) &&
      (!stockFilter ||
        (stockFilter === 'empty' ? item.stock === 0 : item.stock <= item.minimum_stock)) &&
      `${item.name} ${item.brand} ${item.code}`
        .toLocaleLowerCase('es')
        .includes(search.toLocaleLowerCase('es')),
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1));
  const movements = request.data?.movements ?? [];
  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <p className="muted">Productos del salón</p>
          <h1>
            <Package aria-hidden="true" /> Inventario
          </h1>
          <p>Existencias por unidades. Materiales usados y ventas, cada uno con su registro.</p>
        </div>
        {owner ? (
          <div className="actions">
            <button className="button-secondary" onClick={() => setStockEditor({})}>
              Registrar movimiento
            </button>
            <button
              className="button"
              onClick={() => {
                setTab('products');
                setEditor('new');
              }}
            >
              <Plus size={20} aria-hidden="true" /> Nuevo producto
            </button>
          </div>
        ) : null}
      </header>
      <QueryFeedback pending={request.isPending} error={request.error} retry={request.refetch} />
      {owner ? (
        <nav className="operation-tabs" aria-label="Inventario">
          {(
            [
              { id: 'products', label: 'Productos' },
              { id: 'categories', label: 'Categorías' },
              { id: 'movements', label: 'Movimientos' },
              { id: 'sales', label: 'Ventas independientes' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? 'button' : 'button-secondary'}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      ) : null}
      {stockEditor && owner ? (
        <StockEditor
          key={stockEditor.correction?.id ?? stockEditor.product ?? 'new'}
          products={products}
          selectedProduct={stockEditor.product}
          correction={stockEditor.correction}
          onClose={() => setStockEditor(null)}
        />
      ) : null}
      <OperationFeedback error={operation.error} success={operation.success} />
      {tab === 'categories' && owner ? (
        <CategoryManager categories={categories} catalog="inventory" />
      ) : tab === 'sales' && owner ? (
        <StandaloneSales products={products} />
      ) : tab === 'movements' && owner ? (
        <section className="card stack">
          <h2>Movimientos confirmados</h2>
          <p className="muted">
            Cada movimiento conserva nombre, clasificación, origen y responsable. Las
            rectificaciones conservan el original.
          </p>
          {movements.length === 0 ? (
            <p className="empty">Aún no hay movimientos de inventario.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fecha / producto</th>
                    <th>Origen / motivo</th>
                    <th>Unidades</th>
                    <th>Responsable</th>
                    <th>Revisar</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((movement) => (
                    <tr key={movement.id}>
                      <td>
                        {bogotaDate(movement.created_at)}
                        <p>
                          <strong>{movement.name}</strong>
                        </p>
                        <small>{movement.path}</small>
                      </td>
                      <td>
                        {movementLabels[movement.kind]}
                        <p>{movement.reason}</p>
                        {movement.correction_of ? (
                          <small>Rectifica: {movement.correction_of}</small>
                        ) : null}
                        {movement.visit_id ? (
                          <p>
                            <small>Visita: {movement.visit_id}</small>
                          </p>
                        ) : null}
                      </td>
                      <td>
                        <strong>
                          {movement.quantity > 0 ? '+' : ''}
                          {movement.quantity}
                        </strong>
                      </td>
                      <td title={movement.created_by}>{movement.created_by.slice(0, 8)}</td>
                      <td>
                        {!movements.some((item) => item.correction_of === movement.id) ? (
                          <button
                            className="button-secondary"
                            onClick={() => setStockEditor({ correction: movement })}
                          >
                            Rectificar error
                          </button>
                        ) : (
                          <span className="badge">Registro rectificado</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <>
          {editor !== null && owner ? (
            <ProductEditor
              key={editor === 'new' ? 'new' : `${editor.id}-${editor.version}`}
              product={editor === 'new' ? null : editor}
              categories={categories}
              onClose={() => setEditor(null)}
            />
          ) : null}
          <section className="card stack">
            <div className="operations-filters">
              <label className="field">
                Buscar
                <input
                  type="search"
                  placeholder="Nombre, marca o código"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(0);
                  }}
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
                  <option value="">Todas, con subcategorías</option>
                  {categories
                    .filter((item) => item.active || archived)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {categoryPath(categories, item.id)}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                Uso
                <select value={usage} onChange={(event) => setUsage(event.target.value)}>
                  <option value="">Todos</option>
                  <option value="sale">Venta</option>
                  <option value="internal">Interno</option>
                  <option value="both">Venta e interno</option>
                </select>
              </label>
              <label className="field">
                Existencias
                <select
                  value={stockFilter}
                  onChange={(event) => setStockFilter(event.target.value)}
                >
                  <option value="">Todas</option>
                  <option value="low">Bajo stock</option>
                  <option value="empty">Agotados</option>
                </select>
              </label>
            </div>
            {owner ? (
              <label className="actions">
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(event) => setArchived(event.target.checked)}
                />{' '}
                Mostrar archivados
              </label>
            ) : null}
            {!request.isPending && !request.error && filtered.length === 0 ? (
              <p className="empty">
                No hay productos en esta selección.
                {owner ? ' Crea tu catálogo y registra el conteo físico inicial.' : ''}
              </p>
            ) : null}
            {filtered.length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th>Uso</th>
                      <th>Unidades</th>
                      <th>Venta · COP</th>
                      {owner ? (
                        <>
                          <th>Costo · COP</th>
                          <th>Administrar</th>
                        </>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(currentPage * 25, (currentPage + 1) * 25).map((product) => (
                      <tr key={product.id}>
                        <td>
                          <strong>{product.name}</strong>
                          <p>
                            {product.brand} · {product.presentation}
                          </p>
                          <small className="muted">
                            {categoryPath(categories, product.category_id)}
                            {product.code ? ` · ${product.code}` : ''}
                          </small>
                          {!product.active ? <p className="badge">Archivado</p> : null}
                        </td>
                        <td>
                          {{ sale: 'Venta', internal: 'Interno', both: 'Ambos' }[product.usage]}
                        </td>
                        <td>
                          <strong>{product.stock}</strong>
                          <p className={product.stock <= product.minimum_stock ? 'badge' : 'muted'}>
                            {product.stock === 0
                              ? 'Agotado'
                              : product.stock <= product.minimum_stock
                                ? 'Bajo stock'
                                : `Mínimo: ${product.minimum_stock}`}
                          </p>
                        </td>
                        <td>
                          {product.usage === 'internal' ? 'Uso interno' : cop(product.sale_price)}
                        </td>
                        {owner ? (
                          <>
                            <td>{product.cost == null ? 'Sin registrar' : cop(product.cost)}</td>
                            <td>
                              <div className="actions">
                                <button
                                  className="button-secondary"
                                  onClick={() => setEditor(product)}
                                >
                                  Editar
                                </button>
                                <button
                                  className="button-secondary"
                                  onClick={() => setStockEditor({ product: product.id })}
                                >
                                  Movimiento
                                </button>
                                {product.active && product.stock === 0 ? (
                                  <button
                                    className="button-secondary"
                                    disabled={operation.pending}
                                    onClick={() =>
                                      void operation.run(
                                        'product.archive',
                                        { id: product.id, version: product.version },
                                        'Producto archivado',
                                      )
                                    }
                                  >
                                    Archivar
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          </>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {filtered.length > 25 ? (
              <div className="actions">
                <button
                  className="button-secondary"
                  disabled={currentPage === 0}
                  onClick={() => setPage(currentPage - 1)}
                >
                  Anterior
                </button>
                <span>
                  Página {currentPage + 1} de {Math.ceil(filtered.length / 25)}
                </span>
                <button
                  className="button-secondary"
                  disabled={(currentPage + 1) * 25 >= filtered.length}
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
