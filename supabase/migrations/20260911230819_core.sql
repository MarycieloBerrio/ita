-- ita v1. PostgreSQL is the only authority for permissions, money and stock.
-- No real people, credentials, example prices or stock are seeded here.
create schema ita_private;
revoke all on schema ita_private from public, anon, authenticated;
create domain ita_private.cop as bigint check (value > 0 and value <= 9007199254740991);
create domain ita_private.cop_nonnegative as bigint check (value >= 0 and value <= 9007199254740991);

create table ita_private.profiles (
 id uuid primary key references auth.users(id), display_name text not null check(length(btrim(display_name)) between 1 and 120),
 role text not null check(role in ('owner','worker')), active boolean not null default true, version integer not null default 1
);
create table ita_private.settings (
 id boolean primary key default true check(id), prevent_overlap boolean not null default true,
 privacy_text text not null default '', responsible_name text not null default '', responsible_contact text not null default '', version integer not null default 1
);
insert into ita_private.settings(id) values(true);
create table ita_private.clients (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 180),
 phone text, phone_normalized text generated always as (regexp_replace(coalesce(phone,''),'[^0-9]','','g')) stored,
 birth_day integer, birth_month integer, birth_year integer, notes text not null default '', active boolean not null default true,
 consent text not null default '', created_at timestamptz not null default now(), created_by uuid not null references ita_private.profiles,
 version integer not null default 1,
 check ((birth_day is null and birth_month is null and birth_year is null) or
 (birth_day is not null and birth_month is not null and birth_month between 1 and 12 and birth_day between 1 and extract(day from (make_date(2000,birth_month,1) + interval '1 month - 1 day'))::int and
 (birth_year is null or (birth_year between 1900 and 2100 and birth_day <= extract(day from (make_date(birth_year,birth_month,1) + interval '1 month - 1 day'))::int))))
);
create index clients_name_idx on ita_private.clients(lower(name));
create index clients_phone_idx on ita_private.clients(phone_normalized);
create index clients_birthdays_idx on ita_private.clients(birth_month,birth_day) where active;
create table ita_private.categories (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('service','product')),
 parent_id uuid references ita_private.categories, name text not null check(length(btrim(name)) between 1 and 120),
 active boolean not null default true, sort_order integer not null default 0,
 default_price_mode text check(default_price_mode in ('fixed','custom')), version integer not null default 1
);
create unique index categories_sibling_idx on ita_private.categories(kind,coalesce(parent_id,'00000000-0000-0000-0000-000000000000'::uuid),lower(name));
create index categories_parent_idx on ita_private.categories(parent_id);
create table ita_private.services (
 id uuid primary key default gen_random_uuid(), category_id uuid not null references ita_private.categories,
 name text not null check(length(btrim(name)) between 1 and 150), form_type text not null check(form_type in ('general','color','keratin')),
 price_mode text not null check(price_mode in ('fixed','custom')), fixed_price ita_private.cop,
 duration_minutes integer not null default 60 check(duration_minutes between 1 and 1440), active boolean not null default true,
 sort_order integer not null default 0, version integer not null default 1,
 check((price_mode='custom' and fixed_price is null) or (price_mode='fixed' and (not active or fixed_price is not null)))
);
create unique index services_name_idx on ita_private.services(category_id,lower(name));
create table ita_private.products (
 id uuid primary key default gen_random_uuid(), category_id uuid not null references ita_private.categories,
 name text not null check(length(btrim(name)) between 1 and 150), brand text not null default '', presentation text not null default '', code text not null default '',
 usage text not null check(usage in ('sale','internal','both')), cost ita_private.cop_nonnegative, sale_price ita_private.cop,
 minimum_stock integer not null default 0 check(minimum_stock>=0), active boolean not null default true, version integer not null default 1,
 check(not active or usage='internal' or sale_price is not null)
);
create index products_category_idx on ita_private.products(category_id);
create unique index products_code_idx on ita_private.products(lower(code)) where code<>'';
create table ita_private.appointments (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references ita_private.clients, professional_id uuid not null references ita_private.profiles,
 starts_at timestamptz not null, ends_at timestamptz not null, status text not null default 'scheduled' check(status in ('scheduled','confirmed','in_progress','completed','cancelled','no_show')),
 notes text not null default '', created_by uuid not null references ita_private.profiles, created_at timestamptz not null default now(), version integer not null default 1,
 check(ends_at>starts_at and ends_at<=starts_at+interval '24 hours')
);
create index appointments_professional_time_idx on ita_private.appointments(professional_id,starts_at,ends_at);
create index appointments_client_idx on ita_private.appointments(client_id);
create table ita_private.appointment_services (
 appointment_id uuid not null references ita_private.appointments, service_id uuid not null references ita_private.services,
 name text not null, path text not null, form_type text not null, price_mode text not null, reference_price ita_private.cop,
 primary key(appointment_id,service_id)
);
create index appointment_services_service_idx on ita_private.appointment_services(service_id);
create table ita_private.visits (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references ita_private.clients, professional_id uuid not null references ita_private.profiles,
 appointment_id uuid unique references ita_private.appointments, starts_at timestamptz not null default now(),
 status text not null default 'in_progress' check(status in ('draft','in_progress','completed','void')), notes text not null default '',
 created_by uuid not null references ita_private.profiles, created_at timestamptz not null default now(), version integer not null default 1
);
create index visits_client_time_idx on ita_private.visits(client_id,starts_at desc);
create index visits_professional_time_idx on ita_private.visits(professional_id,starts_at desc);
create table ita_private.service_groups (
 id uuid primary key default gen_random_uuid(), visit_id uuid not null references ita_private.visits, category_id uuid not null references ita_private.categories,
 technical jsonb not null default '{}', created_by uuid not null references ita_private.profiles
);
create index service_groups_visit_idx on ita_private.service_groups(visit_id);
create table ita_private.visit_services (
 id uuid primary key default gen_random_uuid(), visit_id uuid not null references ita_private.visits, service_id uuid not null references ita_private.services,
 group_id uuid references ita_private.service_groups, name text not null, path text not null, form_type text not null check(form_type in ('general','color','keratin')),
 form_version integer not null default 1, price_mode text not null check(price_mode in ('fixed','custom')), reference_price ita_private.cop, price ita_private.cop,
 technical jsonb not null, status text not null default 'draft' check(status in ('draft','completed','void')), completed_at timestamptz,
 created_at timestamptz not null default now(), version integer not null default 1
);
create index visit_services_visit_idx on ita_private.visit_services(visit_id);
create index visit_services_service_idx on ita_private.visit_services(service_id);
create index visit_services_group_idx on ita_private.visit_services(group_id);
create table ita_private.accounts (
 id uuid primary key default gen_random_uuid(), visit_id uuid unique references ita_private.visits, professional_id uuid not null references ita_private.profiles,
 client_id uuid references ita_private.clients, created_at timestamptz not null default now()
);
create index accounts_professional_idx on ita_private.accounts(professional_id);
create index accounts_client_idx on ita_private.accounts(client_id);
create table ita_private.sales (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references ita_private.accounts, product_id uuid not null references ita_private.products,
 service_record_id uuid references ita_private.visit_services, name text not null, path text not null,
 quantity integer not null check(quantity>0), unit_price ita_private.cop not null, unit_cost ita_private.cop_nonnegative,
 status text not null default 'draft' check(status in ('draft','confirmed','discarded')), confirmed_at timestamptz,
 created_by uuid not null references ita_private.profiles, version integer not null default 1,
 check(quantity::numeric*unit_price <= 9007199254740991)
);
create index sales_account_idx on ita_private.sales(account_id);
create index sales_product_idx on ita_private.sales(product_id);
create index sales_service_idx on ita_private.sales(service_record_id);
create table ita_private.stock_movements (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references ita_private.products,
 name text not null, path text not null, quantity integer not null check(quantity<>0),
 kind text not null check(kind in ('initial','purchase','consumption','adjustment','sale','correction')),
 reason text not null check(length(btrim(reason))>0), visit_id uuid references ita_private.visits,
 sale_id uuid unique references ita_private.sales, correction_of uuid unique references ita_private.stock_movements,
 created_at timestamptz not null default now(), created_by uuid not null references ita_private.profiles,
 check ((kind in ('initial','purchase') and quantity>0) or (kind in ('consumption','sale') and quantity<0) or kind in ('adjustment','correction'))
);
create index stock_movements_product_idx on ita_private.stock_movements(product_id,created_at desc);
create index stock_movements_visit_idx on ita_private.stock_movements(visit_id);
create table ita_private.payment_methods (
 id uuid primary key default gen_random_uuid(), name text not null check(length(btrim(name)) between 1 and 80), is_cash boolean not null,
 active boolean not null default true, version integer not null default 1
);
create unique index payment_methods_name_idx on ita_private.payment_methods(lower(name));
create table ita_private.payments (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references ita_private.accounts, amount ita_private.cop not null,
 paid_at timestamptz not null, method_id uuid not null references ita_private.payment_methods, method_name text not null, is_cash boolean not null,
 reference text not null default '', created_by uuid not null references ita_private.profiles, created_at timestamptz not null default now(),
 corrected_by uuid unique, correction_of uuid unique references ita_private.payments, reason text
);
alter table ita_private.payments add foreign key(corrected_by) references ita_private.payments;
create index payments_account_idx on ita_private.payments(account_id);
create index payments_paid_at_idx on ita_private.payments(paid_at);
create index payments_method_idx on ita_private.payments(method_id);
create table ita_private.expenses (
 id uuid primary key default gen_random_uuid(), concept text not null check(length(btrim(concept))>0), category text not null,
 amount ita_private.cop not null, paid_at timestamptz not null, method_id uuid not null references ita_private.payment_methods,
 method_name text not null, is_cash boolean not null, stock_movement_id uuid references ita_private.stock_movements,
 created_by uuid not null references ita_private.profiles, created_at timestamptz not null default now(), corrected_by uuid unique, correction_of uuid unique references ita_private.expenses, reason text
);
alter table ita_private.expenses add foreign key(corrected_by) references ita_private.expenses;
create index expenses_paid_at_idx on ita_private.expenses(paid_at);
create index expenses_method_idx on ita_private.expenses(method_id);
create unique index expenses_purchase_once_idx on ita_private.expenses(stock_movement_id) where corrected_by is null;
create table ita_private.cash_sessions (
 id uuid primary key default gen_random_uuid(), opened_at timestamptz not null default now(), closed_at timestamptz,
 opening_amount ita_private.cop_nonnegative not null, counted_amount ita_private.cop_nonnegative, notes text not null default '',
 created_by uuid not null references ita_private.profiles, version integer not null default 1
);
create unique index cash_one_open_idx on ita_private.cash_sessions((true)) where closed_at is null;
create table ita_private.cash_movements (
 id uuid primary key default gen_random_uuid(), session_id uuid not null references ita_private.cash_sessions,
 kind text not null check(kind in ('contribution','withdrawal')), amount ita_private.cop not null,
 reason text not null check(length(btrim(reason))>0), created_at timestamptz not null default now(), created_by uuid not null references ita_private.profiles
);
create index cash_movements_session_idx on ita_private.cash_movements(session_id);
create table ita_private.birthday_seen (user_id uuid not null references ita_private.profiles,target_month date not null check(extract(day from target_month)=1),seen_at timestamptz not null default now(),primary key(user_id,target_month));
create table ita_private.operations (id uuid primary key,actor_id uuid not null references ita_private.profiles,action text not null,payload jsonb not null,result jsonb,created_at timestamptz not null default now());
create index operations_actor_idx on ita_private.operations(actor_id,created_at desc);
create table ita_private.audit (id bigint generated always as identity primary key,actor_id uuid references ita_private.profiles,action text not null,entity_id text,before_data jsonb,after_data jsonb,reason text,created_at timestamptz not null default now());
create index audit_created_idx on ita_private.audit(created_at desc);
create table ita_private.backup_status (
 id uuid primary key default gen_random_uuid(),run_key text unique,started_at timestamptz not null default now(),completed_at timestamptz,
 status text not null check(status in ('running','success','failed')),message text not null default '',bytes bigint check(bytes>=0),artifact_name text,
 check(status<>'success' or completed_at is not null)
);

-- Every private table also has deny-by-default RLS as defense in depth. Only
-- two narrow authorized dispatchers can access these tables for application users.
do $$ declare t record; begin for t in select tablename from pg_tables where schemaname='ita_private' loop
 execute format('alter table ita_private.%I enable row level security',t.tablename);
 execute format('revoke all on ita_private.%I from public, anon, authenticated',t.tablename);
end loop; end $$;

create function ita_private.actor() returns uuid language plpgsql stable set search_path='' as $$
declare u uuid := auth.uid(); begin
 if u is null or not exists(select 1 from ita_private.profiles p where p.id=u and p.active) then raise exception 'Acceso no autorizado o cuenta inactiva.' using errcode='42501'; end if;
 return u; end $$;
create function ita_private.is_owner() returns boolean language sql stable set search_path='' as $$ select exists(select 1 from ita_private.profiles where id=auth.uid() and active and role='owner') $$;
create function ita_private.require_owner() returns void language plpgsql set search_path='' as $$ begin if not ita_private.is_owner() then raise exception 'Esta operación requiere a la dueña.' using errcode='42501'; end if; end $$;
create function ita_private.require_professional(p_id uuid) returns void language plpgsql set search_path='' as $$ begin
 if not exists(select 1 from ita_private.profiles where id=p_id and active) or (not ita_private.is_owner() and p_id<>ita_private.actor()) then raise exception 'Profesional no autorizada.' using errcode='42501'; end if; end $$;
create function ita_private.require_version(actual integer,expected jsonb) returns void language plpgsql set search_path='' as $$ begin
 if actual is null then raise exception 'Registro inexistente o sin acceso.' using errcode='42501'; end if;
 if expected is null or expected='null'::jsonb or actual<>(expected#>>'{}')::integer then raise exception 'Otra sesión cambió este registro. Recarga y revisa tus cambios.' using errcode='40001'; end if;
end $$;
create function ita_private.lock_account(p_id uuid) returns ita_private.accounts language plpgsql set search_path='' as $$ declare a ita_private.accounts; begin
 select * into a from ita_private.accounts where id=p_id for update;
 if a.id is null or (not ita_private.is_owner() and a.professional_id<>ita_private.actor()) then raise exception 'Cuenta sin acceso.' using errcode='42501'; end if;
 return a; end $$;
create function ita_private.lock_visit(p_id uuid) returns ita_private.visits language plpgsql set search_path='' as $$ declare v ita_private.visits; begin
 -- Account first: all service, payment, sale and reassignment mutations use this order.
 perform ita_private.lock_account((select id from ita_private.accounts where visit_id=p_id));
 select * into v from ita_private.visits where id=p_id for update;
 if v.id is null or (not ita_private.is_owner() and v.professional_id<>ita_private.actor()) then raise exception 'Visita sin acceso.' using errcode='42501'; end if;
 return v; end $$;
create function ita_private.category_path(p_id uuid) returns text language sql stable set search_path='' as $$
 with recursive tree as(select id,parent_id,name,0 depth from ita_private.categories where id=p_id union all select c.id,c.parent_id,c.name,t.depth+1 from ita_private.categories c join tree t on t.parent_id=c.id) select string_agg(name,' / ' order by depth desc) from tree $$;
create function ita_private.stock(p_id uuid) returns bigint language sql stable set search_path='' as $$ select coalesce(sum(quantity),0)::bigint from ita_private.stock_movements where product_id=p_id $$;
create function ita_private.default_technical(p_kind text) returns jsonb language plpgsql immutable set search_path='' as $$
declare t jsonb := jsonb_build_object('kind',p_kind,'schemaVersion',1,'notes',''); h jsonb := '{"procedure":"","treatment":"","homeRecommendation":"","maintenanceDate":"","saleDisposition":"pending","saleIds":[]}'; g jsonb := '{"none":false,"items":[]}'; begin
 if p_kind='general' then return t||'{"materials":{"none":true,"items":[]}}'; end if;
 if p_kind='keratin' then return t||h||'{"product":{"name":"","reference":"","components":""}}'; end if;
 return t||h||jsonb_build_object('map','{"templateId":"ita-five-views","templateVersion":1,"zones":{}}'::jsonb,'decolorants',g,'oxidants',g,'tints',g,'finalizers',g);
end $$;
create function ita_private.validate_technical(t jsonb,k text,completed boolean,p_visit uuid) returns void language plpgsql set search_path='' as $$
declare z record; g text; m jsonb; i jsonb; sid text; field_name text; begin
 if jsonb_typeof(t) is distinct from 'object' or t->>'kind' is distinct from k or t->'schemaVersion' is distinct from '1'::jsonb then raise exception 'Ficha o versión no compatible.'; end if;
 if jsonb_typeof(t->'notes') is distinct from 'string' or length(t->>'notes')>10000 then raise exception 'Observaciones inválidas o superiores a 10.000 caracteres.'; end if;
 if k<>'general' then
  foreach field_name in array array['procedure','treatment','homeRecommendation','maintenanceDate'] loop
   if jsonb_typeof(t->field_name) is distinct from 'string' then raise exception 'Campo técnico % inválido.',field_name; end if;
  end loop;
  if length(t->>'procedure')>10000 or length(t->>'treatment')>3000 or length(t->>'homeRecommendation')>3000 then raise exception 'El texto excede el tamaño permitido.'; end if;
  if t->>'maintenanceDate'<>'' then
   if t->>'maintenanceDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Fecha de mantenimiento inválida.'; end if;
   perform (t->>'maintenanceDate')::date;
  end if;
  if coalesce(t->>'saleDisposition','') not in ('pending','none','linked') or jsonb_typeof(t->'saleIds') is distinct from 'array' then raise exception 'Relación de productos vendidos inválida.'; end if;
  if jsonb_array_length(t->'saleIds')>100 then raise exception 'Demasiadas ventas vinculadas.'; end if;
  for m in select value from jsonb_array_elements(t->'saleIds') loop
   if jsonb_typeof(m) is distinct from 'string' then raise exception 'Identificador de venta inválido.'; end if;
   perform (m#>>'{}')::uuid;
  end loop;
 end if;
 if k='color' then
  if t#>>'{map,templateId}' is distinct from 'ita-five-views' or t#>'{map,templateVersion}' is distinct from '1'::jsonb or jsonb_typeof(t#>'{map,zones}') is distinct from 'object' then raise exception 'Plantilla de plano no compatible.'; end if;
  for z in select * from jsonb_each(t#>'{map,zones}') loop
   if z.key not in ('z01','z02','z03','z04','z05','z06','z07','z08') or coalesce(z.value->>'pattern','') not in ('zigzag','straight','diagonal-zigzag','diagonal-straight') or z.value->'patternVersion' is distinct from '1'::jsonb or jsonb_typeof(z.value->'colorText') is distinct from 'string' or length(btrim(coalesce(z.value->>'colorText',''))) not between 1 and 250 then raise exception 'Zona: selecciona una división y escribe Color (1–250 caracteres).'; end if;
  end loop;
 elsif t ? 'map' then raise exception 'Esta ficha no utiliza plano.';
 end if;
 if k='keratin' then
  foreach field_name in array array['name','reference','components'] loop
   if jsonb_typeof(t->'product'->field_name) is distinct from 'string' or length(t->'product'->>field_name)>(case when field_name='components' then 3000 else 1000 end) then raise exception 'Producto de keratina inválido.'; end if;
  end loop;
 end if;
 if completed and k='color' and btrim(coalesce(t->>'procedure',''))='' then raise exception 'Completa el procedimiento de Color.'; end if;
 if completed and k='keratin' and (btrim(coalesce(t#>>'{product,name}',''))='' or btrim(coalesce(t#>>'{product,reference}',''))='') then raise exception 'Completa nombre y marca/referencia de keratina.'; end if;
 for g in select unnest(case when k='color' then array['decolorants','oxidants','tints','finalizers'] when k='general' then array['materials'] else array[]::text[] end) loop
  m:=t->g;
  if jsonb_typeof(m->'items') is distinct from 'array' or jsonb_typeof(m->'none') is distinct from 'boolean' then raise exception 'Completa productos/materiales utilizados.'; end if;
  if jsonb_array_length(m->'items')>40 then raise exception 'Máximo 40 productos por fase.'; end if;
  if completed and (((m->>'none')::boolean and jsonb_array_length(m->'items')<>0) or (not (m->>'none')::boolean and jsonb_array_length(m->'items')=0)) then raise exception 'Indica los productos o No se utilizó.'; end if;
  for i in select value from jsonb_array_elements(m->'items') loop
   foreach field_name in array array['id','name','reference','details'] loop
    if jsonb_typeof(i->field_name) is distinct from 'string' or length(i->>field_name)>(case when field_name='details' then 3000 else 1000 end) then raise exception 'Dato de producto inválido.'; end if;
   end loop;
   if length(i->>'id')=0 then raise exception 'Identificador de material vacío.'; end if;
   if completed and (btrim(coalesce(i->>'name',''))='' or (k='color' and btrim(coalesce(i->>'reference',''))='')) then raise exception 'Completa producto y marca/referencia.'; end if;
   if g='oxidants' then
    if jsonb_typeof(i->'phase') is distinct from 'string' or jsonb_typeof(i->'concentration') is distinct from 'string' or length(i->>'phase')>1000 or length(i->>'concentration')>1000 then raise exception 'Datos de oxidante inválidos.'; end if;
    if completed and (btrim(coalesce(i->>'phase',''))='' or coalesce(i->>'concentration','') !~* '(%|vol)') then raise exception 'Cada oxidante necesita fase y concentración en %% o volúmenes.'; end if;
   end if;
  end loop;
 end loop;
 if completed and k<>'general' then
  if coalesce(t->>'saleDisposition','pending') not in ('none','linked') or jsonb_typeof(t->'saleIds') is distinct from 'array' then raise exception 'Indica los productos vendidos o No se vendieron productos.'; end if;
  if (t->>'saleDisposition'='none' and jsonb_array_length(t->'saleIds')<>0) or (t->>'saleDisposition'='linked' and jsonb_array_length(t->'saleIds')=0) then raise exception 'Revisa los productos vendidos de la ficha.'; end if;
  for sid in select jsonb_array_elements_text(t->'saleIds') loop
   if not exists(select 1 from ita_private.sales s join ita_private.accounts a on a.id=s.account_id where s.id=sid::uuid and a.visit_id=p_visit and s.status='confirmed') then raise exception 'La venta vinculada debe estar entregada y pertenecer a esta visita.'; end if;
  end loop;
 end if;
end $$;
create function ita_private.account_json(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare a ita_private.accounts; subtotal bigint; pending integer; paid bigint; ready boolean; begin
 select * into a from ita_private.accounts where id=p_id;
 select coalesce(sum(price),0),count(*) filter(where price is null),coalesce(bool_and(status='completed'),true) into subtotal,pending,ready from ita_private.visit_services where visit_id=a.visit_id and status<>'void';
 subtotal:=subtotal+coalesce((select sum(quantity::bigint*unit_price) from ita_private.sales where account_id=a.id and status='confirmed'),0);
 select coalesce(sum(amount),0) into paid from ita_private.payments where account_id=a.id and corrected_by is null;
 ready:=ready and pending=0 and subtotal>0 and not exists(select 1 from ita_private.sales where account_id=a.id and status='draft') and not exists(select 1 from ita_private.visits where id=a.visit_id and status='void');
 return jsonb_build_object('id',a.id,'visit_id',a.visit_id,'professional_id',a.professional_id,'subtotal_known',subtotal,'pending_prices',pending,'total',case when pending=0 then subtotal end,'paid',paid,'balance',case when pending=0 then subtotal-paid end,'payment_status',case when pending>0 then 'pending_prices' when paid=0 then 'unpaid' when paid<subtotal then 'partial' else 'paid' end,'ready_for_payment',ready);
end $$;
create function ita_private.ensure_account(p_id uuid) returns void language plpgsql set search_path='' as $$ declare j jsonb:=ita_private.account_json(p_id); begin
 if (j->>'subtotal_known')::numeric>9007199254740991 or (j->>'balance')::bigint<0 or ((j->>'paid')::bigint>0 and not (j->>'ready_for_payment')::boolean) then raise exception 'La operación excede el límite de COP o los pagos existentes; no se añaden trabajos pendientes a una cuenta ya cobrada.'; end if;
end $$;
create function ita_private.cash_json(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$ declare c ita_private.cash_sessions; expected bigint; begin
 select * into c from ita_private.cash_sessions where id=p_id;
 expected:=c.opening_amount+coalesce((select sum(amount) from ita_private.payments where corrected_by is null and is_cash and paid_at>=c.opened_at and paid_at<=coalesce(c.closed_at,now())),0)
 -coalesce((select sum(amount) from ita_private.expenses where corrected_by is null and is_cash and paid_at>=c.opened_at and paid_at<=coalesce(c.closed_at,now())),0)
 +coalesce((select sum(case when kind='contribution' then amount else -amount end) from ita_private.cash_movements where session_id=c.id),0);
 return to_jsonb(c)||jsonb_build_object('expected_amount',expected,'difference',c.counted_amount-expected);
end $$;
create function ita_private.audit_row() returns trigger language plpgsql set search_path='' as $$ begin
 insert into ita_private.audit(actor_id,action,entity_id,before_data,after_data,reason) values(auth.uid(),coalesce(nullif(current_setting('ita.action',true),''),tg_op),coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id'),case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end,nullif(current_setting('ita.reason',true),''));
 return coalesce(new,old); end $$;
do $$ declare t text; begin foreach t in array array['profiles','settings','clients','categories','services','products','appointments','appointment_services','visits','service_groups','visit_services','accounts','sales','stock_movements','payment_methods','payments','expenses','cash_sessions','cash_movements'] loop
 execute format('create trigger audit_change after insert or update or delete on ita_private.%I for each row execute function ita_private.audit_row()',t);
end loop; end $$;
