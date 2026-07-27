# Webhooks de GHL — qué crear en la subcuenta

**Para Francisco · 2026-07-25**

Esto es lo que hay que armar del lado de GoHighLevel para que los contactos y sus eventos
lleguen a la herramienta del closer. Del lado del código ya está todo listo y desplegado.

---

## Por qué son workflows y no una suscripción

Una **Private Integration no puede suscribirse a webhooks** — eso solo lo pueden hacer las
apps del marketplace. El camino es crear un **workflow con acción "Webhook"** por cada
evento, que es además como ya trabaja el resto del sistema: *"Kevin decide y etiqueta; GHL
ejecuta lo predecible"*.

Todos los workflows apuntan **a la misma URL**. Se distinguen por un campo `evento` en el
cuerpo.

---

## Configuración común a todos

**URL** (idéntica en los 8 workflows):

```
https://project-closer-setter.vercel.app/api/webhooks/ghl
```

**Método**: `POST`

**Header de seguridad** (obligatorio en todos):

| Header | Valor |
|---|---|
| `X-Webhook-Secret` | *(un valor que elijas — ver abajo)* |

El endpoint es público: sin este header, cualquiera que descubra la URL puede inyectar
contactos y eventos falsos. Elegí una cadena larga y aleatoria, decímela y la configuro en
Vercel. Mientras no esté configurada el endpoint acepta todo, para poder probar — pero no
debería quedarse así.

**Cuerpo**: JSON, y **muy corto a propósito**. Solo el tipo de evento y el id del contacto:
todo lo demás se lo preguntamos a GHL en el momento, que es la fuente de verdad. Si el
cuerpo trajera el nombre y los tags, cualquier cambio de estructura en GHL rompería la
integración en silencio, y un workflow que dispara tarde nos dejaría con datos viejos.

---

## Los 8 workflows

### 1. Contacto entra al territorio del closer ⭐ *el más importante*

Es el que hace que un contacto aparezca en la herramienta. **Empezá por este.**

- **Trigger**: `Contact Tag` → *Tag Added* → `zona_closer`
- **Cuerpo**:

```json
{
  "evento": "contacto.zona_closer",
  "contactId": "{{contact.id}}"
}
```

### 2. Contacto actualizado

Mantiene frescos los tags, el custom field de situación y los datos de la ficha.

- **Trigger**: `Contact Changed` (o *Tag Added/Removed* sobre los tags que nos importan)
- **Cuerpo**: igual que el 1, con `"evento": "contacto.actualizado"`

### 3. Mensaje entrante ⭐

Es lo que puebla **Respondieron** y **Buzón general**. Además cancela la serie automática
—perseguir a alguien que ya contestó es justo lo que hay que evitar— y reabre la tarea del
día si ya se había completado.

- **Trigger**: `Customer Replied`
- **Cuerpo**:

```json
{
  "evento": "mensaje.entrante",
  "contactId": "{{contact.id}}",
  "mensaje": "{{message.body}}"
}
```

### 4. Mensaje saliente

Sin esto, un contacto al que ya le respondimos seguiría apareciendo como "le debes
respuesta" para siempre.

- **Trigger**: cuando se envía un mensaje al contacto (WhatsApp/SMS saliente)
- **Cuerpo**: `{"evento": "mensaje.saliente", "contactId": "{{contact.id}}"}`

### 5. Cita agendada ⭐

Puebla **Agenda de Hoy**.

- **Trigger**: `Appointment` → *Created* / *Booked*
- **Cuerpo**:

```json
{
  "evento": "cita.agendada",
  "contactId": "{{contact.id}}",
  "citaEl": "{{appointment.start_time}}",
  "meetUrl": "{{appointment.address}}",
  "estado": "confirmada"
}
```

> El nombre exacto de los merge fields de cita puede variar según la versión — si alguno
> sale vacío, mandámelo y ajusto el mapeo. El evento igual se guarda entero, así que no se
> pierde nada mientras lo afinamos.

### 6. Cita cancelada

- **Trigger**: `Appointment` → *Cancelled* / *Status Changed*
- **Cuerpo**: `{"evento": "cita.cancelada", "contactId": "{{contact.id}}"}`

### 7. Toque de la serie enviado

Dentro de la serie **Recupero** (`seguimiento_recupero`), después de cada mensaje.

- **Trigger**: dentro del propio workflow de la serie, tras cada envío
- **Cuerpo**:

```json
{
  "evento": "serie.toque",
  "contactId": "{{contact.id}}",
  "toque": 1
}
```

Un workflow por toque, cambiando el número (1, 2, 3).

### 8. Serie agotada ⭐

**Este es el que cierra el ciclo del seguimiento automático.** Mientras la serie corre el
contacto no molesta a nadie; cuando se agota sin respuesta, recién ahí aparece en
"Seguimientos de hoy" para que el closer decida qué hacer.

- **Trigger**: al final de la serie Recupero, si el contacto nunca respondió
- **Cuerpo**: `{"evento": "serie.agotada", "contactId": "{{contact.id}}"}`

---

## Cómo probarlo

1. Creá un contacto de prueba en GHL. Ponele un nombre reconocible tipo
   `ZZ PRUEBA WEBHOOK`, **sin teléfono real** y con un email en `@example.com` (ese dominio
   está reservado para pruebas y no llega a ningún lado).
2. Agregale el tag **`zona_closer`**.
3. Entrá a `https://project-closer-setter.vercel.app/api/diagnostico` — debería seguir dando
   `ok: true`.
4. Abrí la herramienta: el contacto tiene que aparecer en Mi Día.

Si no aparece, el evento igual quedó guardado: el endpoint **guarda todo antes de
interpretarlo**, así que nada se pierde y puedo ver exactamente qué llegó y por qué no se
procesó.

### Si algún workflow todavía no existe

Hay una red de seguridad. Este endpoint barre GHL y trae todos los contactos con
`zona_closer`, hayan disparado un webhook o no:

```
POST https://project-closer-setter.vercel.app/api/closer/sincronizar
```

Sirve también para cargar los contactos que YA tenían el tag desde antes — por ellos nadie
va a disparar un evento retroactivo.

---

## Dos cosas que necesito de vos

1. **El valor del `X-Webhook-Secret`** que quieras usar, para configurarlo en Vercel.
2. **Confirmación de los merge fields de cita** (punto 5) — son los únicos que no pude
   verificar contra la cuenta.

---

## Nota sobre reintentos

El endpoint responde `200` casi siempre, incluso ante un evento que no supo interpretar. Es
deliberado: GHL reintenta ante un error y termina desactivando el workflow si falla mucho.
Como todo queda guardado crudo antes de interpretarse, un evento mal mapeado se puede
reprocesar después sin haberlo perdido. Solo devuelve error si el secreto es inválido o si
ni siquiera se pudo guardar — ahí sí conviene que reintente.
