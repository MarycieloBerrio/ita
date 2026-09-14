import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Wallet } from 'lucide-react';
import { useAppQuery } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Expense, Payment, QueryResults } from '../../lib/contracts';
import { bogotaDate, cop, QueryFeedback, todayBogota } from '../catalog/operations';
import ExpenseEditor from './ExpenseEditor';
import PaymentEditor from './PaymentEditor';
import CashDesk from './CashDesk';
import { downloadText, financeCsv, periodRange } from './reporting';
import '../catalog/catalog.css';

function OwnerFinance() {
  const [range, setRange] = useState(() => periodRange(todayBogota(), 'month'));
  const [draftRange, setDraftRange] = useState(range);
  const [rangeError, setRangeError] = useState('');
  const [tab, setTab] = useState<'report' | 'cash'>('report');
  const [expense, setExpense] = useState<Expense | 'new' | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const request = useAppQuery<QueryResults['finance']>('finance', range);
  const settings = useAppQuery<QueryResults['settings']>('settings');
  const inventory = useAppQuery<QueryResults['inventory']>('inventory', { limit: 200 });
  const report = request.data;
  const correctionAccount = report?.accounts.find((item) => item.id === payment?.account_id);
  const validPayments = report?.payments.filter((item) => !item.corrected_by) ?? [];
  const methodTotals = new Map<string, { name: string; amount: number }>();
  validPayments.forEach((item) => {
    const current = methodTotals.get(item.method_id) ?? { name: item.method_name, amount: 0 };
    methodTotals.set(item.method_id, { ...current, amount: current.amount + item.amount });
  });
  function quickPeriod(period: 'day' | 'week' | 'month') {
    const value = periodRange(todayBogota(), period);
    setRange(value);
    setDraftRange(value);
    setRangeError('');
  }
  function applyRange() {
    if (!draftRange.from || !draftRange.to || draftRange.from > draftRange.to) {
      setRangeError(
        'Elige un período válido: la fecha inicial debe ser anterior o igual a la final.',
      );
      return;
    }
    setRange(draftRange);
    setRangeError('');
  }
  return (
    <div className="stack">
      <header className="page-header">
        <div>
          <p className="muted">Administración</p>
          <h1>
            <Wallet aria-hidden="true" /> Finanzas
          </h1>
          <p>Cargos, dinero cobrado y caja, con fechas de Bogotá.</p>
        </div>
        <div className="actions">
          <button
            className="button-secondary"
            disabled={!report || request.isFetching}
            onClick={() => {
              if (report)
                downloadText(`ita-finanzas-${report.from}-${report.to}.csv`, financeCsv(report));
            }}
          >
            <Download size={18} aria-hidden="true" /> Exportar CSV
          </button>
          <button className="button" onClick={() => setExpense('new')}>
            Registrar egreso
          </button>
        </div>
      </header>
      <section className="card stack">
        <div className="actions">
          <button className="button-secondary" onClick={() => quickPeriod('day')}>
            Hoy
          </button>
          <button className="button-secondary" onClick={() => quickPeriod('week')}>
            Esta semana
          </button>
          <button className="button-secondary" onClick={() => quickPeriod('month')}>
            Este mes
          </button>
          <span className="muted">Semana: lunes a domingo · COP</span>
        </div>
        <form
          className="operations-filters"
          onSubmit={(event) => {
            event.preventDefault();
            applyRange();
          }}
        >
          <label className="field">
            Desde
            <input
              type="date"
              value={draftRange.from}
              onChange={(event) => setDraftRange({ ...draftRange, from: event.target.value })}
            />
          </label>
          <label className="field">
            Hasta · inclusive
            <input
              type="date"
              value={draftRange.to}
              onChange={(event) => setDraftRange({ ...draftRange, to: event.target.value })}
            />
          </label>
          <button className="button-secondary">Aplicar período</button>
        </form>
        {rangeError ? (
          <p className="error" role="alert">
            {rangeError}
          </p>
        ) : null}
      </section>
      <QueryFeedback pending={request.isPending} error={request.error} retry={request.refetch} />
      {expense ? (
        <ExpenseEditor
          key={expense === 'new' ? 'new' : expense.id}
          methods={settings.data?.payment_methods ?? []}
          purchases={inventory.data?.movements.filter((item) => item.kind === 'purchase') ?? []}
          correction={expense === 'new' ? undefined : expense}
          onClose={() => setExpense(null)}
        />
      ) : null}
      {payment && correctionAccount ? (
        <PaymentEditor
          key={payment.id}
          correction={payment}
          account={correctionAccount}
          methods={settings.data?.payment_methods ?? []}
          onClose={() => setPayment(null)}
        />
      ) : null}
      <nav className="operation-tabs" aria-label="Finanzas">
        <button
          className={tab === 'report' ? 'button' : 'button-secondary'}
          onClick={() => setTab('report')}
        >
          Reporte operativo
        </button>
        <button
          className={tab === 'cash' ? 'button' : 'button-secondary'}
          onClick={() => setTab('cash')}
        >
          Caja de efectivo
        </button>
      </nav>
      {report && tab === 'cash' ? (
        <CashDesk sessions={report.cash_sessions} movements={report.cash_movements} />
      ) : report ? (
        <>
          <section className="operation-summary">
            {[
              { label: 'Cargos confirmados', amount: report.totals.charges },
              { label: 'Dinero cobrado', amount: report.totals.collected },
              { label: 'Egresos pagados', amount: report.totals.expenses },
              { label: 'Flujo operativo neto', amount: report.totals.operating_flow },
              { label: 'Saldo pendiente global', amount: report.totals.balance },
            ].map((item) => (
              <div className="card" key={item.label}>
                <span>{item.label}</span>
                <strong>{cop(item.amount)}</strong>
              </div>
            ))}
          </section>
          <p className="muted">
            Flujo operativo neto = cobros válidos − egresos pagados. Los aportes/retiros y el uso de
            materiales se registran por separado. El saldo pendiente es global; los cargos y cobros
            corresponden al período indicado.
          </p>
          {report.totals.pending_prices > 0 ? (
            <p className="badge">
              {report.totals.pending_prices} atenciones sin valorar. Se muestran como pendientes y
              no como cargos de $0.
            </p>
          ) : null}
          <section className="card">
            <h2>Cobros por método</h2>
            {methodTotals.size === 0 ? (
              <p className="empty">Sin cobros en este período.</p>
            ) : (
              <div className="operation-summary">
                {[...methodTotals.entries()].map(([id, item]) => (
                  <div key={id}>
                    <span>{item.name}</span>
                    <strong>{cop(item.amount)}</strong>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="card stack">
            <h2>Detalle de los totales</h2>
            <details className="finance-detail">
              <summary>Cargos de servicios y productos · {cop(report.totals.charges)}</summary>
              {report.charges.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Cargo / categoría histórica</th>
                      <th>Tipo</th>
                      <th>Importe</th>
                      <th>Cuenta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.charges.map((item) => (
                      <tr key={`${item.kind}-${item.id}`}>
                        <td>{bogotaDate(item.confirmed_at)}</td>
                        <td>
                          {item.name}
                          <p className="muted">{item.path}</p>
                        </td>
                        <td>{item.kind === 'service' ? 'Servicio' : 'Producto'}</td>
                        <td>{cop(item.amount)}</td>
                        <td>{item.account_id.slice(0, 8)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>Sin cargos confirmados en este período.</p>
              )}
            </details>
            <details className="finance-detail">
              <summary>Pagos y rectificaciones · {cop(report.totals.collected)}</summary>
              {report.payments.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Fecha real</th>
                      <th>Método / referencia</th>
                      <th>Importe</th>
                      <th>Estado / autor</th>
                      <th>Corrección</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.payments.map((item) => (
                      <tr key={item.id}>
                        <td>{bogotaDate(item.paid_at)}</td>
                        <td>
                          {item.method_name}
                          <p>{item.reference}</p>
                        </td>
                        <td>{cop(item.amount)}</td>
                        <td>
                          {item.corrected_by ? 'Original rectificado' : 'Válido'}
                          <p title={item.created_by}>
                            {settings.data?.profiles.find(
                              (profile) => profile.id === item.created_by,
                            )?.display_name ?? item.created_by.slice(0, 8)}
                          </p>
                          {item.reason ? <p>{item.reason}</p> : null}
                          {item.correction_of ? (
                            <small>Original: {item.correction_of}</small>
                          ) : null}
                        </td>
                        <td>
                          {!item.corrected_by ? (
                            <button className="button-secondary" onClick={() => setPayment(item)}>
                              Rectificar error
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>Sin pagos en este período.</p>
              )}
            </details>
            <details className="finance-detail">
              <summary>Egresos pagados · {cop(report.totals.expenses)}</summary>
              {report.expenses.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Concepto / categoría</th>
                      <th>Método</th>
                      <th>Importe</th>
                      <th>Estado</th>
                      <th>Corregir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.expenses.map((item) => (
                      <tr key={item.id}>
                        <td>{bogotaDate(item.paid_at)}</td>
                        <td>
                          {item.concept}
                          <p>{item.category}</p>
                          {item.stock_movement_id ? (
                            <small>Compra enlazada: {item.stock_movement_id.slice(0, 8)}</small>
                          ) : null}
                        </td>
                        <td>{item.method_name}</td>
                        <td>{cop(item.amount)}</td>
                        <td>
                          {item.corrected_by ? 'Original rectificado' : 'Válido'}
                          {item.correction_of ? (
                            <p>
                              <small>Original: {item.correction_of}</small>
                            </p>
                          ) : null}
                        </td>
                        <td>
                          {!item.corrected_by ? (
                            <button className="button-secondary" onClick={() => setExpense(item)}>
                              Rectificar error
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>Sin egresos pagados en este período.</p>
              )}
            </details>
            <details className="finance-detail">
              <summary>Cuentas pendientes globales · {cop(report.totals.balance)}</summary>
              <table>
                <thead>
                  <tr>
                    <th>Cuenta</th>
                    <th>Cargos</th>
                    <th>Cobrado</th>
                    <th>Saldo</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {report.accounts
                    .filter((item) => item.pending_prices > 0 || (item.balance ?? 0) > 0)
                    .map((item) => (
                      <tr key={item.id}>
                        <td>
                          {item.visit_id ? (
                            <Link to={`/visitas/${item.visit_id}`}>Abrir visita</Link>
                          ) : (
                            <Link to="/inventario">
                              Venta independiente · {item.id.slice(0, 8)}
                            </Link>
                          )}
                        </td>
                        <td>{cop(item.total)}</td>
                        <td>{cop(item.paid)}</td>
                        <td>{cop(item.balance)}</td>
                        <td>
                          {item.pending_prices
                            ? `${item.pending_prices} precios pendientes`
                            : item.paid > 0
                              ? 'Pago parcial'
                              : 'Sin pagar'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
          </section>
          <p className="muted">
            Generado {bogotaDate(report.generated_at)}. El CSV conserva período, moneda y detalle de
            registros.
          </p>
        </>
      ) : null}
    </div>
  );
}

export default function FinancePage() {
  const { profile } = useAuth();
  return profile?.role === 'owner' ? (
    <OwnerFinance />
  ) : (
    <div className="card">
      <h1>Acceso reservado a la dueña</h1>
      <p>Los cobros de tus atenciones están disponibles dentro de cada visita.</p>
    </div>
  );
}
