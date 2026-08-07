# Arquitectura

Tres piezas. La pregunta que este documento responde es **quién manda sobre cada dato**,
porque casi todos los bugs caros del proyecto salieron de tener dos fuentes para lo mismo.

```
┌─────────────┐   webhook + reconciliación    ┌──────────────────┐
│     GHL     │ ────────────────────────────► │  Supabase SOFIA  │
│  (ejecuta)  │ ◄──────────────────────────── │     (caché +     │
└─────────────┘   tags, campos, notas          │   estado propio) │
                                               └──────────────────┘
                                                        ▲
                                                        │  solo lectura + escrituras propias
                                                        │
                                               ┌──────────────────┐
                                               │  Vercel Functions│
                                               │     (api/)       │
                                               └──────────────────┘
                                                        ▲
                                                        │  fetch, mismo origen
                                               ┌──────────────────┐
                                               │  React (src/)    │
                                               └──────────────────┘
```

## Quién manda sobre qué

| Dato | Fuente de verdad | Por qué |
|---|---|---|
| Contactos, tags, custom fields | **GHL** | Los escriben los workflows de Francisco y los agentes |
| Citas | **GHL** (calendario) | Las crea el booking link |
| Conversaciones | **GHL** | Es quien habla con WhatsApp/Meta |
| **Etapa del pipeline** | **Supabase** | Ver abajo — esto cambió |
| **Monto de la venta** | **Supabase** | Ídem |
| Seguimientos, notas, avances, eventos | **Supabase** | Nacen acá; GHL no los conoce |
| Análisis del auditor y sus hallazgos | **Supabase** | Ídem |
| Usuarios, sesiones, roles | **Supabase** | No se usa Supabase Auth: exigiría la `anon key` en el bundle del browser |
| Credenciales de cada empresa | **Supabase**, cifradas | AES-256-GCM con clave maestra en Vercel. Ver [12-MULTIEMPRESA](12-MULTIEMPRESA.md) |
| El prompt de cada agente auditado | **Supabase** | Era un archivo del repo hasta el 2026-08-07. Uno por empresa, no uno global |
| Métricas de pauta | **Meta**, cacheadas por día | `closer_meta_metricas`. Las tasas se guardan como las manda Meta, no recalculadas |

### La excepción que hay que entender

El diseño original decía *"GHL es la única fuente de verdad; el tool es solo una pantalla"*.
**Eso ya no es cierto para la etapa y el monto**, y el cambio fue deliberado.

`closer_contactos.stage_key` manda sobre el stage de GHL. Motivo: el Pipeline tiene que
responder en milisegundos y sobrevivir a que GHL esté lento o caído. Se sincroniza hacia GHL
en el momento del Avanzar, pero la pantalla lee de Supabase.

La consecuencia práctica: **si alguien mueve un contacto de stage a mano en GHL, la
plataforma no se entera.** Es un límite conocido, no un bug.

## Cuatro piezas, no tres: la empresa activa

Desde el 2026-08-07 hay una dimensión más y atraviesa todo: **de qué empresa es este dato**.

No es una columna que se agregó a unas tablas. Es un contexto que se abre al principio de cada
request y del que salen tres cosas a la vez: con qué credenciales se le habla a GHL y a Anthropic,
qué filas de Supabase se pueden leer, y qué se le muestra.

```
        exigir()  →  resuelve sesión → usuario → empresa efectiva → roles
            │
            └─ activar(ctx.credenciales)     ← SÍNCRONO, en el scope del handler
                     │
                     ├─ db()                 → Proxy con .eq("org_id") ya puesto
                     ├─ env.ghlApiKey()      → el PIT de ESA empresa
                     └─ credencialesActivas()→ modelo, prompts, tokens
```

La regla operativa: **ninguna consulta corre sin empresa activa**. `db()` lanza si no hay
contexto, y un test exige que todo handler active una. El detalle completo, incluido por qué
`activar` y `conCredenciales` no son intercambiables, está en
[12-MULTIEMPRESA](12-MULTIEMPRESA.md).

## El frontend nunca llama a GHL

Ni una sola vez. El PIT (Private Integration Token) vive únicamente en `api/`, en variables
de entorno sin prefijo `VITE_` — cualquier variable con ese prefijo termina en el bundle del
browser.

El frontend habla solo con `/api/*`, mismo origen, sin CORS ni `VITE_API_URL` que configurar.

## Las capas

### `src/` — React 18 + Vite 5 + TypeScript estricto

- **Vistas** (`src/views/`): una por módulo, cargadas con `React.lazy`.
- **Stores** (`src/lib/*Store.tsx`): un provider por módulo, montados en `App.tsx` por encima
  del switch de vista para que su estado sobreviva al cambio de módulo.
- **Módulos isomorfos** (`src/lib/ghl/`, `src/lib/indicadores.ts`, `src/lib/whatsapp.ts`):
  TypeScript puro, sin React ni Node. Los importan **las dos** capas. Es lo que evita tener
  dos implementaciones de la misma regla.

> **Regla:** si una regla de negocio la necesitan el front y el back, va en un módulo
> isomorfo. Nunca duplicada. `estadoBotDesdeTags` y `botDesdeTags` fueron dos
> implementaciones divergentes de lo mismo durante semanas, y eso costó un bug real.

### `api/` — Vercel Functions, Node 24

- `api/_lib/` — la lógica. No son endpoints.
- `api/closer/`, `api/setter/`, `api/agentes/`, `api/webhooks/` — los endpoints.

**Dos trampas de este runtime, ambas ya mordieron:**

1. **Los imports necesitan extensión `.js`**, incluso apuntando a un `.ts`. Es ESM
   (`"type": "module"`). `tsc` no lo detecta: falla en runtime con
   `FUNCTION_INVOCATION_FAILED` sin decir qué módulo.
2. **No se puede importar una carpeta.** `from "./ghl"` no resuelve; hay que escribir
   `from "./ghl/index.js"`.

### Supabase SOFIA

Todas las tablas del proyecto llevan el prefijo `closer_`. Se accede **solo con
`service_role`**, desde `api/`. La `anon key` viaja en el bundle del browser, así que
cualquier tabla sin RLS ni `revoke` queda legible y escribible por cualquiera que abra la app.

> **Trampa del schema cache (PostgREST).** Después de cualquier `ALTER TABLE` hay que emitir
> `notify pgrst, 'reload schema';` al final de la migración. Sin eso, PostgREST sigue
> sirviendo el esquema viejo y el primer INSERT contra la columna nueva falla con un `42703`
> "column does not exist" aunque la columna exista. Ya pasó en producción con la migración
> 011.
>
> Corolario: **los candados y locks nacen como RPC**, no como `UPDATE` con filtros de
> PostgREST. Un `.update().or()` falló con 42703 sobre una columna que existía. Una función
> de Postgres esquiva el camino de filtros por completo.

## Despliegue

Push a `main`. La integración de GitHub con Vercel publica sola. **No se usa `vercel --prod`.**

Dos cosas que hay que verificar y que un check verde de GitHub no garantiza:

- Que el deploy quedó **Ready** (Vercel puede seguir sirviendo un build viejo).
- Que cambió el `data-dpl-id` del HTML servido.

Las variables de entorno se congelan al momento del deploy: agregar una variable **exige un
redeploy** para que las funciones la vean.

## Convenciones que no son negociables

- **El código y los comentarios, en español.** Es el idioma del equipo y del dominio.
- **Los literales de GHL van en `src/lib/ghl/contrato.ts`**, cada uno con su valor, su fuente
  y su nivel de confianza (`confirmado` / `pendiente`). Un string suelto de GHL en cualquier
  otro archivo es un bug esperando.
- **Nada de `any` sin comentario que lo justifique.** El caso legítimo recurrente es el select
  multilínea de supabase-js, que rompe la inferencia — ahí se declara el shape a mano.
- **Nunca reportar un éxito que no ocurrió.** Si una escritura a GHL falla, la respuesta lo
  dice; la UI no puede pintar un estado que no existe. Este principio tiene su propia
  historia: ver [09-DECISIONES](09-DECISIONES.md).
