# Prompts de los agentes auditados

Acá van los prompts de los agentes de texto de GHL, **tal cual están configurados en la
subcuenta**. No son prompts nuestros: son una copia fiel de lo que Francisco tiene cargado
en el chatbot, para que el auditor pueda citarlos.

| Archivo | Agente | Territorio | Estado |
|---|---|---|---|
| `appointment-flow-ai.md` | Appointment Flow AI | `zona_closer` (post-agenda) | **falta** |
| `lead-flow-ai.md` | Lead Flow AI | `zona_setter` (pre-agenda) | falta — su auditor tampoco existe (§53.4) |

## Para qué los lee el auditor

Sin el prompt, el auditor puede decir *"prometió un financiamiento que no existe"* y poco
más. Con el prompt adentro, puede señalar **qué línea** lo permite y escribir el reemplazo
listo para pegar. Esa es la diferencia entre un diagnóstico y un parche.

En la pestaña Auditoría de Agentes eso se ve como el bloque **DICE AHORA → DEBERÍA DECIR**
del panel de corrección.

## Qué pasa mientras no estén

Nada se rompe. El auditor detecta la ausencia y cambia de modo:

- No inyecta el bloque `<prompt_del_agente>`.
- `fragmento_prompt` queda en `null` — no se inventa una cita.
- La corrección se emite como **instrucción autónoma para agregar**
  (`correccion_tipo: "agregado"`) en vez de como reemplazo.
- `GET /api/agentes/auditor-estado` reporta `promptAgente.presente: false`, así que la
  ausencia es un dato visible y no un misterio.

Cuando el archivo aparezca, **no hay que tocar código ni desplegar nada especial**: el
siguiente análisis lo incluye solo.

## Cómo agregarlo

1. Copiar el prompt desde GHL (subcuenta → el chatbot → su configuración) y pegarlo tal
   cual en `appointment-flow-ai.md`. Sin reformatear: el auditor cita **texto literal**, y
   si acá está reescrito, el fragmento que proponga no va a coincidir con lo que hay en GHL
   y el técnico no lo va a poder buscar.
2. Commitear. La versión que usa el auditor es el **hash del contenido** del archivo, no el
   commit — cada análisis guarda contra qué hash se emitió, y así la pestaña puede avisar
   cuando una corrección quedó vieja porque el prompt cambió.

## Dos advertencias

- **Este repo se comparte con el equipo.** Lo que se pegue acá es visible para todos los que
  tengan acceso; si el prompt contiene algo que no debería circular (credenciales, links
  privados, condiciones comerciales que no son públicas), sacarlo antes de commitear.
- **Los archivos tienen que llegar a producción.** Vercel no incluye archivos que no estén
  declarados: `vercel.json` los sube con `includeFiles: "docs/prompts/**"` en las funciones
  que los leen. Si se agrega otra función que cargue prompts, hay que declararla también, o
  va a funcionar en local y a no encontrar nada desplegada.
