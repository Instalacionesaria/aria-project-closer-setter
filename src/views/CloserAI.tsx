import { useState, createContext, useContext } from "react";
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
import ContactDrawer from "./ContactDrawer";

/** Provides a callback to open the shared contact drawer from any nested component. */
const OpenContactCtx = createContext<(name: string) => void>(() => {});

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type TabKey = "inicio" | "midia" | "pipeline" | "agenda";
type Grade = "A" | "B" | "C" | "D";

interface PipelineRow {
  name: string;
  grade: Grade;
  situacion: string;
  when: string;
  activity: string;
  starred?: boolean;
}

interface PipelineStage {
  name: string;
  count: number;
  dot: string;
  headerBg: string;
  labelColor: string;
  pill: string;
  rows: PipelineRow[];
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const gradeAvatar: Record<Grade, string> = {
  A: "bg-emerald-500/10 text-emerald-600",
  B: "bg-amber-500/10 text-amber-600",
  C: "bg-rose-500/10 text-rose-600",
  D: "bg-rose-500/10 text-rose-600",
};

function Avatar({ grade }: { grade: Grade }) {
  return (
    <div
      className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
        gradeAvatar[grade],
      )}
    >
      {grade}
    </div>
  );
}

/** Row of contact-status icons used across Mi Día and Pipeline. */
function StatusIcons({
  size = "w-3.5 h-3.5",
  gap = "gap-4",
  cal = true,
  phone = false,
  bot = false,
  alarm = false,
  dollar = false,
}: {
  size?: string;
  gap?: string;
  cal?: boolean;
  phone?: boolean;
  bot?: boolean;
  alarm?: boolean;
  dollar?: boolean;
}) {
  const items: Array<[LucideIcon, boolean]> = [
    [Calendar, cal],
    [Phone, phone],
    [Bot, bot],
    [AlarmClock, alarm],
    [DollarSign, dollar],
  ];
  return (
    <div className={cn("flex items-center shrink-0", gap)}>
      {items.map(([Icon, active], i) => (
        <div
          key={i}
          className={cn(
            "flex items-center gap-1 transition-colors",
            active ? "text-[#6b6980]" : "text-[#6b6980]/25",
          )}
        >
          <Icon className={size} />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header + tab bar                                                    */
/* ------------------------------------------------------------------ */

const TABS: Array<{ key: TabKey; label: string; icon: LucideIcon; badge?: string }> = [
  { key: "inicio", label: "Inicio", icon: House },
  { key: "midia", label: "Mi Día", icon: LayoutList, badge: "7" },
  { key: "pipeline", label: "Pipeline", icon: SquareKanban },
  { key: "agenda", label: "Agenda", icon: Calendar },
];

function Header({ tab, setTab }: { tab: TabKey; setTab: (t: TabKey) => void }) {
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
          {TABS.map(({ key, label, icon: Icon, badge }) => {
            const active = tab === key;
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

interface Kpi {
  label: string;
  icon: LucideIcon;
  value: string;
  extra: string;
  extraClass?: string;
}

const INICIO_KPIS: Kpi[] = [
  {
    label: "Cash Collected · Julio",
    icon: DollarSign,
    value: "$34,000",
    extra: "▲ $5,100",
    extraClass: "text-emerald-600 dark:text-emerald-400",
  },
  { label: "Ventas", icon: Target, value: "8", extra: "tasa 20.0%" },
  { label: "Acuerdos", icon: TrendingUp, value: "$2,000", extra: "4 leads" },
  { label: "Calls Mes", icon: PhoneCall, value: "80", extra: "20 semanales" },
  { label: "Show Rate", icon: Users, value: "60%", extra: "meta 70%" },
  {
    label: "Comisión",
    icon: DollarSign,
    value: "$3,400",
    extra: "Faltan $-400 para meta ≈ 0 ventas más",
  },
];

const INGRESOS: Array<{ mes: string; valor: number; label: string }> = [
  { mes: "Mar", valor: 0, label: "$0" },
  { mes: "Abr", valor: 8500, label: "$8.5k" },
  { mes: "May", valor: 17000, label: "$17k" },
  { mes: "Jun", valor: 25500, label: "$25.5k" },
  { mes: "Jul", valor: 34000, label: "$34k" },
];

const COCKPIT_STATS = [
  { l: "Ventas", v: "8", s: "tasa 20.0%" },
  { l: "Acuerdos", v: "$2,000", s: "4 leads" },
  { l: "Calls Mes", v: "80", s: "20 semanales" },
  { l: "Show rate", v: "60%", s: "meta 70%" },
];
const CHART = [
  { mes: "Abr", valor: 8500 },
  { mes: "May", valor: 17000 },
  { mes: "Jun", valor: 25500 },
  { mes: "Jul", valor: 34000 },
];
const Y_TICKS = ["$34k", "$25.5k", "$17k", "$8.5k", "$0"];

function InicioTab() {
  const max = 34000;
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
            <div className="text-6xl sm:text-[90px] font-light tracking-tighter mb-6 leading-[0.9] text-transparent bg-clip-text bg-gradient-to-br from-white via-[#F5D78D] to-[#C99738]">
              $34,000
            </div>
            <div className="flex flex-col gap-3 text-sm text-white/60 font-light mb-10">
              <p className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500/80 animate-pulse" />
                Cobrado real, no prometido <span className="text-white/20">|</span>{" "}
                <span className="text-green-400/90 font-medium">▲ $5,100</span>
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-4">
              {COCKPIT_STATS.map((x) => (
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
              <svg className="w-full h-full transform -rotate-90 relative z-10" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="2" />
                <circle
                  cx="50"
                  cy="50"
                  r="46"
                  fill="none"
                  stroke="url(#gold-gradient)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray="289"
                />
                <defs>
                  <linearGradient id="gold-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#FFE5A3" />
                    <stop offset="50%" stopColor="#D4AF37" />
                    <stop offset="100%" stopColor="#997A15" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
                <span className="text-3xl font-light text-white tracking-tight">$3,400</span>
                <span className="text-[9px] uppercase tracking-widest text-white/40 mt-1">Comisión</span>
              </div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 w-full text-center backdrop-blur-sm">
              <p className="text-xs font-light text-white/70 mb-1">
                Faltan <span className="text-white font-medium">$-400</span> para meta
              </p>
              <p className="text-sm font-medium text-[#D4AF37]">≈ 0 ventas más</p>
            </div>
          </div>
        </div>
      </div>

      {/* 28 tareas pendientes */}
      <div className="rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm p-4 sm:p-5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center text-red-500 shrink-0">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground mb-1">28 tareas pendientes</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="text-red-500 font-medium flex items-center gap-1">
                <span className="text-sm">🔥</span> 5 urgente
              </span>
              <span className="text-muted-foreground/30">•</span>
              <span className="text-blue-500 font-medium flex items-center gap-1">
                <span className="text-sm">💬</span> 11 espera
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
            {Y_TICKS.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <div className="flex-1 flex items-end justify-around border-l border-b border-border/30 pl-2">
            {CHART.map((c) => (
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
          Prototipo · datos demo · InmoLead AI — las acciones simulan los eventos que en producción
          vienen de GHL.
        </p>
      </div>
    </div>
  );
}

/* ================================================================== */
/* MI DÍA                                                              */
/* ================================================================== */

interface AgendaItem {
  time: string;
  name: string;
  grade: Grade;
  badge?: string;
  expanded?: boolean;
  briefing?: string;
  videoPre?: string;
  icons: { phone?: boolean; bot?: boolean; alarm?: boolean; dollar?: boolean };
}

const MIDIA_AGENDA: AgendaItem[] = [
  {
    time: "10:00",
    name: "JUAN PEREZ",
    grade: "C",
    badge: "EN 15 MIN",
    expanded: true,
    briefing:
      "Llamada agendada para hoy. El prospecto está muy interesado en automatizar su agencia.",
    videoPre: "✓ Vio el video pre-call (100%)",
    icons: { bot: true },
  },
  { time: "11:00", name: "MARTA PEREZ", grade: "B", icons: { bot: true } },
  { time: "12:00", name: "LUIS GOMEZ", grade: "D", icons: {} },
  { time: "13:00", name: "SOFIA SANCHEZ", grade: "B", icons: { bot: true } },
  { time: "14:00", name: "CARMEN GOMEZ", grade: "A", icons: { bot: true } },
];

interface Intervention {
  name: string;
  grade: Grade;
  situacion: string;
  pill: string;
  detail: string;
  highlighted?: boolean;
  detailClass?: string;
  daysBadge?: string;
  phone?: boolean;
}

const INTERVENTIONS: Intervention[] = [
  {
    name: "ARIEL MENDEZ",
    grade: "B",
    situacion: "No interesado • Precio",
    pill: "bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30",
    detail:
      "El usuario solicitó el enlace de pago pero la IA no lo detectó ni lo envió. Requiere intervención inmediata para no perder la venta.",
    highlighted: true,
    detailClass: "text-rose-700 dark:text-rose-400 font-medium",
    daysBadge: "Abierta hace 767 días",
    phone: true,
  },
  {
    name: "PEDRO GOMEZ",
    grade: "C",
    situacion: "No-show • Plantón",
    pill: "bg-orange-50 text-orange-700 border-orange-200/60 dark:bg-orange-500/20 dark:text-orange-300 dark:border-orange-500/30",
    detail: "venía muy seguro · plantó",
    detailClass: "text-muted-foreground",
  },
  {
    name: "ANA MARTINEZ",
    grade: "C",
    situacion: "No-show • Plantón",
    pill: "bg-orange-50 text-orange-700 border-orange-200/60 dark:bg-orange-500/20 dark:text-orange-300 dark:border-orange-500/30",
    detail: "venía muy seguro · plantó",
    detailClass: "text-muted-foreground",
  },
];

function MiDiaTab() {
  const openContact = useContext(OpenContactCtx);
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
            <span className="text-5xl font-light tracking-tight">30</span>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex items-center gap-1.5 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border border-red-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />5 requiere
                atención ya
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Three small KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {[
          {
            icon: CirclePause,
            value: "5",
            label: "Intervención urgente",
            bg: "bg-red-500/10",
            fg: "text-red-500",
            hover: "group-hover:text-red-500",
          },
          {
            icon: MessageCircle,
            value: "11",
            label: "Mensajes buzón general",
            bg: "bg-purple-500/10",
            fg: "text-purple-500",
            hover: "group-hover:text-purple-500",
          },
          {
            icon: RefreshCw,
            value: "12",
            label: "Seguimientos hoy",
            bg: "bg-yellow-500/10",
            fg: "text-yellow-600",
            hover: "group-hover:text-yellow-600",
          },
        ].map((c) => (
          <div
            key={c.label}
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
            6
          </span>
        </div>
        <div className="pl-3 border-l-[1.5px] border-blue-500/30 space-y-3 relative ml-1.5 py-0.5">
          {MIDIA_AGENDA.map((item, idx) => (
            <div
              key={item.time}
              className="relative group cursor-pointer flex flex-col pl-2 py-1 hover:bg-muted/30 rounded-lg transition-colors"
            >
              <div
                className={cn(
                  "absolute -left-[17.5px] top-[14px] w-2 h-2 rounded-full bg-blue-500 group-hover:scale-125 transition-transform",
                  idx === 0 ? "ring-4 ring-blue-500/20" : "ring-4 ring-background",
                )}
              />
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-xs text-blue-600 shrink-0 w-10">
                    {item.time}
                  </span>
                  <Avatar grade={item.grade} />
                  <span
                    onClick={() => openContact(item.name)}
                    className="font-semibold text-sm truncate uppercase flex items-center gap-2 cursor-pointer hover:text-primary transition-colors"
                  >
                    {item.name}
                    {item.badge && (
                      <span className="bg-rose-500/10 text-rose-600 dark:text-rose-400 text-[10px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider">
                        {item.badge}
                      </span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 pr-2">
                  {idx === 0 ? (
                    <button className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500 hover:bg-green-600 text-white rounded-full text-[10px] font-bold transition-all shadow-sm mr-2">
                      <Video className="w-3 h-3" />
                      <span>Unirse</span>
                    </button>
                  ) : (
                    <button className="flex items-center gap-1.5 px-2 py-1 text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 rounded-full transition-all mr-2">
                      <Video className="w-4 h-4" />
                    </button>
                  )}
                  <StatusIcons
                    gap="gap-2"
                    phone={item.icons.phone}
                    bot={item.icons.bot}
                    alarm={item.icons.alarm}
                    dollar={item.icons.dollar}
                  />
                  <button className="ml-2 text-muted-foreground hover:text-foreground transition-colors p-1 rounded-full hover:bg-muted/50">
                    <ChevronDown
                      className={cn(
                        "w-4 h-4 transition-transform duration-200",
                        idx === 0 && "rotate-180",
                      )}
                    />
                  </button>
                </div>
              </div>
              {item.expanded && (
                <div className="mt-2 ml-[52px] mr-2 p-2.5 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-lg animate-in slide-in-from-top-2 fade-in duration-200">
                  <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                    <span className="font-semibold text-blue-700 dark:text-blue-400 mr-1">
                      Briefing IA:
                    </span>
                    {item.briefing}
                  </p>
                  {item.videoPre && (
                    <p className="text-[11px] font-medium mt-2 text-emerald-600 dark:text-emerald-400">
                      {item.videoPre}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Intervenciones urgentes */}
      <div className="bg-card border border-border rounded-[2rem] overflow-hidden shadow-sm">
        <div className="bg-rose-500/10 px-6 py-4 border-b border-border flex items-center gap-3">
          <h3 className="text-[13px] font-semibold text-rose-900 dark:text-rose-300 uppercase tracking-wide">
            Intervenciones urgentes
          </h3>
          <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
            5
          </span>
        </div>
        <div className="divide-y divide-border">
          {INTERVENTIONS.map((iv) => (
            <div
              key={iv.name}
              className={cn(
                "p-6 transition-all duration-200 even:bg-muted/30 flex items-center justify-between group cursor-pointer",
                iv.highlighted
                  ? "bg-rose-500/5 hover:bg-rose-500/10 border-l-2 border-rose-500"
                  : "bg-background/50 hover:bg-muted/50",
              )}
            >
              <div className="w-full">
                <div className="w-full">
                  <div className="flex items-center justify-between w-full mb-1.5">
                    <div className="flex items-center gap-2">
                      <Avatar grade={iv.grade} />
                      <h4
                        onClick={() => openContact(iv.name)}
                        className="font-semibold text-[15px] truncate max-w-[150px] uppercase cursor-pointer hover:text-primary transition-colors"
                      >
                        {iv.name}
                      </h4>
                    </div>
                    <StatusIcons size="w-4 h-4" gap="gap-4" phone={iv.phone} />
                  </div>
                  <div className="flex items-center gap-2 mb-1.5 mt-1">
                    <span
                      className={cn(
                        "text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border",
                        iv.pill,
                      )}
                    >
                      {iv.situacion}
                    </span>
                  </div>
                </div>
                <p
                  className={cn(
                    "text-xs truncate max-w-[400px] mt-1",
                    iv.detailClass ?? "text-muted-foreground",
                  )}
                >
                  <span className="font-semibold text-foreground/70">
                    Falla detectada por IA:
                  </span>{" "}
                  {iv.detail}
                  {iv.daysBadge && (
                    <span className="ml-2 font-bold uppercase tracking-wider text-[10px] bg-rose-500/20 px-1.5 py-0.5 rounded-sm">
                      {iv.daysBadge}
                    </span>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/* PIPELINE                                                            */
/* ================================================================== */

const PIPELINE_STAGES: PipelineStage[] = [
  {
    name: "Agendado",
    count: 14,
    dot: "bg-indigo-500",
    headerBg: "bg-indigo-50/50 dark:bg-indigo-900/10",
    labelColor: "text-foreground",
    pill: "bg-sky-50 text-sky-700 border-sky-200/60 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-500/30",
    rows: [
      { name: "PABLO MUÑOZ", grade: "D", situacion: "Agendado", when: "hace 3 días", activity: "agendó" },
      { name: "LUIS FERNANDEZ", grade: "A", situacion: "Agendado", when: "hace 2 días", activity: "agendó" },
      {
        name: "JUAN PEREZ",
        grade: "C",
        situacion: "Agendado",
        when: "hace 1 día",
        activity: "Llamada agendada para hoy. El prospecto está muy interesado en automatizar su agencia.",
        starred: true,
      },
      { name: "MARTA PEREZ", grade: "B", situacion: "Agendado", when: "hace 1 día", activity: "agendó" },
    ],
  },
  {
    name: "Seguimiento",
    count: 24,
    dot: "bg-amber-500",
    headerBg: "bg-amber-50/30 dark:bg-amber-900/5",
    labelColor: "text-foreground",
    pill: "bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30",
    rows: [
      { name: "CARLOS RUIZ", grade: "A", situacion: "Seguimiento · A futuro", when: "hace 17 días", activity: "El prospecto tiene dudas sobre el ROI." },
      { name: "ELENA MARTIN", grade: "D", situacion: "Seguimiento · Muy seguro", when: "hace 15 días", activity: "respondió · esperando respuesta" },
      { name: "FERNANDO LOPEZ", grade: "C", situacion: "Seguimiento · Muy seguro", when: "hace 14 días", activity: "respondió · esperando respuesta" },
      { name: "DIEGO RODRIGUEZ", grade: "B", situacion: "Seguimiento · Muy seguro", when: "hace 14 días", activity: "respondió · esperando respuesta", starred: true },
    ],
  },
  {
    name: "Cierre en curso · 🔥 $2,000 SOBRE LA MESA",
    count: 4,
    dot: "bg-amber-500",
    headerBg: "bg-amber-50/50 dark:bg-amber-900/10",
    labelColor: "text-amber-700 dark:text-amber-500",
    pill: "bg-indigo-50 text-indigo-700 border-indigo-200/60 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30",
    rows: [
      { name: "ELENA ALVAREZ", grade: "B", situacion: "Acordó comprar, falta pago · $500", when: "hace 15 días", activity: "link enviado · sin pago" },
      { name: "LUCIA ROMERO", grade: "B", situacion: "Acordó comprar, falta pago · $500", when: "hace 8 días", activity: "link enviado · sin pago" },
      { name: "RAUL FERNANDEZ", grade: "A", situacion: "Acordó comprar, falta pago · $500", when: "hace 7 días", activity: "link enviado · sin pago" },
      { name: "MARTA MARTIN", grade: "B", situacion: "Acordó comprar, falta pago · $500", when: "hace 5 días", activity: "link enviado · sin pago" },
    ],
  },
  {
    name: "Ganado",
    count: 4,
    dot: "bg-emerald-500",
    headerBg: "bg-emerald-50/50 dark:bg-emerald-900/10",
    labelColor: "text-foreground",
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30",
    rows: [
      { name: "JORGE ALVAREZ", grade: "A", situacion: "Venta · Contado", when: "hace 8 días", activity: "" },
      { name: "DIEGO GOMEZ", grade: "C", situacion: "Venta · Contado", when: "hace 10 días", activity: "" },
      { name: "MIGUEL PEREZ", grade: "C", situacion: "Venta · Contado", when: "hace 12 días", activity: "" },
      { name: "SHIRLEY FAJARDO", grade: "A", situacion: "Venta · Contado", when: "hace 18 días", activity: "Todo bajo control. Venta cerrada." },
    ],
  },
  {
    name: "No-show",
    count: 26,
    dot: "bg-orange-500",
    headerBg: "bg-orange-50/50 dark:bg-orange-900/10",
    labelColor: "text-foreground",
    pill: "bg-orange-50 text-orange-700 border-orange-200/60 dark:bg-orange-500/20 dark:text-orange-300 dark:border-orange-500/30",
    rows: [
      { name: "ALFREDO", grade: "A", situacion: "No-show", when: "hace 20 días", activity: "La conversación se ha estancado. El usuario no responde." },
      { name: "LUCIA FERNANDEZ", grade: "C", situacion: "No-show · Plantón", when: "hace 8 días", activity: "venía muy seguro · plantó" },
      { name: "CARMEN MARTIN", grade: "A", situacion: "No-show · Plantón", when: "hace 8 días", activity: "venía muy seguro · plantó" },
      { name: "CARLOS PEREZ", grade: "C", situacion: "No-show · Plantón", when: "hace 8 días", activity: "venía muy seguro · plantó" },
    ],
  },
  {
    name: "Descalificado",
    count: 8,
    dot: "bg-rose-500",
    headerBg: "bg-muted/5",
    labelColor: "text-foreground",
    pill: "bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30",
    rows: [
      { name: "MIGUEL SANCHEZ", grade: "C", situacion: "No interesado · Precio", when: "hace 2 días", activity: "" },
      { name: "LAURA RODRIGUEZ", grade: "D", situacion: "No interesado · Precio", when: "hace 5 días", activity: "" },
      { name: "LAURA MUÑOZ", grade: "D", situacion: "No interesado · Precio", when: "hace 5 días", activity: "" },
      { name: "PABLO MORENO", grade: "D", situacion: "No interesado · Precio", when: "hace 5 días", activity: "" },
    ],
  },
];

function PipelineTab() {
  const openContact = useContext(OpenContactCtx);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [destacados, setDestacados] = useState(false);

  const chipBase = "w-7 h-7 rounded-full text-xs font-bold transition-all";

  const filterRow = (r: PipelineRow) =>
    (grade === null || r.grade === grade) && (!destacados || Boolean(r.starred));

  const reset = () => {
    setGrade(null);
    setDestacados(false);
  };

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
          <button className="flex h-10 items-center justify-between border px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 w-[160px] rounded-full bg-background border-border/60 hover:bg-muted/30 transition-colors">
            <span>Etapa: Todas</span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </button>
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
              $2,000
            </div>
            <p className="text-[10px] font-medium text-amber-700 mt-2 uppercase tracking-wider">
              En cierre en curso
            </p>
          </div>
        </div>
      </div>

      {/* Stage sections */}
      <div className="space-y-6 mt-8">
        {PIPELINE_STAGES.map((stage) => {
          const rows = stage.rows.filter(filterRow);
          if (rows.length === 0) return null;
          return (
            <div
              key={stage.name}
              className="bg-card/50 backdrop-blur-sm rounded-[2rem] border border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden"
            >
              <div
                className={cn(
                  "py-4 px-8 border-b border-border/40 flex items-center gap-2",
                  stage.headerBg,
                )}
              >
                <span className={cn("w-2 h-2 rounded-full", stage.dot)} />
                <span
                  className={cn(
                    "font-semibold text-[11px] uppercase tracking-widest",
                    stage.labelColor,
                  )}
                >
                  {stage.name}
                </span>
                <div className="inline-flex items-center border py-0.5 font-semibold transition-colors border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 ml-2 text-[10px] h-5 px-1.5 shadow-none rounded-full">
                  {stage.count}
                </div>
              </div>
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
                                className="w-40 truncate uppercase tracking-wide text-xs cursor-pointer hover:text-primary transition-colors"
                              >
                                {r.name}
                              </span>
                              <div className="flex items-center gap-3 shrink-0 ml-4">
                                <StatusIcons
                                  gap="gap-3"
                                  bot={
                                    r.situacion.startsWith("Agendado") ||
                                    r.situacion.startsWith("Seguimiento")
                                  }
                                />
                              </div>
                            </div>
                          </td>
                          <td className="p-4 align-middle px-8 py-4">
                            <div
                              className={cn(
                                "inline-flex items-center rounded-full py-0.5 h-6 text-[10px] uppercase tracking-wider font-semibold border-0 shadow-none px-2",
                                stage.pill,
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
  duration: string;
  tag?: string;
  hint: string;
  briefing?: string;
  join?: boolean;
}

const SCHEDULE: ScheduleSlot[] = [
  {
    time: "9:00",
    ampm: "AM",
    name: "VALENTINA GOMEZ",
    duration: "45 min",
    tag: "Masterclass",
    hint: "9:00 AM tu hora · 9:30 AM hora del contacto",
    briefing: "venta low-ticket cerrada exitosamente",
    join: true,
  },
  { time: "11:00", ampm: "AM", name: "JUAN PEREZ", duration: "45 min", hint: "11:00 AM tu hora · 11:30 AM hora del contacto" },
  { time: "1:00", ampm: "PM", name: "MARTA PEREZ", duration: "45 min", hint: "1:00 PM tu hora · 1:30 PM hora del contacto" },
  { time: "3:00", ampm: "PM", name: "LUIS GOMEZ", duration: "45 min", hint: "3:00 PM tu hora · 3:30 PM hora del contacto" },
  { time: "5:00", ampm: "PM", name: "SOFIA SANCHEZ", duration: "45 min", hint: "5:00 PM tu hora · 5:30 PM hora del contacto" },
  { time: "7:00", ampm: "PM", name: "CARMEN GOMEZ", duration: "45 min", hint: "7:00 PM tu hora · 7:30 PM hora del contacto" },
];

function AgendaTab() {
  const openContact = useContext(OpenContactCtx);
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
                {SCHEDULE.map((s) => (
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
                    <div className="flex-1 p-5 rounded-2xl border shadow-sm transition-all cursor-pointer bg-background border-border/60 hover:shadow-md hover:border-sky-200/60">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4
                            onClick={() => openContact(s.name)}
                            className="text-base font-semibold mb-1 text-foreground cursor-pointer hover:text-primary transition-colors"
                          >
                            {s.name}
                          </h4>
                          <div className="flex flex-col gap-1 text-xs text-muted-foreground mt-2">
                            <div className="flex items-center gap-3">
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
                            <span className="opacity-70 mt-1">{s.hint}</span>
                          </div>
                        </div>
                        <div className="inline-flex items-center rounded-full border font-semibold transition-colors border-transparent bg-sky-50 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300 border-none text-[10px] uppercase tracking-widest px-2.5 py-1">
                          AGENDADO
                        </div>
                      </div>
                      {s.briefing && (
                        <div className="mt-3 mb-2 p-2.5 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-lg">
                          <p className="text-[11px] text-muted-foreground/80 leading-relaxed">
                            <span className="font-semibold text-blue-700 dark:text-blue-400 mr-1">
                              Briefing IA:
                            </span>
                            {s.briefing}
                          </p>
                        </div>
                      )}
                      <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border/40">
                        {s.join ? (
                          <button className="justify-center whitespace-nowrap ring-offset-background transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 py-2 rounded-xl h-9 px-5 text-xs font-medium bg-[#00796B] hover:bg-[#00695C] text-white border-0 shadow-sm flex items-center gap-2">
                            <Video className="w-4 h-4" />
                            Unirse al Meet
                          </button>
                        ) : (
                          <button className="justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border bg-background hover:bg-accent py-2 rounded-xl h-9 px-3 text-muted-foreground hover:text-[#00796B] hover:border-[#00796B]/30 border-border/60 shadow-sm flex items-center gap-2">
                            <Video className="w-4 h-4" />
                          </button>
                        )}
                        <div>
                          <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap ring-offset-background transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border bg-background hover:text-accent-foreground py-2 rounded-xl h-9 px-4 text-xs font-medium border-border/60 hover:bg-muted/50">
                            Reprogramar
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
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

export default function CloserAI() {
  const [tab, setTab] = useState<TabKey>("inicio");
  const [openContact, setOpenContact] = useState<string | null>(null);

  return (
    <OpenContactCtx.Provider value={setOpenContact}>
      <div className="flex-1 flex flex-col overflow-hidden relative bg-background">
        <div className="flex-1 flex flex-col overflow-hidden bg-[#fcfcfd] dark:bg-background">
          <div className="flex-1 overflow-y-auto">
            <div className="p-8 max-w-[1600px] mx-auto space-y-8">
              <Header tab={tab} setTab={setTab} />
              {tab === "inicio" && <InicioTab />}
              {tab === "midia" && <MiDiaTab />}
              {tab === "pipeline" && <PipelineTab />}
              {tab === "agenda" && <AgendaTab />}
            </div>
          </div>
        </div>
        <ContactDrawer name={openContact} onClose={() => setOpenContact(null)} />
      </div>
    </OpenContactCtx.Provider>
  );
}
