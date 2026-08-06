# Mapa de la documentación

Empezá acá. Buscá tu pregunta en la tabla y andá al documento.

## Tengo esta pregunta → leo esto

| Pregunta | Documento |
|---|---|
| ¿Qué es este producto? ¿Qué hace un closer y qué un setter? | [01-PRODUCTO](01-PRODUCTO.md) |
| ¿Cómo se llama esto en el glosario? ¿Puedo decir "cadencia"? | [01-PRODUCTO](01-PRODUCTO.md) § Glosario |
| ¿Dónde vive el dato X: en GHL, en Supabase o en el front? | [02-ARQUITECTURA](02-ARQUITECTURA.md) |
| ¿Por qué el front no llama a GHL directamente? | [02-ARQUITECTURA](02-ARQUITECTURA.md) |
| ¿Qué tag/campo de GHL uso para X? ¿Qué workflows hay que crear? | [03-INTEGRACION-GHL](03-INTEGRACION-GHL.md) |
| ¿Cómo llega un mensaje de GHL a la pantalla? ¿Cada cuánto? | [04-DATOS-Y-RELOJES](04-DATOS-Y-RELOJES.md) |
| ¿Cuántas llamadas a GHL cuesta esto? | [04-DATOS-Y-RELOJES](04-DATOS-Y-RELOJES.md) § Presupuesto |
| ¿Qué hace cada cola de Mi Día? ¿Cómo funciona Avanzar? | [05-CLOSER](05-CLOSER.md) |
| ¿Qué significa cada ícono de la fila? | [05-CLOSER](05-CLOSER.md) § Iconografía |
| ¿En qué se diferencia el Setter del Closer? | [06-SETTER](06-SETTER.md) |
| ¿Por qué el auditor no está analizando nada? | [07-AUDITOR-IA](07-AUDITOR-IA.md) |
| ¿Cómo funciona la rúbrica? ¿Cuánto cuesta cada análisis? | [07-AUDITOR-IA](07-AUDITOR-IA.md) |
| ¿Por qué no puedo mandar un mensaje a este contacto? | [08-MENSAJERIA](08-MENSAJERIA.md) § Ventana de 24 h |
| ¿Por qué este mensaje figura como enviado pero no llegó? | [08-MENSAJERIA](08-MENSAJERIA.md) § Estados de entrega |
| ¿Dónde queda la transcripción de una llamada? | [11-VOZ-Y-LLAMADAS](11-VOZ-Y-LLAMADAS.md) |
| ¿Por qué esta llamada figura como no contestada si duró 2 segundos? | [11-VOZ-Y-LLAMADAS](11-VOZ-Y-LLAMADAS.md) |
| ¿Cómo mando un mensaje si pasaron las 24 h? | [08-MENSAJERIA](08-MENSAJERIA.md) § Plantillas |
| ¿Por qué se decidió X y no Y? | [09-DECISIONES](09-DECISIONES.md) |
| ¿Qué está construido y qué falta? | [10-ESTADO](10-ESTADO.md) |
| ¿Cómo corro una migración? ¿Qué tablas hay? | [db/README](db/README.md) |
| ¿Dónde pego el prompt del agente de GHL? | [prompts/README](prompts/README.md) |
| ¿Cómo despliego? ¿Cómo trabajo en este repo? | [../CLAUDE.md](../CLAUDE.md) |

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
11. **[10-ESTADO](10-ESTADO.md)** — qué existe hoy, qué está a medias, qué no existe.

## Dónde vive cada cosa que NO es documentación

| Qué | Dónde |
|---|---|
| Los literales de GHL que el código usa de verdad | `src/lib/ghl/contrato.ts` — cada uno con su fuente y su nivel de confianza |
| El esquema de la base | `docs/db/*.sql`, en orden numérico |
| Las reglas que el asistente debe seguir siempre | `../CLAUDE.md` |
| Notas locales que no se versionan | `../CLAUDE.local.md` |
| El contrato original de Francisco | `CONTRATO-GHL.md` — **no está en git**, pedírselo a él |

## Encontré un `§NN` en un comentario del código

Hasta el 2026-08-05, `CLAUDE.md` tenía 56 secciones numeradas y el código las cita ~400 veces
en 74 archivos. Esas referencias **no se reescribieron**: la churn no valía el riesgo. Usá esta
tabla para resolverlas.

| Referencia | Ahora está en |
|---|---|
| §1 · §3 (producto, glosario) | [01-PRODUCTO](01-PRODUCTO.md) |
| **§4** (reglas transversales) · §4.1 · §4.10 | [01-PRODUCTO](01-PRODUCTO.md) § Reglas transversales |
| §2 (arquitectura) | [02-ARQUITECTURA](02-ARQUITECTURA.md) |
| §5 · §6 · §7 · §10 (navegación, módulos, ficha, menú +) | [05-CLOSER](05-CLOSER.md) |
| §8 (iconografía) | [05-CLOSER](05-CLOSER.md) § Iconografía |
| §11 · §12 · §13 (setter vs closer, píldoras, colas) | [06-SETTER](06-SETTER.md) y [01-PRODUCTO](01-PRODUCTO.md) |
| §16 · §16.1 · §39.x (Avanzar, seguimientos) | [05-CLOSER](05-CLOSER.md) § Avanzar |
| §17 · §18 · §19 · §20 · §22 (Mi Día, ficha, chat) | [05-CLOSER](05-CLOSER.md) |
| §23 · §24 · §26 (Setter) | [06-SETTER](06-SETTER.md) |
| §25 · §34 (toggle 🤖, IA muerta post-call) | [05-CLOSER](05-CLOSER.md) § La regla de la IA muerta |
| §27 · §28 · §29 · §35 (derivación de íconos) | [05-CLOSER](05-CLOSER.md) § Iconografía · [09-DECISIONES](09-DECISIONES.md) D5 |
| §31 · §32 · §33 (Auditoría de Agentes) | [07-AUDITOR-IA](07-AUDITOR-IA.md) § La pestaña |
| §37 · §30 (Ajustes) | [05-CLOSER](05-CLOSER.md) § El menú + |
| §38 (etapas del pipeline) | [05-CLOSER](05-CLOSER.md) § Pipeline |
| §40 · §42 · §43 (ciclo de vida de tareas) | [05-CLOSER](05-CLOSER.md) § El ciclo de vida de una tarea |
| §44 (coherencia de KPIs) | [05-CLOSER](05-CLOSER.md) y [06-SETTER](06-SETTER.md) § El cockpit |
| §49 (cómo trabajar) | [../CLAUDE.md](../CLAUDE.md) |
| §50.x (backend de seguimientos) | [02-ARQUITECTURA](02-ARQUITECTURA.md) y [04-DATOS-Y-RELOJES](04-DATOS-Y-RELOJES.md) |
| **§51.3** (default APAGADO, congelados) | [03-INTEGRACION-GHL](03-INTEGRACION-GHL.md) § Estado del agente |
| **§51.4** (presupuesto de GHL) | [04-DATOS-Y-RELOJES](04-DATOS-Y-RELOJES.md) § Presupuesto |
| **§51.5** (schema cache de PostgREST) | [02-ARQUITECTURA](02-ARQUITECTURA.md) § Supabase |
| §52 (indicadores, pipeline por etapa) | [04-DATOS-Y-RELOJES](04-DATOS-Y-RELOJES.md) § Indicadores |
| §53 · §54 (el auditor) | [07-AUDITOR-IA](07-AUDITOR-IA.md) |
| §55 (ventana de 24 h) | [08-MENSAJERIA](08-MENSAJERIA.md) |
| §56 (tick unificado) | [04-DATOS-Y-RELOJES](04-DATOS-Y-RELOJES.md) § El tick |

**Ojo:** varios `§` del código apuntan a **`CONTRATO-GHL.md`**, no a `CLAUDE.md` — se
distinguen porque el comentario lo dice (`CONTRATO-GHL.md §9 · Resultados post-call`). Ese
documento no está en git; pedírselo a Francisco.

El `CLAUDE.md` viejo completo sigue en git:

```bash
git show b89d46e:CLAUDE.md
```

## Reglas de esta carpeta

- **Un tema por documento.** Si una pregunta se responde con dos documentos, uno de los dos está mal recortado.
- **Estado actual, no diario.** Los documentos dicen cómo funciona hoy. El *por qué cambió* va en [09-DECISIONES](09-DECISIONES.md); el *cuándo* lo tiene git.
- **Sin datos inventados.** Si algo no se midió, se dice que no se midió. Un número sin fuente es peor que ningún número.
- **Cuando algo cambie, se actualiza el documento del tema** — no se agrega una sección nueva al final. Eso es lo que convirtió a `CLAUDE.md` en 1689 líneas imposibles de consultar.
