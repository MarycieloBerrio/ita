# Respaldo y recuperación de ita

Estado: implementación local verificada; proceso remoto desactivado hasta configurar secretos, medir cuotas y completar la recuperación con Supabase Auth. No comenzar a guardar datos reales antes de cerrar estos pendientes. El repositorio se mantiene **público por decisión expresa de su titular**, que sustituye la propuesta privada del plan. Solo se publica el archivo cifrado; hay que considerar que terceros pueden obtenerlo. Su confidencialidad depende de una clave aleatoria fuerte y de su custodia separada.

## Qué conserva

El proceso usa Supabase CLI 2.117.0 y su procedimiento soportado: roles, esquema, datos mediante COPY e historial de migraciones por separado. El volcado de datos incluye `auth`, mientras que el esquema de Auth lo proporciona un destino Supabase compatible. Conserva UUID de identidades, perfiles del salón, información técnica, catálogo histórico, cuentas, pagos, movimientos de inventario, citas, cumpleaños y auditoría. No modifica datos del salón durante el volcado; solo escribe el estado del respaldo. No ejecutar migraciones simultáneamente con el volcado. [Procedimiento oficial de Supabase](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

Los archivos SQL y un manifiesto de tamaños/SHA-256 se empaquetan, comprimen y cifran usando AES-256-GCM. La clave se deriva con scrypt (`N=32768,r=8,p=1`, sal aleatoria de 32 bytes); cada copia tiene nonce aleatorio de 12 bytes y etiqueta autenticada de 16. El encabezado está autenticado. Un archivo alterado o una clave incorrecta impiden ejecutar SQL; la salida parcial se elimina. Los temporales se crean fuera del repositorio, con permisos restringidos donde el sistema lo admite, y se eliminan al terminar. Solo se sube `*.ita.enc`. Nunca adjuntar SQL a incidencias ni habilitar `--debug` en el workflow. [API criptográfica de Node](https://nodejs.org/api/crypto.html).

El respaldo de base no incluye configuración del proveedor: URL de acceso/redirect de Auth, política de registro, correo/proveedores de identidad, claves API/JWT, contraseñas de conexión, secretos de funciones ni configuración de Cloudflare/GitHub. Registrar estos ajustes en un inventario privado del soporte y recrearlos en el destino. Las contraseñas de roles PostgreSQL de login no se recuperan con el volcado de roles. Los archivos de Storage necesitan una copia separada; la primera versión no usa fotografías. Vault y cifrado de columnas, si se incorporan después, requieren su procedimiento de claves separado. No dar por recuperado el acceso porque existan dos filas de perfiles. [Alcance oficial de copias](https://supabase.com/docs/guides/platform/backups).

## Activación bajo control de la dueña

Responsable técnico: **pendiente de designar**. Supervisión propuesta: dueña; confirmación pendiente. Medio independiente y frecuencia de copia externa: **pendientes de acordar**, utilizando recursos gratuitos existentes. La clave de recuperación debe quedar bajo control de la dueña, separada de GitHub y del archivo cifrado; comprobar que otra persona autorizada puede recuperarla en caso de ausencia del soporte. No enviar claves por conversaciones, correo ni documentación del repositorio.

En Settings → Secrets and variables → Actions, configurar:

| Tipo     | Nombre                            | Valor                                                                                                                                                                                                                                                       |
| -------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secret   | `ITA_BACKUP_DATABASE_URL`         | Conexión Session pooler del proyecto existente `mrnzvgivfjivuobpgens`, puerto 5432 y contraseña codificada en URL. El procedimiento oficial necesita el rol PostgreSQL administrativo; este secreto solo se entrega al job de respaldo, nunca al navegador. |
| Secret   | `ITA_BACKUP_RECOVERY_KEY`         | Clave aleatoria de al menos 32 bytes, generada y guardada en un gestor seguro por la persona responsable. No reutilizar la contraseña de la base.                                                                                                           |
| Variable | `ITA_BACKUP_BUDGET_BYTES`         | Presupuesto medido de almacenamiento, positivo y no mayor de `350000000`.                                                                                                                                                                                   |
| Variable | `ITA_OTHER_ACTIONS_STORAGE_BYTES` | Consumo observado de otros repositorios de la cuenta; escribir `0` explícitamente si no existe.                                                                                                                                                             |
| Variable | `ITA_BACKUP_ENABLED`              | `true` solo después de revisar cuota, clave y recuperación. Ausente o distinto mantiene el job desactivado.                                                                                                                                                 |

No crear otro repositorio/proyecto, habilitar Pro, branching, tarjeta ni complementos pagos. El workflow solo admite programación y ejecución manual; no se ejecuta sobre pull requests. Sus permisos GitHub son lectura del código y gestión de artefactos para rotar copias. Las acciones están fijadas a commits completos verificados y la CLI a una versión fija. La cuenta titular debe mantener bloqueado cualquier gasto adicional.

Antes de habilitarlo, medir una copia ficticia manual: tiempo, bytes SQL/cifrados, salida de Supabase, minutos y almacenamiento de Actions de toda la cuenta. El script lista los artefactos del repositorio, suma la cuota externa declarada y reserva un millón de bytes adicional por subida. Límite de trabajo: 350 MB frente a los 500 MB presupuestados, dejando 150 MB de margen. El uso global declarado debe revisarse periódicamente; el token del job no consulta facturación de toda la cuenta. El control es preventivo, no una garantía ante consumo externo simultáneo. Si excede el presupuesto, falla sin subir ni contratar capacidad. [Facturación de Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

Conserva hasta siete copias dentro del presupuesto y siete días de retención. Antes de subir, puede eliminar las copias más antiguas de este proceso, conservando siempre la más reciente existente. Nunca elimina artefactos de compilación u otros procesos. Cuando no cabe una nueva copia junto a la última, se detiene: descargar una copia independiente y revisar tamaño/cuota. Los archivos vencidos dejan de estar disponibles; por eso siete artefactos no sustituyen la custodia independiente. [Retención y artefactos](https://docs.github.com/en/actions/tutorials/store-and-share-data).

## Supervisión y ejecución manual

El horario configurado es 03:23 en Bogotá, todos los días. GitHub puede retrasar u omitir ejecuciones y desactivar programación en repositorios públicos inactivos. La aplicación muestra el estado exclusivamente a la dueña; un registro ausente, fallo o copia de más de 24 horas necesita revisión. Un estado `running` que no termina tampoco prueba éxito. Solo se marca `success` después de que GitHub confirme la subida del artefacto cifrado. Si la conexión a la base impide publicar el fallo, la copia previa irá apareciendo atrasada. [Limitaciones de programación](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

Desde Inicio/Ajustes, la dueña abre [Respaldo cifrado de ita en Actions](https://github.com/MarycieloBerrio/ita/actions/workflows/backup.yml), inicia **Run workflow**, abre la ejecución terminada y descarga su artefacto. Debe usar su cuenta GitHub autorizada. Descomprimir el ZIP de GitHub produce un archivo `ita-backup-… .ita.enc`, todavía cifrado. Copiarlo al destino independiente acordado y conservar su hash. La aplicación no recibe tokens GitHub ni la clave de recuperación.

## Recuperación en entorno separado

La herramienta de recuperación rutinaria **solo acepta un destino local explícito** con nombre `ita_restore_…`; rechaza destinos remotos, la base administrativa, una base con esquema `ita_private` o con usuarias Auth existentes. No contiene `DROP`, `TRUNCATE` ni `--clean`. El soporte prepara el destino compatible y vacío antes de ejecutar el script. Un volcado Supabase requiere los esquemas/roles administrados de una instalación local compatible; un PostgreSQL vacío por sí solo no proporciona Supabase Auth.

1. Recuperar de manera independiente archivo cifrado y clave. Preparar Node 22, `psql`, `tar` y destino local separado. Usar una versión de PostgreSQL compatible con el origen; no restaurar en el proyecto en operación.
2. Inyectar `ITA_RESTORE_DATABASE_URL` y `ITA_BACKUP_RECOVERY_KEY` mediante el gestor de secretos o sesión segura, sin escribir claves literales en historial. En Windows, `ITA_PG_BIN` puede apuntar a la carpeta `bin` de PostgreSQL.
3. Ejecutar, sustituyendo solo la ruta y el nombre del destino revisado:

   ```sh
   node scripts/restore.mjs /ruta/segura/copia.ita.enc --confirm-local-target ita_restore_revision
   ```

4. La herramienta autentica la copia completa, valida lista de archivos, tamaños y hashes; restaura roles/esquema/datos/historial en una sola transacción con `ON_ERROR_STOP`. Los desencadenadores se desactivan durante carga siguiendo la guía de Supabase. Un error revierte la transacción. No editar automáticamente errores de roles/plataforma: revisar en el entorno separado y seguir la guía oficial.
5. Comparar conteos y datos: clientas, catálogo, fichas/planos, cuentas/pagos, inventario, citas, cumpleaños e historial de migraciones. Verificar saldo y stock derivados y restricciones por API. Iniciar sesión realmente con ambas cuentas en el servicio Auth del destino, recuperar acceso y comprobar que la trabajadora no obtiene cuentas/citas ajenas. Restaurar configuración de Auth y publicaciones Realtime cuando correspondan.
6. Registrar resultado, duración y copia utilizada sin datos personales. La decisión de recuperar producción requiere destino, soporte y autorización específicos; este script no sustituye ni destruye el proyecto existente.

Objetivos propuestos: copia de no más de 24 horas y recuperación en un día laborable con copia válida y soporte disponible. No son garantías del proveedor gratuito.

## Evidencia local y pendientes

Ejecutado el 12 de septiembre y repetida la recuperación nativa el 13 de septiembre de 2026:

- `npx vitest run tests/backup.test.mjs`: **10 pruebas aprobadas**; retorno exacto de Unicode/binarios, clave incorrecta, alteración de datos/encabezado/tag, truncamiento, protección de archivos existentes, tamaño de descompresión, destino separado y retención/cuotas.
- `node tests/backup-restore.mjs`, con `ITA_TEST_DATABASE_URL` apuntando al clúster PostgreSQL **17.4 local** y `ITA_PG_BIN` a sus binarios: **recuperación aprobada**, 23 tablas de aplicación idénticas, historial de migraciones, dos identidades/RLS; cuenta de $230.000, abono de $100.000 y saldo de $130.000, stock de 2 unidades, agenda de trabajadora privada y cumpleaños del 29 de febrero. Origen y destino se crearon y eliminaron exclusivamente en el clúster local desechable. Artefacto de muestra: aproximadamente 26 KB.

La prueba nativa usa `pg_dump` y el script real de descifrado/restauración; su tabla local `auth.users` es un soporte de prueba de UUID/RLS. **No equivale a probar contraseñas, sesiones ni recuperación HTTP de Supabase Auth**. Pendiente ejecutar el volcado CLI en el proveedor, subida/descarga de GitHub, medición con volumen representativo, restauración de Auth completo y configuración/custodia con la persona responsable. No se ha activado el workflow remoto desde este desarrollo.
