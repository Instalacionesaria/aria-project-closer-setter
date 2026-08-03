/**
 * De los tags de un contacto de GHL a su etapa en el Pipeline del closer.
 *
 * Es la pieza central del modelo de negocio (Fabio, 2026-07-30): el Pipeline es **TODOS los
 * contactos con `zona_closer`**, clasificados en una de siete etapas según lo último que se
 * les registró en Avanzar. En GHL no hay ningún campo "etapa" que leer para saberlo: el
 * stage lo mueve un workflow disparado por el tag (`CONTRATO-GHL.md` §3), y la búsqueda de
 * contactos devuelve tags, no stages. Así que la etapa se DEDUCE de los tags, y este módulo
 * es el único lugar donde se deduce — lo importan el endpoint `api/closer/pipeline.ts` y el
 * front, para que los dos clasifiquen igual.
 *
 * Isomorfo: sin React, sin DOM, sin Node, sin fetch. Función pura, mismo criterio que
 * `pildora.ts` y `seguimientos/dominio.ts`.
 *
 * La extensión `.js` de los imports es obligatoria: este módulo lo importan las funciones de
 * `api/`, que corren como ESM nativo en Node y no resuelven un relativo sin ella
 * (CLAUDE.md §50.9). `tsc` no lo detecta y falla recién en runtime.
 */

import { TAGS } from "./contrato.js";
import { RESULTADOS, type ResultadoAvanzar } from "./resultados.js";

/**
 * Las siete etapas del Pipeline del closer.
 *
 * Es la MISMA unión que `StageKey` en `src/lib/closerStore.tsx`, redeclarada acá a propósito:
 * `closerStore.tsx` es un componente con React adentro, y las funciones de `api/` no pueden
 * importarlo. Este módulo es el hogar isomorfo del tipo; `etapas.test.ts` verifica contra el
 * `STAGE_ORDER` real del store que las dos listas no se separen.
 */
/* La etapa temporal "limbo" (pruebas, 2026-08-01) se eliminó el 2026-08-03: los contactos
   sin Avanzar vuelven a caer en `agendado`, la etapa de entrada real. */
export type StageKey = "agendado" | "seguimiento" | "cierre" | "ganado" | "no_show" | "nurture" | "descalificado";

/** Orden de recorrido del Pipeline, de la entrada al desenlace. Igual que `STAGE_ORDER`. */
export const ETAPAS_ORDEN: readonly StageKey[] = [
  "agendado",
  "seguimiento",
  "cierre",
  "ganado",
  "no_show",
  "nurture",
  "descalificado",
];

/**
 * ETAPA DE ENTRADA — el fallback EXPLÍCITO, no un default implícito.
 *
 * Un contacto con `zona_closer` y sin ningún tag de desenlace es alguien que ya agendó (el
 * WF 04.1 hace el swap `zona_setter`→`zona_closer` justo al agendar, contrato §3) y que
 * todavía no recibió ningún Avanzar. Ese es exactamente `agendado`: la etapa de entrada del
 * Pipeline, no un "no sé dónde ponerlo".
 *
 * Por eso está declarado como constante y no escondido en un `?? "agendado"` al final de la
 * función: es una regla de negocio, no un valor por defecto de programación.
 */
export const ETAPA_DE_ENTRADA: StageKey = "agendado";

/**
 * PRIORIDAD DE DESENLACES — por qué hay una, y por qué este orden.
 *
 * ── Por qué no alcanza con "el primero que aparezca" ──
 *
 * Los tags se ACUMULAN: `CONTRATO-GHL.md` §4 dice que escribir un resultado nuevo no borra
 * los anteriores, y el array de tags que devuelve GHL no trae fechas. Así que un contacto
 * puede llegar con `seguimiento` Y `venta_ganada` a la vez, y el orden en que GHL los liste
 * es arbitrario. Sin una prioridad declarada, la misma persona caería en una columna u otra
 * según cómo vino ordenada la respuesta.
 *
 * ── El criterio: cuál de los tags presentes describe mejor el PRESENTE ──
 *
 * Mirando `tagsAQuitar()` en `api/_lib/seguimientos.ts`, los tags no envejecen igual:
 *
 *  · Los CINCO desenlaces exclusivos (`venta_ganada`, `adelanto_ganado`, `descalificado`,
 *    `nurture_appflow`, `noshow`) se limpian entre sí: registrar uno quita los otros cuatro.
 *    Si uno está puesto, es el último que se registró de ese grupo.
 *  · `seguimiento` NO lo quita nadie — el contrato §9 aclara que "sirve pre y post call", así
 *    que convive con todos. Una vez que un contacto pasó por seguimiento, arrastra el tag
 *    para siempre. Prueba que ESTUVO en seguimiento, nunca que ESTÁ.
 *
 * De ahí sale la regla: los cinco exclusivos ganan sobre `seguimiento`, y entre ellos se
 * ordenan por qué tan definitivo es el desenlace.
 *
 * 1. `venta_ganada` → **ganado**. Se cobró. Es el desenlace terminal; nada lo supera.
 * 2. `adelanto_ganado` → **cierre**. Hay plata comprometida. Más avanzado que cualquier
 *    estado pendiente, menos definitivo que la venta cobrada.
 * 3. `descalificado` → **descalificado**. Cerrado en negativo: es una decisión humana
 *    tomada ("no me interesa"), no un estado de espera.
 * 4. `nurture_appflow` → **nurture**. También frío, pero explícitamente reversible ("no es
 *    ahora"). Por eso va debajo del "no" definitivo.
 * 5. `noshow` → **no_show**. Es un hecho operativo, no una resolución: dispara recuperación
 *    y el contacto sigue vivo. Pesa menos que cualquier desenlace decidido.
 * 6. `seguimiento` → **seguimiento**. El más pegajoso de todos (ver arriba) y por lo tanto
 *    la señal más débil: solo gana cuando es el único que hay.
 *
 * ── Divergencia consciente con `DESENLACES_CLOSER` (api/closer/respondieron.ts) ──
 *
 * Esa lista ordena `... noshow, seguimiento, nurture_appflow, descalificado`, o sea pone
 * `seguimiento` POR ENCIMA de nurture y descalificado. Para etiquetar una fila del Buzón es
 * inocuo; para el Pipeline no: la secuencia más común de todas —seguimiento durante semanas
 * y después "no le interesa"— deja al contacto con los dos tags, y con ese orden seguiría
 * apareciendo en la columna de trabajo activo de un closer que ya lo dio por perdido.
 * Se corrige acá y queda anotado. `respondieron.ts` no se toca (lo lleva otro frente); el
 * día que se unifiquen, esta es la lista que hay que conservar.
 *
 * ── Lo que NO entra en esta lista ──
 *
 * Los tags de MODO de seguimiento (`seguimiento_recupero`, `seguimiento_manual`) no son
 * desenlaces: dicen CÓMO se persigue, no en qué terminó. El tool nunca escribe uno sin
 * escribir también `seguimiento`, así que no aportan nada.
 *
 * Y las series del SETTER (`seguimiento_para_agendar`, `seguimiento_decision_lt`) están
 * fuera por una razón más fuerte: el swap de territorio no las quita, así que un contacto
 * recién agendado las sigue arrastrando. Tratarlas como desenlace metería en Seguimiento a
 * buena parte de los que en realidad están en Agendado.
 */
export const PRIORIDAD_DESENLACES: readonly ResultadoAvanzar[] = [
  "venta",
  "acordo",
  "no_interesa",
  "nurture",
  "no_show",
  "seguimiento",
];

/**
 * Lectura tolerante a mayúsculas y espacios.
 *
 * En la ESCRITURA el matcheo tiene que ser exacto —un valor de dropdown que no coincide letra
 * por letra hace que GHL devuelva 200 y no escriba nada (§50.5)—, pero acá solo estamos
 * leyendo para clasificar: si la subcuenta guardó `Venta_Ganada`, reconocerlo no puede
 * romper nada, e ignorarlo mandaría a un contacto vendido a la columna equivocada.
 */
const normalizar = (t: string) => t.trim().toLowerCase();

export interface Desenlace {
  /** La salida de Avanzar que lo produjo, tal como la nombra `resultados.ts`. */
  readonly resultado: ResultadoAvanzar;
  /** El tag literal de GHL que se encontró en el contacto. */
  readonly tag: string;
  readonly etapa: StageKey;
}

/**
 * El desenlace ganador de un contacto, o `null` si no tiene ninguno.
 *
 * Se expone además de `etapaDesdeTags` para poder responder "¿por qué está en esta etapa?"
 * sin abrir GHL: el endpoint devuelve el tag que decidió la clasificación.
 */
export function desenlaceDesdeTags(tags: readonly string[]): Desenlace | null {
  const presentes = new Set(tags.map(normalizar));

  for (const resultado of PRIORIDAD_DESENLACES) {
    const def = RESULTADOS[resultado];
    const tag = TAGS[def.tag].valor;
    if (presentes.has(normalizar(tag))) {
      // `def.stage` viene tipado como `string` en el catálogo; que sea una de las siete
      // etapas lo garantiza `etapas.test.ts`, que lo cruza contra ETAPAS_ORDEN.
      return { resultado, tag, etapa: def.stage as StageKey };
    }
  }

  return null;
}

/**
 * La etapa del Pipeline a la que pertenece un contacto, a partir de sus tags crudos de GHL.
 *
 * Los tags que no conoce se ignoran en silencio, a propósito: la subcuenta tiene decenas
 * (`lead_meta_ads`, `cita_agendada`, `estancado`, los de las campañas) y ninguno de ellos
 * dice en qué terminó la llamada. Solo los seis desenlaces de Avanzar clasifican.
 */
export function etapaDesdeTags(tags: readonly string[]): StageKey {
  return desenlaceDesdeTags(tags)?.etapa ?? ETAPA_DE_ENTRADA;
}

/** Contador por etapa con las SIETE claves siempre presentes, incluidas las que dan cero. */
export function contarPorEtapa(etapas: readonly StageKey[]): Record<StageKey, number> {
  const conteo = Object.fromEntries(ETAPAS_ORDEN.map((e) => [e, 0])) as Record<StageKey, number>;
  for (const e of etapas) conteo[e] += 1;
  return conteo;
}
