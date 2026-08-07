# Los prompts ya no viven acá

**Desde el 2026-08-07 los prompts de los agentes auditados están en la base**, no en este
directorio. Se editan en **Ajustes › Credenciales › Prompts de los agentes** y se guardan en las
columnas `prompt_*` de `closer_org_config`, una por empresa.

Este archivo queda como cartel indicador: `api/_lib/promptAgente.ts` apuntaba a
`docs/prompts/<agente>.md` y alguien que llegue buscando esos `.md` merece saber a dónde se
fueron, en vez de concluir que se perdieron.

## Por qué se movieron

| Motivo | Detalle |
|---|---|
| **El prompt es de cada subcuenta de GHL** | Un archivo del repo solo puede tener uno. Auditar al agente de la empresa B contra el prompt de ARIA no da un resultado peor: da uno **convincente y falso**, que es la clase de error que nadie detecta |
| **Cambiarlo exigía un deploy** | Un cliente no puede pedir un commit cada vez que ajusta su propio agente |

## Lo que había que saber, y sigue valiendo

- **Se versiona por hash del contenido**, no por commit. El hash se recalcula del texto en cada
  lectura y no se toma de la columna `*_hash` que el panel guarda al lado: esa dice qué hash
  tenía el texto al guardarse, y el que sirve para comparar contra
  `closer_hallazgo_agente.prompt_hash` es el del texto que el auditor está usando ahora.
- **Sin prompt cargado, todo degrada limpio.** `fragmento_prompt` queda `null` y la corrección se
  emite como instrucción autónoma para agregar. No es un error: es una empresa que todavía no
  pegó el suyo.
- **El caché está indexado por empresa + agente.** Una instancia caliente de Vercel que ya cacheó
  el de ARIA no puede servírselo al auditor de otra empresa.

## Una advertencia sobre lo que estuvo pasando

Los dos archivos que este README anunciaba (`appointment-flow-ai.md`, `lead-flow-ai.md`) **nunca
existieron**, así que el auditor corrió todo ese tiempo sin prompt de referencia. Y desde la fase 4
el panel de administración ya los guardaba en la base con su hash y los mostraba confirmados en
pantalla: la escritura funcionaba y la lectura miraba otro lado.

Vale anotarlo porque el modo de fallo no fue una caída — fue una pantalla diciendo que todo estaba
bien. Es lo que la regla §4.2 del proyecto prohíbe, y costó un día de auditoría encontrarlo.

Detalle completo en [07-AUDITOR-IA](../07-AUDITOR-IA.md) § *El prompt del agente auditado, adentro*.
