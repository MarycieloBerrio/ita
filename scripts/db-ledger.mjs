import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** Cash closings, payment reversal, charge and stock corrections, and account lifecycle. */
export async function verifyLedger(db, fixture) {
  const { owner, worker, client, general, color, product, method } = fixture;
  let checks = 0;
  const check = (actual, expected, message) => {
    assert.deepEqual(actual, expected, message);
    checks++;
  };
  const denied = async (fn, pattern) => {
    await assert.rejects(fn, pattern);
    checks++;
  };
  const cmd = (action, payload, key = randomUUID()) =>
    db
      .query('select public.app_command($1,$2::jsonb,$3) result', [
        action,
        JSON.stringify(payload),
        key,
      ])
      .then((r) => r.rows[0].result);
  const get = (action, payload = {}) =>
    db
      .query('select public.app_query($1,$2::jsonb) result', [action, JSON.stringify(payload)])
      .then((r) => r.rows[0].result);
  async function as(user, fn) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.exec('set role authenticated');
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
    }
  }
  // Finance range from the database clock in Bogota, never the test runner's UTC date.
  const today = (await db.query("select (now() at time zone 'America/Bogota')::date::text d"))
    .rows[0].d;
  const range = { from: today, to: today };
  // Timestamps come from the database clock too: a container clock may differ from the host.
  const now = async () => (await db.query('select clock_timestamp()::text t')).rows[0].t;
  const session = async (id) =>
    (await get('finance', range)).cash_sessions.find((item) => item.id === id);
  async function completedVisit(serviceId, price) {
    const created = await cmd('visit.create', { client_id: client.id, service_ids: [serviceId] });
    let detail = await get('visit', { id: created.id });
    const line = detail.services[0];
    const technical =
      line.form_type === 'color'
        ? {
            ...line.technical,
            procedure: 'Procedimiento ficticio',
            saleDisposition: 'none',
            decolorants: { none: true, items: [] },
            oxidants: { none: true, items: [] },
            tints: { none: true, items: [] },
            finalizers: { none: true, items: [] },
          }
        : line.technical;
    await cmd('service_record.save', {
      id: line.id,
      version: line.version,
      technical,
      ...(price ? { price } : {}),
      status: 'completed',
    });
    detail = await get('visit', { id: created.id });
    return detail;
  }

  let voidable;
  await as(owner, async () => {
    const transfer = await cmd('payment_method.save', {
      name: 'Transferencia ficticia',
      is_cash: false,
    });
    // --- Cash closings are frozen snapshots ---------------------------------
    const first = await completedVisit(general.id);
    const open = await cmd('cash.open', { opening_amount: 5000 });
    const cashPayment = await cmd('payment.record', {
      account_id: first.account.id,
      amount: 10000,
      method_id: method.id,
      paid_at: await now(),
    });
    check((await session(open.id)).expected_amount, 15000, 'Open session expected is live');
    await denied(
      () =>
        cmd('cash.move', {
          session_id: open.id,
          kind: 'withdrawal',
          amount: 15001,
          reason: 'Retiro excesivo',
        }),
      /supera el efectivo esperado/,
    );
    const moved = await cmd('cash.move', {
      session_id: open.id,
      kind: 'withdrawal',
      amount: 1000,
      reason: 'Retiro ficticio',
    });
    check(moved.expected_amount, 14000, 'Withdrawal within expected cash accepted');
    const closed = await cmd('cash.close', {
      id: open.id,
      version: moved.version,
      counted_amount: 13500,
    });
    check(
      [closed.expected_amount, closed.difference, closed.cash_payments, closed.movements_net],
      [14000, -500, 10000, -1000],
      'Closing stores expected amount and components',
    );
    await denied(
      () =>
        cmd('payment.record', {
          account_id: first.account.id,
          amount: 1000,
          method_id: method.id,
          paid_at: cashPayment.paid_at,
        }),
      /caja ya cerrada/,
    );
    await denied(
      () =>
        cmd('expense.save', {
          concept: 'Egreso retroactivo',
          category: 'General',
          amount: 500,
          method_id: method.id,
          paid_at: cashPayment.paid_at,
        }),
      /caja ya cerrada/,
    );
    const transferPayment = await cmd('payment.record', {
      account_id: first.account.id,
      amount: 2000,
      method_id: transfer.id,
      paid_at: cashPayment.paid_at,
    });
    check(transferPayment.is_cash, false, 'Non-cash payment may be dated inside a closed window');
    await cmd('expense.save', {
      concept: 'Egreso posterior al cierre',
      category: 'General',
      amount: 700,
      method_id: method.id,
      paid_at: new Date(Date.parse(closed.closed_at) + 2).toISOString(),
    });
    await denied(
      () =>
        cmd('payment.correct', {
          id: transferPayment.id,
          amount: 2000,
          method_id: method.id,
          paid_at: transferPayment.paid_at,
          reason: 'Convertir a efectivo en caja cerrada',
        }),
      /caja ya cerrada/,
    );
    const restated = await cmd('payment.correct', {
      id: cashPayment.id,
      amount: 9000,
      method_id: method.id,
      paid_at: cashPayment.paid_at,
      reason: 'Importe digitado por error',
    });
    check(restated.correction_of, cashPayment.id, 'Cash row restated within its closed session');
    await db.exec('reset role');
    await db.query(
      "insert into ita_private.expenses(concept,category,amount,paid_at,method_id,method_name,is_cash,created_by) values('Directo','General',999,$1,$2,'x',true,$3)",
      [cashPayment.paid_at, method.id, owner],
    );
    await db.exec('set role authenticated');
    let frozen = await session(open.id);
    check(
      [frozen.expected_amount, frozen.difference],
      [14000, -500],
      'Closed session never recomputes from later records',
    );
    await db.exec('reset role');
    await db.query("delete from ita_private.expenses where concept='Directo'");
    await db.exec('set role authenticated');

    // --- Full payment reversal ----------------------------------------------
    await denied(() => cmd('payment.void', { id: restated.id, reason: ' ' }), /motivo/);
    const voided = await cmd('payment.void', { id: restated.id, reason: 'Cobro inexistente' });
    check(
      [voided.corrected_by, voided.void_reason, voided.voided_at !== null],
      [restated.id, 'Cobro inexistente', true],
      'Void marks the payment itself as corrected without replacement',
    );
    await denied(
      () => cmd('payment.void', { id: restated.id, reason: 'Otra vez' }),
      /rectificado o anulado/,
    );
    await denied(
      () =>
        cmd('payment.correct', {
          id: restated.id,
          amount: 1000,
          method_id: method.id,
          paid_at: restated.paid_at,
          reason: 'Tras anular',
        }),
      /ya fue rectificado/,
    );
    check(
      (await get('visit', { id: first.visit.id })).account.paid,
      2000,
      'Voided payment leaves the account ledger',
    );
    frozen = await session(open.id);
    check(frozen.expected_amount, 14000, 'Void does not alter a signed-off closing');

    voidable = await completedVisit(general.id);
    const full = await cmd('payment.record', {
      account_id: voidable.account.id,
      amount: voidable.account.total,
      method_id: transfer.id,
      paid_at: await now(),
    });
    let detail = await get('visit', { id: voidable.visit.id });
    await denied(
      () =>
        cmd('visit.void', {
          id: voidable.visit.id,
          version: detail.visit.version,
          reason: 'Visita duplicada',
        }),
      /pagos confirmados/,
    );
    await cmd('payment.void', { id: full.id, reason: 'Visita duplicada' });
    detail = await get('visit', { id: voidable.visit.id });
    await cmd('visit.void', {
      id: voidable.visit.id,
      version: detail.visit.version,
      reason: 'Visita duplicada',
    });
    check(
      (await get('visit', { id: voidable.visit.id })).visit.status,
      'void',
      'Fully reversed visit can be voided',
    );

    // --- Owner price rectification of completed work --------------------------
    const valued = await completedVisit(color.id, 100000);
    let line = valued.services[0];
    await cmd('charge.correct', {
      id: line.id,
      version: line.version,
      price: 120000,
      reason: 'Precio acordado distinto',
    });
    detail = await get('visit', { id: valued.visit.id });
    check(detail.account.total, 120000, 'Charge correction updates the account total');
    await cmd('payment.record', {
      account_id: valued.account.id,
      amount: 110000,
      method_id: transfer.id,
      paid_at: await now(),
    });
    line = detail.services[0];
    await denied(
      () =>
        cmd('charge.correct', {
          id: line.id,
          version: line.version,
          price: 100000,
          reason: 'Rebaja',
        }),
      /pagos existentes/,
    );

    // --- Stock corrections ----------------------------------------------------
    const saleMovement = (await get('inventory', { limit: 200 })).movements.find(
      (m) => m.kind === 'sale',
    );
    await denied(
      () => cmd('inventory.correct', { id: saleMovement.id, quantity: 1, reason: 'Devolver' }),
      /venta confirmada/,
    );
    const supply = await cmd('product.save', {
      name: 'Insumo archivable ficticio',
      category_id: product.category_id,
      usage: 'internal',
      cost: 1000,
    });
    await cmd('inventory.move', {
      product_id: supply.id,
      quantity: 2,
      kind: 'initial',
      reason: 'Conteo ficticio',
    });
    const used = await cmd('inventory.move', {
      product_id: supply.id,
      quantity: -2,
      kind: 'consumption',
      reason: 'Uso ficticio',
    });
    await cmd('product.archive', { id: supply.id, version: supply.version });
    const fixed = await cmd('inventory.correct', {
      id: used.id,
      quantity: 1,
      reason: 'Solo se usó una unidad',
    });
    check(fixed.correction_of, used.id, 'Archived product accepts a correction');
    await denied(
      () =>
        cmd('inventory.move', {
          product_id: supply.id,
          quantity: 1,
          kind: 'purchase',
          reason: 'Nueva compra',
        }),
      /archivado/,
    );

    // --- The owner cannot lock herself out -----------------------------------
    const self = (await get('settings')).profiles.find((p) => p.id === owner);
    for (const change of [
      { role: 'worker', active: true },
      { role: 'owner', active: false },
    ])
      await denied(
        () =>
          cmd('profile.save', {
            id: owner,
            version: self.version,
            display_name: self.display_name,
            ...change,
          }),
        /propio acceso/,
      );
  });
  await as(worker, () =>
    denied(() => cmd('payment.void', { id: randomUUID(), reason: 'Intento' }), /dueña/),
  );

  // --- A deactivated worker loses API access immediately --------------------
  const leaver = randomUUID();
  await db.query('insert into auth.users(id) values($1)', [leaver]);
  await db.query(
    "insert into ita_private.profiles(id,display_name,role) values($1,'Trabajadora saliente','worker')",
    [leaver],
  );
  const key = randomUUID();
  const payload = { client_id: client.id };
  await as(leaver, async () => {
    const own = await cmd('visit.create', payload, key);
    check(own.id !== undefined, true, 'Active worker can operate');
  });
  await as(owner, () =>
    cmd('profile.save', {
      id: leaver,
      version: 1,
      display_name: 'Trabajadora saliente',
      role: 'worker',
      active: false,
    }),
  );
  await as(leaver, async () => {
    await denied(() => get('bootstrap'), /inactiva/);
    await denied(() => get('visits'), /inactiva/);
    await denied(() => cmd('visit.create', payload), /inactiva/);
    await denied(() => cmd('visit.create', payload, key), /inactiva/);
  });
  return checks;
}
