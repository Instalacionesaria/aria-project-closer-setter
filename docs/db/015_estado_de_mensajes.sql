-- 015 — El estado real de cada mensaje saliente (2026-08-05)
--
-- Bug encontrado por Fabio: mandó un mensaje desde Comando Central, la plataforma lo dio por
-- enviado, y nunca llegó. En GHL el mensaje estaba ahí en rojo:
--
--   "Message failed to send because more than 24 hours have passed since the customer last
--    replied to this number."
--
-- Es la ventana de servicio de 24 h de WhatsApp Business: fuera de ella Meta solo acepta
-- plantillas aprobadas, no texto libre.
--
-- ── Por qué el código no se enteró ──
--
-- `POST /conversations/messages` devolvió **2xx**. GHL acepta el mensaje, le crea su fila, y
-- recién DESPUÉS Meta lo rechaza y GHL le pone `status: "failed"` con un `error` en texto.
-- Nuestro `if (!r.ok)` no puede ver eso: para cuando el fallo existe, la respuesta HTTP ya
-- se contestó hace rato. Verificado sobre el mensaje real `yv2CyC1ckGe47Js01QNV`.
--
-- O sea que el estado de entrega **no es un valor de retorno, es un hecho que evoluciona**, y
-- por eso vive en una columna que la reconciliación mantiene, igual que el resto del caché.
--
-- ── Sin CHECK, a propósito ──
--
-- El vocabulario de estados es de GHL/Meta, no nuestro (`delivered`, `read`, `failed`,
-- `pending`, `undelivered`…). Un CHECK sobre una lista que no controlamos convierte cualquier
-- estado nuevo en un INSERT fallido — y lo que se rompería es la INGESTA, o sea el chat
-- entero, por un valor que solo queríamos mostrar. Se guarda el string tal cual.

begin;

alter table public.closer_mensajes
  add column if not exists estado text;

-- El texto del error tal como lo da GHL, sin traducir ni recortar acá: es lo que se le
-- muestra al closer para que sepa QUÉ pasó, y traducirlo en la base impediría reconocerlo
-- cuando Meta cambie la redacción.
alter table public.closer_mensajes
  add column if not exists error_envio text;

comment on column public.closer_mensajes.estado is
  'Estado de entrega según GHL: delivered | read | failed | pending | … NULL = ingerido antes '
  'de 015, o la vía que lo trajo no lo sabía. Sin CHECK: el vocabulario es de GHL, no nuestro.';
comment on column public.closer_mensajes.error_envio is
  'Por qué falló, en las palabras de GHL. Se muestra tal cual en el chat.';

-- El chat pide los fallidos de un contacto para pintarlos en rojo. Parcial: los entregados
-- son la enorme mayoría y no hacen falta en este índice.
create index if not exists idx_mensajes_fallidos
  on public.closer_mensajes (ghl_contact_id, timestamp_ghl desc)
  where estado = 'failed';

commit;

-- Obligatorio (§51.5): sin esto PostgREST sigue sirviendo el schema viejo y el primer INSERT
-- contra las columnas nuevas falla con 42703 aunque el ALTER haya corrido.
notify pgrst, 'reload schema';
