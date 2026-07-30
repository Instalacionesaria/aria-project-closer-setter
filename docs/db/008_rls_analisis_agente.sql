-- ============================================================================
-- Migración 008 · RLS sobre la tabla de análisis + su vista
--
-- ── Qué se está cerrando ──
--
-- `closer_analisis_agente` (migración 007) quedó sin RLS. Es la única tabla `closer_*`
-- en ese estado — las once restantes la tienen activa desde la 001.
--
-- En Supabase eso no es un detalle de configuración: el esquema `public` está expuesto
-- por PostgREST, así que una tabla sin RLS es legible Y escribible con la llave `anon`,
-- que por diseño viaja dentro del bundle que se descarga el browser. No es una llave
-- secreta que se pueda "cuidar": está publicada.
--
-- Comprobado contra SOFIA antes de escribir esto, no deducido del código:
--
--     LECTURA  closer_analisis_agente -> 1 fila visible con la anon key
--     ESCRITURA closer_analisis_agente -> insertó
--     (las mismas dos pruebas contra closer_seguimientos y closer_contactos -> 0 filas)
--
-- Concretamente, cualquiera con la URL del proyecto podía leer los motivos de fallo —
-- que son frases textuales de conversaciones con personas reales, y que además se copian
-- a la nota `[IA]` del contacto en GHL — y podía inyectar veredictos falsos. Lo segundo
-- es lo más caro: los fallos alimentan la cola de intervenciones urgentes y el sparkline
-- de doce semanas, así que una fila inventada le manda trabajo humano a un lead que no
-- lo pidió y contamina una serie histórica que existe justamente para no recalcularse.
--
-- ── Por qué RLS sin ninguna policy ──
--
-- Mismo criterio que la 001: `service_role` salta RLS por definición, y todo lo que
-- escribe acá son funciones serverless que usan esa llave. No hay ningún acceso legítimo
-- desde el browser a esta tabla, así que una policy sería una puerta sin nadie que la
-- necesite. Cero policies = solo pasa el backend.
-- ============================================================================

alter table closer_analisis_agente enable row level security;

-- RLS no alcanza para la vista: una vista consulta con los permisos de SU dueño, no los
-- de quien la llama, así que `closer_agentes_texto_30d` seguiría devolviendo los agregados
-- por encima del RLS que acabamos de activar. Se le quita el grant, igual que se hizo con
-- `closer_mi_dia` en la migración 005.
revoke all on closer_agentes_texto_30d from anon, authenticated;
revoke all on closer_analisis_agente from anon, authenticated;

-- ── Limpieza de la fila de prueba ──
-- La insertó la comprobación de arriba, desde fuera y con la anon key. Se borra por
-- `ghl_contact_id` porque ese valor es el marcador que se le puso a propósito; no hay
-- ningún contacto real con ese id.
delete from closer_analisis_agente where ghl_contact_id = 'PRUEBA_RLS_BORRAR';
