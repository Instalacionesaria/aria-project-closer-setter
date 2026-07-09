import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  House,
  ListTodo,
  Kanban,
  Sparkles,
  TrendingUp,
  Banknote,
  CalendarDays,
  Activity,
  Target,
  ArrowRight,
  LayoutList,
  CirclePause,
  MessageSquare,
  MessageCircle,
  Bot,
  Calendar,
  Phone,
  AlarmClock,
  DollarSign,
  ChevronRight,
  ChevronDown,
  Search,
} from "lucide-react";
import { cn } from "../lib/utils";

type Tab = "inicio" | "midia" | "pipeline";

/* ------------------------------------------------------------------ */
/* Shared status indicators (calendar / calls / IA / cadence / LT sale) */
/* ------------------------------------------------------------------ */
type Indicator = { Icon: LucideIcon; active: boolean; title: string; label?: string };

function ind(Icon: LucideIcon, active: boolean, title: string, label?: string): Indicator {
  return { Icon, active, title, label };
}

function StatusIcons({ items }: { items: Indicator[] }) {
  return (
    <div className="flex items-center gap-3 shrink-0 ml-4 hidden sm:flex">
      {items.map((it, i) => (
        <div
          key={i}
          className={cn(
            "flex items-center gap-1 transition-colors",
            it.active ? "text-[#6b6980]" : "text-[#6b6980]/25"
          )}
          title={it.title}
        >
          <it.Icon className="w-3.5 h-3.5" />
          {it.label && (
            <span className="text-[10px] font-semibold text-[#6b6980]">{it.label}</span>
          )}
        </div>
      ))}
      <ChevronRight className="w-4 h-4 text-muted-foreground/50 ml-2" />
    </div>
  );
}

/* Indicator presets */
const INDICATORS = {
  urgent: [
    ind(Calendar, false, "Sin agendar"),
    ind(Phone, false, "Sin llamadas"),
    ind(Bot, false, "IA: paused"),
    ind(AlarmClock, false, "Sin cadencia"),
    ind(DollarSign, false, "Sin venta LT"),
  ],
  stalled: [
    ind(Calendar, false, "Sin agendar"),
    ind(Phone, false, "Sin llamadas"),
    ind(Bot, true, "IA: active"),
    ind(AlarmClock, false, "Sin cadencia"),
    ind(DollarSign, false, "Sin venta LT"),
  ],
  opportunity: [
    ind(Calendar, false, "Sin agendar"),
    ind(Phone, false, "Sin llamadas"),
    ind(Bot, false, "IA: paused"),
    ind(AlarmClock, false, "Sin cadencia"),
    ind(DollarSign, false, "Sin venta LT"),
  ],
  followup: [
    ind(Calendar, false, "Sin agendar"),
    ind(Phone, true, "1 llamadas", "1 ✓"),
    ind(Bot, false, "IA: inactive"),
    ind(AlarmClock, false, "Sin cadencia"),
    ind(DollarSign, false, "Venta LT: 5,000$"),
  ],
  qualifying: [
    ind(Calendar, false, "Sin agendar"),
    ind(Phone, false, "Sin llamadas"),
    ind(Bot, true, "IA: active"),
    ind(AlarmClock, false, "Sin cadencia"),
    ind(DollarSign, false, "Sin venta LT"),
  ],
  scheduled: [
    ind(Calendar, true, "Agendado"),
    ind(Phone, false, "Sin llamadas"),
    ind(Bot, true, "IA: active"),
    ind(AlarmClock, false, "Sin cadencia"),
    ind(DollarSign, false, "Sin venta LT"),
  ],
} satisfies Record<string, Indicator[]>;

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */
const TAB_BADGE = 14;

function Header({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const tabs: { key: Tab; label: string; Icon: LucideIcon; badge?: number }[] = [
    { key: "inicio", label: "Inicio", Icon: House },
    { key: "midia", label: "Mi Día", Icon: ListTodo, badge: TAB_BADGE },
    { key: "pipeline", label: "Pipeline", Icon: Kanban },
  ];

  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-8 border-b border-border/30">
      <div>
        <p className="text-[10px] font-bold tracking-[0.2em] text-primary uppercase mb-2 opacity-80">
          SETTER AI • DIEGO M.
        </p>
        {tab === "midia" ? (
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            <span className="font-light">
              Mi Día — <span className="text-muted-foreground">miércoles, 8 de julio</span>
            </span>
          </h1>
        ) : (
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {tab === "inicio" ? "Tu cockpit" : "Pipeline"}
          </h1>
        )}
      </div>
      <div className="flex items-center gap-3 pr-14 lg:pr-0">
        <div className="flex items-center gap-1.5 bg-card border border-border/40 rounded-full p-1.5 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.05)]">
          {tabs.map(({ key, label, Icon, badge }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  "inline-flex items-center justify-center gap-2 whitespace-nowrap ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 rounded-full px-5 h-9 text-xs font-medium transition-all",
                  active
                    ? "hover:bg-accent hover:text-accent-foreground bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <Icon className="w-4 h-4 mr-2" />
                {label}
                {badge !== undefined && (
                  <span
                    className={cn(
                      "ml-2 px-1.5 py-0.5 rounded-full text-[10px]",
                      active ? "bg-primary-foreground/20" : "bg-primary/10 text-primary"
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

/* ------------------------------------------------------------------ */
/* Tab: Inicio                                                         */
/* ------------------------------------------------------------------ */
const KPI_CARDS: {
  label: string;
  value: string;
  sub: string;
  Icon: LucideIcon;
  iconWrap: string;
  iconColor: string;
}[] = [
  {
    label: "Agendas generadas",
    value: "42",
    sub: "Mes en curso",
    Icon: CalendarDays,
    iconWrap: "bg-primary/5",
    iconColor: "text-primary",
  },
  {
    label: "Show rate",
    value: "78%",
    sub: "33 de 42 agendas se presentaron",
    Icon: Activity,
    iconWrap: "bg-primary/5",
    iconColor: "text-primary",
  },
  {
    label: "Oportunidades LT abiertas",
    value: "12",
    sub: "Leads derivados por el bot",
    Icon: Target,
    iconWrap: "bg-violet-500/10",
    iconColor: "text-violet-600",
  },
];

function InicioTab() {
  return (
    <div className="animate-in fade-in duration-700">
      {/* Commission hero */}
      <div className="flex flex-col gap-6 md:flex-row items-start justify-between bg-zinc-950 dark:bg-zinc-900 text-zinc-50 rounded-3xl p-8 shadow-2xl relative overflow-hidden mb-8">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-amber-500/10 rounded-full blur-[100px] -translate-y-1/2 translate-x-1/3 pointer-events-none" />
        <div className="relative z-10 space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 dark:bg-zinc-800 border border-zinc-800 dark:border-zinc-700 text-xs font-medium text-zinc-300">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            Mes en curso
          </div>
          <div>
            <h2 className="text-4xl font-light tracking-tight mb-2">Comisiones del mes</h2>
            <p className="text-zinc-400">Low-ticket y derivadas a closer</p>
          </div>
        </div>
        <div className="relative z-10 flex flex-col items-end gap-2 text-right">
          <div className="text-6xl font-light tracking-tighter text-amber-500 drop-shadow-[0_0_15px_rgba(245,158,11,0.3)]">
            $0
          </div>
          <div className="flex items-center gap-2 text-sm text-zinc-400 bg-zinc-900/50 px-3 py-1.5 rounded-lg border border-zinc-800">
            <TrendingUp className="w-4 h-4 text-emerald-500" />
            <span>+12% vs mes pasado</span>
          </div>
        </div>
      </div>

      {/* Two dark commission cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="border shadow-sm bg-zinc-950 dark:bg-zinc-900 border-zinc-800 text-zinc-50 p-6 rounded-2xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-zinc-400 uppercase tracking-wider font-semibold">
                Low-ticket cobradas
              </p>
              <div className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center border border-zinc-800">
                <Banknote className="w-4 h-4 text-amber-500" />
              </div>
            </div>
            <p className="text-3xl font-light">$0</p>
            <p className="text-xs text-zinc-500 mt-2">1 ventas directas</p>
          </div>
        </div>
        <div className="border shadow-sm bg-zinc-950 dark:bg-zinc-900 border-zinc-800 text-zinc-50 p-6 rounded-2xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-zinc-400 uppercase tracking-wider font-semibold">
                Diferidas por ventas originadas
              </p>
              <div className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center border border-zinc-800" />
            </div>
            <p className="text-3xl font-light">$1,000</p>
            <p className="text-xs text-zinc-500 mt-2">2 ventas de closer (sobre $10k total)</p>
          </div>
        </div>
      </div>

      {/* Three light KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {KPI_CARDS.map((c) => (
          <div
            key={c.label}
            className="border text-card-foreground bg-card border-border/40 p-6 rounded-2xl shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                {c.label}
              </p>
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center",
                  c.iconWrap
                )}
              >
                <c.Icon className={cn("w-4 h-4", c.iconColor)} />
              </div>
            </div>
            <p className="text-3xl font-light text-foreground">{c.value}</p>
            <p className="text-xs text-muted-foreground mt-2">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Tasks strip */}
      <button className="w-full group relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500/10 to-amber-500/5 border border-amber-500/20 p-6 transition-all hover:border-amber-500/40 text-left shadow-sm">
        <div className="flex items-center justify-between relative z-10">
          <div>
            <p className="text-amber-600 dark:text-amber-500 font-medium mb-1 text-lg">
              14 tareas te esperan hoy
            </p>
            <p className="text-sm text-muted-foreground">
              1 urgencia · 4 estancadas · 9 seguimientos
            </p>
          </div>
          <div className="flex items-center text-amber-600 dark:text-amber-500 font-medium group-hover:translate-x-1 transition-transform">
            Ejecutar Mi Día
            <ArrowRight className="ml-2 w-5 h-5" />
          </div>
        </div>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab: Mi Día                                                         */
/* ------------------------------------------------------------------ */
type Tag = { label: string; cls: string };
const TAG_SOURCE =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground bg-muted/50 text-[10px] uppercase font-semibold";
const TAG_CYAN =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-[10px] uppercase font-semibold bg-cyan-50 text-cyan-700 border-cyan-200/60 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/30";
const TAG_VIOLET =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 bg-violet-500/10 text-violet-700 border-violet-500/20 text-[10px] uppercase font-semibold";
const TAG_AMBER =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-[10px] uppercase font-semibold bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30";

const AVATAR = {
  none: "bg-muted text-muted-foreground",
  rose: "bg-rose-500/10 text-rose-600",
  amber: "bg-amber-500/10 text-amber-600",
  emerald: "bg-emerald-500/10 text-emerald-600",
} as const;

type Lead = {
  initial: string;
  avatar: keyof typeof AVATAR;
  name: string;
  phone: string;
  tags: Tag[];
  subtitle: string;
  botPrefix?: boolean;
  overdue?: string;
  indicators: Indicator[];
};

function LeadRow({ lead, rowCls }: { lead: Lead; rowCls: string }) {
  return (
    <div
      className={cn(
        "p-6 transition-all duration-200 flex items-center justify-between group cursor-pointer",
        rowCls
      )}
    >
      <div className="w-full flex items-center justify-between">
        <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 w-full">
          <div className="flex items-center gap-4 min-w-[200px]">
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                AVATAR[lead.avatar]
              )}
            >
              {lead.initial}
            </div>
            <div className="flex flex-col">
              <span className="font-semibold text-foreground text-sm uppercase flex items-center gap-2">
                {lead.name}
              </span>
              <span className="text-xs text-muted-foreground">{lead.phone}</span>
            </div>
          </div>
          <div className="flex-1 flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              {lead.tags.map((t, i) => (
                <div key={i} className={t.cls}>
                  {t.label}
                </div>
              ))}
            </div>
            <p
              className={cn(
                "text-xs text-muted-foreground truncate max-w-[400px] mt-1",
                lead.botPrefix && "flex items-center gap-1.5"
              )}
            >
              {lead.botPrefix && <Bot className="w-3.5 h-3.5 opacity-70" />}
              {lead.subtitle}
            </p>
            {lead.overdue && (
              <p className="text-xs text-rose-600 dark:text-rose-400 font-semibold mt-1">
                {lead.overdue}
              </p>
            )}
          </div>
        </div>
        <StatusIcons items={lead.indicators} />
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  headerCls,
  titleCls,
  badgeCls,
  leads,
  rowCls,
}: {
  title: string;
  count: number;
  headerCls: string;
  titleCls: string;
  badgeCls: string;
  leads: Lead[];
  rowCls: string;
}) {
  return (
    <div className="bg-card border border-border rounded-[2rem] overflow-hidden shadow-sm mb-8">
      <div className={cn("px-6 py-4 border-b border-border flex items-center gap-3", headerCls)}>
        <h3 className={cn("text-[13px] font-semibold uppercase tracking-wide", titleCls)}>
          {title}
        </h3>
        <span
          className={cn(
            "text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm",
            badgeCls
          )}
        >
          {count}
        </span>
      </div>
      <div className="divide-y divide-border">
        {leads.map((lead, i) => (
          <LeadRow key={i} lead={lead} rowCls={rowCls} />
        ))}
      </div>
    </div>
  );
}

const URGENT: Lead[] = [
  {
    initial: "B",
    avatar: "amber",
    name: "CARLA MENDOZA",
    phone: "34 600 111 222",
    tags: [
      { label: "Meta Ads", cls: TAG_SOURCE },
      { label: "URGENCIA", cls: TAG_CYAN },
    ],
    subtitle: "Fallo en webhook de Zapier al validar email",
    botPrefix: true,
    indicators: INDICATORS.urgent,
  },
];

const STALLED: Lead[] = [
  {
    initial: "-",
    avatar: "none",
    name: "JORGE RUIZ",
    phone: "57 300 999 8888",
    tags: [
      { label: "VSL opt-in", cls: TAG_SOURCE },
      { label: "EN CALIFICACIÓN", cls: TAG_CYAN },
    ],
    subtitle: "se apagó hace 11h · preguntó precio · se apagó hace 6h",
    indicators: INDICATORS.stalled,
  },
];

const OPPORTUNITIES: Lead[] = [
  {
    initial: "C",
    avatar: "rose",
    name: "PEDRO SANCHEZ",
    phone: "54 911 1234 5678",
    tags: [
      { label: "Meta Ads", cls: TAG_SOURCE },
      { label: "Derivado a LT", cls: TAG_VIOLET },
    ],
    subtitle: "sin capital para el programa · interesado en arrancar · hace 7h",
    botPrefix: true,
    indicators: INDICATORS.opportunity,
  },
];

const FOLLOWUP_NAMES: { initial: string; avatar: keyof typeof AVATAR; name: string; phone: string }[] =
  [
    { initial: "C", avatar: "rose", name: "FERNANDO LOPEZ", phone: "+52 55 4225 6686" },
    { initial: "A", avatar: "emerald", name: "ELENA MARTIN", phone: "+52 55 9539 7100" },
    { initial: "A", avatar: "emerald", name: "MIGUEL RUIZ", phone: "+52 55 5633 4783" },
    { initial: "C", avatar: "rose", name: "PEDRO ALVAREZ", phone: "+52 55 8678 4587" },
    { initial: "D", avatar: "rose", name: "LAURA ALVAREZ", phone: "+52 55 2116 8027" },
    { initial: "B", avatar: "amber", name: "LUIS PEREZ", phone: "+52 55 7484 4190" },
    { initial: "B", avatar: "amber", name: "ELENA ROMERO", phone: "+52 55 3311 2020" },
    { initial: "C", avatar: "rose", name: "PEDRO MARTINEZ", phone: "+52 55 6644 1188" },
  ];

const FOLLOWUPS: Lead[] = FOLLOWUP_NAMES.map((f) => ({
  ...f,
  tags: [
    { label: "Meta Ads", cls: TAG_SOURCE },
    { label: "SEGUIMIENTO · MUY SEGURO", cls: TAG_AMBER },
  ],
  subtitle: "respondió · esperando respuesta",
  overdue: "Vencido hace 2 días",
  indicators: INDICATORS.followup,
}));

function MiDiaTab() {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Summary card */}
      <div className="bg-card/50 backdrop-blur-sm border border-border/40 rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex flex-col justify-center transition-all hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
        <div className="flex items-center gap-2 text-muted-foreground mb-4">
          <LayoutList className="w-4 h-4 opacity-50" />
          <span className="text-[11px] font-semibold tracking-[0.15em] uppercase">
            Tareas de Hoy
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-5xl font-light tracking-tight">11</span>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center gap-1.5 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border border-red-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />1 requiere atención
              ya
            </div>
          </div>
        </div>
      </div>

      {/* Stat mini cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(
          [
            { Icon: CirclePause, wrap: "bg-red-500/10", color: "text-red-500", value: "1", label: "Intervención urgente", hover: "group-hover:text-red-500" },
            { Icon: MessageSquare, wrap: "bg-amber-500/10", color: "text-amber-500", value: "1", label: "Estancadas", hover: "group-hover:text-amber-500" },
            { Icon: Target, wrap: "bg-violet-500/10", color: "text-violet-500", value: "1", label: "Oportunidades LT", hover: "group-hover:text-violet-500" },
            { Icon: MessageCircle, wrap: "bg-blue-500/10", color: "text-blue-500", value: "0", label: "Respondieron", hover: "group-hover:text-blue-500" },
          ] as const
        ).map((s) => (
          <div
            key={s.label}
            className="flex flex-col p-4 rounded-[1.5rem] bg-card/50 backdrop-blur-sm border border-border/40 hover:bg-muted/30 transition-all cursor-pointer group shadow-sm"
          >
            <div className="flex items-center justify-between mb-2">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center shadow-inner",
                  s.wrap,
                  s.color
                )}
              >
                <s.Icon className="w-4 h-4" />
              </div>
              <span className={cn("text-xl font-light", s.color)}>{s.value}</span>
            </div>
            <span
              className={cn(
                "text-[11px] font-medium text-foreground transition-colors uppercase tracking-wide leading-tight",
                s.hover
              )}
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {/* Sections */}
      <Section
        title="Intervenciones urgentes"
        count={URGENT.length}
        headerCls="bg-rose-500/10"
        titleCls="text-rose-900 dark:text-rose-300"
        badgeCls="bg-rose-500"
        leads={URGENT}
        rowCls="bg-background/50 hover:bg-muted/50 even:bg-muted/30"
      />
      <Section
        title="Conversaciones estancadas"
        count={STALLED.length}
        headerCls="bg-amber-500/15"
        titleCls="text-amber-900 dark:text-amber-300"
        badgeCls="bg-amber-500"
        leads={STALLED}
        rowCls="bg-amber-50/30 dark:bg-amber-900/10 hover:bg-amber-50/50 dark:hover:bg-amber-900/20 even:bg-amber-50/40 dark:even:bg-amber-900/15"
      />
      <Section
        title="Oportunidades low-ticket"
        count={OPPORTUNITIES.length}
        headerCls="bg-violet-500/10"
        titleCls="text-violet-900 dark:text-violet-300"
        badgeCls="bg-violet-500"
        leads={OPPORTUNITIES}
        rowCls="bg-background/50 hover:bg-muted/50 even:bg-muted/30"
      />
      <Section
        title="Seguimientos"
        count={FOLLOWUPS.length}
        headerCls="bg-amber-500/15"
        titleCls="text-amber-900 dark:text-amber-300"
        badgeCls="bg-amber-500"
        leads={FOLLOWUPS}
        rowCls="bg-rose-500/5 hover:bg-rose-500/10 even:bg-muted/30"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab: Pipeline                                                       */
/* ------------------------------------------------------------------ */
type PipelineLead = {
  initial: string;
  avatar: keyof typeof AVATAR;
  name: string;
  situation: string;
  activityMain: string;
  activityMainMuted?: boolean;
  activitySub: string;
  indicators: Indicator[];
};

type Stage = {
  name: string;
  dotCls: string;
  headerCls: string;
  rowBg: string;
  leads: PipelineLead[];
};

const STAGES: Stage[] = [
  {
    name: "En Calificación",
    dotCls: "bg-primary/40",
    headerCls: "bg-muted/5",
    rowBg: "bg-amber-50/30 dark:bg-amber-900/10",
    leads: [
      {
        initial: "-",
        avatar: "none",
        name: "JORGE RUIZ",
        situation: "En Calificación",
        activityMain: "se apagó hace 1 día",
        activityMainMuted: true,
        activitySub: "preguntó precio · se apagó hace 6h",
        indicators: INDICATORS.qualifying,
      },
    ],
  },
  {
    name: "Agendado",
    dotCls: "bg-emerald-500",
    headerCls: "bg-emerald-50/50 dark:bg-emerald-900/10",
    rowBg: "bg-transparent",
    leads: [
      { initial: "D", avatar: "rose", name: "PABLO MUÑOZ", situation: "Agendado", activityMain: "hace 3 días", activitySub: "agendó", indicators: INDICATORS.scheduled },
      { initial: "A", avatar: "emerald", name: "LUIS FERNANDEZ", situation: "Agendado", activityMain: "hace 2 días", activitySub: "agendó", indicators: INDICATORS.scheduled },
      { initial: "C", avatar: "rose", name: "JUAN PEREZ", situation: "Agendado", activityMain: "hace 1 día", activitySub: "agendó", indicators: INDICATORS.scheduled },
      { initial: "B", avatar: "amber", name: "MARTA PEREZ", situation: "Agendado", activityMain: "hace 1 día", activitySub: "Llamada agendada para hoy. El prospecto está muy interesado en automatizar su agencia.", indicators: INDICATORS.scheduled },
      { initial: "D", avatar: "rose", name: "LUIS GOMEZ", situation: "Agendado", activityMain: "hace 1 día", activitySub: "agendó", indicators: INDICATORS.scheduled },
      { initial: "B", avatar: "amber", name: "SOFIA SANCHEZ", situation: "Agendado", activityMain: "hace 1 día", activitySub: "agendó", indicators: INDICATORS.scheduled },
    ],
  },
];

function PipelineRow({ lead, rowBg }: { lead: PipelineLead; rowBg: string }) {
  return (
    <tr
      className={cn(
        "data-[state=selected]:bg-muted transition-all duration-200 border-b border-border/30 group cursor-pointer hover:bg-muted/10",
        rowBg
      )}
    >
      <td className="p-4 align-middle font-medium whitespace-nowrap px-8 py-4">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
              AVATAR[lead.avatar]
            )}
          >
            {lead.initial}
          </div>
          <span className="w-40 truncate uppercase tracking-wide text-xs">{lead.name}</span>
          <StatusIcons items={lead.indicators} />
        </div>
      </td>
      <td className="p-4 align-middle px-8 py-4">
        <div className="inline-flex items-center rounded-full py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 h-6 text-[10px] uppercase tracking-wider font-semibold border-0 shadow-none px-2 bg-muted/50 text-muted-foreground">
          {lead.situation}
        </div>
      </td>
      <td className="p-4 align-middle px-8 py-4">
        <div className="flex flex-col">
          <span
            className={cn(
              "text-xs font-medium",
              lead.activityMainMuted ? "text-muted-foreground" : "text-foreground"
            )}
          >
            {lead.activityMain}
          </span>
          <span
            className="text-[10px] text-muted-foreground truncate max-w-[200px]"
            title={lead.activitySub}
          >
            {lead.activitySub}
          </span>
        </div>
      </td>
      <td className="p-4 align-middle px-8 py-4 text-right">
        <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </td>
    </tr>
  );
}

function StageCard({ stage }: { stage: Stage }) {
  return (
    <div className="bg-card/50 backdrop-blur-sm rounded-[2rem] border border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
      <div className={cn("py-4 px-8 border-b border-border/40 flex items-center gap-2", stage.headerCls)}>
        <span className={cn("w-2 h-2 rounded-full", stage.dotCls)} />
        <span className="font-semibold text-[11px] uppercase tracking-widest text-foreground">
          {stage.name}
        </span>
        <div className="inline-flex items-center border py-0.5 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 ml-2 text-[10px] h-5 px-1.5 shadow-none rounded-full">
          {stage.leads.length}
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="relative w-full overflow-auto">
          <table className="w-full caption-bottom text-sm">
            <thead className="[&_tr]:border-b bg-transparent">
              <tr className="transition-colors data-[state=selected]:bg-muted border-b border-border/40 hover:bg-transparent">
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
              {stage.leads.map((lead, i) => (
                <PipelineRow key={i} lead={lead} rowBg={stage.rowBg} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PipelineTab() {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Filter bar */}
      <div className="flex justify-between items-center bg-muted/10 p-4 rounded-2xl border border-border/40">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex h-10 items-center justify-between border px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 w-[140px] rounded-full bg-background border-border/60 hover:bg-muted/30 transition-colors"
          >
            <span>Todos</span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </button>
          <button
            type="button"
            className="flex h-10 items-center justify-between border px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 w-[160px] rounded-full bg-background border-border/60 hover:bg-muted/30 transition-colors"
          >
            <span>Etapa: Todas</span>
            <ChevronDown className="h-4 w-4 opacity-50" />
          </button>
          <div className="flex items-center gap-1.5 bg-background border border-border/60 rounded-full p-1">
            {["A", "B", "C"].map((g) => (
              <button
                key={g}
                className="w-7 h-7 rounded-full text-xs font-bold transition-all text-muted-foreground hover:bg-muted"
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <div className="relative w-[280px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            className="flex w-full border px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm pl-9 h-9 rounded-full bg-background border-border/60"
            placeholder="Buscar por nombre o teléfono..."
          />
        </div>
      </div>

      {/* Stages */}
      <div className="space-y-6 mt-8">
        {STAGES.map((stage) => (
          <StageCard key={stage.name} stage={stage} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */
export default function SetterView() {
  const [tab, setTab] = useState<Tab>("inicio");

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin bg-[#fcfcfd] dark:bg-background">
      <div className="p-8 max-w-[1600px] mx-auto space-y-8">
        <Header tab={tab} setTab={setTab} />
        {tab === "inicio" && <InicioTab />}
        {tab === "midia" && <MiDiaTab />}
        {tab === "pipeline" && <PipelineTab />}
      </div>
    </div>
  );
}
