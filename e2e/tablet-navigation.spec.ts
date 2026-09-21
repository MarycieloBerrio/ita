import { test, expect } from './sql-fixture';

test('la navegación de tablet abre, cierra y deja disponible el contenido', async ({
  page,
  sql,
}) => {
  await page.setViewportSize({ width: 800, height: 1100 });
  await sql.login(page, 'owner');

  const sidebar = page.locator('#main-sidebar');
  const menu = page.locator('.mobile-menu');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('aria-label', 'Abrir menú');
  await expect(sidebar).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await menu.click();
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar menú' }).first()).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();
  await expect(menu).toBeFocused();

  await menu.click();
  await sidebar.getByRole('link', { name: 'Agenda' }).click();
  await expect(page).toHaveURL(/\/agenda$/);
  await expect(sidebar).toBeHidden();

  await menu.click();
  await page.locator('.sidebar-scrim').click({ position: { x: 700, y: 500 } });
  await expect(sidebar).toBeHidden();
  await expect(page.locator('main')).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(menu).toBeVisible();
  await expect(sidebar).toBeHidden();
  await page.setViewportSize({ width: 1025, height: 768 });
  await expect(menu).toBeHidden();
  await expect(sidebar).toBeVisible();
});
