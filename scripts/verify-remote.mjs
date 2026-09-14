import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

// Explicit, manual pilot test. Administrative keys and passwords stay in memory.
// Never import this script from browser code or run it in CI against a live salon.
const project = 'mrnzvgivfjivuobpgens';
const cli = 'node_modules/supabase/dist/supabase.js';
function runCli(args) {
  return JSON.parse(
    execFileSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 8 * 1024 * 1024,
      timeout: 60000,
    }),
  );
}
function sql(statement) {
  return runCli(['db', 'query', '--linked', '--project-ref', project, statement]).rows;
}
let stage = 'preparación';
let lastAction = '';
function checkpoint(value) {
  stage = value;
  console.log(`Verificando: ${value}.`);
}
let admin;
const users = [];
const clients = [];
let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
};
const pass = (response) => {
  if (response.error) {
    const failure = new Error(response.error.message);
    failure.code = response.error.code;
    throw failure;
  }
  return response.data;
};
async function main() {
  if (!process.argv.includes('--pilot-approved'))
    throw new Error('Requiere autorización explícita y --pilot-approved.');
  stage = 'comprobación de separación de datos';
  const existing = sql(
    "select (select count(*) from ita_private.clients where name not like '[PRUEBA]%') + (select count(*) from ita_private.profiles where display_name not like '[PRUEBA]%') as real_records",
  )[0];
  check(
    Number(existing.real_records) === 0,
    'Se detuvo: existen perfiles o clientas ajenos al piloto.',
  );
  stage = 'credenciales administrativas en memoria';
  const keys = runCli([
    'projects',
    'api-keys',
    '--project-ref',
    project,
    '--reveal',
    '--output',
    'json',
  ]);
  const secret =
    keys.find((key) => key.type === 'secret')?.api_key ??
    keys.find((key) => key.name === 'service_role')?.api_key;
  const publishable = keys.find((key) => key.type === 'publishable')?.api_key;
  if (!secret || !publishable) throw new Error('Faltan las claves requeridas.');
  const makeClient = (key) =>
    createClient(`https://${project}.supabase.co`, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }),
      },
    });
  admin = makeClient(secret);
  const anonymous = makeClient(publishable);
  check(
    Boolean((await anonymous.rpc('app_query', { p_action: 'bootstrap', p_payload: {} })).error),
    'RPC anónimo denegado',
  );
  const tag = randomUUID().slice(0, 8);
  checkpoint('crear dos identidades ficticias');
  for (const role of ['owner', 'worker']) {
    const email = `ita-pilot-${role}-${tag}@example.invalid`;
    const password = randomBytes(32).toString('base64url');
    const user = pass(
      await admin.auth.admin.createUser({ email, password, email_confirm: true }),
    ).user;
    users.push({ id: user.id, email, password, role });
    // IDs and role are generated here, never derived from editable Auth metadata.
    sql(
      `insert into ita_private.profiles(id,display_name,role) values('${user.id}','[PRUEBA] ${role} ${tag}','${role}')`,
    );
    const client = makeClient(publishable);
    pass(await client.auth.signInWithPassword({ email, password }));
    clients.push(client);
  }
  const [owner, worker] = clients;
  const q = async (client, action, payload = {}) => {
    lastAction = action;
    return pass(await client.rpc('app_query', { p_action: action, p_payload: payload }));
  };
  const cmd = async (client, action, payload = {}, id = randomUUID()) => {
    lastAction = action;
    return pass(
      await client.rpc('app_command', { p_action: action, p_payload: payload, p_operation_id: id }),
    );
  };
  const denied = async (fn, message) => {
    await assert.rejects(fn);
    checks++;
    if (!message) throw new Error('Falta descripción');
  };
  checkpoint('permisos de perfiles por HTTP');
  check((await q(owner, 'bootstrap')).profile.role === 'owner', 'Perfil dueña');
  pass(await worker.auth.updateUser({ data: { role: 'owner', is_admin: true } }));
  check(
    (await q(worker, 'bootstrap')).profile.role === 'worker',
    'Metadatos no conceden autoridad',
  );
  await denied(() => q(worker, 'finance'), 'Finanzas denegadas');
  await denied(() => q(worker, 'audit'), 'Auditoría denegada');
  check(
    Boolean((await worker.schema('ita_private').from('clients').select('id')).error),
    'Tablas privadas inaccesibles',
  );
  checkpoint('visita múltiple y reconstrucción del plano');
  const person = await cmd(owner, 'client.save', {
    name: `[PRUEBA] Clienta ${tag}`,
    birth_day: 29,
    birth_month: 2,
  });
  const category = await cmd(owner, 'category.save', {
    kind: 'service',
    name: `[PRUEBA] Peluquería ${tag}`,
  });
  const color = await cmd(owner, 'service.save', {
    category_id: category.id,
    name: '[PRUEBA] Color',
    form_type: 'color',
    price_mode: 'custom',
    duration_minutes: 120,
  });
  const general = await cmd(owner, 'service.save', {
    category_id: category.id,
    name: '[PRUEBA] Cepillado',
    form_type: 'general',
    price_mode: 'fixed',
    fixed_price: 30000,
    duration_minutes: 30,
  });
  const method = await cmd(owner, 'payment_method.save', {
    name: `[PRUEBA] Efectivo ${tag}`,
    is_cash: true,
  });
  const visit = await cmd(worker, 'visit.create', {
    client_id: person.id,
    service_ids: [color.id, general.id],
  });
  const otherVisit = await cmd(owner, 'visit.create', { client_id: person.id });
  await denied(() => q(worker, 'visit', { id: otherVisit.id }), 'Visita ajena denegada');
  let detail = await q(worker, 'visit', { id: visit.id });
  check(
    detail.services.length === 2 &&
      detail.account.total === null &&
      detail.account.pending_prices === 1,
    'Visita múltiple sin falso cero',
  );
  await denied(
    () =>
      cmd(worker, 'payment.record', {
        account_id: visit.account_id,
        amount: 1000,
        method_id: method.id,
        paid_at: new Date().toISOString(),
      }),
    'Anticipo denegado',
  );
  const colorLine = detail.services.find((s) => s.form_type === 'color');
  const technical = {
    ...colorLine.technical,
    procedure: 'Procedimiento ficticio\ncon dos fases',
    saleDisposition: 'none',
    decolorants: { none: true, items: [] },
    oxidants: { none: true, items: [] },
    tints: { none: true, items: [] },
    finalizers: { none: true, items: [] },
    map: {
      templateId: 'ita-five-views',
      templateVersion: 1,
      zones: {
        z01: {
          pattern: 'diagonal-zigzag',
          patternVersion: 1,
          colorText: '8.31 + fórmula ficticia',
        },
      },
    },
  };
  const saved = await cmd(worker, 'service_record.save', {
    id: colorLine.id,
    version: colorLine.version,
    technical,
    price: null,
    status: 'completed',
  });
  await cmd(worker, 'service_record.save', {
    id: colorLine.id,
    version: saved.version,
    technical,
    price: 200000,
    status: 'completed',
  });
  await denied(
    () =>
      cmd(worker, 'service_record.save', {
        id: colorLine.id,
        version: colorLine.version,
        technical,
        price: 200000,
        status: 'completed',
      }),
    'Versión obsoleta denegada',
  );
  const generalLine = detail.services.find((s) => s.form_type === 'general');
  await cmd(worker, 'service_record.save', {
    id: generalLine.id,
    version: generalLine.version,
    technical: generalLine.technical,
    status: 'completed',
  });
  detail = await q(worker, 'visit', { id: visit.id });
  assert.deepEqual(detail.services.find((s) => s.id === colorLine.id).technical, technical);
  checks++;
  checkpoint('pagos parciales, reintentos y sobrepagos');
  const payment = {
    account_id: visit.account_id,
    amount: 100000,
    method_id: method.id,
    paid_at: new Date().toISOString(),
  };
  const operation = randomUUID();
  const first = await cmd(worker, 'payment.record', payment, operation);
  const replay = await cmd(worker, 'payment.record', payment, operation);
  check(first.id === replay.id, 'Reintento devuelve único pago');
  check((await q(worker, 'visit', { id: visit.id })).account.balance === 130000, 'Abono exacto');
  await denied(
    () => cmd(worker, 'payment.record', { ...payment, amount: 130001 }),
    'Sobrepago denegado',
  );
  await cmd(worker, 'payment.record', {
    ...payment,
    amount: 130000,
    paid_at: new Date().toISOString(),
  });
  check((await q(worker, 'visit', { id: visit.id })).account.balance === 0, 'Cuenta pagada');
  checkpoint('última unidad concurrente por API');
  const pc = await cmd(owner, 'category.save', {
    kind: 'product',
    name: `[PRUEBA] Productos ${tag}`,
  });
  const product = await cmd(owner, 'product.save', {
    category_id: pc.id,
    name: '[PRUEBA] Mascarilla',
    usage: 'both',
    cost: 5000,
    sale_price: 15000,
  });
  await cmd(owner, 'inventory.move', {
    product_id: product.id,
    quantity: 1,
    kind: 'initial',
    reason: 'Conteo ficticio de piloto',
  });
  await denied(
    () =>
      cmd(worker, 'inventory.move', {
        product_id: product.id,
        quantity: -1,
        kind: 'consumption',
        reason: 'Intento denegado',
      }),
    'Consumo manual denegado',
  );
  const v2 = await cmd(worker, 'visit.create', { client_id: person.id });
  const ownSale = await cmd(owner, 'sale.save', {
    account_id: otherVisit.account_id,
    product_id: product.id,
    quantity: 1,
  });
  const workerSale = await cmd(worker, 'sale.save', {
    account_id: v2.account_id,
    product_id: product.id,
    quantity: 1,
  });
  const concurrent = await Promise.allSettled([
    cmd(owner, 'sale.confirm', ownSale),
    cmd(worker, 'sale.confirm', workerSale),
  ]);
  check(
    concurrent.filter((r) => r.status === 'fulfilled').length === 1,
    'Solo una venta confirma última unidad',
  );
  check(
    (await q(owner, 'inventory')).products.find((p) => p.id === product.id).stock === 0,
    'Stock no negativo',
  );
  check(
    !('cost' in (await q(worker, 'inventory')).products.find((p) => p.id === product.id)),
    'Sin costos para trabajadora',
  );
  checkpoint('agenda por profesional y cumpleaños');
  const tomorrow = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + 86400000));
  const ap = {
    client_id: person.id,
    professional_id: users[1].id,
    starts_at: `${tomorrow}T09:00:00-05:00`,
    ends_at: `${tomorrow}T10:00:00-05:00`,
    service_ids: [],
    status: 'scheduled',
  };
  const wa = await cmd(owner, 'appointment.save', ap);
  const oa = await cmd(owner, 'appointment.save', { ...ap, professional_id: users[0].id });
  await denied(
    () => cmd(worker, 'appointment.save', { ...ap, starts_at: `${tomorrow}T09:30:00-05:00` }),
    'Solapamiento denegado',
  );
  const agenda = await q(worker, 'appointments', {
    from: `${tomorrow}T00:00:00-05:00`,
    to: `${tomorrow}T23:59:59-05:00`,
  });
  check(
    agenda.items.some((a) => a.id === wa.id) && !agenda.items.some((a) => a.id === oa.id),
    'Agenda privada',
  );
  const birthdays = await q(worker, 'birthdays', { from: '2027-02-01', to: '2027-02-28' });
  check(
    birthdays.events.some((b) => b.id === person.id && b.date === '2027-02-28'),
    'Cumpleaños año no bisiesto',
  );
  checkpoint('recuperación Auth sin correo y nueva contraseña');
  const link = pass(
    await admin.auth.admin.generateLink({ type: 'recovery', email: users[1].email }),
  );
  const recovered = makeClient(publishable);
  clients.push(recovered);
  pass(
    await recovered.auth.verifyOtp({ type: 'recovery', token_hash: link.properties.hashed_token }),
  );
  const newPassword = randomBytes(32).toString('base64url');
  pass(await recovered.auth.updateUser({ password: newPassword }));
  const fresh = makeClient(publishable);
  clients.push(fresh);
  pass(await fresh.auth.signInWithPassword({ email: users[1].email, password: newPassword }));
  check((await q(fresh, 'bootstrap')).profile.role === 'worker', 'Recuperación conserva rol');
  await denied(() => q(fresh, 'finance'), 'Recuperación no amplía permisos');
  console.log(
    JSON.stringify({
      status: 'passed',
      checks,
      project,
      scope: 'Supabase Auth y RPC HTTP reales con datos ficticios',
      fixtureTag: tag,
    }),
  );
}
try {
  await main();
} catch (cause) {
  console.error(
    JSON.stringify({
      status: 'failed',
      stage,
      action: lastAction,
      code: /^[A-Za-z0-9_]+$/.test(cause.code ?? '') ? cause.code : undefined,
      assertion: cause.name === 'AssertionError' ? cause.message : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  for (const client of clients)
    await client.auth.signOut({ scope: 'global' }).catch(() => undefined);
  for (const user of users) {
    try {
      sql(
        `update ita_private.profiles set active=false where id='${user.id}' and display_name like '[PRUEBA]%'`,
      );
      const response = await admin.auth.admin.updateUserById(user.id, { ban_duration: '876000h' });
      if (response.error) {
        console.error('Pendiente bloquear una identidad ficticia en Auth.');
        process.exitCode = 1;
      }
    } catch {
      console.error(
        'Pendiente desactivar una identidad ficticia de esta ejecución. Revisar Auth antes del arranque.',
      );
      process.exitCode = 1;
    }
  }
}
