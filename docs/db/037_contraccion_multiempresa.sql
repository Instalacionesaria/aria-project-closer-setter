-- 037 · La contracción del multi-empresa (2026-08-08)
--
-- El multi-empresa se hizo en tres pasos —expand, deploy, contract— y el tercero quedó pendiente.
-- Esto es ese paso: se van las **cuatro** cosas que sobrevivieron a su reemplazo.
--
-- ── Por qué no da lo mismo dejarlas ───────────────────────────────────────
--
-- Porque las tres funciones viejas no fallan: **resuelven**. Postgres elige la sobrecarga por la
-- cantidad de argumentos, así que un llamador que se olvide del `p_org_id` no recibe un error —
-- recibe la versión global, que opera contra la empresa principal. Es el mismo agujero que la `035`
-- cerró en `closer_registrar_seguimiento`, pero repartido en tres pares de funciones donde el
-- olvido ni siquiera necesita un default para pasar desapercibido: le alcanza con existir.
--
-- Mientras hubo una sola empresa eso era invisible por definición. Con cinco clientes, cada una de
-- estas seis funciones es un camino por el que el dato de un cliente entra al de otro sin ruido.
--
-- ── El grep de llamadores, antes de cada DROP ─────────────────────────────
--
-- Regla del plan de lanzamiento: nada se dropea sin haber buscado quién lo llama. Lo que se
-- encontró, verificado contra la base viva y contra el árbol de código:
--
--   closer_hoy_org()                      · Node: 0. `repo.ts` pasa `p_org_id: orgActiva()`.
--                                           SQL:  0. La vista `closer_seguimientos_de_hoy` llama
--                                                 `closer_hoy_org(s.org_id)`, y
--                                                 `closer_registrar_seguimiento`, `(p_org_id)`.
--   closer_dia_org(timestamptz)           · Node: 0 — ninguna de las dos formas se llama desde TS.
--                                           SQL:  0. `closer_indicadores_contacto` usa
--                                                 `closer_dia_org(a.org_id, a.created_at)`.
--   closer_auditor_claim(text, integer)   · Node: 0. `analizador.ts:1540` pasa las tres.
--   closer_usuarios.rol                   · Node: 0. `auth.ts` y `admin/usuarios.ts` leen `roles[]`.
--                                           SQL:  0 vistas, 0 índices, 0 CHECK.
--
-- Los `rol` que quedan en el código son de **`closer_avances.rol`**, el discriminador de la `032`.
-- Se llaman igual y no tienen nada que ver: ése está vivo y es el que separa al setter del closer.
--
-- ── `rol` singular vs `roles[]` ───────────────────────────────────────────
--
-- La columna vieja aguantaba un rol por persona, y el producto necesita varios: alguien puede ser
-- closer y setter, y el admin principal es `{super_admin, admin}`. `roles text[] not null` la
-- reemplazó y `rol` quedó como un fósil desincronizado — de cuatro usuarios en producción, uno lo
-- tiene lleno y tres en `null`, con `roles` correcto en los cuatro. Una columna que dice la verdad
-- en el 25% de las filas es peor que una que no existe: el día que alguien la lea "porque está ahí",
-- tres de cuatro usuarios se quedan sin permisos.

drop function if exists public.closer_hoy_org();
drop function if exists public.closer_dia_org(timestamptz);
drop function if exists public.closer_auditor_claim(text, integer);

alter table public.closer_usuarios drop column if exists rol;

notify pgrst, 'reload schema';
