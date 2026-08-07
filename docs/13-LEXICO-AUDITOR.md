# El léxico del auditor — nivel 0

**La lista que decide cuándo vale la pena mirar una conversación.** Español latinoamericano.
Vive en `api/_lib/auditor/lexico.ts`; este documento es para revisarla y decidir qué agregar.

> Un test verifica que **este documento y el archivo digan lo mismo**. Si agregás un término
> acá, agregalo allá — y al revés. Dos listas que se separan es exactamente lo que este proyecto
> ya pagó caro.

---

## Cómo funciona, en tres reglas

1. **Todo va normalizado**: minúsculas, **sin acentos**, sin puntuación. Escribir `"está"` no
   matchea nunca, porque el texto entrante llega como `esta`.
2. **Se compara la expresión rodeada de espacios**, no como substring. `caro` no matchea dentro
   de `carozo`. Una expresión de varias palabras matchea esa secuencia exacta.
3. **Solo se miran los 3 mensajes más recientes del contacto.** Un "esto no me sirve" de hace dos
   semanas, ya resuelto, no es una alarma de ahora.

## La regla para agregar un término

> **Si podés imaginarlo en una conversación que va bien, no va.**

Una alarma no acusa a nadie: solo adelanta el momento del análisis, que sigue decidiéndolo el
modelo con cita textual. Un falso positivo cuesta una inferencia; un falso negativo es un lead
maltratado que nadie ve. Por eso está calibrado para **errar hacia mirar** — pero un término
demasiado común rompe eso, porque alarma siempre y equivale a no tener alarma.

---

## Frustración — el contacto está molesto, impaciente o desconfía

### Enojo directo
`estafa` · `estafadores` · `es una estafa` · `me estan estafando` · `no me jodan` ·
`que falta de respeto` · `una verguenza` · `pesimo` · `pesima atencion` ·
`horrible` · `malisimo`

### Impaciencia y demora
`sigo esperando` · `hace rato` · `cuanto mas tengo que esperar` · `nadie me responde` ·
`no me responden` · `ya pregunte` · `ya te pregunte` · `otra vez lo mismo` · `te repito` ·
`ya lo dije`

### No entiende o no le sirve
`no entiendes` · `no me entiendes` · `no entendes` · `no me entendes` ·
`no es lo que pregunte` · `no es lo que pedi` · `no me sirve` · `no me estas ayudando` ·
`no me ayudas`

> Las variantes con **vos** y con **tú** están las dos a propósito (`no entendes` / `no
> entiendes`). El equipo es peruano y el producto se vende en varios países.

### Quiere salir del bot
`quiero hablar con una persona` · `hablar con un humano` · `con un asesor` · `con alguien real` ·
`eres un bot` · `sos un bot` · `es un robot` · `esto es un bot`

### Abandono
`olvidalo` · `dejalo asi` · `no me interesa mas` · `ya no me interesa` · `no gracias` ·
`me arrepenti` · `cancelen` · `quiero cancelar`

---

## Intención de compra — el contacto quiere pagar

Es la señal que más urge de las cinco: alguien con la tarjeta en la mano encontrándose con un bot
que no entiende es el peor momento posible para no estar mirando.

### Quiere pagar ahora
`quiero pagar` · `como pago` · `donde pago` · `puedo pagar` · `ya quiero pagar` ·
`pasame el link de pago` · `el link de pago` · `link para pagar` · `datos para transferir` ·
`a que cuenta transfiero` · `numero de cuenta` · `ya transferi` · `ya pague` ·
`hice la transferencia` · `mande el comprobante`

### Quiere comprar
`quiero comprarlo` · `lo quiero comprar` · `quiero contratar` · `quiero empezar` ·
`como me inscribo` · `donde me inscribo` · `como me anoto` · `dame el link`

### Medios de pago
`acepta tarjeta` · `aceptan tarjeta` · `puedo pagar en cuotas` · `hay financiamiento` ·
`cuotas sin interes` · `por mercadopago` · `por yape` · `por plin` · `por transferencia`

> **`precio` NO está, y es deliberado.** Preguntar el precio es la conversación normal de este
> negocio, no una intención de pago. Lo que va acá es la intención de **cerrar**.

---

## Lo que decidí dejar afuera, y por qué

Para que no se agregue por reflejo:

| Término | Por qué no |
|---|---|
| `no`, `pero`, `todavía` | Aparecen en cualquier conversación. Alarmarían siempre |
| `precio`, `cuánto sale`, `cuánto cuesta` | Es la pregunta normal del embudo, no una señal |
| `caro` | Ambiguo: puede ser una objeción sana que el agente maneja bien |
| `urgente` | Lo usa el que tiene apuro por comprar tanto como el que está enojado |
| Insultos sueltos | En varios países son muletillas sin carga. Van las expresiones completas |
| Emojis (😠, 🤬) | Se descartaron por ahora: el normalizador los borra. Ver abajo |

---

## Pendientes — lo que sé que falta

Anotado para revisar con el equipo, no implementado:

1. **Variantes regionales de pago.** Están `yape` y `plin` (Perú) y `mercadopago`. Faltan las de
   los otros países donde se venda: `nequi` y `daviplata` (Colombia), `pix` (Brasil), `spei`
   (México), `zelle`.
2. **Emojis de enojo.** Hoy el normalizador los borra antes de comparar. Detectarlos exige una
   rama aparte que corra sobre el texto crudo. Vale la pena solo si aparecen de verdad.
3. **Errores de tipeo.** `no me sirbe`, `estaffa`. Una distancia de edición los cubriría, a costa
   de falsos positivos. No se hizo: primero hay que ver datos reales.
4. **Medir cuál señal sirve.** Cada alarma guarda su `senal` en `closer_analisis_agente.alarmas`
   (migración `029`). Después de unas semanas, esta consulta dice cuál sirve y cuál solo gasta:

   ```sql
   select unnest(alarmas) as senal,
          count(*) as analisis,
          count(*) filter (where fallo) as rojos
     from closer_analisis_agente
    where alarmas is not null
    group by 1 order by 2 desc;
   ```

   Una señal que dispara seguido y **nunca** termina en rojo se saca.

---

## Cuándo dispara, exactamente

Una alarma **adelanta** el análisis; no lo reemplaza ni lo decide. El portón queda así:

| Condición | Corre el análisis |
|---|---|
| `delta ≥ 5` mensajes nuevos del agente | Sí — el debounce de siempre, sin cambios |
| `delta ≥ 1` **y** alguna alarma | Sí — adelantado por el nivel 0 |
| `delta = 0` | No, ni con alarma |

> **El piso de `delta ≥ 1` no es un detalle.** Una alarma no se consume: la queja sigue en los 3
> mensajes recientes después de que el análisis corrió. Sin el piso, una conversación alarmada se
> re-analizaría en cada mensaje entrante hasta que la queja envejeciera — y el debounce ya no la
> frena, porque la alarma es justo lo que lo saltea. El criterio: esto audita **al agente**, así
> que si el agente no dijo nada nuevo, el veredicto anterior ya cubre lo que hay.

Las heurísticas leen de `closer_mensajes` —nuestra caché— y no de GHL. Por eso el nivel 0 cuesta
una consulta a la base y **ninguna** llamada al modelo ni a la API de GHL.

---

## Cómo verificar que un término funciona

```bash
npx vitest run api/_lib/auditor/_heuristicas.test.ts
```

Los tests cubren la normalización, la frontera de palabra y las cinco señales. Si agregás un
término con acento o con mayúscula, el test de normalización lo caza.
