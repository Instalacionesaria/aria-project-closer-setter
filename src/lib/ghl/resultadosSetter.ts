/**
 * Las cinco salidas del Avanzar del **setter** (pre-agenda).
 *
 * Espeja `resultados.ts`, que es el catálogo del closer, con el mismo `ResultadoDef` — así el
 * motor de efectos (`aplicarEfectosGhl`) sirve para los dos sin una línea de bifurcación.
 *
 * Hasta hoy estas cinco salidas vivían en **tres tablas paralelas del frontend**
 * (`SETTER_OUTPUTS`, `SETTER_CARDS`, `SETTER_DETAIL_META` en `ContactDrawer.tsx`), sin
 * contraparte en el backend porque no había backend. Acá quedan en un solo lugar, del lado
 * compartido, que es de donde el endpoint las valida.
 */

// Import con extensión `.js`: `api/` corre en Node con ESM y sin ella falla en runtime
// (CLAUDE.md § Trampas del entorno). Vite lo resuelve igual, así que el front no cambia.
import { CAMPOS, TAGS, type CampoKey, type TagKey } from "./contrato.js";

export type ResultadoSetter = "agendo" | "venta_lt" | "seguimiento" | "no_califica" | "nurture";

export interface ResultadoSetterDef {
  readonly key: ResultadoSetter;
  /**
   * Tag que dispara el workflow, o `null` si esta salida no aplica ninguno.
   *
   * `null` no existe en el catálogo del closer y acá sí: ver `agendo`.
   */
  readonly tag: TagKey | null;
  /** Etapa del pipeline del setter a la que llega el contacto. */
  readonly stage: string;
  /** Custom field donde va la subcategoría. `null` = no se escribe nada en GHL. */
  readonly campo: CampoKey | null;
  /** Valores que ofrece la UI. Si `campo` es `null`, viven solo en `detalle`. */
  readonly opciones: readonly string[];
  readonly requiereMonto: boolean;
  readonly categoriaPildora: string;
}

/**
 * ── Por qué tres de las cinco tienen `campo: null` ────────────────────
 *
 * Porque **los vocabularios del setter no están en los dropdowns de GHL**, y escribir un valor
 * que no está en la lista es el peor caso posible: GHL responde **200 y descarta el valor**
 * (documentado en `resultados.ts` §50.5). O sea que reportaríamos un éxito que no ocurrió, que
 * es exactamente lo que prohíbe la regla 2 de CLAUDE.md.
 *
 * Los dos choques concretos, verificados campo por campo contra el contrato:
 *
 *   · Forma de pago LT — el setter ofrece Transferencia / Tarjeta / Efectivo / Otro;
 *     `contact.forma_de_pago_venta` acepta Contado / Splitwise / Buy Now Pay Later / Cuotas.
 *   · No califica — el setter ofrece Sin capital / Sin urgencia / No es el perfil / Datos falsos;
 *     `contact.motivo_de_descalificacin` acepta Precio / No es el momento / Competencia /
 *     No califica / Otro.
 *
 * Ninguno de los dos conjuntos es un subconjunto del otro, así que no hay traducción honesta.
 * El dato **no se pierde**: viaja en `closer_avances.detalle` y se muestra en la píldora. Lo que
 * no se hace es fingir que llegó a GHL.
 *
 * Se destraba de una de dos formas, y las dos son del lado de GHL: agregar esas opciones a los
 * dropdowns existentes, o crear custom fields propios del setter. Hasta entonces, `null`.
 */
export const RESULTADOS_SETTER: Readonly<Record<ResultadoSetter, ResultadoSetterDef>> = {
  /**
   * ── `agendo` no aplica ningún tag, y es deliberado ────────────────
   *
   * El swap `zona_setter` → `zona_closer` lo hace el **WF 04.1 de GHL** cuando la cita se crea
   * de verdad, y nuestra app no crea citas: el puerto no tiene esa operación y `agenda.ts` solo
   * lee de la caché. El contacto agenda por el booking link; esta salida **registra que pasó**.
   *
   * Aplicar `zona_closer` desde acá sería peor que no hacerlo: movería el contacto al territorio
   * del closer sin que exista ninguna cita, y el closer se encontraría con un lead en su cola sin
   * nada agendado. La cita real llega por el webhook `cita.agendada` y el cron de respaldo.
   *
   * Lo que sí hace esta salida: registra el avance con la atribución del setter y **corta sus
   * series** — un contacto que ya agendó no tiene que seguir recibiendo "para agendar".
   */
  agendo: {
    key: "agendo",
    tag: null,
    stage: "agendado",
    campo: null,
    opciones: [],
    requiereMonto: false,
    categoriaPildora: "AGENDÓ",
  },

  /**
   * ── Sin tag confirmado, y no se inventa uno ───────────────────────
   *
   * El único candidato del contrato es `derivado_lt`, y significa otra cosa: **derivado** a
   * low-ticket es una decisión de ruteo, no una venta cobrada. Usarlo acá haría que el workflow
   * que escucha "derivado" se disparara sobre alguien que ya compró.
   *
   * No existe hoy un tag para "el setter vendió un low-ticket". Entra en el mismo pendiente de configuración
   * que los literales de etapa (Bloque D): hasta que exista, la venta se registra en la base —con
   * su producto, su monto y su forma de pago— y no viaja a GHL. Registrada y visible es mejor que
   * mandada al tag equivocado.
   */
  venta_lt: {
    key: "venta_lt",
    tag: null,
    stage: "low_ticket_ofrecido",
    // Ver la nota de arriba: la forma de pago del setter no entra en el dropdown de GHL.
    campo: null,
    opciones: ["Transferencia", "Tarjeta", "Efectivo", "Otro"],
    requiereMonto: true,
    categoriaPildora: "VENTA LT",
  },

  /**
   * La única que sí escribe en GHL: `nivel_de_inters_seguimiento` es el ÚNICO dropdown de los
   * cinco que se verificó valor por valor contra la cuenta (2026-07-25), y el setter usa el mismo
   * vocabulario que el closer porque mide lo mismo — qué tan caliente quedó el lead.
   */
  seguimiento: {
    key: "seguimiento",
    tag: "seguimiento",
    stage: "en_calificacion",
    campo: "nivelInteresSeguimiento",
    opciones: ["Próximo a pagar", "Muy interesado", "Dudando", "Enfriándose", "Otro"],
    requiereMonto: false,
    categoriaPildora: "SEGUIMIENTO",
  },

  no_califica: {
    key: "no_califica",
    tag: "descalificado",
    stage: "descalificado",
    // Ver la nota de arriba: las cuatro razones del setter no están en el dropdown de GHL.
    campo: null,
    opciones: ["Sin capital", "Sin urgencia", "No es el perfil", "Datos falsos"],
    requiereMonto: false,
    categoriaPildora: "NO CALIFICA",
  },

  nurture: {
    key: "nurture",
    tag: "nurtureAppflow",
    stage: "nurture",
    campo: "origenNurture",
    // Estas sí coinciden con el dropdown del closer: es el mismo campo y el mismo significado.
    opciones: ["No-show", "Pidió tiempo", "Se enfrió"],
    requiereMonto: false,
    categoriaPildora: "NURTURE",
  },
} as const;

const CLAVES = Object.keys(RESULTADOS_SETTER) as ResultadoSetter[];

/**
 * `includes` sobre las claves propias y no `in`: `in` recorre la cadena de prototipos, así que
 * `"toString" in RESULTADOS_SETTER` da `true`. Es la misma trampa que documenta `avanzar.ts`.
 */
export function esResultadoSetter(v: string): v is ResultadoSetter {
  return CLAVES.includes(v as ResultadoSetter);
}

/**
 * Las dos series automáticas del setter, con su cadencia.
 *
 * Los tags ya existen en el contrato como **solo lectura desde el closer** — `tagsAQuitar()` los
 * deja intactos a propósito. Desde acá sí se escriben: son suyos.
 */
export const SERIES_SETTER = {
  para_agendar: { tag: "seguimientoParaAgendar" as TagKey, toques: 3, dias: 5, label: "Para agendar" },
  decision_lt: { tag: "seguimientoDecisionLt" as TagKey, toques: 2, dias: 3, label: "Para decisión LT" },
} as const;

export type SerieSetter = keyof typeof SERIES_SETTER;

/**
 * Los tags de serie del setter, para poder quitarlos todos al cambiar de salida.
 *
 * Un contacto está en una serie, o en ninguna — nunca en dos. Y cualquier salida del Avanzar las
 * cancela: si el lead agendó o se descalificó, seguir mandándole "para agendar" es peor que no
 * hacer nada.
 */
export const TAGS_SERIE_SETTER: readonly TagKey[] = [
  SERIES_SETTER.para_agendar.tag,
  SERIES_SETTER.decision_lt.tag,
];

/** Literales que este catálogo escribe en GHL. Para el diagnóstico, igual que el del closer. */
export function literalesSetter(): { tags: string[]; campos: string[] } {
  const tags = new Set<string>();
  const campos = new Set<string>();
  for (const def of Object.values(RESULTADOS_SETTER)) {
    if (def.tag) tags.add(TAGS[def.tag].valor);
    if (def.campo) campos.add(CAMPOS[def.campo].valor);
  }
  for (const t of TAGS_SERIE_SETTER) tags.add(TAGS[t].valor);
  return { tags: [...tags], campos: [...campos] };
}
