# `api/` — funciones de servidor

Funciones serverless de Vercel. Es la capa de integración entre el tool, GoHighLevel y
Supabase SOFIA. Vive en este repo (no en el motor de Kevin) por decisión del 2026-07-25.

## Endpoints

| Ruta | Qué hace |
|---|---|
| `GET /api/diagnostico` | Verifica cada eslabón por separado: Supabase, GHL, y que los tags y custom fields que el código usa **existan** en la cuenta. |

## Por qué existe `/api/diagnostico`

Un deploy exitoso no prueba nada: que la página cargue no significa que haya base de datos
ni que GHL conteste. Y el modo de fallo más peligroso de GHL es silencioso — un tag mal
escrito no da error, simplemente no dispara ningún workflow, y nadie se entera hasta que
alguien nota que los seguimientos no salen.

Por eso el endpoint no se limita a hacer ping: compara los literales que el código va a
enviar contra los que realmente existen en la cuenta, y los lista uno por uno.

No devuelve ninguna credencial, solo si está presente o no.

Respuesta: `200` si todo está bien, `503` si algo falla — así se puede monitorear.

## Los dos adapters de GHL

`_lib/ghl/` tiene un puerto con dos implementaciones, elegidas por `GHL_MODO`:

- **`stub`** (default) — no llama a GHL, pero **no pierde la intención**: cada operación se
  registra en `closer_ghl_outbox` con estado `omitido_stub`. Es una cola de replay. Un stub
  que solo hace `console.log` tiraría a la basura todos los seguimientos creados antes de
  tener el token.
- **`real`** — API v2 de GHL (`services.leadconnectorhq.com`), con Private Integration
  Token y el header `Version`.

El resultado de cada operación lleva `aplicado: boolean`. El stub devuelve `aplicado: false`
— la operación no falló, pero tampoco ocurrió. Así ninguna capa de arriba puede decirle al
usuario que aplicó un tag que en realidad no aplicó.

Para pasar a `real` hacen falta **las dos cosas**: `GHL_MODO=real` y las credenciales. Con
el modo puesto pero sin token, el selector se queda en stub a propósito — mejor anotar la
intención que explotar en runtime.

## Variables de entorno

Ninguna lleva prefijo `VITE_`: eso las expondría en el bundle del browser.

| Variable | Para qué |
|---|---|
| `SUPABASE_URL` | Proyecto SOFIA |
| `SUPABASE_SERVICE_ROLE_KEY` | Salta el RLS. Las tablas `closer_*` no tienen políticas, así que este es el único acceso posible. |
| `GHL_API_KEY` | Private Integration Token (`pit-...`) |
| `GHL_LOCATION_ID` | Subcuenta |
| `GHL_MODO` | `real` o `stub` (default) |

En local van en `.env.local`. En Vercel, en Project Settings → Environment Variables —
y ojo con marcar los tres entornos si se quiere que funcionen también los previews.

## Typecheck

`api/` está incluido en el `tsconfig.json` raíz a propósito. Sin eso, `npm run build`
(`tsc -b && vite build`) pasaría en verde con errores de tipo dentro de las funciones.
