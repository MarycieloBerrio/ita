# API y reglas de integridad

La referencia de tipos es `src/lib/contracts.ts`. Los importes viajan como números enteros de pesos COP y se almacenan como `bigint`, limitados a `9007199254740991` para conservar exactitud también en JavaScript. `null` significa precio pendiente; nunca se sustituye por cero. Los instantes son ISO 8601 con zona. Fechas, períodos y cumpleaños se interpretan en `America/Bogota`.

## Superficie y permisos

Solo se exponen dos RPC en `public`:

```ts
supabase.rpc('app_query', { p_action: 'visit', p_payload: { id: visitId } });
supabase.rpc('app_command', {
  p_action: 'payment.record',
  p_payload: { account_id: accountId, amount: 50000, method_id: methodId, paid_at: isoDate },
  p_operation_id: operationId,
});
```

Ambos requieren una sesión Auth y un perfil activo en `ita_private.profiles`. La identidad procede de `auth.uid()`; el rol procede de esa tabla, nunca de datos editables de Auth. Una identidad sin perfil, inactiva o sin sesión no obtiene datos. Los RPC públicos son `SECURITY INVOKER`; llaman a dos despachadores privados `SECURITY DEFINER`, con `search_path` vacío y autorización explícita para cada acción. Los demás ayudantes no tienen permiso de ejecución para los roles del navegador.

Todas las tablas de negocio viven en `ita_private`, tienen RLS habilitado y deniegan acceso directo a `anon` y `authenticated`. No publicar este esquema en Data API ni conceder lectura directa: las respuestas autorizadas omiten información sensible que no corresponde al rol. Ocultar controles en la interfaz no interviene en esta protección.

| Operación                                            | Dueña                  | Trabajadora                                    |
| ---------------------------------------------------- | ---------------------- | ---------------------------------------------- |
| Directorio activo y ficha técnica de clientas        | Compartido             | Compartido                                     |
| Archivar clientas, exportar datos                    | Sí                     | No                                             |
| Agenda, visitas, cuentas, cobros                     | Todas                  | Solo profesional asignada igual a su identidad |
| Cambiar responsable                                  | Con motivo y auditoría | No                                             |
| Catálogo, métodos, perfiles, ajustes                 | Sí                     | Solo lectura necesaria para trabajar           |
| Existencias y productos disponibles                  | Sí                     | Lectura sin costos ni movimientos internos     |
| Ventas en visita propia                              | Sí                     | Sí; confirmación descuenta unidades            |
| Salidas manuales, egresos, caja, finanzas, auditoría | Sí                     | No                                             |
| Rectificar importe o pago confirmado                 | Con motivo y auditoría | No                                             |

El historial compartido excluye precios, cuentas, pagos e identificadores de citas. Los UUID de fichas históricas permiten copiar contenido técnico a una nueva ficha; esa copia obtiene una selección y tarifa actuales y no arrastra ventas, precio personalizado ni fecha de mantenimiento.

## Consultas

`bootstrap`, `settings`, `catalog` e `inventory` entregan configuración y datos según rol. `clients` y `visits` devuelven `{items,total}`; aceptan `search`, `limit` (1–200, predeterminado 50) y `offset` o `page` desde cero. `client` devuelve ficha, alertas de posibles duplicados e historial técnico paginado. Las coincidencias por nombre/teléfono avisan y no impiden crear clientas homónimas.

`appointments` acepta `from`, `to`, `professional_id` e `id`; el filtro de profesional no amplía permisos. Fechas simples incluyen ambos días; instantes ISO forman un intervalo con extremo final exclusivo. `birthdays` proyecta eventos anuales, sin crear citas. Los períodos tienen un máximo de 371 días.

`visit` entrega fichas independientes y la cuenta conjunta. `account` permite revisar ventas y pagos después de terminar la visita. `finance` separa cargos por prestación/entrega, ingresos por fecha real de cobro y egresos. Sus saldos pendientes son globales al momento de la consulta, no solo del período. `audit` pagina los cambios y sus motivos. `operation` consulta el resultado de una operación propia y vuelve a comprobar la autorización actual.

### Exportación completa en JSON

`export` con `scope: 'global'` descarga los 22 conjuntos de registros del negocio, incluidos archivos históricos, rectificaciones, auditoría, preferencias de cumpleaños y estado de respaldos. Se excluyen Auth, credenciales y el registro interno de reintentos `operations`. El ámbito `client`, con `id`, incluye todas las visitas y fichas de esa clienta, también anuladas, sus citas, cuentas, ventas, pagos y movimientos relacionados, además de sus referencias de catálogo/configuración. No limita el historial a las 50 filas de la pantalla. La dueña tiene acceso desde Ajustes o desde la ficha de clienta; la trabajadora recibe rechazo en servidor para cualquier ámbito de exportación.

La primera consulta devuelve un manifiesto con tablas, cantidades y `revision`. Cada página solicita `table`, `offset`, `limit` y esa misma revisión; devuelve `items`, `total` y `next_offset`. Los nombres de tabla se validan contra una lista cerrada. La aplicación reúne fragmentos JSON sin mantener todos los objetos de la base en memoria, comprueba cada recuento y solicita una validación final de permisos/revisión antes de crear el archivo. Cancelar la pantalla o fallar una página no produce una descarga parcial.

Cada consulta usa una instantánea SQL estable. La revisión combina número e identificador máximo de auditoría con el estado de cumpleaños y respaldos. Un cambio confirmado entre páginas devuelve `40001` y requiere iniciar otra descarga, evitando combinar versiones incompatibles mientras las usuarias trabajan. No se bloquea el trabajo del salón durante la exportación. El archivo contiene versión de formato, fecha de generación, COP, zona horaria, recuentos y datos originales en JSON; el texto libre no se interpreta como HTML o fórmulas.

Los ámbitos auxiliares `finance`, `clients` e `inventory` conservan su respuesta de informe/listado; la interfaz de descarga integral utiliza explícitamente `global` o `client`. Una exportación operativa no incluye esquema, contraseñas ni configuración de Auth y no sustituye el respaldo cifrado recuperable.

## Escrituras, reintentos y concurrencia

Cada `app_command` se ejecuta en una única transacción. El navegador genera un UUID una vez por intención y conserva exactamente acción, datos y UUID mientras una respuesta sea incierta. Repetirlos devuelve el mismo resultado sin volver a cobrar, vender ni mover stock. Reutilizar el UUID con otros datos o identidad se rechaza. El servidor vuelve a verificar permisos actuales al repetir o consultar una operación: una reasignación no deja un acceso residual mediante claves antiguas.

Las ediciones de registros versionados exigen la última `version`; un conflicto devuelve `40001`. La aplicación debe recargar y permitir revisar el borrador antes de intentar una nueva intención. Errores de transporte no autorizan crear otro UUID. Las lecturas pueden reintentarse; no existe una cola para operar sin conexión.

La cuenta se bloquea antes de cambiar fichas, ventas, pagos o responsable. Las unidades se serializan mediante la fila de producto y se vuelve a calcular el saldo antes de confirmar. Las citas usan un bloqueo por profesional y comprueban intervalos semiabiertos: dos profesionales pueden coincidir y las citas contiguas son válidas. Los movimientos que afectan caja y el cierre comparten un bloqueo breve para que el arqueo no omita un pago concurrente.

## Estados y conservación histórica

Una cita crea como máximo una visita. Iniciarla otra vez devuelve el vínculo existente. Después de iniciar, el estado de la cita se gobierna desde esa visita; se puede reprogramar sin desvincularla. Finalizar la visita completa la cita y no implica pago. Anular por error exige dueña y motivo, rechaza pagos o ventas confirmados, anula las fichas y marca la cita vinculada como cancelada. Conserva el vínculo único y no reabre la reserva ni repone inventario. Una nueva atención requiere una nueva visita.

Cada servicio conserva nombre, ruta del catálogo, tipo de ficha, modalidad y precio de referencia seleccionados. Cambiar el catálogo no altera operaciones previas. Actualizar la tarifa de un borrador es una acción explícita. Las tandas de depilación comparten método y datos iniciales, pero mantienen una línea de cobro independiente por zona y ningún cargo adicional por agrupar.

Una ficha técnica realizada puede conservar un precio personalizado pendiente. Su profesional puede asignarle el primer importe después; modificar un importe ya aplicado a una ficha realizada requiere rectificación de la dueña. Una ficha finalizada no regresa a borrador. El documento técnico conserva versión, cinco proyecciones, zonas y una de las cuatro divisiones con color exclusivamente en texto libre.

No se cobra hasta que todas las prestaciones/entregas estén confirmadas, cada importe esté definido y no queden ventas en borrador. Se aceptan pagos positivos hasta el saldo pendiente, con fecha real posterior al trabajo; se rechazan anticipos, sobrepagos y fechas futuras. Las rectificaciones de pagos y egresos conservan original, sustituto y motivo. Los saldos usan únicamente los movimientos vigentes. La auditoría conserva también los valores anteriores de cargos y fichas.

Los materiales anotados en fichas no crean movimientos de inventario. Las salidas de uso interno son manuales de la dueña. Confirmar una venta crea su salida atómica única. Se impide stock negativo y archivar productos con existencias. Una corrección de inventario registra una cantidad diferencial y enlaza el movimiento original; no representa una devolución comercial.

Los cumpleaños se calculan sin filas anuales duplicadas. El último día del mes se muestra el siguiente; si no se abrió la aplicación, se recupera el aviso del mes actual. Su lectura se guarda por identidad y mes. El 29 de febrero se observa el 28 fuera de años bisiestos, conservando la fecha original. Estas últimas convenciones son revisables en el prototipo. No hay recordatorios de citas.

## Verificación reproducible

`node scripts/db-test.mjs` crea PostgreSQL PGlite aislado y aplica todas las migraciones. `node scripts/db-test.mjs --native` usa PostgreSQL 17 local en `127.0.0.1:55433` con usuario `ita_test`, crea una base temporal y añade carreras entre conexiones reales. `node scripts/db-benchmark.mjs` mide búsqueda y guardado con 2.000 clientas y 20.000 visitas ficticias. Los scripts nativos no aceptan una base remota como destino.

La suite verifica permisos, reintentos, versiones, cuentas múltiples, persistencia del plano, pagos parciales en fechas distintas, tarifas históricas, inventario, estados enlazados y cumpleaños. `scripts/db-export.mjs` verifica exportación de más de 50 fichas, cobertura global, límites de tablas, exclusión de credenciales y rechazo de revisiones concurrentes. `tests/export-records.test.ts` verifica ensamblado, cancelación y que nunca se entregue un archivo parcial. La suite SQL emula solamente la identidad de Auth en el entorno local: no prueba por sí misma el servicio Auth hospedado, HTTP, recuperación de contraseñas o configuración Data API. Esos puntos requieren la verificación remota separada antes de operar.

Una migración aplicada es inmutable; todo cambio posterior debe publicarse mediante otra migración. Para respaldo y restauración, seguir `docs/backup.md`; exportar un informe no sustituye ese proceso.
