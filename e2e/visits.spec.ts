import { test, expect } from './sql-fixture';
import type { CommandResult, QueryResults } from '../src/lib/contracts';

test('visita Color y General: guarda plano, primera valoración posterior y dos abonos', async ({
  page,
  sql,
}, info) => {
  const category = await sql.command<CommandResult>('owner', 'category.save', {
    kind: 'service',
    name: 'Peluquería ficticia',
  });
  const color = await sql.command<CommandResult>('owner', 'service.save', {
    category_id: category.id,
    name: 'Color ficticio',
    form_type: 'color',
    price_mode: 'custom',
    duration_minutes: 120,
  });
  const general = await sql.command<CommandResult>('owner', 'service.save', {
    category_id: category.id,
    name: 'Cepillado ficticio',
    form_type: 'general',
    price_mode: 'fixed',
    fixed_price: 30000,
    duration_minutes: 30,
  });
  const client = await sql.command<CommandResult>('owner', 'client.save', {
    name: 'Clienta de prueba',
    birth_day: 29,
    birth_month: 2,
  });
  await sql.command('owner', 'payment_method.save', { name: 'Efectivo ficticio', is_cash: true });
  const visit = await sql.command<CommandResult>('worker', 'visit.create', {
    client_id: client.id,
    service_ids: [color.id, general.id],
  });
  await sql.login(page, 'worker');
  await page.goto(`/visitas/${visit.id}`);
  const colorTab = page.getByRole('tab', { name: /Color ficticio/ });
  const generalTab = page.getByRole('tab', { name: /Cepillado ficticio/ });
  await colorTab.click();
  await expect(page.getByRole('button', { name: /Ampliar vista/ })).toHaveCount(5);
  await expect(page.locator('input[type=color]')).toHaveCount(0);
  await page.getByLabel('Seleccionar zona').selectOption('z01');
  await page.getByLabel('Zigzag diagonal', { exact: true }).check();
  await page.getByLabel('Color', { exact: true }).fill('8.31 + fórmula libre');
  await expect(generalTab).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Finalizar trabajo técnico' })).toBeDisabled();
  await page.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await page.getByLabel('Procedimiento realizado').fill('Mezcla ficticia\nAplicación y aclarado');
  for (const checkbox of await page.getByLabel('No se utilizó', { exact: true }).all())
    await checkbox.check();
  await page.getByLabel('Sin tinte aplicado', { exact: true }).check();
  await page.getByLabel('No se vendieron productos', { exact: true }).check();
  await expect(page.getByRole('button', { name: 'Finalizar trabajo técnico' })).toBeEnabled();
  await page.getByRole('button', { name: 'Finalizar trabajo técnico' }).click();
  await expect(page.getByText('Trabajo técnico finalizado.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Precio de esta atención')).toBeEnabled();
  await page.getByLabel('Precio de esta atención').fill('200000');
  await page.getByRole('button', { name: 'Guardar ficha', exact: true }).click();
  await expect(generalTab).toBeEnabled();
  await generalTab.click();
  await expect(page.getByLabel('Sin materiales', { exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Finalizar trabajo técnico' }).click();
  await expect(page.getByRole('button', { name: 'Registrar pago', exact: true })).toBeVisible();
  for (const amount of ['100000', '130000']) {
    await page.getByRole('button', { name: 'Registrar pago', exact: true }).click();
    await page.getByLabel('Importe', { exact: true }).fill(amount);
    await page
      .getByRole('combobox', { name: 'Método', exact: true })
      .selectOption({ label: 'Efectivo ficticio' });
    await page.getByRole('button', { name: 'Confirmar pago', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  const detail = await sql.query<QueryResults['visit']>('worker', 'visit', { id: visit.id });
  expect(detail.account.total).toBe(230000);
  expect(detail.account.balance).toBe(0);
  expect(detail.payments).toHaveLength(2);
  const savedColor = detail.services.find((s) => s.form_type === 'color');
  expect(savedColor?.technical).toMatchObject({
    map: { zones: { z01: { pattern: 'diagonal-zigzag', colorText: '8.31 + fórmula libre' } } },
  });
  await page.reload();
  await colorTab.click();
  await page.getByLabel('Seleccionar zona').selectOption('z01');
  await expect(page.getByText('8.31 + fórmula libre', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('plano-horizontal.png'), fullPage: true });
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.screenshot({ path: info.outputPath('plano-vertical.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('agenda usa Bogotá con dispositivo de otra zona y oculta citas ajenas', async ({
  page,
  sql,
}) => {
  const client = await sql.command<CommandResult>('owner', 'client.save', {
    name: 'Cita ficticia',
  });
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  await sql.command('owner', 'appointment.save', {
    client_id: client.id,
    professional_id: sql.ids.worker,
    starts_at: `${date}T10:00:00-05:00`,
    ends_at: `${date}T11:00:00-05:00`,
    service_ids: [],
    status: 'scheduled',
    notes: 'Solo trabajadora',
  });
  await sql.command('owner', 'appointment.save', {
    client_id: client.id,
    professional_id: sql.ids.owner,
    starts_at: `${date}T10:00:00-05:00`,
    ends_at: `${date}T11:00:00-05:00`,
    service_ids: [],
    status: 'scheduled',
    notes: 'Solo dueña',
  });
  await sql.login(page, 'worker');
  await page.getByRole('link', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('.fc-prev-button .fc-icon')).toHaveCSS(
    'font-family',
    /ita-calendar-icons/,
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.fonts].some(
          (font) => font.family === 'ita-calendar-icons' && font.status === 'loaded',
        ),
      ),
    )
    .toBe(true);
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('.fc-list-event')).toHaveCount(1);
  await expect(page.locator('.fc-list-event-time')).toContainText('10:00');
  await page.getByText('Cita ficticia', { exact: true }).click();
  await expect(page.getByLabel('Notas')).toHaveValue('Solo trabajadora');
  await expect(page.getByLabel('Inicio')).toHaveValue(`${date}T10:00`);
});

test('corregir una ficha finalizada vuelve a lectura y conserva la corrección al recargar', async ({
  page,
  sql,
}) => {
  const category = await sql.command<CommandResult>('owner', 'category.save', {
    kind: 'service',
    name: 'Correcciones ficticias',
  });
  const catalog = await sql.command<CommandResult>('owner', 'service.save', {
    category_id: category.id,
    name: 'General para corregir',
    form_type: 'general',
    price_mode: 'fixed',
    fixed_price: 30000,
    duration_minutes: 30,
  });
  const client = await sql.command<CommandResult>('owner', 'client.save', {
    name: 'Clienta ficticia de corrección',
  });
  const visit = await sql.command<CommandResult>('owner', 'visit.create', {
    client_id: client.id,
    service_ids: [catalog.id],
  });
  const initial = await sql.query<QueryResults['visit']>('owner', 'visit', { id: visit.id });
  const service = initial.services[0];
  await sql.command('owner', 'service_record.save', {
    id: service.id,
    version: service.version,
    technical: service.technical,
    status: 'completed',
  });
  await sql.login(page, 'owner');
  await page.goto(`/visitas/${visit.id}`);
  await page.getByRole('button', { name: 'Corregir ficha' }).click();
  await page.getByLabel('Motivo de la corrección').fill('Corregir observaciones');
  await page.getByLabel('Observaciones (opcional)').fill('Observación corregida y confirmada');
  await page.getByRole('button', { name: 'Guardar ficha', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Corregir ficha' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar ficha', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Motivo de la corrección')).toHaveCount(0);
  await expect(page.getByLabel('Observaciones (opcional)')).toBeDisabled();
  const saved = await sql.query<QueryResults['visit']>('owner', 'visit', { id: visit.id });
  expect(saved.services[0].technical.notes).toBe('Observación corregida y confirmada');
  await page.reload();
  await expect(page.getByLabel('Observaciones (opcional)')).toHaveValue(
    'Observación corregida y confirmada',
  );
  await expect(page.getByLabel('Observaciones (opcional)')).toBeDisabled();
  await page.getByRole('button', { name: 'Corregir ficha' }).click();
  await expect(page.getByLabel('Motivo de la corrección')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Guardar ficha', exact: true })).toBeDisabled();
});
