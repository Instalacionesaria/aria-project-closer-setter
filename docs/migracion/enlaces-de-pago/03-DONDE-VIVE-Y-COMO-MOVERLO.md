# 03 · Dónde vive el catálogo hoy, y cómo moverlo

**Es el documento que decide si esta función sirve o no.**

---

## 1 · El hecho

> **El catálogo se guarda en el almacenamiento del navegador, bajo una sola clave, junto con el resto
> de la configuración personal.**

No es una caché de algo que está en el servidor. **Es el único lugar donde existe.**

```
El admin carga 6 enlaces  →  se guardan en SU navegador
El vendedor abre el menú  →  su navegador no tiene nada  →  menú vacío
```

**Y no falla nada.** No hay error, no hay aviso, no hay estado de carga: el menú simplemente no tiene
enlaces, exactamente igual que si nadie hubiera cargado ninguno.

---

## 2 · Las cinco consecuencias, todas verificables en dos minutos

| Prueba                                                      | Qué pasa hoy                                              |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| Cargar un enlace y abrir la aplicación **con otro usuario** | El menú está vacío                                        |
| Cargar un enlace y abrir **en otra computadora**            | El menú está vacío                                        |
| Cargar un enlace y abrir **en una ventana privada**         | El menú está vacío                                        |
| **Borrar los datos del navegador**                          | El catálogo desaparece                                    |
| Dos administradores cargando enlaces distintos              | **Cada uno ve solo los suyos**, y ninguno está equivocado |

> **La última es la peor**, porque no se ve como una falla: se ve como que el otro no cargó nada.

### Y hay una consecuencia más, que es de aislamiento

**El catálogo no está asociado a ninguna empresa.** Es del navegador. Si una misma persona administra
dos empresas, **ve la misma lista de enlaces en las dos** — y los enlaces de cobro de una empresa
aparecen en el menú de la otra.

---

## 3 · Este producto ya resolvió exactamente esto, y el camino está probado

**Los porcentajes de comisión vivían igual: en el almacenamiento del navegador.** El diagnóstico que
justificó moverlos vale palabra por palabra acá:

> **Dos administradores de la misma empresa veían números distintos del mismo vendedor, y ninguno
> estaba equivocado.**

Se movieron a la base, **por empresa**, y con dos correcciones que conviene copiar:

| Corrección                                           | Por qué                                                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Indexados por **identificador**, no por nombre       | Con la clave vieja, **renombrar a alguien le borraba su comisión** en silencio                                                      |
| **Se borró la copia vieja entera**, no se dejó vacía | Un mapa que nadie lee pero que se sigue guardando es el mismo modo de falla que una tabla que se escribe con éxito y nadie consulta |

**Con el catálogo aplica lo mismo**: cuando se mueva, la copia del navegador **se deja de escribir y de
leer**, no se deja "por si acaso".

---

## 4 · Qué hace falta para moverlo

Es una función chica. **Lo que la hace correcta son cuatro detalles:**

### 4.1 · Va por empresa, y con las reglas de aislamiento de siempre

Un enlace de cobro es de una empresa y de ninguna otra. **La lectura tiene que estar acotada por
empresa**, igual que todo lo demás.

> **Y una URL de cobro no es un secreto pero tampoco es pública:** dice con quién cobra esa empresa y
> cuánto. No debería poder leerla nadie fuera de ella.

### 4.2 · El alcance por rol se filtra en el SERVIDOR, no en la vista

Hoy el filtro por rol lo hace la pantalla. **Al mover el catálogo, el filtro va del lado del servidor.**

> **Esconder un ítem en la interfaz no es un permiso.** Es la misma lección que la pestaña de prompts:
> el endpoint queda expuesto igual.

### 4.3 · Los tres estados se distinguen

| Estado                     | Qué se ve                                  |
| -------------------------- | ------------------------------------------ |
| **Cargando**               | No se afirma nada todavía                  |
| **Cargó y no hay enlaces** | "Todavía no hay enlaces cargados"          |
| **No se pudo saber**       | Se dice, y **no** se muestra un menú vacío |

**Hoy los tres se ven iguales**, porque leer el almacenamiento del navegador no falla nunca. **Contra un
servidor sí falla**, y un menú vacío por una caída se lee como "el admin no cargó nada".

### 4.4 · Lo que ya está guardado en cada navegador NO se limpia solo

**Alguien puede seguir viendo su lista vieja después de la migración**, incluidas las semillas de
ejemplo que se borraron hace tiempo.

> **Si alguien todavía ve un enlace a un dominio de prueba, es su copia vieja.**

**Al migrar hay que decidir qué pasa con esas copias**, y la opción honesta es dejar de leerlas: que el
menú muestre lo que el servidor dice y nada más, aunque el primer día se vea vacío para todos.

---

## 5 · Una trampa concreta de esa clave guardada

**La clave guardada es un objeto con varias secciones adentro**, y hay una que **no se puede
renombrar** aunque el módulo al que pertenece ya cambió de nombre:

> Si se renombra, la lectura no la encuentra, **cae al valor por defecto y sustituye en silencio** —
> sin error y sin aviso.

**Al mover el catálogo afuera, esa trampa desaparece para él** pero sigue viva para el resto de esa
clave. Conviene moverlo **sin tocar el nombre de las otras secciones**.

---

## Lista de verificación

1. El catálogo **vive en el navegador**, y es el único lugar donde existe.
2. **No falla nada**: un menú vacío por eso se ve igual que uno sin cargar.
3. **Cinco consecuencias**, todas verificables en dos minutos.
4. **No está asociado a ninguna empresa**: dos empresas comparten la lista del navegador.
5. El mismo problema **ya se resolvió** con los porcentajes de comisión.
6. Al mover: **por empresa**, **filtro de rol en el servidor**, **tres estados distinguibles**.
7. **La copia vieja se deja de leer**, no se deja "por si acaso".
8. **No renombrar** las otras secciones de la clave guardada.
