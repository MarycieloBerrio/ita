import { PGlite } from '@electric-sql/pglite';
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

export async function createTestDatabase(native = false) {
  const db = native ? await (await import('./db-native.mjs')).createNativeDatabase() : new PGlite();
  await db.exec(
    `do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`,
  );
  for (const file of (await readdir('supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    try {
      await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
    } catch (error) {
      console.error(
        `Migration failed: ${file}: ${error.message}; position ${error.position ?? error.internalPosition ?? 'unknown'}`,
      );
      await db.close();
      throw error;
    }
  }
  return db;
}

async function run() {
  const db = await createTestDatabase(process.argv.includes('--native'));
  try {
    const owner = randomUUID(),
      worker = randomUUID(),
      outsider = randomUUID();
    const thisYear = new Date().getUTCFullYear();
    const financeRange = { from: `${thisYear}-01-01`, to: `${thisYear}-12-31` };
    await db.query(`insert into auth.users(id) values($1),($2),($3)`, [owner, worker, outsider]);
    await db.query(
      `insert into ita_private.profiles(id,display_name,role) values($1,'Dueña ficticia','owner'),($2,'Trabajadora ficticia','worker')`,
      [owner, worker],
    );
    let checks = 0;
    const check = (condition, message) => {
      assert.ok(condition, message);
      checks++;
    };
    async function as(user, fn) {
      await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [user ?? '']);
      await db.exec('set role authenticated');
      try {
        return await fn();
      } finally {
        await db.exec('reset role');
      }
    }
    const query = (action, payload = {}) =>
      db
        .query('select public.app_query($1,$2::jsonb) result', [action, JSON.stringify(payload)])
        .then((r) => r.rows[0].result);
    const command = (action, payload, key = randomUUID()) =>
      db
        .query('select public.app_command($1,$2::jsonb,$3) result', [
          action,
          JSON.stringify(payload),
          key,
        ])
        .then((r) => r.rows[0].result);
    async function denied(fn, pattern = /.+/) {
      await assert.rejects(fn, pattern);
      checks++;
    }
    await as(outsider, () => denied(() => query('bootstrap'), /Acceso/));
    await as(null, () => denied(() => query('bootstrap'), /Acceso/));
    await as(worker, () =>
      denied(() => db.query('select * from ita_private.profiles'), /permission denied/),
    );
    await as(worker, () =>
      denied(() => db.query(`select ita_private.require_owner()`), /permission denied/),
    );
    let client, cat, general, color, prodcat, product, method, ownVisit, workerVisit;
    await as(owner, async () => {
      client = await command('client.save', {
        name: 'Clienta ficticia',
        birth_day: 29,
        birth_month: 2,
      });
      await denied(
        () => command('client.save', { name: 'Fecha imposible', birth_day: 31, birth_month: 4 }),
        /check constraint/,
      );
      await denied(
        () =>
          command('client.save', {
            name: 'Fecha imposible',
            birth_day: 29,
            birth_month: 2,
            birth_year: 2025,
          }),
        /check constraint/,
      );
      cat = await command('category.save', { name: 'Peluquería ficticia', kind: 'service' });
      general = await command('service.save', {
        name: 'Cepillado ficticio',
        category_id: cat.id,
        form_type: 'general',
        price_mode: 'fixed',
        fixed_price: 30000,
        duration_minutes: 30,
      });
      color = await command('service.save', {
        name: 'Color ficticio',
        category_id: cat.id,
        form_type: 'color',
        price_mode: 'custom',
        duration_minutes: 120,
      });
      await denied(
        () =>
          command('service.save', {
            name: 'Fijo vacío',
            category_id: cat.id,
            form_type: 'general',
            price_mode: 'fixed',
          }),
        /check constraint/,
      );
      await denied(
        () =>
          command('service.save', {
            name: 'Cero',
            category_id: cat.id,
            form_type: 'general',
            price_mode: 'fixed',
            fixed_price: 0,
          }),
        /check constraint/,
      );
      prodcat = await command('category.save', { name: 'Productos ficticios', kind: 'product' });
      product = await command('product.save', {
        name: 'Tratamiento ficticio',
        category_id: prodcat.id,
        usage: 'both',
        sale_price: 15000,
        cost: 7000,
      });
      method = await command('payment_method.save', { name: 'Efectivo ficticio', is_cash: true });
      ownVisit = await command('visit.create', { client_id: client.id, service_ids: [general.id] });
      workerVisit = await command('visit.create', {
        client_id: client.id,
        professional_id: worker,
        service_ids: [color.id, general.id],
      });
    });
    await as(worker, async () => {
      for (const a of ['finance', 'audit', 'export']) await denied(() => query(a), /dueña/);
      for (const [a, p] of [
        ['category.save', { name: 'Intrusión', kind: 'service' }],
        [
          'inventory.move',
          { product_id: product.id, quantity: 2, kind: 'initial', reason: 'intrusión' },
        ],
        [
          'profile.save',
          { id: worker, version: 1, role: 'owner', display_name: 'x', active: true },
        ],
        ['account.create', {}],
      ])
        await denied(() => command(a, p), /dueña/);
      await denied(() => query('visit', { id: ownVisit.id }), /acceso/);
      await denied(() => query('account', { id: ownVisit.account_id }), /acceso/);
      check(!(await query('inventory')).products[0].cost, 'Worker does not receive costs');
      const h = await query('client', { id: client.id });
      check(h.history.length === 2, 'Shared technical history');
      check(
        !JSON.stringify(h.history).includes('"price":'),
        'Technical history omits applied financial price',
      );
      check(
        !JSON.stringify(h.history).includes('appointment_id'),
        'Technical history omits appointments',
      );
      let detail = await query('visit', { id: workerVisit.id });
      check(
        detail.services.length === 2 &&
          detail.account.pending_prices === 1 &&
          detail.account.total === null,
        'Multiple services; pending is not zero',
      );
      await denied(
        () =>
          command('payment.record', {
            account_id: workerVisit.account_id,
            amount: 100000,
            method_id: method.id,
            paid_at: new Date().toISOString(),
          }),
        /Antes de cobrar/,
      );
      const colorLine = detail.services.find((s) => s.form_type === 'color');
      const technical = {
        ...colorLine.technical,
        procedure: 'Procedimiento\ncon saltos',
        saleDisposition: 'none',
        decolorants: { none: true, items: [] },
        oxidants: { none: true, items: [] },
        tints: { none: true, items: [] },
        finalizers: { none: true, items: [] },
        map: {
          templateId: 'ita-five-views',
          templateVersion: 1,
          zones: {
            z01: { pattern: 'zigzag', patternVersion: 1, colorText: '8.31 + fórmula libre' },
            z05: { pattern: 'diagonal-straight', patternVersion: 1, colorText: 'Lado derecho' },
          },
        },
      };
      await command('service_record.save', {
        id: colorLine.id,
        version: colorLine.version,
        technical,
        price: 200000,
        status: 'completed',
      });
      await denied(
        () =>
          command('service_record.save', {
            id: colorLine.id,
            version: colorLine.version,
            technical,
            price: 200000,
            status: 'completed',
          }),
        /Otra sesión/,
      );
      detail = await query('visit', { id: workerVisit.id });
      assert.deepEqual(detail.services.find((s) => s.id === colorLine.id).technical, technical);
      checks++;
      const gl = detail.services.find((s) => s.form_type === 'general');
      await denied(
        () =>
          command('service_record.save', {
            id: gl.id,
            version: gl.version,
            technical: gl.technical,
            price: 20000,
            status: 'completed',
          }),
        /tarifa fija/,
      );
      await command('service_record.save', {
        id: gl.id,
        version: gl.version,
        technical: gl.technical,
        status: 'completed',
      });
      const key = randomUUID(),
        payment = {
          account_id: workerVisit.account_id,
          amount: 100000,
          method_id: method.id,
          paid_at: new Date().toISOString(),
        };
      const first = await command('payment.record', payment, key),
        second = await command('payment.record', payment, key);
      check(first.id === second.id, 'Payment retry idempotent');
      await denied(
        () => command('payment.record', { ...payment, amount: 100001 }, key),
        /otros datos/,
      );
      detail = await query('visit', { id: workerVisit.id });
      check(
        detail.account.total === 230000 &&
          detail.account.balance === 130000 &&
          detail.payments.length === 1,
        'Partial payment exact COP',
      );
      await denied(
        () => command('payment.record', { ...payment, amount: 130001 }),
        /superar el saldo/,
      );
      await command('payment.record', {
        ...payment,
        amount: 130000,
        paid_at: new Date().toISOString(),
      });
      detail = await query('visit', { id: workerVisit.id });
      check(
        detail.account.balance === 0 && detail.account.payment_status === 'paid',
        'Paid derived from ledger',
      );
      await denied(
        () =>
          command('payment.correct', {
            id: first.id,
            amount: 100000,
            method_id: method.id,
            paid_at: new Date().toISOString(),
            reason: 'x',
          }),
        /dueña/,
      );
      check((await query('inventory')).products[0].stock === 0, 'Technical work never moves stock');
      await command('visit.close', { id: detail.visit.id, version: detail.visit.version });
    });
    let moved;
    await as(owner, async () => {
      const key = randomUUID(),
        payload = {
          product_id: product.id,
          quantity: 2,
          kind: 'initial',
          reason: 'Conteo ficticio',
        };
      await command('inventory.move', payload, key);
      await command('inventory.move', payload, key);
      check((await query('inventory')).products[0].stock === 2, 'Stock operation idempotent');
      await denied(
        () => command('product.archive', { id: product.id, version: product.version }),
        /existencias/,
      );
      moved = await command('inventory.move', {
        product_id: product.id,
        quantity: -1,
        kind: 'consumption',
        reason: 'Uso manual ficticio',
      });
      check((await query('inventory')).products[0].stock === 1, 'Manual output exact');
      await denied(
        () =>
          command('inventory.move', {
            product_id: product.id,
            quantity: -2,
            kind: 'consumption',
            reason: 'Exceso',
          }),
        /insuficiente/,
      );
      const standalone = await command('account.create', {});
      let sale = await command('sale.save', {
        account_id: standalone.id,
        product_id: product.id,
        quantity: 1,
      });
      check((await query('inventory')).products[0].stock === 1, 'Draft sale leaves stock');
      const keySale = randomUUID(),
        pSale = { id: sale.id, version: sale.version };
      await command('sale.confirm', pSale, keySale);
      await command('sale.confirm', pSale, keySale);
      check((await query('inventory')).products[0].stock === 0, 'Confirmed sale moves once');
      const other = await command('account.create', {});
      sale = await command('sale.save', {
        account_id: other.id,
        product_id: product.id,
        quantity: 1,
      });
      await denied(
        () => command('sale.confirm', { id: sale.id, version: sale.version }),
        /suficientes/,
      );
      check(
        (await query('account', { id: other.id })).sales[0].status === 'draft',
        'Failed sale rolls back status and charge',
      );
      await command('payment.record', {
        account_id: standalone.id,
        amount: 15000,
        method_id: method.id,
        paid_at: new Date().toISOString(),
      });
      check((await query('inventory')).products[0].stock === 0, 'Paying sale does not move again');
      const corr = await command('inventory.correct', {
        id: moved.id,
        quantity: 1,
        reason: 'Error ficticio documentado',
      });
      check(
        corr.correction_of === moved.id && (await query('inventory')).products[0].stock === 1,
        'Correction linked to original',
      );
      await denied(
        () => command('inventory.correct', { id: moved.id, quantity: 1, reason: 'Otra vez' }),
        /rectificación/,
      );
    });
    let ownerAp, workerAp;
    await as(owner, async () => {
      const ap = {
        client_id: client.id,
        starts_at: '2026-10-12T15:00:00Z',
        ends_at: '2026-10-12T16:00:00Z',
        service_ids: [general.id],
      };
      ownerAp = await command('appointment.save', { ...ap, professional_id: owner });
      workerAp = await command('appointment.save', { ...ap, professional_id: worker });
      await denied(
        () =>
          command('appointment.save', {
            ...ap,
            starts_at: '2026-10-12T15:30:00Z',
            professional_id: worker,
          }),
        /ya tiene/,
      );
      await command('appointment.save', {
        ...ap,
        starts_at: '2026-10-12T16:00:00Z',
        ends_at: '2026-10-12T17:00:00Z',
        professional_id: worker,
      });
    });
    await as(worker, async () => {
      const result = await query('appointments', { from: '2026-10-01', to: '2026-10-31' });
      check(
        result.items.length === 2 && result.items.every((a) => a.professional_id === worker),
        'Agenda assignment enforced',
      );
      check(
        (await query('appointments', { id: ownerAp.id, from: '2026-10-01', to: '2026-10-31' }))
          .items.length === 0,
        'Foreign appointment direct query empty',
      );
      await denied(
        () => command('appointment.start', { id: ownerAp.id, version: ownerAp.version }),
        /autorizada/,
      );
      const a = await command('appointment.start', { id: workerAp.id, version: workerAp.version });
      const b = await command('appointment.start', { id: workerAp.id, version: workerAp.version });
      check(
        a.visit_id === b.visit_id,
        'Appointment starts unique visit despite new retry operation',
      );
    });
    await as(owner, async () => {
      const pending = await query('visit', { id: ownVisit.id });
      await command('visit.save', {
        id: ownVisit.id,
        version: pending.visit.version,
        professional_id: worker,
        reason: 'Reasignación ficticia',
      });
      const data = await query('finance', financeRange);
      check(data.totals.collected === 245000, 'Finance counts each valid payment once');
      const p = data.payments.find((p) => p.amount === 100000);
      await command('payment.correct', {
        id: p.id,
        amount: 90000,
        method_id: method.id,
        paid_at: p.paid_at,
        reason: 'Error digitación ficticio',
      });
      const corrected = await query('finance', financeRange);
      check(
        corrected.totals.collected === 235000 && corrected.totals.balance === 70000,
        'Rectification excludes original once; two other known unpaid 30,000 charges remain',
      );
      const open = await command('cash.open', { opening_amount: 10000 });
      await command('cash.move', {
        session_id: open.id,
        kind: 'contribution',
        amount: 3000,
        reason: 'Aporte ficticio',
      });
      const state = (await query('finance', financeRange)).cash_sessions.find(
        (c) => c.id === open.id,
      );
      const closed = await command('cash.close', {
        id: state.id,
        version: state.version,
        counted_amount: 13000,
      });
      check(closed.difference === 0, 'Cash contribution separate and reconciled');
    });
    // Calendar helpers are private, exercised as database owner with deterministic dates.
    for (const [date, target] of [
      ['2026-09-30', '2026-10-01'],
      ['2026-12-31', '2027-01-01'],
      ['2024-02-29', '2024-03-01'],
      ['2025-02-28', '2025-03-01'],
    ]) {
      const r = (
        await db.query('select ita_private.birthdays($1::date,$1::date,$1::date) result', [date])
      ).rows[0].result;
      check(r.notice.target_month === target, `Month boundary ${date}`);
    }
    const leap = (
      await db.query(`select ita_private.birthday_events('2025-02-01','2025-02-28') result`)
    ).rows[0].result;
    check(
      leap[0].date === '2025-02-28' && leap[0].birth_day === 29,
      'Leap birthday observed without changing birth date',
    );
    await as(worker, async () => {
      const b = await query('birthdays');
      await command('birthday.seen', { target_month: b.notice.target_month });
      check((await query('birthdays')).notice === null, 'Seen notice persistent per user');
    });
    await as(owner, async () =>
      check((await query('birthdays')).notice !== null, 'Seen notice not global'),
    );
    const rls = (
      await db.query(
        `select bool_and(relrowsecurity) ok from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='ita_private' and c.relkind='r'`,
      )
    ).rows[0].ok;
    check(rls, 'All tables have RLS');
    checks += await (
      await import('./db-integrity.mjs')
    ).verifyIntegrity(db, { owner, worker, client, cat, general, color, product, method });
    checks += await (await import('./db-export.mjs')).verifyExports(db, { owner, worker, color });
    if (db.connect)
      checks += await (
        await import('./db-concurrency.mjs')
      ).verifyConcurrency(db, { owner, worker, client, general, product, method });
    console.log(
      `PASS: ${checks} integration checks (${db.engine ?? 'PGlite PostgreSQL'}). HTTP Supabase Auth still requires hosted verification.`,
    );
  } finally {
    await db.close();
  }
}
if (
  import.meta.url === new URL(process.argv[1], 'file:').href ||
  process.argv[1]?.replaceAll('\\', '/').endsWith('/db-test.mjs')
)
  run().catch((error) => {
    console.error(error.message, error.code ?? '', error.where ?? '');
    process.exitCode = 1;
  });
