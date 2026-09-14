import { useState } from 'react';
import { useAppQuery } from '../../lib/api';
import type { Account, CommandResult, Product, QueryResults } from '../../lib/contracts';
import {
  bogotaDate,
  cop,
  OperationFeedback,
  QueryFeedback,
  todayBogota,
  useOperation,
} from '../catalog/operations';
import PaymentEditor from '../finance/PaymentEditor';

function SaleAccount({
  id,
  products,
  onClose,
}: {
  id: string;
  products: Product[];
  onClose: () => void;
}) {
  const request = useAppQuery<QueryResults['account']>('account', { id });
  const settings = useAppQuery<QueryResults['settings']>('settings');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [payment, setPayment] = useState(false);
  const operation = useOperation();
  const account = request.data?.account;
  const product = products.find((item) => item.id === productId);
  async function add() {
    if (!product || !/^[1-9]\d*$/.test(quantity) || !Number.isSafeInteger(Number(quantity))) {
      operation.setError('Selecciona producto y unidades enteras positivas.');
      return;
    }
    const result = await operation.run(
      'sale.save',
      { account_id: id, product_id: product.id, quantity: Number(quantity) },
      'Producto añadido como borrador',
    );
    if (result !== undefined) {
      setProductId('');
      setQuantity('1');
    }
  }
  return (
    <section className="card stack">
      <div className="actions">
        <h2>Cuenta de venta</h2>
        <button className="button-secondary" onClick={onClose}>
          Volver a ventas
        </button>
      </div>
      <p className="muted">
        Cuenta {id.slice(0, 8)}. Confirma la entrega para generar cargo y salida en una sola
        operación.
      </p>
      <QueryFeedback pending={request.isPending} error={request.error} retry={request.refetch} />
      <OperationFeedback error={operation.error} success={operation.success} />
      <div className="sales-line">
        <label className="field">
          Producto
          <select value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="">Seleccionar</option>
            {products
              .filter((item) => item.active && item.usage !== 'internal')
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {cop(item.sale_price)} · {item.stock} disponibles
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          Unidades
          <input
            inputMode="numeric"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <button
          className="button-secondary"
          disabled={operation.pending}
          onClick={() => void add()}
        >
          Añadir producto
        </button>
      </div>
      {request.data?.sales.length === 0 ? (
        <p className="empty">Añade los productos que vas a entregar.</p>
      ) : null}
      {request.data?.sales.map((line) => (
        <div className="card" key={line.id}>
          <div className="actions">
            <strong>
              {line.name} · {line.quantity} × {cop(line.unit_price)} ={' '}
              {cop(line.quantity * line.unit_price)}
            </strong>
            <span className="badge">
              {
                {
                  draft: 'Pendiente de entrega',
                  confirmed: 'Venta confirmada',
                  discarded: 'Descartado',
                }[line.status]
              }
            </span>
          </div>
          <p className="muted">{line.path}</p>
          {line.status === 'draft' ? (
            <div className="actions">
              <button
                className="button"
                disabled={operation.pending}
                onClick={() =>
                  void operation.run(
                    'sale.confirm',
                    { id: line.id, version: line.version },
                    'Venta confirmada; unidades descontadas una sola vez',
                  )
                }
              >
                Confirmar venta y entrega
              </button>
              <button
                className="button-secondary"
                disabled={operation.pending}
                onClick={() =>
                  void operation.run(
                    'sale.discard',
                    { id: line.id, version: line.version },
                    'Borrador descartado',
                  )
                }
              >
                Descartar borrador
              </button>
            </div>
          ) : null}
        </div>
      ))}
      {account ? (
        <>
          <div className="operation-summary">
            <div>
              <span>Cargos confirmados</span>
              <strong>{cop(account.total)}</strong>
            </div>
            <div>
              <span>Pagos válidos</span>
              <strong>{cop(account.paid)}</strong>
            </div>
            <div>
              <span>Saldo pendiente</span>
              <strong>{cop(account.balance)}</strong>
            </div>
          </div>
          {account.ready_for_payment && (account.balance ?? 0) > 0 ? (
            <button className="button" onClick={() => setPayment(true)}>
              Registrar pago completo o parcial
            </button>
          ) : null}
          {payment ? (
            <PaymentEditor
              account={account}
              methods={settings.data?.payment_methods ?? []}
              onClose={() => setPayment(false)}
            />
          ) : null}
        </>
      ) : null}
      {request.data?.payments.length ? (
        <details>
          <summary>Pagos registrados</summary>
          {request.data.payments.map((item) => (
            <p key={item.id}>
              {bogotaDate(item.paid_at)} · {cop(item.amount)} · {item.method_name}{' '}
              {item.corrected_by ? '(rectificado)' : ''}
            </p>
          ))}
        </details>
      ) : null}
    </section>
  );
}

export default function StandaloneSales({ products }: { products: Product[] }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const operation = useOperation();
  const today = todayBogota();
  const request = useAppQuery<QueryResults['finance']>('finance', { from: today, to: today });
  const accounts = request.data?.accounts.filter((account) => !account.visit_id) ?? [];
  async function create() {
    const result = await operation.run<CommandResult>('account.create', {}, 'Cuenta creada');
    if (result) setAccountId(result.account_id ?? result.id);
  }
  if (accountId)
    return <SaleAccount id={accountId} products={products} onClose={() => setAccountId(null)} />;
  return (
    <section className="card stack">
      <div className="actions">
        <h2>Ventas sin visita</h2>
        <button className="button" disabled={operation.pending} onClick={() => void create()}>
          Nueva venta
        </button>
      </div>
      <p className="muted">
        Para productos entregados directamente. Las ventas realizadas durante una atención se
        registran en su visita.
      </p>
      <OperationFeedback error={operation.error} success={operation.success} />
      <QueryFeedback pending={request.isPending} error={request.error} retry={request.refetch} />
      {accounts.length === 0 && !request.isPending ? (
        <p className="empty">Aún no hay cuentas de ventas independientes.</p>
      ) : null}
      <div className="stack">
        {accounts.map((account: Account) => (
          <div key={account.id} className="actions">
            <span>
              Cuenta {account.id.slice(0, 8)} · {cop(account.total)} · Saldo {cop(account.balance)}
            </span>
            <button className="button-secondary" onClick={() => setAccountId(account.id)}>
              Abrir cuenta
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
