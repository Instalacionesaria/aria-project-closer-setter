import { useCallback, useEffect, useState } from "react";
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
  Search,
  Video,
  Pin,
  Clock,
} from "lucide-react";
import { cn } from "../lib/utils";
import ContactDrawer from "./ContactDrawer";
import { botIconVisual, countCallsContestadas, countSalesCalls, type BotEstado, type Grade } from "../lib/closerStore";
import { useAuth } from "../lib/authStore";
import {
  fetchPipelineSetter,
  moverEtapaSetter,
  type PipelineSetterColumna,
  type PipelineSetterContacto,
  type PipelineSetterResponse,
} from "../lib/api";
import { fechaLarga, hoyISO } from "../lib/fechas";
import {
  useSetter,
  TAG_CLS_BY_TONE,
  setterPendingTasksBreakdown,
  type SetterContact,
  type Canal,
} from "../lib/setterStore";
import { useAgentAudit } from "../lib/agentAuditStore";

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
  const { usuario } = useAuth();
  const tabs: { key: Tab; label: string; Icon: LucideIcon; badge?: number }[] = [
    { key: "inicio", label: "Inicio", Icon: House },
    { key: "midia", label: "Mi Día", Icon: ListTodo, badge: midiaBadge > 0 ? midiaBadge : undefined },
    { key: "pipeline", label: "Pipeline", Icon: Kanban },
  ];

  return (
    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 pb-8 border-b border-border/30">
      <div>
        <p className="text-[10px] font-bold tracking-[0.2em] text-primary uppercase mb-2 opacity-80">
          {/* Mismo criterio que el closer: el nombre sale de la sesión, y sin sesión no hay nombre. */}
          SETTER{usuario?.nombre ? ` • ${usuario.nombre}` : ""}
        </p>
        {tab === "midia" ? (
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            <span className="font-light">
              Mi Día — <span className="text-muted-foreground">{fechaLarga(hoyISO())}</span>
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

  /**
   * ── Las tarjetas, con lo que de verdad se mide ─────────────────────
   *
   * Eran cuatro y las cuatro salían de constantes: `agendasAutomaticas: 33`, `showRatePct: 78`,
   * `oportunidadesLTBase: 12`. Ahora quedan las que el servidor puede calcular, y las otras dos
   * se muestran como pendientes **con su motivo** — que viaja en `cockpit.sinDato`, así que si
   * mañana se pueden medir la vista no hay que tocarla.
   *
   * `—` y no `0`: un cero afirma que el bot no agendó nada, y lo que pasa es que todavía no se
   * puede distinguir quién creó cada cita.
   */
  const KPI_CARDS: { label: string; value: string; sub: string; Icon: LucideIcon; iconWrap: string; iconColor: string }[] = [
    {
      label: "Agendas generadas por ti",
      value: cockpit ? String(cockpit.agendasGeneradas) : "—",
      sub: "Rescatadas — tu mérito real",
      Icon: CalendarDays,
      iconWrap: "bg-primary/5",
      iconColor: "text-primary",
    },
    {
      label: "Ventas Low-Ticket",
      value: cockpit ? String(cockpit.ltVentas) : "—",
      sub: cockpit ? `${money(cockpit.ltBruto)} cobrados este mes` : "Cargando…",
      Icon: Target,
      iconWrap: "bg-violet-500/10",
      iconColor: "text-violet-600",
    },
    {
      label: "Agendas automáticas",
      value: "—",
      sub: cockpit?.sinDato?.agendasAutomaticas ?? "Todavía no se puede medir",
      Icon: CalendarDays,
      iconWrap: "bg-muted",
      iconColor: "text-muted-foreground",
    },
    {
      label: "Show rate",
      value: "—",
      sub: cockpit?.sinDato?.showRate ?? "Todavía no se puede medir",
      Icon: Activity,
      iconWrap: "bg-muted",
      iconColor: "text-muted-foreground",
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
          {/*
            `—` y no `$0` sin porcentaje cargado: un cero afirma que no ganó nada, y lo que pasa es
            que nadie configuró su comisión. Es lo que le pasa a cualquier empresa el primer día.
          */}
          <div className="text-6xl font-light tracking-tighter text-amber-500 drop-shadow-[0_0_15px_rgba(245,158,11,0.3)]">
            {cockpit?.comisionTotal != null ? money(cockpit.comisionTotal) : "—"}
          </div>
          {(cockpit?.faltaPctLt || cockpit?.faltaPctDiferida) && (
            <p className="text-xs text-zinc-400">
              Cargá tu % de comisión en <span className="text-zinc-200 font-medium">Ajustes › Operación</span>
            </p>
          )}
          {/*
            El `+12% vs mes pasado` se fue el 2026-08-08. Estaba escrito a mano y detrás de un
            guard `comisionTotal > 0`, así que aparecía como si fuera medido en cuanto había una
            comisión — cualquier comisión. No hay serie histórica del setter contra la cual
            comparar: la comparación vuelve cuando exista, no antes.
          */}
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
            <p className="text-3xl font-light">
              {cockpit?.comisionLt != null ? money(cockpit.comisionLt) : "—"}
            </p>
            <p className="text-xs text-zinc-500 mt-2">
              {cockpit ? `${cockpit.ltVentas} ventas directas · ${money(cockpit.ltBruto)} bruto` : "Cargando…"}
            </p>
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
            <p className="text-3xl font-light">
              {cockpit?.comisionDiferida != null ? money(cockpit.comisionDiferida) : "—"}
            </p>
            <p className="text-xs text-zinc-500 mt-2">
              {cockpit
                ? `${cockpit.diferidaVentas} ventas de closer sobre leads que originaste (${money(cockpit.diferidaBruto)})`
                : "Cargando…"}
            </p>
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
  /** Completadas Hoy: fila atenuada + nombre tachado, pero tags e iconos SIGUEN visibles (regla de Fabio, 2026-07-10). */
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
/* Buzón General — cola catch-all con lentes de canal (§ nota de Fabio) */
/* ------------------------------------------------------------------ */

/**
 * Los conteos del Buzón, contados de la lista que se está mostrando.
 *
 * Eran `{ todos: 150, whatsapp: 30, instagram: 120 }` escritos a mano, al lado de una lista real
 * de cinco. El chip decía "Todos (150)" sobre cinco filas: no era una muestra de 150, era un
 * número inventado con etiqueta de total.
 */
function contarPorCanal(contacts: SetterContact[]): Record<"todos" | Canal, number> {
  return {
    todos: contacts.length,
    whatsapp: contacts.filter((c) => c.canal === "whatsapp").length,
    instagram: contacts.filter((c) => c.canal === "instagram").length,
  };
}

function BuzonSection({ contacts, onOpen }: { contacts: SetterContact[]; onOpen: (name: string) => void }) {
  const [filter, setFilter] = useState<"todos" | Canal>("todos");
  // `contacts` ya viene pineados-primero (§ ciclo de vida de tareas, 2026-07-11) — filter() conserva el orden relativo.
  const filtered = contacts.filter((c) => filter === "todos" || c.canal === filter);
  const filteredPinnedCount = filtered.filter((c) => c.pinned).length;
  // Los conteos salen de la MISMA lista que se renderiza: no pueden divergir de lo que se ve.
  const conteos = contarPorCanal(contacts);

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
      {label} ({conteos[key]})
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
   * ── El fetch local se fue (2026-08-08) ────────────────────────────
   *
   * Acá vivía un `useState` propio que pedía `/api/setter/urgentes` cada 60 s y mezclaba el
   * resultado con los contactos semilla. Tenía un desfase real: los urgentes de verdad se
   * mostraban en la sección pero **no contaban en ningún total**, porque el badge del nav y la
   * tarjeta de KPI leían el store, y el store no los tenía.
   *
   * Ahora la cola viene del store como las otras cinco, derivada por query del lado del
   * servidor. Una sola fuente, un solo número.
   */
  const urgentesTodos = urgentes;
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
        {/* Buzón general — formato título+subtítulo distinto al resto (§ nota de Fabio) */}
        <div className="flex flex-col p-4 rounded-[1.5rem] bg-card/50 backdrop-blur-sm border border-border/40 hover:bg-muted/30 transition-all cursor-pointer group shadow-sm justify-center">
          <div className="flex items-center gap-2 mb-1.5">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shadow-inner bg-blue-500/10 text-blue-500 shrink-0">
              <MessageCircle className="w-4 h-4" />
            </div>
            <span className="text-[11px] font-medium text-foreground uppercase tracking-wide leading-tight group-hover:text-blue-500 transition-colors">
              Buzón general · {respondieron.length}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground">
            {respondieron.filter((c) => c.canal === "whatsapp").length} WA ·{" "}
            {respondieron.filter((c) => c.canal === "instagram").length} IG
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

/*
  `StageCard` se borró el 2026-08-08 junto con el pipeline de 2 columnas. Lo reemplazó
  `ColumnaEtapa`, que renderiza las siete etapas desde el endpoint. Se borra entera en vez de
  quedar sin llamadores: una función viva que nadie usa es una invitación a volver al render
  viejo, y este ya perdía contactos en silencio.
*/

/**
 * Las SIETE etapas del pipeline del setter, con datos reales.
 *
 * ── Qué reemplaza ─────────────────────────────────────────────────────
 *
 * Renderizaba **2 columnas de 7**, filtrando el array de semillas en memoria. Los contactos de
 * las otras cinco etapas no aparecían en ninguna parte —ni en un "otros", ni en un contador— y un
 * Avanzar → No califica hacía que el contacto se esfumara del tablero.
 *
 * Las siete se muestran siempre, **incluidas las vacías**: una columna que desaparece cuando no
 * tiene contactos rompe la lectura del embudo, y no se puede arrastrar una tarjeta hacia algo que
 * no se ve.
 */
function PipelineTab({ onOpenContact }: { onOpenContact: (name: string) => void }) {
  const [datos, setDatos] = useState<PipelineSetterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  const cargar = useCallback(async () => {
    setError(null);
    const r = await fetchPipelineSetter();
    if (!r.ok) {
      setError(r.error ?? "No se pudo cargar el pipeline.");
      setDatos(null);
      return;
    }
    setDatos(r);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 text-sm space-y-2">
        <p>{error}</p>
        <button onClick={() => void cargar()} className="text-xs font-medium text-primary hover:underline">
          Reintentar
        </button>
      </div>
    );
  }

  if (!datos) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-10">
        <div className="h-4 w-4 rounded-full border-2 border-muted border-t-primary animate-spin" />
        Cargando el pipeline…
      </div>
    );
  }

  /**
   * Mover una tarjeta. Recarga siempre, con éxito o con error: el servidor es el que sabe dónde
   * quedó el contacto, y pintar el movimiento sin confirmarlo dejaría la columna mintiendo si el
   * PATCH lo rechazó — por ejemplo, un contacto congelado, que se ve pero no se mueve.
   */
  const [moviendo, setMoviendo] = useState<string | null>(null);
  const mover = useCallback(
    async (contactId: string, etapa: string) => {
      setMoviendo(contactId);
      const r = await moverEtapaSetter(contactId, etapa);
      setMoviendo(null);
      if (!r.ok) setError(r.error ?? "No se pudo mover el contacto.");
      await cargar();
    },
    [cargar],
  );

  const q = busqueda.trim().toLowerCase();
  const filtrar = (cs: PipelineSetterContacto[]) =>
    q === "" ? cs : cs.filter((c) => c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q));

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/*
        La barra de filtros tenía dos `<button>` sin `onClick`, tres botones de grade sin handler
        y un `<input>` sin `value` ni `onChange`: cuatro controles que no hacían nada. Se dejó el
        único que se puede sostener con los datos que hay —la búsqueda— y se sacaron los otros.
        Un control que no responde es peor que su ausencia: enseña que la pantalla está rota.
      */}
      <div className="flex justify-between items-center gap-4 bg-muted/10 p-4 rounded-2xl border border-border/40">
        <span className="text-xs font-medium text-muted-foreground">
          {datos.total} {datos.total === 1 ? "contacto" : "contactos"} en el territorio del setter
        </span>
        <div className="relative w-[280px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="flex w-full border px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 pl-9 h-9 rounded-full bg-background border-border/60"
            placeholder="Buscar por nombre o teléfono..."
          />
        </div>
      </div>

      <div className="space-y-6 mt-8">
        {(datos.columnas ?? []).map((col) => (
          <ColumnaEtapa
            key={col.key}
            columna={{ ...col, contactos: filtrar(col.contactos) }}
            etapas={(datos.columnas ?? []).map((c) => ({ key: c.key, label: c.label }))}
            moviendo={moviendo}
            onOpen={onOpenContact}
            onMover={mover}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Una etapa del pipeline.
 *
 * Las terminales —agendado, nurture, descalificado— se pintan distinto: el contacto ya salió del
 * trabajo del setter y verlas iguales a las activas haría parecer que todavía hay algo que hacer.
 */
function ColumnaEtapa({
  columna,
  etapas,
  moviendo,
  onOpen,
  onMover,
}: {
  columna: PipelineSetterColumna & { contactos: PipelineSetterContacto[] };
  etapas: { key: string; label: string }[];
  /** El contacto que está viajando ahora mismo, para no dejar disparar dos veces. */
  moviendo: string | null;
  onOpen: (name: string) => void;
  onMover: (contactId: string, etapa: string) => void;
}) {
  return (
    <div className="rounded-[2rem] border border-border/60 bg-card overflow-hidden shadow-sm">
      <div
        className={cn(
          "px-6 py-4 border-b border-border/60 flex items-center justify-between gap-3",
          columna.terminal ? "bg-muted/20" : "bg-muted/5",
        )}
      >
        <div className="flex items-center gap-2.5">
          <div className={cn("w-2 h-2 rounded-full", columna.terminal ? "bg-muted-foreground/40" : "bg-primary/60")} />
          <span className="text-sm font-semibold">{columna.label}</span>
          <span className="text-xs text-muted-foreground">{columna.contactos.length}</span>
        </div>
        {/*
          Que el tag todavía no exista en GHL es un hecho de la columna y se dice, en vez de que
          el usuario descubra por su cuenta que mover una tarjeta ahí no manda nada.
        */}
        {columna.tagPendiente && (
          <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
            El tag de esta etapa todavía no existe en GHL — se guarda acá igual
          </span>
        )}
      </div>

      {columna.contactos.length === 0 ? (
        <div className="px-6 py-5 text-xs text-muted-foreground">Sin contactos en esta etapa.</div>
      ) : (
        <div className="divide-y divide-border/40">
          {columna.contactos.map((c) => (
            /* `div` y no `button`: un `<select>` adentro de un `<button>` es HTML inválido y el
               navegador se come el clic del control. El nombre queda como el elemento clickeable. */
            <div
              key={c.contactId}
              className="w-full px-6 py-3 hover:bg-muted/30 transition-colors flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <button onClick={() => onOpen(c.name)} className="text-sm font-medium truncate text-left hover:underline">
                  {c.name}
                </button>
                <div className="text-[11px] text-muted-foreground truncate">
                  {[c.phone, c.fuente].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {c.monto !== null && c.monto > 0 && (
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    {money(c.monto)}
                  </span>
                )}
                {/*
                  Congelado: **visible e inerte**. Perdió su territorio en GHL, así que se muestra
                  —el trabajo hecho no desaparece— pero no se acciona. En vez del selector se
                  muestra por qué, para que nadie busque el control que falta.
                */}
                {c.congelado ? (
                  <span
                    title="Perdió su tag de territorio en GHL: se muestra pero no se puede mover."
                    className="text-[10px] font-medium text-muted-foreground border border-border rounded-full px-2 py-0.5"
                  >
                    congelado
                  </span>
                ) : (
                  <select
                    value=""
                    // Sin esto, dos clics rápidos mandan dos PATCH y gana el último por carrera.
                    disabled={moviendo === c.contactId}
                    // El clic no debe abrir la ficha: es un control, no parte de la fila.
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const destino = e.target.value;
                      if (destino) onMover(c.contactId, destino);
                    }}
                    className="text-[11px] rounded-md border border-border bg-background px-2 py-1 text-muted-foreground hover:text-foreground"
                  >
                    <option value="">Mover a…</option>
                    {etapas
                      .filter((e) => e.key !== columna.key)
                      .map((e) => (
                        <option key={e.key} value={e.key}>
                          {e.label}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */
function SetterViewInner() {
  const [tab, setTab] = useState<Tab>("inicio");
  const { contacts, openContactName, openGhlContactId, openContact, closeContact, advance, addNota, resolveIntervention, setBotEstado, pinTask, completeTask, reviveTask } = useSetter();
  const { resolverAlertasDeContacto } = useAgentAudit();
  const setterContact = contacts[openContactName ?? ""] ?? null;


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
          // No-op mientras el auditor de chat del setter no exista (§53.4): no hay hallazgos
          // de `lead-flow-ai` que resolver. Queda cableado para cuando se construya.
          void resolverAlertasDeContacto(openGhlContactId);
        }}
        onBotStateChange={(estado, evento, autor) => openContactName && setBotEstado(openContactName, estado, evento, autor)}
        onPin={() => openContactName && pinTask(openContactName)}
        onComplete={() => openContactName && completeTask(openContactName)}
        onRevive={() => openContactName && reviveTask(openContactName)}
      />
    </div>
  );
}

export default function SetterView() {
  return <SetterViewInner />;
}
