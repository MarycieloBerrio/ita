# Instalación y acceso

## Proyecto existente

La CLI oficial está fijada en `package-lock.json`. El piloto se publica en https://ita.mberrioz.workers.dev. Autenticarse mediante `npx supabase login` y vincular el único proyecto autorizado:

```sh
npx supabase link --project-ref mrnzvgivfjivuobpgens
npx supabase migration list --linked
```

Antes de aplicar cambios, revisar tablas existentes, historial y respaldo. No usar `db reset` sobre este proyecto. Las migraciones se aplican después de pasar las pruebas locales:

```sh
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase migration list --linked
```

No editar una migración ya aplicada; agregar una nueva. Guardar esquema, SQL y bloqueo de dependencias en el mismo commit cuando cambian conjuntamente. Las tablas de negocio están en `ita_private`, con RLS y sin acceso directo de clientas autenticadas. Los dos RPC públicos delegan a funciones privadas que comprueban perfil y profesional en cada lectura y escritura. Los metadatos editables de Auth nunca conceden un rol.

## Cuentas personales

En Supabase Auth, desactivar altas públicas y acceso anónimo. Mantener correo/contraseña habilitado y mínimo de 12 caracteres. Las dos cuentas iniciales ya fueron creadas por petición de la titular y sus credenciales se entregaron en un archivo local con permisos restringidos, fuera de Git y OneDrive. Cada titular puede cambiar su contraseña en `/cuenta`. No volver a crear estas cuentas ni restablecer sus contraseñas durante un despliegue. Para una instalación recuperada, conservar los UUID reales de `ita_private.profiles` con rol `owner` o `worker` y `active=true`. Los correos de las titulares se conservan fuera del repositorio público.

El rol no se deduce del correo ni de `user_metadata`. La dueña administra perfiles activos desde Ajustes; el sistema evita dejar el salón sin una dueña activa. Una identidad Auth sin perfil activo no obtiene datos de negocio.

Verificar login de ambas, rechazo de usuaria ajena/inactiva, cierre de sesión y denegación por API de citas, cuentas, finanzas y movimientos ajenos.

## Recuperar contraseña

La responsable verifica la identidad por un medio acordado. El soporte usa Supabase Admin para generar un enlace de recuperación individual, sin enviar correo automáticamente, con destino exacto `https://<sitio>.workers.dev/recuperar`. Entregarlo únicamente a su titular mediante un canal privado acordado. No pegarlo en registros, incidencias o documentación pública. En el enlace la titular escribe y confirma su nueva contraseña; soporte no la conoce.

La aplicación también permite cambiarla desde el nombre personal del menú, en `/cuenta`. Un enlace vencido requiere repetir el procedimiento de administración. Desactivar un perfil revoca sus operaciones de negocio inmediatamente, aunque un token anterior todavía no haya expirado. Las credenciales de proveedores requieren el procedimiento del propio proveedor.

## Cloudflare Workers Static Assets

Completar `.env.local` solo con configuración pública y `VITE_APP_ENV=pilot`; construir con `npm run build`. `wrangler.jsonc` configura los archivos de `dist` y el retorno a `index.html` para rutas internas. `public/_headers` aplica la política de seguridad y limita conexiones al Supabase existente.

```sh
npx wrangler login
npm run deploy
```

También puede cargarse el contenido de `dist` como ZIP desde Workers & Pages → Create app → Upload your static files, sin crear una aplicación Pages ni contratar complementos. Verificar allí el comportamiento de SPA y los encabezados. Si ya existe `ita`, actualizarla; no crear duplicados. Las únicas partes públicas son los archivos estáticos: todos los datos necesitan Auth y autorización del servidor.

Configurar Supabase Auth Site URL y Redirect URLs con la dirección exacta publicada y `/recuperar`. No activar wildcards de redirección innecesarios. Comprobar por HTTPS acceso inicial, recarga directa de `/agenda` y `/visitas/:id`, cambio/recuperación de contraseña, rechazo API sin sesión y separación entre los dos perfiles.

## Antes de operación real

- Aceptar la vectorización y correspondencia de zonas en el prototipo.
- Revisar en Huawei física ambas orientaciones, teclado, SVG y descarga.
- Confirmar texto de datos personales, responsable y soporte de recuperación; configurar métodos de pago reales.
- Activar respaldo cifrado dentro de cuota, custodiar la clave aparte y probar recuperación con Auth real.
- Separar o retirar de forma autorizada los registros del piloto. No convertir datos ficticios en clientes, ventas o saldos reales.
- Registrar aprobación de arranque y construir con `VITE_APP_ENV=production` solo entonces.

La dueña completa categorías, precios y conteo físico inicial desde la aplicación. No se importan datos históricos ni se presuponen tarifas, bancos o existencias.
