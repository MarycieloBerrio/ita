import { test, expect } from './sql-fixture';
import type { QueryResults } from '../src/lib/contracts';

test('cada alta exige confirmación nueva y conserva la constancia', async ({ page, sql }) => {
  await sql.login(page, 'owner');
  await page.goto('/clientas');
  await page.getByRole('button', { name: 'Nueva clienta' }).click();

  const confirmation = page.getByRole('checkbox', {
    name: /Confirmo que informé este aviso y recibí autorización expresa/,
  });
  await expect(confirmation).not.toBeChecked();
  await expect(
    page.getByRole('heading', { name: 'Autorización de tratamiento de datos personales' }),
  ).toBeVisible();
  await page.getByLabel('Nombre *').fill('Clienta de prueba');
  await page.getByRole('button', { name: 'Guardar clienta' }).click();
  await expect(page.getByText('Confirma la autorización antes de guardar.')).toBeVisible();
  expect((await sql.query<QueryResults['clients']>('owner', 'clients')).total).toBe(0);

  await confirmation.check();
  await page.getByRole('button', { name: 'Guardar clienta' }).click();
  await expect(page.getByRole('heading', { name: 'Clienta de prueba' })).toBeVisible();
  const clients = await sql.query<QueryResults['clients']>('owner', 'clients');
  expect(clients.total).toBe(1);
  expect(clients.items[0].consent).toContain('Aviso de datos personales v1.');

  await page.getByRole('link', { name: 'Volver a clientas' }).click();
  await page.getByRole('button', { name: 'Nueva clienta' }).click();
  await expect(
    page.getByRole('checkbox', {
      name: /Confirmo que informé este aviso y recibí autorización expresa/,
    }),
  ).not.toBeChecked();
});
