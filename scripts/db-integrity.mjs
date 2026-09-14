import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

/** Regression checks for authorization and ledger/state bypasses via direct SQL RPC. */
export async function verifyIntegrity(db, fixture) {
  const { owner, worker, client, cat, general, color, product, method } = fixture;
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
  let visit, colorRecord, firstOperation, savedPayload;
  await as(worker, async () => {
    visit = await cmd('visit.create', { client_id: client.id, service_ids: [color.id, color.id] });
    let detail = await get('visit', { id: visit.id });
    const [one, two] = detail.services;
    await denied(
      () => cmd('visit.save', { id: visit.id, version: detail.visit.version, status: 'completed' }),
      /Usa las acciones/,
    );
    await denied(
      () => cmd('visit.save', { id: visit.id, version: detail.visit.version, status: 'void' }),
      /Usa las acciones/,
    );
    await denied(
      () =>
        cmd('visit.save', {
          id: visit.id,
          version: detail.visit.version,
          starts_at: '2099-01-01T12:00:00Z',
        }),
      /reserva futura/,
    );
    await denied(
      () =>
        cmd('service_record.save', {
          id: one.id,
          version: one.version,
          technical: { kind: 'color', schemaVersion: 1 },
        }),
      /inválidas/,
    );
    const technical = {
      ...one.technical,
      procedure: 'Trabajo ficticio\nSin tintura aplicada',
      saleDisposition: 'none',
      decolorants: { none: true, items: [] },
      oxidants: { none: true, items: [] },
      tints: { none: true, items: [] },
      finalizers: { none: true, items: [] },
      map: {
        ...one.technical.map,
        zones: { z01: { pattern: 'zigzag', patternVersion: 1, colorText: 'Fórmula libre' } },
      },
    };
    for (const pattern of ['zigzag', 'straight', 'diagonal-zigzag', 'diagonal-straight']) {
      const current = (await get('visit', { id: visit.id })).services.find((s) => s.id === one.id);
      technical.map.zones.z01.pattern = pattern;
      await cmd('service_record.save', { id: one.id, version: current.version, technical });
      check(
        (await get('visit', { id: visit.id })).services.find((s) => s.id === one.id).technical.map
          .zones.z01.pattern,
        pattern,
        'Each of four patterns survives serialization',
      );
    }
    const current = (await get('visit', { id: visit.id })).services.find((s) => s.id === one.id);
    await denied(
      () =>
        cmd('service_record.save', {
          id: one.id,
          version: current.version,
          technical: {
            ...technical,
            map: {
              ...technical.map,
              zones: { z01: { pattern: 'palette', patternVersion: 1, colorText: '#f00' } },
            },
          },
        }),
      /Zona:/,
    );
    await denied(
      () =>
        cmd('service_record.save', {
          id: one.id,
          version: current.version,
          technical: {
            ...technical,
            map: {
              ...technical.map,
              zones: { z01: { pattern: 'straight', patternVersion: 1, colorText: 123 } },
            },
          },
        }),
      /Zona:/,
    );
    colorRecord = await cmd('service_record.save', {
      id: one.id,
      version: current.version,
      technical,
      status: 'completed',
    });
    check(colorRecord.price, null, 'Technical completion can precede valuation');
    firstOperation = randomUUID();
    savedPayload = {
      id: one.id,
      version: colorRecord.version,
      technical,
      price: 200000,
      status: 'completed',
    };
    colorRecord = await cmd('service_record.save', savedPayload, firstOperation);
    check(
      colorRecord.price,
      200000,
      'Worker assigns first own price after technical completion, without correction reason',
    );
    detail = await get('visit', { id: visit.id });
    check(
      detail.services.find((s) => s.id === two.id).technical.map.zones,
      {},
      'Second Color record is independent',
    );
    await denied(
      () =>
        cmd('service_record.save', {
          id: one.id,
          version: colorRecord.version,
          technical,
          price: 150000,
        }),
      /rectificación/,
    );
    await denied(
      () =>
        cmd('charge.correct', {
          id: one.id,
          version: colorRecord.version,
          price: 150000,
          reason: 'Intento',
        }),
      /dueña/,
    );
    await denied(
      () =>
        cmd('payment.record', {
          account_id: visit.account_id,
          amount: 1,
          method_id: method.id,
          paid_at: new Date().toISOString(),
        }),
      /Antes de cobrar/,
    );
    check(
      (await get('settings')).payment_methods.some((m) => m.id === method.id),
      true,
      'Worker receives active payment methods',
    );
    check((await get('settings')).backup, null, 'Worker receives no backup details');
  });
  await as(owner, async () => {
    const appointmentPayload = {
      client_id: client.id,
      professional_id: owner,
      starts_at: '2028-08-11T15:00:00Z',
      ends_at: '2028-08-11T16:00:00Z',
      service_ids: [general.id],
    };
    const appointment = await cmd('appointment.save', appointmentPayload);
    const linked = await cmd('appointment.start', appointment);
    let storedAppointment = (
      await get('appointments', { id: appointment.id, from: '2028-08-11', to: '2028-08-11' })
    ).items[0];
    await denied(
      () =>
        cmd('appointment.save', {
          ...appointmentPayload,
          id: appointment.id,
          version: storedAppointment.version,
          status: 'scheduled',
        }),
      /visita vinculada/,
    );
    await cmd('visit.void', {
      id: linked.id,
      version: linked.version,
      reason: 'Inicio accidental ficticio',
    });
    storedAppointment = (
      await get('appointments', { id: appointment.id, from: '2028-08-11', to: '2028-08-11' })
    ).items[0];
    check(
      storedAppointment.status,
      'cancelled',
      'Voiding an erroneous visit cancels its appointment without reopening it',
    );
    check(
      (await cmd('appointment.start', storedAppointment)).visit_id,
      linked.id,
      'A repeated start retains the original void visit; never duplicates it',
    );
    await denied(
      () =>
        cmd('appointment.save', {
          ...appointmentPayload,
          id: appointment.id,
          version: storedAppointment.version,
          status: 'confirmed',
        }),
      /visita vinculada/,
    );
    await denied(
      () =>
        cmd('charge.correct', {
          id: colorRecord.id,
          version: colorRecord.version,
          price: null,
          reason: 'Error ficticio',
        }),
      /positivo/,
    );
    const detail = await get('visit', { id: visit.id });
    await cmd('visit.save', {
      id: visit.id,
      version: detail.visit.version,
      professional_id: owner,
      reason: 'Cambio de responsable ficticio',
    });
    const config = (await get('settings')).settings;
    await denied(
      () => cmd('settings.save', { ...config, prevent_overlap: false }),
      /regla confirmada/,
    );
    await cmd('service.save', { ...general, fixed_price: 45000 });
    const newVisit = await cmd('visit.create', { client_id: client.id, service_ids: [general.id] });
    check(
      (await get('visit', { id: newVisit.id })).services[0].price,
      45000,
      'New selection receives current tariff',
    );
    const oldVisit = (await get('client', { id: client.id, limit: 200 })).history
      .flatMap((v) => v.services)
      .find((s) => s.service_id === general.id && s.name === general.name);
    check(
      oldVisit.reference_price,
      undefined,
      'Shared history never serializes financial reference',
    );
    const child = await cmd('category.save', {
      kind: 'service',
      name: 'Método ficticio',
      parent_id: cat.id,
    });
    await denied(() => cmd('category.save', { ...cat, parent_id: child.id }), /ciclos/);
    await denied(() => cmd('category.archive', cat), /elementos activos/);
    const zoneA = await cmd('service.save', {
      category_id: child.id,
      name: 'Cejas ficticias',
      form_type: 'general',
      price_mode: 'fixed',
      fixed_price: 10000,
    });
    const zoneB = await cmd('service.save', {
      category_id: child.id,
      name: 'Bozo ficticio',
      form_type: 'general',
      price_mode: 'fixed',
      fixed_price: 12000,
    });
    let batch = await cmd('visit.create', { client_id: client.id });
    const group = randomUUID();
    const operation = randomUUID();
    const payload = {
      visit_id: batch.id,
      version: batch.version,
      service_ids: [zoneA.id, zoneB.id],
      group_id: group,
      technical: {
        kind: 'general',
        schemaVersion: 1,
        notes: 'Dato común',
        materials: { none: true, items: [] },
      },
    };
    await cmd('service.add', payload, operation);
    await cmd('service.add', payload, operation);
    let b = await get('visit', { id: batch.id });
    check(
      b.services.map((s) => s.group_id),
      [group, group],
      'Batch retry retains exactly two charges',
    );
    check(b.account.total, 22000, 'No grouping fee');
    await denied(
      () =>
        cmd('service.add', {
          ...payload,
          version: b.visit.version,
          service_ids: [general.id],
          group_id: group,
        }),
      /otra visita o método/,
    );
    batch = await cmd('visit.create', { client_id: client.id, service_ids: [general.id] });
    b = await get('visit', { id: batch.id });
    await cmd('service_record.save', {
      id: b.services[0].id,
      version: b.services[0].version,
      technical: b.services[0].technical,
      status: 'completed',
    });
    await denied(
      () =>
        cmd('payment.record', {
          account_id: batch.account_id,
          amount: 100,
          method_id: method.id,
          paid_at: '2020-01-01T12:00:00Z',
        }),
      /anticipos/,
    );
    await cmd('payment.record', {
      account_id: batch.account_id,
      amount: 100,
      method_id: method.id,
      paid_at: new Date().toISOString(),
    });
    b = await get('visit', { id: batch.id });
    await denied(
      () =>
        cmd('service.add', {
          visit_id: batch.id,
          version: b.visit.version,
          service_ids: [color.id],
        }),
      /cuenta ya cobrada/,
    );
    check(
      (await get('visit', { id: batch.id })).services.length,
      1,
      'Failed addition rolls back entirely',
    );
    const purchase = await cmd('inventory.move', {
      product_id: product.id,
      quantity: 1,
      kind: 'purchase',
      reason: 'Compra ficticia',
    });
    const expenseData = {
      concept: 'Compra ficticia',
      category: 'Productos',
      amount: 7000,
      method_id: method.id,
      paid_at: new Date().toISOString(),
      stock_movement_id: purchase.id,
    };
    const expense = await cmd('expense.save', expenseData);
    await denied(() => cmd('expense.save', expenseData), /unique constraint/);
    const corrected = await cmd('expense.correct', {
      ...expenseData,
      id: expense.id,
      amount: 6500,
      reason: 'Error de digitación ficticio',
    });
    check(corrected.stock_movement_id, purchase.id, 'Expense correction retains purchase linkage');
    await denied(() => cmd('expense.save', expenseData), /unique constraint/);
    const duplicate = await cmd('client.save', {
      name: 'Clienta ficticia',
      phone: '+57 300 123 4567',
    });
    check(
      (await get('client', { id: duplicate.id })).duplicates.some((c) => c.id === client.id),
      true,
      'Duplicate name warning without blocking registration',
    );
    const archived = await cmd('client.save', {
      ...duplicate,
      active: false,
      birth_day: 12,
      birth_month: 9,
    });
    check(
      (await get('clients', { search: '+57 300 123 4567' })).total,
      0,
      'Archived client excluded by default',
    );
    check(
      (await get('clients', { search: '+57 300 123 4567', include_archived: true })).items[0].id,
      archived.id,
      'Owner can find archived client',
    );
    check(
      (await get('birthdays', { from: '2026-09-01', to: '2026-09-30' })).events.some(
        (c) => c.id === archived.id,
      ),
      false,
      'Archiving updates birthday projection',
    );
    await denied(
      () => cmd('client.save', { name: 'Sin mes', birth_year: 2000 }),
      /check constraint/,
    );
    await db.exec('reset role');
    await db.exec(
      "insert into ita_private.backup_status(run_key,status,message,started_at) values('stuck-old','running','RUNNING','2000-01-01'); insert into ita_private.backup_status(run_key,status,completed_at,message) values('new-success','success',now(),'OK');",
    );
    await db.exec('set role authenticated');
    check(
      (await get('settings')).backup.run_key,
      'new-success',
      'Old cancelled running backup cannot hide newer success',
    );
    const paidVisit = await cmd('visit.create', {
      client_id: client.id,
      service_ids: [color.id, general.id],
    });
    const paidDetail = await get('visit', { id: paidVisit.id });
    for (const line of paidDetail.services) {
      const technical =
        line.form_type === 'color'
          ? {
              ...line.technical,
              procedure: 'Servicio de prueba en fecha anterior',
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
        ...(line.form_type === 'color' ? { price: 200000 } : {}),
        status: 'completed',
      });
    }
    // Deterministic fictional past work: moving clock data is fixture setup as
    // database owner, never available to an API user.
    await db.exec('reset role');
    await db.query(
      "update ita_private.accounts set created_at=now()-interval '2 days' where id=$1",
      [paidVisit.account_id],
    );
    await db.query(
      "update ita_private.visit_services set completed_at=now()-interval '2 days' where visit_id=$1",
      [paidVisit.id],
    );
    const clock = (
      await db.query(
        "select to_jsonb(now()-interval '1 day') yesterday, to_jsonb(now()) today, (now() at time zone 'America/Bogota')::date::text current_date, ((now()-interval '1 day') at time zone 'America/Bogota')::date::text prior_date",
      )
    ).rows[0];
    await db.exec('set role authenticated');
    const originalPrice = (await get('visit', { id: paidVisit.id })).account.total;
    await cmd('payment.record', {
      account_id: paidVisit.account_id,
      amount: 100000,
      method_id: method.id,
      paid_at: clock.yesterday,
    });
    check(
      (await get('visit', { id: paidVisit.id })).account.balance,
      originalPrice - 100000,
      'First payment dated yesterday leaves exact COP balance',
    );
    await cmd('payment.record', {
      account_id: paidVisit.account_id,
      amount: originalPrice - 100000,
      method_id: method.id,
      paid_at: clock.today,
    });
    const prior = await get('finance', { from: clock.prior_date, to: clock.prior_date });
    check(
      prior.payments.filter((p) => p.account_id === paidVisit.account_id).map((p) => p.amount),
      [100000],
      'First payment appears only on yesterday in Bogota',
    );
    const current = await get('finance', { from: clock.current_date, to: clock.current_date });
    check(
      current.payments.filter((p) => p.account_id === paidVisit.account_id).map((p) => p.amount),
      [originalPrice - 100000],
      'Remainder appears on its own actual date',
    );
  });
  await as(worker, async () => {
    await denied(() => get('visit', { id: visit.id }), /sin acceso/);
    await denied(() => cmd('service_record.save', savedPayload, firstOperation), /ya no pertenece/);
    await denied(() => get('operation', { operation_id: firstOperation }), /ya no pertenece/);
    await denied(() => get('appointments', { from: '2026-01-01', to: '2099-01-01' }), /371 días/);
  });
  await db.exec('set role anon');
  await denied(() => db.query("select public.app_query('bootstrap','{}')"), /permission denied/);
  await denied(
    () => db.query("select public.app_command('client.save','{}',gen_random_uuid())"),
    /permission denied/,
  );
  await db.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    const privileges = await db.query(
      "select bool_and(not has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) denied from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='ita_private' and c.relkind='r'",
      [role],
    );
    check(privileges.rows[0].denied, true, `${role} has no direct privilege on any business table`);
  }
  const wrappers = await db.query(
    "select bool_and(not prosecdef) invoker from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('app_query','app_command')",
  );
  check(wrappers.rows[0].invoker, true, 'Both exposed wrappers run with invoker privileges');
  const routines = await db.query(
    "select jsonb_agg(p.proname order by p.proname) callable from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='ita_private' and has_function_privilege('authenticated',p.oid,'EXECUTE')",
  );
  check(
    routines.rows[0].callable,
    ['command', 'query'],
    'Only the two authorized dispatchers are callable inside the private schema',
  );
  return checks;
}
