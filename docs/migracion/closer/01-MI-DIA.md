# 01 · Mi Día — qué va y qué NO va en cada cola

La pantalla donde se trabaja. Arriba un resumen con tarjetas que hacen scroll a su sección; abajo las
cinco colas, en este orden fijo.

**Una sola llamada las trae todas**, y esa llamada **no habla con el CRM**: son consultas a la base
propia y nada más. Por eso puede correr cada 10 segundos sin gastar presupuesto de API.

| Cola                            | Qué junta                             | Cuenta para el contador de tareas |
| ------------------------------- | ------------------------------------- | --------------------------------- |
| **1 · Intervenciones urgentes** | La IA falló y hace falta un humano ya | **Sí**                            |
| **2 · Agenda de hoy**           | Las citas del día                     | No                                |
| **3 · Respondieron · Buzón**    | Escribieron y nadie contestó          | **Sí**                            |
| **4 · Seguimientos de hoy**     | Los que tocan o vencen hoy            | **Sí**, con una excepción         |
| **5 · Completadas hoy**         | Lo cerrado en el día                  | No                                |

---

## La regla que gobierna las cinco

> **Ninguna cola es un campo guardado. Las cinco son consultas.**

No existe una columna "está en el buzón" ni un `es_urgente`. Cada cola se calcula en el momento a
partir de datos que ya están ahí por otro motivo. Es la decisión más importante de esta pantalla y hay
dos razones:

1. **Un estado guardado se desincroniza; una consulta no puede.** Si el buzón fuera un flag, cada vez
   que entra un mensaje habría que acordarse de encenderlo, y cada vez que alguien responde, de
   apagarlo. El día que un camino se olvide, el contacto queda en la cola para siempre o no entra nunca.
2. **A medianoche se vacía sola.** "Completadas hoy" y "Agenda de hoy" filtran por fecha: cuando cambia
   el día, la lista cambia sin que nadie corra nada.

---

## Cola 1 · Intervenciones urgentes

Lo más grave de la pantalla: el agente de IA falló y alguien tiene que entrar a la conversación.

### Qué va

Un contacto entra **solo** si tiene alguno de los **tres tags de fallo del auditor** en sus tags
cacheados:

| Tag                        | Qué significa                                   |
| -------------------------- | ----------------------------------------------- |
| `bot_desactivado_appflow`  | Falló el agente de chat **post-agenda**         |
| `bot_desactivado_leadflow` | Falló el agente de chat **pre-agenda**          |
| `bot_pausado_fallo`        | **Legado.** El tag único de antes de separarlos |

**El motivo del fallo no se pide al CRM**: lo escribió el auditor en la base, y se lee de ahí. Si no hay
motivo guardado, la fila muestra un texto de reserva —"requiere intervención, revisar conversación"—
**nunca queda vacía**.

### Qué NO va

| No entra                    | Por qué                                                   |
| --------------------------- | --------------------------------------------------------- |
| Los **congelados**          | Están fuera del territorio: no son trabajo de este closer |
| Cualquiera sin tag de fallo | El auditor no lo marcó. No hay urgencia que atender       |

### Y una consecuencia que hay que respetar

Un contacto en Urgentes **no aparece en el Buzón**, aunque cumpla todas las condiciones del Buzón.
Gana la cola más específica. **Dos colas para la misma persona hacen que atender una no cierre la
otra**, y el closer termina trabajando el mismo caso dos veces sin saberlo.

---

## Cola 2 · Agenda de hoy

Las citas del día, en orden de hora.

### Qué va

Las citas cuya fecha cae **entre el inicio y el fin del día en la zona horaria de la organización** —no
la del navegador— y que **no están canceladas**.

Cada fila trae la hora, el estado de la cita, el enlace de la videollamada si existe, y **los seis
íconos del contacto**.

### Qué NO va

| No entra           | Por qué                                     |
| ------------------ | ------------------------------------------- |
| Las **canceladas** | Se excluyen en la consulta                  |
| Las de otros días  | El tab Agenda las muestra; esta cola es hoy |

### Lo que SÍ va y sorprende: las vencidas

**Una cita cuya hora ya pasó y que nadie cerró con Avanzar sigue en la lista**, marcada como vencida y
ordenada abajo. **No desaparece.** Si desapareciera, el closer perdería de vista exactamente la cita
que tiene pendiente de registrar.

> **Y un defecto que ya ocurrió acá, para no repetirlo:** esta cola tenía los seis íconos
> **fijos en cero**. Apagaba los íconos de contactos que sí tenían el dato, en la única vitrina que el
> closer mira **antes** de entrar a una llamada. Los íconos van con el contacto a donde se muestre.

---

## Cola 3 · Respondieron · Buzón general

Contactos que escribieron y a los que **nadie les respondió**. Es la cola que más condiciones tiene, y
todas son necesarias.

### Qué va — las cinco condiciones, todas obligatorias

| #   | Condición                                                          | Si falta                                       |
| --- | ------------------------------------------------------------------ | ---------------------------------------------- |
| 1   | **No está congelado**                                              | No es del territorio                           |
| 2   | **No está ya en Urgentes**                                         | Gana la cola más específica                    |
| 3   | **Pertenece al closer** por sus tags                               | Es del setter, o de nadie                      |
| 4   | **El bot está APAGADO**                                            | Si la IA atiende, no hay nada que hacer a mano |
| 5   | **Su último mensaje entrante es posterior a la última resolución** | Ya lo atendieron y no volvió a escribir        |

La lista se ordena por **el mensaje más reciente primero**, y cada fila trae un fragmento del mensaje
—los primeros 80 caracteres— para decidir sin abrir la ficha.

### Qué NO va

| No entra                                         | Por qué                                                        |
| ------------------------------------------------ | -------------------------------------------------------------- |
| Los que tienen **bot atendiendo**                | **La regla de fondo:** una IA activa nunca genera tarea humana |
| Los **congelados**                               | Fuera del territorio                                           |
| Los que están en **Urgentes**                    | Una persona, una cola                                          |
| Los que **nunca escribieron**                    | No hay nada que responder                                      |
| Los **ya resueltos**, si no volvieron a escribir | La resolución los saca; un mensaje nuevo los devuelve          |

### La condición 5, que es la que hace que la cola funcione

No se guarda "resuelto: sí/no". Se comparan **dos fechas**: la del último mensaje entrante y la de la
última vez que alguien resolvió el buzón de ese contacto.

- Escribe → entrante nuevo → **entra**.
- Alguien lo atiende → se sella la resolución → **sale**.
- Vuelve a escribir → el entrante es más nuevo que la resolución → **entra de nuevo, solo**.

Con un flag, ese tercer paso habría que programarlo. Con dos fechas, sale gratis.

---

## Cola 4 · Seguimientos de hoy

Los seguimientos que **tocan hoy o que ya vencieron**. Salen de una vista de la base que ya hace el
filtro por fecha.

### Qué va, y en cuatro sabores distintos

Cada fila viene clasificada en uno de cuatro casos, y **no significan lo mismo para el trabajo del
día**:

| Caso                  | Qué es                                       | ¿Pide manos?      |
| --------------------- | -------------------------------------------- | ----------------- |
| `manual_de_hoy`       | Lo retoma una persona, y le toca hoy         | **Sí**            |
| `manual_vencido`      | Le tocaba antes y sigue sin atender          | **Sí**, y en rojo |
| `serie_agotada`       | La serie automática se terminó sin respuesta | **Sí**            |
| `automatico_en_curso` | La serie automática está corriendo sola      | **No**            |

El orden es: **primero los fijados**, después por fecha objetivo ascendente.

### Qué NO va

| No entra            | Por qué                       |
| ------------------- | ----------------------------- |
| Los de días futuros | La vista ya filtra por fecha  |
| Los cerrados        | Salen de la vista al cerrarse |

### El detalle del contador que casi siempre se implementa mal

> **El contador de tareas cuenta los seguimientos que piden manos, NO todos los de la lista.** Los
> `automatico_en_curso` **se muestran** en la sección —el closer quiere ver que la serie está
> corriendo— pero **no suman** al contador.

Sumarlos haría que el badge diga "12 tareas pendientes" cuando nueve de esas doce las está haciendo un
robot. El closer abre la pantalla, ve nueve filas que no requieren nada, y a la tercera vez deja de
creerle al contador.

---

## Cola 5 · Completadas hoy

Lo que se cerró en el día. **Siempre visible, aunque esté vacía**: es el ancla de la pantalla y lo
único que le dice al closer "esto ya lo hiciste".

### Qué va — dos orígenes distintos

| Origen                      | Cuándo entra                                   |
| --------------------------- | ---------------------------------------------- |
| **Un resultado de Avanzar** | Cualquiera de las seis salidas, registrada hoy |
| **Una resolución de buzón** | Alguien atendió un contacto del buzón hoy      |

Ordenadas por hora, la más reciente primero. Cada fila dice **qué la completó**: la salida de Avanzar,
o que fue una resolución de buzón.

### Qué NO va

Nada más. **No se marca "completada" por responder un mensaje** — eso completa la _tarea_ de la fila,
que es otra cosa.

### La fila huérfana, que hay que dejar entrar

Si alguien registró un resultado sobre un contacto que **ya no está en la caché** —lo borraron del
pipeline después—, **la fila sigue apareciendo**, sin nombre y sin íconos, pero apareciendo.

Es deliberado: el trabajo se hizo y tiene que constar. Lo que **no** se hace es inventarle datos.

---

## Cómo se arma todo esto, en una pasada

Vale entenderlo porque explica por qué la pantalla es barata:

```
1 · UNA consulta trae los contactos cacheados          → alimenta Urgentes, Buzón y Completadas
2 · UNA consulta trae los seis indicadores de todos    → alimenta las CINCO colas
3 · Una consulta por cola para lo específico           → citas, la vista de seguimientos, los avances
4 · Se compone el resumen con los cinco contadores
```

**Los seis íconos se cargan una sola vez para todos**, y viajan con cada contacto en cada cola. Por eso
se ven iguales en Mi Día, en el Pipeline y en la ficha: **es el mismo dato, no tres cálculos que
coinciden**.

---

## Dos trampas de implementación que ya costaron caro

**1 · Quien arma las colas es dueño de su consulta.** La lista de columnas que se piden **no se recibe
por parámetro**. Si otro código lee esas filas y pide menos columnas, el compilador **no dice nada** y
la pantalla degrada en silencio:

| Columna que falta            | Qué se rompe, sin error           |
| ---------------------------- | --------------------------------- |
| La fecha del último entrante | **El Buzón queda vacío**          |
| La marca de congelado        | Los congelados entran a dos colas |

**2 · El orden de las claves de la respuesta importa.** El cuerpo se serializa en el orden en que se
armó, y hay clientes que dependen de él. No es elegante y es real: cambiarlo es un cambio de contrato.

---

## Lista de verificación

1. Las cinco colas salen de **consultas**, no de campos guardados.
2. **Cero llamadas al CRM** para armar esta pantalla.
3. Un contacto está en **una sola cola**: Urgentes gana sobre Buzón.
4. Los **congelados** no entran ni a Urgentes ni al Buzón.
5. Una **IA activa** nunca genera tarea humana.
6. Las citas **vencidas no desaparecen**: bajan y se marcan.
7. Los seis íconos **viajan con el contacto** en las cinco colas, con sus valores reales.
8. El contador **excluye** los seguimientos automáticos en curso.
9. "Completadas hoy" **siempre se renderiza**, vacía o no.
10. Un resultado de un contacto que ya no existe **sigue constando**, sin datos inventados.
