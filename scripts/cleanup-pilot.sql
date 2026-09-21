-- One-time cleanup for the linked pilot project. Run only after an encrypted,
-- verified backup. Keep the two personal Auth accounts and their profiles.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  tables_to_lock text;
begin
  select string_agg(format('ita_private.%I', tablename), ', ' order by tablename)
    into tables_to_lock
    from pg_tables where schemaname = 'ita_private';
  if (select count(*) from pg_tables where schemaname = 'ita_private') <> 23 then
    raise exception 'Unexpected application schema; cleanup cancelled';
  end if;
  execute 'lock table auth.users, ' || tables_to_lock || ' in access exclusive mode';

  if (select count(*) from ita_private.clients) <> 4
    or (select count(*) from ita_private.profiles) <> 6
    or (select count(*) from auth.users) <> 6
    or (select count(*) from ita_private.profiles p join auth.users u on u.id = p.id
        where p.display_name like '[PRUEBA]%'
          and u.email like 'ita-pilot-%@example.invalid') <> 4
    or (select count(*) from ita_private.profiles
        where active and role = 'owner' and display_name not like '[PRUEBA]%') <> 1
    or (select count(*) from ita_private.profiles
        where active and role = 'worker' and display_name not like '[PRUEBA]%') <> 1
    or (select count(*) from auth.users
        where email not like 'ita-pilot-%@example.invalid') <> 2
    or (select count(*) from ita_private.settings) <> 1 then
    raise exception 'Pilot or personal account counts changed; cleanup cancelled';
  end if;
end $$;

truncate table
  ita_private.accounts,
  ita_private.appointment_services,
  ita_private.appointments,
  ita_private.audit,
  ita_private.backup_status,
  ita_private.birthday_seen,
  ita_private.cash_movements,
  ita_private.cash_sessions,
  ita_private.categories,
  ita_private.clients,
  ita_private.expenses,
  ita_private.operations,
  ita_private.payment_methods,
  ita_private.payments,
  ita_private.products,
  ita_private.sales,
  ita_private.service_groups,
  ita_private.services,
  ita_private.stock_movements,
  ita_private.visit_services,
  ita_private.visits
restart identity;

delete from ita_private.profiles
where display_name like '[PRUEBA]%'
  and id in (select id from auth.users where email like 'ita-pilot-%@example.invalid');

delete from auth.users where email like 'ita-pilot-%@example.invalid';

-- Profile deletion is audited, so clear the pilot audit after deleting users.
truncate table ita_private.audit restart identity;

do $$
declare
  table_name text;
  row_count bigint;
begin
  for table_name in select tablename from pg_tables
    where schemaname = 'ita_private' and tablename not in ('profiles', 'settings')
  loop
    execute format('select count(*) from ita_private.%I', table_name) into row_count;
    if row_count <> 0 then
      raise exception 'Table % still has % rows; cleanup rolled back', table_name, row_count;
    end if;
  end loop;
  if (select count(*) from ita_private.profiles) <> 2
    or (select count(*) from auth.users) <> 2
    or (select count(*) from ita_private.settings) <> 1 then
    raise exception 'Personal accounts or settings changed; cleanup rolled back';
  end if;
end $$;
commit;
