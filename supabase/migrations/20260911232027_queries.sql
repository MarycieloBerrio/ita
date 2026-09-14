create function ita_private.birthday_events(p_from date,p_to date) returns jsonb language sql stable set search_path='' as $$
 with years as (select generate_series(extract(year from p_from)::int,extract(year from p_to)::int) y), events as (
 select c.id,c.name,c.birth_day,c.birth_month,make_date(y,c.birth_month,least(c.birth_day,extract(day from (make_date(y,c.birth_month,1)+interval '1 month - 1 day'))::int)) date
 from ita_private.clients c cross join years where c.active and c.birth_month is not null)
 select coalesce(jsonb_agg(to_jsonb(e) order by date,name),'[]') from events e where date between p_from and p_to
$$;
create function ita_private.birthdays(p_today date,p_from date,p_to date) returns jsonb language plpgsql stable set search_path='' as $$
declare target date; seen boolean; begin
 target:=case when p_today=(date_trunc('month',p_today)+interval '1 month - 1 day')::date then (date_trunc('month',p_today)+interval '1 month')::date else date_trunc('month',p_today)::date end;
 select exists(select 1 from ita_private.birthday_seen where user_id=auth.uid() and target_month=target) into seen;
 return jsonb_build_object('server_date',p_today,'events',ita_private.birthday_events(p_from,p_to),'notice',case when not seen then jsonb_build_object('target_month',target,'seen',seen,'clients',ita_private.birthday_events(target,(target+interval '1 month - 1 day')::date)) end);
end $$;
create function ita_private.visit_json(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(v)||jsonb_build_object('client_name',c.name) from ita_private.visits v join ita_private.clients c on c.id=v.client_id where v.id=p_id
$$;
create function ita_private.appointment_json(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(a)||jsonb_build_object('client_name',c.name,'service_ids',coalesce((select jsonb_agg(service_id) from ita_private.appointment_services where appointment_id=a.id),'[]'),'visit_id',(select id from ita_private.visits where appointment_id=a.id))
 from ita_private.appointments a join ita_private.clients c on c.id=a.client_id where a.id=p_id
$$;
create function ita_private.account_detail(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('account',ita_private.account_json(p_id),'sales',coalesce((select jsonb_agg(to_jsonb(s)-'unit_cost' order by s.id) from ita_private.sales s where account_id=p_id),'[]'),
 'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.paid_at,p.id) from ita_private.payments p where account_id=p_id),'[]'))
$$;
create function ita_private.finance(p_from date,p_to date) returns jsonb language plpgsql stable set search_path='' as $$
declare charges jsonb; payments jsonb; expenses jsonb; accounts jsonb; ct bigint; pt bigint; et bigint; balance bigint; pending bigint; begin
 with lines as (
  select s.id,a.id account_id,'service' kind,s.name,s.path,s.price amount,s.completed_at confirmed_at from ita_private.visit_services s join ita_private.accounts a on a.visit_id=s.visit_id where s.status='completed' and s.price is not null
  union all select s.id,s.account_id,'product',s.name,s.path,s.quantity::bigint*s.unit_price,s.confirmed_at from ita_private.sales s where s.status='confirmed'
 ) select coalesce(jsonb_agg(to_jsonb(x) order by confirmed_at),'[]'),coalesce(sum(amount),0) into charges,ct from lines x where (confirmed_at at time zone 'America/Bogota')::date between p_from and p_to;
 select coalesce(jsonb_agg(to_jsonb(p) order by paid_at),'[]'),coalesce(sum(amount),0) into payments,pt from ita_private.payments p where corrected_by is null and (paid_at at time zone 'America/Bogota')::date between p_from and p_to;
 select coalesce(jsonb_agg(to_jsonb(e) order by paid_at),'[]'),coalesce(sum(amount),0) into expenses,et from ita_private.expenses e where corrected_by is null and (paid_at at time zone 'America/Bogota')::date between p_from and p_to;
 select coalesce(jsonb_agg(ita_private.account_json(a.id) order by a.created_at desc),'[]') into accounts from ita_private.accounts a;
 select coalesce(sum((x->>'balance')::bigint),0),coalesce(sum((x->>'pending_prices')::int),0) into balance,pending from jsonb_array_elements(accounts) x;
 return jsonb_build_object('from',p_from,'to',p_to,'currency','COP','generated_at',now(),'charges',charges,'payments',payments,'expenses',expenses,'accounts',accounts,
 'totals',jsonb_build_object('charges',ct,'collected',pt,'expenses',et,'operating_flow',pt-et,'balance',balance,'pending_prices',pending),
 'cash_sessions',coalesce((select jsonb_agg(ita_private.cash_json(id) order by opened_at desc) from ita_private.cash_sessions where closed_at is null or (opened_at at time zone 'America/Bogota')::date between p_from and p_to),'[]'),
 'cash_movements',coalesce((select jsonb_agg(to_jsonb(m) order by created_at desc) from ita_private.cash_movements m where (created_at at time zone 'America/Bogota')::date between p_from and p_to),'[]'));
end $$;

-- Consistent, bounded exports. Each page sees one SQL snapshot. A revision guard
-- makes the client discard the whole export if business data changes between pages.
create function ita_private.export_revision() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('audit_count',(select count(*) from ita_private.audit),'audit_max',(select max(id) from ita_private.audit),
  'birthday_seen',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by user_id,target_month)::text,'[]')) from ita_private.birthday_seen x),
  'backup_status',(select md5(coalesce(jsonb_agg(to_jsonb(x) order by id)::text,'[]')) from ita_private.backup_status x))
$$;

create function ita_private.export_records(p jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare scope text:=p->>'scope'; client uuid:=(p->>'id')::uuid; selected text:=p->>'table'; tables text[];
 revision jsonb:=ita_private.export_revision(); manifest jsonb:='[]'; rows jsonb; total bigint; offset_n integer:=greatest(coalesce((p->>'offset')::integer,0),0);
 limit_n integer:=least(greatest(coalesce((p->>'limit')::integer,50),1),200); table_name text; filter_sql text; order_sql text;
 visit_ids uuid[]; account_ids uuid[]; appointment_ids uuid[]; movement_ids uuid[]; entity_ids text[];
begin
 perform ita_private.actor(); perform ita_private.require_owner();
 if scope not in ('global','client') or scope is null then raise exception 'Ámbito de exportación inválido.'; end if;
 if p ? 'revision' and p->'revision' is distinct from revision then raise exception 'Los registros cambiaron durante la exportación. Vuelve a descargar para obtener una copia íntegra.' using errcode='40001'; end if;
 if selected is not null and not (p ? 'revision') then raise exception 'Inicia la exportación antes de solicitar sus páginas.'; end if;
 tables:=array['profiles','settings','clients','categories','services','products','payment_methods','appointments','appointment_services','visits','service_groups','visit_services','accounts','sales','stock_movements','payments','expenses','audit'];
 if scope='global' then tables:=tables||array['cash_sessions','cash_movements','birthday_seen','backup_status'];
 else
  if client is null or not exists(select 1 from ita_private.clients where id=client) then raise exception 'Clienta inexistente.'; end if;
  select coalesce(array_agg(id),'{}') into visit_ids from ita_private.visits where client_id=client;
  select coalesce(array_agg(id),'{}') into account_ids from ita_private.accounts where client_id=client;
  select coalesce(array_agg(id),'{}') into appointment_ids from ita_private.appointments where client_id=client;
  with recursive related as (
   select id from ita_private.stock_movements where visit_id=any(visit_ids) or sale_id in(select id from ita_private.sales where account_id=any(account_ids))
   union select m.id from ita_private.stock_movements m join related r on m.correction_of=r.id
  ) select coalesce(array_agg(id),'{}') into movement_ids from related;
  select coalesce(array_agg(id),'{}') into entity_ids from (
   select client::text id union select unnest(visit_ids)::text union select unnest(account_ids)::text union select unnest(appointment_ids)::text union select unnest(movement_ids)::text
   union select id::text from ita_private.service_groups where visit_id=any(visit_ids)
   union select id::text from ita_private.visit_services where visit_id=any(visit_ids)
   union select id::text from ita_private.sales where account_id=any(account_ids)
   union select id::text from ita_private.payments where account_id=any(account_ids)
   union select id::text from ita_private.expenses where stock_movement_id=any(movement_ids)
  ) ids;
 end if;
 if selected is not null and not selected=any(tables) then raise exception 'Tabla no exportable.' using errcode='42501'; end if;
 foreach table_name in array tables loop
  if selected is not null and table_name<>selected then continue; end if;
  filter_sql:='true';
  if scope='client' then
   filter_sql:=case table_name
    when 'clients' then 'x.id=$1'
    when 'appointments' then 'x.client_id=$1'
    when 'appointment_services' then 'x.appointment_id=any($4)'
    when 'visits' then 'x.client_id=$1'
    when 'service_groups' then 'x.visit_id=any($2)'
    when 'visit_services' then 'x.visit_id=any($2)'
    when 'accounts' then 'x.client_id=$1'
    when 'sales' then 'x.account_id=any($3)'
    when 'stock_movements' then 'x.id=any($5)'
    when 'payments' then 'x.account_id=any($3)'
    when 'expenses' then 'x.stock_movement_id=any($5)'
    when 'audit' then 'x.entity_id=any($6) or x.before_data->>''appointment_id''=any($4::text[]) or x.after_data->>''appointment_id''=any($4::text[])'
    else 'true' end;
  end if;
  execute format('select count(*) from ita_private.%I x where %s',table_name,filter_sql) into total using client,visit_ids,account_ids,appointment_ids,movement_ids,entity_ids;
  if selected is null then manifest:=manifest||jsonb_build_array(jsonb_build_object('name',table_name,'count',total));
  else
   order_sql:=case table_name when 'appointment_services' then 'x.appointment_id,x.service_id' when 'birthday_seen' then 'x.user_id,x.target_month' else 'x.id' end;
   execute format('select coalesce(jsonb_agg(to_jsonb(page)),''[]'') from (select x.* from ita_private.%I x where %s order by %s limit $7 offset $8) page',table_name,filter_sql,order_sql)
    into rows using client,visit_ids,account_ids,appointment_ids,movement_ids,entity_ids,limit_n,offset_n;
   return jsonb_build_object('format_version',1,'scope',scope,'client_id',client,'revision',revision,'table',table_name,'items',rows,'total',total,'next_offset',case when offset_n+jsonb_array_length(rows)<total then offset_n+jsonb_array_length(rows) end);
  end if;
 end loop;
 return jsonb_build_object('format_version',1,'scope',scope,'client_id',client,'revision',revision,'tables',manifest);
end $$;

create function ita_private.query(p_action text,p_payload jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=ita_private.actor(); owner boolean:=ita_private.is_owner(); today date:=(now() at time zone 'America/Bogota')::date; result jsonb; data jsonb; op ita_private.operations; cid uuid; rid uuid:=(p_payload->>'id')::uuid; n integer:=least(greatest(coalesce((p_payload->>'limit')::integer,50),1),200); offst integer:=greatest(coalesce((p_payload->>'offset')::integer,(p_payload->>'page')::integer*least(greatest(coalesce((p_payload->>'limit')::integer,50),1),200),0),0); term text:=coalesce(p_payload->>'search',''); f date; t date; af timestamptz; at_end timestamptz; begin
 if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Consulta inválida.'; end if;
 f:=coalesce((p_payload->>'from')::date,date_trunc('month',today)::date); t:=coalesce((p_payload->>'to')::date,(date_trunc('month',today)+interval '1 month - 1 day')::date);
 if t<f or t-f>370 then raise exception 'Selecciona un período de hasta 371 días.'; end if;
 af:=case when coalesce(p_payload->>'from','') like '%T%' then (p_payload->>'from')::timestamptz else f::timestamp at time zone 'America/Bogota' end;
 at_end:=case when coalesce(p_payload->>'to','') like '%T%' then (p_payload->>'to')::timestamptz else (t+1)::timestamp at time zone 'America/Bogota' end;
 if p_action='bootstrap' then
  return jsonb_build_object('profile',(select to_jsonb(p) from ita_private.profiles p where id=u),'profiles',(select jsonb_agg(to_jsonb(p) order by display_name) from ita_private.profiles p where owner or id=u),
  'settings',(select to_jsonb(s)-'id' from ita_private.settings s),'server_date',today,'backup',case when owner then (select to_jsonb(b) from ita_private.backup_status b order by started_at desc,id desc limit 1) end);
 elsif p_action='clients' then
  with filtered as(select * from ita_private.clients where (active or (owner and coalesce((p_payload->>'include_archived')::boolean,false))) and (name ilike '%'||term||'%' or (term<>'' and phone_normalized like '%'||regexp_replace(term,'[^0-9]','','g')||'%' and regexp_replace(term,'[^0-9]','','g')<>'')))
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(c) order by name) from (select * from filtered order by name,id limit n offset offst) c),'[]'),'total',(select count(*) from filtered)) into result;
  return result;
 elsif p_action='client' then
  if not exists(select 1 from ita_private.clients where id=rid) then raise exception 'Clienta inexistente.'; end if;
  return jsonb_build_object('client',(select to_jsonb(c) from ita_private.clients c where id=rid),
   'duplicates',coalesce((select jsonb_agg(to_jsonb(c)) from ita_private.clients c join ita_private.clients target on target.id=rid where c.id<>rid and c.active and (lower(c.name)=lower(target.name) or (target.phone_normalized<>'' and c.phone_normalized=target.phone_normalized))),'[]'),
   'history',coalesce((select jsonb_agg(jsonb_build_object('visit_id',v.id,'starts_at',v.starts_at,'professional_id',v.professional_id,'professional_name',pr.display_name,'status',v.status,'services',coalesce((select jsonb_agg(to_jsonb(s)-'price'-'reference_price' order by created_at) from ita_private.visit_services s where visit_id=v.id and status<>'void'),'[]')) order by v.starts_at desc)
    from (select * from ita_private.visits where client_id=rid order by starts_at desc,id limit n offset offst) v join ita_private.profiles pr on pr.id=v.professional_id),'[]'));
 elsif p_action='catalog' then
  return jsonb_build_object('categories',coalesce((select jsonb_agg(to_jsonb(c) order by sort_order,name) from ita_private.categories c where kind='service' and (owner or active)),'[]'),
  'services',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('path',ita_private.category_path(s.category_id)||' / '||s.name) order by sort_order,name) from ita_private.services s where owner or active),'[]'));
 elsif p_action='inventory' then
  return jsonb_build_object('categories',coalesce((select jsonb_agg(to_jsonb(c) order by sort_order,name) from ita_private.categories c where kind='product' and (owner or active)),'[]'),
   'products',coalesce((select jsonb_agg((case when owner then to_jsonb(pr) else to_jsonb(pr)-'cost' end)||jsonb_build_object('path',ita_private.category_path(pr.category_id)||' / '||pr.name,'stock',ita_private.stock(pr.id)) order by name) from ita_private.products pr where (owner or active) and (term='' or name ilike '%'||term||'%' or code ilike '%'||term||'%')),'[]'),
   'movements',case when owner then coalesce((select jsonb_agg(to_jsonb(m) order by created_at desc) from (select * from ita_private.stock_movements where ((p_payload->>'product_id') is null or product_id=(p_payload->>'product_id')::uuid) order by created_at desc,id limit n offset offst) m),'[]') else '[]'::jsonb end);
 elsif p_action='appointments' then
  return jsonb_build_object('items',coalesce((select jsonb_agg(ita_private.appointment_json(a.id) order by starts_at) from ita_private.appointments a where (owner or professional_id=u) and ((p_payload->>'professional_id') is null or professional_id=(p_payload->>'professional_id')::uuid) and (rid is null or a.id=rid) and starts_at<at_end and ends_at>af),'[]'));
 elsif p_action='visits' then
  with filtered as(select v.* from ita_private.visits v join ita_private.clients c on c.id=v.client_id where (owner or professional_id=u) and ((p_payload->>'client_id') is null or client_id=(p_payload->>'client_id')::uuid) and (term='' or c.name ilike '%'||term||'%') and ((p_payload->>'status') is null or v.status=p_payload->>'status') and ((p_payload->>'from') is null or (v.starts_at at time zone 'America/Bogota')::date>=f) and ((p_payload->>'to') is null or (v.starts_at at time zone 'America/Bogota')::date<=t))
  select jsonb_build_object('items',coalesce((select jsonb_agg(ita_private.visit_json(v.id) order by starts_at desc) from(select * from filtered order by starts_at desc,id limit n offset offst) v),'[]'),'total',(select count(*) from filtered)) into result; return result;
 elsif p_action in ('visit','account') then
  if p_action='visit' then
   if not exists(select 1 from ita_private.visits where id=rid and (owner or professional_id=u)) then raise exception 'Visita sin acceso.' using errcode='42501'; end if;
   select id into cid from ita_private.accounts where visit_id=rid;
   return ita_private.account_detail(cid)||jsonb_build_object('visit',ita_private.visit_json(rid),'services',coalesce((select jsonb_agg(to_jsonb(s) order by created_at,id) from ita_private.visit_services s where visit_id=rid and status<>'void'),'[]'));
  else
   if not exists(select 1 from ita_private.accounts where id=rid and (owner or professional_id=u)) then raise exception 'Cuenta sin acceso.' using errcode='42501'; end if;
   return ita_private.account_detail(rid);
  end if;
 elsif p_action='settings' then
  return jsonb_build_object('settings',(select to_jsonb(s)-'id' from ita_private.settings s),'profiles',coalesce((select jsonb_agg(to_jsonb(p) order by display_name) from ita_private.profiles p where owner or id=u),'[]'),
   'payment_methods',coalesce((select jsonb_agg(to_jsonb(pm) order by name) from ita_private.payment_methods pm where owner or active),'[]'),'backup',case when owner then (select to_jsonb(b) from ita_private.backup_status b order by started_at desc,id desc limit 1) end);
 elsif p_action='birthdays' then return ita_private.birthdays(today,f,t);
 elsif p_action='finance' then perform ita_private.require_owner(); return ita_private.finance(f,t);
 elsif p_action='audit' then
  perform ita_private.require_owner();
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x) order by id desc) from(select * from ita_private.audit where ((p_payload->>'entity_id') is null or entity_id=p_payload->>'entity_id') order by id desc limit n offset offst) x),'[]'));
 elsif p_action='operation' then
  select * into op from ita_private.operations o where o.id=(p_payload->>'operation_id')::uuid and actor_id=u;
  if op.id is null then return null; end if;
  perform ita_private.authorize_operation(op.action,op.payload,op.result);
  return jsonb_build_object('result',op.result);
 elsif p_action='export' then
  perform ita_private.require_owner();
  if coalesce(p_payload->>'scope','finance')='finance' then data:=ita_private.finance(f,t);
  elsif p_payload->>'scope'='clients' then data:=coalesce((select jsonb_agg(to_jsonb(c)) from ita_private.clients c),'[]');
  elsif p_payload->>'scope' in ('client','global') then data:=ita_private.export_records(p_payload);
  elsif p_payload->>'scope'='inventory' then data:=ita_private.query('inventory',p_payload);
  else raise exception 'Exportación desconocida.'; end if;
  return jsonb_build_object('generated_at',now(),'currency','COP','timezone','America/Bogota','data',data);
 end if;
 raise exception 'Consulta desconocida.';
end $$;

-- Invoker wrappers expose only the intended endpoints. No direct table read/write
-- privilege is needed, including via forged PostgREST URLs or Realtime.
create function public.app_query(p_action text,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select ita_private.query(p_action,p_payload) $$;
create function public.app_command(p_action text,p_payload jsonb,p_operation_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select ita_private.command(p_action,p_payload,p_operation_id) $$;
revoke all on all functions in schema ita_private from public,anon,authenticated;
revoke all on function public.app_query(text,jsonb),public.app_command(text,jsonb,uuid) from public,anon,authenticated;
grant usage on schema ita_private to authenticated;
grant execute on function ita_private.query(text,jsonb),ita_private.command(text,jsonb,uuid) to authenticated;
grant execute on function public.app_query(text,jsonb),public.app_command(text,jsonb,uuid) to authenticated;
-- Server-side backup runner only: read all private data and publish status.
grant usage on schema ita_private to service_role;
grant select on all tables in schema ita_private to service_role;
grant insert on ita_private.backup_status to service_role;
alter default privileges in schema ita_private revoke execute on functions from public;
