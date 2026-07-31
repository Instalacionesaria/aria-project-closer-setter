# Costos de operación y arquitectura de polling

**Actualizado: 2026-07-30.** Documento para decidir presupuesto, no para implementar. Todo
número acá está medido del código o consultado a la cuenta real — no hay estimaciones a ojo.
Donde algo es una proyección, se dice.

> Para el estado funcional del proyecto: `ESTADO-DEL-PROYECTO.md`.
> Para las reglas de producto: `CLAUDE.md`.

---

## Resumen para quien decide

**Vercel no es el problema. Nunca lo va a ser.** Con el plan Pro entran cómodamente cuatro
closers trabajando jornada completa, y el excedente se cobra en centavos.

Los dos costos que importan son otros, y ninguno de los dos es una factura de hosting:

| | Qué es | Riesgo |
|---|---|---|
| **Límite de GHL** | Un tope de requests por subcuenta, no un cobro | Se alcanza **con un solo closer** trabajando 8 horas, cuando el sistema esté en uso real |
| **API de Anthropic** | El analizador de conversaciones, por uso | **~$0,02 por mensaje analizado.** Es el único gasto que crece linealmente con el negocio |

El resto de este documento explica de dónde salen esos números.

---

## Parte 1 — El polling: qué es y por qué existe

### Qué problema resuelve

La app necesita saber cuándo pasa algo en GHL: un contacto escribió, se agendó una cita, un
bot se cayó. Hay dos formas de enterarse:

| | Cómo funciona | Costo |
|---|---|---|
| **Webhook** | GHL avisa cuando pasa algo | Una llamada **por evento real** |
| **Polling** | La app pregunta cada X segundos | Una llamada **cada X segundos, pase algo o no** |

El proyecto usa **polling**. Fue la decisión correcta para arrancar: no depende de que nadie
configure nada en GHL, y funciona desde el primer día. Pero tiene un costo estructural que
conviene entender antes de escalar.

### Los 8 pollings activos

Los escribió Kevin entre el 27 y el 28 de julio, junto con los endpoints que consumen.

| # | Qué trae | Intervalo | Vive en |
|---|---|---|---|
| 1 | **Intervenciones urgentes** | 10s | `closerStore` — todo el módulo |
| 2 | **Pipeline** (territorio completo) | 30s | `closerStore` — todo el módulo |
| 3 | Respondieron / Buzón | 10s | Mi Día (Closer) |
| 4 | Agenda de hoy | 10s | Mi Día (Closer) |
| 5 | Citas de 15 días | 10s | Pipeline |
| 6 | Citas de 15 días | 10s | Agenda |
| 7 | Urgentes del setter | 10s | Mi Día (Setter) |
| 8 | Conversación del chat | 10s | Ficha abierta, tab Chat |

Tres cosas que conviene tener claras sobre cómo funcionan:

**No son un sistema — son ocho relojes sueltos.** Cada uno vive en su componente. No se
coordinan, no comparten caché, no saben uno del otro.

**Solo corre lo que está en pantalla** (salvo los dos del store, que corren mientras el
módulo esté abierto). Cambiar de pestaña apaga unos y prende otros.

**Dos pestañas abiertas = el doble de consumo.** No hay nada que deduplique. Dos closers
mirando Mi Día son seis pollings pegándole a la misma subcuenta de GHL.

### No todos cuestan lo mismo

Esta es la parte que no se ve mirando la lista. Un polling **no** equivale a una llamada a
GHL — algunos hacen una, otro hace hasta cien.

| Endpoint | Llamadas a GHL por ciclo |
|---|---|
| Agenda | 1 |
| Pipeline | 1 por página (pagina de a 100) |
| Conversación | 2 |
| Urgentes | 1 + 1 por cada contacto con el bot caído |
| **Respondieron** | **1 + 2 por cada contacto sin bot activo** |

**`respondieron` es el único con fan-out**, y por una razón de fondo: sin webhook, la única
forma de saber si alguien escribió es **preguntar contacto por contacto**. Con el tope de 50
contactos, el peor caso son `1 + 2×50 = 101 llamadas` cada 10 segundos.

Hay una mitigación ya puesta en el código: el filtro del bot corre **antes** de pedir la
conversación, así que solo los contactos sin bot activo pagan las dos llamadas.

---

## Parte 2 — Vercel

### Cuántas invocaciones genera el uso real

Con un closer en Mi Día 8 horas (3 pollings activos, más el chat abierto la mitad del tiempo):

```
~21 invocaciones/min × 480 min × 22 días hábiles ≈ 220.000 al mes, por closer
```

### Contra lo que incluye el plan Pro

| Closers | Invocaciones/mes | ¿Entra en el plan? |
|---|---|---|
| 1 | 220.000 | Sí, sobra |
| 4 | 880.000 | Sí, al límite |
| 10 | 2,2M | Excedente de 1,2M |

El excedente de invocaciones se cobra por millón y es del orden de centavos. **Ni con veinte
closers esto se nota en la factura.**

### Por qué la duración tampoco pesa

Fluid Compute factura **CPU activo**, no tiempo de reloj. Estos endpoints se pasan la vida
**esperando** la respuesta de GHL, y esperar no se factura. Un endpoint que tarda 3 segundos
en responder puede haber usado 50 milisegundos de CPU.

> Los precios exactos conviene confirmarlos en el panel de Vercel antes de presentarlos —
> cambian, y este documento se escribió con la información disponible ese día.

---

## Parte 3 — GHL: el techo real

Los límites de GHL son **por subcuenta**, no por cuenta global: aproximadamente 100 requests
cada 10 segundos, y 200.000 por día.

Eso importa para el modelo de negocio: **cada cliente tendrá su propia subcuenta**, así que
el límite **no** se comparte entre clientes. El problema aparece con **varios closers del
mismo cliente**.

### Hoy — medido contra la cuenta real

Consultado directamente a GHL el 2026-07-30:

```
zona_closer         3 contactos
bot_pausado_fallo   3 contactos  (distintos, ninguno con zona_closer)
zona_setter         0
```

Con esos datos el fan-out **no se dispara**: los tres con el bot caído se filtran antes, y
los tres de `zona_closer` tienen el bot activo, así que se descartan sin pedir conversación.

| | Hoy |
|---|---|
| Llamadas a GHL por ciclo | ~3 |
| Requests por jornada de 8h | **~8.600** |
| Contra el límite diario | **4%** |

**Hoy no hay ningún problema.**

### Cuando el sistema esté en uso — proyección

El fan-out crece con el uso normal: **cada contacto que el closer atiende apaga su bot**, y
un bot apagado es un contacto que cuesta dos llamadas por ciclo.

Con 100 contactos en `zona_closer`, 30 de ellos ya trabajados:

```
respondieron = 1 + 2×30 = 61 llamadas por ciclo
             × 6 ciclos/min × 480 min
             = 175.680 llamadas/día
```

| | Hoy | Con 100 contactos trabajados |
|---|---|---|
| Requests/día | ~8.600 | ~176.000 |
| % del límite diario de GHL | 4% | **88%** |
| Closers que entran | muchos | **uno** |

**Un solo closer consumiría el 88% del límite diario.** Dos lo revientan.

Es importante entender que esto **no es un costo en dinero** — es un techo operativo. Al
alcanzarlo, GHL empieza a rechazar requests y la app deja de ver datos actualizados.

### Las tres salidas, de más barata a más definitiva

**1. Subir los intervalos.** Cuatro constantes. Los 10 segundos no aportan nada en Agenda o
Pipeline — una cita no cambia cada 10 segundos.

```
Chat            10s   (se justifica: estás conversando)
Urgentes        30s
Respondieron    60s   ← el que realmente pesa
Agenda          120s
```

Eso baja el consumo **~5 veces** sin que se note en la experiencia.

**2. Pausar con la pestaña oculta.** Hoy el polling no se detiene si dejás la app abierta y
te vas. Una noche olvidada son ~17.000 requests que no le sirven a nadie. Se resuelve con
`document.visibilityState`.

**3. El webhook para el buzón — la solución de fondo.** El fan-out de `respondieron` existe
únicamente porque hay que preguntar. Con el webhook de mensaje entrante, GHL avisa: se pasa
de 61 llamadas cada 10 segundos a **una llamada cuando efectivamente alguien escribe**.

El endpoint del webhook **ya está construido y desplegado** (`/api/webhooks/ghl`). Solo falta
crearlo del lado de GHL.

---

## Parte 4 — Anthropic: el único costo que crece con el negocio

Esta es la parte que suele quedar fuera de la conversación de costos, y es la que más importa
a largo plazo.

### Qué es

`api/_lib/analizador.ts` (369 líneas, de Kevin) analiza cada conversación con Claude para
detectar cuándo un agente de IA falló: prometió algo que no debía, no entendió una intención
de pago, dejó de responder. Cuando detecta un fallo, aplica el tag `bot_pausado_fallo` y el
contacto aparece en la cola roja del closer.

Es lo que hace que "Intervenciones Urgentes" tenga contenido. Sin esto, esa sección está
siempre vacía.

### Configuración actual

```
Modelo:           claude-opus-5
Contexto:         últimos 40 mensajes de la conversación
Salida máxima:    2.000 tokens
```

### Precio y costo por análisis

Precios oficiales de Claude Opus 5:

| | Por millón de tokens |
|---|---|
| Entrada | **$5** |
| Salida | **$25** |

Estimando ~3.000 tokens de entrada (prompt + esquema + 40 mensajes) y ~300 de salida (el
veredicto estructurado):

```
Entrada:  3.000 × $5/1M   = $0,015
Salida:     300 × $25/1M  = $0,0075
                            ────────
Por análisis                ≈ $0,02
```

### Proyección mensual

| Mensajes analizados/día | Costo/mes |
|---|---|
| 50 | ~$34 |
| 100 | ~$67 |
| 500 | ~$338 |
| 1.000 | ~$675 |

**Hoy el costo es cero**, porque los webhooks no están creados y el analizador solo corre si
alguien lo dispara a mano. **En cuanto se activen los webhooks, este gasto empieza a correr.**

Y hay un detalle que duplica la factura: el analizador se dispara tanto cuando **entra** un
mensaje como cuando **sale** uno. Una conversación de ida y vuelta se analiza dos veces por
intercambio.

### Cómo bajarlo, si hace falta

Cuatro palancas, de menos a más invasiva:

| Palanca | Ahorro | Costo |
|---|---|---|
| Analizar solo mensajes **entrantes** | ~50% | Ninguno real — el fallo del bot se ve en lo que responde el contacto |
| Usar **Claude Sonnet 5** en vez de Opus | ~40% | Menos precisión en la detección |
| Reducir el contexto de 40 a 20 mensajes | ~30% de la entrada | Menos contexto para juzgar |
| Analizar **cada N mensajes** en vez de todos | proporcional | Se detecta el fallo más tarde |

La primera es gratis y debería hacerse igual.

---

## Parte 5 — Supabase

La base de datos (proyecto SOFIA) es compartida con otros cuatro sistemas de ARIA
(`agentforge_*`, `aria_brain_*`, `ht_*`, `ob_*`), así que su costo no es atribuible solo a
esta herramienta.

El volumen que genera este módulo es bajo: escribe seguimientos, notas y eventos de
historial — del orden de decenas de filas por día por closer, no miles. **No es un factor de
costo en ningún escenario previsible.**

---

## Parte 6 — Cuadro para presentar

| Concepto | Hoy | 1 closer activo | 5 closers | Crece con |
|---|---|---|---|---|
| **Vercel Pro** | $20/mes | $20 | $20 | prácticamente nada |
| **Anthropic** | $0 | ~$67 | ~$340 | **volumen de conversaciones** |
| **Supabase** | compartido | compartido | compartido | nada relevante |
| **GHL (límite)** | 4% | 88% ⚠️ | **excedido** | contactos trabajados |

### Lo que hay que decirle al dueño

**El hosting es un costo fijo y bajo.** $20/mes cubre el escenario realista.

**El costo variable es la IA**, y es proporcional al volumen de conversaciones. Es predecible
y se puede acotar con las palancas de la Parte 4. Conviene presentarlo como **costo por
conversación** (~$0,04 ida y vuelta), no como monto mensual — así escala solo con el negocio.

**El riesgo no es de dinero, es de límite.** GHL se agota antes de que Vercel cueste algo, y
eso no se arregla pagando más — se arregla con las tres medidas de la Parte 3.

### Y para multi-cliente

Cada cliente traerá su propia subcuenta de GHL, así que **el límite no se comparte** — el
techo es por cliente, no global. Eso es una buena noticia para escalar.

Lo que **sí** se comparte hoy es la API key de Anthropic. Si cada cliente pone la suya (que
es hacia donde va el diseño de Ajustes), el costo variable pasa a ser de ellos y ARIA solo
carga con el hosting. Es una decisión de modelo de negocio que conviene tomar antes de que
haya clientes reales, no después.
