# 10 — Detección y operación

Todo lo anterior sirve para que las cosas no pasen. Esto sirve para **saber que están pasando**.

Es la categoría que falta, y falta por una razón entendible: la respuesta natural a "los defectos de
este tipo son silenciosos" son pruebas que corren antes de desplegar. Y están bien. Pero cubren **lo que
se puede saber antes de desplegar**.

> Un incidente en producción también es silencioso. **Nadie va a reportar que sus datos los está mirando
> otro.**

Y hay una consecuencia que no es técnica: si procesás datos personales por cuenta de tus clientes, casi
seguro tenés la obligación de **notificar un incidente de seguridad** en un plazo corto. Un sistema sin
observabilidad no puede cumplirla, y no porque falte un procedimiento — porque **falta el dato**.

Este documento es autosuficiente: no depende de los otros de la carpeta.

---

## 1 · Las seis señales, y todas salen de tablas que ya existen

Ninguna necesita infraestructura nueva. Cinco son consultas sobre la auditoría y una es una sonda.

| Señal                                                        | Qué significaría                                       |
| ------------------------------------------------------------ | ------------------------------------------------------ |
| **1 ·** Excepciones de la capa de aislamiento                | Una operación nueva que se olvidó de abrir el contexto |
| **2 ·** Fallos de descifrado de credenciales                 | Clave maestra cambiada, o un valor alterado            |
| **3 ·** Rechazos por falta de permiso, agrupados             | Un rol mal configurado, o alguien probando puertas     |
| **4 ·** Intentos de acceso fallidos                          | Ataque por diccionario en curso                        |
| **5 ·** Cambios de organización activa del rol de plataforma | Uso indebido de una cuenta con acceso a todo           |
| **6 ·** La sonda de aislamiento                              | El aislamiento se rompió **ahora**, en producción      |

### Señal 1 · La más barata de todas, y ya está escrita

La capa de aislamiento **ya lanza** una excepción cuando alguien consulta sin organización en contexto.
Hoy eso termina en un error 500 y en un registro que nadie lee.

**Que esa excepción emita un aviso convierte el mecanismo de protección en un mecanismo de detección sin
escribir nada nuevo.** Es la señal con la mejor relación entre lo que cuesta y lo que dice: si aparece,
hay una operación en producción que se olvidó el contexto, y es exactamente el defecto que la prueba
estática buscaba impedir — pero que se escapó.

```
funcion baseDeDatos():
    org = contextoActual()
    si no org:
        avisar("aislamiento_sin_contexto", { operacion: rutaActual(), traza: trazaActual() })
        lanzar "Ninguna consulta corre sin organización activa"
    …
```

> **El aviso no puede pasar por la capa que está fallando.** Si el registro de este evento se escribe con
> la misma capa que acaba de lanzar, no se escribe nunca. Va por la conexión de identidad, o
> directamente al registro del servidor.

### Señales 2 a 5 · Tres acciones nuevas en la auditoría

La auditoría suele registrar acceso, intento fallido, alta y baja de usuario, cambio de roles, cambio de
credenciales y alta de organización. Faltan tres, y son las que dan tres de las cinco señales:

| Acción a registrar      | Dónde se emite                                       |
| ----------------------- | ---------------------------------------------------- |
| `permiso_denegado`      | En el portero, cuando rechaza por falta de capacidad |
| `credencial_ilegible`   | En la función única que descifra credenciales        |
| `organizacion_cambiada` | En la operación que cambia la organización activa    |

Con eso, las consultas de vigilancia son directas:

```sql
-- Señal 2 · credenciales que dejaron de poder leerse
select org_id, count(*)
  from auditoria_accesos
 where accion = 'credencial_ilegible' and creado_el > now() - interval '24 hours'
 group by org_id;

-- Señal 3 · rechazos por permiso, por organización y capacidad
select org_id, detalle->>'capacidad' as capacidad, count(*)
  from auditoria_accesos
 where accion = 'permiso_denegado' and creado_el > now() - interval '24 hours'
 group by 1, 2
having count(*) > 20
 order by 3 desc;

-- Señal 4 · intentos fallidos por dirección de origen
select ip, count(*), count(distinct detalle->>'email') as emails_probados
  from auditoria_accesos
 where accion = 'login_fallido' and creado_el > now() - interval '1 hour'
 group by ip
having count(*) > 20;

-- Señal 5 · el rol de plataforma mirando organizaciones de clientes
select usuario_id, count(*), count(distinct detalle->>'org_destino') as organizaciones
  from auditoria_accesos
 where accion = 'organizacion_cambiada' and creado_el > now() - interval '7 days'
 group by usuario_id;
```

**La señal 3 es la más subestimada.** Un pico de rechazos por permiso en una organización casi nunca es
un ataque: es un rol al que le falta una capacidad, y **nadie lo va a reportar** porque la pantalla se ve
vacía y parece que no hay datos. Es la única forma de enterarse de ese defecto sin que un cliente
escriba.

**La señal 4 tiene un detalle que la hace mucho más útil**: contar **emails distintos** por dirección de
origen. Veinte intentos contra una cuenta es alguien que olvidó su contraseña; veinte intentos contra
veinte cuentas es otra cosa.

### Señal 6 · La sonda de aislamiento

Las pruebas verifican el aislamiento **en el entorno de desarrollo, antes de desplegar**. La sonda lo
verifica **en producción, cada hora**, que es donde importa:

```
funcion sondaDeAislamiento():
    # Dos organizaciones de control, con una fila marcada cada una.
    # Existen para esto y para nada más.
    conOrganizacion(CONTROL_A, () => {
        filas = "select org_id from <tabla de control>"
        si filas contiene algo distinto de CONTROL_A:
            alarma_grave("FUGA ENTRE ORGANIZACIONES", filas)
    })
    conOrganizacion(CONTROL_B, () => { … lo mismo al revés … })
```

Cuesta dos filas y una tarea programada. Y es lo único de esta lista que puede detectar **la fuga misma**
en vez de sus alrededores.

---

## 2 · Dónde mirar, sin montar nada

Un resumen semanal por correo con esos seis números alcanza para empezar. Lo que no alcanza es no tener
ninguno.

| Señal                         | Cadencia      | Umbral para avisar                             |
| ----------------------------- | ------------- | ---------------------------------------------- |
| Aislamiento sin contexto      | **Inmediato** | 1. Siempre es un defecto                       |
| Sonda de aislamiento          | **Inmediato** | 1. Siempre es grave                            |
| Credencial ilegible           | Diario        | 1 por organización                             |
| Permiso denegado              | Semanal       | Un pico contra la semana anterior              |
| Intentos fallidos             | Horario       | 20 por origen, o 5 emails distintos por origen |
| Cambio de organización activa | Semanal       | Se informa siempre, sin umbral                 |

Las dos primeras son las únicas que interrumpen a alguien. Las otras cuatro van en el resumen.

> **Y la regla que hace que el resumen sirva:** el resumen **se manda siempre**, también cuando todo está
> en cero. Un aviso que solo llega cuando hay problemas es indistinguible de un aviso que se rompió.

---

## 3 · El procedimiento de incidente

Tres párrafos, escritos **antes** de necesitarlos. No es burocracia: es que a las dos de la mañana nadie
decide bien quién avisa a quién.

**Quién decide.** Una persona nombrada, con un suplente. La decisión que toma es una sola: si esto es un
incidente que se notifica o no.

**Qué se hace primero**, en orden: (1) cerrar la puerta — revocar sesiones, rotar la credencial, apagar
la operación afectada; (2) **preservar la evidencia** antes de arreglar nada, porque la auditoría es
inmutable pero los registros del servidor caducan; (3) medir el alcance — qué organizaciones, qué datos,
qué ventana de tiempo; (4) recién entonces arreglar.

**A quién se avisa y en qué plazo.** A los clientes afectados, con qué pasó, qué datos, qué se hizo y
qué tienen que hacer ellos. Y a la autoridad que corresponda, si la normativa de tu jurisdicción lo
exige — los plazos suelen ser cortos y contarse desde que **te enteraste**, que es la razón por la que la
sección 1 de este documento existe.

---

## 4 · Respaldos, entornos y personas

### El respaldo que nunca se restauró es una hipótesis

Restaurar una copia, en un entorno aparte, y **verificar que la aplicación arranca contra ella**. Con
una periodicidad escrita.

Y hay un detalle propio de este diseño que conviene descubrir en el ensayo y no en el desastre: **al
restaurar en otro entorno, la clave maestra es otra y ninguna credencial cifrada se puede leer.** Es el
mismo síntoma que aparece cuando alguien clona el proyecto en su máquina, pero con la base restaurada de
producción significa que el sistema levanta y **no puede operar con ninguna integración**.

De ahí sale una pregunta que hay que poder responder: **¿dónde está la copia de la clave maestra, y quién
la tiene?** Si la respuesta es "en la variable de entorno del hosting y nada más", una pérdida de ese
proyecto es la pérdida de todas las credenciales de todos los clientes.

### Nunca datos reales en desarrollo

Los datos de los clientes son datos personales **de terceros**. Un entorno de pruebas cargado con una
copia de producción es una copia sin control de la base de un cliente, en máquinas con menos protección,
accesible a más gente, y probablemente sin borrado.

Si hacen falta datos parecidos, se generan. Si hace falta reproducir un defecto con datos reales, se
extrae **el caso puntual** y se borra después.

### Dos organizaciones sembradas en desarrollo, desde el primer día

Es la medida más barata de todo el conjunto y la que más defectos va a encontrar:

> **Con una sola organización en desarrollo, ninguno de los defectos de esta familia se manifiesta.**
> Todos se ven perfectos. El filtro que falta devuelve lo correcto porque hay un solo dueño posible.

Dos organizaciones con datos distintos, y un usuario en cada una, convierten "parece que anda" en
"anda". Y son las mismas dos que sirven para la sonda de la sección 1.

### Cuando alguien del equipo se va

Una lista corta, porque se hace con prisa y se olvida la mitad:

1. Cerrar **todas** sus sesiones, no solo desactivar la cuenta.
2. Quitarle los roles.
3. Revisar si tuvo acceso al panel del hosting o a las variables de entorno. **Si lo tuvo, tuvo la clave
   maestra**, y corresponde rotarla — con el procedimiento que ya debería estar escrito.
4. Revisar si tuvo acceso a las credenciales de los clientes por otra vía (un gestor de contraseñas
   compartido, un canal de chat).

---

## 5 · La cadena de dependencias

La autenticación conviene que no tenga dependencias, y es una buena regla. Pero **el proyecto sí las
tiene**, y hay un camino que la regla no cubre:

> Una dependencia con un guion de instalación malicioso **corre en el servidor de construcción, donde
> están todas las variables de entorno.** Incluida la clave maestra de cifrado.

No hace falta que la dependencia esté en la ruta del login. Basta con que esté en el proyecto.

Tres medidas, ninguna cara:

- **Versiones exactas**, y el archivo de bloqueo versionado y revisado cuando cambia. Un cambio en ese
  archivo que nadie pidió es una señal.
- **Toda dependencia nueva en la ruta de acceso es una decisión**, no un comando. Se discute qué aporta y
  quién la mantiene.
- **Los guiones de instalación se desactivan** si tu gestor de paquetes lo permite, y se habilitan por
  excepción para las que de verdad los necesitan.

---

## 6 · El camino que no tomamos, y cuándo habría sido mejor

Toda esta serie asume **una base compartida con una columna de organización en cada tabla**. Es la
opción correcta para la mayoría de los casos. Pero hay dos alternativas que eliminan **categorías
enteras** de este trabajo, y conviene que quede escrito que fue una decisión y no un supuesto.

| Enfoque                                      | Qué desaparece                                                                                                                                                                                                   | Qué cuesta                                                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Base compartida con columna** (esta serie) | —                                                                                                                                                                                                                | Toda la capa de aislamiento, las políticas, la escotilla. El riesgo residual es el error silencioso                          |
| **Un esquema por cliente**                   | La columna en cada tabla, el índice que la lleva primero, las claves foráneas compuestas, la capa que inyecta el filtro, las políticas y la escotilla. El aislamiento pasa a ser la ruta de búsqueda de esquemas | Cada migración se ejecuta N veces; los informes que cruzan clientes se vuelven incómodos; el alta de cliente crea un esquema |
| **Una base por cliente**                     | Todo lo anterior, y el aislamiento se puede **demostrar** ante un cliente que pregunta                                                                                                                           | Costo por cliente, N cadenas de conexión, N respaldos, migraciones coordinadas. Con muchos clientes chicos es inviable       |

**El criterio, sin vueltas:** el enfoque compartido gana con **muchos clientes de valor bajo o medio**;
la separación física gana con **pocos clientes de valor alto**, sobre todo si alguno va a preguntar por
escrito cómo se separan sus datos de los de otros.

Y la parte honesta: con pocos clientes que pagan bien, **el esquema por cliente es genuinamente
defendible**, y elimina de un golpe toda la clase de error "una consulta sin filtro". La razón para no
tomarlo también es real: los informes que agregan varias organizaciones —comparar rendimiento entre
cuentas, un panel de conjunto— se vuelven mucho más incómodos con los datos repartidos.

### El punto de reevaluación, y por qué esta decisión es reversible

**El detonante es concreto: el primer cliente que exija separación física por contrato.**

Y hay una propiedad del diseño compartido que conviene saber, porque cambia el peso de la decisión:
**como toda tabla lleva la columna de organización, extraer un inquilino a su propia base más adelante es
copiar las filas donde esa columna vale X.** Es trabajo, y no es una reescritura. La decisión de hoy no
cierra la puerta.

---

## 7 · Los riesgos residuales

Los que ningún documento de esta serie elimina. Se aceptan a propósito o no se aceptan, pero no se
ignoran.

1. **La clave maestra vive en una variable de entorno.** Cualquiera con acceso al panel del hosting puede
   descifrar las credenciales de **todos** los clientes. Con dos personas en el equipo es un riesgo
   manejable; con cinco cambia de peso, y el detonante para migrar a un servicio de gestión de claves es
   la primera vez que un cliente pregunte por escrito quién puede descifrar sus credenciales.
2. **El rol de plataforma existe.** Es deliberado y necesario —alguien tiene que dar de alta y dar
   soporte— y significa que una cuenta comprometida es una brecha de todos los clientes a la vez. El
   segundo factor obligatorio es lo que lo hace aceptable; sin él, no lo es.
3. **Se confía en terceros**: el hosting, el proveedor de base, y cualquier servicio externo por donde
   pasen datos de clientes. Ninguna de estas defensas los cubre. Eso se gestiona con contratos y
   declarándolo, no con código.
4. **Dos secretos más que rotar.** La separación en dos roles de base mejora el aislamiento y agrega dos
   contraseñas al inventario de cosas que hay que rotar cuando alguien se va.
5. **La auditoría es inmutable**, lo cual es correcto, y significa que un registro escrito por error
   —con un dato que no debía estar ahí— es permanente. De ahí la regla de no registrar nunca cuerpos
   completos.
6. **Nadie auditó esto desde afuera.** Todo lo que se sabe es que resiste la revisión de quien lo
   escribió — y esa revisión ya se equivocó al menos una vez, que es la razón por la que existen los
   últimos documentos de esta carpeta.

---

## 8 · Y una advertencia sobre el conjunto

Entre todos estos documentos hay miles de líneas de requisitos, y cada uno salió de algo que falló. Pero
hay un riesgo específico en tener tantos, y es el mismo que hace peligrosa una segunda capa de seguridad
que no está activa: **la confianza mal puesta.**

> **Diez documentos aplicados a medias, con el equipo creyendo que están aplicados enteros, son peores
> que cinco aplicados completos.**

La defensa contra eso no es más documentación. Es que **cada regla que importa tenga una prueba que falle
si no se cumple.** Las reglas con prueba sobreviven; las que solo están escritas duran hasta el primer
viernes con apuro.

Por eso la carpeta trae una lista aparte con **cada regla y la prueba que la sostiene**. Si hay que
recortar por tiempo, se recorta de ahí y se sabe qué se está resignando — en vez de descubrirlo cuando
alguien pregunta si el sistema es seguro y la respuesta honesta es "creo que sí".
