-- 027 · El calendario de GHL, por empresa (2026-08-07)
--
-- `GHL_DEFAULT_CALENDAR_ID` era una **variable de entorno global**, y era el último agujero que
-- bloqueaba dar de alta un cliente con agenda: el cron de citas le habría pedido a cada empresa el
-- calendario de ARIA usando el token de esa empresa. Resultado: 404 de GHL, o —peor— cero eventos
-- sin decir por qué, y las citas del cliente nunca sincronizadas.
--
-- Un calendario pertenece a una subcuenta de GHL igual que el `location_id` y el PIT. Que fuera
-- global era una consecuencia de haber tenido un solo cliente, no una decisión.
--
-- ── Por qué acá y no en `closer_conexiones` ─────────────────────────────────
--
-- Existe una tabla `closer_conexiones` con una columna `ghl_calendar_id`, escrita por
-- `api/closer/conexiones.ts`. **No se usa esa.** Y el motivo importa: esa tabla la escribe y la lee
-- únicamente ese archivo — `env.ts` no la consulta nunca. O sea que un admin podía guardar ahí su
-- calendario, ver el éxito en pantalla, y nada lo leía jamás.
--
-- Es exactamente el mismo modo de fallar que los prompts del auditor, que estuvieron guardándose en
-- `closer_org_config` mientras el auditor leía dos archivos inexistentes: **la escritura andaba y la
-- lectura miraba otro lado**. Poner el calendario ahí habría sido repetirlo a sabiendas.
--
-- `closer_conexiones` queda como deuda anotada en `docs/10-ESTADO.md`: es un almacén de credenciales
-- paralelo y sin consumidores, duplicado del panel de §7.3.
--
-- ── Nullable, con el mismo criterio que el resto ────────────────────────────
--
-- `null` = esta empresa no cargó su calendario, y entonces **no sincroniza citas y lo dice**. No
-- hereda el de ARIA: `resolverCredenciales` restringe el fallback a variables de entorno a la
-- empresa principal (§5.2), y ese es justamente el punto — una empresa a medio configurar no debe
-- operar contra la agenda de otra.

alter table public.closer_org_config
  add column if not exists ghl_calendario_id text;

comment on column public.closer_org_config.ghl_calendario_id is
  'El calendario de GHL de esta empresa, del que el cron de citas lee los eventos. NULL = no '
  'cargado: la empresa no sincroniza citas y el cron lo reporta en su respuesta. No hereda el de '
  'la empresa principal. Se edita en Ajustes > Credenciales.';

-- Sin esto el primer UPDATE falla con 42703 sobre una columna que existe.
notify pgrst, 'reload schema';
