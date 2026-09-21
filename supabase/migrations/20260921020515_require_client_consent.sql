-- Each new client requires the operator to confirm the current notice. The
-- existing consent column keeps an immutable snapshot of that confirmation.
create function ita_private.record_client_consent() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  responsible ita_private.settings;
begin
  if tg_op = 'UPDATE' then
    if new.consent is distinct from old.consent then
      raise exception 'La constancia de autorización no se puede modificar.' using errcode = '23514';
    end if;
    return new;
  end if;

  -- The existing client.save upsert also fires BEFORE INSERT when editing.
  -- Its UPDATE path checks that the original confirmation stays unchanged.
  if exists (select 1 from ita_private.clients where id = new.id) then
    return new;
  end if;

  if new.consent is distinct from 'client-notice-v1' then
    raise exception 'Confirma la autorización de datos antes de registrar la clienta.' using errcode = '23514';
  end if;
  select * into responsible from ita_private.settings where id = true;
  if nullif(btrim(responsible.responsible_name), '') is null
    or nullif(btrim(responsible.responsible_contact), '') is null then
    raise exception 'Completa el nombre y contacto de la responsable antes de registrar clientas.' using errcode = '23514';
  end if;

  new.consent := format(
    'Aviso de datos personales v1. Confirmación registrada el %s UTC por la cuenta %s. Responsable: %s. Contacto: %s.',
    to_char(new.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    new.created_by,
    responsible.responsible_name,
    responsible.responsible_contact
  );
  return new;
end;
$$;

revoke all on function ita_private.record_client_consent() from public, anon, authenticated;

create trigger record_client_consent
before insert or update of consent on ita_private.clients
for each row execute function ita_private.record_client_consent();
