import { useState } from 'react';
import type { VisitDetail, Payment } from '../../lib/contracts';
import { useAuth } from '../../lib/auth';
import { useTypedQuery } from '../../lib/api';
import { dateLabel, money, statusLabel } from '../../lib/format';
import PaymentEditor from '../finance/PaymentEditor';
import Dialog from '../../components/Dialog';
export default function AccountCard({ detail }: { detail: VisitDetail }) {
  const { profile } = useAuth();
  const settings = useTypedQuery('settings');
  const [payment, setPayment] = useState(false);
  const [correction, setCorrection] = useState<Payment>();
  const { account } = detail;
  return (
    <aside className="card sticky-card stack">
      <div className="section-title">
        <h2>Cuenta de la visita</h2>
      </div>
      <div>
        {detail.services.map((s) => (
          <div className="account-row" key={s.id}>
            <span>{s.name}</span>
            <strong>{money(s.price)}</strong>
          </div>
        ))}
        {detail.sales
          .filter((s) => s.status === 'confirmed')
          .map((s) => (
            <div className="account-row" key={s.id}>
              <span>
                {s.name} × {s.quantity}
              </span>
              <strong>{money(s.quantity * s.unit_price)}</strong>
            </div>
          ))}
      </div>
      {account.pending_prices > 0 ? (
        <>
          <div className="account-total">
            <span>Subtotal conocido</span>
            <strong>{money(account.subtotal_known)}</strong>
          </div>
          <div className="notice">
            {account.pending_prices} servicio(s) por valorar. El total y el saldo aún no son
            definitivos.
          </div>
        </>
      ) : (
        <>
          <div className="account-total">
            <span>Total</span>
            <strong>{money(account.total)}</strong>
          </div>
          <div className="account-row">
            <span>Pagos válidos</span>
            <strong>{money(account.paid)}</strong>
          </div>
          <div className="account-total">
            <span>Saldo</span>
            <strong>{money(account.balance)}</strong>
          </div>
        </>
      )}
      <span className="badge">{statusLabel[account.payment_status]}</span>
      {!account.ready_for_payment && (account.balance ?? 1) > 0 && (
        <p className="small muted">
          Para cobrar, finaliza los trabajos, completa todos los precios y resuelve los productos
          pendientes de entrega.
        </p>
      )}
      {account.ready_for_payment && (account.balance ?? 0) > 0 && (
        <button className="button" onClick={() => setPayment(true)}>
          Registrar pago
        </button>
      )}
      <details>
        <summary className="small">Historial de pagos ({detail.payments.length})</summary>
        {detail.payments.map((p) => (
          <div className="stack" style={{ padding: '14px 0', gap: 8 }} key={p.id}>
            <strong className="small">
              {money(p.amount)} · {p.method_name}
            </strong>
            <span className="muted small">
              {dateLabel(p.paid_at)}
              {p.corrected_by ? ' · Rectificado' : ''}
            </span>
            {profile?.role === 'owner' && !p.corrected_by && (
              <button className="button-secondary" onClick={() => setCorrection(p)}>
                Corregir error de registro
              </button>
            )}
          </div>
        ))}
      </details>
      {(payment || correction) && (
        <Dialog
          title="Registrar pago"
          onClose={() => {
            setPayment(false);
            setCorrection(undefined);
          }}
        >
          <PaymentEditor
            account={account}
            methods={settings.data?.payment_methods ?? []}
            correction={correction}
            onClose={() => {
              setPayment(false);
              setCorrection(undefined);
            }}
          />
        </Dialog>
      )}
    </aside>
  );
}
