import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function verifyConcurrency(db, fixture) {
  const { owner, worker, client, general, product, method } = fixture;
  const a = await db.connect(owner);
  const b = await db.connect(owner);
  const w = await db.connect(worker);
  const cmd = (connection, action, payload, key = randomUUID()) =>
    connection
      .query('select public.app_command($1,$2::jsonb,$3) result', [
        action,
        JSON.stringify(payload),
        key,
      ])
      .then((r) => r.rows[0].result);
  const get = (connection, action, payload = {}) =>
    connection
      .query('select public.app_query($1,$2::jsonb) result', [action, JSON.stringify(payload)])
      .then((r) => r.rows[0].result);
  let checks = 0;
  // Payment dates use the database clock: a container clock may run ahead of the host.
  const dbNow = async () => (await db.query('select clock_timestamp()::text t')).rows[0].t;
  const pid = async (connection) =>
    (await connection.query('select pg_backend_pid() pid')).rows[0].pid;
  const contenders = [await pid(b), await pid(w)];
  // Observe the lock wait in PostgreSQL itself instead of trusting a fixed sleep.
  async function waitsForLock() {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const { rows } = await db.query(
        'select count(*)::int n from pg_locks where not granted and pid = any($1::int[])',
        [contenders],
      );
      if (rows[0].n > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return false;
  }

  // First transaction holds the authoritative row/advisory lock. The second
  // request has entered PostgreSQL before releasing the first transaction.
  async function race(first, second, rejection) {
    await a.query('begin');
    await first();
    let settled = false;
    const contender = second()
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      )
      .finally(() => {
        settled = true;
      });
    assert.equal(await waitsForLock(), true, 'The concurrent operation waits on a database lock');
    assert.equal(settled, false, 'The concurrent operation waits for the first transaction');
    checks++;
    await a.query('commit');
    const outcome = await contender;
    if (rejection) {
      assert.match(outcome.error?.message ?? '', rejection);
      checks++;
    } else {
      assert.equal(outcome.error, undefined);
      checks++;
    }
    return outcome.value;
  }

  let stock = (await get(a, 'inventory')).products.find((p) => p.id === product.id).stock;
  if (stock !== 1)
    await cmd(a, 'inventory.move', {
      product_id: product.id,
      quantity: 1 - stock,
      kind: 'adjustment',
      reason: 'Preparación ficticia carrera',
    });
  const accountA = await cmd(a, 'account.create', {});
  const accountB = await cmd(b, 'account.create', {});
  const saleA = await cmd(a, 'sale.save', {
    account_id: accountA.id,
    product_id: product.id,
    quantity: 1,
  });
  const saleB = await cmd(b, 'sale.save', {
    account_id: accountB.id,
    product_id: product.id,
    quantity: 1,
  });
  await race(
    () => cmd(a, 'sale.confirm', saleA),
    () => cmd(b, 'sale.confirm', saleB),
    /unidades suficientes/,
  );
  assert.equal((await get(a, 'inventory')).products.find((p) => p.id === product.id).stock, 0);
  checks++;
  assert.equal((await get(b, 'account', { id: accountB.id })).sales[0].status, 'draft');
  checks++;

  await cmd(a, 'inventory.move', {
    product_id: product.id,
    quantity: 1,
    kind: 'purchase',
    reason: 'Nueva unidad ficticia',
  });
  await race(
    () =>
      cmd(a, 'inventory.move', {
        product_id: product.id,
        quantity: -1,
        kind: 'consumption',
        reason: 'Uso ficticio concurrente',
      }),
    () => cmd(b, 'sale.confirm', saleB),
    /unidades suficientes/,
  );
  assert.equal((await get(a, 'inventory')).products.find((p) => p.id === product.id).stock, 0);
  checks++;

  const payment = {
    account_id: accountA.id,
    amount: 15000,
    method_id: method.id,
    paid_at: await dbNow(),
  };
  await race(
    () => cmd(a, 'payment.record', payment),
    () => cmd(b, 'payment.record', payment),
    /superar el saldo/,
  );
  assert.equal((await get(a, 'account', { id: accountA.id })).account.balance, 0);
  checks++;

  await cmd(a, 'inventory.move', {
    product_id: product.id,
    quantity: 1,
    kind: 'purchase',
    reason: 'Prueba reintento ficticio',
  });
  const key = randomUUID();
  const payload = {
    product_id: product.id,
    quantity: -1,
    kind: 'consumption',
    reason: 'Una misma operación de dos sesiones',
  };
  let first;
  const replay = await race(
    async () => {
      first = await cmd(a, 'inventory.move', payload, key);
    },
    () => cmd(b, 'inventory.move', payload, key),
  );
  assert.equal(replay.id, first.id);
  checks++;

  const ap = {
    client_id: client.id,
    professional_id: worker,
    starts_at: '2027-03-15T15:00:00Z',
    ends_at: '2027-03-15T16:00:00Z',
    service_ids: [general.id],
  };
  await race(
    () => cmd(a, 'appointment.save', ap),
    () => cmd(w, 'appointment.save', { ...ap, starts_at: '2027-03-15T15:30:00Z' }),
    /ya tiene una cita/,
  );
  const independent = await cmd(b, 'appointment.save', { ...ap, professional_id: owner });
  assert.ok(independent.id);
  checks++;

  const v = await cmd(a, 'visit.create', { client_id: client.id, service_ids: [general.id] });
  await race(
    () => cmd(a, 'visit.save', { id: v.id, version: v.version, notes: 'Primera sesión' }),
    () => cmd(b, 'visit.save', { id: v.id, version: v.version, notes: 'Segunda sesión obsoleta' }),
    /Otra sesión/,
  );
  assert.equal((await get(a, 'visit', { id: v.id })).visit.notes, 'Primera sesión');
  checks++;

  const left = await cmd(a, 'visit.create', { client_id: client.id });
  const right = await cmd(w, 'visit.create', { client_id: client.id });
  await a.query('begin');
  await cmd(a, 'visit.save', { id: left.id, version: left.version, notes: 'Dueña trabajando' });
  const other = await cmd(w, 'visit.save', {
    id: right.id,
    version: right.version,
    notes: 'Trabajadora independiente',
  });
  assert.ok(other.id, 'Different visits do not block across sessions');
  checks++;
  await a.query('commit');
  await cmd(a, 'inventory.move', {
    product_id: product.id,
    quantity: 1,
    kind: 'purchase',
    reason: 'Verificar caja concurrente',
  });
  const cashAccount = await cmd(a, 'account.create', {});
  const cashSale = await cmd(a, 'sale.save', {
    account_id: cashAccount.id,
    product_id: product.id,
    quantity: 1,
  });
  await cmd(a, 'sale.confirm', cashSale);
  const cash = await cmd(a, 'cash.open', { opening_amount: 10000 });
  const closed = await race(
    async () =>
      cmd(a, 'payment.record', {
        account_id: cashAccount.id,
        amount: 15000,
        method_id: method.id,
        paid_at: await dbNow(),
      }),
    () => cmd(b, 'cash.close', { id: cash.id, version: cash.version, counted_amount: 25000 }),
  );
  assert.equal(closed.expected_amount, 25000, 'Cash closing waits for the concurrent cash payment');
  checks++;
  assert.equal(closed.difference, 0);
  checks++;
  return checks;
}
