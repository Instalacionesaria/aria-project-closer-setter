# RECONSTRUIR — el sistema de acceso, roles y multiempresa

**Para rehacer esto en otra plataforma sin volver a descubrir lo que ya costó descubrir.**

Los documentos numerados (`01-PRODUCTO` … `13-LEXICO-AUDITOR`) explican **cómo funciona el
producto** para quien lo opera. Esta serie es otra cosa: es el **plano de construcción** de la capa
que sostiene todo lo demás —quién entra, qué puede hacer, y de qué empresa son los datos que ve—
escrito para alguien que tiene que levantarlo de nuevo, posiblemente en otro lenguaje y con otra
base de datos.

Por eso acá hay parámetros exactos, nombres de columnas, códigos de error y algoritmos. Y por eso
cada decisión viene con **la alternativa que se descartó**: reconstruir sin eso es reconstruir los
bugs también.

| Documento                                             | Responde                                                                                              |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [01-ACCESO](RECONSTRUIR-01-ACCESO.md)                 | Contraseñas, sesiones, cookies, bloqueo por intentos. El login de punta a punta                       |
| [02-ROLES](RECONSTRUIR-02-ROLES.md)                   | Los seis roles, el portero del backend, y por qué el frontend no es seguridad                         |
| [03-MULTIEMPRESA](RECONSTRUIR-03-MULTIEMPRESA.md)     | El aislamiento entre empresas: el Proxy que inyecta `org_id`, el contexto, el cifrado de credenciales |
| [04-ADMINISTRACION](RECONSTRUIR-04-ADMINISTRACION.md) | Alta de empresas y usuarios, el primer admin, y las invariantes que hace cumplir Postgres             |
| [05-TRAMPAS](RECONSTRUIR-05-TRAMPAS.md)               | **Los errores que este sistema ya cometió, o que tiene abiertos hoy.** El más útil de la serie        |

---

## Las cuatro ideas que sostienen todo

Si de esta serie sobrevive una sola página, que sea esta.

**1 · El aislamiento no se pide, se impone.** Ningún query de la aplicación escribe
`where org_id = ...` a mano. Hay un Proxy que lo inyecta, y si no hay empresa activa en el
contexto **lanza una excepción** en vez de devolver datos. La razón es que el modo de fallar de la
disciplina es silencioso: alcanza que un desarrollador se olvide una vez, en un endpoint, para que
un cliente vea las filas de otro — y nada falla, nada avisa, el número simplemente está mal.

**2 · El frontend no decide permisos.** Oculta lo que no corresponde para no confundir, pero cada
endpoint vuelve a preguntar quién es y qué puede. Un menú escondido es una comodidad; la única
frontera real está del lado del servidor.

**3 · Lo que no se puede saber no se afirma.** `null` significa "no lo sé" y nunca "es cero". Una
escritura que falla lo dice en la respuesta. Es la regla que más trabajo dio sostener y la que más
bugs evitó: casi todos los defectos serios de este proyecto fueron _éxitos reportados que no
ocurrieron_.

**4 · Las invariantes críticas viven en la base, no en el código.** Que el admin principal no se
pueda degradar, que la empresa principal no se pueda desactivar, que un `super_admin` solo exista
en la empresa principal: todo eso son **triggers y CHECKs de Postgres**. Un `if` en el backend se
saltea con un script, una consola de administración o un endpoint nuevo que nadie revisó. Un
trigger no.

---

## Cómo está armado hoy (y qué es reemplazable)

| Pieza                   | Hoy                                     | ¿Se puede cambiar?                                                 |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| Base de datos           | PostgreSQL 17 (Supabase)                | Sí, pero las invariantes de 04 necesitan triggers o su equivalente |
| Acceso a datos          | `@supabase/supabase-js` sobre PostgREST | Sí. El Proxy de 03 es el patrón, no la librería                    |
| Contexto por request    | `AsyncLocalStorage` de Node             | Depende del runtime. Ver 03 § "Si tu lenguaje no tiene esto"       |
| Hash de contraseñas     | `scrypt` de `node:crypto`               | Sí, a argon2id o bcrypt. Los parámetros equivalentes están en 01   |
| Cifrado de credenciales | AES-256-GCM de `node:crypto`            | Sí, cualquier AEAD                                                 |
| Sesiones                | Token opaco en cookie + tabla           | Sí, pero leer 01 § "Por qué no JWT" antes de cambiarlo             |
| Hosting                 | Vercel Functions (Node 24)              | Sí                                                                 |

**Cero dependencias externas para criptografía.** Todo lo sensible —hash de contraseñas, cifrado de
credenciales, generación de tokens, comparaciones en tiempo constante— usa la biblioteca estándar
del runtime. Es deliberado: en lo que más caro sale equivocarse, una dependencia es una superficie
que hay que auditar y una versión que hay que subir.

---

## El orden en que conviene reconstruirlo

1. **Las tablas y sus invariantes** (04). Primero la base, con sus CHECKs y triggers: son el piso
   sobre el que todo lo demás puede equivocarse sin hacer daño.
2. **El contexto de empresa y el Proxy** (03). Antes de escribir el primer endpoint, porque después
   hay que volver a pasar por todos.
3. **Contraseñas y sesiones** (01).
4. **El portero de roles** (02), y el test que verifica que ningún endpoint se lo saltee.
5. **La administración** (04): alta de empresas, de usuarios, y el primer admin.

Y antes de escribir la primera línea, leer **[05-TRAMPAS](RECONSTRUIR-05-TRAMPAS.md)**: es la lista
de lo que ya salió mal acá, y casi todo vuelve a pasar si nadie lo dice.

El paso 2 antes del 4 no es capricho. En este proyecto el orden fue el inverso, y la deuda se pagó
con un test que recorre `api/` leyendo el código fuente para verificar que **cada** endpoint active
las credenciales de su empresa. Ese test existe porque catorce endpoints ya estaban escritos sin
hacerlo.
