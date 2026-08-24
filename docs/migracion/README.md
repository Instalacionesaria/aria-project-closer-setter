# Sistema de acceso multiempresa — documentación de implementación

**Qué es esta carpeta:** el plano completo para construir la capa de acceso de una aplicación donde
varias empresas usan la misma instalación sin verse entre sí. Login, organizaciones, usuarios, roles
configurables, aislamiento de datos y credenciales cifradas por empresa.

**Qué NO es:** documentación de un producto en particular. No describe ninguna funcionalidad de
negocio. Describe el andamiaje sobre el que se construye cualquiera.

Esta carpeta es **portable y autosuficiente**: no referencia código, repositorios ni documentos
externos. Se puede copiar a otro proyecto tal cual.

---

## Los documentos

| #   | Documento                                            | Qué contiene                                                                                                 |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 00  | [Visión general](00-VISION-GENERAL.md)               | El modelo de datos, las cinco reglas, las decisiones a tomar antes de empezar y el orden de construcción     |
| 01  | [Esquema de datos](01-ESQUEMA-DE-DATOS.md)           | SQL completo: tablas, restricciones, disparadores, índices, seguridad a nivel de fila                        |
| 02  | [Autenticación](02-AUTENTICACION.md)                 | Contraseñas, sesiones, cookies, bloqueo por intentos, contraseñas temporales                                 |
| 03  | [Roles y permisos](03-ROLES-Y-PERMISOS.md)           | El modelo **extensible**: capacidades granulares, roles como datos, el portero del servidor                  |
| 04  | [Aislamiento](04-AISLAMIENTO.md)                     | Cómo separar los datos entre organizaciones sin depender de la disciplina                                    |
| 05  | [Administración](05-ADMINISTRACION.md)               | Alta de organizaciones y usuarios, el primer administrador, restablecer contraseñas                          |
| 06  | [Credenciales](06-CREDENCIALES.md)                   | Secretos por organización: cifrado, rotación, enmascarado, y el error más costoso                            |
| 07  | [Errores a evitar](07-ERRORES-A-EVITAR.md)           | Los fallos concretos que este diseño ya pagó en producción                                                   |
| 08  | [Endurecimiento](08-ENDURECIMIENTO.md)               | **Los huecos de los siete anteriores, con su solución.** Lo que la serie promete y puede no cumplir          |
| 09  | [Escotilla y estados](09-ESCOTILLA-Y-ESTADOS.md)     | **Los dos defectos que abre el 08**: las políticas rompen el login, y los estados de sesión abren una puerta |
| 10  | [Detección y operación](10-DETECCION-Y-OPERACION.md) | Saber que algo está pasando **ahora**: señales, incidentes, respaldos, riesgos residuales                    |
| —   | [**Las reglas y sus pruebas**](PRUEBAS.md)           | **Cada regla con la prueba que falla si no se cumple.** La lista de trabajo, y qué se resigna si se recorta  |

### Y uno que NO es portable

| Documento                                       | Qué contiene                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [closer-setter-excc-1](closer-setter-excc-1.md) | **Las dos pantallas del producto**: Closer y Setter — qué muestra cada tab, qué endpoint conectar, y en qué orden |

La diferencia importa: los documentos numerados y `PRUEBAS` describen **cómo se construye la base** y
sirven para cualquier producto. Ese último describe **qué se construye arriba**, y solo sirve para este.
Si el destino es otro producto, ese archivo se descarta.

---

## Cómo usar esta documentación

**Si vas a implementarlo con un asistente de código**, esta carpeta está escrita para eso. Sugerencia
de uso:

1. Pedile que lea **`00`** completo y te devuelva las cuatro decisiones de la § 4 aplicadas a tu caso,
   por escrito, antes de tocar nada.
2. Pedile que lea **`07`** antes de escribir la primera línea. Es la lista de lo que ya salió mal; casi
   todo vuelve a pasar si nadie lo dice.
3. Pedile que lea **`08` § 1, 2 y 3** antes de elegir bibliotecas. Son tres decisiones que se toman en
   la primera hora sin darse cuenta, y que deciden si las defensas de esta serie funcionan o solo
   parecen funcionar.
4. Después, un documento por etapa, en el orden de **`00` § 6**.
5. Trabajá con **[`PRUEBAS.md`](PRUEBAS.md)** al lado. Es la lista de reglas con su prueba: exigí cada
   una **en la misma etapa que el código que verifica**, nunca al final.

**Si lo implementás a mano**, el orden es el mismo. El único consejo fuerte: no dejes las pruebas
arquitectónicas para el final. Son lo único que sostiene las reglas cuando el equipo crece.

---

## Lo que hay que decidir antes de empezar

Cuatro preguntas que definen la forma de todo lo demás. Están desarrolladas en `00` § 4, pero conviene
tenerlas a la vista desde el primer minuto:

1. **¿Un usuario pertenece a una organización o a varias?** Esta serie asume una. Cambiarlo después es
   una migración de datos y de todo el código de permisos.
2. **¿Hay un rol que ve todas las organizaciones?** Esta serie asume que sí, y lo trata como el mayor
   riesgo del sistema.
3. **¿Los roles son fijos o configurables?** Si en un año vas a querer un rol nuevo sin desplegar
   código, tienen que ser datos.
4. **¿Cada organización conecta sus propias integraciones externas?** Si no, el documento `06` no
   aplica.

---

## Lo que este diseño da por sentado

Para que se pueda evaluar si encaja con tu caso:

- **Una base de datos relacional con restricciones y disparadores.** Varias invariantes críticas viven
  ahí, no en el código. Sin eso, el diseño pierde su defensa principal.
- **Un backend propio.** El frontend nunca habla con la base directamente.
- **Contexto por petición**: almacenamiento local asíncrono, o un objeto de contexto explícito. Una
  variable global no sirve y el documento `04` explica por qué.
- **Sesiones con estado.** Se descartan los tokens autocontenidos, con las razones en `02`.

---

## Lo que NO incluye

Dicho de frente, para que se decida a propósito y no se descubra a mitad de camino:

- Inicio de sesión con proveedores externos (OAuth, SSO)
- Facturación ni planes por organización
- Límite de sesiones simultáneas
- Permisos por registro individual (el modelo es por capacidad, no por fila)
- Un esquema o una base de datos por cliente

Ninguna de esas ausencias es un obstáculo para agregarlas después: el `08` § 14 dice, para cada una,
qué haría falta y cuál es el detonante para hacerlo.

**Tres que sí están, y solo en los últimos tres documentos**: el segundo factor — obligatorio para el
rol que ve todas las organizaciones, porque para ése no puede ser opcional —, la recuperación de
contraseña, y la **detección**: qué vigilar para enterarse de un incidente sin que lo reporte un
cliente.

---

## Una advertencia sobre el tono

Estos documentos afirman cosas con seguridad ("nunca un hash rápido", "el filtro se inyecta, no se
pide") porque cada una de esas afirmaciones salió de un fallo real en producción. No son opiniones de
estilo.

Donde hay una elección legítima, está dicho que la hay, con los criterios para decidir. Donde no la
hay, también está dicho.

Y una salvedad sobre los tres últimos: **corrigen a los anteriores.** El `08` nació de una revisión que
encontró cosas que la serie afirmaba y no sostenía; el `09` nació de encontrar que **el propio `08`
rompía el login**. Donde uno contradice a otro, **gana el de número más alto** — y lo dice en cada
caso, con el reemplazo completo.

Que la serie se haya corregido dos veces no es un defecto del método: es el método. Lo único que hace
que un diseño así sea confiable es que alguien lo haya intentado romper por escrito.
