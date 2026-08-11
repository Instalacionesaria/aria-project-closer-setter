# PAQUETE TECNOLÓGICO — Comando Central

**Con qué está construido esto, y por qué con tan poco.**

Este documento no lleva número, igual que `LISTA-TAGS`: los numerados explican cómo funciona el
producto, y éste describe la caja de herramientas. Todas las versiones salen del
`package-lock.json` y de la base de producción, no del `package.json` —que declara rangos— ni de
la memoria de nadie.

---

## El lenguaje

Todo el proyecto está escrito en **TypeScript 5.9.3**, con `strict: true`, target `ES2020` y
`moduleResolution: "bundler"`. No hay JavaScript suelto, ni un segundo lenguaje de aplicación: el
mismo archivo `.ts` puede correr en el navegador y dentro de una función serverless, y varios lo
hacen a propósito — `src/lib/ghl/contrato.ts`, `src/lib/assistable.ts` y `src/lib/fechas.ts` son
isomorfos porque las dos mitades del sistema tienen que derivar los mismos hechos de la misma
manera. Esa es la regla 3 del proyecto, y está sostenida por el lenguaje antes que por disciplina.

El otro lenguaje que existe es **SQL** —dialecto PostgreSQL— repartido en 39 migraciones
versionadas bajo `docs/db/`, más un puñado de funciones en `plpgsql` para las operaciones que no
pueden ser un `UPDATE` con filtros: los candados del auditor y del seguimiento nacen como RPC
porque necesitan atomicidad real.

El backend corre sobre **Node.js 24**, que es el runtime que Vercel provee. No se elige en el
repo: viene con la plataforma.

---

## El frontend

**React 18.3.1** con **Vite 5.4.21** como bundler y dev server, y `@vitejs/plugin-react 4.7.0`
para JSX y hot reload. No hay router: la aplicación es un solo shell (`src/App.tsx`) que decide qué
vista mostrar según los roles de la sesión, y cada vista se carga como su propio chunk con `lazy` —
un usuario con un solo módulo descarga un solo módulo.

Los estilos son **Tailwind CSS 3.4.19** y nada más. No hay una hoja de CSS propia, ni CSS-in-JS, ni
módulos de estilo: si algo se ve de una manera, es porque hay clases en el JSX que lo dicen.
**tailwindcss-animate 1.0.7** aporta las transiciones de los drawers y las tarjetas, y
**PostCSS 8.5.16** con **Autoprefixer 10.5.2** son el pipeline que Tailwind necesita para compilar. Los
iconos son **lucide-react 0.454.0**.

Vale aclarar algo que la apariencia sugiere y que no es cierto: **shadcn/ui no está instalado**. No
existe un `components.json` ni una dependencia. Lo que hay son sus patrones copiados a mano —el
helper `cn()`, los tokens de color semánticos (`--primary`, `--muted-foreground`, `--destructive`),
la forma de componer variantes— porque adoptar el generador entero habría traído decenas de
componentes que este producto no usa. Cada componente de la interfaz está escrito en este repo.

El estado global se maneja con **Context API y hooks propios**: `closerStore`, `setterStore`,
`authStore` y `agentAuditStore`. No hay Redux, ni Zustand, ni React Query, ni SWR. Los datos se
piden con `fetch` a través de una sola capa (`src/lib/api.ts`) que centraliza el manejo de errores y
la convención de que `null` significa "no lo sé" y nunca "es cero".

---

## El backend

Son alrededor de 35 funciones serverless bajo `api/`, desplegadas por **Vercel Functions**
(`@vercel/node 5.8.27`) sobre Fluid Compute. No hay Express, ni Fastify, ni un framework de rutas:
cada archivo exporta un `handler(req, res)` y la ruta es su path. Los que necesitan más tiempo
—los crons, el webhook de GHL, el de llamadas— lo declaran con `maxDuration` en `vercel.json`.

Cuatro trabajos corren solos con **Vercel Cron**: la reconciliación de citas a los minutos `:25` y
`:55` de cada hora, el barrido de territorio a los `:10` de cada dos horas, el carril amarillo del
auditor a las 21:00 UTC y la sincronización de Meta a las 06:20 UTC. Todos recorren las empresas
activas de a una y fallan cerrado sin `CRON_SECRET`.

La criptografía es **`node:crypto` y nada más**: cero dependencias externas para lo que más caro
sale equivocarse. Las contraseñas se hashean con **scrypt** (parámetros guardados junto al hash, así
que subirlos no invalida las contraseñas viejas), las credenciales de cada empresa se cifran con
**AES-256-GCM** antes de guardarse, y todas las comparaciones de secretos usan `timingSafeEqual`.

La pieza menos visible y más importante del backend es **`AsyncLocalStorage`**, también nativo de
Node: sostiene el contexto de "qué empresa está activa" durante un request, y de ahí lo lee el Proxy
de base de datos. El aislamiento entre empresas no depende de que cada consulta se acuerde de
filtrar — depende de esto.

---

## Los datos

La base es **PostgreSQL 17.4**, hospedada en **Supabase** (el proyecto se llama SOFIA). El acceso va
por **`@supabase/supabase-js 2.110.8`**, que habla con PostgREST, pero el código de la aplicación
nunca lo usa directo: siempre pasa por `db()`, un **Proxy propio** que intercepta cada `select`,
`insert`, `update` y `delete` para inyectar el `org_id` de la empresa activa. Si no hay empresa
activa, `db()` **lanza** en vez de devolver datos — un error visible es infinitamente preferible a
una consulta que devuelve las filas de otro cliente.

Encima de eso, **RLS activa en todas las tablas** con `revoke all from anon, authenticated`, porque
la `anon key` de Supabase viaja en el bundle del navegador y hay que dar por supuesto que cualquiera
la puede leer.

De las extensiones de Postgres, la única que el código usa es **pgcrypto**, y solo para
`gen_random_uuid()`. La instancia tiene además `vector`, `pg_net`, `supabase_vault` y
`pg_stat_statements` instaladas, pero son de otros proyectos que comparten el mismo Postgres: este
código no las toca.

No hay ORM. Tampoco hay una herramienta de migraciones: los `.sql` se aplican con la **Management
API de Supabase** y el orden lo da el número del archivo. Es deliberado — cada migración lleva en su
cabecera por qué existe y qué alternativa se descartó, y eso se lee mejor en un `.sql` que en un
archivo generado.

---

## La inteligencia artificial

El auditor de agentes usa **`@anthropic-ai/sdk 0.115.0`** contra **Claude Sonnet 5**
(`claude-sonnet-5`), con `effort: "high"` y `max_tokens: 16000`. La respuesta no se parsea a mano:
se pide con **structured outputs** (`output_config.format` con un `json_schema`), lo que hace que el
modelo no pueda devolver una forma distinta a la del contrato. Aun así el código verifica
`stop_reason` explícitamente antes de tocar el JSON, porque un veredicto truncado cuesta la
inferencia entera.

El bloque grande y estable del prompt —el contexto del agente, su prompt real y la rúbrica— viaja
con **prompt caching** (`cache_control: ephemeral`, TTL de una hora). El breakpoint está puesto en la
rúbrica y no al final a propósito: los patrones conocidos salen de la base y cambian solos, así que
tenerlos dentro del prefijo cacheado invalidaba el caché en cada hallazgo nuevo.

La API key es **por empresa**: sale de `closer_org_config`, cifrada, y se le pasa explícita al SDK.
Sin ese argumento el SDK lee `ANTHROPIC_API_KEY` del entorno y todas las auditorías se facturarían a
la misma cuenta.

---

## Los servicios externos

**GoHighLevel** es el CRM y la fuente de verdad de los contactos: se le habla por su API v2 REST
(`services.leadconnectorhq.com`) con un Private Integration Token por empresa, y él nos habla por
webhooks que entran a un solo endpoint y se distinguen por un query param. De ahí salen contactos,
tags, custom fields, conversaciones, citas y oportunidades.

**Assistable** —que corre sobre **Retell**— manda las llamadas de los agentes de voz por un webhook
cuyo token viaja en la URL, porque su interfaz no permite configurar headers. En ese mismo payload
llega todo: transcripción cruda, transcripción por turnos, resumen, sentimiento y la URL de la
grabación.

**Meta Graph API v21.0** aporta las métricas de pauta del módulo Adquisición, por el endpoint
`/insights`, con un token de usuario de sistema y permiso `ads_read`.

Y **Cloudflare R2** aparece sin que lo hayamos elegido: es donde vive el MP3 de cada grabación. De
ese archivo guardamos **solo el enlace**, no el audio — unos 112 bytes por llamada.

---

## Las pruebas

**Vitest 2.1.9** corre 430 tests repartidos en 26 archivos, con **jsdom 25.0.1** como entorno DOM
para lo del frontend. Hay además una suite de integración que **no** corre con `npm test`: apunta a
la base real y se lanza con `npm run test:integracion`, con `--escribir` para habilitar las
escrituras.

Lo más particular del testing acá no es la herramienta sino un uso poco común de ella: varias suites
**leen el código fuente como texto y fallan por expresión regular**. `aislamiento.test.ts` recorre
todos los endpoints de `api/`, les quita los comentarios y verifica que cada uno llame
`activar(ctx.credenciales)` y que nadie use la escotilla `dbSinScope()` sin estar en una lista
autorizada a mano. `enDesarrollo.test.ts` parsea `analizador.ts` para comprobar que la UI y el
backend digan lo mismo sobre qué auditores están encendidos. Son lint arquitectónico escrito como
tests: convierten en error de suite lo que de otro modo sería un bug de producción silencioso.

El formato es **Prettier** (por `npx`, sin configuración propia) y el typecheck es `tsc --noEmit`,
que se corre antes de cada commit junto con los tests y el build.

---

## La infraestructura

**Vercel** hospeda el frontend estático, las funciones, los crons y las variables de entorno.
**GitHub** guarda el repo, y desplegar es literalmente hacer push a `main`: la integración publica
sola, sin `vercel --prod` y sin pipeline propio de CI. Un detalle del entorno que ya rompió
producción y conviene saber: Vercel convierte en función serverless **todo** archivo `.ts` bajo
`api/`, y su único filtro es un `_` en la ruta — por eso los tests del backend viven en `api/_lib/`
o llevan guion bajo.

En local hay una herramienta más, **graphify**, que construye un grafo de conocimiento del código a
partir del AST para poder preguntarle cosas sin leer todo. No se versiona: cada quien reconstruye el
suyo.

---

## El tamaño, y lo que la lista no tiene

Son **149 archivos** `.ts`/`.tsx` entre `src/` y `api/`, unas **45.800 líneas**, **39 migraciones**
y **430 tests**.

Lo que llama la atención de todo esto es lo corto que es: **cinco dependencias de producción**.
React, React DOM, el cliente de Supabase, el SDK de Anthropic y los iconos. Eso es todo.

No hay router, ni librería de estado, ni ORM, ni framework de backend, ni librería de componentes,
ni cliente HTTP, ni librería de criptografía, ni utilidades de fecha, ni validador de esquemas. Cada
una de esas cosas existe en el proyecto —hay ruteo, hay estado global, hay una capa de acceso a
datos, hay validación, hay manejo de zonas horarias— pero está escrita acá, en unas pocas docenas de
líneas por pieza, y por eso se puede leer, explicar y arreglar.

Es una decisión, no una carencia: cada dependencia es una API que hay que aprender, una versión que
hay que subir y una superficie que hay que auditar. En un producto que maneja las credenciales de
GHL de cinco clientes distintos, lo que no está instalado no puede filtrar nada.
