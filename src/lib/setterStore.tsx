import { createContext, useCallback, useContext, useEffect, useState, useMemo } from "react";
import { type Grade, type BotEstado, type HistorialItem, type NotaItem, type CallRecord, type PerfilField } from "./closerStore";
import { useSettings } from "./settingsStore";
import { avanzarSetter, fetchMiDiaSetter, type ColaSetterContacto, type MiDiaSetterResponse } from "./api";
import { useAuth } from "./authStore";

/**
 * Single source of truth para el módulo Setter (§4.4 de CLAUDE.md), espejo de closerStore.tsx.
 * Construida el 2026-07-10 porque Avanzar en Setter no movía contactos entre colas (§15.5/§17
 * lo dejaban pendiente) — Mi Día, Pipeline e Inicio deberían leer de aquí, nunca guardar su propio estado.
 */

export type SetterStageKey =
  | "nuevo"
  | "en_calificacion"
  | "calificado_sin_agendar"
  | "low_ticket_ofrecido"
  | "agendado"
  | "nurture"
  | "descalificado";

/** Color de la píldora de situación — reemplaza los strings TAG_* sueltos por un tono con nombre. */
export type SetterTagTone = "source" | "cyan" | "violet" | "amber" | "emerald" | "rose";

export type Canal = "whatsapp" | "instagram";

const TAG_SOURCE =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground bg-muted/50 text-[10px] uppercase font-semibold";
const TAG_CYAN =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-[10px] uppercase font-semibold bg-cyan-50 text-cyan-700 border-cyan-200/60 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/30";
const TAG_VIOLET =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 bg-violet-500/10 text-violet-700 border-violet-500/20 text-[10px] uppercase font-semibold";
const TAG_AMBER =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-[10px] uppercase font-semibold bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30";
const TAG_EMERALD =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-[10px] uppercase font-semibold bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30";
const TAG_ROSE =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-[10px] uppercase font-semibold bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30";

/** Espejo obligatorio entre la píldora de la fila (SetterView) y el header de la ficha (ContactDrawer) — un solo mapa de color. */
export const TAG_CLS_BY_TONE: Record<SetterTagTone, string> = {
  source: TAG_SOURCE,
  cyan: TAG_CYAN,
  violet: TAG_VIOLET,
  amber: TAG_AMBER,
  emerald: TAG_EMERALD,
  rose: TAG_ROSE,
};

export interface SetterContact {
  name: string;
  phone: string;
  /** Sin definir = "-" (sin calificación aún), regla 7 de §4 — nunca se inventa. */
  grade?: Grade;
  /** Chip de fuente: "Meta Ads" / "VSL opt-in" / "📷 IG Profile" / "Directo". */
  fuente: string;
  /** IG no tiene bot (§11) — deriva `hasBot` en la ficha. */
  canal: Canal;
  stage: SetterStageKey;
  situacion: string;
  situacionTone: SetterTagTone;
  subtitle: string;
  overdue?: string;
  botPrefix?: boolean;
  /** Sin definir = "activo" por defecto si el canal tiene bot (regla A del toggle). */
  botEstado?: BotEstado;
  seguimientoAutomaticoActivo?: boolean;
  monto?: number;
  agendaFecha?: string;
  /** Presencia = la sala del Meet ya existe (§ auditoría íconos, 2026-07-10) — enciende 📹. `agendaFecha` sin esto = cita (📅) sin sala todavía. */
  agendaMeetUrl?: string;
  /** "Pausado por fallo" (banner rojo + gating) — presencia = Intervenciones Urgentes en Mi Día. */
  /**
   * contactId de GHL cuando el contacto es REAL (ej. un urgente detectado por el analizador),
   * no de la semilla demo. Habilita traer su conversación real en el tab Chat.
   */
  ghlContactId?: string;
  urgente?: { detail: string };
  /** Presencia = Conversaciones Estancadas en Mi Día (§13: sin avance >6h). */
  estancada?: { microtext: string };
  /** Presencia = Oportunidades Low-Ticket en Mi Día. */
  oportunidadLt?: { microtext: string };
  /** Presencia = Buzón General / Respondieron en Mi Día. */
  respondido?: { microtext: string };
  /** Presencia = Seguimientos en Mi Día (distinto del stage macro, igual que en Closer §18). */
  seguimientoPendiente?: { microtext: string; vencido?: boolean };
  completedToday?: boolean;
  /** "Mantener" activo (§ ciclo de vida de tareas, 2026-07-11) — igual que en Closer: fija la tarea arriba de su sección en vez de completarla al responder. */
  pinned?: boolean;
  /**
   * § correcciones dashboards (2026-07-11) — "latch" de atribución: se enciende con la PRIMERA
   * intervención manual del setter (responder, resolver, fijar/completar, tocar el bot, Avanzar)
   * y ya no se apaga. Determina si una agenda/venta futura de este contacto cuenta como trabajo
   * del setter (diferida) o del sistema (hands-off), sin importar quién cierre al final.
   */
  atribucionSetter?: boolean;
  historial: HistorialItem[];
  notas: NotaItem[];
  /** Tab Llamadas — cronológico, más recientes primero. Ausente/vacío → estado vacío ("Sin registro de llamadas"). */
  llamadas?: CallRecord[];
  /** Tab Perfil — campos reales agrupados por significado, no por rol/formulario. Ausente/vacío → estado vacío. */
  perfil?: PerfilField[];
}

export interface SetterAdvanceInput {
  stage: SetterStageKey;
  pildora: string;
  situacionTone: SetterTagTone;
  texto: string;
  monto?: number;
  nota?: string;
  seguimientoAutomaticoActivo?: boolean;
  agendaFecha?: string;
  /** Lo que el backend necesita y hasta el 2026-08-08 se descartaba en el drawer. */
  subcategoria?: string;
  situacionSlug?: string;
  modo?: string;
  preset?: string;
  fechaPersonalizada?: string;
  idempotencyKey?: string;
}

/**
 * De la etapa a la salida del Avanzar.
 *
 * Es 1:1 con el campo `stage` del catálogo (`RESULTADOS_SETTER`), invertido. Se deriva acá en vez
 * de hacer que el drawer arrastre la clave por tres componentes: el mapeo es una propiedad del
 * catálogo, no un dato que la UI tenga que llevar de la mano.
 */
const RESULTADO_POR_ETAPA: Record<SetterStageKey, string | null> = {
  agendado: "agendo",
  low_ticket_ofrecido: "venta_lt",
  en_calificacion: "seguimiento",
  descalificado: "no_califica",
  nurture: "nurture",
  // Ninguna salida del Avanzar lleva a estas dos: son etapas de entrada, no de resultado.
  nuevo: null,
  calificado_sin_agendar: null,
};

const seedHist = (): HistorialItem[] => [
  { fecha: "8 jul, 10:05", texto: "Respondió al mensaje de calificación", autor: "Sistema" },
  { fecha: "27 Jun", texto: "Entró por Meta Ads", autor: "Sistema" },
];

/**
 * ── Vacío desde el 2026-08-08 (patrón D4) ─────────────────────────────
 *
 * Eran **25 contactos `EJEMPLO`** que sostenían el módulo entero: las seis colas, el pipeline y
 * los conteos. Cada uno traía sus banderas escritas a mano (`urgente: true`, `estancada: true`),
 * así que un contacto entraba a una cola porque alguien lo había tipeado — no porque un dato lo
 * pusiera ahí. El `"se apagó hace 11h"` era un string, no una diferencia de fechas.
 *
 * Ahora los contactos vienen de `GET /api/setter/mi-dia`, que los deriva por query desde
 * `closer_contactos`. La lista queda vacía y no se borra la función que la consume: si mañana
 * hace falta un fixture para un test, entra acá y no en producción.
 */
const SEED: Omit<SetterContact, "historial" | "notas">[] = [];

function buildSeedContacts(): Record<string, SetterContact> {
  const map: Record<string, SetterContact> = {};
  for (const c of SEED) map[c.name] = { ...c, historial: seedHist(), notas: [] };
  return map;
}

/**
 * Arma los contactos del store a partir de las seis colas que devuelve el servidor.
 *
 * ── Las banderas siguen existiendo, y ya no son un dato ───────────────
 *
 * Las vistas leen `c.urgente`, `c.estancada`, `c.oportunidadLt`… y eso no cambia: reescribirlas
 * a todas para leer colas habría sido un refactor grande y riesgoso a una semana del lanzamiento.
 * Lo que cambia es de dónde salen. Antes se tipeaban en un array; ahora se **encienden acá** a
 * partir de la cola en la que el servidor puso a cada contacto, y el servidor las derivó por
 * query. Una bandera dejó de ser una afirmación de alguien para ser el resultado de un cálculo.
 *
 * Un contacto puede estar en más de una cola —el mismo lead puede estar estancado y tener una
 * oportunidad LT— así que se acumulan sobre la misma entrada en vez de pisarse.
 */
function contactosDesdeColas(r: MiDiaSetterResponse): Record<string, SetterContact> {
  const map: Record<string, SetterContact> = {};

  const base = (c: ColaSetterContacto): SetterContact => ({
    name: c.name,
    phone: c.phone ?? "",
    fuente: c.fuente ?? "",
    canal: "whatsapp",
    stage: (c.stage as SetterStageKey) ?? "en_calificacion",
    situacion: "",
    situacionTone: "violet",
    subtitle: "",
    ghlContactId: c.contactId,
    historial: [],
    notas: [],
  });

  const tocar = (c: ColaSetterContacto): SetterContact => (map[c.name] ??= base(c));

  for (const c of r.urgentes ?? []) tocar(c).urgente = { detail: "el bot se apagó por un fallo" };
  for (const c of r.estancadas ?? []) tocar(c).estancada = { microtext: "conversación estancada" };
  for (const c of r.oportunidades ?? []) tocar(c).oportunidadLt = { microtext: "derivado a low-ticket" };

  for (const c of r.buzon ?? []) {
    const e = tocar(c);
    // El microtexto sale del dato, no de un string fijo: es cuándo escribió de verdad.
    e.respondido = { microtext: c.texto?.slice(0, 60) ?? "escribió y no le respondieron" };
  }

  for (const c of r.seguimientos ?? []) {
    const e = tocar(c);
    e.seguimientoPendiente = { microtext: c.fila?.microtext ?? "", vencido: c.fila?.vencido };
    e.seguimientoAutomaticoActivo = c.caso === "automatico_en_curso";
    if (c.situacion) e.situacion = c.situacion;
  }

  for (const c of r.completadas ?? []) {
    const e = (map[c.name] ??= {
      name: c.name, phone: "", fuente: "", canal: "whatsapp", stage: "en_calificacion",
      situacion: "", situacionTone: "violet", subtitle: c.pildora ?? "", historial: [], notas: [],
    });
    e.completedToday = true;
    if (c.pildora) e.subtitle = c.pildora;
  }

  return map;
}

interface SetterStoreValue {
  contacts: Record<string, SetterContact>;
  /** § correcciones dashboards (2026-07-11) — única fuente de los KPIs de Inicio (comisiones, agendas, show rate). */
  cockpit: SetterCockpit;
  openContactName: string | null;
  /** contactId de GHL de la ficha abierta (cuando se abrió desde un urgente real) — para su conversación real. */
  openGhlContactId: string | null;
  openContact: (name: string, ghlContactId?: string) => void;
  closeContact: () => void;
  /**
   * `Promise<void>` y no `void`: desde que persiste, esto hace una escritura de red. TypeScript
   * acepta asignar una función async a un tipo `void` —ignora el retorno— y eso la haría parecer
   * síncrona en el tipo, escondiendo que hay un `await` que alguien podría querer esperar.
   */
  advance: (name: string, input: SetterAdvanceInput) => Promise<void>;
  addNota: (name: string, texto: string) => void;
  resolveIntervention: (name: string) => void;
  setBotEstado: (name: string, estado: BotEstado, evento: string, autor?: string) => void;
  /** FIJAR (§ toast/pin, 2026-07-11): sube la tarea de Buzón/Respondieron u Oportunidad LT al tope de su sección sin completarla. */
  pinTask: (name: string) => void;
  /** Completa la tarea — automático (barra de progreso) o manual (botón de ficha). */
  completeTask: (name: string) => void;
  /** Demo: el contacto "vuelve a escribir" tras estar completado — reabre la tarea en Respondieron/Buzón. */
  reviveTask: (name: string) => void;
}

/** § ciclo de vida de tareas en Mi Día (2026-07-11) — única fuente de verdad del conteo de tareas pendientes del Setter (nav badge, header de Mi Día e Inicio). */
export interface SetterPendingTasksBreakdown {
  urgentes: number;
  estancadas: number;
  oportunidades: number;
  respondieron: number;
  seguimientosHoy: number;
  total: number;
}

export function setterPendingTasksBreakdown(contacts: Record<string, SetterContact>): SetterPendingTasksBreakdown {
  const all = Object.values(contacts);
  const urgentes = all.filter((c) => c.urgente && !c.completedToday).length;
  const estancadas = all.filter((c) => c.estancada && !c.completedToday).length;
  const oportunidades = all.filter((c) => c.oportunidadLt && !c.completedToday).length;
  const respondieron = all.filter((c) => c.respondido && !c.completedToday).length;
  const seguimientosHoy = all.filter((c) => c.seguimientoPendiente && !c.completedToday).length;
  return { urgentes, estancadas, oportunidades, respondieron, seguimientosHoy, total: urgentes + estancadas + oportunidades + respondieron + seguimientosHoy };
}

/**
 * § correcciones dashboards (2026-07-11) — cockpit del Setter, espejo del `Cockpit` de closerStore.tsx.
 * Antes cada tarjeta de Inicio tenía un valor suelto hardcodeado ($0 comisión conviviendo con $1,000
 * en diferidas, etc.) — ahora todo deriva de esta única base + los % configurados en Ajustes, igual
 * patrón que ya se usa para el cockpit del closer.
 */
interface SetterCockpitBase {
  /** $ bruto de ventas Low-Ticket ya cobradas este mes (antes de aplicar el % de comisión directa). */
  ltBruto: number;
  ltVentasCount: number;
  /** $ bruto de las ventas HT del closer originadas/rescatadas por este setter (antes de aplicar el % diferida). */
  diferidaBruto: number;
  diferidaVentasCount: number;
  /** Agendas que el bot cerró solo, sin intervención del setter — métrica del sistema, no mérito del setter. */
  agendasAutomaticas: number;
  /** Agendas que el setter generó/rescató manualmente — su mérito real (crece en vivo con cada Avanzar → Agendó). */
  agendasGeneradasBase: number;
  showRateNum: number;
  showRateDen: number;
  /** Ya confirmado coherente por Fabio (§ correcciones dashboards) — se muestra tal cual, sin recalcular vía división (evita un 79% por redondeo donde el confirmado es 78%). */
  showRatePct: number;
  /** Ídem — referencia de demo (mismo patrón que BUZON_COUNTS, §23 de CLAUDE.md): la lista real de Oportunidades LT en Mi Día es una muestra, este es el conteo total de referencia que ya está validado. */
  oportunidadesLTBase: number;
}

/**
 * El nombre del setter salía de una constante: `"Jorge Q."`. Con dos setters, el segundo veía la
 * comisión del primero. Ahora sale de la sesión — ver `cockpit`, más abajo.
 */

const SETTER_COCKPIT_BASE: SetterCockpitBase = {
  ltBruto: 500,
  ltVentasCount: 1,
  diferidaBruto: 10000,
  diferidaVentasCount: 2,
  agendasAutomaticas: 33,
  agendasGeneradasBase: 9,
  showRateNum: 33,
  showRateDen: 42,
  showRatePct: 78,
  oportunidadesLTBase: 12,
};

export interface SetterCockpit {
  /** Comisión directa: ltBruto × % LT (Ajustes). */
  comisionLT: number;
  ltVentasCount: number;
  /** Comisión diferida: diferidaBruto × % diferida (Ajustes). */
  comisionDiferida: number;
  diferidaBruto: number;
  diferidaVentasCount: number;
  /** = comisionLT + comisionDiferida — la única cifra que debe verse en el hero de Inicio. */
  comisionTotal: number;
  agendasAutomaticas: number;
  agendasGeneradas: number;
  agendasTotal: number;
  showRateNum: number;
  showRateDen: number;
  showRatePct: number;
  oportunidadesLT: number;
}

interface SetterSessionDeltas {
  ltMonto: number;
  ltCount: number;
  agendasGeneradas: number;
}

const ZERO_SETTER_DELTAS: SetterSessionDeltas = { ltMonto: 0, ltCount: 0, agendasGeneradas: 0 };

const SetterCtx = createContext<SetterStoreValue | null>(null);

export function SetterProvider({ children }: { children: React.ReactNode }) {
  /**
   * Arranca **vacío**, no con semilla. `buildSeedContacts()` sigue existiendo y devuelve `{}`
   * porque `SEED` está vacía: un módulo sin datos se ve sin datos hasta que el fetch conteste.
   */
  const [contacts, setContacts] = useState<Record<string, SetterContact>>(() => buildSeedContacts());
  /**
   * Los tres estados se distinguen (regla 2): `null` mientras carga, `{}` cuando cargó y no hay
   * nada, y `error` cuando no se pudo saber. Un módulo vacío por falta de datos y uno vacío
   * porque el backend está caído no son el mismo hecho.
   */
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">("cargando");

  const recargar = useCallback(async () => {
    const r = await fetchMiDiaSetter();
    if (!r.ok) {
      setEstado("error");
      return;
    }
    setContacts(contactosDesdeColas(r));
    setEstado("listo");
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);
  const [openContactName, setOpenContactName] = useState<string | null>(null);
  const [openGhlContactId, setOpenGhlContactId] = useState<string | null>(null);
  const [deltas, setDeltas] = useState<SetterSessionDeltas>(ZERO_SETTER_DELTAS);
  const { comisionesSetterLT, comisionesSetterDiferida } = useSettings();
  const { usuario } = useAuth();

  /**
   * Registra una de las cinco salidas. **Escribe en el servidor** desde el 2026-08-08.
   *
   * Antes era una mutación de `useState` a secas: sin fetch, sin `await`, sin manejo de error, y
   * con `autor: "Usuario Activo"` escrito a mano. El Avanzar del setter moría al refrescar, no lo
   * veía otro usuario, y no entraba a ninguna métrica.
   *
   * ── Optimista, pero con vuelta atrás ─────────────────────────────
   *
   * Se pinta el resultado enseguida —el closer hace lo mismo, y esperar medio segundo a que el
   * servidor conteste hace sentir la app rota— y después se recarga desde la base. Si el POST
   * falla, `recargar()` trae el estado real y la tarjeta vuelve a su lugar: lo que NO pasa es
   * que quede pintada como registrada una salida que el servidor rechazó.
   */
  const advance = useCallback(
    async (name: string, input: SetterAdvanceInput) => {
      const contacto = contacts[name];
      const resultado = RESULTADO_POR_ETAPA[input.stage];

      // Pintado optimista, igual que antes.
      setContacts((prev) => {
        const c = prev[name];
        if (!c) return prev;
        const historial = [{ fecha: "Hoy", texto: input.texto, autor: usuario?.nombre ?? "Vos" }, ...c.historial];
        const notas = input.nota
          ? [{ id: Date.now(), contexto: input.pildora, texto: input.nota, autor: usuario?.nombre ?? "Vos", fecha: "Hoy" }, ...c.notas]
          : c.notas;
        return {
          ...prev,
          [name]: {
            ...c,
            stage: input.stage,
            situacion: input.pildora,
            situacionTone: input.situacionTone,
            subtitle: input.pildora,
            monto: input.monto ?? c.monto,
            agendaFecha: input.agendaFecha ?? c.agendaFecha,
            seguimientoAutomaticoActivo: input.seguimientoAutomaticoActivo ?? false,
            // Toda salida saca al contacto de sus colas: ya se resolvió.
            urgente: undefined,
            estancada: undefined,
            oportunidadLt: undefined,
            respondido: undefined,
            seguimientoPendiente: undefined,
            completedToday: true,
            pinned: undefined,
            atribucionSetter: true,
            historial,
            notas,
          },
        };
      });

      /**
       * Sin `ghlContactId` no hay a quién registrarle nada. Pasa con un contacto que todavía no
       * se sincronizó: se deja el pintado optimista y no se inventa una escritura.
       */
      if (!contacto?.ghlContactId || !resultado) return;

      const r = await avanzarSetter({
        ghlContactId: contacto.ghlContactId,
        resultado,
        // La clave de idempotencia la manda el drawer; si no vino, se compone con el contacto y
        // el minuto — dos clics seguidos sobre la misma salida no duplican el registro.
        idempotencyKey: input.idempotencyKey ?? `setter:${contacto.ghlContactId}:${resultado}:${Math.floor(Date.now() / 60000)}`,
        monto: input.monto,
        nota: input.nota,
        subcategoria: input.subcategoria,
        situacion: input.situacionSlug,
        modo: input.modo,
        preset: input.preset,
        fechaPersonalizada: input.fechaPersonalizada,
        fecha: input.agendaFecha,
      });

      // Se recarga siempre: con éxito trae lo que el servidor dejó, y con error deshace el pintado.
      if (!r.ok) console.warn("[setter] el Avanzar no se pudo registrar:", r.error);
      await recargar();
    },
    [contacts, usuario, recargar],
  );

  const addNota = useCallback((name: string, texto: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c) return prev;
      return { ...prev, [name]: { ...c, notas: [{ id: Date.now(), contexto: null, texto, autor: "Usuario Activo", fecha: "Hoy" }, ...c.notas] } };
    });
  }, []);

  const resolveIntervention = useCallback((name: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c || !c.urgente) return prev;
      const historial = [
        { fecha: "Hoy", texto: "Intervención resuelta por Usuario Activo", autor: "Usuario Activo" },
        ...c.historial,
      ];
      return {
        ...prev,
        [name]: { ...c, urgente: undefined, botEstado: "activo", historial, completedToday: true, pinned: undefined, atribucionSetter: true },
      };
    });
  }, []);

  const setBotEstado = useCallback((name: string, estado: BotEstado, evento: string, autor: string = "Usuario Activo") => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c) return prev;
      const historial = [{ fecha: "Hoy", texto: evento, autor }, ...c.historial];
      // Solo un toggle MANUAL (autor real, no "Sistema") enciende el latch de atribución — la pausa automática por mensaje del sistema no es una intervención del setter.
      return { ...prev, [name]: { ...c, botEstado: estado, historial, atribucionSetter: autor !== "Sistema" ? true : c.atribucionSetter } };
    });
  }, []);

  /** § correcciones toast/pin v2 (2026-07-11): "tarea de conversación" cubre Buzón/Respondieron, Oportunidad LT, Seguimientos de hoy Y Estancadas — no solo Buzón. */
  const hasConversationTask = (c: SetterContact) => !!(c.respondido || c.oportunidadLt || c.seguimientoPendiente || c.estancada);

  /** FIJAR — puede deshacer un completado recién disparado (bug v2 #1: completar ya no espera al timer en pantalla, dispara al enviar). */
  const pinTask = useCallback((name: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c || !hasConversationTask(c)) return prev;
      return { ...prev, [name]: { ...c, pinned: true, completedToday: false, atribucionSetter: true } };
    });
  }, []);

  const completeTask = useCallback((name: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c || !hasConversationTask(c)) return prev;
      const historial = [{ fecha: "Hoy", texto: "Respondió al contacto — tarea completada", autor: "Usuario Activo" }, ...c.historial];
      return { ...prev, [name]: { ...c, pinned: false, completedToday: true, subtitle: "Respondió al contacto", historial, atribucionSetter: true } };
    });
  }, []);

  const reviveTask = useCallback((name: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c || !c.completedToday) return prev;
      const historial = [{ fecha: "Hoy", texto: "Contacto respondió — tarea reabierta", autor: "Sistema" }, ...c.historial];
      return {
        ...prev,
        [name]: { ...c, completedToday: false, pinned: false, respondido: { microtext: "escribió de nuevo · sin responder" }, historial },
      };
    });
  }, []);

  const cockpit: SetterCockpit = useMemo(() => {
    // Sin porcentaje cargado en Ajustes, 0: no hay comisión que mostrar hasta que alguien la fije.
    const yo = usuario?.nombre ?? "";
    const ltPct = (comisionesSetterLT[yo] ?? 0) / 100;
    const diferidaPct = (comisionesSetterDiferida[yo] ?? 0) / 100;
    const ltBruto = SETTER_COCKPIT_BASE.ltBruto + deltas.ltMonto;
    const diferidaBruto = SETTER_COCKPIT_BASE.diferidaBruto;
    const comisionLT = Math.round(ltBruto * ltPct);
    const comisionDiferida = Math.round(diferidaBruto * diferidaPct);
    const agendasGeneradas = SETTER_COCKPIT_BASE.agendasGeneradasBase + deltas.agendasGeneradas;
    return {
      comisionLT,
      ltVentasCount: SETTER_COCKPIT_BASE.ltVentasCount + deltas.ltCount,
      comisionDiferida,
      diferidaBruto,
      diferidaVentasCount: SETTER_COCKPIT_BASE.diferidaVentasCount,
      comisionTotal: comisionLT + comisionDiferida,
      agendasAutomaticas: SETTER_COCKPIT_BASE.agendasAutomaticas,
      agendasGeneradas,
      agendasTotal: SETTER_COCKPIT_BASE.agendasAutomaticas + agendasGeneradas,
      showRateNum: SETTER_COCKPIT_BASE.showRateNum,
      showRateDen: SETTER_COCKPIT_BASE.showRateDen,
      showRatePct: SETTER_COCKPIT_BASE.showRatePct,
      oportunidadesLT: SETTER_COCKPIT_BASE.oportunidadesLTBase,
    };
  }, [comisionesSetterLT, comisionesSetterDiferida, deltas]);

  const value: SetterStoreValue = {
    contacts,
    cockpit,
    openContactName,
    openGhlContactId,
    openContact: (name: string, ghlContactId?: string) => {
      setOpenContactName(name);
      setOpenGhlContactId(ghlContactId ?? null);
    },
    closeContact: () => {
      setOpenContactName(null);
      setOpenGhlContactId(null);
    },
    advance,
    addNota,
    resolveIntervention,
    setBotEstado,
    pinTask,
    completeTask,
    reviveTask,
  };

  return <SetterCtx.Provider value={value}>{children}</SetterCtx.Provider>;
}

export function useSetter(): SetterStoreValue {
  const ctx = useContext(SetterCtx);
  if (!ctx) throw new Error("useSetter debe usarse dentro de <SetterProvider>");
  return ctx;
}
