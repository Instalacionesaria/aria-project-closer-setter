# Mapa de la documentación

Empezá acá. Buscá tu pregunta en la tabla y andá al documento.

## Tengo esta pregunta → leo esto

| Pregunta                                                                    | Documento                                                                                     |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| ¿Qué es este producto? ¿Qué hace un closer y qué un setter?                 | [01-PRODUCTO](01-PRODUCTO.md)                                                                 |
| ¿Cómo se llama esto en el glosario? ¿Puedo decir "cadencia"?                | [01-PRODUCTO](01-PRODUCTO.md) § Glosario                                                      |
| ¿Dónde vive el dato X: en GHL, en Supabase o en el front?                   | [02-ARQUITECTURA](02-ARQUITECTURA.md)                                                         |
| ¿Por qué el front no llama a GHL directamente?                              | [02-ARQUITECTURA](02-ARQUITECTURA.md)                                                         |
| ¿Qué tag/campo de GHL uso para X? ¿Qué workflows hay que crear?             | [03-INTEGRACION-GHL](03-INTEGRACION-GHL.md)                                                   |
| ¿Cómo llega un mensaje de GHL a la pantalla? ¿Cada cuánto?                  | [04-DATOS-Y-RELOJES](04-DATOS-Y-RELOJES.md)                                                   |
| ¿Cuántas llamadas a GHL cuesta esto?                                        | [04-DATOS-Y-RELOJES](04-DATOS-Y-RELOJES.md) § Presupuesto                                     |
| ¿Qué hace cada cola de Mi Día? ¿Cómo funciona Avanzar?                      | [05-CLOSER](05-CLOSER.md)                                                                     |
| ¿Qué significa cada ícono de la fila?                                       | [05-CLOSER](05-CLOSER.md) § Iconografía                                                       |
| ¿En qué se diferencia el Setter del Closer?                                 | [06-SETTER](06-SETTER.md)                                                                     |
| ¿Por qué el auditor no está analizando nada?                                | [07-AUDITOR-IA](07-AUDITOR-IA.md)                                                             |
| ¿Cómo funciona la rúbrica? ¿Cuánto cuesta cada análisis?                    | [07-AUDITOR-IA](07-AUDITOR-IA.md)                                                             |
| ¿Por qué no puedo mandar un mensaje a este contacto?                        | [08-MENSAJERIA](08-MENSAJERIA.md) § Ventana de 24 h                                           |
| ¿Por qué este mensaje figura como enviado pero no llegó?                    | [08-MENSAJERIA](08-MENSAJERIA.md) § Estados de entrega                                        |
| ¿Dónde queda la transcripción de una llamada?                               | [11-VOZ-Y-LLAMADAS](11-VOZ-Y-LLAMADAS.md)                                                     |
| ¿Por qué esta llamada figura como no contestada si duró 2 segundos?         | [11-VOZ-Y-LLAMADAS](11-VOZ-Y-LLAMADAS.md)                                                     |
| ¿Cómo mando un mensaje si pasaron las 24 h?                                 | [08-MENSAJERIA](08-MENSAJERIA.md) § Plantillas                                                |
| ¿De dónde salen los números de gasto en pauta? ¿Por qué está vacío?         | [12-MULTIEMPRESA](12-MULTIEMPRESA.md) y [10-ESTADO](10-ESTADO.md)                             |
| ¿Qué ve un `media_buyer`?                                                   | [01-PRODUCTO](01-PRODUCTO.md) § Navegación                                                    |
| ¿Cómo se aísla una empresa de otra? ¿Qué pasa si dos comparten un contacto? | [12-MULTIEMPRESA](12-MULTIEMPRESA.md)                                                         |
| ¿Cómo entra alguien? ¿Qué ve cada rol?                                      | [12-MULTIEMPRESA](12-MULTIEMPRESA.md) § Autenticación                                         |
| ¿Por qué se auditó esta conversación si el agente mandó solo 4 mensajes?    | [07-AUDITOR-IA](07-AUDITOR-IA.md) § El nivel 0                                                |
| ¿Qué palabras disparan una alarma? ¿Cómo agrego una?                        | [13-LEXICO-AUDITOR](13-LEXICO-AUDITOR.md)                                                     |
| ¿Qué es un hallazgo amarillo y por qué no genera tarea?                     | [07-AUDITOR-IA](07-AUDITOR-IA.md) § El carril amarillo                                        |
| ¿Dónde se edita el prompt de un agente? ¿Quién puede?                       | [07-AUDITOR-IA](07-AUDITOR-IA.md) § El prompt del agente auditado                             |
| ¿Qué URL le paso al cliente para sus webhooks? ¿Cómo la roto?               | Ajustes › Credenciales § Webhooks, y [09-DECISIONES](09-DECISIONES.md) D31                    |
| ¿Qué hay que configurar en la subcuenta de GHL?                             | [03-INTEGRACION-GHL](03-INTEGRACION-GHL.md) § Lo que hay que configurar en GHL                |
| ¿Por qué la tarjeta de un agente de voz está bloqueada?                     | [07-AUDITOR-IA](07-AUDITOR-IA.md) § Los auditores de voz están BLOQUEADOS                     |
| ¿Qué significa que un análisis salga verde?                                 | [07-AUDITOR-IA](07-AUDITOR-IA.md) § El veredicto de tres niveles                              |
| ¿Por qué el botón atrás me saca de la app?                                  | [10-ESTADO](10-ESTADO.md) § Huecos conocidos                                                  |
| ¿Por qué dice que use una sola pestaña?                                     | [09-DECISIONES](09-DECISIONES.md) D37                                                         |
| ¿Dónde se guarda el % de comisión de cada persona?                          | [09-DECISIONES](09-DECISIONES.md) D41                                                         |
| ¿Por qué el Avanzar del setter va a la tabla del closer?                    | [09-DECISIONES](09-DECISIONES.md) D39                                                         |
| ¿Cómo corro la prueba contra la base real?                                  | `npm run test:integracion` — ver [09-DECISIONES](09-DECISIONES.md) D42                        |
| ¿Dónde están las credenciales de un cliente? ¿Cómo se rotan?                | [12-MULTIEMPRESA](12-MULTIEMPRESA.md) § Credenciales                                          |
| Agregué un endpoint y explota con "sin empresa activa"                      | [12-MULTIEMPRESA](12-MULTIEMPRESA.md) § Capa 1                                                |
| ¿De qué empresa es este webhook? ¿Por qué hay filas con `org_id` nulo?      | [12-MULTIEMPRESA](12-MULTIEMPRESA.md) § Webhooks                                              |
| ¿De dónde salen los números de Estadísticas? ¿Por qué falta el ROAS?        | [12-MULTIEMPRESA](12-MULTIEMPRESA.md) y [10-ESTADO](10-ESTADO.md)                             |
| ¿Qué es una sección "En desarrollo" y cómo se activa?                       | [12-MULTIEMPRESA](12-MULTIEMPRESA.md) § Lo que queda                                          |
| ¿Por qué se decidió X y no Y?                                               | [09-DECISIONES](09-DECISIONES.md)                                                             |
| ¿Qué está construido y qué falta?                                           | [10-ESTADO](10-ESTADO.md)                                                                     |
| ¿Cómo corro una migración? ¿Qué tablas hay?                                 | [db/README](db/README.md)                                                                     |
| ¿Qué tags y custom fields le pido a GHL? ¿Cuáles faltan crear?              | [LISTA-TAGS](migracion/LISTA-TAGS.md)                                                         |
| ¿Qué scopes tildo en la Private Integration de GHL?                         | [03-INTEGRACION-GHL § Los scopes](03-INTEGRACION-GHL.md#los-scopes-de-la-private-integration) |
| ¿Quién aplica este tag o campo: GHL o nosotros?                              | [LISTA-TAGS](migracion/LISTA-TAGS.md)                                                         |
| ¿Dónde pego el prompt del agente de GHL?                                    | En **Ajustes › Credenciales**. Ver [07-AUDITOR-IA](07-AUDITOR-IA.md)                          |
| ¿Con qué está hecho esto? ¿Qué versión de React/Postgres/Tailwind usa?      | [PAQUETE-TECNOLOGICO](PAQUETE-TECNOLOGICO.md)                                                 |
| ¿Por qué no usamos shadcn/ui, Redux o un ORM?                               | [PAQUETE-TECNOLOGICO](PAQUETE-TECNOLOGICO.md)                                                 |
| ¿Cómo despliego? ¿Cómo trabajo en este repo?                                | [../CLAUDE.md](../CLAUDE.md)                                                                  |

## Los documentos, en orden de lectura

Si venís de cero, leelos en este orden. Los cuatro primeros alcanzan para entender el sistema.

1. **[01-PRODUCTO](01-PRODUCTO.md)** — qué es, para quién, el embudo, el glosario obligatorio.
2. **[02-ARQUITECTURA](02-ARQUITECTURA.md)** — las tres piezas y quién manda sobre cada dato.
3. **[03-INTEGRACION-GHL](03-INTEGRACION-GHL.md)** — la frontera con GHL: tags, campos, workflows.
4. **[04-DATOS-Y-RELOJES](04-DATOS-Y-RELOJES.md)** — ingesta, caché, el tick, el presupuesto de llamadas.
5. **[05-CLOSER](05-CLOSER.md)** — el módulo principal, vista por vista.
6. **[06-SETTER](06-SETTER.md)** — su espejo en pre-agenda.
7. **[07-AUDITOR-IA](07-AUDITOR-IA.md)** — el agente que audita a los otros agentes.
8. **[08-MENSAJERIA](08-MENSAJERIA.md)** — el chat y las reglas de WhatsApp.
9. **[09-DECISIONES](09-DECISIONES.md)** — el porqué de lo que no es obvio.
10. **[11-VOZ-Y-LLAMADAS](11-VOZ-Y-LLAMADAS.md)** — las llamadas de los agentes de voz.
11. **[12-MULTIEMPRESA](12-MULTIEMPRESA.md)** — el aislamiento, la autenticación y los roles.
12. **[10-ESTADO](10-ESTADO.md)** — qué existe hoy, qué está a medias, qué no existe.

## Dónde vive cada cosa que NO es documentación

| Qué                                              | Dónde                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| Los literales de GHL que el código usa de verdad | `src/lib/ghl/contrato.ts` — cada uno con su fuente y su nivel de confianza |
| El esquema de la base                            | `docs/db/*.sql`, en orden numérico                                         |
| Las reglas que el asistente debe seguir siempre  | `../CLAUDE.md`                                                             |
| Notas locales que no se versionan                | `../CLAUDE.local.md`                                                       |
| El contrato original de GHL                      | `CONTRATO-GHL.md` — **no está en git**, vive en el disco de Fabio          |

## Encontré un `§NN` en un comentario del código

Hasta el 2026-08-05, `CLAUDE.md` tenía 56 secciones numeradas y el código las cita ~400 veces
en 74 archivos. Esas referencias **no se reescribieron**: la churn no valía el riesgo. Usá esta
tabla para resolverlas.

| Referencia                                              | Ahora está en                                                                       |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| §1 · §3 (producto, glosario)                            | [01-PRODUCTO](01-PRODUCTO.md)                                                       |
| **§4** (reglas transversales) · §4.1 · §4.10            | [01-PRODUCTO](01-PRODUCTO.md) § Reglas transversales                                |
| §2 (arquitectura)                                       | [02-ARQUITECTURA](02-ARQUITECTURA.md)                                               |
| §5 · §6 · §7 · §10 (navegación, módulos, ficha, menú +) | [05-CLOSER](05-CLOSER.md)                                                           |
| §8 (iconografía)                                        | [05-CLOSER](05-CLOSER.md) § Iconografía                                             |
| §11 · §12 · §13 (setter vs closer, píldoras, colas)     | [06-SETTER](06-SETTER.md) y [01-PRODUCTO](01-PRODUCTO.md)                           |
| §16 · §16.1 · §39.x (Avanzar, seguimientos)             | [05-CLOSER](05-CLOSER.md) § Avanzar                                                 |
| §17 · §18 · §19 · §20 · §22 (Mi Día, ficha, chat)       | [05-CLOSER](05-CLOSER.md)                                                           |
| §23 · §24 · §26 (Setter)                                | [06-SETTER](06-SETTER.md)                                                           |
| §25 · §34 (toggle 🤖, IA muerta post-call)              | [05-CLOSER](05-CLOSER.md) § La regla de la IA muerta                                |
| §27 · §28 · §29 · §35 (derivación de íconos)            | [05-CLOSER](05-CLOSER.md) § Iconografía · [09-DECISIONES](09-DECISIONES.md) D5      |
| §31 · §32 · §33 (Auditoría de Agentes)                  | [07-AUDITOR-IA](07-AUDITOR-IA.md) § La pestaña                                      |
| §37 · §30 (Ajustes)                                     | [05-CLOSER](05-CLOSER.md) § El menú +                                               |
| §38 (etapas del pipeline)                               | [05-CLOSER](05-CLOSER.md) § Pipeline                                                |
| §40 · §42 · §43 (ciclo de vida de tareas)               | [05-CLOSER](05-CLOSER.md) § El ciclo de vida de una tarea                           |
| §44 (coherencia de KPIs)                                | [05-CLOSER](05-CLOSER.md) y [06-SETTER](06-SETTER.md) § El cockpit                  |
| §49 (cómo trabajar)                                     | [../CLAUDE.md](../CLAUDE.md)                                                        |
| §50.x (backend de seguimientos)                         | [02-ARQUITECTURA](02-ARQUITECTURA.md) y [04-DATOS-Y-RELOJES](04-DATOS-Y-RELOJES.md) |
| **§51.3** (default APAGADO, congelados)                 | [03-INTEGRACION-GHL](03-INTEGRACION-GHL.md) § Estado del agente                     |
| **§51.4** (presupuesto de GHL)                          | [04-DATOS-Y-RELOJES](04-DATOS-Y-RELOJES.md) § Presupuesto                           |
| **§51.5** (schema cache de PostgREST)                   | [02-ARQUITECTURA](02-ARQUITECTURA.md) § Supabase                                    |
| §52 (indicadores, pipeline por etapa)                   | [04-DATOS-Y-RELOJES](04-DATOS-Y-RELOJES.md) § Indicadores                           |
| §53 · §54 (el auditor)                                  | [07-AUDITOR-IA](07-AUDITOR-IA.md)                                                   |
| §55 (ventana de 24 h)                                   | [08-MENSAJERIA](08-MENSAJERIA.md)                                                   |
| §56 (tick unificado)                                    | [04-DATOS-Y-RELOJES](04-DATOS-Y-RELOJES.md) § El tick                               |

**Ojo:** varios `§` del código apuntan a **`CONTRATO-GHL.md`**, no a `CLAUDE.md` — se
distinguen porque el comentario lo dice (`CONTRATO-GHL.md §9 · Resultados post-call`). Ese
documento no está en git; vive en el disco de Fabio.

El `CLAUDE.md` viejo completo sigue en git:

```bash
git show b89d46e:CLAUDE.md
```

## Reglas de esta carpeta

- **Un tema por documento.** Si una pregunta se responde con dos documentos, uno de los dos está mal recortado.
- **Estado actual, no diario.** Los documentos dicen cómo funciona hoy. El _por qué cambió_ va en [09-DECISIONES](09-DECISIONES.md); el _cuándo_ lo tiene git.
- **Sin datos inventados.** Si algo no se midió, se dice que no se midió. Un número sin fuente es peor que ningún número.
- **Cuando algo cambie, se actualiza el documento del tema** — no se agrega una sección nueva al final. Eso es lo que convirtió a `CLAUDE.md` en 1689 líneas imposibles de consultar.
