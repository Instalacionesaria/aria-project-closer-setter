# El módulo Closer — cómo funciona, para replicarlo

Esta carpeta describe **el módulo entero**: qué muestra cada pantalla, con qué reglas, qué etiquetas lo
gobiernan, qué escribe cada acción, y —sobre todo— **cómo se mantiene todo fresco sin fundir el
presupuesto de llamadas al CRM**.

Está escrita para que otra herramienta pueda **reproducir el comportamiento**, no para navegar este
código: no hay nombres de archivo, de tabla ni de proveedor.

---

## Los nueve documentos

| #      | Documento                                                    | Qué contiene                                                                     |
| ------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **01** | [Mi Día](01-MI-DIA.md)                                       | Las cinco colas: **qué va y qué NO va** en cada una, con sus condiciones exactas |
| **02** | [Pipeline](02-PIPELINE.md)                                   | Las siete columnas y las ocho reglas que las gobiernan                           |
| **03** | [Agenda](03-AGENDA.md)                                       | El calendario, cada botón con lo que cuesta, y cómo se actualiza                 |
| **04** | [Polling y datos en vivo](04-POLLING-Y-DATOS-EN-VIVO.md)     | **Los relojes del navegador.** Cuántos, cada cuánto, y qué NO tiene reloj        |
| **05** | [Inicio y los contadores](05-INICIO-Y-CONTADORES.md)         | El tablero, y la regla de que un número se calcula **una sola vez**              |
| **06** | [Avanzar](06-AVANZAR.md)                                     | Las seis salidas y **todo** lo que escribe cada una                              |
| **07** | [La fila y los seis íconos](07-LA-FILA-Y-LOS-SEIS-ICONOS.md) | El componente compartido por las tres pantallas                                  |
| **08** | [Etiquetas y estados](08-ETIQUETAS-Y-ESTADOS.md)             | Qué etiqueta gobierna qué, y el estado del agente de IA                          |
| **09** | [Ingesta y reconciliación](09-INGESTA-Y-RECONCILIACION.md)   | **El servidor.** El candado, la marca de agua y el presupuesto, con sus números  |

**Si vas a replicar esto, empezá por el `04` y el `09`.** Son los dos que explican por qué el sistema
soporta a todo el equipo mirando la pantalla todo el día sin agotar el límite de un CRM ajeno — y son la
parte que más fácil se rehace mal, porque un reloj de más no falla: solo gasta.

---

## El modelo, en una página

**El Closer es el territorio post-agenda: de la cita a la venta.** Cuatro pantallas y una ficha.

### La arquitectura, en una frase

> **Todo lo que el usuario mira sale de una caché propia. El CRM solo se toca para TRAER datos, y con
> candado.**

De ahí salen las tres propiedades que hacen que esto escale:

| Propiedad                                             | Consecuencia                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| Las cuatro pantallas cuestan **cero** llamadas al CRM | Mirar todo el día es gratis                                        |
| El candado del servidor es un **update condicional**  | **N pestañas cuestan lo mismo que una**                            |
| El barrido camina por **marca de agua**               | El costo crece con la **actividad**, no con el tamaño de la cuenta |

### Las cuatro pantallas

| Pantalla     | Para qué                      | Reloj                           |
| ------------ | ----------------------------- | ------------------------------- |
| **Inicio**   | ¿Cómo voy este mes?           | 60 s                            |
| **Mi Día**   | ¿Qué hago ahora?              | **10 s** — el reloj principal   |
| **Pipeline** | ¿Cómo está mi cartera?        | **Ninguno**, por evento         |
| **Agenda**   | ¿Qué tengo hoy y esta semana? | **Ninguno**, por evento y botón |

### Las cinco reglas que atraviesan todo

Si alguna se rompe, **el sistema sigue funcionando y muestra datos falsos** — que es peor que caerse.

1. **Sin dato, el elemento no se dibuja.** Un cero medido y un cero no medido no son el mismo hecho. Un
   contador en cero se atenúa; no muestra "0".
2. **Nunca reportar un éxito que no ocurrió.** Si una escritura falla, la respuesta lo dice — aunque sea
   accesoria y no se pueda hacer nada.
3. **Una sola derivación por regla.** Si dos pantallas muestran el mismo número, **comparten la función
   que lo calcula**. Dos implementaciones divergen en silencio, y las dos parecen correctas.
4. **Lo que se calcula al leer no envejece; lo que se guarda calculado, sí.** Guardar un resultado ya
   calculado es una excepción que se justifica por escrito, con su frescura declarada.
5. **Los eventos automáticos no pasan por el registro humano.** Se anotan solos, con autor `Sistema`.

### Y una regla de interfaz que vale para las cuatro pantallas

> **Nunca mostrarle al usuario un texto de diagnóstico.**

Una sección vacía dice que está vacía, en castellano. No nombra endpoints, ni etiquetas del CRM, ni
permisos de un token. Dos motivos: quien lo lee no puede hacer nada con eso, y **esos textos envejecen
sin que nada falle** — el día que la fuente sí funciona, la pantalla sigue diciendo que no.

---

## El orden en que conviene construirlo

Cada paso hace visible el siguiente.

| #   | Qué                                  | Por qué acá                                                                   |
| --- | ------------------------------------ | ----------------------------------------------------------------------------- |
| 1   | **La ingesta y su candado** (`09`)   | Sin datos en la caché, las cuatro pantallas están vacías                      |
| 2   | **La fila y los seis íconos** (`07`) | La usan las tres pantallas. Hecha al final, hay que rehacer las tres          |
| 3   | **La ficha** con sus cinco tabs      | Es a donde llevan todas las filas                                             |
| 4   | **Avanzar** (`06`)                   | Sin resultados, el Pipeline y el tablero están en cero                        |
| 5   | **Mi Día** (`01`)                    | La pantalla donde se trabaja                                                  |
| 6   | **Pipeline y Agenda** (`02`, `03`)   | Leen lo que Avanzar escribió                                                  |
| 7   | **Inicio** (`05`)                    | Es el resumen de todo lo anterior                                             |
| 8   | **Los relojes** (`04`)               | Se cablean al final, cuando ya hay qué refrescar — **nunca uno por pantalla** |

El paso 8 es el que se suele hacer primero y mal: cada pantalla nace con su propio intervalo, y para
cuando alguien mide, hay ocho relojes sueltos golpeando al CRM con la pestaña en segundo plano.
