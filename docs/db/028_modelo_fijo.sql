-- 028 · El modelo del auditor deja de ser configurable (2026-08-07)
--
-- `anthropic_modelo` y `anthropic_thinking` pasan a ser **constantes del código**
-- (`MODELO_AUDITOR` y `ESFUERZO_AUDITOR` en `api/_lib/analizador.ts`): `claude-sonnet-5` con
-- esfuerzo `high`, para los dos carriles del auditor y para todas las empresas.
--
-- ── Por qué se quita la configurabilidad ────────────────────────────────────
--
-- El motivo sale de este mismo repo. `AUDITOR_SIN_PORTON_TAGS` demostró que un comportamiento
-- gobernado por una variable de entorno **se vuelve a encender solo** en cualquier entorno donde
-- la variable no esté — un preview, un clon local, un proyecto nuevo. Un modelo elegido por
-- config tiene el mismo problema al revés: una empresa podía quedar auditando con otro modelo sin
-- que nadie lo hubiera decidido, y sin que apareciera en ningún diff.
--
-- Cambiar el modelo pasa a ser un cambio de código. Es más incómodo, y esa es la idea.
--
-- ── DROP y no "marcar muerta", a diferencia de `rol` ────────────────────────
--
-- Las dos columnas se dropean de verdad, y es una decisión distinta de la que se tomó con
-- `closer_usuarios.rol` (que se dejó nullable y sin usar). Los dos criterios y por qué acá gana
-- el DROP:
--
--   · **Nadie las lee.** El código que las consultaba se fue en el mismo commit; no hay ventana
--     de "código viejo que todavía las necesita", que es lo que el expand→deploy→contract protege.
--   · **Son de días, no de meses.** Nacieron en la `018` el 2026-08-06. No hay historia que
--     preservar: cuatro filas, todas con el default.
--
-- El riesgo del DROP en este proyecto no es el DROP en sí: es el **schema cache de PostgREST**,
-- que después de un `ALTER TABLE` sigue creyendo en el esquema viejo y hace fallar el primer
-- INSERT con `42703` sobre una columna que existe. El `notify pgrst` del final es lo que lo
-- resuelve, y es la misma línea que lleva cualquier otra migración de este repo.
--
-- `assistable_cuenta_id` NO se dropea acá. Ver su comentario en `api/_lib/credenciales.ts`: se
-- deja de leer ahora y se dropea junto con `closer_usuarios.rol`, en el contract general.

alter table public.closer_org_config
  drop column if exists anthropic_modelo,
  drop column if exists anthropic_thinking;

-- Sin esto el primer INSERT falla con 42703 sobre una columna que existe.
notify pgrst, 'reload schema';
