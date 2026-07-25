-- ============================================================================
-- Migración 004 · El historial deja de bloquear el DELETE
--
-- El trigger original rechazaba UPDATE **y** DELETE. Bloquear el UPDATE es el punto: un
-- timeline inmutable existe para que nadie reescriba lo que pasó. Bloquear el DELETE fue
-- de más, y tiene dos consecuencias que no se ven hasta que duelen:
--
--   1. Los eventos referencian `closer_seguimientos` con `on delete no action`, así que un
--      seguimiento con historial no se puede borrar nunca. En la práctica, ningún dato de
--      este módulo es borrable — ni el de prueba.
--   2. Si un contacto ejerce su derecho a supresión, no hay forma de cumplirlo sin
--      intervención de un superusuario.
--
-- La lectura correcta de "append-only" es que no se REESCRIBE la historia. Borrar es una
-- acción administrativa deliberada, distinta de modificar un registro para que diga otra
-- cosa. Y el riesgo de borrado accidental ya está cubierto por otro lado: estas tablas
-- tienen RLS sin políticas, así que solo `service_role` las alcanza — nunca el browser.
-- ============================================================================

drop trigger if exists closer_eventos_append_only on closer_contacto_eventos;

create trigger closer_eventos_append_only
  before update on closer_contacto_eventos
  for each row execute function closer_evitar_mutacion();

comment on table closer_contacto_eventos is
  'Timeline del contacto. Los UPDATE están bloqueados por trigger: la historia no se reescribe. Los DELETE se permiten para retención y supresión de datos, y solo los alcanza service_role.';
