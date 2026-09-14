# Plano de color: prototipo v1 para revisar

Referencia: imagen aportada el 11 de septiembre de 2026. Las cinco vistas y las cuatro opciones están confirmadas. Izquierda y derecha pertenecen a la clienta. No son nombres anatómicos los rótulos Zona 01–08.

La vectorización propone estas uniones de los trazos ambiguos: prolongar el trazo corto frontal de los perfiles hasta el contorno superior; reunir los trazos posterior en un punto interior y separar sus áreas superiores con la línea media. Las líneas punteadas no crean zonas; el trazo que sobresale de la frente tampoco. El contorno del cabello se ha cerrado para permitir tocar áreas interiores. Deben revisarse estas uniones y correspondencias en el prototipo con la dueña antes de operar con fichas reales.

Correspondencia propuesta de superficies:

| Zona    | Vistas                                 |
| ------- | -------------------------------------- |
| 01      | Frontal, superior, lateral izquierdo   |
| 02      | Frontal, superior, lateral derecho     |
| 03      | Superior, posterior, lateral izquierdo |
| 04      | Superior, posterior, lateral derecho   |
| 05 / 07 | Posterior y lateral izquierdo          |
| 06 / 08 | Posterior y lateral derecho            |

No se copian datos entre lados opuestos. El mismo identificador lógico dibuja todas sus superficies. Las representaciones laterales son geométricamente simétricas, sus datos no lo son.

La versión 1 conserva una selección por zona y el procedimiento permite describir fases múltiples. Mantener distintos planos de división por fase requiere decisión de negocio pendiente; no está presentado como una capacidad implementada. Los oxidantes sí admiten varias fases/mezclas independientes.

Límites propuestos: 250 caracteres por color, 10.000 por procedimiento, 40 materiales por grupo. La interfaz avisa sin recortar el texto. La plantilla y patrones versión 1 son inmutables; cualquier cambio de geometría necesita nueva versión y conservar el registro anterior. Una versión desconocida impide la edición, nunca reconstruye silenciosamente con otra plantilla.

Los productos usados/recomendados son texto técnico y no alteran inventario. Las ventas se enlazan por identificador a líneas de la visita. Confirmar venta, stock, cobro y permisos corresponde a la capa de servidor de la cuenta; este módulo no ejecuta ninguna operación económica. El autoguardado y conflictos de versión pertenecen a la pantalla de atenciones que integra `TechnicalForm`.
