# 06 — Credenciales y secretos por organización

Cómo guardar, usar, mostrar y rotar los secretos que cada organización necesita para hablar con
servicios externos.

Este documento es autosuficiente: no depende de los otros de la carpeta.

---

## 1 · Cuándo hace falta esto

Solo si **cada organización conecta sus propias integraciones**: su cuenta de un CRM, su clave de un
proveedor de IA, su token de una pasarela de pagos, su cuenta de anuncios.

Si todas las organizaciones usan las mismas credenciales tuyas, no hace falta nada de esto: van en las
variables de entorno del servidor y listo.

La diferencia práctica es quién es el dueño de la cuenta externa. Si el cliente te da **su** token para
que operes en su nombre, ese token es un secreto **suyo** que vos custodiás — y eso trae obligaciones
concretas.

---

## 2 · El modelo

Una tabla de configuración por organización, con los secretos cifrados:

```sql
-- Prerrequisito de la foránea compuesta de abajo: la tabla referenciada necesita
-- una clave única sobre el PAR. Si ya la tenés de otra referencia, no la repitas.
alter table usuarios add constraint usuarios_org_id_unico unique (org_id, id);

create table organizaciones_credenciales (
  org_id            uuid primary key references organizaciones(id) on delete cascade,

  -- Cifradas. El sufijo en el nombre de la columna evita que alguien
  -- las trate como texto plano por accidente.
  crm_token_cifrado        text,
  pagos_clave_cifrada      text,
  ia_clave_cifrada         text,

  -- No secretos: identificadores públicos de la cuenta externa.
  crm_cuenta_id            text,
  pagos_comercio_id        text,

  actualizado_el    timestamptz not null default now(),
  -- Foránea COMPUESTA, no simple. Con `references usuarios(id)` a secas, nada
  -- impide que la fila de la organización A quede firmada por un usuario de la B:
  -- el identificador existe y la base lo acepta. Requiere `unique (org_id, id)`
  -- en la tabla de usuarios.
  actualizado_por   uuid,
  foreign key (org_id, actualizado_por) references usuarios (org_id, id)
);

alter table organizaciones_credenciales enable row level security;
alter table organizaciones_credenciales force  row level security;
revoke all on organizaciones_credenciales from public;

-- Y ATENCIÓN: con la seguridad activada y SIN política ni permisos, esta tabla
-- queda ilegible para todos y la aplicación falla al resolver credenciales. Hay
-- que otorgarla explícitamente. Si tenés un rol dedicado para las operaciones de
-- identidad, es el único que debería llegar acá:
grant select, insert, update, delete on organizaciones_credenciales to <rol de identidad>;
create policy credenciales_identidad on organizaciones_credenciales
  for all to <rol de identidad> using (true) with check (true);

-- Que el rol de los datos de negocio NO tenga acceso es deliberado: una inyección
-- en una consulta de negocio no alcanza los secretos de ningún cliente. El precio
-- es que la función que resuelve credenciales corre en el otro dominio — una razón
-- más para que sea UNA SOLA función.
```

**El sufijo `_cifrado` en el nombre de la columna es una defensa real**, no cosmética: hace que
`select crm_token_cifrado` en un lugar equivocado se lea como lo que es, y que nadie lo pase a una
llamada HTTP creyendo que es el token.

**`on delete cascade`**: borrar la organización borra sus secretos. Es lo correcto y es lo que probablemente
te pida una solicitud de eliminación de datos.

**Tabla aparte o columnas en la de configuración**, da igual. Tabla aparte hace más fácil restringir el
acceso y auditar quién la lee.

---

## 3 · El cifrado

**Cifrado autenticado (AEAD).** No basta con cifrar: hace falta detectar si alguien modificó el dato.

| Aspecto          | Recomendación                                         |
| ---------------- | ----------------------------------------------------- |
| Algoritmo        | `AES-256-GCM` o `ChaCha20-Poly1305`                   |
| Clave            | 32 bytes, de una variable de entorno                  |
| Nonce / IV       | **12 bytes aleatorios, únicos por valor cifrado**     |
| Formato guardado | `<nonce>:<etiqueta>:<cifrado>`, en base64 y separados |

```
funcion cifrar(textoPlano):
    clave = claveMaestra()                    # 32 bytes desde el entorno
    nonce = bytesAleatorios(12)               # NUEVO en cada llamada
    cifrado, etiqueta = aeadCifrar(clave, nonce, textoPlano)
    devolver base64(nonce) + ":" + base64(etiqueta) + ":" + base64(cifrado)

funcion descifrar(blob):
    partes = separar(blob, ":")
    si partes.largo != 3:
        lanzar "Formato de credencial inválido"
    nonce, etiqueta, cifrado = partes.mapear(desdeBase64)
    si nonce.largo != 12:
        lanzar "Nonce de largo inesperado"
    intentar:
        devolver aeadDescifrar(clave, nonce, cifrado, etiqueta)
    capturar:
        lanzar "No se pudo descifrar: el valor fue modificado o la clave maestra cambió. " +
               "Hay que volver a cargar la credencial desde el panel."
```

### Por qué autenticado y no solo cifrado

Con un modo sin autenticación (CBC, CTR a secas), si alguien modifica el dato cifrado el descifrado
**devuelve basura** que parece un token. Ese "token" sale hacia el servicio externo, falla con un error
de autenticación, y nadie entiende por qué. Con AEAD, el descifrado **falla** y el error dice la verdad.

### El nonce único no es una precaución: es un requisito

**Reusar un nonce con la misma clave en GCM rompe el cifrado por completo.** No lo debilita: permite
recuperar el texto en claro de los mensajes afectados.

Es el error más fácil de cometer —parece razonable derivar el nonce del identificador de la organización,
para que sea "determinista"— y el más caro. **Aleatorio, en cada cifrado, sin excepciones.**

### El mensaje de error tiene que decir qué hacer

Cuando la clave maestra no coincide, el mensaje **explícito** ("volvé a cargar la credencial") es lo que
convierte media hora de depuración en diez segundos.

Y pasa seguido: cada vez que alguien corre el proyecto en otra máquina, o restaura una copia de la base
en otro entorno, la clave maestra es otra y **ninguna** credencial se puede leer.

**Nunca devolver nulo ni un texto vacío en ese caso.** Un token vacío produce un error de autenticación
del servicio externo, tres capas más abajo, imposible de diagnosticar.

---

## 4 · La clave maestra

|            |                                                                             |
| ---------- | --------------------------------------------------------------------------- |
| Dónde vive | Variable de entorno del servidor. **Nunca** en el repositorio ni en la base |
| Formato    | 32 bytes, en base64 o hexadecimal                                           |
| Validación | Al arrancar: si no está o no mide 32 bytes, **fallar con un mensaje claro** |

```
funcion claveMaestra():
    crudo = entorno("CLAVE_MAESTRA")
    candidatos = [desdeBase64(crudo), desdeHex(crudo)]
    clave = candidatos.buscar(c => c.largo == 32)
    si no clave:
        lanzar "CLAVE_MAESTRA tiene que ser de 32 bytes en base64 o hexadecimal"
    devolver clave
```

Aceptar los dos formatos evita el error de configuración más común, que es pegar la clave en el formato
que no era.

### Rotar la clave maestra

Requiere **descifrar todo con la vieja y volver a cifrar con la nueva**, en una sola operación. Para que
sea posible sin ventana de indisponibilidad, el diseño tiene que aceptar **dos claves a la vez** durante
la transición: se descifra probando la nueva y después la vieja, y se cifra siempre con la nueva.

Si no lo necesitás hoy, al menos dejá anotado el procedimiento. Descubrir que no se puede rotar el día
que hace falta rotar es el peor momento.

---

## 5 · Cómo se leen: una sola función

**Nunca leer las columnas directamente.** Una función resuelve las credenciales de una organización:

```
funcion resolverCredenciales(orgId):
    fila = leerFilaDeCredenciales(orgId)
    devolver {
        orgId,
        activa:     fila.organizacion.activa,
        crmToken:   fila.crm_token_cifrado ? descifrar(fila.crm_token_cifrado) : nulo,
        iaClave:    fila.ia_clave_cifrada  ? descifrar(fila.ia_clave_cifrada)  : nulo,
        crmCuenta:  fila.crm_cuenta_id,
        # Qué está cargado y de dónde salió. Ver § 6.
        origen: { crmToken: fila.crm_token_cifrado ? "organizacion" : "ausente" },
    }
```

Tres razones para que sea una sola función:

1. **El descifrado ocurre en un solo lugar**, y por lo tanto el manejo de errores también.
2. **Se puede auditar quién lee credenciales**, agregando una línea ahí.
3. **Los fallbacks quedan visibles** (§ 6) en vez de repartidos.

---

## 6 · Los fallbacks: la trampa más costosa de este documento

Es habitual que la organización principal —la tuya— tenga sus credenciales en variables de entorno desde
antes de que el sistema fuera multiempresa. Y es razonable dejarlo así.

**El error es implementarlo con un operador de coalescencia al final de un getter:**

```
✗  crmToken: () => credencialesActivas()?.crmToken ?? entorno("CRM_TOKEN")
```

Eso convierte **"esta organización no tiene token"** en **"usá el de la principal"**. Para **todas** las
organizaciones, no solo la principal. Y ese `??` no se ve en ninguna revisión: son dos caracteres al
final de una línea.

> Esto pasó de verdad. La regla estaba escrita, documentada y con pruebas: _una organización sin
> credencial no opera y lo dice_. Un operador de dos caracteres la desactivaba, y una organización nueva
> escribía en la cuenta externa de otra empresa. Nada falló, porque el token era válido.

**La forma correcta: explícita, nombrada, y acotada:**

```
✓  funcion resolverCredenciales(orgId):
       fila = leerFilaDeCredenciales(orgId)
       esPrincipal = fila.organizacion.es_principal
       token = fila.crm_token_cifrado ? descifrar(fila.crm_token_cifrado) : nulo

       # El fallback existe SOLO para la organización principal, y se DECLARA.
       si no token y esPrincipal:
           token = entorno("CRM_TOKEN")
           origen = "entorno"
       sino:
           origen = token ? "organizacion" : "ausente"

       devolver { crmToken: token, origen: { crmToken: origen } }
```

**Y el campo `origen` no es adorno.** Distingue tres estados que un valor no nulo confunde:

| Estado           | Qué significa                                               |
| ---------------- | ----------------------------------------------------------- |
| `"organizacion"` | Esta organización cargó su propia credencial                |
| `"entorno"`      | Se está apoyando en una variable global (solo la principal) |
| `"ausente"`      | No hay credencial. **No opera**                             |

Sin esa distinción, un panel que revise "¿está configurado?" mirando la columna reportaría _"falta el
token"_ sobre la única organización que demostrablemente funciona. Pasó también.

---

## 7 · Cómo se muestran: enmascaradas, siempre

**La API nunca devuelve un secreto completo.** Ni al administrador de la organización, ni al rol de
plataforma, ni "solo para verificar".

Lo que devuelve:

```json
{
  "crmToken": {
    "cargado": true,
    "vistaPrevia": "••••4f2a",
    "origen": "organizacion"
  },
  "iaClave": { "cargado": false, "vistaPrevia": null, "origen": "ausente" },
  "crmCuenta": { "cargado": true, "valor": "acct_12345" }
}
```

Los últimos cuatro caracteres alcanzan para que alguien confirme **cuál** credencial está cargada sin
exponerla. Los identificadores públicos (números de cuenta, de comercio) sí van completos: no son
secretos.

**Verificable como propiedad del código**: buscá el nombre de la variable del secreto en todo el código
del cliente. Si aparece, hay una filtración. Puede ser una prueba automatizada de una línea.

### La escritura es de un solo sentido

El formulario que carga una credencial **no** trae el valor actual para editarlo. Muestra si hay algo
cargado y ofrece reemplazarlo. Un campo precargado con un secreto lo pone en el HTML de la página, en la
memoria del navegador y probablemente en el registro de red de las herramientas de desarrollo.

---

## 8 · Reglas de uso

**Se descifran en memoria, durante la petición, y no se guardan en ningún lado.** Ni en un caché de
proceso "para no descifrar dos veces": una función sin servidor reutiliza instancias entre peticiones de
**organizaciones distintas**, y ese caché es exactamente cómo el token de una termina usándose para otra.

**No se registran nunca.** Ni al depurar. Un registro con un token es un token filtrado, y los registros
se copian, se exportan y se comparten.

**Al cifrar, el valor se recorta de espacios** antes. Un token con un salto de línea al final —pegado
desde un correo— falla con un error de autenticación que nadie va a atribuir a un espacio invisible.

**Auditá el cambio, no el valor.** Registrá quién cargó o rotó qué credencial y cuándo. Nunca el valor,
ni el anterior ni el nuevo.

---

## 9 · Lista de verificación

1. Cifrado **autenticado** (AEAD), nunca solo cifrado.
2. Nonce **aleatorio y único por valor**. Jamás derivado de un identificador.
3. Clave maestra en el entorno, validada al arrancar, **nunca** en el repositorio ni en la base.
4. El error de descifrado **dice qué hacer** y no devuelve nulo.
5. **Una sola función** resuelve credenciales. Nadie lee las columnas.
6. Los fallbacks son **explícitos, nombrados y acotados**. Ningún operador de coalescencia al final de un
   getter.
7. Un campo de **origen** distingue "cargada", "heredada del entorno" y "ausente".
8. Si falta una credencial, la organización **no opera y lo dice**. Nunca usa la de otra.
9. La API devuelve secretos **enmascarados**, siempre. Con una prueba que verifique que el nombre del
   secreto no aparece en el código del cliente.
10. Nunca en registros, nunca en caché entre peticiones, siempre recortados al guardar.
11. La tabla con seguridad a nivel de fila activada y permisos revocados.
12. El procedimiento de rotación de la clave maestra, escrito, aunque no se use hoy.
