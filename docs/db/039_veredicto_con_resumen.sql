-- 039 · El veredicto cuenta qué pasó, incluso cuando sale verde (2026-08-10)
--
-- Pedido de Fabio, con un caso concreto: la primera llamada auditada salió **verde** y la pantalla
-- no tenía nada que mostrar. Y "verde" no era falso — el agente no hizo nada mal en 19 segundos —
-- pero tampoco era todo lo que se podía decir: la llamada duró 19 s y el agente no llegó a hacer
-- las dos preguntas que su prompt le pide. Eso no es un fallo con corrección de prompt, y por lo
-- tanto no es un hallazgo; es información que el técnico quiere y que se estaba tirando.
--
-- ── Las dos columnas, y por qué son dos y no una ──────────────────────────
--
--   · `resumen`       — qué pasó en la conversación, en 2-4 frases. Es DESCRIPCIÓN, no juicio.
--   · `observaciones` — notas concretas que **no mueven el nivel y no son hallazgos**: no llevan
--                       `error_code`, no generan patrón, no piden corregir el prompt.
--
-- Separarlas importa porque se llenan en momentos distintos: `resumen` se escribe **también
-- cuando la conversación NO se pudo auditar** —es justo ahí donde "qué pasó" es lo único que hay
-- que decir— y `observaciones` no, porque una observación sobre algo que no se pudo juzgar es un
-- juicio disfrazado. Ver el CHECK de abajo, que hace cumplir esa asimetría.
--
-- ── `observaciones`: los tres estados, declarados ─────────────────────────
--
-- Es la trampa de la `029` con `alarmas`, y acá se resuelve al revés porque el hecho es otro:
--
--   `null`  = no se pidieron. Pasa cuando `auditable = false` (no se juzgó) y en las filas del
--             carril amarillo, que no producen veredicto.
--   `[]`    = **se pidieron y el auditor no vio ninguna.** Es un hecho medido, distinto de `null`.
--   `[...]` = las que vio.
--
-- Por eso es `jsonb` nullable sin default: un default `'[]'` borraría la distinción de un plumazo,
-- que es exactamente lo que la `029` documenta para su propio caso.
--
-- ── Por qué jsonb y no una tabla como `closer_hallazgo_agente` ────────────
--
-- Se consideró y se descartó por ahora, a conciencia: una tabla daría CHECK real sobre la etiqueta
-- y permitiría contar "cuántas observaciones de cobertura hubo esta semana". Pero hoy las
-- observaciones son **solo para leer** en la ficha del análisis — nadie las agrega ni las cuenta —
-- y la etiqueta ya está validada dos veces antes de llegar acá: el enum del structured output del
-- modelo y el descarte en `normalizarObservaciones()`, que tira la que no reconoce en vez de
-- guardarla. Es el mismo nivel de protección que tiene `error_code`, que también se normaliza en
-- código.
--
-- El día que alguien quiera agruparlas, promoverlas a tabla es una migración con `jsonb_to_recordset`
-- y no se pierde nada. Al revés —empezar con tabla y descubrir que nadie la consulta— cuesta más.

alter table public.closer_analisis_agente
  add column if not exists resumen text,
  add column if not exists observaciones jsonb;

comment on column public.closer_analisis_agente.resumen is
  'Qué pasó en la conversación, 2-4 frases. Descripción, no juicio: se llena también cuando auditable = false.';
comment on column public.closer_analisis_agente.observaciones is
  'Notas que NO son hallazgos (sin error_code, sin patrón, sin corrección). null = no se pidieron (no auditable); [] = se pidieron y no hubo ninguna.';

/**
 * La asimetría, hecha cumplir por Postgres y no por una convención en un comentario.
 *
 * Un análisis no auditable no puede traer observaciones: si el modelo devolviera alguna, es un
 * juicio sobre una conversación que él mismo declaró imposible de juzgar. Misma técnica que el
 * `(nivel = 'rojo') = fallo` de la `031`: el estado inválido se vuelve inescribible.
 *
 * Lo que sí puede traer es `resumen` — ver la cabecera.
 */
alter table public.closer_analisis_agente
  add constraint closer_analisis_observaciones_solo_auditable
  check (auditable or observaciones is null);

notify pgrst, 'reload schema';
