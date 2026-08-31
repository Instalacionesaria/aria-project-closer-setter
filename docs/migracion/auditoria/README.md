# Auditoría de Agentes — cómo funciona, para replicarla

**Un agente de IA que audita a los otros agentes de IA.**

Lee la conversación entre un agente automático y un contacto, la juzga contra una rúbrica, y produce
dos salidas que **no hay que mezclar**. Esta carpeta describe el módulo entero —el motor, los cuatro
auditores, dónde se pegan sus prompts, la rúbrica adentro, cómo se conecta con la cola de
Intervenciones Urgentes y qué cuesta— para que otra herramienta pueda **reproducir el
comportamiento**.

Sin nombres de archivo, de tabla ni de proveedor.

---

## Lo primero, porque decide todo lo demás

> **El auditor tiene DOS salidas, y confundirlas es el defecto original que este módulo existe para
> arreglar.**

| Salida           | Qué es                                                                   | A quién interrumpe                  |
| ---------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| **Intervención** | Hay daño en curso: un humano tiene que tomar **esta** conversación ahora | Al vendedor — enciende la cola roja |
| **Hallazgo**     | Algo que se puede corregir **en el prompt** del agente                   | A nadie — es la lista del técnico   |

**Que fueran una sola cosa es lo que hacía que un _"podría ser más breve"_ le apagara el agente a una
persona real.**

Una conversación puede tener hallazgos sin necesitar intervención, y puede necesitar intervención sin
que el agente haya hecho nada mal.

---

## Los diez documentos

| #      | Documento                                                | Qué contiene                                                                     |
| ------ | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **01** | [Qué hace y qué no](01-QUE-HACE-Y-QUE-NO.md)             | Las dos salidas, el veredicto de tres niveles, y qué se guarda de cada uno       |
| **02** | [Los cuatro auditores](02-LOS-CUATRO-AUDITORES.md)       | Quién audita a quién, chat y voz, y por qué no es "el mismo con otro contexto"   |
| **03** | [Los prompts](03-LOS-PROMPTS.md)                         | Los cuatro espacios, dónde viven, cómo se versionan y quién puede tocarlos       |
| **04** | [La rúbrica, adentro](04-LA-RUBRICA.md)                  | Cómo está armada, los criterios de cada territorio, y qué se mide en código      |
| **05** | [Los portones y el debounce](05-PORTONES-Y-DEBOUNCE.md)  | Qué frena un análisis antes de gastar, y las señales que lo adelantan            |
| **06** | [Intervenciones urgentes](06-INTERVENCIONES-URGENTES.md) | **Cómo el rojo llega a la cola del vendedor**, y cómo se resuelve                |
| **07** | [El carril amarillo](07-EL-CARRIL-AMARILLO.md)           | Una mejora por día, con su tope y su dimensión propia                            |
| **08** | [La pantalla](08-LA-PANTALLA.md)                         | Tarjetas, patrones, casos, el bloque de corrección y el historial de ajustes     |
| **09** | [Costo y presupuesto](09-COSTO-Y-PRESUPUESTO.md)         | Qué se paga, qué se cachea, y por qué el debounce **es** el control de gasto     |
| **10** | [Estado y huecos conocidos](10-ESTADO-Y-HUECOS.md)       | Qué está encendido, qué lo bloquea, y los defectos que conviene heredar sabiendo |

**Si vas a replicar esto, empezá por el `01` y el `05`.** El primero define qué produce; el segundo es
el que decide **cuándo se gasta plata**, y es la parte que más fácil se rehace mal — un portón de
menos no falla: solo factura.

---

## El modelo, en una página

### El ciclo completo

```
   un mensaje entra o sale          una llamada termina
            │                              │
            ▼                              ▼
     CINCO PORTONES                  CUATRO PORTONES
     (territorio · agente             (contestada · agente
      atendiendo · ya marcado ·        identificado · auditor
      debounce · hay agente)           encendido · sin análisis previo)
            │                              │
            └──────────────┬───────────────┘
                           ▼
                 UNA LLAMADA AL MODELO
              contexto + prompt del agente
              + rúbrica + patrones conocidos
              + hechos medidos + transcript
                           │
                           ▼
                    EL VEREDICTO
              verde · amarillo · rojo · (null)
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
     rojo → NOTA + ETIQUETA       hallazgos → PATRONES
     → cola de urgentes           → pantalla del técnico
     (chat; en voz, solo nota)    → corrección de prompt
```

### Las seis reglas que gobiernan el módulo

1. **Cita textual obligatoria.** Si no se puede copiar la línea que lo prueba, el hallazgo no existe.
2. **Regla de atribución innegociable.** Solo se le imputa al agente lo que dice **una línea suya**.
3. **El nivel se deriva de los hechos, no de lo que dijo el modelo.**
4. **Lo temporal se mide en código.** Los modelos calculan mal el tiempo.
5. **Cada portón evita gasto**, y van del más barato al más caro.
6. **Un verde medido no es lo mismo que la ausencia de análisis**, y la diferencia se guarda.

### El orden en que conviene construirlo

| #   | Qué                                       | Por qué acá                                                             |
| --- | ----------------------------------------- | ----------------------------------------------------------------------- |
| 1   | **La rúbrica y el esquema** (`04`)        | Es el producto entero. Todo lo demás la alimenta o la frena             |
| 2   | **Los espacios de prompts** (`03`)        | Sin el prompt, la corrección es un consejo genérico en vez de un parche |
| 3   | **Los portones y el debounce** (`05`)     | Sin esto, un módulo correcto quema el presupuesto en una semana         |
| 4   | **La persistencia y los patrones** (`08`) | Sin agrupar por patrón, quince casos iguales son quince problemas       |
| 5   | **La cola de urgentes** (`06`)            | Es la única salida que interrumpe a una persona: va después, no antes   |
| 6   | **El carril amarillo** (`07`)             | Es un extra con tope propio. Nada depende de él                         |

**El paso 3 antes del 4 no es negociable.** El módulo funciona sin debounce y cuesta el cuadrado de lo
que debería: cada mensaje dispara un análisis del transcript entero.
