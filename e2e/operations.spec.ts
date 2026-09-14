import { test, expect } from './sql-fixture';
import type { CommandResult, QueryResults } from '../src/lib/contracts';

test('dueña configura producto, registra stock, vende y cobra abonos sin duplicar existencias', async ({
  page,
  sql,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await sql.login(page, 'owner');
  await page.getByRole('link', { name: 'Ajustes', exact: true }).click();
  const methods = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Métodos de pago', exact: true }) });
  await methods.getByLabel('Nombre', { exact: true }).fill('Efectivo ficticio');
  await methods.getByLabel('Efectivo que entra o sale de caja').check();
  await methods.getByRole('button', { name: 'Guardar método' }).click();
  await expect(methods.getByText('Efectivo ficticio', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Inventario', exact: true }).click();
  await page.getByRole('button', { name: 'Categorías', exact: true }).click();
  await page.getByRole('button', { name: 'Crear categoría' }).click();
  await page.getByLabel('Nombre', { exact: true }).fill('Tratamientos ficticios');
  await page.getByRole('button', { name: 'Guardar categoría' }).click();
  await expect(page.getByText('Tratamientos ficticios', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Nuevo producto' }).click();
  const editor = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Nuevo producto', exact: true }) });
  await editor.getByLabel('Nombre', { exact: true }).fill('Mascarilla ficticia');
  await editor
    .getByRole('combobox', { name: 'Categoría', exact: true })
    .selectOption({ label: 'Tratamientos ficticios' });
  await editor.getByLabel('Precio de venta').fill('15000');
  await editor.getByLabel('Costo por unidad').fill('7000');
  await editor.getByRole('button', { name: 'Guardar producto' }).click();
  await expect(page.getByRole('cell', { name: /Mascarilla ficticia/ })).toBeVisible();
  await page.getByRole('button', { name: 'Movimiento', exact: true }).click();
  await page.getByLabel('Cantidad de unidades', { exact: true }).fill('3');
  await page.getByLabel('Motivo', { exact: true }).fill('Conteo físico ficticio');
  await page.getByRole('button', { name: 'Confirmar movimiento' }).click();
  await expect
    .poll(
      async () =>
        (await sql.query<QueryResults['inventory']>('owner', 'inventory')).products[0].stock,
    )
    .toBe(3);

  await page.getByRole('button', { name: 'Ventas independientes' }).click();
  await page.getByRole('button', { name: 'Nueva venta', exact: true }).click();
  const inventory = await sql.query<QueryResults['inventory']>('owner', 'inventory');
  await page
    .getByRole('combobox', { name: 'Producto', exact: true })
    .selectOption(inventory.products[0].id);
  await page.getByLabel('Unidades', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Añadir producto' }).click();
  await expect(page.getByRole('button', { name: 'Confirmar venta y entrega' })).toBeVisible();
  expect((await sql.query<QueryResults['inventory']>('owner', 'inventory')).products[0].stock).toBe(
    3,
  );
  await page.getByRole('button', { name: 'Confirmar venta y entrega' }).click();
  await expect(
    page.getByRole('button', { name: 'Registrar pago completo o parcial' }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await sql.query<QueryResults['inventory']>('owner', 'inventory')).products[0].stock,
    )
    .toBe(1);
  for (const amount of ['10000', '20000']) {
    await page.getByRole('button', { name: 'Registrar pago completo o parcial' }).click();
    await page.getByLabel('Importe', { exact: true }).fill(amount);
    await page
      .getByRole('combobox', { name: 'Método', exact: true })
      .selectOption({ label: 'Efectivo ficticio' });
    await page.getByRole('button', { name: 'Confirmar pago', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Registrar pago', exact: true })).toHaveCount(0);
  }
  const finance = await sql.query<QueryResults['finance']>('owner', 'finance');
  expect(finance.totals.collected).toBe(30000);
  expect(finance.accounts[0].balance).toBe(0);
  expect(finance.payments).toHaveLength(2);
  expect((await sql.query<QueryResults['inventory']>('owner', 'inventory')).products[0].stock).toBe(
    1,
  );
  await page.screenshot({
    path: testInfo.outputPath('venta-tablet-horizontal.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.screenshot({ path: testInfo.outputPath('venta-tablet-vertical.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('trabajadora consulta catálogo y existencias sin recibir costos ni modificar operaciones globales', async ({
  page,
  sql,
}) => {
  const category = await sql.command<CommandResult>('owner', 'category.save', {
    kind: 'product',
    name: 'Ficticios',
  });
  const product = await sql.command<CommandResult>('owner', 'product.save', {
    category_id: category.id,
    name: 'Producto ficticio',
    usage: 'both',
    cost: 7000,
    sale_price: 15000,
  });
  await sql.login(page, 'worker');
  await page.getByRole('link', { name: 'Inventario', exact: true }).click();
  await expect(page.getByRole('cell', { name: /Producto ficticio/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar movimiento' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Costo' })).toHaveCount(0);
  expect(
    (await sql.query<QueryResults['inventory']>('worker', 'inventory')).products[0],
  ).not.toHaveProperty('cost');
  await expect(
    sql.command('worker', 'inventory.move', {
      product_id: product.id,
      quantity: -1,
      kind: 'consumption',
      reason: 'No permitido',
    }),
  ).rejects.toThrow(/dueña/);
  await expect(sql.query('worker', 'finance')).rejects.toThrow(/dueña/);
  await expect(sql.command('worker', 'account.create')).rejects.toThrow(/dueña/);
  await page.getByRole('link', { name: 'Servicios y precios', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nuevo servicio' })).toHaveCount(0);
});

test('dueña rectifica stock y pago; egreso y cierre concilian sin duplicar compra', async ({
  page,
  sql,
}, testInfo) => {
  const cat = await sql.command<CommandResult>('owner', 'category.save', {
    kind: 'product',
    name: 'Productos ficticios',
  });
  const product = await sql.command<CommandResult>('owner', 'product.save', {
    category_id: cat.id,
    name: 'Producto prueba',
    usage: 'both',
    sale_price: 15000,
  });
  const method = await sql.command<CommandResult>('owner', 'payment_method.save', {
    name: 'Efectivo de prueba',
    is_cash: true,
  });
  await sql.command('owner', 'inventory.move', {
    product_id: product.id,
    kind: 'initial',
    quantity: 2,
    reason: 'Conteo inicial ficticio',
  });
  const purchase = await sql.command<CommandResult>('owner', 'inventory.move', {
    product_id: product.id,
    kind: 'purchase',
    quantity: 1,
    reason: 'Compra ficticia recibida',
  });
  const account = await sql.command<CommandResult>('owner', 'account.create');
  const sale = await sql.command<CommandResult>('owner', 'sale.save', {
    account_id: account.id,
    product_id: product.id,
    quantity: 1,
  });
  await sql.command('owner', 'sale.confirm', { id: sale.id, version: sale.version });
  await sql.command('owner', 'payment.record', {
    account_id: account.id,
    method_id: method.id,
    amount: 10000,
    paid_at: new Date().toISOString(),
  });
  await sql.login(page, 'owner');
  await page.getByRole('link', { name: 'Inventario', exact: true }).click();
  await page.getByRole('button', { name: 'Movimientos', exact: true }).click();
  const original = page.getByRole('row').filter({ hasText: 'Conteo inicial ficticio' });
  await original.getByRole('button', { name: 'Rectificar error' }).click();
  await page.getByLabel('Diferencia de unidades (+ / −)', { exact: true }).fill('-1');
  await page.getByLabel('Motivo', { exact: true }).fill('Error de conteo físico');
  await page.getByRole('button', { name: 'Confirmar rectificación', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await sql.query<QueryResults['inventory']>('owner', 'inventory')).products[0].stock,
    )
    .toBe(1);
  await expect(original.getByText('Registro rectificado')).toBeVisible();

  await page.getByRole('link', { name: 'Finanzas', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Pagos y rectificaciones' }).click();
  await page.getByRole('button', { name: 'Rectificar error', exact: true }).click();
  await page.getByLabel('Importe', { exact: true }).fill('9000');
  await page.getByLabel('Motivo de la rectificación').fill('Error al digitar importe');
  await page.getByRole('button', { name: 'Confirmar rectificación', exact: true }).click();
  await expect
    .poll(
      async () => (await sql.query<QueryResults['finance']>('owner', 'finance')).totals.collected,
    )
    .toBe(9000);
  await page.getByRole('button', { name: 'Caja de efectivo', exact: true }).click();
  await page.getByLabel('Efectivo de apertura', { exact: true }).fill('10000');
  await page.getByRole('button', { name: 'Confirmar apertura' }).click();
  await page.getByLabel('Importe', { exact: true }).fill('3000');
  await page.getByLabel('Motivo', { exact: true }).fill('Aporte ficticio de cambio');
  await page.getByRole('button', { name: 'Registrar aporte' }).click();
  await expect
    .poll(
      async () =>
        (await sql.query<QueryResults['finance']>('owner', 'finance')).cash_sessions[0]
          .expected_amount,
    )
    .toBe(13000);
  await page.getByRole('button', { name: 'Registrar egreso' }).click();
  const expense = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: 'Registrar egreso pagado', exact: true }) });
  await expense.getByLabel('Concepto', { exact: true }).fill('Compra ficticia de aseo');
  await expense.getByLabel('Categoría de gasto').fill('Aseo');
  await expense.getByLabel('Importe pagado').fill('2000');
  await expense.getByRole('combobox', { name: 'Método', exact: true }).selectOption(method.id);
  await expense
    .getByRole('combobox', { name: 'Compra recibida relacionada · opcional', exact: true })
    .selectOption(purchase.id);
  await expense.getByRole('button', { name: 'Confirmar egreso' }).click();
  await expect
    .poll(
      async () =>
        (await sql.query<QueryResults['finance']>('owner', 'finance')).cash_sessions[0]
          .expected_amount,
    )
    .toBe(11000);
  await page.getByLabel('Efectivo contado').fill('11000');
  await page.getByRole('button', { name: 'Confirmar cierre' }).click();
  const report = await sql.query<QueryResults['finance']>('owner', 'finance');
  expect(report.totals.collected).toBe(9000);
  expect(report.totals.expenses).toBe(2000);
  expect(report.totals.operating_flow).toBe(7000);
  expect(report.expenses).toHaveLength(1);
  expect(report.expenses[0].stock_movement_id).toBe(purchase.id);
  await expect(
    sql.command('owner', 'expense.save', {
      concept: 'Compra duplicada',
      category: 'Aseo',
      amount: 2000,
      method_id: method.id,
      paid_at: new Date().toISOString(),
      stock_movement_id: purchase.id,
    }),
  ).rejects.toThrow();
  await expect
    .poll(
      async () =>
        (await sql.query<QueryResults['finance']>('owner', 'finance')).cash_sessions[0].difference,
    )
    .toBe(0);
  await page.screenshot({ path: testInfo.outputPath('caja-conciliada.png'), fullPage: true });
});
