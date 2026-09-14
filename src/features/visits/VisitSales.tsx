import { useState } from 'react';
import type { VisitDetail } from '../../lib/contracts';
import { useTypedQuery } from '../../lib/api';
import { useOperation } from '../../lib/useOperation';
import { money, statusLabel } from '../../lib/format';
import { ActionButton } from '../../components/ActionButton';
export default function VisitSales({ detail }: { detail: VisitDetail }) {
  const inventory = useTypedQuery('inventory');
  const [product, setProduct] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [service, setService] = useState('');
  const operation = useOperation();
  const readonly = detail.visit.status === 'completed' || detail.visit.status === 'void';
  return (
    <section className="card stack">
      <div className="section-title">
        <h2>Productos para llevar</h2>
        <span className="badge">Venta y entrega</span>
      </div>
      <p className="small muted">
        Añade un producto a la cuenta y confirma su entrega. Al pagar después no vuelve a
        descontarse del inventario.
      </p>
      {!readonly && (
        <>
          <div className="form-grid">
            <label className="field">
              Producto
              <select value={product} onChange={(e) => setProduct(e.target.value)}>
                <option value="">Selecciona un producto</option>
                {inventory.data?.products
                  .filter((p) => p.active && p.usage !== 'internal')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {money(p.sale_price)} · {p.stock} disponibles
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              Unidades
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </label>
            <label className="field">
              Vincular a una ficha (opcional)
              <select value={service} onChange={(e) => setService(e.target.value)}>
                <option value="">Cuenta de la visita</option>
                {detail.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="button-secondary"
            disabled={
              !product ||
              !Number.isSafeInteger(Number(quantity)) ||
              Number(quantity) <= 0 ||
              operation.pending
            }
            onClick={() =>
              void operation
                .run('sale.save', {
                  account_id: detail.account.id,
                  product_id: product,
                  quantity: Number(quantity),
                  ...(service ? { service_record_id: service } : {}),
                })
                .then((r) => {
                  if (r) {
                    setProduct('');
                    setQuantity('1');
                  }
                })
            }
          >
            Añadir producto a la cuenta
          </button>
        </>
      )}
      {operation.error && (
        <p className="error" role="alert">
          {operation.error}
        </p>
      )}
      {detail.sales
        .filter((s) => s.status !== 'discarded')
        .map((s) => (
          <div className="card" key={s.id}>
            <div className="section-title">
              <div>
                <h3>{s.name}</h3>
                <span className="small muted">
                  {s.quantity} × {money(s.unit_price)} = {money(s.quantity * s.unit_price)}
                </span>
              </div>
              <span className="badge">
                {s.status === 'draft' ? 'Pendiente de entrega' : statusLabel[s.status]}
              </span>
            </div>
            {s.status === 'draft' && (
              <div className="actions">
                <ActionButton action="sale.confirm" payload={{ id: s.id, version: s.version }}>
                  Confirmar venta y entrega
                </ActionButton>
                <ActionButton
                  action="sale.discard"
                  payload={{ id: s.id, version: s.version }}
                  className="button-secondary"
                >
                  Descartar borrador
                </ActionButton>
              </div>
            )}
          </div>
        ))}
    </section>
  );
}
