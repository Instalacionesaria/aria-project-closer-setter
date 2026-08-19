# 03 — Roles y permisos: el modelo extensible

Cómo definir quién puede hacer qué **sin saber todavía cuáles van a ser los roles**, y sin tener que
tocar el núcleo cada vez que aparece uno nuevo.

Este documento es autosuficiente: no depende de los otros de la carpeta.

---

## 1 · La idea central

**El código pregunta por capacidades, nunca por nombres de rol.**

```
✗  si (usuario.rol === "administrador")   →  ¿qué pasa cuando llega "supervisor"?
✓  si (puede(usuario, "usuarios.crear"))  →  el rol nuevo trae su lista y ya
```

Un rol es **un nombre para un conjunto de capacidades**. Nada más. Vive en datos, no en un tipo
enumerado del código.

Las consecuencias de esa sola decisión:

|                        | Con nombres de rol                                      | Con capacidades                |
| ---------------------- | ------------------------------------------------------- | ------------------------------ |
| Agregar un rol         | Buscar cada condicional del código y decidir si entra   | Una fila y sus capacidades     |
| Saber qué puede un rol | Recorrer el código buscando su nombre                   | Consultar una tabla            |
| Cambiar un permiso     | Encontrar todos los lugares y arriesgarse a olvidar uno | Una fila                       |
| Delegarlo al cliente   | Imposible                                               | Una pantalla de administración |

El costo es una capa de indirección y algo más de trabajo el primer día. **Se paga con el primer rol
nuevo.**

---

## 2 · El catálogo de capacidades

Una capacidad es **una acción concreta sobre un recurso**, con un nombre estable:

```
recurso.accion
```

```
organizaciones.crear      usuarios.ver         credenciales.ver
organizaciones.editar     usuarios.crear       credenciales.editar
organizaciones.listar     usuarios.editar      configuracion.editar
                          usuarios.desactivar  auditoria.ver
                          roles.asignar
                          roles.administrar
```

### Cómo elegir la granularidad

Ni una capacidad por endpoint (ingobernable), ni una por sección de la interfaz (demasiado gruesa).
**Una por decisión de negocio distinta.**

La prueba: _"¿existe un rol plausible que necesite A y no B?"_ Si sí, son dos capacidades. Si no, es
una.

- `usuarios.ver` y `usuarios.crear` → **dos**. Un rol de consulta necesita la primera y no la segunda.
- `usuarios.crear` y `usuarios.editar` → **dos**. Alta y modificación se delegan distinto.
- `usuarios.crear` y `usuarios.asignarNombre` → **una**. No hay rol que cree usuarios sin nombrarlos.

### Reglas del nombre

- **Estable para siempre.** Es una clave que va a estar en filas de la base y en condicionales del
  código. Renombrarla es una migración.
- **Sin nombres de rol adentro.** `usuarios.crear`, no `admin.crearUsuarios`. Si el nombre de la
  capacidad menciona un rol, volvimos al problema.
- **Sin nombres de pantalla.** `reportes.ver`, no `pestanaReportes.abrir`. Las pantallas se reorganizan;
  las capacidades no deberían.

### Empezá con pocas

Diez o quince alcanzan para arrancar. Agregar una capacidad cuesta una fila y un condicional; tener
ochenta desde el primer día garantiza que nadie entienda el modelo.

---

## 3 · Roles

Un rol agrupa capacidades y les pone un nombre que la gente entiende.

```
rol: "administrador"
  → usuarios.ver, usuarios.crear, usuarios.editar, usuarios.desactivar,
    roles.asignar, credenciales.ver, credenciales.editar,
    configuracion.editar, auditoria.ver
```

### Dos banderas que conviene tener desde el principio

**`es_sistema`** — el rol no se puede borrar ni renombrar desde la interfaz. Protege a los dos que el
sistema necesita para funcionar (el de plataforma y el de administración). Sin esto, un administrador
puede borrar su propio rol y dejar la organización sin nadie que administre.

**`solo_principal`** — el rol solo puede existir en la organización principal. Es la barrera contra la
**escalada entre inquilinos**: sin ella, el administrador de una empresa cliente podría otorgarse el rol
de plataforma dentro de su propia empresa y con él ver a todas las demás.

Esa segunda bandera **la tiene que hacer cumplir la base de datos**, con un disparador sobre la tabla
de asignaciones. Un condicional del backend se saltea con un script de mantenimiento; el disparador no.

### El rol de plataforma es el mayor riesgo del sistema

Quien lo tiene ve todas las organizaciones. Tres precauciones:

1. **Acotado a la organización principal** (la bandera de arriba, con disparador).
2. **Un administrador no lo puede otorgar.** Ni siquiera dentro de la organización principal.
3. **Cuando mira otra organización, la interfaz lo muestra de forma permanente.** No es decoración: sin
   eso, alguien puede mirar la pantalla, sacar una conclusión sobre "los números" y estar viendo los de
   otro cliente.

---

## 4 · Los permisos efectivos

La unión de las capacidades de todos los roles del usuario. **Solo suma, nunca resta.**

```sql
select rp.permiso
  from usuarios_roles ur
  join roles_permisos rp on rp.rol_id = ur.rol_id
 where ur.usuario_id = $1;
```

> **Por qué no hay negaciones.** Un modelo con "permitir" y "denegar" necesita reglas de precedencia, y
> esas reglas se vuelven imposibles de razonar en cuanto alguien tiene tres roles. ¿Gana la denegación
> más específica? ¿El rol asignado último? Nadie va a poder explicar por qué un usuario no puede hacer
> algo.
>
> Si hace falta que alguien tenga _casi_ un rol, la respuesta es **un rol nuevo** con las capacidades
> que corresponden. Con este modelo cuesta una fila, que es exactamente el punto.

### Cachearlos en la sesión, con cuidado

Consultar los permisos en cada petición es una consulta más. Se pueden calcular al validar la sesión y
llevarlos en el contexto de la petición.

**Lo que no conviene es guardarlos dentro del token o de la cookie**: si a alguien le quitan un permiso,
seguiría teniéndolo hasta que su sesión venza. Calculado por petición, el cambio es inmediato.

---

## 5 · El portero del servidor

Una sola función, y **toda** operación empieza llamándola.

```
funcion exigir(peticion, respuesta, capacidadesRequeridas):

    # 1 · ¿Hay sesión válida?
    contexto = resolverSesion(peticion)
    si no contexto:
        responder 401 { codigo: "sin_sesion" }
        devolver nulo

    # 2 · ¿Tiene contraseña temporal sin cambiar?
    #     ANTES de los permisos: si fuera después, cualquier operación que no pida
    #     capacidades lo dejaría trabajar con una contraseña dictada por teléfono.
    si contexto.debeCambiarPassword y capacidadesRequeridas != "ninguna":
        responder 403 { codigo: "password_temporal" }
        devolver nulo

    # 3 · ¿La organización está activa?
    organizacion = resolverOrganizacion(contexto.orgEfectiva)
    si no organizacion.activa:
        responder 403 { codigo: "organizacion_inactiva" }
        devolver nulo

    # 4 · Las operaciones abiertas a cualquiera con sesión
    si capacidadesRequeridas == "ninguna":
        devolver contexto

    # 5 · ¿Tiene alguna de las capacidades pedidas?
    si no contexto.permisos.contieneAlguna(capacidadesRequeridas):
        responder 403 { codigo: "sin_permiso" }
        devolver nulo

    devolver contexto
```

Y en cada operación:

```
contexto = exigir(peticion, respuesta, ["usuarios.crear"])
si no contexto: devolver          # el portero ya respondió
```

### Cuatro cosas de ese diseño que conviene copiar

**Devuelve nulo y ya respondió**, en vez de lanzar una excepción o devolver un resultado con dos ramas.
Eso obliga a escribir la línea de salida, y **olvidarse no abre la operación**: rompe en cuanto se usa
el contexto. Un portero que devolviera un booleano se podría ignorar en silencio.

**El orden importa y no es intercambiable.** La contraseña temporal antes de los permisos; la
organización antes de todo lo de negocio. Cada paso asume que el anterior pasó.

**La organización se resuelve una vez, en el portero**, no en cada operación. Así ninguna se puede
olvidar de verificar que el inquilino esté activo.

**"Ninguna capacidad" es un valor explícito**, no una lista vacía. Una lista vacía se puede pasar por
accidente (una variable que llegó indefinida) y abriría la operación. Un valor con nombre —`"ninguna"`—
tiene que escribirse a propósito.

### El rol de plataforma: dónde va el atajo

Si querés que el rol de plataforma pase todos los chequeos de capacidad, el atajo va **en el paso 5**,
no antes:

```
si contexto.esRolDePlataforma: devolver contexto
```

Después de los pasos 1 a 3. Así, alguien con ese rol pero con la sesión vencida, con contraseña
temporal, o mirando una organización desactivada, **sigue siendo rechazado**. El atajo es solo de
capacidades, no de autenticación ni de estado.

La alternativa más limpia es que ese rol simplemente **tenga todas las capacidades** en la tabla, y no
haya atajo. Es más consistente, pero hay que acordarse de agregarle cada capacidad nueva. Con el atajo,
las hereda solas. Elegí uno y dejalo escrito.

---

## 6 · La prueba que sostiene todo esto

Un portero es inútil si una operación se olvida de llamarlo. Y olvidarse **no falla**: la operación
funciona, sin verificar nada.

Escribí una prueba automatizada que **lea el código fuente** de cada archivo de operaciones y verifique
que:

1. llame al portero, o esté en una lista explícita de rutas públicas (login, salud);
2. abra el contexto de la organización, si el sistema es multiempresa;
3. no use ninguna escotilla que saltee el aislamiento sin estar autorizada por nombre.

```
prueba "toda operación pasa por el portero":
    para cada archivo en operaciones/:
        codigo = leer(archivo) sin comentarios
        si archivo en RUTAS_PUBLICAS: continuar
        afirmar que codigo contiene "exigir("
        afirmar que codigo contiene "activarContexto("
```

Es análisis estático escrito como prueba. Parece rudimentario y es lo más valioso del sistema:
**una operación nueva que se olvide del portero rompe la suite**, que es la única forma de que no se
olvide — sobre todo si el código lo escribe un asistente que no leyó esta documentación.

En el sistema del que salen estas notas, **catorce operaciones** ya estaban escritas sin activar el
contexto de organización. Ninguna fallaba: leían los datos de la organización equivocada.

---

## 7 · El frontend no decide permisos

El menú se arma filtrando por capacidad:

```
seccionesVisibles = SECCIONES.filtrar(s => puede(s.capacidadRequerida))
```

Y conviene que use **la misma función** que el servidor, compartida, para que las dos mitades no
divergan.

**Eso es comodidad, no seguridad.** Cualquiera puede llamar a la API con su sesión y una herramienta de
línea de comandos; el menú solo evita que la gente vea puertas que no puede abrir.

Vale decirlo porque la tentación es fuerte: si el menú ya oculta la sección, **parece** que la operación
no necesita validar. Necesita.

### Dos errores de interfaz que conviene evitar

**Un rol sin ninguna pantalla.** Si un rol es asignable y no tiene ninguna sección visible, quien lo
tenga entra a la primera pantalla disponible y recibe un rechazo completo. **Todo rol asignable necesita
al menos una pantalla**, o no debería ser asignable.

**El rechazo por permiso que se ve como "no hay datos".** Si el cliente HTTP convierte cualquier error en
una lista vacía para no romper la pantalla, un `403` se muestra como _"no hay nada acá"_. El usuario no
sabe que le falta un permiso: cree que el sistema está vacío.

> Es el peor de los dos, porque nadie reporta un bug de algo que "simplemente no tiene datos". El `403`
> merece su propio tratamiento, distinto del vacío legítimo.
>
> Corolario: **todas las operaciones que llenan una misma pantalla tienen que pedir el mismo conjunto de
> capacidades.** Si una pide algo distinto, esa parte de la pantalla se ve vacía para alguien que ve el
> resto — y no hay forma de darse cuenta mirando.

---

## 8 · Cómo se agrega un rol nuevo

El procedimiento completo, para que quede claro que no toca código:

1. **Definir qué puede hacer**, en capacidades existentes.
2. `insert into roles (clave, nombre)` — una fila.
3. `insert into roles_permisos` — una fila por capacidad.
4. **Darle al menos una pantalla** en la configuración del menú (§ 7).
5. Asignarlo a alguien.

Si hace falta una capacidad que no existe:

1. `insert into permisos` — una fila.
2. Usarla en el portero de las operaciones que la requieren.
3. Agregarla a los roles que corresponda.

**Nada de eso toca el portero, ni el login, ni el aislamiento.** Es la propiedad que este modelo compra.

---

## 9 · Errores frecuentes al implementar esto

**Comparar nombres de rol "solo esta vez".** Aparece siempre, y con un argumento razonable ("es un caso
especial del administrador"). Cada una de esas comparaciones es un lugar que hay que revisar cuando
llegue un rol nuevo. Si de verdad es especial, es una capacidad nueva.

**Capacidades con nombre de pantalla.** `pantallaReportes.ver` ata el permiso a la organización de la
interfaz. Cuando las pantallas se reorganicen, el nombre va a mentir.

**Que el rol de plataforma no esté acotado por la base.** Es la escalada entre inquilinos, y el
condicional del backend no alcanza.

**Permitir que un administrador otorgue el rol de plataforma.** Con eso, cualquier administrador se
convierte en dueño de todas las organizaciones. Va bloqueado en el endpoint **y** en la base.

**Guardar los permisos dentro del token de sesión.** Quitar un permiso deja de tener efecto hasta que la
sesión venza.

**Olvidar que "sin permiso" y "sin datos" son distintos.** Ver § 7.
