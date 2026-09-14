import { Cake, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import { useTypedQuery, queryClient } from '../../lib/api';
import { ActionButton } from '../../components/ActionButton';
export default function BirthdayNotice() {
  const q = useTypedQuery('birthdays');
  useEffect(() => {
    const timer = setInterval(
      () => void queryClient.invalidateQueries({ queryKey: ['birthdays'] }),
      60_000,
    );
    const refresh = () => {
      if (document.visibilityState === 'visible')
        void queryClient.invalidateQueries({ queryKey: ['birthdays'] });
    };
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const notice = q.data?.notice;
  if (!notice || notice.seen) return null;
  const month = new Intl.DateTimeFormat('es-CO', {
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Bogota',
  }).format(new Date(`${notice.target_month.slice(0, 7)}-01T12:00:00-05:00`));
  return (
    <div className="card stack" style={{ background: '#faf3ed', borderColor: '#eaded1' }}>
      <div className="actions">
        <Cake size={24} style={{ color: '#b0947c' }} />
        <h3 style={{ margin: 0 }}>Cumpleaños de {month}</h3>
      </div>
      {notice.clients.length ? (
        notice.clients.map((c) => (
          <Link key={c.id} to={`/clientas/${c.id}`} className="actions small">
            <span className="badge badge-warm">
              {c.birth_day}/{c.birth_month}
            </span>
            {c.name}
          </Link>
        ))
      ) : (
        <p className="small muted">No hay cumpleaños registrados para {month}.</p>
      )}
      <ActionButton
        action="birthday.seen"
        payload={{ target_month: notice.target_month }}
        className="button-secondary"
      >
        <Check size={16} />
        Marcar como visto
      </ActionButton>
    </div>
  );
}
