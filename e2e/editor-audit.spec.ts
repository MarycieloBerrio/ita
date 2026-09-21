import { test, expect } from './sql-fixture';
import type { CommandResult, QueryResults } from '../src/lib/contracts';

test('editor de producto protege cancelación, bloquea cambios durante el envío y cierra tras guardar', async ({
  page,
  sql,
}) => {
  const category = await sql.command<CommandResult>('owner', 'category.save', {
    kind: 'product',
    name: 'Auditoría ficticia',
  });
  await sql.login(page, 'owner');
  await page.getByRole('link', { name: 'Inventario', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo producto', exact: true }).click();
  const editor = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Nuevo producto', exact: true }) });
  await editor.getByLabel('Nombre', { exact: true }).fill('Producto de prueba');
  page.once('dialog', (dialog) => dialog.dismiss());
  await editor.getByRole('button', { name: 'Cerrar editor' }).click();
  await expect(editor.getByLabel('Nombre', { exact: true })).toHaveValue('Producto de prueba');
  await editor.getByRole('combobox', { name: 'Categoría', exact: true }).selectOption(category.id);
  await editor.getByLabel('Precio de venta').fill('15000');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/rest/v1/rpc/app_command', async (route) => {
    if (route.request().postDataJSON()?.p_action === 'product.save') await held;
    await route.fallback();
  });
  await editor.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(editor.getByLabel('Nombre', { exact: true })).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Cerrar editor' })).toBeDisabled();
  release();
  await expect(page.getByRole('heading', { name: 'Nuevo producto', exact: true })).toHaveCount(0);
  expect((await sql.query<QueryResults['inventory']>('owner', 'inventory')).products[0].name).toBe(
    'Producto de prueba',
  );
});
