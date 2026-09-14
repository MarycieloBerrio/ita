create function ita_private.command_catalog(a text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare u uuid:=ita_private.actor(); rid uuid:=coalesce((p->>'id')::uuid,gen_random_uuid()); c ita_private.categories; s ita_private.services; pr ita_private.products; pm ita_private.payment_methods; prof ita_private.profiles; cfg ita_private.settings; parent uuid; k text; begin
 perform ita_private.require_owner();
 -- Serialize structural edits so archiving cannot race creation under that category.
 if a like 'category.%' or a like 'service.%' or a like 'product.%' then perform pg_advisory_xact_lock(82013,1); end if;
 if a like 'category.%' then
  perform pg_advisory_xact_lock(82013,1);
  select * into c from ita_private.categories where id=rid for update;
  if p ? 'id' then perform ita_private.require_version(c.version,p->'version'); end if;
  if a='category.delete' then
   if exists(select 1 from ita_private.categories where parent_id=rid) or exists(select 1 from ita_private.services where category_id=rid) or exists(select 1 from ita_private.products where category_id=rid) or exists(select 1 from ita_private.audit where after_data->>'category_id'=rid::text) then raise exception 'Solo se elimina una categoría vacía y nunca utilizada.'; end if;
   delete from ita_private.categories where id=rid; return jsonb_build_object('id',rid);
  end if;
  if a='category.archive' then
   if exists(select 1 from ita_private.categories where parent_id=rid and active) or exists(select 1 from ita_private.services where category_id=rid and active) or exists(select 1 from ita_private.products where category_id=rid and active) then raise exception 'Reubica o archiva explícitamente los elementos activos primero.'; end if;
   update ita_private.categories set active=false,version=version+1 where id=rid returning * into c;
  elsif a='category.save' then
   parent:=case when p ? 'parent_id' then (p->>'parent_id')::uuid else c.parent_id end; k:=coalesce(p->>'kind',c.kind);
   if c.id is not null and k<>c.kind then raise exception 'No se cambia el tipo de catálogo.'; end if;
   if parent is not null and not exists(select 1 from ita_private.categories where id=parent and kind=k and active) then raise exception 'Padre inválido, archivado o de otro catálogo.'; end if;
   if parent=rid or exists(with recursive tree as(select id,parent_id from ita_private.categories where id=parent union all select x.id,x.parent_id from ita_private.categories x join tree t on x.id=t.parent_id) select 1 from tree where id=rid) then raise exception 'La categoría no puede contener ciclos.'; end if;
   if coalesce((p->>'active')::boolean,c.active,true)=false and c.id is not null then raise exception 'Usa Archivar para revisar primero los elementos activos.'; end if;
   insert into ita_private.categories(id,kind,parent_id,name,active,sort_order,default_price_mode) values(rid,k,parent,btrim(p->>'name'),true,coalesce((p->>'sort_order')::int,c.sort_order,0),coalesce(p->>'default_price_mode',c.default_price_mode))
   on conflict(id) do update set parent_id=excluded.parent_id,name=excluded.name,active=true,sort_order=excluded.sort_order,default_price_mode=excluded.default_price_mode,version=ita_private.categories.version+1 returning * into c;
  else raise exception 'Operación de categoría desconocida.'; end if;
  return to_jsonb(c);
 elsif a like 'service.%' then
  select * into s from ita_private.services where id=rid for update;
  if p ? 'id' then perform ita_private.require_version(s.version,p->'version'); end if;
  if a='service.archive' then update ita_private.services set active=false,version=version+1 where id=rid returning * into s;
  elsif a='service.save' then
   if not exists(select 1 from ita_private.categories where id=(p->>'category_id')::uuid and kind='service' and active) then raise exception 'Categoría de servicios inválida o archivada.'; end if;
   insert into ita_private.services(id,category_id,name,form_type,price_mode,fixed_price,duration_minutes,active,sort_order)
   values(rid,(p->>'category_id')::uuid,btrim(p->>'name'),p->>'form_type',p->>'price_mode',case when p->>'price_mode'='fixed' then (p->>'fixed_price')::bigint end,coalesce((p->>'duration_minutes')::int,s.duration_minutes,60),coalesce((p->>'active')::boolean,s.active,true),coalesce((p->>'sort_order')::int,s.sort_order,0))
   on conflict(id) do update set category_id=excluded.category_id,name=excluded.name,form_type=excluded.form_type,price_mode=excluded.price_mode,fixed_price=excluded.fixed_price,duration_minutes=excluded.duration_minutes,active=excluded.active,sort_order=excluded.sort_order,version=ita_private.services.version+1 returning * into s;
  else raise exception 'Operación de catálogo desconocida.'; end if;
  return to_jsonb(s);
 elsif a like 'product.%' then
  select * into pr from ita_private.products where id=rid for update;
  if p ? 'id' then perform ita_private.require_version(pr.version,p->'version'); end if;
  if (a='product.archive' or p->>'active'='false') and ita_private.stock(rid)>0 then raise exception 'No se archiva un producto con existencias positivas.'; end if;
  if a='product.archive' then update ita_private.products set active=false,version=version+1 where id=rid returning * into pr;
  elsif a='product.save' then
   if not exists(select 1 from ita_private.categories where id=(p->>'category_id')::uuid and kind='product' and active) then raise exception 'Categoría de inventario inválida o archivada.'; end if;
   insert into ita_private.products(id,category_id,name,brand,presentation,code,usage,cost,sale_price,minimum_stock,active)
   values(rid,(p->>'category_id')::uuid,btrim(p->>'name'),coalesce(p->>'brand',pr.brand,''),coalesce(p->>'presentation',pr.presentation,''),coalesce(p->>'code',pr.code,''),p->>'usage',(p->>'cost')::bigint,(p->>'sale_price')::bigint,coalesce((p->>'minimum_stock')::int,pr.minimum_stock,0),coalesce((p->>'active')::boolean,pr.active,true))
   on conflict(id) do update set category_id=excluded.category_id,name=excluded.name,brand=excluded.brand,presentation=excluded.presentation,code=excluded.code,usage=excluded.usage,cost=excluded.cost,sale_price=excluded.sale_price,minimum_stock=excluded.minimum_stock,active=excluded.active,version=ita_private.products.version+1 returning * into pr;
  else raise exception 'Operación de producto desconocida.'; end if;
  return to_jsonb(pr);
 elsif a='payment_method.save' then
  select * into pm from ita_private.payment_methods where id=rid for update;
  if p ? 'id' then perform ita_private.require_version(pm.version,p->'version'); end if;
  insert into ita_private.payment_methods(id,name,is_cash,active) values(rid,btrim(p->>'name'),(p->>'is_cash')::boolean,coalesce((p->>'active')::boolean,pm.active,true))
  on conflict(id) do update set name=excluded.name,is_cash=excluded.is_cash,active=excluded.active,version=ita_private.payment_methods.version+1 returning * into pm;
  return to_jsonb(pm);
 elsif a='profile.save' then
  perform pg_advisory_xact_lock(82013,2);
  select * into prof from ita_private.profiles where id=rid for update; perform ita_private.require_version(prof.version,p->'version');
  if rid=u and (p->>'active'='false' or p->>'role'<>'owner') then raise exception 'La dueña no puede desactivar ni quitar su propio acceso administrativo.'; end if;
  update ita_private.profiles set display_name=btrim(p->>'display_name'),role=p->>'role',active=(p->>'active')::boolean,version=version+1 where id=rid returning * into prof;
  return to_jsonb(prof);
 elsif a='settings.save' then
  select * into cfg from ita_private.settings where id for update; perform ita_private.require_version(cfg.version,p->'version');
  if p->>'prevent_overlap'='false' then raise exception 'Impedir solapamientos de una misma profesional es una regla confirmada.'; end if;
  update ita_private.settings set privacy_text=p->>'privacy_text',responsible_name=p->>'responsible_name',responsible_contact=p->>'responsible_contact',version=version+1 where id returning * into cfg;
  return to_jsonb(cfg)||jsonb_build_object('id','00000000-0000-0000-0000-000000000001');
 end if;
 raise exception 'Operación administrativa desconocida.';
end $$;

create function ita_private.add_services(p_visit uuid,p_ids jsonb,p_group uuid default null,p_technical jsonb default null) returns void language plpgsql set search_path='' as $$
declare sid text; s ita_private.services; cat uuid; begin
 if jsonb_typeof(p_ids) is distinct from 'array' or jsonb_array_length(p_ids) not between 1 and 50 then raise exception 'Selecciona entre 1 y 50 servicios.'; end if;
 for sid in select jsonb_array_elements_text(p_ids) loop
  select * into s from ita_private.services where id=sid::uuid and active;
  if s.id is null then raise exception 'Servicio inexistente o archivado.'; end if;
  if p_group is not null then
   if s.form_type<>'general' then raise exception 'Las tandas agrupan servicios generales del mismo método.'; end if;
   if cat is not null and cat<>s.category_id then raise exception 'Revisa zonas y precios: una tanda usa un solo método.'; end if;
   cat:=s.category_id;
   insert into ita_private.service_groups(id,visit_id,category_id,technical,created_by) values(p_group,p_visit,cat,coalesce(p_technical,ita_private.default_technical('general')),ita_private.actor()) on conflict(id) do nothing;
   if not exists(select 1 from ita_private.service_groups where id=p_group and visit_id=p_visit and category_id=cat) then raise exception 'Tanda de otra visita o método.'; end if;
  end if;
  perform ita_private.validate_technical(coalesce(p_technical,ita_private.default_technical(s.form_type)),s.form_type,false,p_visit);
  insert into ita_private.visit_services(visit_id,service_id,group_id,name,path,form_type,price_mode,reference_price,price,technical)
  values(p_visit,s.id,p_group,s.name,ita_private.category_path(s.category_id)||' / '||s.name,s.form_type,s.price_mode,s.fixed_price,s.fixed_price,coalesce(p_technical,ita_private.default_technical(s.form_type)));
 end loop;
end $$;

create function ita_private.command_work(a text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare u uuid:=ita_private.actor(); rid uuid:=coalesce((p->>'id')::uuid,gen_random_uuid()); cl ita_private.clients; ap ita_private.appointments; v ita_private.visits; sr ita_private.visit_services; svc ita_private.services; acc ita_private.accounts; pro uuid; sid text; tid uuid; t jsonb; status_new text; price_new bigint; begin
 if a='client.save' then
  select * into cl from ita_private.clients where id=rid for update;
  if p ? 'id' then perform ita_private.require_version(cl.version,p->'version'); end if;
  if p->>'active'='false' or (cl.id is not null and not cl.active) then perform ita_private.require_owner(); end if;
  insert into ita_private.clients(id,name,phone,birth_day,birth_month,birth_year,notes,active,consent,created_by)
  values(rid,btrim(p->>'name'),nullif(p->>'phone',''),(p->>'birth_day')::int,(p->>'birth_month')::int,(p->>'birth_year')::int,coalesce(p->>'notes',cl.notes,''),coalesce((p->>'active')::boolean,cl.active,true),coalesce(p->>'consent',cl.consent,''),u)
  on conflict(id) do update set name=excluded.name,phone=excluded.phone,birth_day=excluded.birth_day,birth_month=excluded.birth_month,birth_year=excluded.birth_year,notes=excluded.notes,active=excluded.active,consent=excluded.consent,version=ita_private.clients.version+1 returning * into cl;
  return to_jsonb(cl);
 elsif a='appointment.save' then
  pro:=(p->>'professional_id')::uuid; perform ita_private.require_professional(pro);
  -- Serializes scheduling per professional, not across the salon. Half-open ranges allow adjacent appointments.
  perform pg_advisory_xact_lock(hashtextextended('schedule:'||pro::text,0));
  select * into ap from ita_private.appointments where id=rid for update;
  if p ? 'id' then perform ita_private.require_version(ap.version,p->'version'); perform ita_private.require_professional(ap.professional_id); end if;
  if exists(select 1 from ita_private.visits where appointment_id=rid) and (ap.professional_id<>pro or ap.client_id<>(p->>'client_id')::uuid) then raise exception 'Reasigna desde la visita vinculada para conservar una responsable.'; end if;
  status_new:=coalesce(p->>'status',ap.status,'scheduled');
  if exists(select 1 from ita_private.visits where appointment_id=rid) and status_new is distinct from ap.status then raise exception 'El estado de una cita iniciada se gestiona desde su visita vinculada.'; end if;
  if status_new in ('in_progress','completed') and coalesce(ap.status,'scheduled') not in ('in_progress','completed') then raise exception 'Usa Iniciar atención y Finalizar visita para estos estados.'; end if;
  if status_new in ('scheduled','confirmed','in_progress') and exists(select 1 from ita_private.appointments x where x.professional_id=pro and x.id<>rid and x.status in ('scheduled','confirmed','in_progress') and tstzrange(x.starts_at,x.ends_at,'[)') && tstzrange((p->>'starts_at')::timestamptz,(p->>'ends_at')::timestamptz,'[)')) then raise exception 'La profesional ya tiene una cita en ese horario.' using errcode='23P01'; end if;
  if not exists(select 1 from ita_private.clients where id=(p->>'client_id')::uuid and active) then raise exception 'Selecciona una clienta activa.'; end if;
  insert into ita_private.appointments(id,client_id,professional_id,starts_at,ends_at,status,notes,created_by)
  values(rid,(p->>'client_id')::uuid,pro,(p->>'starts_at')::timestamptz,(p->>'ends_at')::timestamptz,status_new,coalesce(p->>'notes',ap.notes,''),u)
  on conflict(id) do update set client_id=excluded.client_id,professional_id=excluded.professional_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status=excluded.status,notes=excluded.notes,version=ita_private.appointments.version+1 returning * into ap;
  delete from ita_private.appointment_services where appointment_id=rid and service_id not in(select value::uuid from jsonb_array_elements_text(coalesce(p->'service_ids','[]')));
  for sid in select jsonb_array_elements_text(coalesce(p->'service_ids','[]')) loop
   select * into svc from ita_private.services where id=sid::uuid and active; if svc.id is null then raise exception 'Servicio previsto inválido.'; end if;
   insert into ita_private.appointment_services values(rid,svc.id,svc.name,ita_private.category_path(svc.category_id)||' / '||svc.name,svc.form_type,svc.price_mode,svc.fixed_price) on conflict do nothing;
  end loop;
  return to_jsonb(ap);
 elsif a='appointment.start' then
  select * into ap from ita_private.appointments where id=rid for update;
  if ap.id is null then raise exception 'Cita sin acceso.' using errcode='42501'; end if;
  perform ita_private.require_professional(ap.professional_id);
  select * into v from ita_private.visits where appointment_id=rid;
  if v.id is not null then return jsonb_build_object('id',v.id,'visit_id',v.id,'version',v.version); end if;
  perform ita_private.require_version(ap.version,p->'version');
  if ap.status not in ('scheduled','confirmed') then raise exception 'La cita no se puede iniciar en su estado actual.'; end if;
  insert into ita_private.visits(client_id,professional_id,appointment_id,starts_at,created_by) values(ap.client_id,ap.professional_id,ap.id,now(),u) returning * into v;
  insert into ita_private.accounts(visit_id,professional_id,client_id) values(v.id,v.professional_id,v.client_id) returning * into acc;
  insert into ita_private.visit_services(visit_id,service_id,name,path,form_type,price_mode,reference_price,price,technical)
   select v.id,x.service_id,x.name,x.path,x.form_type,x.price_mode,x.reference_price,x.reference_price,ita_private.default_technical(x.form_type) from ita_private.appointment_services x where appointment_id=ap.id;
  update ita_private.appointments set status='in_progress',version=version+1 where id=ap.id;
  return jsonb_build_object('id',v.id,'visit_id',v.id,'version',v.version,'account_id',acc.id);
 elsif a='visit.create' then
  pro:=coalesce((p->>'professional_id')::uuid,u); perform ita_private.require_professional(pro);
  if not exists(select 1 from ita_private.clients where id=(p->>'client_id')::uuid and active) then raise exception 'Selecciona una clienta activa.'; end if;
  insert into ita_private.visits(client_id,professional_id,starts_at,created_by) values((p->>'client_id')::uuid,pro,coalesce((p->>'starts_at')::timestamptz,now()),u) returning * into v;
  if v.starts_at>now()+interval '1 minute' then raise exception 'Una visita registra trabajo actual, no una reserva futura.'; end if;
  insert into ita_private.accounts(visit_id,professional_id,client_id) values(v.id,pro,v.client_id) returning * into acc;
  if jsonb_array_length(coalesce(p->'service_ids','[]'))>0 then perform ita_private.add_services(v.id,p->'service_ids'); end if;
  return jsonb_build_object('id',v.id,'visit_id',v.id,'version',v.version,'account_id',acc.id);
 elsif a in ('visit.save','visit.close','visit.void','service.add','service.copy') then
  tid:=case when a like 'visit.%' then rid else (p->>'visit_id')::uuid end;
  v:=ita_private.lock_visit(tid); perform ita_private.require_version(v.version,p->'version');
  if a in ('service.add','service.copy') and v.status not in ('draft','in_progress') then raise exception 'Solo se añaden servicios a una visita abierta.'; end if;
  if a='service.add' then perform ita_private.add_services(v.id,p->'service_ids',(p->>'group_id')::uuid,p->'technical');
  elsif a='service.copy' then
   select * into sr from ita_private.visit_services where id=(p->>'source_id')::uuid and status<>'void';
   if sr.id is null then raise exception 'Ficha de referencia inexistente.'; end if;
   t:=sr.technical;
   if sr.form_type<>'general' then t:=t||'{"saleIds":[],"saleDisposition":"pending","maintenanceDate":""}'; end if;
   perform ita_private.add_services(v.id,jsonb_build_array(sr.service_id),null,t);
  elsif a='visit.save' then
   if v.status in ('completed','void') then perform ita_private.require_owner(); if btrim(coalesce(p->>'reason',''))='' then raise exception 'Una corrección histórica necesita motivo.'; end if; end if;
   pro:=coalesce((p->>'professional_id')::uuid,v.professional_id); perform ita_private.require_professional(pro);
   if p ? 'status' and (p->>'status' not in ('draft','in_progress') or (v.status in ('completed','void') and p->>'status'<>v.status)) then raise exception 'Usa las acciones Finalizar o Anular para cambiar ese estado.'; end if;
   if coalesce((p->>'starts_at')::timestamptz,v.starts_at)>now()+interval '1 minute' then raise exception 'Una visita registra trabajo actual, no una reserva futura.'; end if;
   if pro<>v.professional_id then
    perform ita_private.require_owner(); if btrim(coalesce(p->>'reason',''))='' then raise exception 'Reasignar necesita motivo.'; end if;
    perform pg_advisory_xact_lock(hashtextextended('schedule:'||pro::text,0));
    select * into ap from ita_private.appointments where id=v.appointment_id for update;
    if ap.id is not null and ap.status in ('scheduled','confirmed','in_progress') and exists(select 1 from ita_private.appointments x where professional_id=pro and id<>ap.id and status in ('scheduled','confirmed','in_progress') and tstzrange(x.starts_at,x.ends_at,'[)') && tstzrange(ap.starts_at,ap.ends_at,'[)')) then raise exception 'La profesional tiene otra cita en ese horario.'; end if;
    update ita_private.accounts set professional_id=pro where visit_id=v.id;
    update ita_private.appointments set professional_id=pro,version=version+1 where id=v.appointment_id;
   end if;
   update ita_private.visits set professional_id=pro,notes=coalesce(p->>'notes',notes),starts_at=coalesce((p->>'starts_at')::timestamptz,starts_at),status=coalesce(p->>'status',status) where id=v.id;
  elsif a='visit.close' then
   if v.status not in ('draft','in_progress') then raise exception 'Esta visita ya fue finalizada o anulada.'; end if;
   if not exists(select 1 from ita_private.visit_services where visit_id=v.id and status<>'void') or exists(select 1 from ita_private.visit_services where visit_id=v.id and status<>'void' and (status<>'completed' or price is null)) then raise exception 'Completa las fichas y todos los precios antes de cerrar.'; end if;
   if exists(select 1 from ita_private.sales s join ita_private.accounts x on x.id=s.account_id where x.visit_id=v.id and s.status='draft') then raise exception 'Confirma o descarta todos los productos en borrador.'; end if;
   update ita_private.visits set status='completed' where id=v.id;
   update ita_private.appointments set status='completed',version=version+1 where id=v.appointment_id;
  elsif a='visit.void' then
   perform ita_private.require_owner(); if btrim(coalesce(p->>'reason',''))='' then raise exception 'Indica el motivo del error de registro.'; end if;
   if exists(select 1 from ita_private.sales s join ita_private.accounts x on x.id=s.account_id where x.visit_id=v.id and s.status='confirmed') or exists(select 1 from ita_private.payments py join ita_private.accounts x on x.id=py.account_id where x.visit_id=v.id and py.corrected_by is null) then raise exception 'La visita tiene ventas o pagos confirmados; no se anulan ni se devuelve stock automáticamente.'; end if;
   update ita_private.visit_services set status='void',version=version+1 where visit_id=v.id;
   update ita_private.visits set status='void' where id=v.id;
   -- Keep the unique historical link. An erroneous visit never reopens a booking.
   update ita_private.appointments set status='cancelled',version=version+1 where id=v.appointment_id;
  end if;
  update ita_private.visits set version=version+1 where id=v.id returning * into v;
  perform ita_private.ensure_account((select id from ita_private.accounts where visit_id=v.id));
  return jsonb_build_object('id',v.id,'visit_id',v.id,'version',v.version);
 elsif a in ('service_record.save','service.remove','service.refresh_price','charge.correct') then
  select * into sr from ita_private.visit_services where id=rid;
  v:=ita_private.lock_visit(sr.visit_id);
  select * into sr from ita_private.visit_services where id=rid for update; perform ita_private.require_version(sr.version,p->'version');
  select * into acc from ita_private.accounts where visit_id=v.id;
  if sr.status='void' then raise exception 'La ficha está anulada.'; end if;
  if a='service.remove' then
   if sr.status<>'draft' or v.status not in ('draft','in_progress') or exists(select 1 from ita_private.payments where account_id=acc.id and corrected_by is null) or exists(select 1 from ita_private.sales where service_record_id=rid and status<>'discarded') then raise exception 'Solo se quitan borradores sin cobros o ventas vinculadas.'; end if;
   update ita_private.visit_services set status='void',version=version+1 where id=rid returning * into sr;
  elsif a='service.refresh_price' then
   if sr.status<>'draft' or v.status not in ('draft','in_progress') then raise exception 'Solo se actualiza la tarifa de un borrador.'; end if;
   select * into svc from ita_private.services where id=sr.service_id and active;
   if svc.id is null or svc.form_type<>sr.form_type then raise exception 'El servicio cambió de ficha o está archivado; añade una selección nueva.'; end if;
   update ita_private.visit_services set name=svc.name,path=ita_private.category_path(svc.category_id)||' / '||svc.name,price_mode=svc.price_mode,reference_price=svc.fixed_price,price=svc.fixed_price,version=version+1 where id=rid returning * into sr;
  elsif a='charge.correct' then
   perform ita_private.require_owner(); if btrim(coalesce(p->>'reason',''))='' then raise exception 'Rectificar un importe necesita motivo del error.'; end if;
   if (p->>'price')::bigint is null or (p->>'price')::bigint<=0 then raise exception 'La rectificación exige un precio positivo, nunca pendiente.'; end if;
   update ita_private.visit_services set price=(p->>'price')::bigint,version=version+1 where id=rid returning * into sr;
  else
   t:=p->'technical'; status_new:=coalesce(p->>'status',sr.status); price_new:=case when p ? 'price' then (p->>'price')::bigint else sr.price end;
   if status_new not in ('draft','completed') then raise exception 'Estado de ficha inválido.'; end if;
   if sr.price_mode='fixed' and price_new is distinct from sr.price then raise exception 'La tarifa fija no se cambia desde la visita.'; end if;
   if (sr.status='completed' and t is distinct from sr.technical) or v.status='completed' then
    if btrim(coalesce(p->>'reason',''))='' then raise exception 'Modificar una ficha finalizada necesita motivo del error.'; end if;
   end if;
   if sr.price is not null and sr.price is distinct from price_new and sr.status='completed' then raise exception 'Usa la rectificación de importe autorizada a la dueña.'; end if;
   if sr.status='completed' and status_new='draft' then raise exception 'Una ficha realizada se corrige con trazabilidad; no vuelve a borrador.'; end if;
   perform ita_private.validate_technical(t,sr.form_type,status_new='completed',v.id);
   update ita_private.visit_services set technical=t,price=price_new,status=status_new,completed_at=case when status_new='completed' then coalesce(completed_at,now()) else null end,version=version+1 where id=rid returning * into sr;
  end if;
  update ita_private.visits set version=version+1 where id=v.id;
  perform ita_private.ensure_account(acc.id); return to_jsonb(sr);
 end if;
 raise exception 'Operación de atención desconocida.';
end $$;
create function ita_private.command_money(a text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare u uuid:=ita_private.actor(); rid uuid:=coalesce((p->>'id')::uuid,gen_random_uuid()); acc ita_private.accounts; sl ita_private.sales; pr ita_private.products; sm ita_private.stock_movements; oldsm ita_private.stock_movements; pm ita_private.payment_methods; py ita_private.payments; oldpy ita_private.payments; ex ita_private.expenses; oldex ita_private.expenses; cs ita_private.cash_sessions; j jsonb; n bigint; qty integer; dt timestamptz; begin
 if a='account.create' then
  perform ita_private.require_owner();
  insert into ita_private.accounts(professional_id,client_id) values(u,(p->>'client_id')::uuid) returning * into acc;
  return jsonb_build_object('id',acc.id,'account_id',acc.id);
 elsif a like 'sale.%' then
  if p ? 'id' then select * into sl from ita_private.sales where id=rid; end if;
  acc:=ita_private.lock_account(coalesce(sl.account_id,(p->>'account_id')::uuid));
  if acc.visit_id is not null and exists(select 1 from ita_private.visits where id=acc.visit_id and status in ('void','completed')) then raise exception 'La cuenta de esta visita está cerrada para nuevas ventas.'; end if;
  if p ? 'id' then select * into sl from ita_private.sales where id=rid for update; perform ita_private.require_version(sl.version,p->'version'); end if;
  if sl.id is not null and sl.status<>'draft' then raise exception 'Una venta confirmada no se modifica ni repone inventario.'; end if;
  if a='sale.save' then
   select * into pr from ita_private.products where id=(p->>'product_id')::uuid for update;
   if pr.id is null or not pr.active or pr.usage='internal' or pr.sale_price is null then raise exception 'Producto no disponible para venta.'; end if;
   if (p->>'service_record_id') is not null and not exists(select 1 from ita_private.visit_services where id=(p->>'service_record_id')::uuid and visit_id=acc.visit_id and status<>'void') then raise exception 'La ficha enlazada pertenece a otra cuenta.'; end if;
   insert into ita_private.sales(id,account_id,product_id,service_record_id,name,path,quantity,unit_price,unit_cost,created_by)
    values(rid,acc.id,pr.id,(p->>'service_record_id')::uuid,pr.name,ita_private.category_path(pr.category_id)||' / '||pr.name,(p->>'quantity')::int,pr.sale_price,pr.cost,u)
    on conflict(id) do update set product_id=excluded.product_id,service_record_id=excluded.service_record_id,name=excluded.name,path=excluded.path,quantity=excluded.quantity,unit_price=excluded.unit_price,unit_cost=excluded.unit_cost,version=ita_private.sales.version+1 returning * into sl;
  elsif a='sale.discard' then update ita_private.sales set status='discarded',version=version+1 where id=rid returning * into sl;
  elsif a='sale.confirm' then
   select * into pr from ita_private.products where id=sl.product_id for update;
   if pr.id is null or not pr.active or pr.usage='internal' then raise exception 'El producto ya no está disponible para venta.'; end if;
   if ita_private.stock(pr.id)<sl.quantity then raise exception 'No hay unidades suficientes. Recarga el inventario.' using errcode='23514'; end if;
   update ita_private.sales set status='confirmed',confirmed_at=now(),version=version+1 where id=rid returning * into sl;
   insert into ita_private.stock_movements(product_id,name,path,quantity,kind,reason,visit_id,sale_id,created_by) values(pr.id,sl.name,sl.path,-sl.quantity,'sale','Venta y entrega confirmadas',acc.visit_id,sl.id,u);
  else raise exception 'Operación de venta desconocida.'; end if;
  perform ita_private.ensure_account(acc.id);
  return to_jsonb(sl)-'unit_cost';
 elsif a in ('inventory.move','inventory.correct') then
  perform ita_private.require_owner();
  if a='inventory.correct' then
   select * into oldsm from ita_private.stock_movements where id=rid;
   if oldsm.id is null then raise exception 'Movimiento original inexistente.'; end if;
   select * into pr from ita_private.products where id=oldsm.product_id for update;
   if exists(select 1 from ita_private.stock_movements where correction_of=rid) then raise exception 'Este movimiento ya tiene una rectificación. Rectifica la última de la cadena.'; end if;
  else select * into pr from ita_private.products where id=(p->>'product_id')::uuid for update; end if;
  if pr.id is null or not pr.active then raise exception 'Producto inexistente o archivado.'; end if;
  qty:=(p->>'quantity')::int;
  if qty=0 or qty is null or ita_private.stock(pr.id)+qty<0 or ita_private.stock(pr.id)+qty>2147483647 then raise exception 'Movimiento inválido o stock insuficiente.' using errcode='23514'; end if;
  if btrim(coalesce(p->>'reason',''))='' then raise exception 'Indica el motivo del movimiento.'; end if;
  if a='inventory.move' and p->>'kind' not in ('initial','purchase','consumption','adjustment') then raise exception 'Origen de movimiento no permitido.'; end if;
  insert into ita_private.stock_movements(product_id,name,path,quantity,kind,reason,visit_id,correction_of,created_by)
   values(pr.id,pr.name,ita_private.category_path(pr.category_id)||' / '||pr.name,qty,case when a='inventory.correct' then 'correction' else p->>'kind' end,p->>'reason',(p->>'visit_id')::uuid,case when a='inventory.correct' then rid end,u) returning * into sm;
  return to_jsonb(sm);
 elsif a in ('payment.record','payment.correct') then
  -- Cash close and cash-affecting operations share a short lock; close cannot miss a committed payment.
  perform pg_advisory_xact_lock(82013,4);
  if a='payment.correct' then
   perform ita_private.require_owner(); select * into oldpy from ita_private.payments where id=rid;
   if oldpy.id is null then raise exception 'Pago original inexistente.'; end if;
   if btrim(coalesce(p->>'reason',''))='' then raise exception 'La rectificación requiere motivo del error.'; end if;
  end if;
  acc:=ita_private.lock_account(coalesce(oldpy.account_id,(p->>'account_id')::uuid));
  if a='payment.correct' then
   select * into oldpy from ita_private.payments where id=rid for update;
   if oldpy.corrected_by is not null then raise exception 'Este pago ya fue rectificado. Abre el pago vigente.'; end if;
  end if;
  j:=ita_private.account_json(acc.id);
  if not (j->>'ready_for_payment')::boolean then raise exception 'Antes de cobrar, realiza todas las atenciones, define sus precios y confirma o descarta ventas.'; end if;
  n:=(p->>'amount')::bigint;
  if n<=0 or n>(j->>'balance')::bigint+coalesce(oldpy.amount,0) then raise exception 'El pago debe ser positivo y no superar el saldo.' using errcode='23514'; end if;
  select * into pm from ita_private.payment_methods where id=(p->>'method_id')::uuid and active;
  if pm.id is null then raise exception 'Selecciona un método de pago activo.'; end if;
  dt:=(p->>'paid_at')::timestamptz;
  if dt is null or dt>now()+interval '1 minute' or dt<greatest(acc.created_at,
    (select max(completed_at) from ita_private.visit_services where visit_id=acc.visit_id and status='completed'),
    (select max(confirmed_at) from ita_private.sales where account_id=acc.id and status='confirmed'))-interval '1 minute'
  then raise exception 'Fecha real de pago inválida: no se admiten anticipos ni fechas futuras.'; end if;
  insert into ita_private.payments(account_id,amount,paid_at,method_id,method_name,is_cash,reference,created_by,correction_of,reason)
   values(acc.id,n,dt,pm.id,pm.name,pm.is_cash,coalesce(p->>'reference',''),u,oldpy.id,p->>'reason') returning * into py;
  if oldpy.id is not null then update ita_private.payments set corrected_by=py.id where id=oldpy.id; end if;
  perform ita_private.ensure_account(acc.id); return to_jsonb(py);
 elsif a in ('expense.save','expense.correct') then
  perform ita_private.require_owner();
  perform pg_advisory_xact_lock(82013,3);
  perform pg_advisory_xact_lock(82013,4);
  if a='expense.correct' then
   select * into oldex from ita_private.expenses where id=rid for update;
   if oldex.id is null or oldex.corrected_by is not null then raise exception 'Egreso inexistente o ya rectificado.'; end if;
   if btrim(coalesce(p->>'reason',''))='' then raise exception 'Indica motivo de la rectificación.'; end if;
  end if;
  select * into pm from ita_private.payment_methods where id=(p->>'method_id')::uuid and active;
  if pm.id is null then raise exception 'Selecciona un método de pago activo.'; end if;
  dt:=(p->>'paid_at')::timestamptz;
  if dt is null or dt>now()+interval '1 minute' then raise exception 'El egreso registra un pago realizado.'; end if;
  if p->>'stock_movement_id' is not null and not exists(select 1 from ita_private.stock_movements where id=(p->>'stock_movement_id')::uuid and kind='purchase') then raise exception 'Solo se enlaza el pago de una compra recibida.'; end if;
  insert into ita_private.expenses(concept,category,amount,paid_at,method_id,method_name,is_cash,stock_movement_id,created_by,correction_of,reason)
   values(btrim(p->>'concept'),coalesce(p->>'category','General'),(p->>'amount')::bigint,dt,pm.id,pm.name,pm.is_cash,case when oldex.id is null then (p->>'stock_movement_id')::uuid end,u,oldex.id,p->>'reason') returning * into ex;
  if oldex.id is not null then
   if p->>'stock_movement_id' is not null and (p->>'stock_movement_id')::uuid is distinct from oldex.stock_movement_id then raise exception 'La rectificación conserva la compra enlazada al original.'; end if;
   update ita_private.expenses set corrected_by=ex.id where id=oldex.id;
   update ita_private.expenses set stock_movement_id=oldex.stock_movement_id where id=ex.id returning * into ex;
  end if;
  return to_jsonb(ex);
 elsif a like 'cash.%' then
  perform ita_private.require_owner(); perform pg_advisory_xact_lock(82013,4);
  if a='cash.open' then
   if exists(select 1 from ita_private.cash_sessions where closed_at is null) then raise exception 'Ya existe una caja abierta.'; end if;
   insert into ita_private.cash_sessions(opened_at,opening_amount,notes,created_by) values(clock_timestamp(),(p->>'opening_amount')::bigint,coalesce(p->>'notes',''),u) returning * into cs;
  else
   select * into cs from ita_private.cash_sessions where id=case when a='cash.move' then (p->>'session_id')::uuid else rid end for update;
   if cs.id is null or cs.closed_at is not null then raise exception 'La caja no está abierta.'; end if;
   if a='cash.move' then
    insert into ita_private.cash_movements(session_id,kind,amount,reason,created_by) values(cs.id,p->>'kind',(p->>'amount')::bigint,p->>'reason',u);
    update ita_private.cash_sessions set version=version+1 where id=cs.id returning * into cs;
   elsif a='cash.close' then
    perform ita_private.require_version(cs.version,p->'version');
    update ita_private.cash_sessions set closed_at=clock_timestamp(),counted_amount=(p->>'counted_amount')::bigint,notes=coalesce(p->>'notes',notes),version=version+1 where id=cs.id returning * into cs;
   else raise exception 'Operación de caja desconocida.'; end if;
  end if;
  return ita_private.cash_json(cs.id);
 end if;
 raise exception 'Operación económica desconocida.';
end $$;

-- A replay is a read of historical output and must recheck present-day access.
-- An operation key is never a capability that survives reassignment or role changes.
create function ita_private.authorize_operation(a text,p jsonb,r jsonb) returns void language plpgsql stable set search_path='' as $$
declare pro uuid; entity uuid; begin
 perform ita_private.actor();
 if a in ('client.save','birthday.seen') then return;
 elsif a='appointment.save' then
  select professional_id into pro from ita_private.appointments where id=(r->>'id')::uuid;
 elsif a in ('appointment.start','visit.create','visit.save','visit.close','service.add','service.copy') then
  select professional_id into pro from ita_private.visits where id=coalesce((r->>'visit_id')::uuid,(r->>'id')::uuid);
 elsif a in ('service_record.save','service.remove','service.refresh_price') then
  select v.professional_id into pro from ita_private.visit_services s join ita_private.visits v on v.id=s.visit_id where s.id=(r->>'id')::uuid;
 elsif a like 'sale.%' or a='payment.record' then
  entity:=(r->>'account_id')::uuid;
  select professional_id into pro from ita_private.accounts where id=entity;
 else perform ita_private.require_owner(); return;
 end if;
 if pro is null or (not ita_private.is_owner() and pro<>auth.uid()) then raise exception 'La operación ya no pertenece a una atención con acceso.' using errcode='42501'; end if;
end $$;

create function ita_private.command(p_action text,p_payload jsonb,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=ita_private.actor(); op ita_private.operations; v_result jsonb; target date; begin
 if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'La operación requiere identificador y datos válidos.'; end if;
 if octet_length(p_payload::text)>250000 then raise exception 'Los datos exceden el tamaño permitido.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,15));
 select * into op from ita_private.operations where id=p_operation_id;
 if op.id is not null then
  if op.actor_id<>u or op.action<>p_action or op.payload<>p_payload then raise exception 'La clave de operación ya se usó con otros datos.' using errcode='23505'; end if;
  perform ita_private.authorize_operation(op.action,op.payload,op.result);
  return op.result;
 end if;
 insert into ita_private.operations(id,actor_id,action,payload) values(p_operation_id,u,p_action,p_payload);
 perform set_config('ita.action',p_action,true); perform set_config('ita.reason',coalesce(p_payload->>'reason',''),true);
 if p_action in ('category.save','category.archive','category.delete','service.save','service.archive','product.save','product.archive','payment_method.save','profile.save','settings.save') then v_result:=ita_private.command_catalog(p_action,p_payload);
 elsif p_action in ('client.save','appointment.save','appointment.start','visit.create','visit.save','visit.close','visit.void','service.add','service.copy','service_record.save','service.remove','service.refresh_price','charge.correct') then v_result:=ita_private.command_work(p_action,p_payload);
 elsif p_action='birthday.seen' then
  target:=(p_payload->>'target_month')::date;
  if target not in (date_trunc('month',now() at time zone 'America/Bogota')::date,(date_trunc('month',now() at time zone 'America/Bogota')+interval '1 month')::date) then raise exception 'Mes de aviso inválido.'; end if;
  insert into ita_private.birthday_seen(user_id,target_month) values(u,target) on conflict do nothing;
  v_result:=jsonb_build_object('id',p_operation_id,'target_month',target);
 else v_result:=ita_private.command_money(p_action,p_payload);
 end if;
 update ita_private.operations set result=v_result where id=p_operation_id;
 return v_result;
end $$;
