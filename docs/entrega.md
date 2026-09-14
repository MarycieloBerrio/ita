# Registro de entrega y verificación

Estado: desarrollo y verificación de la primera versión en curso. Este documento no autoriza operación real ni declara terminado lo pendiente.

## Accesos comprobados

- Repositorio existente MarycieloBerrio/ita con permisos de escritura; permanece público por instrucción posterior de la titular.
- Supabase mrnzvgivfjivuobpgens, plan Free. CLI autenticada y proyecto vinculado; se verificó cero tablas de la aplicación antes de instalar.
- Cloudflare Workers Static Assets publicado en https://ita.mberrioz.workers.dev, con rutas SPA y encabezados CSP comprobados por HTTPS.
- Actualización publicada el 14 de septiembre: versión `7c891335`, acceso inicial sin aviso técnico de sesión ausente. Ruta directa `/agenda` comprobada en el navegador integrado.
- Cuatro migraciones aplicadas y sincronizadas con el historial remoto. Registro público y acceso anónimo desactivados; contraseña mínima de 12 caracteres.
- Dos cuentas personales creadas por solicitud de la titular; inicio de sesión, perfil y restricción financiera de trabajadora verificados por API. Credenciales fuera de Git y registros.

## Evidencia automática local

- TypeScript estricto comprobado.
- Pruebas de plano/validación, edición, autoguardado e idempotencia de formularios.
- Migraciones ejecutadas en PGlite y PostgreSQL 17 real.
- Carreras reales sobre última unidad, salida manual frente a venta, pagos, reintentos y versiones.
- Respaldo cifrado restaurado en otra base PostgreSQL: comparación de 23 tablas y lectura con ambos perfiles. La emulación local de Auth no demuestra recuperación de Auth hospedado.

Última ejecución integrada: 80 pruebas Vitest, 162 comprobaciones PGlite, 186 comprobaciones PostgreSQL nativo y seis recorridos Playwright aprobados. Tras corregir el mensaje inicial de sesión, las cinco pruebas de Auth (incluida una nueva) aprobaron; total actual: 81 casos. Build, TypeScript, lint y formato comprobados. Auditoría de dependencias de producción: cero vulnerabilidades conocidas.

CI remoto aprobado para `8b15bcc`: [ejecución 34798281517](https://github.com/MarycieloBerrio/ita/actions/runs/34798281517). El 14 de septiembre se añadió una regresión de volcado con varios esquemas (total: 82 casos); las seis pruebas del adaptador, la ejecución nativa con la CLI y lint aprobaron. Copia hospedada cifrada restaurada: 45 tablas/181 filas idénticas, cuatro migraciones, RLS de 23 tablas privadas y hashes de las dos contraseñas verificados. Además, 17 comprobaciones con Supabase Auth v2.196.0 sobre la base restaurada aprobaron: login de ambas cuentas, firma JWT, perfiles, denegación financiera de trabajadora, recuperación mediante enlace administrativo sin correo, cambio de contraseña local, nuevo login y salida. Las contraseñas del proyecto hospedado permanecen iguales.

## Integración hospedada comprobada

25 verificaciones con Supabase Auth y RPC HTTP reales: registro administrativo ficticio, login, metadatos sin autoridad, denegaciones por rol, visitas múltiples, persistencia del plano, precio pendiente, versiones, abonos idempotentes y sobrepago, venta concurrente de última unidad, agenda propia, solapamientos, cumpleaños y recuperación de contraseña sin correo. Las identidades ficticias quedaron sin perfil activo al entregar las cuentas personales.

En el sitio publicado se comprobó con cada cuenta personal: login real, navegación de agenda, acceso a cuenta, salida y ausencia del menú financiero de la trabajadora. La prueba usó navegador Edge automatizado, sin trazas ni registros de contraseñas; no sustituye la Huawei física.

Supabase Advisors no reporta errores ni advertencias de funciones accesibles indebidamente después de la cuarta migración. Permanece el aviso de protección contra contraseñas filtradas, función disponible únicamente en Pro; no se activó un plan pago.

## Pendiente

Respaldo diario activado y medido, entrega efectiva de clave y copia independiente, aceptación visual del plano y prueba física Huawei. La titular confirmó que se encargará del soporte y guardará la copia en USB; el paquete cifrado está preparado, sin memoria conectada para comprobar su transferencia. La publicación sigue en piloto; no se autoriza cargar clientas, ventas ni saldos reales. La configuración del catálogo real y el conteo de arranque los realiza la dueña cuando se apruebe la operación.

## Convenciones propuestas del prototipo

Una profesional responsable por visita y cuenta; zonas del plano numeradas sin inventar nombres técnicos; una selección por zona para todo el servicio; semana lunes a domingo; 29 de febrero observado el 28 fuera de año bisiesto; recuperación del aviso mensual al primer acceso. Estas convenciones son revisables y se distinguen de las decisiones confirmadas de negocio.

La titular confirmó correos para los dos roles (conservados fuera de este repositorio), prohibición de solapamientos por profesional y visibilidad pública del código. Métodos de pago, tarifas e inventario reales los configura la dueña.
