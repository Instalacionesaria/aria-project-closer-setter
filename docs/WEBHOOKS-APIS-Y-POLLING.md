# Cómo llegan los datos de GHL a la herramienta (y qué crear en la subcuenta)

**Actualizado: 2026-07-31.** Reemplaza al viejo `COSTOS-Y-POLLING.md` (los 8 pollings ya no
existen). Detalle técnico completo: `CLAUDE.md §51`.

---

## Cómo funciona hoy, en 4 líneas

1. **Mensajes**: un reloj del servidor los trae de GHL cada 10 segundos (solo con la app
   abierta) y los guarda en nuestra base. El webhook, cuando exista, baja eso a ≤1 segundo.
2. **Citas**: un cron las trae 2 veces por hora (:25 y :55) — y 30 min antes de cada
   reunión refresca la ficha del contacto. La cita es también el ALTA: todo contacto nuevo
   llega con una, porque `zona_closer` se aplica después de agendar.
3. **Todo lo demás** (Pipeline, Mi Día, Inicio, chat) lee de NUESTRA base — cero GHL.
4. Con la pestaña oculta no corre nada. Costo total: ~6 llamadas/min con la app abierta
   + ~2-3/hora de fondo. Antes: 88% del límite diario de GHL con un solo closer.

**Regla del Buzón** (importante para el punto ⭐ de abajo): un mensaje entrante entra al
Buzón del closer si el bot está APAGADO. Y sin ningún tag de bot, el sistema asume APAGADO
— mejor un mensaje de más que uno perdido.

---

## Los workflows (opcionales — dan velocidad, no funcionalidad)

**URL** (la misma en todos): `https://project-closer-setter.vercel.app/api/webhooks/ghl` ·
**Método**: `POST` · **Header obligatorio**: `X-Webhook-Secret` (pedime el valor por
privado; sin él, el endpoint rechaza todo).

| # | Cuándo dispara | Cuerpo JSON |
|---|---|---|
| 1 | Tag `zona_closer` agregado | `{"evento":"contacto.zona_closer","contactId":"{{contact.id}}"}` |
| 2 | Contacto cambia | igual, con `"evento":"contacto.actualizado"` |
| 3 ⭐ | Cliente responde | `{"evento":"mensaje.entrante","contactId":"{{contact.id}}","mensaje":"{{message.body}}","messageId":"{{message.id}}","conversationId":"{{message.conversation_id}}"}` |
| 4 | Mensaje saliente | igual que el 3, con `"evento":"mensaje.saliente"` |
| 5 ⭐ | Cita creada | `{"evento":"cita.agendada","contactId":"{{contact.id}}","citaEl":"{{appointment.start_time}}","meetUrl":"{{appointment.address}}","appointmentId":"{{appointment.id}}","titulo":"{{appointment.title}}"}` |
| 6 | Cita cancelada | `{"evento":"cita.cancelada","contactId":"{{contact.id}}","appointmentId":"{{appointment.id}}"}` |
| 7 | Cada toque de la serie Recupero | `{"evento":"serie.toque","contactId":"{{contact.id}}","toque":1}` |
| 8 ⭐ | Serie termina sin respuesta | `{"evento":"serie.agotada","contactId":"{{contact.id}}"}` |

Si un merge field no existe, mandá los que haya — todo evento se guarda crudo antes de
interpretarse y nada se pierde. El endpoint responde 200 casi siempre a propósito (GHL
desactiva workflows que fallan mucho).

---

## ⭐ Lo ÚNICO nuevo que necesito de vos: el tag `bot_activado`

El sistema decide si un mensaje va al Buzón con esta regla, en este orden:

```
bot_desactivado_postcall → APAGADO (ya tuvo la sales call)
bot_pausado_fallo        → APAGADO (lo apagó el auditor)
bot_activado             → PRENDIDO (sus mensajes NO van al Buzón)
ninguno                  → APAGADO (van al Buzón)
```

Hoy `bot_activado` no existe en la subcuenta. **Tus workflows tienen que aplicarlo cuando
el chatbot toma una conversación** — si no, todos los contactos que el bot atiende van a
inundar el Buzón del closer. No hace falta quitarlo después: los tags de apagado le ganan.

También pendiente de confirmar: cuál de la familia `seguimiento_*` dispara la serie
automática post-call (el sistema asume `seguimiento_recupero`).

---

## Cómo probar

1. Contacto de prueba: nombre `ZZ PRUEBA`, **sin teléfono real**, email `@example.com`.
2. Agendale una cita (o esperá el cron de :25/:55) → aparece en Pipeline → Agendado.
3. `https://project-closer-setter.vercel.app/api/diagnostico` debe dar `ok: true`.
4. Un WhatsApp entrante con bot apagado aparece en el Buzón en ≤10s (≤1s con el workflow 3).
5. Borrá el contacto de prueba al terminar.

## El gasto que sí crece con el negocio (no es polling)

El **analizador IA** (~$0,02 por mensaje analizado, se dispara solo desde los webhooks de
mensaje). Hoy cuesta $0 porque los workflows no existen; al crearlos, empieza a correr.
