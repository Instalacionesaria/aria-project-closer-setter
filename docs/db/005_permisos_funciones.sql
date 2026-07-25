-- ============================================================================
-- Migración 005 · Menor privilegio en las funciones del módulo
--
-- `closer_registrar_seguimiento` ya estaba cerrada (003), pero `closer_hoy_org` quedó
-- ejecutable por `anon` — o sea, por cualquiera con la llave pública, que viaja en el
-- bundle del browser.
--
-- Lo que filtra es trivial: una fecha. No es una vulnerabilidad, pero tampoco hay razón
-- para que esté abierta, y una función interna accesible desde afuera es el tipo de cosa
-- que se descubre tarde. Solo `service_role` la necesita: es a través de las funciones de
-- `api/` que se consulta.
--
-- Auditado el 2026-07-25 con la anon key contra la base real: el INSERT directo lo bloquea
-- el RLS ("new row violates row-level security policy"), la RPC de registro devuelve
-- "permission denied for function", y las lecturas devuelven cero filas. Esto cierra lo
-- último que quedaba abierto.
-- ============================================================================

revoke all on function closer_hoy_org() from public, anon, authenticated;
grant execute on function closer_hoy_org() to service_role;

-- La vista lee de tablas con RLS y `security_invoker`, así que ya devuelve vacío para
-- anon. Se le quita el acceso igual: que la consulta se pueda formular no aporta nada.
revoke all on closer_seguimientos_de_hoy from anon, authenticated;
grant select on closer_seguimientos_de_hoy to service_role;
