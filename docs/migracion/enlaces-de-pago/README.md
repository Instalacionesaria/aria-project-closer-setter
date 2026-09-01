# Enlaces de pago — cómo funciona hoy, y qué hay que construir

**El vendedor está en el chat con un contacto que quiere pagar y necesita mandarle el link de cobro
sin salir de la conversación.** Eso es lo que resuelve esta función.

---

## El estado, en una frase

> **La parte visible está construida y la parte que la sostiene no: el catálogo de enlaces vive en el
> `localStorage` de cada navegador, así que no se comparte con nadie.**

Lo que significa en la práctica:

| Hecho                                                |
| ---------------------------------------------------- |
| El admin carga los enlaces y **solo él los ve**      |
| El vendedor abre el menú y **lo ve vacío**           |
| El mismo admin en otra computadora **lo ve vacío**   |
| Borrar los datos del navegador **borra el catálogo** |

**No es un error de configuración ni un dato que falta cargar: es dónde está guardado.**

> Este producto **ya resolvió el mismo problema una vez** —los porcentajes de comisión vivían igual y
> se movieron a la base—, así que el camino está probado. Ver el `03`.

---

## Los cinco documentos

| #      | Documento                                                                | Qué contiene                                                                |
| ------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| **01** | [El catálogo](01-EL-CATALOGO.md)                                         | Qué es una entrada, sus seis campos, las categorías y el alcance por rol    |
| **02** | [El menú del chat](02-EL-MENU-DEL-CHAT.md)                               | Dónde se usa, qué pasa al hacer click, y **las dos URLs inventadas**        |
| **03** | [Dónde vive, y por qué hay que moverlo](03-DONDE-VIVE-Y-COMO-MOVERLO.md) | El defecto de fondo, sus consecuencias, y el precedente que ya se resolvió  |
| **04** | [El dinero](04-EL-DINERO.md)                                             | Dónde se registra un cobro hoy, y **qué NO conecta el enlace con la venta** |
| **05** | [Decisiones abiertas](05-DECISIONES-ABIERTAS.md)                         | Lo que hay que decidir **antes** de construir. Ninguna se inventó acá       |

---

## El modelo, en una página

### Las tres piezas, y cuál falta

```
   ┌──────────────────────┐      ┌──────────────────────┐      ┌──────────────────────┐
   │  1. EL CATÁLOGO       │      │  2. EL MENÚ           │      │  3. EL COBRO          │
   │                       │      │                       │      │                       │
   │  Qué enlaces existen  │─────▶│  Insertarlo en el     │─ ? ─▶│  ¿Pagó? ¿Cuánto?      │
   │  y quién los ve       │      │  mensaje              │      │  ¿Cuándo?             │
   └──────────────────────┘      └──────────────────────┘      └──────────────────────┘
       Construido,                    Construido                    NO EXISTE
       en el navegador
```

**La tercera no está y no se puede inventar**: exige decidir con qué se cobra y si esa herramienta
avisa cuando alguien paga. Ver el `05`.

### Lo que un enlace es hoy

**Una URL guardada con una etiqueta.** Nada más:

| Lo que SÍ es                              | Lo que NO es                                        |
| ----------------------------------------- | --------------------------------------------------- |
| Un enlace fijo, cargado a mano            | **No se genera** por contacto ni por monto          |
| Con una etiqueta y un monto de referencia | **El monto no cobra nada**: es texto que se muestra |
| Que se inserta en el mensaje              | **No se envía solo**, y no se registra que se mandó |

> **Es un marcador de páginas compartido, no una pasarela de pago.** Y para muchos negocios eso
> alcanza — pero hay que saber cuál de las dos cosas se está construyendo.

### Las cuatro reglas que ya están decididas y conviene copiar

1. **Etiqueta + monto + procesador, nunca solo el monto.** Un ítem que dice "$500" y nada más se
   manda al contacto equivocado.
2. **Alcance por rol.** El vendedor de una etapa no ve los enlaces de la otra.
3. **Nunca una semilla que parezca un cobro real.** Había dos enlaces de ejemplo y **se borraron**:
   un link de cobro falso que se puede mandar por accidente es peor que un menú vacío.
4. **El click INSERTA, no envía.** La persona ve el mensaje antes de que salga.

---

## El orden en que conviene construirlo

| #   | Qué                                                  | Por qué acá                                                         |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | **Guardar el catálogo del lado del servidor** (`03`) | Sin esto, todo lo demás lo ve una sola persona                      |
| 2   | **La pantalla de administración** (`01`)             | Es lo que ya existe: se conecta a lo del paso 1                     |
| 3   | **El menú del chat** (`02`)                          | Leer y insertar. Es la parte más simple                             |
| 4   | **Sacar las URLs inventadas** (`02` § 4)             | Es una corrección, no una función nueva — y es lo que ve un cliente |
| 5   | **Decidir el cobro** (`05`)                          | Recién acá, y **es una decisión de negocio, no técnica**            |

**El paso 4 no espera al 5.** Hoy hay dos botones que insertan una dirección que no existe en un
mensaje a un cliente real; eso se arregla solo, sin depender de ninguna decisión sobre pagos.
