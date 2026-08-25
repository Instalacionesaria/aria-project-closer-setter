# 03 · Agenda — los botones y cómo se actualiza

El calendario del closer. Tres piezas: un **mini-calendario** del mes, **Próximos Días**, y la **agenda
del día seleccionado**.

Como las otras dos pantallas, lee de la caché propia: **cero llamadas al CRM al abrirla**. Las citas las
mantienen el webhook de cita y un cron. La única excepción es un botón, y está explicada abajo.

---

## 1 · Lo que se ve

### El mini-calendario

El mes actual, con los días marcados según tengan citas. Al hacer clic en un día, la agenda de la
derecha cambia a ese día.

### Próximos Días

Cuatro entradas: **hoy y los tres siguientes**, cada una con su **conteo real** de citas y su etiqueta
—"Hoy", "Mañana", y el nombre del día para los otros dos—.

> El conteo sale de **la misma lista que pinta la agenda**. Cuando eran dos fuentes distintas, hubo un
> caso en que la tarjeta anunciaba seis llamadas que no existían: el conteo venía de un lado y la lista
> del otro. Un número y la lista que lo justifica **se derivan del mismo dato**, siempre.

### La agenda del día

Cada cita es una tarjeta que se expande:

| Estado        | Qué muestra                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------- |
| **Colapsada** | Hora · score y nombre · estado de la cita · la flecha de expandir                               |
| **Expandida** | Un resumen de 2–3 líneas de quién es y qué le importa · la línea del video previo · los botones |

---

## 2 · Los botones, uno por uno

### En el encabezado

| Botón          | Qué hace                                                | Cuesta               |
| -------------- | ------------------------------------------------------- | -------------------- |
| **Refrescar**  | Vuelve a pedir el rango **forzando una lectura al CRM** | **1 llamada al CRM** |
| **Nueva Cita** | Crear una cita                                          | —                    |

**"Refrescar" es el único camino manual para traer citas nuevas del CRM**, y por eso existe: el resto
del tiempo la pantalla vive de la caché. Una llamada por clic, por acción explícita de una persona.

> **Por qué hace falta un botón en vez de un reloj.** Hasta que se armó así, esta pantalla pedía las
> citas al CRM **en cada carga**, y el frontend la pedía cada 10 segundos **desde tres vistas a la vez**.
> Eran cientos de llamadas por hora para mostrar una lista que casi nunca cambia. Ahora: cero por
> omisión, una cuando alguien la pide.

### En el mini-calendario

Las flechas de mes anterior y siguiente.

### En cada cita expandida

| Botón             | Cuándo está activo                     | Cuándo NO                                                   |
| ----------------- | -------------------------------------- | ----------------------------------------------------------- |
| **Link del Meet** | La cita **tiene sala** de videollamada | Sin sala: **ícono atenuado con explicación**, no desaparece |
| **Abrir Ficha**   | Siempre                                | —                                                           |

> **El botón de video no desaparece nunca.** Atenuado con su explicación, el closer entiende que esa
> cita no tiene sala. Desaparecido, cree que la interfaz se rompió — y va a buscar el enlace a mano en
> otro lado.

**Y nunca se genera una sala nueva desde acá.** El botón abre **la sala de la cita que ya existe**. Los
tres enlaces del circuito de citas son distintos y no son intercambiables:

| Enlace              | Cuándo nace            |
| ------------------- | ---------------------- |
| El de **agendar**   | Es fijo, del closer    |
| El del **Meet**     | Nace **con cada cita** |
| El de **reagendar** | Nace **con cada cita** |

---

## 3 · Cómo se actualiza

**Esta pantalla no tiene reloj propio.** Antes tenía uno de 10 segundos; se eliminó.

| Momento                             | Qué pasa                                                       | Llama al CRM |
| ----------------------------------- | -------------------------------------------------------------- | ------------ |
| Al **montar** la pantalla           | Pide el rango a la caché                                       | No           |
| Al **recuperar el foco**            | Un disparo inmediato del reloj general                         | No           |
| Al hacer clic en **Refrescar**      | Pide el rango **forzando lectura al CRM**                      | **Sí, 1**    |
| Cuando entra un **webhook de cita** | El servidor actualiza la caché solo                            | —            |
| Dos veces por hora, por **cron**    | Reconcilia las citas y refresca los contactos con cita próxima | —            |

### Quién mantiene la caché al día

Dos mecanismos del lado del servidor, y ninguno depende de que la pantalla esté abierta:

1. **El webhook de cita**, que actualiza al instante cuando alguien agenda, mueve o cancela.
2. **Un cron dos veces por hora** que reconcilia el conjunto y refresca los contactos con cita próxima.

El cron existe porque el webhook cubre lo que el CRM avisa, **y el CRM no avisa todo**. Un cambio hecho
por un automatismo que no dispara webhook no tendría ninguna otra vía de entrar.

### La red de seguridad que evita la pantalla vacía

Hay un caso que un botón manual no cubre: **la primera carga después de un despliegue**, cuando el cron
todavía no corrió y la caché está vacía.

> Si el rango pedido está **vacío** en la caché **y** hay credenciales configuradas, se refresca **una
> sola vez**, solo.

Sin eso, el closer abre la Agenda, la ve vacía, y no tiene forma de saber si no tiene citas o si el
sistema todavía no las cargó. Con eso, el peor caso es una llamada extra la primera vez.

---

## 4 · Detalles de datos que importan

**La hora se reconstruye en la zona de la organización, no en la del navegador.** La fecha se guarda en
tiempo universal, y la hora local se calcula con la zona de la empresa. Un closer que viaja no ve sus
citas corridas.

**Y la definición de "la hora de la cita" está en un solo lugar**, compartida con el Pipeline. Cuando
cada pantalla la calculaba por su cuenta, dos vitrinas mostraban horas distintas para la misma cita.

**Las canceladas se ocultan por omisión**, con un parámetro para incluirlas.

**El nombre se saca del título de la cita** si el contacto no está en la caché, limpiando el prefijo. Y
si no hay nada de dónde sacarlo, va un texto de reserva — **ninguna fila sin nombre**.

**El rango que se pide es de 15 días**, lo suficiente para el mini-calendario y Próximos Días con una
sola llamada.

---

## 5 · Un mismo endpoint, tres consumidores

La agenda la piden tres vitrinas distintas, y el mismo endpoint las sirve con un parámetro:

| Quién pide                            | Qué pide                           |
| ------------------------------------- | ---------------------------------- |
| El widget **Agenda de Hoy** de Mi Día | Solo hoy                           |
| El tab **Agenda** y Próximos Días     | Hoy + 15 días                      |
| El botón **Refrescar**                | Igual, **forzando lectura al CRM** |

**Y la forma de la respuesta es la misma en los tres casos**: la pantalla no distingue de dónde salieron
los datos. Eso es lo que permitió cambiar el origen —de llamar al CRM a leer la caché— **sin tocar una
línea del frontend**.

---

## Lista de verificación

1. **Cero llamadas al CRM** al abrir la pantalla.
2. **Un botón** es el único camino manual, y cuesta **exactamente una** llamada.
3. **Sin reloj propio.** Al montar, al recuperar el foco, y al pedirlo.
4. El botón de video **se atenúa, no desaparece**, cuando la cita no tiene sala.
5. **Nunca se genera una sala nueva**: se abre la de la cita que existe.
6. El conteo de Próximos Días sale de **la misma lista** que pinta la agenda.
7. La hora se reconstruye en la **zona de la organización**, con una sola definición compartida.
8. **Ninguna fila sin nombre**, con texto de reserva si hace falta.
9. Si el rango está vacío y hay credenciales, **un** refresco automático de red de seguridad.
10. La forma de la respuesta **no cambia** según el origen de los datos.
