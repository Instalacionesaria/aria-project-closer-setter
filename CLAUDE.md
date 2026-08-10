# CLAUDE.md — Comando Central (ARIA IA)

**Reglas de trabajo e índice. Leer antes de cualquier cambio.**

Este archivo tiene solo lo que hay que tener presente **siempre**. El detalle de cada tema
vive en `docs/`, un documento por tema.

> Hasta el 2026-08-05 este archivo eran 1689 líneas ordenadas cronológicamente: 56 secciones
> fechadas donde responder *"¿cómo funciona el auditor?"* exigía leer dos, y *"¿cómo llegan los
> mensajes?"* cuatro. Se transpuso a temas. **Cuando algo cambie, se actualiza el documento de
> ese tema — no se agrega una sección al final.** Así es como este archivo llegó a ser
> inconsultable.

---

## Dónde está cada cosa

**Empezá por [`docs/00-MAPA.md`](docs/00-MAPA.md)**: tiene una tabla de "tengo esta pregunta →
leo esto".

| Documento | Responde |
|---|---|
| [01-PRODUCTO](docs/01-PRODUCTO.md) | Qué es, el embudo, el **glosario obligatorio**, las reglas transversales |
| [02-ARQUITECTURA](docs/02-ARQUITECTURA.md) | Las tres piezas y quién manda sobre cada dato |
| [03-INTEGRACION-GHL](docs/03-INTEGRACION-GHL.md) | Tags, custom fields, webhooks, qué falta configurar |
| [04-DATOS-Y-RELOJES](docs/04-DATOS-Y-RELOJES.md) | Ingesta, el tick, caché, presupuesto de llamadas |
| [05-CLOSER](docs/05-CLOSER.md) | Mi Día, Pipeline, Avanzar, la ficha, iconografía |
| [06-SETTER](docs/06-SETTER.md) | Su espejo en pre-agenda |
| [07-AUDITOR-IA](docs/07-AUDITOR-IA.md) | Portones, rúbrica, debounce, los dos carriles, costo, los 4 agentes |
| [13-LEXICO-AUDITOR](docs/13-LEXICO-AUDITOR.md) | Las palabras que disparan una alarma, y cómo agregar una |
| [08-MENSAJERIA](docs/08-MENSAJERIA.md) | Chat, ventana de 24 h, estados de entrega |
| [11-VOZ-Y-LLAMADAS](docs/11-VOZ-Y-LLAMADAS.md) | Llamadas de los agentes de voz: Assistable, el tab Llamada |
| [12-MULTIEMPRESA](docs/12-MULTIEMPRESA.md) | Aislamiento entre empresas, autenticación, roles, credenciales |
| [09-DECISIONES](docs/09-DECISIONES.md) | El **porqué** de lo que no es obvio |
| [10-ESTADO](docs/10-ESTADO.md) | Qué existe, qué está a medias, qué bloquea |
| [db/README](docs/db/README.md) | Esquema y cómo correr migraciones |
| [TAGS_CC_GHL](docs/TAGS_CC_GHL.md) | **La lista operativa de tags para pasarle a GHL**: cuál falta, quién lo aplica y qué desbloquea. Sin número a propósito |

Los **literales de GHL** que el código usa de verdad están en `src/lib/ghl/contrato.ts`, cada
uno con su fuente y su nivel de confianza. Si un documento y ese archivo se contradicen, gana
el archivo.

---

## Cómo trabajar en este repo

- Los cambios llegan como **specs** de Fabio. Implementar lo especificado; **no inventar**
  features, textos ni estados.
- Ante ambigüedad: **preguntar, no asumir**. Estas reglas ganan sobre cualquier patrón
  genérico de UI.
- **Código y comentarios en español.** Es el idioma del equipo y del dominio.
- Los comentarios explican **por qué**, no qué. Si una decisión no es obvia, el comentario dice
  qué alternativa se descartó y por qué.
- **Después de cada cambio, desplegar** — push a `main`, la integración de Vercel publica sola.
  No se usa `vercel --prod`.

## Las cinco reglas que más se violan

1. **Sin dato, el elemento no se renderiza.** Un `0%` medido y un `0%` no medido no son el
   mismo hecho. Un contador en cero se atenúa, no muestra "0".
2. **Nunca reportar un éxito que no ocurrió.** Si una escritura falla, la respuesta lo dice.
   `null` y `[]` tienen que significar una sola cosa: nunca "no hay nada" *y* "no pude
   averiguarlo".
3. **Una sola derivación por regla.** Si dos vitrinas muestran el mismo hecho, comparten la
   función que lo calcula. Dos implementaciones divergen en silencio.
4. **Lo que se deriva en la lectura no se queda viejo; lo que se denormaliza, sí.** Denormalizar
   es una excepción que se justifica por escrito.
5. **Los eventos automáticos nunca pasan por Avanzar.** Se registran solos con autor `Sistema`.

## Trampas del entorno

Estas seis ya rompieron producción. No son teóricas.

- **Imports de `api/` necesitan extensión `.js`**, y **no se puede importar una carpeta**. `tsc`
  no lo detecta: falla en runtime con `FUNCTION_INVOCATION_FAILED` sin decir cuál módulo.
- **Después de cualquier `ALTER TABLE`**, emitir `notify pgrst, 'reload schema';` al final de la
  migración. Sin eso el primer INSERT falla con `42703` sobre una columna que existe.
- **Los candados nacen como RPC**, no como `UPDATE` con filtros de PostgREST.
- **Las variables de entorno se congelan al deploy.** Agregar una exige redesplegar.
- **Vercel despliega TODO `.ts` bajo `api/`** como función serverless, y su único filtro es `/_`
  en la ruta. Un test en `api/algo.test.ts` se publica como endpoint con vitest adentro: los
  tests del backend van en `api/_lib/` o con guion bajo (`_algo.test.ts`).
- **Ninguna consulta corre sin empresa activa.** `db()` saca la organización del contexto y
  **lanza** si no hay ninguna. Todo handler tiene que llamar a `activar(ctx.credenciales)` —o a
  `conCredenciales()` si recorre empresas— y un test lo hace cumplir.

## Verificación

Antes de dar algo por hecho: `npx tsc -b`, `npm test -- --run` y `npm run build` limpios.

Contra la base real: `npm run test:integracion` (agregá `-- --escribir` para las escrituras). Es
la suite que **no** corre en `npm test` — y estuvo rota meses porque el script no existía, así que
conviene correrla al cerrar cualquier cosa que toque Supabase.

Después de desplegar, confirmar que el deploy quedó **Ready** y que cambió el `data-dpl-id` —
un check verde de GitHub no significa que se construyó, y Vercel puede seguir sirviendo un
build viejo.

Verificar contra **datos reales de producción** cuando se pueda. Varias veces la diferencia
entre "parece que anda" y "anda" apareció recién ahí.

## Seguridad y datos

- **Credenciales en `.env.local`** (gitignored). Nunca en el chat, nunca en un commit.
- **Ninguna variable con prefijo `VITE_`** para secretos: terminan en el bundle del browser.
- **Toda tabla nueva** lleva `enable row level security` + `revoke all from anon, authenticated`.
  La `anon key` viaja en el bundle.
- **`CONTRATO-GHL*.md` no se versiona.** Está en `.gitignore` por decisión de Fabio.
- **Contactos que no se tocan en pruebas**: Veronica Ochoa Orrego, Enrique Izaguirre, Richard
  Andrés Rodriguez. Los de prueba usan `@example.com` y se borran después.
- **Commits** firmados con `instalacionesariaia@gmail.com`.
