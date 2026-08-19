# RECONSTRUIR · 04 — Administración: empresas, usuarios y el primer admin

Cómo nacen las empresas y las cuentas, y qué invariantes las protegen.

Archivos de referencia: `api/admin/bootstrap.ts`, `api/admin/usuarios.ts`, `api/admin/empresas.ts`,
`api/admin/configuracion.ts`, `api/_lib/password.ts`.

---

## 1 · El problema del huevo y la gallina

Para crear un usuario hace falta ser admin. Para ser admin hay que existir. Con la base vacía no hay
forma de entrar.

La solución es un endpoint de arranque, `POST /api/admin/bootstrap`, con cuatro candados:

| Candado                           | Qué hace                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| **Token de arranque**             | Exige `BOOTSTRAP_TOKEN` (variable de entorno). Sin ella configurada responde `503` y no corre |
| **Un solo disparo**               | Si ya existe un usuario con `es_admin_principal`, responde `409` y no hace nada               |
| **Credenciales desde el entorno** | El email y la contraseña iniciales salen de variables de entorno, no del cuerpo del request   |
| **Fuerza de contraseña**          | Valida el mínimo; si es débil, `400`                                                          |

Los cuatro juntos son lo que hace que el endpoint pueda quedar publicado sin ser un agujero. El
segundo es el importante: **después del primer uso está muerto para siempre**, y no hay forma de
revivirlo desde la API.

Que el email y la contraseña vengan del entorno y no del request cierra el hueco obvio: si vinieran
en el cuerpo, quien tuviera el token podría crear un admin con **su** email.

> **Al reconstruir**: si tu plataforma te deja correr un comando de administración fuera del ciclo
> HTTP (un script de despliegue, una consola), es mejor lugar para esto que un endpoint. El endpoint
> existe acá porque el hosting es serverless y no hay una consola donde correr un `seed`.

---

## 2 · Alta de usuario

`POST /api/admin/usuarios`, rol `admin`.

### La contraseña temporal

Se genera en el servidor, **nunca la elige quien crea la cuenta**:

- **14 caracteres** de un alfabeto acotado.
- **Sin sesgo de módulo**: se descartan los bytes que caen en el resto incompleto del rango. Un
  `byte % largoAlfabeto` sin ese descarte hace que los primeros caracteres del alfabeto salgan más
  seguido — un sesgo pequeño pero real que reduce la entropía.
- Se guarda **hasheada** (documento 01) y el usuario nace con `debe_cambiar_password = true`.

**Se muestra UNA sola vez**, en la respuesta del alta. No se puede volver a consultar: para eso está
el reset, que genera otra.

**Y no se registra en la auditoría.** El email sí; la contraseña temporal nunca, ni ahí. Un registro
de auditoría con contraseñas temporales es una lista de credenciales válidas de cuentas que todavía
no las cambiaron.

### Qué valida

| Validación                                    | Respuesta si falla                            |
| --------------------------------------------- | --------------------------------------------- |
| Falta el nombre                               | `400`                                         |
| El email no tiene forma de email              | `400` `email_invalido`                        |
| Email ya existente                            | `409` `email_duplicado`                       |
| Cualquier rechazo de la base (CHECK, trigger) | `409` `rechazado`, con el mensaje de Postgres |

Que los rechazos de la base se devuelvan tal cual es deliberado: los mensajes de los triggers están
escritos para leerse ("El admin principal no se puede degradar"). Traducirlos en el backend sería
mantener dos textos que dicen lo mismo.

### Un admin no puede crear un super_admin

Ni siquiera dentro de la empresa principal. Es el límite que evita la escalada: un admin de empresa
cliente que pudiera otorgar `super_admin` se otorgaría acceso a todas las demás.

Está en **dos capas**: el endpoint lo rechaza, y un trigger de la base lo rechaza aunque el endpoint
falle (ver sección 4).

### Lo que el PATCH deliberadamente NO permite

**Mover un usuario de empresa.** No es un olvido: cambiar el `org_id` de una cuenta le cambia el
dueño a todo lo que hizo —sus avances, sus notas, su atribución de comisiones— y eso no es una
edición de perfil. Si algún día hace falta, va a ser una operación con su propio nombre y su propio
registro.

---

## 3 · Alta de empresa

`POST /api/admin/empresas`, rol `super_admin`.

Lo que conviene copiar es lo que **no** hace:

- **No hereda credenciales de nadie.** Una empresa nueva nace sin token del CRM, sin clave de IA y
  sin calendario. Y por lo tanto **no opera y lo dice**. El fallback a variables de entorno es
  exclusivo de la empresa principal (documento 03 § 5).
- **No hereda el calendario.** Fue un agujero real: el cron le pedía a cada empresa el calendario de
  la principal usando el token de esa empresa.

Los valores por defecto que sí pone:

```
zona_horaria                        'America/Lima'
canales_sin_seguimiento_automatico  ['instagram']
es_principal                        false
```

### Las credenciales se devuelven enmascaradas

El panel que las administra **nunca recibe el valor completo**. Muestra los últimos cuatro
caracteres (`••••1234`) para que se pueda verificar _cuál_ token está cargado sin exponerlo.

Verificado en este proyecto: el token del CRM **no tiene una sola referencia** en el código del
frontend. Vive cifrado en la base y solo lo descifra el servidor, en memoria, durante el request.

---

## 4 · Las invariantes que hace cumplir Postgres

Esta es la sección que más conviene replicar, y la que más fácil se olvida al reconstruir.

Todo lo de abajo son **triggers y CHECKs de la base**, no `if` del backend. La razón: un `if` se
saltea con un script de mantenimiento, una consola de administración, un endpoint nuevo que nadie
revisó, o un `UPDATE` a mano un domingo. Un trigger no.

### El admin principal es inmutable en lo que importa

```
trigger closer_usuarios_admin_protegido
```

Sobre el usuario con `es_admin_principal = true`:

| No se puede                               | Por qué                                           |
| ----------------------------------------- | ------------------------------------------------- |
| Eliminarlo                                | Sería quedarse sin nadie que pueda administrar    |
| Degradarlo (`es_admin_principal → false`) | Idem                                              |
| Desactivarlo                              | Idem                                              |
| Cambiarle el email                        | Es su identidad de acceso                         |
| Quitarle el rol `super_admin`             | Sería un admin principal que no puede administrar |

**Su contraseña SÍ se puede cambiar.** Lo inmutable es _quién es_ y _qué puede hacer_, no su
credencial — si no se pudiera rotar, una filtración sería permanente.

Y hay **exactamente uno**, garantizado por un índice único parcial:

```sql
create unique index on closer_usuarios (es_admin_principal) where es_admin_principal;
```

Ese índice es más elegante que un trigger para esta invariante: dos filas con `true` no pueden
existir, y el error viene de la base sin código que lo verifique.

### El rol super_admin solo existe en la empresa principal

```
trigger closer_usuarios_super_admin_acotado
```

Un `insert` o `update` que ponga `super_admin` en un usuario de una empresa que no es la principal
**falla**. Es la barrera contra la escalada entre inquilinos descrita en el documento 02.

### La empresa principal no se puede apagar

```
trigger closer_org_config_protegida
```

| No se puede                          | Por qué                                                              |
| ------------------------------------ | -------------------------------------------------------------------- |
| Eliminarla                           | Es la que sostiene el fallback de credenciales y el rol super_admin  |
| Desmarcarla (`es_principal → false`) | Idem                                                                 |
| Desactivarla                         | Los crons dejan de correr para ella: equivale a apagar la plataforma |

Todo lo demás de la empresa principal **sí** se puede editar.

### Dos tablas append-only

```
trigger closer_avances_inmutable        (closer_avances)
trigger closer_eventos_append_only      (closer_contacto_eventos)
```

El timeline de resultados y el historial de eventos **no se pueden modificar ni borrar**, solo
insertar. De `closer_avances` salen por consulta el dinero cobrado y las ventas: si una fila se
pudiera editar, los números del dashboard dejarían de ser auditables.

Es la misma idea que un libro contable. Corregir un error se hace con una fila nueva, no reescribiendo
la vieja.

---

## 5 · La auditoría

`closer_auditoria_accesos` registra los eventos de acceso: login, login fallido, y las acciones
administrativas.

Dos decisiones de diseño:

**`usuario_id` es nullable.** Un login con un email inexistente no tiene usuario al que atribuirlo, y
ese es justo el evento que hay que poder investigar. Exigir el usuario obligaría a descartar el
intento o a inventar una referencia.

**El `detalle` es JSON y guarda el motivo real.** El usuario recibe siempre "Credenciales
inválidas"; la auditoría guarda si fue `email_inexistente`, `cuenta_inactiva` o `password`. La
distinción existe para quien investiga, no para quien ataca.

Y sirve para algo más: **el freno por IP se cuenta sobre esta tabla**, sin una tabla aparte
(documento 01 § 3).

---

## 6 · Checklist para reconstruirlo

1. **Un endpoint o comando de arranque** con token, un solo disparo, y credenciales desde el entorno.
2. **Contraseñas temporales generadas en el servidor**, sin sesgo de módulo, mostradas una vez, nunca
   registradas.
3. **Un admin no puede otorgar el rol de plataforma.** En el endpoint y en la base.
4. **Empresa nueva sin credenciales heredadas.** Que no opere y lo diga.
5. **Credenciales enmascaradas** en toda respuesta de la API.
6. **Las invariantes críticas como triggers y CHECKs**, no como `if`:
   - un solo admin principal, inmutable en identidad y permisos, con contraseña rotable;
   - el rol de plataforma acotado a la empresa principal;
   - la empresa principal no eliminable, no desmarcable, no desactivable;
   - las tablas de las que salen los números, append-only.
7. **Auditoría con `usuario_id` nullable** y el motivo real en un campo estructurado.
8. **Mover un usuario de empresa no es una edición de perfil.** Si hace falta, que sea una operación
   con nombre propio.
