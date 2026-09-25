# Pruebas reproducibles

Usar Node.js 22.20.0 (`.nvmrc`, la misma versión de la CI) y `npm ci`. Las dependencias están fijadas en el archivo bloqueado; las comprobaciones no necesitan claves administrativas ni datos del salón.

```sh
npm run format:check
npm run typecheck
npm run lint
npm test
npm run test:db
npm run test:grants
npm run build
```

`test:grants` aplica las migraciones en PGlite reproduciendo los privilegios por defecto de Supabase (que conceden `execute` a `anon` y `authenticated` explícitamente) y falla si `anon` puede ejecutar cualquier función de `public` o `ita_private`, o si `authenticated` puede ejecutar una función de `public` distinta de `app_query`/`app_command`. `test:db` aplica todas las migraciones a PostgreSQL embebido PGlite y comprueba autorización, precios, visitas múltiples, plano, pagos, inventario y cumpleaños mediante los RPC SQL. Cada ejecución crea una base efímera. PGlite usa una sola conexión y por sí solo no acredita concurrencia entre sesiones.

## Concurrencia y restauración con PostgreSQL 17

Estas pruebas necesitan un clúster local desechable en `127.0.0.1:55433`, con usuario administrador `ita_test`, base de conexión `postgres` y herramientas `pg_dump` y `psql` de PostgreSQL 17. Nunca usar credenciales o puertos de operación real. El programa crea y elimina únicamente bases auxiliares de nombre aleatorio.

Si Docker está instalado, este comando crea el servicio de prueba; si el nombre o el puerto están ocupados, resolverlo sin eliminar un servicio existente:

```sh
docker run --name ita-test-db --rm -d -p 127.0.0.1:55433:5432 -e POSTGRES_USER=ita_test -e POSTGRES_PASSWORD=ita_ci_fictional_only -e POSTGRES_DB=postgres postgres:17.11-bookworm
```

Esperar a que `docker exec ita-test-db pg_isready -U ita_test -d postgres` confirme disponibilidad. En PowerShell, con las herramientas PostgreSQL 17 instaladas en la ubicación indicada:

```powershell
$env:PGPASSWORD = 'ita_ci_fictional_only'
$env:ITA_TEST_DATABASE_URL = 'postgresql://ita_test:ita_ci_fictional_only@127.0.0.1:55433/postgres'
$env:ITA_PG_BIN = 'C:/Program Files/PostgreSQL/17/bin'
$env:ITA_BASH_BIN = 'C:/Program Files/Git/bin/bash.exe'
npm run test:db:native
npm run test:restore
```

En Linux, usar `export` para las mismas variables, `ITA_PG_BIN=/usr/lib/postgresql/17/bin` e `ITA_BASH_BIN=/bin/bash`. En Windows, ejecutar `test:restore` desde PowerShell: el `tar` de Git Bash no admite rutas `C:\…` y el de Windows sí. También se puede usar un clúster PostgreSQL 17 local previamente preparado con esa dirección y usuario; la contraseña debe coincidir con la configuración de ese clúster.

Las carreras usan conexiones reales que disputan bloqueos sobre pagos, stock, agenda y versiones. La restauración crea una copia ficticia con el mismo código que el respaldo programado (`createBackup` de `scripts/backup.mjs`: script de la CLI local → `pg_dump` nativo → cifrado v2), comprueba que las sesiones Auth no viajan en ella, la recupera en otra base vacía y compara tablas, permisos, saldos, inventario e historial de migraciones. Rechaza restaurar sobre una base que ya contiene la aplicación. El esquema Auth local es un sustituto de prueba; esto no acredita inicio de sesión o recuperación del servicio Supabase Auth hospedado.

Después de las pruebas, detener únicamente el contenedor creado con el comando anterior: `docker stop ita-test-db`. El contenedor se elimina por su opción `--rm`.

## Navegador

Playwright usa Edge instalado por defecto. Para Chromium:

```powershell
npx --no-install playwright install chromium
$env:PLAYWRIGHT_CHANNEL = 'chromium'
$env:VITE_SUPABASE_URL = 'https://mrnzvgivfjivuobpgens.supabase.co'
$env:VITE_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test'
npm run test:e2e
```

Playwright arranca su propio Vite en el puerto 5177 (`reuseExistingServer: false`) y falla si ese puerto ya está ocupado; el servidor de desarrollo en 5173 no interfiere. Los escenarios interceptan Auth con identidades ficticias; las llamadas de negocio ejecutan SQL real en PGlite. No se envían peticiones de la fixture al proyecto remoto. Se conservan trazas locales ante fallos en `test-results` y el informe en `playwright-report`, excluidos de Git.

La suite comprueba la zona America/Bogota con el navegador configurado en otra zona; la prueba de agenda fija el reloj del navegador (`page.clock`) para no depender de la medianoche. Los pagos de las pruebas usan la hora real porque PostgreSQL rechaza pagos futuros o anteriores al trabajo. La emulación de tamaño y orientación no sustituye la aceptación táctil en la Huawei física. Los resultados del entorno remoto y del dispositivo se registran aparte en [entrega](entrega.md).

## GitHub Actions

[El flujo de CI](../.github/workflows/ci.yml) ejecuta las comprobaciones anteriores al recibir un pull request, cambios en `main` y a petición manual (las ramas de trabajo se verifican mediante su pull request, sin ejecuciones dobles). También ejecuta `npm audit --omit=dev --audit-level=high`. Dependabot propone cada semana actualizaciones agrupadas de npm y de las acciones. Usa un runner Ubuntu estándar, un PostgreSQL 17.11 temporal y Chromium. Las acciones están fijadas por SHA; no recibe secretos, despliega, sube informes ni conserva cachés. La contraseña que aparece en el flujo es exclusivamente ficticia y local al trabajo.

El servidor de CI se configura siguiendo [los servicios PostgreSQL de GitHub](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers), y sus herramientas de cliente se instalan desde [el repositorio oficial PostgreSQL para Ubuntu](https://www.postgresql.org/download/linux/ubuntu/). Actualizar el minor fijado de PostgreSQL y las dependencias mediante un cambio revisado, manteniendo la suite aprobada.

Un flujo escrito todavía no equivale a una ejecución aprobada: verificar la primera ejecución de Actions después de publicar el código. CI no usa el proyecto Supabase remoto ni demuestra su configuración, entrega por HTTPS, respaldo programado o recuperación de cuentas reales.
