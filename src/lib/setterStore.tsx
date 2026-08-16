import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useMemo,
} from "react";
import {
  AUTOR_OPTIMISTA,
  notaRealAItem,
  type Grade,
  type BotEstado,
  type HistorialItem,
  type NotaItem,
  type CallRecord,
  type PerfilField,
} from "./closerStore";
import {
  avanzarSetter,
  crearNota,
  eliminarNota,
  fetchInicioSetter,
  fetchMiDiaSetter,
  fetchNotas,
  type CockpitSetter,
  type ColaSetterContacto,
  type MiDiaSetterResponse,
} from "./api";
import { useAuth } from "./authStore";
import { emitirAviso, emitirAvisos } from "./avisos";

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
export type SetterTagTone =
  "source" | "cyan" | "violet" | "amber" | "emerald" | "rose";

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
  {
    fecha: "8 jul, 10:05",
    texto: "Respondió al mensaje de calificación",
    autor: "Sistema",
  },
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
  for (const c of SEED)
    map[c.name] = { ...c, historial: seedHist(), notas: [] };
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
function contactosDesdeColas(
  r: MiDiaSetterResponse,
): Record<string, SetterContact> {
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

  const tocar = (c: ColaSetterContacto): SetterContact =>
    (map[c.name] ??= base(c));

  for (const c of r.urgentes ?? [])
    tocar(c).urgente = { detail: "el bot se apagó por un fallo" };
  for (const c of r.estancadas ?? [])
    tocar(c).estancada = { microtext: "conversación estancada" };
  for (const c of r.oportunidades ?? [])
    tocar(c).oportunidadLt = { microtext: "derivado a low-ticket" };

  for (const c of r.buzon ?? []) {
    const e = tocar(c);
    // El microtexto sale del dato, no de un string fijo: es cuándo escribió de verdad.
    e.respondido = {
      microtext: c.texto?.slice(0, 60) ?? "escribió y no le respondieron",
    };
  }

  for (const c of r.seguimientos ?? []) {
    const e = tocar(c);
    e.seguimientoPendiente = {
      microtext: c.fila?.microtext ?? "",
      vencido: c.fila?.vencido,
    };
    e.seguimientoAutomaticoActivo = c.caso === "automatico_en_curso";
    if (c.situacion) e.situacion = c.situacion;
  }

  for (const c of r.completadas ?? []) {
    const e = (map[c.name] ??= {
      name: c.name,
      phone: "",
      fuente: "",
      canal: "whatsapp",
      stage: "en_calificacion",
      situacion: "",
      situacionTone: "violet",
      subtitle: c.pildora ?? "",
      historial: [],
      notas: [],
    });
    e.completedToday = true;
    if (c.pildora) e.subtitle = c.pildora;
  }

  return map;
}

interface SetterStoreValue {
  contacts: Record<string, SetterContact>;
  /** § correcciones dashboards (2026-07-11) — única fuente de los KPIs de Inicio (comisiones, agendas, show rate). */
  /**
   * `null` mientras carga o si el servidor no contestó. La vista distingue eso de "cargó y todo
   * dio cero" — un cockpit vacío por falta de datos y uno vacío porque el backend está caído no
   * son el mismo hecho (regla 2).
   */
  cockpit: CockpitSetter | null;
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
  /** Borra una nota. Real (con `realId`) → también de `closer_notas`; optimista → solo memoria. */
  removeNota: (name: string, id: number) => void;
  resolveIntervention: (name: string) => void;
  setBotEstado: (
    name: string,
    estado: BotEstado,
    evento: string,
    autor?: string,
  ) => void;
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

export function setterPendingTasksBreakdown(
  contacts: Record<string, SetterContact>,
): SetterPendingTasksBreakdown {
  const all = Object.values(contacts);
  const urgentes = all.filter((c) => c.urgente && !c.completedToday).length;
  const estancadas = all.filter((c) => c.estancada && !c.completedToday).length;
  const oportunidades = all.filter(
    (c) => c.oportunidadLt && !c.completedToday,
  ).length;
  const respondieron = all.filter(
    (c) => c.respondido && !c.completedToday,
  ).length;
  const seguimientosHoy = all.filter(
    (c) => c.seguimientoPendiente && !c.completedToday,
  ).length;
  return {
    urgentes,
    estancadas,
    oportunidades,
    respondieron,
    seguimientosHoy,
    total:
      urgentes + estancadas + oportunidades + respondieron + seguimientosHoy,
  };
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

const ZERO_SETTER_DELTAS: SetterSessionDeltas = {
  ltMonto: 0,
  ltCount: 0,
  agendasGeneradas: 0,
};

const SetterCtx = createContext<SetterStoreValue | null>(null);

export function SetterProvider({ children }: { children: React.ReactNode }) {
  /**
   * Arranca **vacío**, no con semilla. `buildSeedContacts()` sigue existiendo y devuelve `{}`
   * porque `SEED` está vacía: un módulo sin datos se ve sin datos hasta que el fetch conteste.
   */
  const [contacts, setContacts] = useState<Record<string, SetterContact>>(() =>
    buildSeedContacts(),
  );
  /**
   * Los tres estados se distinguen (regla 2): `null` mientras carga, `{}` cuando cargó y no hay
   * nada, y `error` cuando no se pudo saber. Un módulo vacío por falta de datos y uno vacío
   * porque el backend está caído no son el mismo hecho.
   */
  const [estado, setEstado] = useState<"cargando" | "listo" | "error">(
    "cargando",
  );

  const recargar = useCallback(async () => {
    const r = await fetchMiDiaSetter();
    if (!r.ok) {
      setEstado("error");
      return;
    }
    /**
     * MERGE, no reemplazo (arreglo del 2026-08-15).
     *
     * `contactosDesdeColas()` construye cada contacto desde las colas de Mi Día, y esas colas no
     * traen notas ni historial: los arma con `notas: []`. Como `advance()` llama a `recargar()`
     * al terminar, toda nota escrita en el Avanzar se borraba de la pantalla un segundo después
     * de escribirla —y también la que se hubiera cargado del servidor al abrir la ficha—.
     *
     * Lo que se conserva es lo que Mi Día no puede saber: notas, historial, llamadas y perfil se
     * piden aparte al abrir la ficha. Todo lo demás (colas, etapa, píldoras) sí lo manda el
     * servidor y tiene que pisar: es la razón de recargar.
     */
    setContacts((prev) => {
      const frescos = contactosDesdeColas(r);
      for (const [name, c] of Object.entries(frescos)) {
        const anterior = prev[name];
        if (!anterior) continue;
        c.notas = anterior.notas;
        c.historial = anterior.historial;
        if (anterior.llamadas) c.llamadas = anterior.llamadas;
        if (anterior.perfil) c.perfil = anterior.perfil;
      }
      return frescos;
    });
    setEstado("listo");
  }, []);

  /**
   * Espejo síncrono de `contacts`, igual que en closerStore y por el mismo motivo: los efectos de
   * red NUNCA se disparan dentro de un updater de `setContacts`. Leer el `ghlContactId` ahí
   * adentro y usarlo afuera falla cuando React difiere el updater, y el POST no sale.
   */
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;

  useEffect(() => {
    void recargar();
  }, [recargar]);
  const [openContactName, setOpenContactName] = useState<string | null>(null);
  const [openGhlContactId, setOpenGhlContactId] = useState<string | null>(null);
  const [deltas, setDeltas] = useState<SetterSessionDeltas>(ZERO_SETTER_DELTAS);
  const { usuario } = useAuth();
  /**
   * Espejo síncrono de la sesión, por lo mismo que `contactsRef`: `addNota` no puede depender de
   * `usuario` sin recrearse en cada login, y una nota tiene que ir firmada con quien la escribió
   * —no con un literal— porque el autor viaja a `closer_notas` y lo lee el otro rol.
   */
  const usuarioRef = useRef(usuario);
  usuarioRef.current = usuario;

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
        const historial = [
          { fecha: "Hoy", texto: input.texto, autor: usuario?.nombre ?? "Vos" },
          ...c.historial,
        ];
        const notas = input.nota
          ? [
              {
                id: Date.now(),
                contexto: input.pildora,
                texto: input.nota,
                autor: usuario?.nombre ?? "Vos",
                fecha: "Hoy",
              },
              ...c.notas,
            ]
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
            seguimientoAutomaticoActivo:
              input.seguimientoAutomaticoActivo ?? false,
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

      /**
       * `try` porque `avanzarSetter` LANZA: `pedir()` de `api.ts` convierte cualquier 4xx/5xx en
       * una excepción. El `if (!r.ok)` de abajo era inalcanzable —en el camino de error nunca se
       * llegaba a él— y la excepción escapaba de un `advance()` que nadie espera: promesa
       * rechazada sin dueño, `recargar()` sin correr y el pintado optimista quedándose en
       * pantalla como si el Avanzar hubiera entrado.
       */
      try {
        const r = await avanzarSetter({
          ghlContactId: contacto.ghlContactId,
          resultado,
          // La clave de idempotencia la manda el drawer; si no vino, se compone con el contacto y
          // el minuto — dos clics seguidos sobre la misma salida no duplican el registro.
          idempotencyKey:
            input.idempotencyKey ??
            `setter:${contacto.ghlContactId}:${resultado}:${Math.floor(Date.now() / 60000)}`,
          monto: input.monto,
          nota: input.nota,
          subcategoria: input.subcategoria,
          situacion: input.situacionSlug,
          modo: input.modo,
          preset: input.preset,
          fechaPersonalizada: input.fechaPersonalizada,
          fecha: input.agendaFecha,
        });
        // Quedó registrado, pero algo accesorio pudo fallar — la nota, típicamente. El backend
        // lo dice en `advertencias` y acá se publica: el toast de éxito ya salió.
        if (Array.isArray(r?.advertencias)) {
          emitirAvisos(r.advertencias as string[]);
        }
      } catch (e) {
        console.error("[setter] el Avanzar no se pudo registrar:", e);
        emitirAviso(
          e instanceof Error && e.message
            ? e.message
            : "El resultado no se pudo registrar. Revisá la conexión y volvé a intentarlo.",
        );
      }

      // Se recarga SIEMPRE, incluso tras el fallo: con éxito trae lo que el servidor dejó, y con
      // error deshace el pintado optimista en vez de dejar una tarjeta en la columna equivocada.
      await recargar();
    },
    [contacts, usuario, recargar],
  );

  /**
   * Agrega una nota. Optimista en pantalla y PERSISTIDA si el contacto es real.
   *
   * Hasta el 2026-08-15 esto era `setContacts` a secas: sin fetch, sin `await` y sin manejo de
   * error. La nota se pintaba, el usuario la daba por guardada, y desaparecía en cuanto
   * `recargar()` reconstruía los contactos desde las colas. En la base no quedaba nada: el
   * setter no le hablaba a `/api/closer/notas` por ninguna vía (ese endpoint acepta los dos
   * roles desde que existe — lo que faltaba era llamarlo).
   *
   * Es el mismo cuerpo que `closerStore.addNota`, y a propósito: son la misma acción sobre la
   * misma tabla. Lo único distinto es que acá el mapa se indexa por nombre y allá por id.
   */
  const addNota = useCallback((name: string, texto: string) => {
    // Del espejo síncrono, no de dentro del updater. Ver contactsRef.
    const ghlContactId = contactsRef.current[name]?.ghlContactId;
    const autor = usuarioRef.current?.nombre ?? AUTOR_OPTIMISTA;

    setContacts((prev) => {
      const c = prev[name];
      if (!c) return prev;
      return {
        ...prev,
        [name]: {
          ...c,
          notas: [
            { id: Date.now(), contexto: null, texto, autor, fecha: "Hoy" },
            ...c.notas,
          ],
        },
      };
    });

    if (!ghlContactId) return; // contacto sin sincronizar: se queda en memoria, no se inventa una escritura

    crearNota({ ghlContactId, texto })
      .then((r) => {
        // La optimista se reemplaza por la fila REAL: id y fecha de la base, no del browser.
        setContacts((prev) => {
          const c = prev[name];
          if (!c || !r?.nota) return prev;
          const sinOptimista = c.notas.filter(
            (n) => !(n.texto === texto && n.fecha === "Hoy"),
          );
          return {
            ...prev,
            [name]: { ...c, notas: [notaRealAItem(r.nota), ...sinOptimista] },
          };
        });
      })
      .catch((e) => {
        // Se marca en pantalla en vez de dejarla como si estuviera guardada: una nota que el
        // setter cree escrita y no existe es peor que un error visible (regla 2).
        console.error("La nota no se guardó:", e);
        setContacts((prev) => {
          const c = prev[name];
          if (!c) return prev;
          return {
            ...prev,
            [name]: {
              ...c,
              notas: c.notas.map((n) =>
                n.texto === texto && n.fecha === "Hoy"
                  ? { ...n, fecha: "⚠ no se guardó" }
                  : n,
              ),
            },
          };
        });
      });
  }, []);

  /**
   * Borra UNA nota. Optimista; si es real también sale de `closer_notas`, y si ese DELETE falla
   * se re-piden las notas para que la pantalla vuelva a la verdad en vez de mentir que borró.
   */
  const removeNota = useCallback((name: string, id: number) => {
    const c = contactsRef.current[name];
    if (!c) return;
    const nota = c.notas.find((n) => n.id === id);
    if (!nota) return;

    setContacts((prev) => {
      const actual = prev[name];
      if (!actual) return prev;
      return {
        ...prev,
        [name]: { ...actual, notas: actual.notas.filter((n) => n.id !== id) },
      };
    });

    if (!nota.realId || !c.ghlContactId) return; // optimista: solo memoria

    const ghlContactId = c.ghlContactId;
    eliminarNota(nota.realId).catch((e) => {
      console.error("La nota no se pudo borrar:", e);
      fetchNotas(ghlContactId)
        .then((r) =>
          setContacts((prev) => {
            const actual = prev[name];
            if (!actual) return prev;
            return {
              ...prev,
              [name]: { ...actual, notas: (r.notas ?? []).map(notaRealAItem) },
            };
          }),
        )
        .catch(() => {
          /* backend caído: no hay verdad que restaurar */
        });
    });
  }, []);

  const resolveIntervention = useCallback((name: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c || !c.urgente) return prev;
      const historial = [
        {
          fecha: "Hoy",
          texto: "Intervención resuelta por Usuario Activo",
          autor: "Usuario Activo",
        },
        ...c.historial,
      ];
      return {
        ...prev,
        [name]: {
          ...c,
          urgente: undefined,
          botEstado: "activo",
          historial,
          completedToday: true,
          pinned: undefined,
          atribucionSetter: true,
        },
      };
    });
  }, []);

  const setBotEstado = useCallback(
    (
      name: string,
      estado: BotEstado,
      evento: string,
      autor: string = "Usuario Activo",
    ) => {
      setContacts((prev) => {
        const c = prev[name];
        if (!c) return prev;
        const historial = [
          { fecha: "Hoy", texto: evento, autor },
          ...c.historial,
        ];
        // Solo un toggle MANUAL (autor real, no "Sistema") enciende el latch de atribución — la pausa automática por mensaje del sistema no es una intervención del setter.
        return {
          ...prev,
          [name]: {
            ...c,
            botEstado: estado,
            historial,
            atribucionSetter: autor !== "Sistema" ? true : c.atribucionSetter,
          },
        };
      });
    },
    [],
  );

  /** § correcciones toast/pin v2 (2026-07-11): "tarea de conversación" cubre Buzón/Respondieron, Oportunidad LT, Seguimientos de hoy Y Estancadas — no solo Buzón. */
  const hasConversationTask = (c: SetterContact) =>
    !!(
      c.respondido ||
      c.oportunidadLt ||
      c.seguimientoPendiente ||
      c.estancada
    );

  /** FIJAR — puede deshacer un completado recién disparado (bug v2 #1: completar ya no espera al timer en pantalla, dispara al enviar). */
  const pinTask = useCallback((name: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c || !hasConversationTask(c)) return prev;
      return {
        ...prev,
        [name]: {
          ...c,
          pinned: true,
          completedToday: false,
          atribucionSetter: true,
        },
      };
    });
  }, []);

  const completeTask = useCallback((name: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c || !hasConversationTask(c)) return prev;
      const historial = [
        {
          fecha: "Hoy",
          texto: "Respondió al contacto — tarea completada",
          autor: "Usuario Activo",
        },
        ...c.historial,
      ];
      return {
        ...prev,
        [name]: {
          ...c,
          pinned: false,
          completedToday: true,
          subtitle: "Respondió al contacto",
          historial,
          atribucionSetter: true,
        },
      };
    });
  }, []);

  const reviveTask = useCallback((name: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c || !c.completedToday) return prev;
      const historial = [
        {
          fecha: "Hoy",
          texto: "Contacto respondió — tarea reabierta",
          autor: "Sistema",
        },
        ...c.historial,
      ];
      return {
        ...prev,
        [name]: {
          ...c,
          completedToday: false,
          pinned: false,
          respondido: { microtext: "escribió de nuevo · sin responder" },
          historial,
        },
      };
    });
  }, []);

  /**
   * ── El cockpit lo calcula el SERVIDOR (2026-08-08) ─────────────────
   *
   * `SETTER_COCKPIT_BASE` eran **diez constantes** —`ltBruto: 500`, `diferidaBruto: 10000`,
   * `agendasAutomaticas: 33`, `showRatePct: 78`…— y de las cifras que el cockpit mostraba solo
   * tres tenían aritmética, las tres multiplicando una base fija. El hero de comisiones era un
   * porcentaje configurable aplicado sobre un número inventado.
   *
   * Ahora sale de `/api/setter/inicio`, que lo calcula con las ventas reales del período y el %
   * de `closer_comisiones`. Los que todavía no se pueden medir —el show-rate, las agendas
   * automáticas— viajan en `sinDato` con su motivo, y la vista los muestra como pendientes en vez
   * de mostrar un número.
   */
  const [cockpit, setCockpit] = useState<CockpitSetter | null>(null);

  /**
   * Las notas REALES al abrir la ficha de un contacto.
   *
   * Sin esto el tab Notas del setter mostraba solo lo escrito en esta sesión: las filas de
   * `closer_notas` existían —las escribe el Avanzar— y nadie las leía. Espejo del efecto de
   * closerStore, con una diferencia obligada: acá el mapa se indexa por NOMBRE, así que se
   * necesitan los dos (el nombre para escribir en el mapa, el id para pedirle al servidor).
   *
   * Una sola vez por apertura, sin reloj: una nota la escribe el propio setter y ya la tiene en
   * pantalla.
   */
  useEffect(() => {
    if (!openGhlContactId || !openContactName) return;
    const name = openContactName;
    let vivo = true;

    fetchNotas(openGhlContactId)
      .then((r) => {
        if (!vivo) return;
        setContacts((prev) => {
          const c = prev[name];
          if (!c) return prev;
          const delServidor = (r.notas ?? []).map(notaRealAItem);
          const enServidor = new Set(delServidor.map((n) => n.texto));
          // MERGE: una nota escrita mientras este GET estaba en vuelo no se pisa — el POST sigue
          // su curso y borrarla de la pantalla la haría parecer perdida.
          const optimistas = c.notas.filter(
            (n) =>
              (n.fecha === "Hoy" || n.fecha.startsWith("⚠")) &&
              !enServidor.has(n.texto),
          );
          return {
            ...prev,
            [name]: { ...c, notas: [...optimistas, ...delServidor] },
          };
        });
      })
      .catch(() => {
        /* backend caído: se conserva lo que hubiera en memoria, no se inventa nada */
      });

    return () => {
      vivo = false;
    };
  }, [openGhlContactId, openContactName]);

  const recargarCockpit = useCallback(async () => {
    const r = await fetchInicioSetter();
    if (r.ok && r.cockpit) setCockpit(r.cockpit);
  }, []);

  useEffect(() => {
    void recargarCockpit();
  }, [recargarCockpit]);

  const value: SetterStoreValue = {
    contacts,
    cockpit,
    openContactName,
    openGhlContactId,
    openContact: (name: string, ghlContactId?: string) => {
      setOpenContactName(name);
      setOpenGhlContactId(ghlContactId ?? null);
      /**
       * Si el contacto no está en el mapa, se siembra (arreglo del 2026-08-15).
       *
       * `contacts` se arma con las colas de Mi Día, y el Pipeline lista OTRA consulta: un lead
       * que ya no tiene tarea de hoy aparece en el Pipeline y no en el mapa. La vista resuelve
       * `contacts[openContactName] ?? null`, así que su ficha abría con `setterContact = null` —
       * y sobre null, `addNota` no pintaba nada NI llamaba al servidor: la nota se perdía sin
       * dejar rastro ni error. Con la entrada mínima, la ficha tiene dónde escribir y el efecto
       * de apertura le trae sus notas reales.
       */
      if (!ghlContactId) return;
      setContacts((prev) =>
        prev[name]
          ? prev
          : {
              ...prev,
              [name]: {
                name,
                phone: "",
                fuente: "",
                canal: "whatsapp",
                stage: "en_calificacion",
                situacion: "",
                situacionTone: "violet",
                subtitle: "",
                ghlContactId,
                historial: [],
                notas: [],
              },
            },
      );
    },
    closeContact: () => {
      setOpenContactName(null);
      setOpenGhlContactId(null);
    },
    advance,
    addNota,
    removeNota,
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
