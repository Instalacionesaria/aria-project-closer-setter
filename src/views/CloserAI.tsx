import { useEffect, useState } from "react";
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
} from "lucide-react";
import { cn } from "../lib/utils";
import { backendActivo } from "../lib/seguimientos/cliente";
import ContactDrawer from "./ContactDrawer";
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
  onOpen: (name: string) => void;
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
      onClick={() => onOpen(c.name)}
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

const CHART_HIST = [
  { mes: "Abr", valor: 8500 },
  { mes: "May", valor: 17000 },
  { mes: "Jun", valor: 25500 },
];

function InicioTab({ onGoToMiDia }: { onGoToMiDia: () => void }) {
  const { cockpit, contacts } = useClosurer();
  const { miCuenta } = useSettings();
  const cierreEnCurso = Object.values(contacts).filter((c) => c.stage === "cierre");
  const cierreMonto = cierreEnCurso.reduce((s, c) => s + (c.monto ?? 0), 0);
  const tareas = pendingTasksBreakdown(contacts);
  const closeRate = cockpit.ventas > 0 ? ((cockpit.ventas / 40) * 100).toFixed(1) : "0.0";
  const falta = miCuenta.metaComision - cockpit.comision;
  const avgComision = cockpit.ventas > 0 ? cockpit.comision / cockpit.ventas : 0;
  const ventasFaltantes = falta > 0 && avgComision > 0 ? Math.ceil(falta / avgComision) : 0;
  // § auditoría v2 (2026-07-11): "Meta superada" nunca debe mostrarse con comisión $0 — evita el caso
  // contradictorio (meta mal configurada en $0/negativa + comisión $0 celebrando una meta "superada").
  const metaSuperada = falta <= 0 && cockpit.comision > 0;
  // Anillo dorado (§ 2026-07-11): % real hacia la meta, capado a 100 solo para el SVG — el texto puede superar el 100%.
  const ringPercentage = miCuenta.metaComision > 0 ? Math.min((cockpit.comision / miCuenta.metaComision) * 100, 100) : 0;
  const cockpitStats = [
    { l: "Ventas", v: String(cockpit.ventas), s: `tasa ${closeRate}%` },
    { l: "Acuerdos", v: money(cierreMonto), s: `${cierreEnCurso.length} leads` },
    { l: "Calls Mes", v: String(cockpit.callsMes), s: "20 semanales" },
    { l: "Show rate", v: "60%", s: "meta 70%" },
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
            <div className="flex flex-col gap-3 text-sm text-white/60 font-light mb-10">
              <p className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500/80 animate-pulse" />
                Cobrado real, no prometido <span className="text-white/20">|</span>{" "}
                <span className="text-green-400/90 font-medium">▲ $5,100</span>
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
              <span className="text-muted-foreground/30">•</span>
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3" /> 6 calls hoy
              </span>
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
            <p className="text-[11px] text-muted-foreground">Cash collected últimos 4 meses</p>
          </div>
        </div>
        <div className="h-[220px] w-full flex">
          <div className="flex flex-col justify-between text-[10px] text-muted-foreground/40 pr-3 text-right shrink-0">
            {yTicks.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <div className="flex-1 flex items-end justify-around border-l border-b border-border/30 pl-2">
            {chart.map((c) => (
              <div key={c.mes} className="flex-1 flex flex-col items-center justify-end h-full">
                <div
                  className="w-6 rounded-t bg-[#D4AF37] opacity-90 hover:opacity-100 transition-opacity"
                  style={{ height: `${(c.valor / max) * 100}%` }}
                />
                <span className="text-[10px] text-muted-foreground/40 mt-2">{c.mes}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="pt-8 text-center space-y-4">
        <p className="text-xs font-medium text-muted-foreground/60">
          Tu desempeño: respuesta a urgentes 12 min · seguimientos a tiempo 86% · registro
          post-call 9 min.
        </p>
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

function MiDiaTab() {
  const { contacts, openContact } = useClosurer();
  const all = Object.values(contacts);
  const urgentes = all.filter((c) => c.urgente && !c.completedToday);
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
  const agendaHoy = all
    .filter((c) => c.agenda && !c.completedToday)
    .sort((a, b) => (a.agenda!.time > b.agenda!.time ? 1 : -1));
  const completadas = all.filter((c) => c.completedToday);
  const [expandedAgenda, setExpandedAgenda] = useState<Set<string>>(
    () => new Set(all.filter((c) => c.agenda?.expanded).map((c) => c.name)),
  );
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
          <div className="flex items-baseline gap-4">
            <span className="text-5xl font-light tracking-tight">6</span>
            <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              próxima a las 10:00
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

      {/* Agenda de hoy */}
      <div className="bg-card/50 backdrop-blur-sm border border-border/40 rounded-[2rem] overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-6">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-[13px] font-semibold text-foreground uppercase tracking-wide">
            Agenda de Hoy
          </h3>
          <span className="bg-blue-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
            {agendaHoy.length}
          </span>
        </div>
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
                      onClick={(e) => { e.stopPropagation(); openContact(item.name); }}
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
                {item.agenda!.briefing && (
                  <div className={cn("grid transition-[grid-template-rows] duration-300 ease-in-out", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                    <div className="overflow-hidden">
                      <div className="mt-2 ml-[52px] mr-2 p-2.5 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-lg">
                        <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                          <span className="font-semibold text-blue-700 dark:text-blue-400 mr-1">
                            Briefing IA:
                          </span>
                          {item.agenda!.briefing}
                        </p>
                        {item.agenda!.videoPre && (
                          <p className="text-[11px] font-medium mt-2 text-emerald-600 dark:text-emerald-400">
                            {item.agenda!.videoPre}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
        <div className="divide-y divide-border">
          {urgentes.map((iv) => (
            <MiDiaRow
              key={iv.name}
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
            {respondieron.length}
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
          {/* Sin esto no hay forma de distinguir a simple vista un contacto real de GHL de
              uno de la semilla — y en producción esa confusión cuesta caro. */}
          {backendActivo() && (
            <span
              className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full"
              title="Los contactos con datos reales vienen de GHL; el resto son de la demo."
            >
              GHL conectado
            </span>
          )}
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


function PipelineTab() {
  const { contacts, openContact, cierreEnCursoMonto } = useClosurer();
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
          <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 h-10 px-4 py-2 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 shadow-md transition-all">
            <RefreshCw className="w-4 h-4 mr-2" />
            Sincronizar CRM
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
            <div className="text-4xl font-light tracking-tight">84</div>
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
            <div className="text-4xl font-light tracking-tight text-primary">42</div>
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
          const members = Object.values(contacts).filter((c) => c.stage === stageKey);
          const rows = members.filter(filterRow);
          const label =
            stageKey === "cierre"
              ? `${meta.label} · 🔥 ${money(cierreEnCursoMonto)} SOBRE LA MESA`
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
                <div className="inline-flex items-center border py-0.5 font-semibold transition-colors border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 ml-2 text-[10px] h-5 px-1.5 shadow-none rounded-full">
                  {meta.hiddenOffset + members.length}
                </div>
              </div>
              {rows.length === 0 ? (
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
  time: string;
  ampm: string;
  name: string;
  grade: Grade;
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
    name: "VALENTINA GOMEZ",
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
    time: "11:00", ampm: "AM", name: "JUAN PEREZ", grade: "C", duration: "45 min",
    hint: "11:00 AM tu hora · 11:30 AM hora del contacto", estadoCita: "confirmada",
    briefing: "Lead calificado vía Meta Ads. Busca escalar a $10k/mes pero tiene cuello de botella en prospección. Tiene capital disponible.",
    videoPre: { visto: true, pct: 87 },
    meetUrl: "https://meet.google.com/juan-perez-1100",
  },
  {
    time: "1:00", ampm: "PM", name: "MARTA PEREZ", grade: "B", duration: "45 min",
    hint: "1:00 PM tu hora · 1:30 PM hora del contacto", estadoCita: "reprogramada",
    meetUrl: "https://meet.google.com/marta-perez-1300",
  },
  {
    time: "3:00", ampm: "PM", name: "LUIS GOMEZ", grade: "D", duration: "45 min",
    hint: "3:00 PM tu hora · 3:30 PM hora del contacto", estadoCita: "pendiente",
    briefing: "Sin calificación previa registrada. Primera toma de contacto por voz.",
    videoPre: { visto: false },
    meetUrl: "https://meet.google.com/luis-gomez-1500",
  },
  {
    time: "5:00", ampm: "PM", name: "SOFIA SANCHEZ", grade: "B", duration: "45 min",
    hint: "5:00 PM tu hora · 5:30 PM hora del contacto", estadoCita: "confirmada",
    briefing: "Viene de un webinar. Le preocupa el tiempo de implementación más que el precio.",
    videoPre: { visto: true, pct: 64 },
    meetUrl: "https://meet.google.com/sofia-sanchez-1700",
  },
  {
    time: "7:00", ampm: "PM", name: "CARMEN GOMEZ", grade: "A", duration: "45 min",
    hint: "7:00 PM tu hora · 7:30 PM hora del contacto", estadoCita: "confirmada",
    meetUrl: "https://meet.google.com/carmen-gomez-1900",
  },
];

function AgendaTab() {
  const { contacts, openContact } = useClosurer();
  const schedule = SCHEDULE.filter((s) => !contacts[s.name]?.completedToday);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
              <h3 className="font-semibold text-sm capitalize">julio de 2026</h3>
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
              {Array.from({ length: LEADING_BLANKS }).map((_, i) => (
                <div key={`b${i}`} className="h-8 w-8 mx-auto" />
              ))}
              {Array.from({ length: 31 }).map((_, idx) => {
                const day = idx + 1;
                const today = day === TODAY;
                const dot = today
                  ? null
                  : SKY_DOTS.has(day)
                    ? "bg-sky-500"
                    : AMBER_DOTS.has(day)
                      ? "bg-amber-500"
                      : null;
                return (
                  <div
                    key={day}
                    className={cn(
                      "h-8 w-8 mx-auto flex items-center justify-center rounded-full text-xs transition-all cursor-pointer relative",
                      today
                        ? "bg-primary text-primary-foreground font-semibold shadow-md"
                        : "hover:bg-muted/50 text-foreground",
                    )}
                  >
                    {day}
                    {dot && (
                      <div className={cn("absolute bottom-1 w-1 h-1 rounded-full", dot)} />
                    )}
                  </div>
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
              {PROXIMOS.map((p) => (
                <div
                  key={p.label}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-xl cursor-pointer transition-colors",
                    p.active
                      ? "bg-primary/5 border border-primary/10"
                      : "hover:bg-muted/30 border border-transparent",
                  )}
                >
                  <span
                    className={cn(
                      "text-sm font-medium capitalize",
                      p.active ? "text-primary" : "text-foreground",
                    )}
                  >
                    {p.label}
                  </span>
                  <div
                    className={cn(
                      "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors border-none h-6",
                      p.active
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {p.calls}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Day schedule */}
        <div className="flex-1 w-full bg-card/50 backdrop-blur-sm border border-border/40 rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative">
          <div className="max-w-3xl mx-auto space-y-10">
            <div>
              <div className="flex items-center justify-between mb-6 sticky top-0 bg-card/95 backdrop-blur-md py-2 z-10">
                <div className="flex items-end gap-4">
                  <h3 className="text-2xl font-semibold tracking-tight capitalize">Hoy</h3>
                  <span className="text-muted-foreground font-medium mb-1">8 de julio</span>
                </div>
              </div>
              <div className="space-y-4 relative before:absolute before:inset-0 before:ml-[5.5rem] before:-translate-x-px before:h-full before:w-0.5 before:bg-border/40">
                {schedule.map((s) => {
                  const isOpen = expanded.has(s.name);
                  const estado = ESTADO_CITA_PILL[s.estadoCita];
                  return (
                    <div key={s.time} className="relative flex items-start gap-6 group">
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
                                onClick={() => openContact(s.name)}
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
                        <p className="text-xs text-muted-foreground opacity-70 mb-1">{s.hint}</p>

                        <div className={cn("grid transition-[grid-template-rows] duration-300 ease-in-out", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                          <div className="overflow-hidden">
                            {s.briefing && (
                              <div className="mt-3 mb-2 p-2.5 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-lg">
                                <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                                  <span className="font-semibold text-blue-700 dark:text-blue-400 mr-1">
                                    Briefing IA:
                                  </span>
                                  {s.briefing}
                                </p>
                                {s.videoPre && (
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
                                )}
                              </div>
                            )}
                            <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border/40">
                              <button
                                onClick={() => window.open(s.meetUrl, "_blank", "noopener,noreferrer")}
                                className="justify-center whitespace-nowrap ring-offset-background transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 py-2 rounded-xl h-9 px-5 text-xs font-medium bg-[#00796B] hover:bg-[#00695C] text-white border-0 shadow-sm flex items-center gap-2"
                              >
                                <Video className="w-4 h-4" />
                                Link del Meet
                              </button>
                              <button
                                onClick={() => openContact(s.name)}
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
  const { contacts, openContactName, closeContact, advance, addNota, resolveIntervention, setBotEstado, pinTask, completeTask, reviveTask } = useClosurer();
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
