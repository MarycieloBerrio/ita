-- Ledger integrity: frozen cash closings, full payment reversal, safe stock
-- corrections and bounded cash withdrawals. Replaces cash_json and
-- command_money; grants are preserved by CREATE OR REPLACE.

-- 1. Cash closings are signed-off snapshots. Totals are stored at cash.close
-- and never recomputed afterwards, so later records cannot rewrite a closing.
alter table ita_private.cash_sessions
  add column expected_amount bigint,
  add column cash_payments bigint,
  add column cash_expenses bigint,
  add column movements_net bigint;

-- Live cash totals of a session up to p_until (inclusive window).
create function ita_private.cash_live(p_id uuid, p_until timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare c ita_private.cash_sessions; pay_total bigint; exp_total bigint; mov_total bigint; begin
  select * into c from ita_private.cash_sessions where id = p_id;
  select coalesce(sum(amount), 0) into pay_total from ita_private.payments
   where corrected_by is null and is_cash and paid_at >= c.opened_at and paid_at <= p_until;
  select coalesce(sum(amount), 0) into exp_total from ita_private.expenses
   where corrected_by is null and is_cash and paid_at >= c.opened_at and paid_at <= p_until;
  select coalesce(sum(case when kind = 'contribution' then amount else -amount end), 0) into mov_total
   from ita_private.cash_movements where session_id = c.id;
  return jsonb_build_object('cash_payments', pay_total, 'cash_expenses', exp_total, 'movements_net', mov_total,
    'expected_amount', c.opening_amount + pay_total - exp_total + mov_total);
end $$;

-- Backfill: existing closings keep exactly the value they currently display.
select set_config('ita.action', 'migration.cash_snapshot', true);
select set_config('ita.reason', 'Instantánea del cierre de caja existente', true);
update ita_private.cash_sessions c set
  cash_payments = (x->>'cash_payments')::bigint,
  cash_expenses = (x->>'cash_expenses')::bigint,
  movements_net = (x->>'movements_net')::bigint,
  expected_amount = (x->>'expected_amount')::bigint
from (select id, ita_private.cash_live(id, closed_at) x from ita_private.cash_sessions where closed_at is not null) s
where s.id = c.id;
select set_config('ita.action', '', true);
select set_config('ita.reason', '', true);

alter table ita_private.cash_sessions add constraint cash_sessions_snapshot_check check (
  (closed_at is null and expected_amount is null and cash_payments is null and cash_expenses is null and movements_net is null)
  or (closed_at is not null and cash_payments is not null and cash_expenses is not null and movements_net is not null
      and expected_amount = opening_amount + cash_payments - cash_expenses + movements_net)
);

create or replace function ita_private.cash_json(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare c ita_private.cash_sessions; live jsonb; begin
 select * into c from ita_private.cash_sessions where id=p_id;
 if c.closed_at is not null then
  live:=jsonb_build_object('cash_payments',c.cash_payments,'cash_expenses',c.cash_expenses,'movements_net',c.movements_net,'expected_amount',c.expected_amount);
 else
  live:=ita_private.cash_live(c.id,now());
 end if;
 return to_jsonb(c)||live||jsonb_build_object('difference',c.counted_amount-(live->>'expected_amount')::bigint);
end $$;

-- Closed session whose [opened_at, closed_at] window contains p_at, if any.
create function ita_private.closed_cash_session_at(p_at timestamptz) returns uuid
language sql stable set search_path = '' as $$
  select id from ita_private.cash_sessions
  where closed_at is not null and p_at >= opened_at and p_at <= closed_at
  order by opened_at desc limit 1
$$;

-- 3. Full reversal. A voided payment points corrected_by at itself: every
-- existing "valid payment" filter (corrected_by is null) already excludes it,
-- and voided_at/void_reason make the reversal explicit and auditable.
alter table ita_private.payments
  add column voided_at timestamptz,
  add column void_reason text,
  add constraint payments_void_check check (
    (voided_at is null and void_reason is null)
    or (voided_at is not null and corrected_by = id and length(btrim(void_reason)) > 0)
  );
-- A replacement row may itself be voided, so its id can appear twice in
-- corrected_by (its original's link and its own void mark). Uniqueness still
-- holds for every replacement link: one original has at most one replacement.
alter table ita_private.payments drop constraint payments_corrected_by_key;
create unique index payments_corrected_by_idx on ita_private.payments(corrected_by)
  where corrected_by is distinct from id;

revoke all on function ita_private.cash_live(uuid, timestamptz) from public, anon, authenticated;
revoke all on function ita_private.closed_cash_session_at(timestamptz) from public, anon, authenticated;

-- Closed-cash rule for money records (payments and expenses):
-- * A closing is a frozen snapshot, so no later write changes its expected
--   amount or difference.
-- * A NEW cash row (record/save) dated inside a closed session's window is
--   rejected: that drawer was already counted and signed off.
-- * A correction may restate a cash row that already belonged to a closed
--   session keeping it in that same session (e.g. fixing a typed amount): the
--   closing stays as signed, while the account and reports get the fix. A
--   correction may not move cash INTO a different closed session, nor turn a
--   non-cash row into cash dated inside a closed session.
-- * A void only removes a record, so it is allowed for closed sessions too;
--   the closing keeps its snapshot and the audit keeps the reason.
create or replace function ita_private.command_money(a text,p jsonb) returns jsonb language plpgsql set search_path='' as $$
declare u uuid:=ita_private.actor(); rid uuid:=coalesce((p->>'id')::uuid,gen_random_uuid()); acc ita_private.accounts; sl ita_private.sales; pr ita_private.products; sm ita_private.stock_movements; oldsm ita_private.stock_movements; pm ita_private.payment_methods; py ita_private.payments; oldpy ita_private.payments; ex ita_private.expenses; oldex ita_private.expenses; cs ita_private.cash_sessions; j jsonb; n bigint; qty integer; dt timestamptz; closed_sid uuid; closed_at_ts timestamptz; begin
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
   -- A sale movement is owned by its confirmed sale and charge; restoring stock
   -- here would leave the sale billed. Legacy chains rooted in a sale are included.
   if exists(with recursive chain as(
     select m.id,m.correction_of,m.kind,m.sale_id from ita_private.stock_movements m where m.id=rid
     union all select m.id,m.correction_of,m.kind,m.sale_id from ita_private.stock_movements m join chain c on m.id=c.correction_of)
    select 1 from chain where kind='sale' or sale_id is not null) then
    raise exception 'Una venta confirmada no se rectifica desde inventario: la venta y su cobro siguen vigentes.' using errcode='23514';
   end if;
   select * into pr from ita_private.products where id=oldsm.product_id for update;
   if exists(select 1 from ita_private.stock_movements where correction_of=rid) then raise exception 'Este movimiento ya tiene una rectificación. Rectifica la última de la cadena.'; end if;
  else select * into pr from ita_private.products where id=(p->>'product_id')::uuid for update; end if;
  -- Archived products accept corrections of past errors, never new movements.
  if pr.id is null or (a='inventory.move' and not pr.active) then raise exception 'Producto inexistente o archivado.'; end if;
  qty:=(p->>'quantity')::int;
  if qty=0 or qty is null or ita_private.stock(pr.id)+qty<0 or ita_private.stock(pr.id)+qty>2147483647 then raise exception 'Movimiento inválido o stock insuficiente.' using errcode='23514'; end if;
  if btrim(coalesce(p->>'reason',''))='' then raise exception 'Indica el motivo del movimiento.'; end if;
  if a='inventory.move' and p->>'kind' not in ('initial','purchase','consumption','adjustment') then raise exception 'Origen de movimiento no permitido.'; end if;
  insert into ita_private.stock_movements(product_id,name,path,quantity,kind,reason,visit_id,correction_of,created_by)
   values(pr.id,pr.name,ita_private.category_path(pr.category_id)||' / '||pr.name,qty,case when a='inventory.correct' then 'correction' else p->>'kind' end,p->>'reason',(p->>'visit_id')::uuid,case when a='inventory.correct' then rid end,u) returning * into sm;
  return to_jsonb(sm);
 elsif a='payment.void' then
  -- Owner-only full reversal without replacement (see closed-cash rule above).
  perform ita_private.require_owner();
  perform pg_advisory_xact_lock(82013,4);
  select * into oldpy from ita_private.payments where id=rid;
  if oldpy.id is null then raise exception 'Pago original inexistente.'; end if;
  if btrim(coalesce(p->>'reason',''))='' then raise exception 'La anulación requiere motivo del error.'; end if;
  acc:=ita_private.lock_account(oldpy.account_id);
  select * into oldpy from ita_private.payments where id=rid for update;
  if oldpy.corrected_by is not null then raise exception 'Este pago ya fue rectificado o anulado. Abre el pago vigente.'; end if;
  update ita_private.payments set corrected_by=id,voided_at=now(),void_reason=btrim(p->>'reason') where id=rid returning * into py;
  return to_jsonb(py);
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
  if pm.is_cash then
   closed_sid:=ita_private.closed_cash_session_at(dt);
   if closed_sid is not null and (oldpy.id is null or not oldpy.is_cash or closed_sid is distinct from ita_private.closed_cash_session_at(oldpy.paid_at)) then
    select closed_at into closed_at_ts from ita_private.cash_sessions where id=closed_sid;
    raise exception 'Esa fecha pertenece a una caja ya cerrada el %. Su cuadre no cambia: registra el efectivo con fecha posterior al cierre.',to_char(closed_at_ts at time zone 'America/Bogota','YYYY-MM-DD HH24:MI') using errcode='23514';
   end if;
  end if;
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
  if pm.is_cash then
   closed_sid:=ita_private.closed_cash_session_at(dt);
   if closed_sid is not null and (oldex.id is null or not oldex.is_cash or closed_sid is distinct from ita_private.closed_cash_session_at(oldex.paid_at)) then
    select closed_at into closed_at_ts from ita_private.cash_sessions where id=closed_sid;
    raise exception 'Esa fecha pertenece a una caja ya cerrada el %. Su cuadre no cambia: registra el efectivo con fecha posterior al cierre.',to_char(closed_at_ts at time zone 'America/Bogota','YYYY-MM-DD HH24:MI') using errcode='23514';
   end if;
  end if;
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
    if p->>'kind'='withdrawal' and (p->>'amount')::bigint>(ita_private.cash_json(cs.id)->>'expected_amount')::bigint then
     raise exception 'El retiro supera el efectivo esperado en caja (% COP).',(ita_private.cash_json(cs.id)->>'expected_amount') using errcode='23514';
    end if;
    insert into ita_private.cash_movements(session_id,kind,amount,reason,created_by) values(cs.id,p->>'kind',(p->>'amount')::bigint,p->>'reason',u);
    update ita_private.cash_sessions set version=version+1 where id=cs.id returning * into cs;
   elsif a='cash.close' then
    perform ita_private.require_version(cs.version,p->'version');
    closed_at_ts:=clock_timestamp();
    j:=ita_private.cash_live(cs.id,closed_at_ts);
    update ita_private.cash_sessions set closed_at=closed_at_ts,counted_amount=(p->>'counted_amount')::bigint,notes=coalesce(p->>'notes',notes),
     cash_payments=(j->>'cash_payments')::bigint,cash_expenses=(j->>'cash_expenses')::bigint,movements_net=(j->>'movements_net')::bigint,expected_amount=(j->>'expected_amount')::bigint,
     version=version+1 where id=cs.id returning * into cs;
   else raise exception 'Operación de caja desconocida.'; end if;
  end if;
  return ita_private.cash_json(cs.id);
 end if;
 raise exception 'Operación económica desconocida.';
end $$;
