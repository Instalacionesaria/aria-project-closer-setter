-- 036 · Baja de `closer_conexiones` (2026-08-08)
--
-- La tabla que guardaba las credenciales **antes del multi-empresa**: una fila global con el PIT,
-- la key de Anthropic, el locationId y el calendarId, más columnas generadas `*_ultimos4` para no
-- devolver nunca un secreto entero. Buena idea, y el endpoint que la servía estaba bien escrito.
--
-- El problema no era cómo estaba hecha: era que **nadie la leía**. Su propio encabezado lo decía
-- de frente desde el día uno —*"guarda las credenciales, pero nadie las lee todavía: el backend
-- sigue tomando todo de `process.env`"*— y eso nunca dejó de ser cierto. El multi-empresa la
-- reemplazó con `closer_org_config`, que tiene las mismas cuatro credenciales **por empresa**, los
-- dos secretos cifrados con AES-256-GCM (§5.1), y que sí las lee: `credenciales.ts` las resuelve
-- en cada request.
--
-- ── Por qué se borra en vez de dejarla ahí ────────────────────────────────
--
-- Porque dos lugares donde escribir el mismo PIT, uno de los cuales no tiene efecto, es un modo de
-- fallo esperando su turno: alguien carga la credencial en el panel viejo, ve "guardado", y la app
-- sigue andando contra otra. Eso no se arregla con un cartel — el panel funcionaba y decía la
-- verdad. Se arregla sacando la puerta que no lleva a ningún lado.
--
-- ── Verificado contra producción antes de dropear ─────────────────────────
--
--     filas 0 · fks_entrantes 0 · vistas_dependientes 0
--
-- Y en el código: `api/closer/conexiones.ts` era el único que la tocaba (3 queries), y sus tres
-- envoltorios en `src/lib/api.ts` no tenían **ni un consumidor** en `src/` — el panel de Ajustes ya
-- apuntaba a `/api/admin/configuracion`. Los tres se fueron en el mismo commit que esta migración.
--
-- No hay `create table` de vuelta en ninguna parte: si mañana hiciera falta, está la `010`.

drop table if exists public.closer_conexiones;

notify pgrst, 'reload schema';
