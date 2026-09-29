# ita

Sistema interno para la operación del salón: agenda, clientas, servicios, inventario, finanzas, respaldos y auditoría.

## Producción

- Aplicación: [ita.mberrioz.workers.dev](https://ita.mberrioz.workers.dev)
- Política de datos: [ita.mberrioz.workers.dev/privacidad](https://ita.mberrioz.workers.dev/privacidad)
- Acceso privado mediante cuentas personales autorizadas.

## Arquitectura

- React, TypeScript y Vite.
- Supabase para base de datos y autenticación.
- Cloudflare Workers Static Assets para la aplicación web.
- Operaciones protegidas por roles, control de versiones y auditoría.

## Desarrollo

Node.js 22.20.0 (`.nvmrc`, igual que la CI) y npm 10; instalar con `npm ci`. Solo se usa npm: `pnpm-lock.yaml` y `pnpm-workspace.yaml` están ignorados. Publicar únicamente con el procedimiento de [publicación y reversión](docs/release.md).

## Documentación interna

- [Uso del salón](docs/uso.md)
- [Operación y mantenimiento](docs/instalacion.md)
- [Publicación y reversión](docs/release.md)
- [Respaldo y recuperación](docs/backup.md)
- [Pruebas reproducibles](docs/pruebas.md)
- [API y reglas de datos](docs/api.md)
