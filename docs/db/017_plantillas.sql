-- 017 — Las plantillas aprobadas de WhatsApp, para hablar fuera de la ventana de 24 h.
--
-- ── Por qué esto es una tabla y no una llamada a la API ──
--
-- La 015 enseñó a la plataforma a saber cuándo la ventana de Meta está cerrada. Lo que
-- faltaba era la salida: pasadas las 24 h, lo único que Meta deja mandar es una plantilla
-- previamente aprobada. El paso obvio era listarlas por API. **No se puede**, y está medido:
--
--   GET /locations/{id}/templates?type=whatsapp   → {"templates":[],"totalCount":0}
--   GET /conversations/providers/whatsapp/templates → 404
--   GET /locations/{id}/whatsapp/templates          → 404
--   GET /whatsapp/templates                         → 404
--
-- El primero responde 200 con cero aunque la subcuenta SÍ tenga plantillas aprobadas: su
-- schema de respuesta es `oneOf: [SMS, Email]`, así que una plantilla de Meta no es
-- representable ahí ni aunque quisiera. Viven en Settings > WhatsApp > Templates, que es
-- otro almacén, y la API v2 no lo expone. No es un permiso que falte: no hay ruta.
--
-- Entonces la lista no se descubre, se configura. Que sea tabla y no variable de entorno ni
-- archivo del repo tiene un motivo concreto: agregar una plantilla aprobada no puede exigir
-- un deploy. Meta las aprueba con su propio calendario, y el día que caiga una nueva alguien
-- tiene que poder usarla esa misma tarde.
--
-- ── Dos métodos de envío, porque hay dos caminos y ninguno está confirmado ──
--
-- `template_id` — `POST /conversations/messages` acepta un campo `templateId`. Existe en la
--   spec oficial, pero **no tiene campo de variables**: solo sirve para plantillas sin
--   parámetros, o con los que GHL resuelva solo.
-- `workflow` — `POST /contacts/{id}/workflow/{workflowId}` dispara un workflow de GHL que
--   contiene la acción de enviar la plantilla. Es el camino documentado y el que sí soporta
--   variables, a costa de que alguien arme el workflow en GHL.
--
-- Cuál funciona se decide por plantilla y se prueba con una real; el código soporta los dos
-- desde el día uno para que la respuesta no exija reescribir nada.
--
-- ── Acá el CHECK sí corresponde ──
--
-- Al revés que en la 016, donde `motivo_desconexion` va sin CHECK porque el vocabulario es de
-- Assistable: `metodo` es nuestro, son dos valores y no hay un tercero posible. Y el segundo
-- CHECK impide la fila que rompe en producción y no en la inserción — una plantilla marcada
-- `workflow` sin `workflow_id` se vería perfecta en la lista y fallaría recién al enviar.

begin;

create table if not exists public.closer_plantillas (
  -- Slug nuestro y estable (`reactivacion_24h`), no el id de Meta: es lo que viaja al
  -- browser y lo que queda escrito en el historial cuando alguien la manda.
  id            text primary key,

  nombre        text not null,
  descripcion   text,

  metodo        text not null,
  template_id   text,
  workflow_id   text,

  idioma        text,

  -- El texto tal como Meta lo aprobó, con sus `{{1}}`. No se manda: se MUESTRA. El closer
  -- tiene que ver qué está por enviar antes de apretar, porque una plantilla no se puede
  -- editar ni retirar, y a diferencia de un mensaje libre no la escribió él.
  cuerpo        text not null,

  activa        boolean not null default true,
  orden         integer not null default 0,
  creada_el     timestamptz not null default now(),

  constraint closer_plantillas_metodo_valido
    check (metodo in ('template_id', 'workflow')),
  constraint closer_plantillas_metodo_completo
    check (
      (metodo = 'template_id' and template_id is not null) or
      (metodo = 'workflow'    and workflow_id is not null)
    )
);

comment on table public.closer_plantillas is
  'Plantillas de WhatsApp aprobadas por Meta. Se cargan a mano: la API de GHL no las lista '
  '(medido el 2026-08-06, ver el encabezado de 017_plantillas.sql).';
comment on column public.closer_plantillas.cuerpo is
  'Vista previa para el closer, con los {{1}} de Meta. Nunca se envía este texto.';

-- La lista se pide entera y ordenada; el índice es por el orden en que se muestra.
create index if not exists idx_plantillas_activas
  on public.closer_plantillas (orden, nombre)
  where activa;

alter table public.closer_plantillas enable row level security;
revoke all on public.closer_plantillas from anon, authenticated;

commit;

-- La tabla nace VACÍA a propósito. Sembrarla con ejemplos es exactamente lo que se acaba de
-- desmontar en las pestañas de closer y de auditoría: una plantilla de mentira en el
-- selector se ve idéntica a una aprobada, y la diferencia recién aparece cuando el envío
-- rebota contra un contacto real.

notify pgrst, 'reload schema';
