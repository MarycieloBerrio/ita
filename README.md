# ita

Aplicación interna de salón para Colombia, COP enteros y America/Bogota. React, TypeScript estricto, Vite, React Router, Tailwind, React Hook Form/Zod, TanStack Query, Supabase y FullCalendar Standard. Plano SVG con cinco vistas y color exclusivamente como texto libre.

**Estado: versión en verificación. No iniciar operación con datos reales todavía.** Las pruebas locales, la instalación remota y la aceptación física se registran por separado en [la entrega](docs/entrega.md). El repositorio permanece público por decisión explícita de su titular; los datos y credenciales del salón no pertenecen a este repositorio.

Versión de prueba publicada: [ita.mberrioz.workers.dev](https://ita.mberrioz.workers.dev). Requiere una de las dos cuentas personales autorizadas; no se publican contraseñas de demostración.

## Ejecutar

Node.js 22 (22.14 o superior) y npm 10. Instalar las versiones bloqueadas:

```sh
npm ci
```

Copiar `.env.example` a `.env.local` y configurar la URL y **clave publishable** del proyecto existente. No usar claves secretas ni `service_role` en variables `VITE_`. `.env.local` está excluido de Git.

```sh
npm run dev
```

Abrir http://127.0.0.1:5173. Se necesita un usuario de Supabase Auth con perfil activo en la aplicación. No hay registro público ni identidades de demostración incrustadas en la aplicación. Sin configuración, el acceso informa del requisito pendiente.

## Comprobar

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
node scripts/db-test.mjs
node scripts/db-test.mjs --native
npm run test:e2e
npm run build
```

La prueba SQL normal usa PostgreSQL embebido PGlite; la variante nativa utiliza PostgreSQL 17 aislado en `127.0.0.1:55433`, usuario `ita_test`, y crea/elimina exclusivamente bases de prueba con identificadores aleatorios. Nunca acepta una URL remota. Véase [API y pruebas](docs/api.md).

Playwright utiliza Edge instalado por defecto. Para Chromium, instalarlo con `npx playwright install chromium` y definir `PLAYWRIGHT_CHANNEL=chromium`. Los escenarios de navegador interceptan solamente el transporte de Auth y ejecutan las migraciones SQL reales en una base efímera. Eso no comprueba Supabase Auth hospedado; su prueba remota se registra por separado.

La suite inicia su servidor exclusivo en `127.0.0.1:5177`; no reutiliza servidores de otros proyectos.

## Configurar y publicar

Consultar [instalación, acceso y despliegue](docs/instalacion.md), [respaldo y restauración](docs/backup.md) y [guía del salón](docs/uso.md). No crear otro repositorio ni otro proyecto Supabase. El destino es `MarycieloBerrio/ita`, proyecto `mrnzvgivfjivuobpgens` y Cloudflare Workers Static Assets en una dirección gratuita `workers.dev`.

Las migraciones están en `supabase/migrations`; el navegador solo accede a los dos puntos de entrada autorizados `app_query` y `app_command`. Los precios históricos, movimientos y correcciones se conservan en PostgreSQL. El uso técnico de materiales nunca descuenta existencias.

## Organización

- `src/features`: pantallas y formularios por función; `technical` concentra plantilla, validación y reconstrucción del plano.
- `src/lib`: conexión, contratos, sesión, consultas, operaciones idempotentes y formato regional.
- `supabase/migrations`: relaciones, autorización, restricciones y operaciones transaccionales.
- `tests`, `e2e`, `scripts/db-*`: validación de reglas, navegador y concurrencia real.
- `scripts/backup*`, `scripts/restore.mjs`: respaldo cifrado y recuperación verificada.

Las convenciones visuales del plano están identificadas en [DESIGN.md](src/features/technical/DESIGN.md); los números no pretenden ser nombres anatómicos confirmados. No hay dependencias de pago, pasarela de cobros, recordatorios de citas ni funcionamiento sin conexión.
