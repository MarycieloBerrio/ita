# Publicación y reversión

Procedimiento para publicar una versión de ita en producción (Supabase `mrnzvgivfjivuobpgens` y Cloudflare Worker `ita`) y para volver atrás. Solo lo ejecuta el soporte técnico con las cuentas autorizadas. Nunca publicar desde una rama de trabajo ni con cambios locales sin versionar.

## Reglas

- Solo se publica un commit de `main` que ya pasó la CI de GitHub Actions y que tiene una etiqueta `vX.Y.Z`.
- `npm run deploy` ejecuta primero `scripts/deploy-guard.mjs`, que se niega a continuar si el árbol tiene cambios o archivos sin versionar, si `HEAD` no está en `main`, si `HEAD` no coincide con `origin/main`, si no hay etiqueta `vX.Y.Z` en `HEAD`, o si la configuración de compilación no es de producción (`VITE_APP_ENV=production`, URL del proyecto autorizado y clave publishable real). No saltarse la comprobación llamando a `wrangler deploy` directamente.
- Las migraciones son **solo hacia delante**: una migración aplicada no se edita ni se borra, y nunca se usa `db reset` sobre el proyecto. Para deshacer un cambio se publica una **migración compensatoria** nueva.
- Las migraciones deben ser **compatibles con la versión del frontend que está publicada** (patrón expandir/contraer), porque la base se migra antes que el frontend y porque una reversión del Worker no revierte la base.

## Configuración de compilación

Crear una vez `.env.production.local` (ignorado por Git), con la configuración pública:

```sh
VITE_SUPABASE_URL=https://mrnzvgivfjivuobpgens.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
VITE_APP_ENV=production
```

`vite build` usa este archivo por encima de `.env.local`, que puede quedarse con la configuración de desarrollo. Solo se usa la clave publishable; nunca una clave secreta ni `service_role`.

## Pasos de publicación

1. **Preparar.** Con el pull request fusionado y la CI de `main` en verde:

   ```sh
   git switch main
   git pull --ff-only
   git status            # debe estar limpio
   npm ci
   ```

2. **Etiquetar** la versión (semver: parche para correcciones, menor para funciones compatibles):

   ```sh
   git tag -a v0.2.0 -m "ita v0.2.0"
   git push origin v0.2.0
   ```

3. **Respaldar antes de tocar nada.** Ejecutar manualmente el workflow de respaldo (si está activado) o la copia manual de `docs/backup.md`, descargar el `.ita.enc` y anotar su SHA-256. Sin una copia verificada del mismo día no se aplican migraciones.

4. **Migrar la base** (solo si la versión trae archivos nuevos en `supabase/migrations`):

   ```sh
   npx supabase link --project-ref mrnzvgivfjivuobpgens
   npx supabase migration list --linked
   npx supabase db push --linked --dry-run   # revisar que solo aparecen las migraciones nuevas
   npx supabase db push --linked
   npx supabase migration list --linked
   ```

   Si el `--dry-run` muestra algo inesperado (migraciones antiguas, otro proyecto), detenerse.

5. **Publicar el frontend:**

   ```sh
   npm run deploy
   ```

   Anotar el identificador de versión que muestra Wrangler.

6. **Verificar** por HTTPS en https://ita.mberrioz.workers.dev: inicio de sesión de ambas cuentas, recarga directa de `/agenda` y `/visitas/:id`, una lectura y una escritura sin errores, cambio de contraseña y encabezados de seguridad (`curl -sI https://ita.mberrioz.workers.dev/`). Revisar los registros en Cloudflare → Workers → ita → Observability y los errores de la API en el panel de Supabase.

7. **Registrar** etiqueta, versión del Worker, migraciones aplicadas, hash de la copia previa y resultado de la verificación, sin datos personales.

## Orden entre migración y frontend

1. **Expandir** (esta versión): la migración solo añade — columnas nuevas opcionales o con valor por defecto, tablas, índices o acciones nuevas de `app_query`/`app_command` — y mantiene intactas las acciones y campos que usa el frontend publicado. Se aplica antes del frontend.
2. Publicar el frontend que usa lo nuevo.
3. **Contraer** (en una versión posterior, cuando el frontend nuevo ya está publicado y verificado): retirar columnas o acciones que ya nadie usa.

Así, durante la ventana entre migración y despliegue, y después de una reversión del Worker, el frontend publicado sigue funcionando con la base. Toda función nueva en `public` debe revocar explícitamente `execute` a `anon` y `authenticated` (ver `docs/api.md`); la CI lo comprueba con `npm run test:grants`.

## Reversión

### Frontend (Cloudflare)

La reversión del Worker es inmediata y no toca la base:

```sh
npx wrangler deployments list        # versiones publicadas y su identificador
npx wrangler rollback <version-id> --message "Motivo de la reversión"
```

Sin identificador, `wrangler rollback` vuelve a la versión anterior. `npx wrangler versions list` muestra el historial completo. Después, corregir en `main` y publicar una versión de parche siguiendo los pasos anteriores; no dejar producción indefinidamente en una versión que no coincide con `main`.

### Base de datos (Supabase)

No existe «deshacer migración». Para revertir un cambio de esquema o de funciones:

1. Crear una migración compensatoria nueva (`npx supabase migration new revertir_<cambio>`) que devuelva el esquema o las funciones al estado anterior sin perder datos.
2. Validarla con `npm run test:db`, `npm run test:grants` y, si toca respaldo, `npm run test:restore`.
3. Publicarla con el mismo procedimiento (respaldo previo, `db push --dry-run`, `db push`).

Si hubo pérdida o corrupción de datos, la recuperación se hace primero en un entorno separado según `docs/backup.md`; restaurar sobre el proyecto de producción requiere una decisión y autorización específicas.

## Recomendaciones de GitHub

Proteger `main` (Settings → Branches): exigir pull request y la comprobación «Verificar ita» antes de fusionar, y no permitir force-push. Las etiquetas `v*` solo las crea el soporte.
