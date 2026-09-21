import { test, expect } from './sql-fixture';

test('la política es pública y está enlazada desde una nueva clienta', async ({ page, sql }) => {
  await sql.attach(page);
  await page.goto('/privacidad');
  await expect(
    page.getByRole('heading', { name: 'Política de tratamiento de datos personales' }),
  ).toBeVisible();
  await expect(page.getByText('Luisa Fernanda Zapata')).toBeVisible();
  await expect(page.getByRole('link', { name: 'luisaqf31@gmail.com' })).toHaveAttribute(
    'href',
    'mailto:luisaqf31@gmail.com',
  );

  await sql.login(page, 'owner');
  await page.goto('/clientas');
  await page.getByRole('button', { name: 'Nueva clienta' }).click();
  await page.getByLabel('Nombre *').fill('Nombre sin guardar');
  const policyLink = page.getByRole('link', {
    name: 'política de tratamiento de datos personales',
  });
  await expect(policyLink).toHaveAttribute('href', '/privacidad');
  const policyPagePromise = page.waitForEvent('popup');
  await policyLink.click();
  const policyPage = await policyPagePromise;
  await expect(
    policyPage.getByRole('heading', { name: 'Política de tratamiento de datos personales' }),
  ).toBeVisible();
  await policyPage.close();
  await expect(page.getByLabel('Nombre *')).toHaveValue('Nombre sin guardar');
  await expect(
    page.getByRole('checkbox', { name: /Confirmo que informé este aviso/ }),
  ).not.toBeChecked();
});

test('la interfaz de producción no muestra avisos temporales ni edita la política en ajustes', async ({
  page,
  sql,
}) => {
  await sql.login(page, 'owner');
  await expect(page.getByText(/PILOTO|DATOS DE PRUEBA/i)).toHaveCount(0);
  await page.getByRole('link', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Salón y datos personales' })).toHaveCount(0);
  await expect(page.getByLabel('Responsable del tratamiento de datos')).toHaveCount(0);
  await expect(page.getByLabel('Texto de finalidad y autorización')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Métodos de pago' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cuentas personales' })).toBeVisible();
});
