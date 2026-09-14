import { readFile } from 'node:fs/promises';
import { test, expect } from './sql-fixture';
import type { CommandResult } from '../src/lib/contracts';

test('dueña descarga clienta completa y registros globales, sin truncar más de 50 visitas', async ({
  page,
  sql,
}) => {
  const category = await sql.command<CommandResult>('owner', 'category.save', {
    kind: 'service',
    name: 'Categoría ficticia exportación',
  });
  const service = await sql.command<CommandResult>('owner', 'service.save', {
    category_id: category.id,
    name: 'Servicio ficticio exportación',
    form_type: 'general',
    price_mode: 'custom',
  });
  const client = await sql.command<CommandResult>('owner', 'client.save', {
    name: 'Clienta ficticia exportación',
    notes: '</script><img src=x> · texto libre',
  });
  const other = await sql.command<CommandResult>('owner', 'client.save', {
    name: 'Otra clienta ficticia',
  });
  for (let index = 0; index < 55; index++)
    await sql.command('owner', 'visit.create', { client_id: client.id, service_ids: [service.id] });
  await sql.command('owner', 'visit.create', { client_id: other.id, service_ids: [service.id] });
  await sql.login(page, 'owner');
  await page.goto(`/clientas/${client.id}`);
  const clientDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar registro integral de clienta' }).click();
  const clientFile = await clientDownload;
  const clientData = JSON.parse(await readFile((await clientFile.path())!, 'utf8'));
  expect(clientData.data.clients).toHaveLength(1);
  expect(clientData.data.clients[0].id).toBe(client.id);
  expect(clientData.data.clients[0].notes).toBe('</script><img src=x> · texto libre');
  expect(clientData.data.visits).toHaveLength(55);
  expect(clientData.data.visit_services).toHaveLength(55);
  expect(
    clientData.data.visit_services.every((row: { price: unknown }) => row.price === null),
  ).toBe(true);
  expect(clientData.timezone).toBe('America/Bogota');

  await page.getByRole('link', { name: 'Ajustes', exact: true }).click();
  const globalDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar registros', exact: true }).click();
  const globalFile = await globalDownload;
  const globalData = JSON.parse(await readFile((await globalFile.path())!, 'utf8'));
  expect(Object.keys(globalData.data)).toHaveLength(22);
  expect(globalData.data.clients).toHaveLength(2);
  expect(globalData.data.visits).toHaveLength(56);
  expect(globalData.data).not.toHaveProperty('operations');
  expect(globalData.data).not.toHaveProperty('users');
  expect(globalData.data).not.toHaveProperty('sessions');
  await expect(
    page.getByRole('status').filter({ hasText: 'Exportación completa preparada' }),
  ).toBeVisible();
});
