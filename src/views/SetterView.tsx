import { useEffect, useState } from "react";
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
  Video,
  Pin,
  Clock,
} from "lucide-react";
import { cn } from "../lib/utils";
import ContactDrawer from "./ContactDrawer";
import { botIconVisual, countCallsContestadas, countSalesCalls, type BotEstado, type Grade } from "../lib/closerStore";
import { fetchUrgentesSetter } from "../lib/api";
import {
  useSetter,
  TAG_CLS_BY_TONE,
  setterPendingTasksBreakdown,
  type SetterContact,
  type SetterStageKey,
  type SetterTagTone,
  type Canal,
} from "../lib/setterStore";
import { useAgentAudit } from "../lib/agentAuditStore";
import { CADENCIA, registrarReloj } from "../lib/polling";

type Tab = "inicio" | "midia" | "pipeline";
const TAB_LABEL: Record<Tab, string> = { inicio: "Inicio", midia: "Mi Día", pipeline: "Pipeline" };

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

function Header({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  // § ciclo de vida de tareas en Mi Día (2026-07-11): mismo `setterPendingTasksBreakdown()` que usan
  // el header de Mi Día y el puente de Inicio — antes este badge era un "14" hardcodeado, sin relación
  // con la cuenta real (que además tenía DOS fórmulas distintas entre Inicio y Mi Día).
  const { contacts } = useSetter();
  const midiaBadge = setterPendingTasksBreakdown(contacts).total;
  const tabs: { key: Tab; label: string; Icon: LucideIcon; badge?: number }[] = [
    { key: "inicio", label: "Inicio", Icon: House },
    { key: "midia", label: "Mi Día", Icon: ListTodo, badge: midiaBadge > 0 ? midiaBadge : undefined },
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
const money = (n: number) => `$${n.toLocaleString("es-AR")}`;

function InicioTab({ onGoToMiDia }: { onGoToMiDia: () => void }) {
  const { contacts, cockpit } = useSetter();
  // § ciclo de vida de tareas en Mi Día (2026-07-11): misma fórmula que el badge del nav y el header
  // de Mi Día (antes esta fórmula omitía Oportunidades LT y Respondieron, y el nav tenía un "14" fijo
  // sin relación con ninguna de las dos — tres números distintos para "lo mismo").
  const tareas = setterPendingTasksBreakdown(contacts);
  const { urgentes: urgentesN, estancadas: estancadasN, oportunidades: oportunidadesN, respondieron: respondieronN, seguimientosHoy: seguimientosN, total: tareasHoy } = tareas;

  // § correcciones dashboards (2026-07-11): las 3 tarjetas KPI livianas ahora derivan del cockpit
  // — "Agendas generadas" (ambigua, mezclaba bot+setter) se separó en dos tarjetas reales.
  const KPI_CARDS: { label: string; value: string; sub: string; Icon: LucideIcon; iconWrap: string; iconColor: string }[] = [
    {
      label: "Agendas automáticas",
      value: String(cockpit.agendasAutomaticas),
      sub: "El bot agendó solo (sin vos)",
      Icon: CalendarDays,
      iconWrap: "bg-muted",
      iconColor: "text-muted-foreground",
    },
    {
      label: "Agendas generadas por ti",
      value: String(cockpit.agendasGeneradas),
      sub: "Rescatadas — tu mérito real",
      Icon: CalendarDays,
      iconWrap: "bg-primary/5",
      iconColor: "text-primary",
    },
    {
      label: "Show rate",
      value: `${cockpit.showRatePct}%`,
      sub: `${cockpit.showRateNum} de ${cockpit.showRateDen} agendas se presentaron`,
      Icon: Activity,
      iconWrap: "bg-primary/5",
      iconColor: "text-primary",
    },
    {
      label: "Oportunidades LT abiertas",
      value: String(cockpit.oportunidadesLT),
      sub: "Leads derivados por el bot",
      Icon: Target,
      iconWrap: "bg-violet-500/10",
      iconColor: "text-violet-600",
    },
  ];

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
            {money(cockpit.comisionTotal)}
          </div>
          {/* § correcciones dashboards (2026-07-11): nunca mostrar una comparación porcentual sin una base real que comparar — mismo criterio que la guardia de "Meta superada" del closer. */}
          {cockpit.comisionTotal > 0 && (
            <div className="flex items-center gap-2 text-sm text-zinc-400 bg-zinc-900/50 px-3 py-1.5 rounded-lg border border-zinc-800">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <span>+12% vs mes pasado</span>
            </div>
          )}
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
            <p className="text-3xl font-light">{money(cockpit.comisionLT)}</p>
            <p className="text-xs text-zinc-500 mt-2">{cockpit.ltVentasCount} ventas directas</p>
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
            <p className="text-3xl font-light">{money(cockpit.comisionDiferida)}</p>
            <p className="text-xs text-zinc-500 mt-2">{cockpit.diferidaVentasCount} ventas de closer (sobre {money(cockpit.diferidaBruto)} total)</p>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
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
      <button
        onClick={onGoToMiDia}
        className="w-full group relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500/10 to-amber-500/5 border border-amber-500/20 p-6 transition-all hover:border-amber-500/40 text-left shadow-sm"
      >
        <div className="flex items-center justify-between relative z-10">
          <div>
            <p className="text-amber-600 dark:text-amber-500 font-medium mb-1 text-lg">
              {tareasHoy} tareas te esperan hoy
            </p>
            <p className="text-sm text-muted-foreground">
              {[
                urgentesN > 0 && `${urgentesN} urgencia`,
                estancadasN > 0 && `${estancadasN} estancadas`,
                oportunidadesN > 0 && `${oportunidadesN} oportunidades LT`,
                respondieronN > 0 && `${respondieronN} buzón`,
                seguimientosN > 0 && `${seguimientosN} seguimientos`,
              ].filter(Boolean).join(" · ")}
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
/* Tab: Mi Día — estilos y helpers compartidos                        */
/* ------------------------------------------------------------------ */
const TAG_SOURCE = TAG_CLS_BY_TONE.source;

const AVATAR = {
  none: "bg-muted text-muted-foreground",
  rose: "bg-rose-500/10 text-rose-600",
  amber: "bg-amber-500/10 text-amber-600",
  emerald: "bg-emerald-500/10 text-emerald-600",
} as const;

function avatarForGrade(grade?: Grade): keyof typeof AVATAR {
  if (grade === "A") return "emerald";
  if (grade === "B") return "amber";
  if (grade === "C" || grade === "D") return "rose";
  return "none";
}

/** Iconos de estado por contacto — mismo patrón que MiDiaRow en CloserAI.tsx (dinámico, no presets, § auditoría 2026-07-10). */
function ContactIcons({ contact }: { contact: SetterContact }) {
  const hasBot = contact.canal !== "instagram";
  const v = botIconVisual(hasBot ? contact.botEstado ?? "activo" : undefined);
  const callsCount = countCallsContestadas(contact.llamadas);
  const salesCallsCount = countSalesCalls(contact.llamadas);
  return (
    <div className="flex items-center gap-3 shrink-0 ml-4 hidden sm:flex">
      {salesCallsCount > 0 ? (
        <div className="flex items-center gap-0.5 text-[11px] font-semibold text-[#6b6980]" title="Reuniones con el closer">
          <Video className="w-3.5 h-3.5" />
          {salesCallsCount}
        </div>
      ) : (
        <div className="flex items-center gap-1 text-[#6b6980]/25" title="Sin reuniones con el closer">
          <Video className="w-3.5 h-3.5" />
        </div>
      )}
      <div
        className={cn("flex items-center gap-1", contact.agendaFecha ? "text-[#6b6980]" : "text-[#6b6980]/25")}
        title={contact.agendaFecha ? `Agendado ${contact.agendaFecha}` : "Sin agendar"}
      >
        <Calendar className="w-3.5 h-3.5" />
      </div>
      {callsCount > 0 ? (
        <div className="flex items-center gap-0.5 text-[11px] font-semibold text-[#6b6980]" title="Contestó">
          <Phone className="w-3.5 h-3.5" />
          {callsCount}✓
        </div>
      ) : (
        <div className="flex items-center gap-1 text-[#6b6980]/25" title="Sin llamadas">
          <Phone className="w-3.5 h-3.5" />
        </div>
      )}
      <div className={cn("flex items-center gap-0.5 text-[11px] font-semibold", v.className)} title={v.title}>
        <Bot className="w-3.5 h-3.5" />
        {v.label}
      </div>
      <div className={cn("flex items-center gap-1", contact.seguimientoAutomaticoActivo ? "text-[#6b6980]" : "text-[#6b6980]/25")} title={contact.seguimientoAutomaticoActivo ? "Seguimiento automático activo" : "Sin seguimiento activo"}>
        <AlarmClock className="w-3.5 h-3.5" />
      </div>
      <div className={cn("flex items-center gap-1", contact.monto ? "text-emerald-600 dark:text-emerald-400" : "text-[#6b6980]/25")} title={contact.monto ? `Venta $${contact.monto}` : "Sin venta LT"}>
        <DollarSign className="w-3.5 h-3.5" />
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground/50 ml-2" />
    </div>
  );
}

/** Píldora gris/neutral para Completadas Hoy — mismo shape que TAG_* pero sin color de tono (regla §20.C). */
const TAG_MUTED =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] uppercase font-semibold bg-muted text-muted-foreground border-border";

function LeadRow({
  contact,
  rowCls,
  onOpen,
  completed = false,
}: {
  contact: SetterContact;
  rowCls: string;
  onOpen: (name: string) => void;
  /** Completadas Hoy: fila atenuada + nombre tachado, pero tags e iconos SIGUEN visibles (regla de Francisco, 2026-07-10). */
  completed?: boolean;
}) {
  const pinned = !completed && contact.pinned;
  return (
    <div
      onClick={() => onOpen(contact.name)}
      className={cn(
        "p-6 transition-all duration-200 flex items-center justify-between group cursor-pointer",
        completed ? "opacity-75 hover:opacity-100" : "",
        pinned ? "bg-amber-500/5 hover:bg-amber-500/10 border-l-2 border-amber-400" : rowCls
      )}
    >
      <div className="w-full flex items-center justify-between">
        <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 w-full">
          <div className="flex items-center gap-4 min-w-[200px]">
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                AVATAR[avatarForGrade(contact.grade)]
              )}
            >
              {contact.grade ?? "-"}
            </div>
            <div className="flex flex-col">
              <span
                className={cn(
                  "font-semibold text-foreground text-sm uppercase flex items-center gap-1.5",
                  completed && "line-through decoration-muted-foreground/60 text-muted-foreground"
                )}
              >
                {contact.name}
                {pinned && <Pin className="w-3 h-3 text-amber-500 shrink-0" />}
              </span>
              {pinned && (
                <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400 w-fit">
                  <Clock className="w-2.5 h-2.5" /> Le debes respuesta
                </span>
              )}
              <span className="text-xs text-muted-foreground">{contact.phone}</span>
            </div>
          </div>
          <div className="flex-1 flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className={TAG_SOURCE}>{contact.fuente}</div>
              <div className={completed ? TAG_MUTED : TAG_CLS_BY_TONE[contact.situacionTone]}>{contact.situacion}</div>
            </div>
            <p
              className={cn(
                "text-xs text-muted-foreground truncate max-w-[400px] mt-1",
                contact.botPrefix && "flex items-center gap-1.5"
              )}
            >
              {contact.botPrefix && <Bot className="w-3.5 h-3.5 opacity-70" />}
              {contact.subtitle}
            </p>
            {contact.overdue && (
              <p className="text-xs text-rose-600 dark:text-rose-400 font-semibold mt-1">
                {contact.overdue}
              </p>
            )}
          </div>
        </div>
        <ContactIcons contact={contact} />
      </div>
    </div>
  );
}

function Section({
  title,
  headerCls,
  titleCls,
  badgeCls,
  contacts,
  rowCls,
  onOpen,
  pinnedCount = 0,
}: {
  title: string;
  headerCls: string;
  titleCls: string;
  badgeCls: string;
  contacts: SetterContact[];
  rowCls: string;
  onOpen: (name: string) => void;
  /** Cantidad de `contacts` al inicio del array con "mantener" activo — dibuja el separador "Sin atender" tras ellos (§ ciclo de vida de tareas, 2026-07-11). */
  pinnedCount?: number;
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
          {contacts.length}
        </span>
      </div>
      <div className="divide-y divide-border">
        {contacts.map((c, i) => (
          <div key={c.name}>
            {i === pinnedCount && pinnedCount > 0 && (
              <div className="px-6 py-1.5 bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-y border-border/60">
                Sin atender
              </div>
            )}
            <LeadRow contact={c} rowCls={rowCls} onOpen={onOpen} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Buzón General — cola catch-all con lentes de canal (§ nota de Francisco) */
/* ------------------------------------------------------------------ */

/** Totales reales de referencia (150/30/120) — la lista de abajo es una muestra demo, igual que el resto de las colas del producto. */
const BUZON_COUNTS: Record<"todos" | Canal, number> = { todos: 150, whatsapp: 30, instagram: 120 };

function BuzonSection({ contacts, onOpen }: { contacts: SetterContact[]; onOpen: (name: string) => void }) {
  const [filter, setFilter] = useState<"todos" | Canal>("todos");
  // `contacts` ya viene pineados-primero (§ ciclo de vida de tareas, 2026-07-11) — filter() conserva el orden relativo.
  const filtered = contacts.filter((c) => filter === "todos" || c.canal === filter);
  const filteredPinnedCount = filtered.filter((c) => c.pinned).length;

  const chip = (key: "todos" | Canal, label: string) => (
    <button
      onClick={() => setFilter(key)}
      className={cn(
        "px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border",
        filter === key
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background dark:bg-muted/40 text-muted-foreground border-border hover:bg-muted",
      )}
    >
      {label} ({BUZON_COUNTS[key]})
    </button>
  );

  return (
    <div className="bg-card border border-border rounded-[2rem] overflow-hidden shadow-sm mb-8">
      <div className="px-6 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3 bg-blue-500/10">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-blue-900 dark:text-blue-300">
          Mensajes Buzón General
        </h3>
        <div className="flex items-center gap-2">
          {chip("todos", "Todos")}
          {chip("whatsapp", "WhatsApp")}
          {chip("instagram", "Instagram")}
        </div>
      </div>
      <div className="divide-y divide-border">
        {filtered.map((c, i) => (
          <div key={c.name}>
            {i === filteredPinnedCount && filteredPinnedCount > 0 && (
              <div className="px-6 py-1.5 bg-muted/30 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-y border-border/60">
                Sin atender
              </div>
            )}
            <LeadRow
              contact={c}
              rowCls="bg-background/50 hover:bg-muted/50 even:bg-muted/30"
              onOpen={onOpen}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Completadas Hoy — regla §4.1: siempre visible, aunque esté vacía. Tono gris/neutral (mismo patrón que Closer, §20.C). */
function CompletadasSection({ contacts, onOpen }: { contacts: SetterContact[]; onOpen: (name: string) => void }) {
  return (
    <div className="bg-card border border-border rounded-[2rem] overflow-hidden shadow-sm">
      <div className="bg-muted/40 px-6 py-4 border-b border-border flex items-center gap-3">
        <h3 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide">
          ✓ Completadas Hoy
        </h3>
        <span className="bg-muted-foreground/60 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm">
          {contacts.length}
        </span>
      </div>
      {contacts.length === 0 ? (
        <div className="px-6 py-8 text-center text-xs text-muted-foreground">
          Todavía no completaste ninguna gestión hoy.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {contacts.map((c) => (
            <LeadRow key={c.name} contact={c} rowCls="hover:bg-muted/30" onOpen={onOpen} completed />
          ))}
        </div>
      )}
    </div>
  );
}

function MiDiaTab({ onOpenContact }: { onOpenContact: (name: string, ghlContactId?: string) => void }) {
  const { contacts } = useSetter();
  const all = Object.values(contacts);
  const urgentes = all.filter((c) => c.urgente && !c.completedToday);

  /**
   * Urgentes REALES: contactos con `bot_pausado_fallo` + `zona_setter` en GHL, detectados
   * por el analizador de conversaciones. Se muestran junto a los EJEMPLO, en el mismo
   * formato — igual que en Closer AI.
   *
   * ÚNICO cambio al Setter de la tarea de conexiones (decisión de Fabio, 2026-07-31): el
   * intervalo pasó de 10s a 60s y se pausa con la pestaña oculta, vía el módulo único de
   * polling. Misma funcionalidad, ~6× menos costo — el resto del Setter no se toca.
   */
  const [realUrgentes, setRealUrgentes] = useState<SetterContact[]>([]);
  useEffect(
    () =>
      registrarReloj(
        "setter:urgentes",
        () => {
          fetchUrgentesSetter()
            .then((res) => {
              setRealUrgentes(
                res.urgentes.map((u) => ({
                  name: u.name.toUpperCase(),
                  phone: "",
                  // Sin score: el motor todavía no calificó a este lead (§4.7).
                  grade: undefined,
                  fuente: u.source,
                  // El canal no viaja en la respuesta; WhatsApp es el único con bot (§11), y si
                  // el bot falló es porque lo había. Instagram nunca llegaría a esta cola.
                  canal: "whatsapp" as const,
                  stage: "en_calificacion" as SetterStageKey,
                  situacion: "IA PAUSADA · FALLO",
                  situacionTone: "rose" as SetterTagTone,
                  subtitle: "",
                  botEstado: "pausado_fallo" as BotEstado,
                  ghlContactId: u.contactId,
                  urgente: { detail: u.fallo },
                  historial: [],
                  notas: [],
                })),
              );
            })
            .catch(() => {
              /* si el backend no responde, se quedan solo los EJEMPLO */
            });
        },
        CADENCIA.setterUrgentes,
      ),
    [],
  );
  /** EJEMPLO + reales en una sola cola, igual que en Closer AI. */
  const urgentesTodos = [...urgentes, ...realUrgentes];
  // Pineados primero — § correcciones toast/pin v2 (2026-07-11): tarea de conversación cubre Buzón, Oportunidad LT, Seguimientos Y Estancadas.
  const pinnedFirst = (c: SetterContact[]) => [...c].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const estancadas = pinnedFirst(all.filter((c) => c.estancada && !c.completedToday));
  const estancadasPinnedCount = estancadas.filter((c) => c.pinned).length;
  const oportunidades = pinnedFirst(all.filter((c) => c.oportunidadLt && !c.completedToday));
  const oportunidadesPinnedCount = oportunidades.filter((c) => c.pinned).length;
  const respondieron = pinnedFirst(all.filter((c) => c.respondido && !c.completedToday));
  const respondieronPinnedCount = respondieron.filter((c) => c.pinned).length;
  const seguimientos = pinnedFirst(all.filter((c) => c.seguimientoPendiente && !c.completedToday));
  const seguimientosPinnedCount = seguimientos.filter((c) => c.pinned).length;
  const completadas = all.filter((c) => c.completedToday);
  // Única fuente de verdad (§ ciclo de vida de tareas, 2026-07-11) — misma fórmula que el nav badge y el puente de Inicio.
  const tareasHoy = setterPendingTasksBreakdown(contacts).total;

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
          <span className="text-5xl font-light tracking-tight">{tareasHoy}</span>
          <div className="flex items-center gap-2 flex-wrap">
            {urgentes.length > 0 && (
              <div className="inline-flex items-center gap-1.5 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border border-red-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                {urgentes.length} requiere atención ya
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stat mini cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {(
          [
            { Icon: CirclePause, wrap: "bg-red-500/10", color: "text-red-500", value: urgentes.length, label: "Intervención urgente", hover: "group-hover:text-red-500" },
            { Icon: MessageSquare, wrap: "bg-amber-500/10", color: "text-amber-500", value: estancadas.length, label: "Estancadas", hover: "group-hover:text-amber-500" },
            { Icon: Target, wrap: "bg-violet-500/10", color: "text-violet-500", value: oportunidades.length, label: "Oportunidades LT", hover: "group-hover:text-violet-500" },
            { Icon: MessageCircle, wrap: "bg-blue-500/10", color: "text-blue-500", value: respondieron.length, label: "Respondieron", hover: "group-hover:text-blue-500" },
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
        {/* Buzón general — formato título+subtítulo distinto al resto (§ nota de Francisco) */}
        <div className="flex flex-col p-4 rounded-[1.5rem] bg-card/50 backdrop-blur-sm border border-border/40 hover:bg-muted/30 transition-all cursor-pointer group shadow-sm justify-center">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shadow-inner bg-blue-500/10 text-blue-500 shrink-0">
              <MessageCircle className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium text-foreground uppercase tracking-wide leading-tight group-hover:text-blue-500 transition-colors">
              Buzón general · {BUZON_COUNTS.todos}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {BUZON_COUNTS.whatsapp} WA · {BUZON_COUNTS.instagram} IG
          </span>
        </div>
      </div>

      {/* Sections */}
      <Section
        title="Intervenciones urgentes"
        headerCls="bg-rose-500/10"
        titleCls="text-rose-900 dark:text-rose-300"
        badgeCls="bg-rose-500"
        contacts={urgentesTodos}
        rowCls="bg-background/50 hover:bg-muted/50 even:bg-muted/30"
        // Los EJEMPLO no tienen id y abren como siempre; los reales llevan el suyo para
        // que el tab Chat pueda traer la conversación de verdad.
        onOpen={(name) => onOpenContact(name, urgentesTodos.find((c) => c.name === name)?.ghlContactId)}
      />
      <Section
        title="Conversaciones estancadas"
        headerCls="bg-amber-500/15"
        titleCls="text-amber-900 dark:text-amber-300"
        badgeCls="bg-amber-500"
        contacts={estancadas}
        rowCls="bg-amber-50/30 dark:bg-amber-900/10 hover:bg-amber-50/50 dark:hover:bg-amber-900/20 even:bg-amber-50/40 dark:even:bg-amber-900/15"
        onOpen={onOpenContact}
        pinnedCount={estancadasPinnedCount}
      />
      <Section
        title="Oportunidades low-ticket"
        headerCls="bg-violet-500/10"
        titleCls="text-violet-900 dark:text-violet-300"
        badgeCls="bg-violet-500"
        contacts={oportunidades}
        rowCls="bg-background/50 hover:bg-muted/50 even:bg-muted/30"
        onOpen={onOpenContact}
        pinnedCount={oportunidadesPinnedCount}
      />
      <BuzonSection contacts={respondieron} onOpen={onOpenContact} />
      <Section
        title="Seguimientos"
        headerCls="bg-amber-500/15"
        titleCls="text-amber-900 dark:text-amber-300"
        badgeCls="bg-amber-500"
        contacts={seguimientos}
        rowCls="bg-rose-500/5 hover:bg-rose-500/10 even:bg-muted/30"
        onOpen={onOpenContact}
        pinnedCount={seguimientosPinnedCount}
      />
      <CompletadasSection contacts={completadas} onOpen={onOpenContact} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tab: Pipeline                                                       */
/* ------------------------------------------------------------------ */
function PipelineRow({ contact, rowBg, onOpen }: { contact: SetterContact; rowBg: string; onOpen: (name: string) => void }) {
  return (
    <tr
      onClick={() => onOpen(contact.name)}
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
              AVATAR[avatarForGrade(contact.grade)]
            )}
          >
            {contact.grade ?? "-"}
          </div>
          <span className="w-40 truncate uppercase tracking-wide text-xs">{contact.name}</span>
          <ContactIcons contact={contact} />
        </div>
      </td>
      <td className="p-4 align-middle px-8 py-4">
        <div className="inline-flex items-center rounded-full py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 h-6 text-[10px] uppercase tracking-wider font-semibold border-0 shadow-none px-2 bg-muted/50 text-muted-foreground">
          {contact.situacion}
        </div>
      </td>
      <td className="p-4 align-middle px-8 py-4">
        <div className="flex flex-col">
          <span className="text-xs font-medium text-muted-foreground">{contact.agendaFecha ?? ""}</span>
          <span className="text-[10px] text-muted-foreground truncate max-w-[200px]" title={contact.subtitle}>
            {contact.subtitle}
          </span>
        </div>
      </td>
      <td className="p-4 align-middle px-8 py-4 text-right">
        <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      </td>
    </tr>
  );
}

function StageCard({
  name,
  dotCls,
  headerCls,
  rowBg,
  contacts,
  onOpen,
}: {
  name: string;
  dotCls: string;
  headerCls: string;
  rowBg: string;
  contacts: SetterContact[];
  onOpen: (name: string) => void;
}) {
  return (
    <div className="bg-card/50 backdrop-blur-sm rounded-[2rem] border border-border/40 shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
      <div className={cn("py-4 px-8 border-b border-border/40 flex items-center gap-2", headerCls)}>
        <span className={cn("w-2 h-2 rounded-full", dotCls)} />
        <span className="font-semibold text-[11px] uppercase tracking-widest text-foreground">{name}</span>
        <div className="inline-flex items-center border py-0.5 font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 ml-2 text-[10px] h-5 px-1.5 shadow-none rounded-full">
          {contacts.length}
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
              {contacts.map((c) => (
                <PipelineRow key={c.name} contact={c} rowBg={rowBg} onOpen={onOpen} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PipelineTab({ onOpenContact }: { onOpenContact: (name: string) => void }) {
  const { contacts } = useSetter();
  const all = Object.values(contacts);
  const enCalificacion = all.filter((c) => c.stage === "en_calificacion");
  const agendado = all.filter((c) => c.stage === "agendado");

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
        <StageCard
          name="En Calificación"
          dotCls="bg-primary/40"
          headerCls="bg-muted/5"
          rowBg="bg-amber-50/30 dark:bg-amber-900/10"
          contacts={enCalificacion}
          onOpen={onOpenContact}
        />
        <StageCard
          name="Agendado"
          dotCls="bg-emerald-500"
          headerCls="bg-emerald-50/50 dark:bg-emerald-900/10"
          rowBg="bg-transparent"
          contacts={agendado}
          onOpen={onOpenContact}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */
function SetterViewInner({ onScreenChange }: { onScreenChange?: (label: string) => void }) {
  const [tab, setTab] = useState<Tab>("inicio");
  const { contacts, openContactName, openGhlContactId, openContact, closeContact, advance, addNota, resolveIntervention, setBotEstado, pinTask, completeTask, reviveTask } = useSetter();
  const { resolveAlertsForContact } = useAgentAudit();
  const setterContact = contacts[openContactName ?? ""] ?? null;

  useEffect(() => {
    onScreenChange?.(`${TAB_LABEL[tab]} Setter`);
  }, [tab, onScreenChange]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative bg-background">
      <div className="flex-1 overflow-y-auto scrollbar-thin bg-[#fcfcfd] dark:bg-background">
        <div className="p-8 max-w-[1600px] mx-auto space-y-8">
          <Header tab={tab} setTab={setTab} />
          {tab === "inicio" && <InicioTab onGoToMiDia={() => setTab("midia")} />}
          {tab === "midia" && <MiDiaTab onOpenContact={openContact} />}
          {tab === "pipeline" && <PipelineTab onOpenContact={openContact} />}
        </div>
      </div>
      <ContactDrawer
        name={openContactName}
        onClose={closeContact}
        role="setter"
        setterContact={setterContact}
        ghlContactId={openGhlContactId}
        onSetterAdvance={(result) => openContactName && advance(openContactName, result)}
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

export default function SetterView({ onScreenChange }: { onScreenChange?: (label: string) => void }) {
  return <SetterViewInner onScreenChange={onScreenChange} />;
}
