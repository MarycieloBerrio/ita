import { test as base, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase } from '../scripts/db-test.mjs';

export type TestRole = 'owner' | 'worker';
export interface SqlFixture {
  ids: Record<TestRole, string>;
  query<T = Record<string, unknown>>(role: TestRole, action: string, payload?: object): Promise<T>;
  command<T = Record<string, unknown>>(
    role: TestRole,
    action: string,
    payload?: object,
    key?: string,
  ): Promise<T>;
  login(page: Page, role: TestRole): Promise<void>;
  attach(page: Page): Promise<void>;
}

/** Test-only Auth transport. Every application RPC executes the real migration SQL.
 * No fixtures are imported by src or exposed by the production Vite build. */
export const test = base.extend<{ sql: SqlFixture }>({
  // Playwright requires fixture dependency destructuring, even with no dependencies.
  // eslint-disable-next-line no-empty-pattern
  sql: async ({}, provide) => {
    const db: PGlite = await createTestDatabase();
    const ids = { owner: randomUUID(), worker: randomUUID() };
    await db.query('insert into auth.users(id) values($1),($2)', [ids.owner, ids.worker]);
    await db.query(
      "insert into ita_private.profiles(id,display_name,role) values($1,'Luisa ficticia','owner'),($2,'Mary ficticia','worker')",
      [ids.owner, ids.worker],
    );
    // PGlite is single connection: scope auth and role under one serialized work item.
    let queue = Promise.resolve();
    function execute<T>(
      role: TestRole | undefined,
      fn: 'app_query' | 'app_command',
      action: string,
      payload: object,
      key?: string,
    ): Promise<T> {
      const result = queue.then(async () => {
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
          role ? ids[role] : '',
        ]);
        await db.exec('set role authenticated');
        try {
          const statement =
            fn === 'app_query'
              ? 'select public.app_query($1,$2::jsonb) result'
              : 'select public.app_command($1,$2::jsonb,$3::uuid) result';
          const args = [
            action,
            JSON.stringify(payload),
            ...(fn === 'app_command' ? [key ?? randomUUID()] : []),
          ];
          return (await db.query<{ result: T }>(statement, args)).rows[0].result;
        } finally {
          await db.exec('reset role');
        }
      });
      queue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }
    function user(role: TestRole) {
      return {
        id: ids[role],
        aud: 'authenticated',
        role: 'authenticated',
        email: `${role}@ita.example`,
        app_metadata: {},
        user_metadata: {},
        created_at: '2026-01-01T00:00:00Z',
      };
    }
    function token(role: TestRole) {
      const enc = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
      return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: ids[role], role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.test-only`;
    }
    const tokens = { owner: token('owner'), worker: token('worker') };
    const attach = async (page: Page) => {
      await page.route('https://*.supabase.co/**', async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        const body = request.postDataJSON() as Record<string, unknown> | null;
        const bearer = request.headers().authorization?.replace(/^Bearer /, '');
        const role = (['owner', 'worker'] as const).find((value) => bearer === tokens[value]);
        const send = (value: unknown, status = 200) =>
          route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
        if (path === '/auth/v1/token') {
          const selected =
            body?.email === 'owner@ita.example'
              ? 'owner'
              : body?.email === 'worker@ita.example'
                ? 'worker'
                : null;
          if (!selected) return send({ message: 'Identidad ficticia inválida' }, 400);
          return send({
            access_token: tokens[selected],
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            refresh_token: `test-only-${selected}`,
            user: user(selected),
          });
        }
        if (path === '/auth/v1/user')
          return role ? send(user(role)) : send({ message: 'Sin sesión' }, 401);
        if (path === '/auth/v1/logout') return send({});
        if (path === '/rest/v1/rpc/app_query' || path === '/rest/v1/rpc/app_command') {
          try {
            const result = await execute(
              role,
              path.endsWith('app_query') ? 'app_query' : 'app_command',
              String(body?.p_action),
              (body?.p_payload as object) ?? {},
              body?.p_operation_id as string | undefined,
            );
            return send(result);
          } catch (error) {
            const failure = error as Error & { code?: string };
            return send(
              {
                message: failure.message,
                code: failure.code ?? 'P0001',
                details: null,
                hint: null,
              },
              400,
            );
          }
        }
        // Never fall through to a real Supabase project from an automated fixture.
        return route.abort('blockedbyclient');
      });
    };
    await provide({
      ids,
      query: (role, action, payload = {}) => execute(role, 'app_query', action, payload),
      command: (role, action, payload = {}, key) =>
        execute(role, 'app_command', action, payload, key),
      attach,
      login: async (page, role) => {
        await attach(page);
        await page.goto('/');
        await page.getByLabel('Correo electrónico').fill(`${role}@ita.example`);
        await page.getByLabel('Contraseña', { exact: true }).fill('Test-only-password');
        await page.getByRole('button', { name: 'Entrar al salón' }).click();
        await expect(
          page.getByRole('heading', { name: role === 'owner' ? 'Hola, Luisa.' : 'Hola, Mary.' }),
        ).toBeVisible();
      },
    });
    await queue;
    await db.close();
  },
});
export { expect };
