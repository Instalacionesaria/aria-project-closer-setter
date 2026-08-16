import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchAgentesTexto,
  fetchAjustesAgentes,
  fetchAlertasAgentes,
  registrarAjusteAgente,
  resolverAlertasDeContacto,
  type AgenteTextoMetricas,
  type AgentId,
  type AjusteAplicado,
  type AlertCategoria,
  type AlertSeveridad,
  type CasoAlerta,
  type CasoEstado,
  type PatronAlerta,
} from "./api";

/**
 * Auditoría de Agentes — el estado de la pestaña.
 *
 * ## Qué cambió el 2026-08-04 (pedido de Fabio)
 *
 * Hasta hoy este módulo era ~85% datos inventados: los 4 agentes con sus métricas, 55
 * alertas con diagnósticos y evidencias literales, y 4 filas de historial. Todo eso se fue,
 * por la misma razón por la que se fueron las semillas del closer: **con datos reales, un
 * dato inventado no es una demo, es una mentira** — y ahora la pestaña entra en pruebas.
 *
 * Lo que queda de la semilla es el CATÁLOGO (id, nombre, objetivo, descripción de los 4
 * agentes). Eso no son datos de demostración: son entidades reales del producto, y la regla
 * de §50.10 ya los eximía del prefijo EJEMPLO por eso mismo.
 *
 * ## El estado normal es "vacío", y eso obliga a distinguir tres cosas
 *
 * El auditor está en cero a propósito (su portón exige tags que hoy ningún contacto tiene,
 * ver §54). O sea que "sin datos" no es un caso raro: es lo que se va a ver durante días.
 * Por eso `estado` distingue **cargando / listo / error** y desapareció el `.catch(() => {})`
 * que había antes: con semilla era tolerable, sin semilla un backend caído se vería idéntico
 * al estado normal esperado, que es el peor error posible en esta pantalla.
 */

export type {
  AgentId,
  AlertCategoria,
  AlertSeveridad,
  CasoAlerta,
  CasoEstado,
  PatronAlerta,
  AjusteAplicado,
};

import { auditorHabilitado, MOTIVO_VOZ_BLOQUEADO } from "./auditores";

export type AgentKind = "text" | "voz";

export const CATEGORY_LABEL: Record<AlertCategoria, string> = {
  comportamiento: "Comportamiento",
  base_conocimiento: "Base de conocimiento",
  informacion_adicional: "Información adicional",
};

/* ================================================================== */
/* El catálogo — lo único que sigue siendo local                       */
/* ================================================================== */

/**
 * Quiénes son los 4 agentes. Sin métricas: acá no hay ni un número.
 *
 * `porQueNoHayAuditor` es el texto que ve el usuario en la tarjeta cuando ese agente
 * todavía no tiene quién lo audite. Vive en el catálogo y no en la vista porque el motivo
 * es distinto para cada uno y decirlo mal sería peor que no decirlo: el de setter no existe
 * por una decisión de diseño, y los de voz por falta de fuente de datos.
 */
export interface AgentCatalogo {
  id: AgentId;
  type: AgentKind;
  icon: "bot" | "phone";
  name: string;
  goal: string;
  desc: string;
  porQueNoHayAuditor: string;
}

export const AGENTS_CATALOGO: AgentCatalogo[] = [
  {
    id: "lead-flow-ai",
    type: "text",
    icon: "bot",
    name: "Lead Flow AI",
    goal: "CONVERSACIONES → AGENDA",
    desc: "Contactos sin agendar · su trabajo: llevarlos a la cita",
    porQueNoHayAuditor:
      "El auditor de pre-agenda todavía no existe. Auditar al Lead Flow con la rúbrica del closer " +
      "daría veredictos sobre un trabajo distinto, así que no se hace.",
  },
  {
    id: "appointment-flow-ai",
    type: "text",
    icon: "bot",
    name: "Appointment Flow AI",
    goal: "SHOW-UP DE SUS CITAS",
    desc: "Contactos agendados · su trabajo: asegurar que asistan",
    porQueNoHayAuditor: "",
  },
  {
    id: "lead-flow-voz",
    type: "voz",
    icon: "phone",
    name: "Lead Flow Voz",
    goal: "% LLAMADOS → CITA EN 48H",
    desc: "Llama al lead recién capturado · califica y agenda en la llamada",
    /**
     * Corregido el 2026-08-07: este texto decía que GHL no expone el audio ni la transcripción,
     * y era falso desde que existe el webhook de Assistable. `closer_llamadas.turnos` guarda la
     * transcripción entera (migración `016`) y `grabacion_url` la grabación. La fuente está
     * resuelta; lo que falta es la rúbrica de voz y una llamada contestada — las tres que
     * llegaron cayeron en buzón.
     *
     * Importa porque era un dato falso mostrado a un cliente: le decíamos que la limitación era
     * de GHL cuando la limitación es nuestra.
     */
    porQueNoHayAuditor:
      "La transcripción de las llamadas ya llega y se guarda. Lo que falta es la rúbrica de voz, " +
      "que no es la del chat con otro contexto: juzga una conversación hablada, con sus " +
      "interrupciones y sus silencios.",
  },
  {
    id: "appointment-flow-voz",
    type: "voz",
    icon: "phone",
    name: "Appointment Flow Voz",
    goal: "% CONFIRMACIONES LOGRADAS",
    desc: "Confirma la sesión · recuerda el video pre-call",
    porQueNoHayAuditor:
      "La transcripción de las llamadas ya llega y se guarda. Lo que falta es la rúbrica de voz, " +
      "que no es la del chat con otro contexto: juzga una conversación hablada, con sus " +
      "interrupciones y sus silencios.",
  },
];

/* Las métricas sembradas de los 4 agentes (`AGENTS`, con su sentiment, ops e history), las
   55 alertas de `SEED_ALERTS` con sus evidencias literales, `makeFillerAlerts` y las 4 filas
   de `SEED_ADJUSTMENTS` se ELIMINARON el 2026-08-04 (pedido de Fabio), igual que las
   semillas EJEMPLO del closer el 2026-08-01.

   `makeFillerAlerts` se borró entera en vez de quedar devolviendo `[]` como
   `buildSeedContacts()`: aquella produce una estructura legítima que quedó vacía, y esta
   existía SOLO para inflar el conteo de un grupo por encima de los casos que de verdad
   había. Conservarla vacía sería conservar la invitación a volver a usarla.

   `conMetricasReales()` se fue con ellas: existía para superponer lo medido sobre lo
   sembrado, y sin semilla no hay nada que superponer. Con ella se fueron el
   `if (analisis === 0) return agente` y el merge del sparkline por string de semana, que
   nunca acertaba porque el backend emite semanas actuales y la semilla tenía abril–julio. */

/** Un agente ya combinado: el catálogo + lo que se midió (o `null` donde no se midió nada). */
export interface AgentInfo extends AgentCatalogo {
  tieneAuditor: boolean;
  /**
   * `true` = el auditor de este agente **existe en el diseño pero está apagado a propósito**.
   *
   * Es un estado distinto de `tieneAuditor: false`, y la diferencia es lo que ve el cliente: uno
   * dice "esto todavía no lo construimos", el otro "esto está listo y decidimos no encenderlo".
   * Mostrarlos igual convierte una decisión en lo que parece un bug.
   */
  bloqueado: boolean;
  /** Verdes medidos en la ventana. `null` = todavía no hay análisis con nivel. */
  verdes: number | null;
  /** Cuántos análisis sostienen los números. 0 = el auditor no corrió sobre este agente. */
  analisis: number;
  /**
   * El denominador de `verdes`, que NO es `analisis`: una fila sin nivel (legado de la `031`) no
   * puede ser verde, y contarla ahí hunde la salud del agente con algo que nunca sumaría (`040`).
   */
  conVeredicto: number;
  metric: string | null;
  delta: { text: string; up: boolean } | null;
  subtext: string | null;
  sentiment: { positivos: number; neutrales: number; molestos: number } | null;
  ops: { value: string | null; sub?: string; label: string }[];
  history: { week: string; tasa: number | null; sentimientoPositivo: number }[];
}

/**
 * Combina catálogo + medición. **Nunca sustituye un `null` por otra cosa.**
 *
 * Es el reemplazo de `conMetricasReales`, y la diferencia es toda la tarea: aquella caía a
 * un valor inventado cuando no había medición; esta deja el `null` y la vista decide cómo
 * mostrar la ausencia.
 */
export function componerAgentes(
  catalogo: AgentCatalogo[],
  medidos: AgenteTextoMetricas[],
  conAuditor: AgentId[],
): AgentInfo[] {
  return catalogo.map((base) => {
    const m = medidos.find(
      (x) => x.id === (base.id as AgenteTextoMetricas["id"]),
    );
    const bloqueado = !auditorHabilitado(base.id);
    return {
      ...base,
      bloqueado,
      /**
       * Un agente bloqueado NO tiene auditor activo, por más que el backend lo liste. Se resuelve
       * acá y no en la vista para que no haya dos criterios de "esta tarjeta se puede abrir".
       */
      tieneAuditor: conAuditor.includes(base.id) && !bloqueado,
      verdes: m?.verdes ?? null,
      analisis: m?.analisis ?? 0,
      conVeredicto: m?.conVeredicto ?? 0,
      metric: m?.metric ?? null,
      delta: m?.delta ?? null,
      subtext: m?.subtext ?? null,
      sentiment: m?.sentiment ?? null,
      ops: m?.ops ?? [],
      history: m?.history ?? [],
    };
  });
}

/* ================================================================== */
/* Agrupamiento                                                        */
/* ================================================================== */

export interface GrupoAlerta {
  key: string;
  patron: PatronAlerta;
  casos: CasoAlerta[];
  /** `casos.length` POR CONSTRUCCIÓN. Es lo que evita que vuelva el desfase de §32.D. */
  casesCount: number;
  hayActivos: boolean;
  abierto: boolean;
  todosParcheados: boolean;
  soloResueltosPorHumano: boolean;
  /** Días desde el caso más viejo del grupo. Para ordenar la cola por antigüedad. */
  diasAbierto: number;
}

/**
 * Los casos agrupados por patrón.
 *
 * El agrupamiento se hace ACÁ y no en SQL: con `casesCount = casos.length` por
 * construcción, el conteo del grupo no puede desalinearse de la lista que se pagina, que es
 * exactamente el malentendido que documentó §32.D ("×15 casos" mostrando 2 ejemplos). En
 * SQL sería un `COUNT(*)` desacoplado de los casos que viajan.
 */
export function groupAlerts(
  patrones: PatronAlerta[],
  casos: CasoAlerta[],
  ahoraMs = Date.now(),
): GrupoAlerta[] {
  const porClave = new Map<string, CasoAlerta[]>();
  for (const c of casos) {
    const key = `${c.agenteId}::${c.errorCode}`;
    if (!porClave.has(key)) porClave.set(key, []);
    porClave.get(key)!.push(c);
  }

  return patrones.map((patron) => {
    const key = `${patron.agenteId}::${patron.errorCode}`;
    const grupo = porClave.get(key) ?? [];
    const hayActivos = grupo.some((c) => c.estado === "activo");
    const hayResueltosPorHumano = grupo.some(
      (c) => c.estado === "resuelto_por_humano",
    );
    const masViejo = grupo.reduce(
      (min, c) => Math.min(min, Date.parse(c.analizadoEl) || Infinity),
      Infinity,
    );

    return {
      key,
      patron,
      casos: grupo,
      casesCount: grupo.length,
      hayActivos,
      abierto: hayActivos || hayResueltosPorHumano,
      todosParcheados:
        grupo.length > 0 && grupo.every((c) => c.estado === "parcheado"),
      soloResueltosPorHumano: hayResueltosPorHumano && !hayActivos,
      diasAbierto: Number.isFinite(masViejo)
        ? Math.floor((ahoraMs - masViejo) / 86_400_000)
        : 0,
    };
  });
}

/* ================================================================== */
/* El provider                                                         */
/* ================================================================== */

export type EstadoCarga = "cargando" | "listo" | "error";

interface AgentAuditStoreValue {
  estado: EstadoCarga;
  errorMensaje: string | null;
  ventanaDias: number;
  agents: AgentInfo[];
  patrones: PatronAlerta[];
  casos: CasoAlerta[];
  grupos: GrupoAlerta[];
  ajustes: AjusteAplicado[];
  /** Total de análisis en la ventana, sumando todos los agentes. 0 = el auditor no corrió. */
  analisisTotales: number;
  /** Vuelve a pedir todo. Lo usa el botón "Actualizar" del header. */
  refrescar: () => Promise<void>;
  /** La primera carga, disparada por la vista al montarse. Idempotente. */
  cargarSiHaceFalta: () => Promise<void>;
  marcarGrupoResuelto: (agenteId: AgentId, errorCode: string) => Promise<void>;
  /**
   * El closer tomó la conversación a mano. Por `ghlContactId`, NUNCA por nombre: el cruce
   * por nombre venía roto desde que el closer indexa por id, y encima solo tocaba memoria.
   */
  resolverAlertasDeContacto: (ghlContactId: string | null) => Promise<void>;
}

const AgentAuditCtx = createContext<AgentAuditStoreValue | null>(null);

export function AgentAuditProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [estado, setEstado] = useState<EstadoCarga>("cargando");
  const [errorMensaje, setErrorMensaje] = useState<string | null>(null);
  const [ventanaDias, setVentanaDias] = useState(30);
  const [agents, setAgents] = useState<AgentInfo[]>(() =>
    componerAgentes(AGENTS_CATALOGO, [], []),
  );
  const [patrones, setPatrones] = useState<PatronAlerta[]>([]);
  const [casos, setCasos] = useState<CasoAlerta[]>([]);
  const [ajustes, setAjustes] = useState<AjusteAplicado[]>([]);
  const [analisisTotales, setAnalisisTotales] = useState(0);

  // `marcarGrupoResuelto` necesita los casos vigentes sin volverse a crear cada vez que
  // cambian — si dependiera de `casos`, cada refresco recrearía el callback y el `useMemo`
  // del value se invalidaría con él.
  const casosRef = useRef<CasoAlerta[]>([]);
  casosRef.current = casos;

  const cargar = useCallback(async () => {
    setEstado("cargando");
    setErrorMensaje(null);
    try {
      const [texto, alertas, hist] = await Promise.all([
        fetchAgentesTexto(),
        fetchAlertasAgentes(),
        fetchAjustesAgentes(),
      ]);
      setVentanaDias(alertas.ventanaDias);
      setAgents(
        componerAgentes(
          AGENTS_CATALOGO,
          texto.agentes,
          alertas.agentesConAuditor,
        ),
      );
      setPatrones(alertas.patrones);
      setCasos(alertas.casos);
      setAjustes(hist.ajustes);
      setAnalisisTotales(
        Object.values(alertas.analisisPorAgente).reduce(
          (a, b) => a + (b ?? 0),
          0,
        ),
      );
      setEstado("listo");
    } catch (e) {
      // Antes esto era `.catch(() => {})` y la pestaña se veía idéntica con datos falsos.
      // Ahora un backend caído se DICE: sin semilla, callarlo lo haría indistinguible del
      // estado normal ("el auditor todavía no analizó nada"), que es el peor error acá.
      setErrorMensaje((e as Error).message);
      setEstado("error");
    }
  }, []);

  /**
   * **No se carga al montar el provider.** El provider vive en `App.tsx`, o sea en TODAS las
   * sesiones, y CloserAI/SetterView lo consumen solo para `resolverAlertasDeContacto` — que
   * no necesita ningún dato cargado. Pedir las tres respuestas en cada arranque le sumaría
   * tres requests a un closer que quizá nunca abre esta pestaña.
   *
   * La carga la dispara la vista al montarse (`useCargaInicial`). `estado` arranca en
   * "cargando" para que el primer pintado no muestre el texto de vacío antes de tiempo.
   */
  const yaCargo = useRef(false);
  const cargarSiHaceFalta = useCallback(async () => {
    if (yaCargo.current) return;
    yaCargo.current = true;
    await cargar();
  }, [cargar]);

  /**
   * "Marcar grupo resuelto" — sin pintado optimista.
   *
   * Un ajuste es el registro permanente de un cambio al prompt: pintarlo antes de que el
   * servidor lo confirme es el éxito falso que prohíbe la cabecera de `api.ts`. La vista
   * deshabilita el botón mientras esto corre y muestra el error si lanza.
   */
  const marcarGrupoResuelto = useCallback(
    async (agenteId: AgentId, errorCode: string) => {
      const delGrupo = casosRef.current.filter(
        (c) =>
          c.agenteId === agenteId &&
          c.errorCode === errorCode &&
          c.estado !== "parcheado",
      );
      if (delGrupo.length === 0) return; // early-return, regla 5 del patrón del closer

      const r = await registrarAjusteAgente({
        agenteId,
        errorCode,
        casosIds: delGrupo.map((c) => c.id),
      });

      setAjustes((prev) => [r.ajuste, ...prev]); // la fila que DEVOLVIÓ el servidor, con su fecha real
      const cerrados = new Set(delGrupo.map((c) => c.id));
      setCasos((prev) =>
        prev.map((c) =>
          cerrados.has(c.id) ? { ...c, estado: "parcheado" as const } : c,
        ),
      );
    },
    [],
  );

  /**
   * Silencioso a propósito, y es la única excepción de este módulo.
   *
   * Se dispara como efecto secundario de "resolver intervención" en el Closer y el Setter,
   * donde la acción principal es otra. Un toast de error acá sobre una escritura que el
   * usuario no pidió explícitamente sería ruido; el estado real se ve al refrescar. Para el
   * Setter es hoy un no-op garantizado: su auditor no existe, así que no hay hallazgos.
   */
  const resolverAlertas = useCallback(async (ghlContactId: string | null) => {
    if (!ghlContactId) return;
    try {
      await resolverAlertasDeContacto(ghlContactId);
      setCasos((prev) =>
        prev.map((c) =>
          c.ghlContactId === ghlContactId && c.estado === "activo"
            ? { ...c, estado: "resuelto_por_humano" as const }
            : c,
        ),
      );
    } catch {
      /* La cola de urgentes ya se actualizó por su cuenta; esto se corrige al refrescar. */
    }
  }, []);

  const grupos = useMemo(() => groupAlerts(patrones, casos), [patrones, casos]);

  const value = useMemo<AgentAuditStoreValue>(
    () => ({
      estado,
      errorMensaje,
      ventanaDias,
      agents,
      patrones,
      casos,
      grupos,
      ajustes,
      analisisTotales,
      refrescar: cargar,
      cargarSiHaceFalta,
      marcarGrupoResuelto,
      resolverAlertasDeContacto: resolverAlertas,
    }),
    [
      estado,
      errorMensaje,
      ventanaDias,
      agents,
      patrones,
      casos,
      grupos,
      ajustes,
      analisisTotales,
      cargar,
      cargarSiHaceFalta,
      marcarGrupoResuelto,
      resolverAlertas,
    ],
  );

  return (
    <AgentAuditCtx.Provider value={value}>{children}</AgentAuditCtx.Provider>
  );
}

export function useAgentAudit(): AgentAuditStoreValue {
  const ctx = useContext(AgentAuditCtx);
  if (!ctx)
    throw new Error("useAgentAudit debe usarse dentro de AgentAuditProvider");
  return ctx;
}
