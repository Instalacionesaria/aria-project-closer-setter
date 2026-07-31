import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  House,
  LayoutList,
  SquareKanban,
  Calendar,
  PhoneCall,
  CirclePause,
  MessageCircle,
  RefreshCw,
  Video,
  Phone,
  Bot,
  AlarmClock,
  DollarSign,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pin,
  Plus,
  Search,
  Users,
  Target,
  Star,
  MoreHorizontal,
  Clock,
  Tag,
  TrendingUp,
  Zap,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { cn } from "../lib/utils";
import { fetchAgendaHoy, fetchAgendaRange, fetchRespondieron, type AgendaAppointment } from "../lib/api";
import ContactDrawer from "./ContactDrawer";

/** Cada cuánto se re-consulta la agenda a GHL mientras la vista está abierta (polling, hasta tener tiempo real). */
const AGENDA_POLL_MS = 10_000;
import {
  useClosurer,
  STAGE_META,
  STAGE_ORDER,
  botIconVisual,
  countCallsContestadas,
  countSalesCalls,
  pendingTasksBreakdown,
  type Grade,
  type ClosurerContact,
  type BotEstado,
  type CallRecord,
  type StageKey,
} from "../lib/closerStore";
import { useSettings } from "../lib/settingsStore";
import { useAgentAudit } from "../lib/agentAuditStore";

const money = (n: number) => `$${n.toLocaleString("es-AR")}`;

/** Desenlace de "Avanzar" (tag GHL) → píldora del Buzón: color (vía stage) + texto + estado del bot.
 *
 * Este mapa deriva la píldora SOLO del tag, que es el único dato que trae hoy
 * `/api/closer/respondieron`. Por eso una venta real de GHL se lee `VENTA` a secas, sin la
 * forma de pago ni el monto que sí muestra una venta registrada desde el tool.
 *
 * No es el mismo bug que tenía el modal de Avanzar (que capturaba la forma de pago y la
 * tiraba): acá el dato sencillamente no llegó al browser. `api/_lib/contactos.ts` ya lee el
 * custom field `forma_de_pago_venta` al sincronizar, pero el endpoint del buzón no lo
 * devuelve todavía. Cuando lo haga, esto pasa a llamar `armarPildora()` con los tres campos
 * y queda un solo productor de píldoras. Mientras tanto se muestra la categoría sola en vez
 * de inventar el resto (§4.10). */
const OUTCOME_TO_PILL: Record<string, { stage: StageKey; situacion: string; bot: BotEstado }> = {
  venta_ganada: { stage: "ganado", situacion: "VENTA", bot: "muerto_postcall" },
  adelanto_ganado: { stage: "cierre", situacion: "ACORDÓ COMPRAR", bot: "muerto_postcall" },
  seguimiento: { stage: "seguimiento", situacion: "SEGUIMIENTO", bot: "muerto_postcall" },
  noshow: { stage: "no_show", situacion: "NO-SHOW", bot: "activo" }, // no-show reactiva la IA (workflow de recuperación)
  nurture_appflow: { stage: "nurture", situacion: "NURTURE", bot: "muerto_postcall" },
  descalificado: { stage: "descalificado", situacion: "DESCALIFICADO", bot: "muerto_postcall" },
};

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type TabKey = "inicio" | "midia" | "pipeline" | "agenda";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const gradeAvatar: Record<Grade, string> = {
  A: "bg-emerald-500/10 text-emerald-600",
  B: "bg-amber-500/10 text-amber-600",
  C: "bg-rose-500/10 text-rose-600",
  D: "bg-rose-500/10 text-rose-600",
};

/**
 * Score sin datos → "—" en gris, nunca una letra inventada (§4.7 / §4.10). Pasa con los
 * contactos que llegan de GHL sin calificación: el motor todavía no los evaluó.
 */
function Avatar({ grade }: { grade?: Grade }) {
  return (
    <div
      className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
        grade ? gradeAvatar[grade] : "bg-muted text-muted-foreground",
      )}
    >
      {grade ?? "—"}
    </div>
  );
}

/** Columna de ancho fijo para cada ícono de estado — garantiza que todas las filas alineen entre sí, aunque un slot (ej. 📞 "2✗") sea más ancho que un ícono suelto. */
function IconSlot({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={cn("flex items-center justify-center shrink-0", wide ? "w-7" : "w-3.5")}>{children}</div>;
}

/**
 * 📞 con contador de llamadas de IA contestadas — regla de oro: 0 = icono atenuado, sin número.
 * Derivado de `contact.llamadas` (§ auditoría íconos, 2026-07-10) — nunca un campo seteado a mano.
 * Cuenta ÚNICAMENTE Lead Flow Voz + App Flow Voz; las sales calls jamás suman aquí (regla de la spec).
 */
function CallsBadge({ llamadas }: { llamadas?: CallRecord[] }) {
  const count = countCallsContestadas(llamadas);
  if (count === 0) {
    return <Phone className="w-3.5 h-3.5 text-[#6b6980]/25 shrink-0" />;
  }
  return (
    <span className="flex items-center gap-0.5 text-[11px] font-semibold shrink-0 text-[#6b6980]">
      <Phone className="w-3.5 h-3.5" />
      {count}✓
    </span>
  );
}

/**
 * 📹 con contador de llamadas/reuniones con el closer (2026-07-11) — reemplaza al viejo flag 🎙
 * y a la derivación por `agenda.meetUrl`. Mismo patrón que `CallsBadge`: 0 = ícono atenuado sin número.
 */
function VideoCallBadge({ llamadas }: { llamadas?: CallRecord[] }) {
  const count = countSalesCalls(llamadas);
  if (count === 0) {
    return <Video className="w-3.5 h-3.5 text-[#6b6980]/25 shrink-0" />;
  }
  return (
    <span className="flex items-center gap-0.5 text-[11px] font-semibold shrink-0 text-[#6b6980]">
      <Video className="w-3.5 h-3.5" />
      {count}
    </span>
  );
}

/** 🤖 — misma fuente de verdad que el toggle del compositor (botIconVisual, regla D.7). "LT" = derivado a low-ticket. */
function BotIcon({ estado }: { estado?: BotEstado }) {
  const v = botIconVisual(estado);
  if (v.label) {
    return (
      <span className={cn("flex items-center gap-0.5 text-[11px] font-semibold shrink-0", v.className)} title={v.title}>
        <Bot className="w-3.5 h-3.5" />
        {v.label}
      </span>
    );
  }
  return (
    <span className="flex items-center shrink-0" title={v.title}>
      <Bot className={cn("w-3.5 h-3.5", v.className)} />
    </span>
  );
}

/**
 * Fila de contacto de Mi Día — estructura inquebrantable compartida por
 * Urgentes / Respondieron / Seguimientos: Score · Nombre · Fuente · Píldora ·
 * microtexto de evento real · iconos de estado · chevron.
 */
function MiDiaRow({
  c,
  onOpen,
  microtext,
  microClass,
  prefix,
  badge,
  highlighted,
  completed = false,
}: {
  c: ClosurerContact;
  onOpen: (name: string, ghlContactId?: string) => void;
  microtext: string;
  microClass?: string;
  /** Ej. "Falla detectada por IA:" en Urgentes. */
  prefix?: string;
  /** Ej. "Abierta hace 767 días" en Urgentes. */
  badge?: string;
  highlighted?: boolean;
  /** Completadas Hoy: fila atenuada + nombre tachado, pero fuente/píldora/iconos SIGUEN visibles (regla de Francisco, 2026-07-10). */
  completed?: boolean;
}) {
  const pinned = !completed && c.pinned;
  return (
    <div
      onClick={() => onOpen(c.name, c.ghlContactId)}
      className={cn(
        "flex items-center justify-between gap-4 px-6 py-4 cursor-pointer transition-colors group",
        highlighted
          ? "bg-rose-500/5 hover:bg-rose-500/10 border-l-2 border-rose-500"
          : pinned
            ? "bg-amber-500/5 hover:bg-amber-500/10 border-l-2 border-amber-400"
            : "hover:bg-muted/30",
        completed && "opacity-75 hover:opacity-100",
      )}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Avatar grade={c.grade} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className={cn(
                "font-medium text-sm truncate group-hover:text-primary transition-colors flex items-center gap-1.5",
                completed && "line-through decoration-muted-foreground/60 text-muted-foreground",
              )}
            >
              {c.name}
              {pinned && <Pin className="w-3 h-3 text-amber-500 shrink-0" />}
            </span>
            {pinned && (
              <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 shrink-0">
                <Clock className="w-2.5 h-2.5" /> Le debes respuesta
              </span>
            )}
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 shrink-0">
              {c.fuente ?? "DIRECTO"}
            </span>
            <span
              className={cn(
                "text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border shrink-0",
                completed ? "bg-muted text-muted-foreground border-border" : STAGE_META[c.stage].pill,
              )}
            >
              {c.situacion}
            </span>
          </div>
          <p className={cn("text-xs truncate max-w-[420px]", microClass ?? "text-muted-foreground")}>
            {prefix && <span className="font-semibold text-foreground/70">{prefix} </span>}
            {microtext}
            {badge && (
              <span className="ml-2 font-bold uppercase tracking-wider text-[10px] bg-rose-500/20 px-1.5 py-0.5 rounded-sm">
                {badge}
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <IconSlot wide>
            <VideoCallBadge llamadas={c.llamadas} />
          </IconSlot>
          <IconSlot>
            <Calendar
              className={cn("w-3.5 h-3.5", c.agenda ? "text-[#6b6980]" : "text-[#6b6980]/25")}
            />
          </IconSlot>
          <IconSlot wide>
            <CallsBadge llamadas={c.llamadas} />
          </IconSlot>
          <IconSlot wide>
            <BotIcon estado={c.botEstado} />
          </IconSlot>
          <IconSlot>
            <AlarmClock
              className={cn("w-3.5 h-3.5", c.seguimientoAutomaticoActivo ? "text-[#6b6980]" : "text-[#6b6980]/25")}
            />
          </IconSlot>
          <IconSlot>
            <DollarSign
              className={cn("w-3.5 h-3.5", c.stage === "ganado" ? "text-emerald-600 dark:text-emerald-400" : "text-[#6b6980]/25")}
            />
          </IconSlot>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header + tab bar                                                    */
/* ------------------------------------------------------------------ */

const TABS: Array<{ key: TabKey; label: string; icon: LucideIcon }> = [
  { key: "inicio", label: "Inicio", icon: House },
  { key: "midia", label: "Mi Día", icon: LayoutList },
  { key: "pipeline", label: "Pipeline", icon: SquareKanban },
  { key: "agenda", label: "Agenda", icon: Calendar },
];

/**
 * § ciclo de vida de tareas en Mi Día (2026-07-11): el badge de "Mi Día" del nav, el header de
 * Mi Día y el puente de Inicio deben derivar del MISMO `pendingTasksBreakdown()` — antes cada uno
 * tenía su propia fórmula (nav: "7" hardcodeado; Inicio: "28" hardcodeado + "11 espera" hardcodeado;
 * Mi Día: fórmula real pero nunca comparada con las otras dos) y mostraban 3 números distintos.
 */
function Header({ tab, setTab }: { tab: TabKey; setTab: (t: TabKey) => void }) {
  const { contacts } = useClosurer();
  const { total: midiaBadge } = pendingTasksBreakdown(contacts);
  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-8 border-b border-border/30">
      <div>
        <p className="text-[10px] font-bold tracking-[0.2em] text-primary uppercase mb-2 opacity-80">
          CLOSER AI • DIEGO M.
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {tab === "inicio" && "Tu cockpit"}
          {tab === "midia" && (
            <span className="font-light">
              Mi Día —{" "}
              <span className="text-muted-foreground">miércoles, 8 de julio</span>
            </span>
          )}
          {tab === "pipeline" && "Pipeline"}
          {tab === "agenda" && "Agenda & Llamadas"}
        </h1>
      </div>
      <div className="flex items-center gap-3 pr-14 lg:pr-0">
        <div className="flex items-center gap-1.5 bg-card border border-border/40 rounded-full p-1.5 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.05)]">
          {TABS.map(({ key, label, icon: Icon }) => {
            const active = tab === key;
            const badge = key === "midia" && midiaBadge > 0 ? String(midiaBadge) : undefined;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "inline-flex items-center justify-center gap-2 whitespace-nowrap ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 rounded-full px-5 h-9 text-xs font-medium transition-all",
                  active
                    ? "hover:bg-accent hover:text-accent-foreground bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                <Icon className="w-4 h-4 mr-2" />
                {label}
                {badge && (
                  <span
                    className={cn(
                      "ml-2 px-1.5 py-0.5 rounded-full text-[10px]",
                      active ? "bg-primary-foreground/20" : "bg-primary/10 text-primary",
                    )}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* INICIO — cockpit                                                    */
/* ================================================================== */

const RING_ANIM_DURATION = 1.8;

/**
 * Contador animado (§ Anillo Dorado / Cash Collected, 2026-07-11) — anima desde el valor previo
 * (o 0 en el primer render) hacia `value` cada vez que cambia, ej. al montar el dashboard o al
 * registrar una venta nueva. Sincronizado en duración con `GoldRing` para que ambos "terminen de
 * cargar" al mismo tiempo.
 */
function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const motionVal = useMotionValue(0);
  const display = useTransform(motionVal, (v) => format(Math.round(v)));
  useEffect(() => {
    const controls = animate(motionVal, value, { duration: RING_ANIM_DURATION, ease: "easeOut" });
    return () => controls.stop();
  }, [value]);
  return <motion.span>{display}</motion.span>;
}

/**
 * Anillo dorado de progreso hacia la meta mensual — real, no decorativo: el trazo dorado se anima
 * (stroke-dashoffset) desde "vacío" hasta el % logrado (tope visual 100%, aunque el texto del centro
 * puede superar el 100% si la meta ya se superó). `percentage` ya debe venir capado por el caller.
 */
function GoldRing({ percentage }: { percentage: number }) {
  const r = 46;
  const circumference = 2 * Math.PI * r;
  const targetOffset = circumference - (percentage / 100) * circumference;
  const offset = useMotionValue(circumference);
  useEffect(() => {
    const controls = animate(offset, targetOffset, { duration: RING_ANIM_DURATION, ease: "easeOut" });
    return () => controls.stop();
  }, [targetOffset]);
  return (
    <svg className="w-full h-full transform -rotate-90 relative z-10" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="2" />
      <motion.circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="url(#gold-gradient)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        style={{ strokeDashoffset: offset }}
      />
      <defs>
        <linearGradient id="gold-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFE5A3" />
          <stop offset="50%" stopColor="#D4AF37" />
          <stop offset="100%" stopColor="#997A15" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/**
 * Meses anteriores del "Histórico de Ingresos" — datos de REFERENCIA, no del negocio.
 *
 * No hay de dónde sacarlos: ningún endpoint devuelve el cash collected de meses cerrados, y el
 * store solo conoce el estado de hoy. Se conservan para que el gráfico tenga forma, pero se
 * pintan distinto y la tarjeta lo dice — un dueño mirando tres barras doradas en ascenso las
 * lee como su facturación real, y acá son inventadas. Mismo criterio honesto que el
 * "Personalizado" de Gerencia (§46.E): mostrar el hueco, no disimularlo.
 */
const CHART_HIST = [
  { mes: "Abr", valor: 8500 },
  { mes: "May", valor: 17000 },
  { mes: "Jun", valor: 25500 },
];

function InicioTab({ onGoToMiDia }: { onGoToMiDia: () => void }) {
  const { cockpit, cockpitFuente, cierreEnCursoMonto, contacts } = useClosurer();
  const { miCuenta } = useSettings();
  /* El MONTO de Acuerdos viene del store (semilla + real de GHL), no se recalcula acá: esta
     vista lo sumaba por su cuenta desde los montos del store, así que ignoraba el dinero real
     de GHL y mostraba una cifra distinta a la del encabezado del Pipeline (§44). */
  const cierreEnCurso = Object.values(contacts).filter((c) => c.stage === "cierre");
  const tareas = pendingTasksBreakdown(contacts);
  /**
   * Tasa de Cierre = ventas ÷ citas ATENDIDAS (§6.A). El denominador es real: contactos con al
   * menos una `sales_call` registrada. Antes era `ventas / 40` — un 40 escrito a mano en esta
   * línea, que hacía que la tasa bajara al agregar una venta si el divisor no acompañaba.
   */
  const closeRate = cockpit.atendieron > 0 ? ((cockpit.ventas / cockpit.atendieron) * 100).toFixed(1) : null;
  /**
   * Show rate = se presentaron ÷ (se presentaron + no-show). Antes era el literal "60%" con
   * "meta 70%" al lado; la meta no existe en Ajustes, así que en su lugar va la base (§4.9).
   */
  const showBase = cockpit.atendieron + cockpit.noShow;
  const showRate = showBase > 0 ? Math.round((cockpit.atendieron / showBase) * 100) : null;
  const falta = miCuenta.metaComision - cockpit.comision;
  const avgComision = cockpit.ventas > 0 ? cockpit.comision / cockpit.ventas : 0;
  const ventasFaltantes = falta > 0 && avgComision > 0 ? Math.ceil(falta / avgComision) : 0;
  // § auditoría v2 (2026-07-11): "Meta superada" nunca debe mostrarse con comisión $0 — evita el caso
  // contradictorio (meta mal configurada en $0/negativa + comisión $0 celebrando una meta "superada").
  const metaSuperada = falta <= 0 && cockpit.comision > 0;
  // Anillo dorado (§ 2026-07-11): % real hacia la meta, capado a 100 solo para el SVG — el texto puede superar el 100%.
  const ringPercentage = miCuenta.metaComision > 0 ? Math.min((cockpit.comision / miCuenta.metaComision) * 100, 100) : 0;
  /**
   * Cada tarjeta lleva su base real, y las que no tienen dato muestran "—" en vez de un número
   * inventado (§4.10). Antes las cuatro tenían literales: "tasa X%" sobre un divisor 40,
   * "20 semanales", "meta 70%" — ninguno salía de ningún lado.
   */
  const cockpitStats = [
    {
      l: "Ventas",
      v: String(cockpit.ventas),
      s: closeRate ? `tasa ${closeRate}% · ${cockpit.ventas} de ${cockpit.atendieron}` : "sin calls atendidas aún",
    },
    { l: "Acuerdos", v: money(cierreEnCursoMonto), s: `${cierreEnCurso.length} leads` },
    {
      l: "Sales calls",
      v: cockpit.salesCalls > 0 ? String(cockpit.salesCalls) : "—",
      s: cockpit.salesCalls > 0 ? `${cockpit.atendieron} contactos atendidos` : "sin llamadas registradas",
    },
    {
      l: "Show rate",
      v: showRate !== null ? `${showRate}%` : "—",
      s: showRate !== null ? `${cockpit.atendieron} de ${showBase}` : "sin citas registradas",
    },
  ];
  const chart = [...CHART_HIST, { mes: "Jul", valor: cockpit.cashCollected }];
  const max = Math.max(...chart.map((c) => c.valor));
  const yTicks = [max, max * 0.75, max * 0.5, max * 0.25, 0].map((v) => (v === 0 ? "$0" : `$${(v / 1000).toFixed(1).replace(".0", "")}k`));
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto pb-12">
      {/* Hero negro/dorado */}
      <div className="rounded-[32px] bg-[#0a0a0a] p-8 sm:p-12 relative overflow-hidden flex flex-col justify-between border border-white/5 shadow-2xl">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] sm:w-[800px] h-[600px] sm:h-[800px] bg-[#D4AF37]/5 rounded-full blur-[80px] sm:blur-[100px] pointer-events-none animate-pulse"
          style={{ animationDuration: "4s" }}
        />
        <div className="flex flex-col md:flex-row gap-12 items-start md:items-center justify-between relative z-10">
          {/* Izquierda */}
          <div className="flex-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/10 bg-white/5 text-[#D4AF37] text-[10px] font-medium tracking-widest uppercase mb-6 backdrop-blur-md">
              <Zap className="w-3 h-3" />
              Cash Collected · JULIO
            </div>
            <div
              className="text-6xl sm:text-[90px] font-light tracking-tighter mb-6 leading-[0.9] text-transparent bg-clip-text bg-gradient-to-br from-white via-[#F5D78D] to-[#C99738]"
              style={{ filter: "drop-shadow(0 0 24px rgba(212,175,55,0.35))" }}
            >
              <AnimatedNumber value={cockpit.cashCollected} format={money} />
            </div>
            {/* El delta "▲ $5,100" se eliminó el 2026-07-31: comparaba contra un mes pasado que
                no existe en ningún dato (§4.10). En su lugar, de dónde salió esta cifra — que en
                un número de dinero conectado a GHL vale más que una flecha verde inventada. */}
            <div className="flex flex-col gap-3 text-sm text-white/60 font-light mb-10">
              <p className="flex items-center gap-2 flex-wrap">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${cockpitFuente.disponible ? "bg-green-500/80 animate-pulse" : "bg-amber-400/80"}`}
                />
                Cobrado real, no prometido
                {cockpitFuente.disponible ? (
                  <>
                    {cockpitFuente.ganadoSemilla > 0 && (
                      <>
                        <span className="text-white/20">|</span>
                        <span className="text-white/40 text-xs">
                          {money(cockpitFuente.ganadoReal)} de GHL + {money(cockpitFuente.ganadoSemilla)} de ejemplos
                        </span>
                      </>
                    )}
                    {/* Plata en la etapa GANADO de GHL que no se cuenta porque su contacto no está
                        en el territorio del closer. Se avisa en vez de sumarla (daría un total que
                        ninguna otra vista explica) y en vez de ignorarla (es una discrepancia real
                        del CRM que alguien debería ir a mirar). */}
                    {cockpitFuente.huerfanoGanado > 0 && (
                      <>
                        <span className="text-white/20">|</span>
                        <span
                          className="text-amber-300/80 text-xs"
                          title="Oportunidades en la etapa GANADO de GHL cuyo contacto no tiene el tag zona_closer, así que no aparecen en el Pipeline ni cuentan como venta."
                        >
                          {money(cockpitFuente.huerfanoGanado)} en GHL sin contacto del closer
                        </span>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <span className="text-white/20">|</span>
                    <span className="text-amber-300/90 text-xs" title={cockpitFuente.motivo}>
                      solo ejemplos — no se pudo leer GHL
                    </span>
                  </>
                )}
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-4">
              {cockpitStats.map((x) => (
                <div key={x.l} className="flex flex-col">
                  <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">{x.l}</p>
                  <p className="text-2xl font-light text-white/90">{x.v}</p>
                  <p className="text-[10px] text-white/30 mt-1">{x.s}</p>
                </div>
              ))}
            </div>
          </div>
          {/* Derecha: anillo comisión */}
          <div className="w-full md:w-72 flex flex-col items-center">
            <div className="relative w-48 h-48 flex items-center justify-center mb-6">
              <div
                className="absolute inset-0 bg-[#D4AF37]/10 rounded-full blur-xl animate-pulse"
                style={{ animationDuration: "3s" }}
              />
              <GoldRing percentage={ringPercentage} />
              <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
                <span className="text-3xl font-light text-white tracking-tight">
                  <AnimatedNumber value={cockpit.comision} format={money} />
                </span>
                <span className="text-[9px] uppercase tracking-widest text-white/40 mt-1">Comisión</span>
              </div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 w-full text-center backdrop-blur-sm">
              {!metaSuperada ? (
                <p className="text-xs font-light text-white/70 mb-1">
                  Faltan <span className="text-white font-medium">{money(Math.max(falta, 0))}</span> para meta
                </p>
              ) : (
                <p className="text-xs font-light text-white/70 mb-1">
                  Meta superada por <span className="text-white font-medium">{money(-falta)}</span>
                </p>
              )}
              <p className="text-sm font-medium text-[#D4AF37]">
                {!metaSuperada ? `≈ ${ventasFaltantes} ventas más` : "🎉 ¡Meta superada!"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 28 tareas pendientes */}
      <div
        onClick={onGoToMiDia}
        className="rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm p-4 sm:p-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 cursor-pointer hover:border-border hover:bg-card/80 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 shrink-0">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground mb-1">{tareas.total} tareas pendientes</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="text-red-500 font-medium flex items-center gap-1">
                <span className="text-sm">🔥</span> {tareas.urgentes} urgente
              </span>
              <span className="text-muted-foreground/30">•</span>
              <span className="text-blue-500 font-medium flex items-center gap-1">
                <span className="text-sm">💬</span> {tareas.respondieron} espera
              </span>
              {/* "6 calls hoy" era un literal. Ahora son los seguimientos que tocan hoy, que sí
                  vienen de `pendingTasksBreakdown` — y si son 0 el chip no se pinta (§4.1). */}
              {tareas.seguimientosHoy > 0 && (
                <>
                  <span className="text-muted-foreground/30">•</span>
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3" /> {tareas.seguimientosHoy} seguimiento
                    {tareas.seguimientosHoy === 1 ? "" : "s"} hoy
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors py-2 w-full sm:w-auto bg-foreground hover:bg-foreground/90 text-background rounded-full px-6 h-10 text-xs font-semibold tracking-wide">
          Ejecutar Mi Día
        </button>
      </div>

      {/* Histórico de Ingresos */}
      <div className="rounded-2xl border border-border/40 bg-card/50 backdrop-blur-sm p-6 shadow-sm flex flex-col">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Histórico de Ingresos</h3>
            <p className="text-[11px] text-muted-foreground">
              Julio es real · abril a junio son datos de referencia
            </p>
          </div>
        </div>
        <div className="h-[220px] w-full flex">
          <div className="flex flex-col justify-between text-[10px] text-muted-foreground/40 pr-3 text-right shrink-0">
            {yTicks.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <div className="flex-1 flex items-end justify-around border-l border-b border-border/30 pl-2">
            {chart.map((c, i) => {
              // La última barra es el mes en curso, el único con dato real: va dorada sólida.
              // Las de referencia van huecas (solo borde) para que no se lean como facturación.
              const esReal = i === chart.length - 1;
              return (
                <div key={c.mes} className="flex-1 flex flex-col items-center justify-end h-full">
                  <div
                    className={
                      esReal
                        ? "w-6 rounded-t bg-[#D4AF37] opacity-90 hover:opacity-100 transition-opacity"
                        : "w-6 rounded-t border border-dashed border-[#D4AF37]/40 bg-[#D4AF37]/5"
                    }
                    style={{ height: `${max > 0 ? (c.valor / max) * 100 : 0}%` }}
                    title={esReal ? `${c.mes}: ${money(c.valor)} (real)` : `${c.mes}: dato de referencia`}
                  />
                  <span className={`text-[10px] mt-2 ${esReal ? "text-muted-foreground" : "text-muted-foreground/40"}`}>
                    {c.mes}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer — la línea "Tu desempeño: respuesta a urgentes 12 min · seguimientos a tiempo 86%
          · registro post-call 9 min" se eliminó el 2026-07-31. Eran tres métricas de desempeño
          personal sin ninguna fuente: nada mide tiempos de respuesta en este sistema, y una
          cifra de desempeño inventada es peor que ausente cuando alguien la usa para evaluar. */}
      <div className="pt-8 text-center space-y-4">
        <p className="text-[10px] text-muted-foreground/40">
          Prototipo · datos demo · Comando Central — las acciones simulan los eventos que en producción
          vienen de GHL.
        </p>
      </div>
    </div>
  );
}

/* ================================================================== */
/* MI DÍA                                                              */
/* ================================================================== */

const scrollToSection = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

/** Item del widget "Agenda de Hoy" de Mi Día, alimentado con datos reales de GHL (no del store demo). */
type AgendaWidgetItem = {
  name: string;
  contactId?: string;
  grade?: Grade;
  agenda: { time: string; meetUrl?: string; badge?: string; briefing?: string; videoPre?: string };
  llamadas?: CallRecord[];
  botEstado?: BotEstado;
  seguimientoAutomaticoActivo?: boolean;
  stage?: StageKey;
};

function MiDiaTab() {
  const { contacts, openContact } = useClosurer();
  const all = Object.values(contacts);
  const urgentes = all.filter((c) => c.urgente && !c.completedToday);

  /* Los urgentes REALES de GHL ya no se piden acá: los trae
     `polling-closer-intervenciones-urgentes` en `closerStore.tsx` y entran al store como
     contactos de verdad, así que el filtro de arriba los incluye solo. Movido el 2026-07-30:
     mientras vivió en esta vista, una urgencia existía únicamente con Mi Día abierto — no
     aparecía en el Pipeline y su ficha abría sin historial ni notas. */

  // Respondieron REALES: contactos con zona_closer + desenlace de Avanzar que volvieron a escribir
  // (último mensaje entrante sin responder). Se muestran junto a los EJEMPLO. Polling cada AGENDA_POLL_MS.
  const [realRespondieron, setRealRespondieron] = useState<ClosurerContact[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetchRespondieron()
        .then((res) => {
          if (!alive) return;
          setRealRespondieron(
            res.contactos.map((r) => {
              const m = OUTCOME_TO_PILL[r.outcome] ?? { stage: "seguimiento" as StageKey, situacion: r.outcome.toUpperCase(), bot: "muerto_postcall" as BotEstado };
              return {
                name: r.name.toUpperCase(),
                grade: undefined,
                stage: m.stage,
                situacion: m.situacion,
                when: r.when,
                activity: r.snippet,
                fuente: r.source,
                botEstado: m.bot,
                ghlContactId: r.contactId,
                respondido: { microtext: `${r.when} · sin responder` },
                historial: [],
                notas: [],
              } as ClosurerContact;
            }),
          );
        })
        .catch(() => {
          /* si el backend no responde, se quedan solo los EJEMPLO */
        });
    };
    load();
    const iv = setInterval(load, AGENDA_POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);
  // Pineados ("mantener") primero — § ciclo de vida de tareas, 2026-07-11.
  const respondieron = all
    .filter((c) => c.respondido && !c.completedToday)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const respondieronPinnedCount = respondieron.filter((c) => c.pinned).length;
  // Pineados primero también en Seguimientos — § correcciones toast/pin v2, 2026-07-11: es una tarea de conversación igual que Respondieron.
  const seguimientosHoy = all
    .filter((c) => c.seguimientoPendiente && !c.completedToday)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const seguimientosPinnedCount = seguimientosHoy.filter((c) => c.pinned).length;
  const completadas = all.filter((c) => c.completedToday);

  // Agenda de Hoy: datos REALES de GHL vía el backend (antes salía del store demo).
  const [agendaHoy, setAgendaHoy] = useState<AgendaWidgetItem[]>([]);
  const [agendaLoading, setAgendaLoading] = useState(true);
  const [agendaError, setAgendaError] = useState<string | null>(null);
  const [expandedAgenda, setExpandedAgenda] = useState<Set<string>>(new Set());
  const lastAgendaSigRef = useRef("");
  /**
   * La primera cita del día ya ordenada por hora. Alimenta la tarjeta "Calls Hoy".
   * Sale de la agenda REAL de GHL, no del store demo — el backend ya la devuelve ordenada.
   */
  const proximaCall = agendaHoy[0]?.agenda?.time;

  // Polling cada AGENDA_POLL_MS mientras Mi Día está abierto.
  useEffect(() => {
    let alive = true;
    const load = (first: boolean) => {
      if (first) {
        setAgendaLoading(true);
        setAgendaError(null);
      }
      fetchAgendaHoy()
        .then((res) => {
          if (!alive) return;
          const sig = res.appointments.map((a) => `${a.id}:${a.status}:${a.time}`).join("|");
          if (sig !== lastAgendaSigRef.current) {
            lastAgendaSigRef.current = sig;
            setAgendaHoy(
              res.appointments.map((a) => ({
                name: a.name,
                contactId: a.contactId ?? undefined,
                // Sin score: el motor todavía no calificó esta cita. Avatar lo pinta como "—" (§4.7).
                grade: undefined,
                agenda: { time: a.time, meetUrl: a.meetUrl ?? undefined },
                llamadas: [],
                botEstado: undefined,
                seguimientoAutomaticoActivo: false,
              })),
            );
          }
          if (first) setAgendaError(null);
        })
        .catch((e) => {
          if (alive && first) setAgendaError(e?.message ?? "No se pudo conectar con el backend");
        })
        .finally(() => {
          if (alive && first) setAgendaLoading(false);
        });
    };
    load(true);
    const iv = setInterval(() => load(false), AGENDA_POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);
  const toggleAgendaExpanded = (name: string) =>
    setExpandedAgenda((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  const tareasHoy = pendingTasksBreakdown(contacts).total;
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Two big KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card/50 backdrop-blur-sm border border-border/40 rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col justify-center transition-all hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
          <div className="flex items-center gap-2 text-muted-foreground mb-4">
            <PhoneCall className="w-4 h-4 opacity-50" />
            <span className="text-[11px] font-semibold tracking-[0.15em] uppercase">
              Calls Hoy
            </span>
          </div>
          {/*
            Derivado de `agendaHoy`, la MISMA lista que pinta la sección de abajo. Antes el
            número y la hora estaban escritos a mano ("6", "próxima a las 10:00"): al vaciar
            la agenda, la tarjeta seguía anunciando seis llamadas que no existían.
            Regla §4.4 — una sola fuente de verdad; si la sección y el contador pueden
            discrepar, alguno de los dos miente.
          */}
          <div className="flex items-baseline gap-4">
            <span className="text-5xl font-light tracking-tight">{agendaHoy.length}</span>
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              {proximaCall ? `próxima a las ${proximaCall}` : "sin citas para hoy"}
            </span>
          </div>
        </div>
        <div className="bg-card/50 backdrop-blur-sm border border-border/40 rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col justify-center transition-all hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
          <div className="flex items-center gap-2 text-muted-foreground mb-4">
            <LayoutList className="w-4 h-4 opacity-50" />
            <span className="text-[11px] font-semibold tracking-[0.15em] uppercase">
              Tareas de Hoy
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-5xl font-light tracking-tight">{tareasHoy}</span>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => scrollToSection("midia-urgentes")}
                className="inline-flex items-center gap-1.5 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border border-red-500/20 hover:bg-red-500/20 transition-colors"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                {urgentes.length ? `${urgentes.length} urgentes` : "Sin urgentes"}
              </button>
              <button
                onClick={() => scrollToSection("midia-completadas")}
                className="inline-flex items-center gap-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
              >
                ✓ {completadas.length} completadas
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Three small KPI cards — anclas de scroll a cada sección */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          {
            icon: CirclePause,
            value: String(urgentes.length),
            label: "Intervención urgente",
            bg: "bg-red-500/10",
            fg: "text-red-500",
            hover: "group-hover:text-red-500",
            target: "midia-urgentes",
          },
          {
            icon: MessageCircle,
            value: String(respondieron.length),
            label: "Respondieron (buzón general)",
            bg: "bg-purple-500/10",
            fg: "text-purple-500",
            hover: "group-hover:text-purple-500",
            target: "midia-respondieron",
          },
          {
            icon: RefreshCw,
            value: String(seguimientosHoy.length),
            label: "Seguimientos hoy",
            bg: "bg-yellow-500/10",
            fg: "text-yellow-600",
            hover: "group-hover:text-yellow-600",
            target: "midia-seguimientos",
          },
        ].map((c) => (
          <div
            key={c.label}
            onClick={() => scrollToSection(c.target)}
            className="flex flex-col p-4 rounded-[1.5rem] bg-card/50 backdrop-blur-sm border border-border/40 hover:bg-muted/30 transition-all cursor-pointer group shadow-sm"
          >
            <div className="flex items-center justify-between mb-2">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center shadow-inner",
                  c.bg,
                  c.fg,
                )}
              >
                <c.icon className="w-4 h-4" />
              </div>
              <span className={cn("text-xl font-light", c.fg)}>{c.value}</span>
            </div>
            <span
              className={cn(
                "text-[11px] font-medium text-foreground transition-colors uppercase tracking-wide leading-tight",
                c.hover,
              )}
            >
              {c.label}
            </span>
          </div>
        ))}
      </div>

      {/*
        Agenda de hoy — SIEMPRE visible, aunque esté vacía (decisión de Francisco,
        2026-07-25). Es la misma excepción que ya tenía "Completadas Hoy" frente a la regla
        §4.1: el closer necesita ver la sección para saber que no tiene citas, no que
        desaparezca y lo deje dudando de si se rompió algo.

        El contador sí se oculta en cero, que es la otra mitad de §4.1 ("contadores en cero
        jamás se renderizan"). Y el estado vacío copia el patrón de Completadas Hoy: un
        texto discreto en vez de un contenedor mudo.
      */}
      <div className="bg-card/50 backdrop-blur-sm border border-border/40 rounded-[2rem] overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-[13px] font-semibold text-foreground uppercase tracking-wide">
            Agenda de Hoy
          </h3>
          {agendaHoy.length > 0 && (
            <span className="bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
              {agendaHoy.length}
            </span>
          )}
        </div>
        {agendaLoading && (
          <div className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando agenda…
          </div>
        )}
        {!agendaLoading && agendaError && (
          <div className="flex items-center gap-2 px-2 py-4 text-xs text-amber-600 dark:text-amber-400">
            <TriangleAlert className="w-3.5 h-3.5" /> No se pudo cargar la agenda de hoy.
          </div>
        )}
        {/* Vacía pero VISIBLE — la sección nunca se oculta (copy y estilo de la base de main). */}
        {!agendaLoading && !agendaError && agendaHoy.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            No tienes citas agendadas para hoy.
          </p>
        )}
        {!agendaLoading && !agendaError && agendaHoy.length > 0 && (
        <div className="pl-3 border-l-[1.5px] border-blue-500/30 space-y-3 relative ml-1.5 py-0.5">
          {agendaHoy.map((item, idx) => {
            const isOpen = expandedAgenda.has(item.name);
            return (
              <div
                key={item.name}
                className="relative group flex flex-col pl-2 py-1 hover:bg-muted/30 rounded-lg transition-colors"
              >
                <div
                  className={cn(
                    "absolute -left-[17.5px] top-[14px] w-2 h-2 rounded-full bg-blue-500 group-hover:scale-125 transition-transform",
                    idx === 0 ? "ring-4 ring-blue-500/20" : "ring-4 ring-background",
                  )}
                />
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-3 cursor-pointer" onClick={() => toggleAgendaExpanded(item.name)}>
                    <span className="font-bold text-xs text-blue-600 shrink-0 w-10">
                      {item.agenda!.time}
                    </span>
                    <Avatar grade={item.grade} />
                    <span
                      onClick={(e) => { e.stopPropagation(); openContact(item.name, item.contactId); }}
                      className="font-semibold text-sm truncate uppercase flex items-center gap-2 cursor-pointer hover:text-primary transition-colors"
                    >
                      {item.name}
                      {item.agenda!.badge && (
                        <span className="bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[10px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider">
                          {item.agenda!.badge}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 pr-2">
                    {item.agenda!.meetUrl ? (
                      idx === 0 ? (
                        <button
                          onClick={() => window.open(item.agenda!.meetUrl, "_blank")}
                          className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500 hover:bg-green-600 text-white rounded-full text-[10px] font-bold transition-all shadow-sm mr-2"
                        >
                          <Video className="w-3 h-3" />
                          <span>Unirse</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => window.open(item.agenda!.meetUrl, "_blank")}
                          className="flex items-center gap-1.5 px-2 py-1 text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 rounded-full transition-all mr-2"
                          title="Link del Meet"
                        >
                          <Video className="w-4 h-4" />
                        </button>
                      )
                    ) : (
                      <div className="flex items-center gap-1.5 px-2 py-1 text-[#6b6980]/25 mr-2" title="Sin sala de Meet">
                        <Video className="w-4 h-4" />
                      </div>
                    )}
                    <div className="flex items-center gap-2.5">
                      <IconSlot wide>
                        <VideoCallBadge llamadas={item.llamadas} />
                      </IconSlot>
                      <IconSlot>
                        <Calendar className="w-3.5 h-3.5 text-[#6b6980]" />
                      </IconSlot>
                      <IconSlot wide>
                        <CallsBadge llamadas={item.llamadas} />
                      </IconSlot>
                      <IconSlot wide>
                        <BotIcon estado={item.botEstado} />
                      </IconSlot>
                      <IconSlot>
                        <AlarmClock className={cn("w-3.5 h-3.5", item.seguimientoAutomaticoActivo ? "text-[#6b6980]" : "text-[#6b6980]/25")} />
                      </IconSlot>
                      <IconSlot>
                        <DollarSign className={cn("w-3.5 h-3.5", item.stage === "ganado" ? "text-emerald-600 dark:text-emerald-400" : "text-[#6b6980]/25")} />
                      </IconSlot>
                    </div>
                    <button
                      onClick={() => toggleAgendaExpanded(item.name)}
                      className="ml-2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-full hover:bg-muted/50"
                    >
                      <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", isOpen && "rotate-180")} />
                    </button>
                  </div>
                </div>
                {/* Bloque de Francisco — siempre visible. Sin dato (aún no hay fuente): placeholders. */}
                <div className={cn("grid transition-[grid-template-rows] duration-300 ease-in-out", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                  <div className="overflow-hidden">
                    <div className="mt-2 ml-[52px] mr-2 p-2.5 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-lg">
                      <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                        <span className="font-semibold text-blue-700 dark:text-blue-400 mr-1">
                          Briefing IA:
                        </span>
                        {item.agenda!.briefing || "-"}
                      </p>
                      {item.agenda!.videoPre ? (
                        <p className="text-[11px] font-medium mt-2 text-emerald-600 dark:text-emerald-400">
                          {item.agenda!.videoPre}
                        </p>
                      ) : (
                        <p className="text-[11px] font-medium mt-2 text-muted-foreground">
                          Aún no sabemos si vio el video pre-call
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      {/* Intervenciones urgentes */}
      <div id="midia-urgentes" className="bg-card border border-border rounded-[2rem] overflow-hidden shadow-sm scroll-mt-6">
        <div className="bg-rose-500/10 px-6 py-4 border-b border-border flex items-center gap-3">
          <h3 className="text-[13px] font-semibold text-rose-900 dark:text-rose-300 uppercase tracking-wide">
            Intervenciones urgentes
          </h3>
          <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
            {urgentes.length}
          </span>
        </div>
        {/* Una sola lista: los urgentes REALES de GHL los trae ahora
            `polling-closer-intervenciones-urgentes` (en closerStore) y viven en el store como
            cualquier otro contacto, así que `urgentes` ya los incluye. Antes había un segundo
            `.map` sobre un `useState` local, y esa duplicación era el síntoma de que una
            urgencia real no era un contacto del sistema sino una fila de esta pantalla. */}
        <div className="divide-y divide-border">
          {urgentes.map((iv) => (
            <MiDiaRow
              key={iv.ghlContactId ?? iv.name}
              c={iv}
              onOpen={openContact}
              microtext={iv.urgente!.detail}
              microClass={iv.urgente!.detailClass}
              prefix="Falla detectada por IA:"
              badge={iv.urgente!.daysBadge}
              highlighted={iv.urgente!.highlighted}
            />
          ))}
        </div>
      </div>

      {/* Respondieron (buzón general) */}
      <div id="midia-respondieron" className="bg-card border border-border rounded-[2rem] overflow-hidden shadow-sm scroll-mt-6">
        <div className="bg-purple-500/10 px-6 py-4 border-b border-border flex items-center gap-3">
          <h3 className="text-[13px] font-semibold text-purple-900 dark:text-purple-300 uppercase tracking-wide">
            Respondieron · Buzón general
          </h3>
          <span className="bg-purple-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
            {respondieron.length + realRespondieron.length}
          </span>
        </div>
        <div className="divide-y divide-border">
          {respondieron.map((c, i) => (
            <div key={c.name}>
              {i === respondieronPinnedCount && respondieronPinnedCount > 0 && (
                <div className="px-6 py-1.5 bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-y border-border/60">
                  Sin atender
                </div>
              )}
              <MiDiaRow c={c} onOpen={openContact} microtext={c.respondido!.microtext} />
            </div>
          ))}
          {/* Reales de GHL: zona_closer + desenlace + volvieron a escribir sin respuesta */}
          {realRespondieron.map((c) => (
            <MiDiaRow key={c.ghlContactId ?? c.name} c={c} onOpen={openContact} microtext={c.respondido!.microtext} />
          ))}
        </div>
      </div>

      {/* Seguimientos de hoy */}
      <div id="midia-seguimientos" className="bg-card border border-border rounded-[2rem] overflow-hidden shadow-sm scroll-mt-6">
        <div className="bg-amber-500/10 px-6 py-4 border-b border-border flex items-center gap-3">
          <h3 className="text-[13px] font-semibold text-amber-900 dark:text-amber-300 uppercase tracking-wide">
            Seguimientos de hoy
          </h3>
          <span className="bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
            {seguimientosHoy.length}
          </span>
          {/*
            Acá vivía un badge "GHL conectado". Quitado el 2026-07-25: ese lugar queda
            reservado para la pestaña de configuración de conexiones (API de la IA, API de
            GHL, y las variables por cuenta). El estado real de la conexión se consulta en
            /api/diagnostico, que además dice cuál eslabón falla — más útil que un punto
            verde.
          */}
        </div>
        <div className="divide-y divide-border">
          {seguimientosHoy.map((c, i) => (
            <div key={c.name}>
              {i === seguimientosPinnedCount && seguimientosPinnedCount > 0 && (
                <div className="px-6 py-1.5 bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-y border-border/60">
                  Sin atender
                </div>
              )}
              <MiDiaRow
                c={c}
                onOpen={openContact}
                microtext={c.seguimientoPendiente!.microtext}
                microClass={c.seguimientoPendiente!.vencido ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Completadas Hoy — regla §4.1: siempre visible, aunque esté vacía. Tono gris/neutral: ya no requiere atención. */}
      <div id="midia-completadas" className="bg-card border border-border rounded-[2rem] overflow-hidden shadow-sm scroll-mt-6">
        <div className="bg-muted/40 px-6 py-4 border-b border-border flex items-center gap-3">
          <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide">
            ✓ Completadas Hoy
          </h3>
          <span className="bg-muted-foreground/60 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
            {completadas.length}
          </span>
        </div>
        {completadas.length === 0 ? (
          <div className="px-6 py-8 text-center text-xs text-muted-foreground">
            Todavía no completaste ninguna gestión hoy.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {completadas.map((c) => (
              <MiDiaRow key={c.name} c={c} onOpen={openContact} microtext={c.activity} completed />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================== */
/* PIPELINE                                                            */
/* ================================================================== */


/** Un agendado REAL (de la agenda de GHL) para la columna "Agendado" del Pipeline. */
type PipelineAgendaContact = { name: string; contactId?: string; whenLabel: string; time: string };

/** Fila del Pipeline para un agendado real — misma estructura visual que las filas del store, pero con datos de GHL (score "—", 📅 encendido). */
function PipelineAgendaRow({ a, onOpen }: { a: PipelineAgendaContact; onOpen: (name: string, contactId?: string) => void }) {
  return (
    <tr className="transition-all duration-200 border-b border-border/30 group cursor-pointer bg-transparent hover:bg-muted/10">
      <td className="p-4 align-middle font-medium whitespace-nowrap px-8 py-4">
        <div className="flex items-center gap-4">
          <Avatar />
          <span
            onClick={() => onOpen(a.name, a.contactId)}
            className="w-40 truncate uppercase tracking-wide text-xs cursor-pointer hover:text-primary transition-colors flex items-center gap-1.5"
          >
            {a.name}
          </span>
          <div className="flex items-center gap-2.5 shrink-0 ml-4">
            <IconSlot wide><VideoCallBadge /></IconSlot>
            <IconSlot><Calendar className="w-3.5 h-3.5 text-[#6b6980]" /></IconSlot>
            <IconSlot wide><CallsBadge /></IconSlot>
            <IconSlot wide><BotIcon estado={undefined} /></IconSlot>
            <IconSlot><AlarmClock className="w-3.5 h-3.5 text-[#6b6980]/25" /></IconSlot>
            <IconSlot><DollarSign className="w-3.5 h-3.5 text-[#6b6980]/25" /></IconSlot>
          </div>
        </div>
      </td>
      <td className="p-4 align-middle px-8 py-4">
        <div className={cn("inline-flex items-center rounded-full py-0.5 h-6 text-[10px] uppercase tracking-wider font-semibold border-0 shadow-none px-2", STAGE_META.agendado.pill)}>
          AGENDADO
        </div>
      </td>
      <td className="p-4 align-middle px-8 py-4">
        <div className="flex flex-col">
          <span className="text-xs text-foreground font-medium capitalize">{a.whenLabel}</span>
          <span className="text-[10px] text-muted-foreground">{a.time}</span>
        </div>
      </td>
      <td className="p-4 align-middle px-8 py-4 text-right">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>
      </td>
    </tr>
  );
}

function PipelineTab() {
  const { contacts, openContact, cierreEnCursoMonto, ganadoMonto } = useClosurer();

  /* Las dos tarjetas de arriba eran literales de JSX (`84` y `42`). Ahora se derivan de los
     mismos contactos que pinta el Pipeline: sin dato real detrás, un número grande en un
     dashboard es peor que no mostrarlo (§4.10). */
  const totalContactos = Object.keys(contacts).length;
  const contactosVivos = Object.values(contacts).filter(
    (c) => c.stage === "agendado" || c.stage === "seguimiento" || c.stage === "cierre",
  ).length;
  // Agenda REAL de GHL para la columna "Agendado" (hoy + próximos días), deduplicada por contacto.
  const [agendaRange, setAgendaRange] = useState<AgendaAppointment[]>([]);
  const [agendaTodayStr, setAgendaTodayStr] = useState<string>("");
  const [agendaLoading, setAgendaLoading] = useState(true);
  const [agendaError, setAgendaError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const lastPipeAgendaSigRef = useRef("");

  // "Sincronizar CRM" — refresco manual inmediato (además del polling automático de 10s).
  const refreshFromCrm = () => {
    if (refreshing) return;
    setRefreshing(true);
    fetchAgendaRange(15)
      .then((res) => {
        const sig = res.appointments.map((a) => `${a.id}:${a.status}:${a.date}:${a.time}`).join("|");
        lastPipeAgendaSigRef.current = sig;
        setAgendaRange(res.appointments);
        setAgendaTodayStr(res.date);
        setAgendaError(null);
      })
      .catch((e) => setAgendaError(e?.message ?? "No se pudo conectar con el backend"))
      .finally(() => setTimeout(() => setRefreshing(false), 600)); // spinner visible ~600ms
  };

  useEffect(() => {
    let alive = true;
    const load = (first: boolean) => {
      if (first) {
        setAgendaLoading(true);
        setAgendaError(null);
      }
      fetchAgendaRange(15)
        .then((res) => {
          if (!alive) return;
          const sig = res.appointments.map((a) => `${a.id}:${a.status}:${a.date}:${a.time}`).join("|");
          if (sig !== lastPipeAgendaSigRef.current) {
            lastPipeAgendaSigRef.current = sig;
            setAgendaRange(res.appointments);
          }
          setAgendaTodayStr(res.date);
        })
        .catch((e) => {
          if (alive && first) setAgendaError(e?.message ?? "No se pudo conectar con el backend");
        })
        .finally(() => {
          if (alive && first) setAgendaLoading(false);
        });
    };
    load(true);
    const iv = setInterval(() => load(false), AGENDA_POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  // Dedup por contacto: la próxima cita de cada agendado (el rango ya viene ordenado asc por hora).
  const agendaByContact = new Map<string, AgendaAppointment>();
  for (const a of agendaRange) {
    const key = a.contactId || a.name;
    if (!agendaByContact.has(key)) agendaByContact.set(key, a);
  }
  const agendaContacts: PipelineAgendaContact[] = [...agendaByContact.values()].map((a) => {
    const { time, ampm } = to12h(a.time);
    return {
      name: a.name,
      contactId: a.contactId ?? undefined,
      whenLabel: relDayLabel(a.date, agendaTodayStr) || fmtFecha(a.date),
      time: `${time} ${ampm}`.trim(),
    };
  });
  const [grade, setGrade] = useState<Grade | null>(null);
  const [destacados, setDestacados] = useState(false);
  const [etapaFilter, setEtapaFilter] = useState<StageKey | null>(null);
  const [etapaMenuOpen, setEtapaMenuOpen] = useState(false);

  const chipBase = "w-7 h-7 rounded-full text-xs font-bold transition-all";

  const filterRow = (r: ClosurerContact) =>
    (grade === null || r.grade === grade) && (!destacados || Boolean(r.starred));

  const reset = () => {
    setGrade(null);
    setDestacados(false);
    setEtapaFilter(null);
  };

  // Invariante: toda etapa que el filtro ofrece DEBE tener su sección — nunca se omite
  // por estar vacía (§ "Pipeline del Closer — etapas fantasma", 2026-07-11). "Todas" ofrece
  // las 7; elegir una etapa puntual ofrece esa sola, pero siempre la muestra.
  const stagesToRender = etapaFilter ? [etapaFilter] : STAGE_ORDER;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Filter bar */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-muted/10 p-4 rounded-2xl border border-border/40">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={reset}
            className="flex h-10 items-center justify-between border px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 w-[140px] rounded-full bg-background border-border/60 hover:bg-muted/30 transition-colors"
          >
            <span>Todos</span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </button>
          <div className="relative">
            <button
              onClick={() => setEtapaMenuOpen((v) => !v)}
              className="flex h-10 items-center justify-between border px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 w-[200px] rounded-full bg-background border-border/60 hover:bg-muted/30 transition-colors"
            >
              <span className="truncate">Etapa: {etapaFilter ? STAGE_META[etapaFilter].label : "Todas"}</span>
              <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
            </button>
            {etapaMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setEtapaMenuOpen(false)} />
                <div className="absolute top-full left-0 mt-2 w-56 bg-popover text-popover-foreground border border-border rounded-xl shadow-xl p-1.5 z-20 animate-in fade-in slide-in-from-top-2 duration-150">
                  <button
                    onClick={() => {
                      setEtapaFilter(null);
                      setEtapaMenuOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center px-3 py-2 rounded-lg text-sm text-left transition-colors hover:bg-muted",
                      etapaFilter === null && "font-semibold text-primary",
                    )}
                  >
                    Todas
                  </button>
                  {STAGE_ORDER.map((stageKey) => (
                    <button
                      key={stageKey}
                      onClick={() => {
                        setEtapaFilter(stageKey);
                        setEtapaMenuOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors hover:bg-muted",
                        etapaFilter === stageKey && "font-semibold text-primary",
                      )}
                    >
                      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", STAGE_META[stageKey].dot)} />
                      {STAGE_META[stageKey].label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 bg-background border border-border/60 rounded-full p-1">
            {(["A", "B", "C"] as Grade[]).map((g) => (
              <button
                key={g}
                onClick={() => setGrade((cur) => (cur === g ? null : g))}
                className={cn(
                  chipBase,
                  grade === g
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "hover:bg-muted text-muted-foreground",
                )}
              >
                {g}
              </button>
            ))}
          </div>
          <button
            onClick={() => setDestacados((v) => !v)}
            className={cn(
              "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border h-9 px-3 rounded-full border-border/60",
              destacados
                ? "bg-primary/10 text-primary border-primary/30"
                : "bg-background hover:bg-accent hover:text-accent-foreground text-muted-foreground",
            )}
          >
            <span className="text-lg leading-none mr-1.5">⭐</span>
            Destacados
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              className="flex h-10 border px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 md:text-sm pl-10 w-64 rounded-full bg-background border-border/60 focus-visible:ring-primary/20 transition-all"
              placeholder="Buscar lead..."
            />
          </div>
          <button
            onClick={refreshFromCrm}
            disabled={refreshing}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 h-10 px-4 py-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-md transition-all disabled:opacity-70"
          >
            <RefreshCw className={cn("w-4 h-4 mr-2", refreshing && "animate-spin")} />
            {refreshing ? "Sincronizando…" : "Sincronizar CRM"}
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-[2rem] border border-border/40 bg-card/50 backdrop-blur-sm p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col justify-between">
          <div className="flex flex-row items-center justify-between pb-6">
            <h3 className="text-[11px] font-semibold text-muted-foreground tracking-[0.15em] uppercase">
              Base Total
            </h3>
            <Users className="w-4 h-4 text-muted-foreground opacity-50" />
          </div>
          <div>
            {/* Antes era el literal `84`, escrito en el JSX y sin ninguna variable detrás.
                Ahora cuenta los contactos que el módulo realmente conoce. */}
            <div className="text-4xl font-light tracking-tight">{totalContactos}</div>
            <p className="text-[10px] font-medium text-muted-foreground mt-2 uppercase tracking-wider">
              Contactos en CRM
            </p>
          </div>
        </div>
        <div className="rounded-[2rem] border border-border/40 bg-primary/5 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col justify-between">
          <div className="flex flex-row items-center justify-between pb-6">
            <h3 className="text-[11px] font-semibold text-primary tracking-[0.15em] uppercase">
              En Juego Activo
            </h3>
            <Target className="w-4 h-4 text-primary opacity-50" />
          </div>
          <div>
            {/* Antes era el literal `42`. "Vivo" = el trato sigue en juego: agendado,
                en seguimiento o en cierre. Ganado, no-show, nurture y descalificado ya
                salieron del embudo activo. */}
            <div className="text-4xl font-light tracking-tight text-primary">{contactosVivos}</div>
            <p className="text-[10px] font-medium text-primary mt-2 uppercase tracking-wider">
              Contactos vivos
            </p>
          </div>
        </div>
        <div className="rounded-[2rem] border border-amber-200/60 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col justify-between">
          <div className="flex flex-row items-center justify-between pb-6">
            <h3 className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 tracking-[0.15em] uppercase">
              Sobre la mesa
            </h3>
            <DollarSign className="w-4 h-4 text-amber-700 dark:text-amber-400 opacity-50" />
          </div>
          <div>
            <div className="text-4xl font-light tracking-tight text-amber-700 dark:text-amber-400">
              {money(cierreEnCursoMonto)}
            </div>
            <p className="text-[10px] font-medium text-amber-700 mt-2 uppercase tracking-wider">
              En cierre en curso
            </p>
          </div>
        </div>
      </div>

      {/* Stage sections — invariante: toda etapa que el filtro ofrece se renderiza, aunque esté vacía */}
      <div className="space-y-6 mt-8">
        {stagesToRender.map((stageKey) => {
          const meta = STAGE_META[stageKey];
          const isAgendado = stageKey === "agendado";
          // `members` = todos los de la etapa. `rows` = los que además pasan el filtro de la
          // barra. El badge cuenta `members` y el monto suma `members`; la tabla pinta `rows`.
          const members = Object.values(contacts).filter((c) => c.stage === stageKey);
          const rows = members.filter(filterRow);
          /* Las dos etapas con dinero llevan su total al lado del nombre. Los dos salen de
             sumar el `monto` de los contactos de esa etapa (en el store), no de una base
             fija: si un contacto se mueve de etapa, los dos números se corrigen solos.
             `ganadoMonto` es además el MISMO valor que el Cash Collected de Inicio — un solo
             número para la misma plata en toda la app. */
          const label =
            stageKey === "cierre"
              ? `${meta.label} · 🔥 ${money(cierreEnCursoMonto)} SOBRE LA MESA`
              : stageKey === "ganado" && ganadoMonto > 0
                ? `${meta.label} · 💰 ${money(ganadoMonto)} COBRADO`
                : meta.label;
          return (
            <div
              key={stageKey}
              className="bg-card/50 backdrop-blur-sm rounded-[2rem] border border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden"
            >
              <div
                className={cn(
                  "py-4 px-8 border-b border-border/40 flex items-center gap-2",
                  meta.headerBg,
                )}
              >
                <span className={cn("w-2 h-2 rounded-full", meta.dot)} />
                <span
                  className={cn(
                    "font-semibold text-[11px] uppercase tracking-widest",
                    meta.labelColor,
                  )}
                >
                  {label}
                </span>
                {/* Conteo real de la etapa. Antes sumaba un `hiddenOffset` —siete constantes
                    escritas como restas literales (24-4, 26-4…) que representaban "contactos
                    del CRM no incluidos en el demo"— y el badge terminaba mintiendo: mostraba
                    27 en Seguimiento sobre 7 filas, 28 en No-show sobre 6. Eliminado.
                    Cuenta `members` (todos los de la etapa) y no `rows`, para que el número no
                    cambie al filtrar por grade: el badge dice cuántos hay en la etapa, no
                    cuántos estás mirando. */}
                <div className="inline-flex items-center border py-0.5 font-semibold transition-colors border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 ml-2 text-[10px] h-5 px-1.5 shadow-none rounded-full">
                  {isAgendado ? agendaContacts.length : members.length}
                </div>
              </div>
              {isAgendado ? (
                agendaLoading && agendaContacts.length === 0 ? (
                  <div className="p-10 text-center text-sm text-muted-foreground">Cargando agenda…</div>
                ) : agendaError && agendaContacts.length === 0 ? (
                  <div className="p-10 text-center text-sm text-amber-600 dark:text-amber-400">No se pudo cargar la agenda.</div>
                ) : agendaContacts.length === 0 ? (
                  <div className="p-10 text-center text-sm text-muted-foreground">Sin citas agendadas.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="relative w-full overflow-auto">
                      <table className="w-full caption-bottom text-sm">
                        <thead className="[&_tr]:border-b bg-transparent">
                          <tr className="transition-colors border-b border-border/40 hover:bg-transparent">
                            <th className="h-12 text-left align-middle w-[40%] font-semibold text-[10px] uppercase tracking-[0.1em] text-muted-foreground px-8 py-4">Nombre</th>
                            <th className="h-12 text-left align-middle w-[30%] font-semibold text-[10px] uppercase tracking-[0.1em] text-muted-foreground px-8 py-4">Situación</th>
                            <th className="h-12 text-left align-middle w-[25%] font-semibold text-[10px] uppercase tracking-[0.1em] text-muted-foreground px-8 py-4">Última Actividad</th>
                            <th className="h-12 text-left align-middle font-medium text-muted-foreground w-[5%] px-8 py-4" />
                          </tr>
                        </thead>
                        <tbody className="[&_tr:last-child]:border-0">
                          {agendaContacts.map((a) => (
                            <PipelineAgendaRow key={a.contactId ?? a.name} a={a} onOpen={openContact} />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              ) : rows.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  {members.length === 0
                    ? "Sin contactos en esta etapa."
                    : "Ningún contacto coincide con el filtro seleccionado."}
                </div>
              ) : (
              <div className="overflow-x-auto">
                <div className="relative w-full overflow-auto">
                  <table className="w-full caption-bottom text-sm">
                    <thead className="[&_tr]:border-b bg-transparent">
                      <tr className="transition-colors border-b border-border/40 hover:bg-transparent">
                        <th className="h-12 text-left align-middle w-[40%] font-semibold text-[10px] uppercase tracking-[0.1em] text-muted-foreground px-8 py-4">
                          Nombre
                        </th>
                        <th className="h-12 text-left align-middle w-[30%] font-semibold text-[10px] uppercase tracking-[0.1em] text-muted-foreground px-8 py-4">
                          Situación
                        </th>
                        <th className="h-12 text-left align-middle w-[25%] font-semibold text-[10px] uppercase tracking-[0.1em] text-muted-foreground px-8 py-4">
                          Última Actividad
                        </th>
                        <th className="h-12 text-left align-middle font-medium text-muted-foreground w-[5%] px-8 py-4" />
                      </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0">
                      {rows.map((r) => (
                        <tr
                          key={r.name}
                          className="transition-all duration-200 border-b border-border/30 group cursor-pointer bg-transparent hover:bg-muted/10"
                        >
                          <td className="p-4 align-middle font-medium whitespace-nowrap px-8 py-4">
                            <div className="flex items-center gap-4">
                              <Avatar grade={r.grade} />
                              <span
                                onClick={() => openContact(r.name)}
                                className="w-40 truncate uppercase tracking-wide text-xs cursor-pointer hover:text-primary transition-colors flex items-center gap-1.5"
                              >
                                {r.name}
                              </span>
                              <div className="flex items-center gap-2.5 shrink-0 ml-4">
                                <IconSlot wide>
                                  <VideoCallBadge llamadas={r.llamadas} />
                                </IconSlot>
                                <IconSlot>
                                  <Calendar className={cn("w-3.5 h-3.5", r.agenda ? "text-[#6b6980]" : "text-[#6b6980]/25")} />
                                </IconSlot>
                                <IconSlot wide>
                                  <CallsBadge llamadas={r.llamadas} />
                                </IconSlot>
                                <IconSlot wide>
                                  <BotIcon estado={r.botEstado} />
                                </IconSlot>
                                <IconSlot>
                                  <AlarmClock className={cn("w-3.5 h-3.5", r.seguimientoAutomaticoActivo ? "text-[#6b6980]" : "text-[#6b6980]/25")} />
                                </IconSlot>
                                <IconSlot>
                                  <DollarSign className={cn("w-3.5 h-3.5", r.stage === "ganado" ? "text-emerald-600 dark:text-emerald-400" : "text-[#6b6980]/25")} />
                                </IconSlot>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 align-middle px-8 py-4">
                            <div
                              className={cn(
                                "inline-flex items-center rounded-full py-0.5 h-6 text-[10px] uppercase tracking-wider font-semibold border-0 shadow-none px-2",
                                meta.pill,
                              )}
                            >
                              {r.situacion}
                            </div>
                          </td>
                          <td className="p-4 align-middle px-8 py-4">
                            <div className="flex flex-col">
                              <span className="text-xs text-foreground font-medium">
                                {r.when}
                              </span>
                              {r.activity && (
                                <span
                                  className="text-[10px] text-muted-foreground truncate max-w-[200px]"
                                  title={r.activity}
                                >
                                  {r.activity}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-4 align-middle px-8 py-4 text-right">
                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button className="p-1.5 rounded-full hover:bg-muted transition-colors">
                                <Star
                                  className={cn(
                                    "w-4 h-4 transition-all",
                                    r.starred
                                      ? "text-amber-500 fill-amber-500"
                                      : "text-muted-foreground/40 hover:text-muted-foreground",
                                  )}
                                />
                              </button>
                              <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent h-8 w-8 text-muted-foreground hover:text-foreground">
                                <MoreHorizontal className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================== */
/* AGENDA                                                              */
/* ================================================================== */

const SKY_DOTS = new Set([1, 2, 3, 4, 5, 9, 10, 11, 13, 14, 16, 17]);
const AMBER_DOTS = new Set([6, 7]);
const TODAY = 8;
const LEADING_BLANKS = 3; // July 2026 starts on Wednesday (D L M X ...)

const PROXIMOS: Array<{ label: string; calls: string; active?: boolean }> = [
  { label: "Hoy", calls: "6 calls", active: true },
  { label: "Mañana", calls: "1 calls" },
  { label: "viernes", calls: "1 calls" },
  { label: "sábado", calls: "1 calls" },
];

interface ScheduleSlot {
  id?: string;
  contactId?: string;
  time: string;
  ampm: string;
  name: string;
  /** Sin calificación del motor → Avatar lo pinta como "—" (§4.7). */
  grade?: Grade;
  duration: string;
  tag?: string;
  hint: string;
  estadoCita: "confirmada" | "reprogramada" | "pendiente";
  briefing?: string;
  videoPre?: { visto: boolean; pct?: number };
  meetUrl: string;
}

const ESTADO_CITA_PILL: Record<ScheduleSlot["estadoCita"], { label: string; cls: string }> = {
  confirmada: { label: "Confirmada", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" },
  reprogramada: { label: "Reprogramada", cls: "bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
  pendiente: { label: "Pendiente", cls: "bg-muted text-muted-foreground" },
};

const SCHEDULE: ScheduleSlot[] = [
  {
    time: "9:00",
    ampm: "AM",
    name: "EJEMPLO VALENTINA GOMEZ",
    grade: "A",
    duration: "45 min",
    tag: "Masterclass",
    hint: "9:00 AM tu hora · 9:30 AM hora del contacto",
    estadoCita: "confirmada",
    briefing: "venta low-ticket cerrada exitosamente",
    videoPre: { visto: true, pct: 100 },
    meetUrl: "https://meet.google.com/valentina-gomez-0900",
  },
  {
    time: "11:00", ampm: "AM", name: "EJEMPLO JUAN PEREZ", grade: "C", duration: "45 min",
    hint: "11:00 AM tu hora · 11:30 AM hora del contacto", estadoCita: "confirmada",
    briefing: "Lead calificado vía Meta Ads. Busca escalar a $10k/mes pero tiene cuello de botella en prospección. Tiene capital disponible.",
    videoPre: { visto: true, pct: 87 },
    meetUrl: "https://meet.google.com/juan-perez-1100",
  },
];

/* --- Helpers: mapean una cita real de GHL al formato del timeline --- */
function to12h(time24: string): { time: string; ampm: string } {
  const [hStr, m = "00"] = (time24 || "").split(":");
  let h = parseInt(hStr, 10);
  if (!Number.isFinite(h)) return { time: time24 || "", ampm: "" };
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return { time: `${h}:${m}`, ampm };
}

function estadoFromStatus(status: string): ScheduleSlot["estadoCita"] {
  if (status === "confirmed" || status === "showed") return "confirmada";
  if (status === "noshow" || status === "cancelled") return "reprogramada";
  return "pendiente";
}

function durationBetween(startISO: string, endISO: string | null): string {
  if (!endISO) return "";
  const ms = new Date(endISO).getTime() - new Date(startISO).getTime();
  return Number.isFinite(ms) && ms > 0 ? `${Math.round(ms / 60000)} min` : "";
}

function appointmentToSlot(a: AgendaAppointment): ScheduleSlot {
  const { time, ampm } = to12h(a.time);
  return {
    id: a.id,
    contactId: a.contactId ?? undefined,
    time,
    ampm,
    name: a.name,
    grade: undefined, // el motor aún no calificó esta cita — sin inventar (regla §4.7)
    duration: durationBetween(a.startTime, a.endTime),
    hint: "",
    estadoCita: estadoFromStatus(a.status),
    meetUrl: a.meetUrl ?? "",
    // briefing / videoPre: NO vienen de GHL — los pondrá el motor (quedan undefined).
  };
}

const MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIAS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
function fmtFecha(iso: string): string {
  if (!iso) return "";
  const [, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES_ES[(m || 1) - 1] ?? ""}`;
}
function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function weekdayName(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return DIAS_ES[new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay()] ?? "";
}
/** "Hoy" / "Mañana" / nombre del día (ej. "viernes"). */
function relDayLabel(dateStr: string, today: string): string {
  if (!dateStr || !today) return "";
  if (dateStr === today) return "Hoy";
  if (dateStr === addDaysStr(today, 1)) return "Mañana";
  return weekdayName(dateStr);
}

function AgendaTab() {
  const { openContact } = useClosurer();
  const [range, setRange] = useState<AgendaAppointment[]>([]);
  const [todayStr, setTodayStr] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const lastRangeSigRef = useRef("");

  // Trae hoy + 15 días (para "Próximos Días", el mini-calendario y ver cualquier día). Polling cada AGENDA_POLL_MS.
  useEffect(() => {
    let alive = true;
    const load = (first: boolean) => {
      if (first) {
        setLoading(true);
        setError(null);
      }
      fetchAgendaRange(15)
        .then((res) => {
          if (!alive) return;
          const sig = res.appointments.map((a) => `${a.id}:${a.status}:${a.date}:${a.time}`).join("|");
          if (sig !== lastRangeSigRef.current) {
            lastRangeSigRef.current = sig;
            setRange(res.appointments);
          }
          setTodayStr(res.date);
          setSelectedDate((cur) => cur || res.date); // por defecto, hoy
          if (first) setError(null);
        })
        .catch((e) => {
          if (alive && first) setError(e?.message ?? "No se pudo conectar con el backend");
        })
        .finally(() => {
          if (alive && first) setLoading(false);
        });
    };
    load(true);
    const iv = setInterval(() => load(false), AGENDA_POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  // Agrupar por día + agenda del día seleccionado
  const byDate = new Map<string, AgendaAppointment[]>();
  for (const a of range) {
    const arr = byDate.get(a.date) ?? [];
    arr.push(a);
    byDate.set(a.date, arr);
  }
  const schedule = (byDate.get(selectedDate) ?? []).map(appointmentToSlot);

  // "Próximos Días" — hoy + los siguientes 3, con conteo real
  const proximos = todayStr
    ? [0, 1, 2, 3].map((n) => {
        const ds = addDaysStr(todayStr, n);
        return { dateStr: ds, label: relDayLabel(ds, todayStr), count: byDate.get(ds)?.length ?? 0 };
      })
    : [];

  // Mini-calendario del mes de hoy
  const calYear = todayStr ? Number(todayStr.slice(0, 4)) : 0;
  const calMonthIdx = todayStr ? Number(todayStr.slice(5, 7)) - 1 : 0;
  const calMonthName = MESES_ES[calMonthIdx] ?? "";
  const daysInMonth = todayStr ? new Date(Date.UTC(calYear, calMonthIdx + 1, 0)).getUTCDate() : 0;
  const leadingBlanks = todayStr ? new Date(Date.UTC(calYear, calMonthIdx, 1)).getUTCDay() : 0;
  const pad2 = (n: number) => String(n).padStart(2, "0");

  const toggleExpanded = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  return (
    <div className="max-w-[1100px] mx-auto w-full pb-32 pt-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <p className="text-sm">Sincronizado con tu Google Calendar</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 px-4 py-2 rounded-full h-9 text-xs font-medium bg-foreground text-background hover:bg-foreground/90">
            <Plus className="w-4 h-4 mr-2" />
            Nueva Cita
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-10 w-full items-start">
        {/* Left column */}
        <div className="w-full lg:w-[320px] shrink-0 space-y-6 flex flex-col">
          {/* Calendar */}
          <div className="bg-card/50 backdrop-blur-sm border border-border/40 rounded-[2rem] p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm capitalize">{calMonthName} de {calYear || ""}</h3>
              <div className="flex gap-1">
                <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground h-7 w-7 rounded-full">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground h-7 w-7 rounded-full">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center mb-2">
              {["D", "L", "M", "X", "J", "V", "S"].map((d, i) => (
                <div key={i} className="text-[10px] font-bold text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {Array.from({ length: leadingBlanks }).map((_, i) => (
                <div key={`b${i}`} className="h-8 w-8 mx-auto" />
              ))}
              {Array.from({ length: daysInMonth }).map((_, idx) => {
                const day = idx + 1;
                const ds = `${calYear}-${pad2(calMonthIdx + 1)}-${pad2(day)}`;
                const isSelected = ds === selectedDate;
                const isToday = ds === todayStr;
                const hasAppt = (byDate.get(ds)?.length ?? 0) > 0;
                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDate(ds)}
                    className={cn(
                      "h-8 w-8 mx-auto flex items-center justify-center rounded-full text-xs transition-all cursor-pointer relative",
                      isSelected
                        ? "bg-primary text-primary-foreground font-semibold shadow-md"
                        : isToday
                          ? "ring-1 ring-primary/40 text-foreground hover:bg-muted/50"
                          : "hover:bg-muted/50 text-foreground",
                    )}
                  >
                    {day}
                    {hasAppt && !isSelected && (
                      <div className="absolute bottom-1 w-1 h-1 rounded-full bg-sky-500" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Próximos días */}
          <div className="bg-card/50 backdrop-blur-sm border border-border/40 rounded-[2rem] p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex-1">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
              Próximos Días
            </h3>
            <div className="space-y-4">
              {proximos.map((p) => {
                const active = p.dateStr === selectedDate;
                return (
                  <button
                    key={p.dateStr}
                    onClick={() => setSelectedDate(p.dateStr)}
                    className={cn(
                      "w-full flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors text-left",
                      active
                        ? "bg-primary/5 border border-primary/10"
                        : "hover:bg-muted/30 border border-transparent",
                    )}
                  >
                    <span
                      className={cn(
                        "text-sm font-medium capitalize",
                        active ? "text-primary" : "text-foreground",
                      )}
                    >
                      {p.label}
                    </span>
                    <div
                      className={cn(
                        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors border-none h-6",
                        active && p.count > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {p.count === 0 ? "Sin citas" : `${p.count} cita${p.count === 1 ? "" : "s"}`}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Day schedule */}
        <div className="flex-1 w-full bg-card/50 backdrop-blur-sm border border-border/40 rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative">
          <div className="max-w-3xl mx-auto space-y-10">
            <div>
              <div className="flex items-center justify-between mb-6 sticky top-0 bg-card/95 backdrop-blur-md py-2 z-10">
                <div className="flex items-end gap-4">
                  <h3 className="text-2xl font-semibold tracking-tight capitalize">{relDayLabel(selectedDate, todayStr) || "Hoy"}</h3>
                  <span className="text-muted-foreground font-medium mb-1 capitalize">{fmtFecha(selectedDate)}</span>
                </div>
              </div>

              {loading && (
                <div className="flex items-center justify-center gap-3 text-muted-foreground py-10">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Cargando agenda de hoy…</span>
                </div>
              )}
              {!loading && error && (
                <div className="flex flex-col items-center gap-2 text-center py-10">
                  <TriangleAlert className="w-6 h-6 text-amber-500" />
                  <p className="text-sm font-medium text-foreground">No se pudo cargar la agenda</p>
                  <p className="text-xs text-muted-foreground max-w-sm">{error}</p>
                </div>
              )}
              {!loading && !error && schedule.length === 0 && (
                <div className="flex flex-col items-center gap-2 text-center py-10">
                  <Calendar className="w-6 h-6 text-muted-foreground/50" />
                  <p className="text-sm font-medium text-foreground">Sin citas este día</p>
                  <p className="text-xs text-muted-foreground">No hay agendamientos confirmados para el día seleccionado.</p>
                </div>
              )}

              {!loading && !error && schedule.length > 0 && (
              <div className="space-y-4 relative before:absolute before:inset-0 before:ml-[5.5rem] before:-translate-x-px before:h-full before:w-0.5 before:bg-border/40">
                {schedule.map((s) => {
                  const isOpen = expanded.has(s.name);
                  const estado = ESTADO_CITA_PILL[s.estadoCita];
                  return (
                    <div key={s.id ?? s.time} className="relative flex items-start gap-6 group">
                      <div className="w-16 shrink-0 text-right pt-4">
                        <div className="text-sm font-bold text-foreground">{s.time}</div>
                        <div className="text-[10px] font-medium text-muted-foreground uppercase">
                          {s.ampm}
                        </div>
                      </div>
                      <div className="relative flex items-center justify-center w-8 h-8 rounded-full border-4 border-background shrink-0 mt-2.5 z-10 bg-sky-100 text-sky-600 dark:bg-sky-900/30">
                        <Video className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 p-5 rounded-2xl border shadow-sm transition-all bg-card border-border hover:shadow-md hover:border-sky-200/60">
                        <div className="flex items-start justify-between mb-1 gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar grade={s.grade} />
                            <div className="min-w-0">
                              <h4
                                onClick={() => openContact(s.name, s.contactId)}
                                className="text-base font-semibold text-foreground cursor-pointer hover:text-primary transition-colors truncate"
                              >
                                {s.name}
                              </h4>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3.5 h-3.5" />
                                  {s.duration}
                                </span>
                                {s.tag && (
                                  <span className="flex items-center gap-1">
                                    <Tag className="w-3.5 h-3.5" />
                                    {s.tag}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <div
                              className={cn(
                                "inline-flex items-center rounded-full font-semibold text-[10px] uppercase tracking-widest px-2.5 py-1",
                                estado.cls,
                              )}
                            >
                              {estado.label}
                            </div>
                            <button
                              onClick={() => toggleExpanded(s.name)}
                              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-full hover:bg-muted/50"
                            >
                              <ChevronDown className={cn("w-4 h-4 transition-transform duration-200", isOpen && "rotate-180")} />
                            </button>
                          </div>
                        </div>
                        {s.hint && <p className="text-xs text-muted-foreground opacity-70 mb-1">{s.hint}</p>}

                        <div className={cn("grid transition-[grid-template-rows] duration-300 ease-in-out", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                          <div className="overflow-hidden">
                            {/* Bloque de Francisco — siempre visible. Sin dato (aún no hay fuente): placeholders. */}
                            <div className="mt-3 mb-2 p-2.5 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-lg">
                              <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                                <span className="font-semibold text-blue-700 dark:text-blue-400 mr-1">
                                  Briefing IA:
                                </span>
                                {s.briefing || "-"}
                              </p>
                              {s.videoPre ? (
                                <p
                                  className={cn(
                                    "text-[11px] font-medium mt-2",
                                    s.videoPre.visto
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-amber-600 dark:text-amber-400",
                                  )}
                                >
                                  {s.videoPre.visto
                                    ? `✓ Vio el video pre-call (${s.videoPre.pct}%)`
                                    : "⚠ No vio el video pre-call"}
                                </p>
                              ) : (
                                <p className="text-[11px] font-medium mt-2 text-muted-foreground">
                                  Aún no sabemos si vio el video pre-call
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border/40">
                              <button
                                onClick={() => window.open(s.meetUrl, "_blank", "noopener,noreferrer")}
                                className="justify-center whitespace-nowrap ring-offset-background transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 py-2 rounded-xl h-9 px-5 text-xs font-medium bg-[#00796B] hover:bg-[#00695C] text-white border-0 shadow-sm flex items-center gap-2"
                              >
                                <Video className="w-4 h-4" />
                                Link del Meet
                              </button>
                              <button
                                onClick={() => openContact(s.name, s.contactId)}
                                className="inline-flex items-center justify-center gap-2 whitespace-nowrap ring-offset-background transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border bg-background dark:bg-secondary hover:text-accent-foreground py-2 rounded-xl h-9 px-4 text-xs font-medium border-border/60 hover:bg-muted/50"
                              >
                                Abrir Ficha
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* Root                                                                */
/* ================================================================== */

function CloserAIInner({ onScreenChange }: { onScreenChange?: (label: string) => void }) {
  const [tab, setTab] = useState<TabKey>("inicio");
  const { contacts, openContactName, openGhlContactId, closeContact, advance, addNota, resolveIntervention, setBotEstado, pinTask, completeTask, reviveTask } = useClosurer();
  const { resolveAlertsForContact } = useAgentAudit();
  const openContact = contacts[openContactName ?? ""] ?? null;

  useEffect(() => {
    onScreenChange?.(TABS.find((t) => t.key === tab)?.label ?? "Inicio");
  }, [tab, onScreenChange]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative bg-background">
      <div className="flex-1 flex flex-col overflow-hidden bg-[#fcfcfd] dark:bg-background">
        <div className="flex-1 overflow-y-auto">
          <div className="p-8 max-w-[1600px] mx-auto space-y-8">
            <Header tab={tab} setTab={setTab} />
            {tab === "inicio" && <InicioTab onGoToMiDia={() => setTab("midia")} />}
            {tab === "midia" && <MiDiaTab />}
            {tab === "pipeline" && <PipelineTab />}
            {tab === "agenda" && <AgendaTab />}
          </div>
        </div>
      </div>
      <ContactDrawer
        name={openContactName}
        onClose={closeContact}
        role="closer"
        contact={openContact}
        ghlContactId={openGhlContactId}
        onAdvance={(result) =>
          openContactName &&
          result.stage &&
          // `situacionSlug` se renombra a `situacion` porque en el store ese nombre ya está
          // tomado por la píldora (un string libre); acá viaja el enum que persiste el backend.
          advance(openContactName, { ...result, stage: result.stage, situacion: result.situacionSlug })
        }
        onAddNota={(texto) => openContactName && addNota(openContactName, texto)}
        onResolveIntervention={() => {
          if (!openContactName) return;
          resolveIntervention(openContactName);
          resolveAlertsForContact(openContactName);
        }}
        onBotStateChange={(estado, evento, autor) => openContactName && setBotEstado(openContactName, estado, evento, autor)}
        onPin={() => openContactName && pinTask(openContactName)}
        onComplete={() => openContactName && completeTask(openContactName)}
        onRevive={() => openContactName && reviveTask(openContactName)}
      />
    </div>
  );
}

export default function CloserAI({ onScreenChange }: { onScreenChange?: (label: string) => void }) {
  return <CloserAIInner onScreenChange={onScreenChange} />;
}
