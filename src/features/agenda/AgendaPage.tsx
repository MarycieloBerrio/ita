import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import esLocale from '@fullcalendar/core/locales/es';
import { useState } from 'react';
import { Plus, Cake } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useTypedQuery } from '../../lib/api';
import type { Appointment } from '../../lib/contracts';
import { bogotaDate } from '../../lib/format';
import { ErrorState } from '../../components/Feedback';
import AppointmentEditor from './AppointmentEditor';
import Dialog from '../../components/Dialog';
export default function AgendaPage() {
  const { profile, bootstrap } = useAuth();
  const navigate = useNavigate();
  const [range, setRange] = useState({
    from: `${bogotaDate()}T00:00:00-05:00`,
    to: `${bogotaDate()}T23:59:59-05:00`,
  });
  const [professional, setProfessional] = useState('');
  const [birthdays, setBirthdays] = useState(true);
  const [editing, setEditing] = useState<Appointment | null | undefined>(undefined);
  const [start, setStart] = useState<string>();
  const q = useTypedQuery('appointments', {
    ...range,
    ...(professional ? { professional_id: professional } : {}),
  });
  const b = useTypedQuery('birthdays', {
    from: range.from.slice(0, 10),
    to: range.to.slice(0, 10),
  });
  const events = [
    ...(q.data?.items ?? []).map((a) => ({
      id: a.id,
      title: a.client_name,
      start: a.starts_at,
      end: a.ends_at,
      backgroundColor: a.professional_id === profile?.id ? '#66856b' : '#aa8598',
      borderColor: 'transparent',
      extendedProps: { appointment: a },
    })),
    ...(birthdays ? (b.data?.events ?? []) : []).map((c) => ({
      id: `birthday-${c.id}-${c.date}`,
      title: `🎂 ${c.name}`,
      start: c.date,
      allDay: true,
      backgroundColor: '#f1e3d2',
      textColor: '#806745',
      borderColor: 'transparent',
      extendedProps: { clientId: c.id },
    })),
  ];
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">TIEMPO PARA CADA CLIENTA</p>
          <h1>Agenda</h1>
          <p>
            {profile?.role === 'owner'
              ? 'Todas las citas del salón, a tu alcance.'
              : 'Un espacio para organizar tus propias citas.'}
          </p>
        </div>
        <button
          className="button"
          onClick={() => {
            setStart(undefined);
            setEditing(null);
          }}
        >
          <Plus size={18} />
          Nueva cita
        </button>
      </div>
      <div className="card">
        <div className="calendar-toolbar">
          {profile?.role === 'owner' && (
            <label className="field">
              Profesional
              <select value={professional} onChange={(e) => setProfessional(e.target.value)}>
                <option value="">Todas las profesionales</option>
                {bootstrap?.profiles
                  .filter((p) => p.active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={birthdays}
              onChange={(e) => setBirthdays(e.target.checked)}
            />
            <Cake size={17} />
            Mostrar cumpleaños
          </label>
        </div>
        {q.isPending && <p role="status">Cargando citas…</p>}
        {q.error && <ErrorState error={q.error} />}
        {birthdays && b.error && <ErrorState error={b.error} />}
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
          timeZone="America/Bogota"
          locale={esLocale}
          initialView="timeGridWeek"
          firstDay={1}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek',
          }}
          height="auto"
          allDayText="Todo el día"
          slotMinTime="07:00:00"
          slotMaxTime="21:00:00"
          nowIndicator
          events={events}
          datesSet={(arg) =>
            setRange({
              from: `${arg.startStr.slice(0, 10)}T00:00:00-05:00`,
              to: `${arg.endStr.slice(0, 10)}T00:00:00-05:00`,
            })
          }
          eventClick={(arg) => {
            if (arg.event.extendedProps.clientId)
              navigate(`/clientas/${String(arg.event.extendedProps.clientId)}`);
            else setEditing(arg.event.extendedProps.appointment as Appointment);
          }}
          dateClick={(arg) => {
            setStart(arg.dateStr.includes('T') ? arg.dateStr.slice(0, 16) : `${arg.dateStr}T09:00`);
            setEditing(null);
          }}
        />
      </div>
      {editing !== undefined && (
        <Dialog title="Cita" onClose={() => setEditing(undefined)}>
          <AppointmentEditor
            appointment={editing ?? undefined}
            start={start}
            onClose={() => setEditing(undefined)}
          />
        </Dialog>
      )}
    </>
  );
}
