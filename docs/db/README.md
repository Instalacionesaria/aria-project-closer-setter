# Base de datos — módulo Closer

Proyecto Supabase: **SOFIA** (`pajhjpzydkkpmjdofqqp`).

## Dónde viven las tablas

En `public`, con prefijo `closer_`. SOFIA ya aloja cuatro sistemas — `agentforge_*`,
`aria_brain_*`, `ht_*`, `ob_*` — y todos usan esa convención. Un esquema aparte habría
obligado a agregarlo a los expuestos por PostgREST, que es un ajuste a nivel proyecto y
habría afectado a los otros sistemas.

Todas las tablas tienen **RLS activado y ninguna política**. Es la postura de 29 de las 35
tablas existentes, y es la correcta: `public` está expuesto por PostgREST, así que una
tabla sin RLS es legible y escribible con la anon key — la que viaja en el bundle del
browser. Sin políticas solo pasa `service_role`, o sea que todo el acceso entra por las
funciones de `api/` y el cliente nunca toca las tablas directo.

## Migraciones

Todas **aplicadas en SOFIA el 2026-07-25**, en este orden.

| Archivo | Qué hace | Por qué existe |
|---|---|---|
| `001_seguimientos.sql` | 7 tablas, 5 enums, 2 funciones, 1 vista | El esquema base |
| `002_bootstrap.sql` | La org y un closer | Sin esto `closer_id` no tiene a qué apuntar y el primer Avanzar falla con un error de FK poco descriptivo |
| `003_registrar_seguimiento.sql` | Función atómica de registro | Son cuatro escrituras; desde Node eran cuatro round trips sin transacción, y si la creación fallaba tras cerrar el anterior el contacto quedaba **sin** seguimiento en silencio |
| `004_historial_borrable.sql` | El trigger deja de bloquear `DELETE` | Bloquear el UPDATE es el punto (la historia no se reescribe); bloquear el DELETE hacía que ningún dato fuera borrable, ni el de prueba ni el de alguien que pidiera supresión |
| `005_permisos_funciones.sql` | Revoca `closer_hoy_org()` y la vista a `anon` | Eran alcanzables con la llave pública, la que viaja en el bundle del browser |

Son idempotentes (`create ... if not exists`, `do $$ ... exception when duplicate_object`,
`on conflict do nothing`), así que se pueden volver a correr sin romper nada.

### Cómo aplicar

Con el CLI, una vez linkeado el proyecto:

```bash
npx supabase db push
```

O pegando el archivo en el SQL editor del dashboard. Durante el desarrollo se aplicó vía la
Management API (`POST /v1/projects/{ref}/database/query`) con un access token personal, que
evita el prompt interactivo de contraseña del `supabase link`.

## Qué guarda esta base y qué no

`CONTRATO-GHL.md` §0 dice que el tool no almacena datos propios. Se respeta casi entero:
**GHL sigue siendo la fuente de verdad del negocio**. La situación del seguimiento es el
custom field `nivel_de_inters_seguimiento`, el modo es un tag (`seguimiento_recupero` /
`seguimiento_manual`), y el stage lo mueve un workflow. Nada de eso se duplica acá.

Lo que sí vive acá es el estado **operativo**, que GHL no puede sostener:

1. **La fecha objetivo del seguimiento manual.** GHL solo necesita saber que el contacto
   está en manual para no dispararle la serie automática; el día en que reaparece en la
   cola es lógica de cola de trabajo, y no tiene campo ni workflow en el contrato.
2. **Fijar y completado del día** — estado de la cola, no del contacto.
3. **Outbox e inbox** — para que un fallo de red no pierda una intención.

Desviación consciente, decidida el 2026-07-25.

## Invariantes que garantiza la base (no el código)

Verificadas con una prueba de humo de 13 checks contra SOFIA:

- **Un solo seguimiento abierto por contacto** — índice parcial único. El doble submit y
  las dos pestañas abiertas pasan a ser una violación reintentable en vez de dos filas y
  dos tags en GHL.
- **`closer_hoy_org()` es el único origen de "hoy"** — nunca `current_date`, que en Supabase
  corre en UTC y a las 20:00 de Lima daría el día siguiente.
- **El historial es append-only** — trigger que rechaza UPDATE y DELETE.
- **Un evento de sistema no puede firmar como persona** — `CHECK` que obliga
  `autor_tipo='sistema'` ⇒ `autor_nombre='Sistema'`. Es `CLAUDE.md` §2 como constraint.
- **Un seguimiento manual no puede llevar datos de serie**, y **cerrar exige motivo y fecha**.
- **Un toque reenviado por un reintento de GHL no se cuenta dos veces** — índice único sobre
  `(seguimiento_id, payload->>'toque_n')`.
- **Una serie automática en curso no aparece en la cola**; solo cuando se agota.

La prueba de humo termina con un `raise exception` deliberado: aborta el bloque y revierte
todo lo insertado, así no deja residuo por construcción. Un `delete` no serviría — el
trigger append-only lo rechaza, que es justamente lo que se está verificando.

## Cosa a saber si tocás el historial

`closer_contacto_eventos.seguimiento_id` es `on delete no action`, **no** `set null`. Un
`set null` sería un UPDATE sobre la tabla append-only, y el trigger lo rechazaría: borrar un
seguimiento fallaría con un error incomprensible. Es coherente con el diseño — acá nada se
borra en duro, los seguimientos se cierran (`cancelado`, `reemplazado`) y quedan.
