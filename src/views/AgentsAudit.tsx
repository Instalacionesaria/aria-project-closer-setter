import { useState } from "react";
import { Bot, PhoneCall, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

type AgentType = "text" | "voz";

interface Delta {
  text: string;
  up: boolean;
}

interface Sentiment {
  positivos: number;
  neutrales: number;
  molestos: number;
}

interface Op {
  value: string;
  sub?: string;
  label: string;
}

interface AlertBadge {
  color: "rose" | "amber";
  count: number;
}

interface Agent {
  type: AgentType;
  icon: "bot" | "phone";
  name: string;
  goal: string;
  desc: string;
  metric: string;
  delta: Delta;
  subtext: string;
  sentiment: Sentiment;
  ops: Op[];
  alerts?: AlertBadge[];
  alDia?: boolean;
}

const AGENTS: Agent[] = [
  {
    type: "text",
    icon: "bot",
    name: "Lead Flow AI",
    goal: "CONVERSACIONES → AGENDA",
    desc: "Contactos sin agendar · su trabajo: llevarlos a la cita",
    metric: "23%",
    delta: { text: "▲ +4 pts", up: true },
    subtext: "49 de 214 agendaron",
    sentiment: { positivos: 85, neutrales: 10, molestos: 5 },
    ops: [
      { value: "214", label: "Conversaciones" },
      { value: "49", label: "Agendadas" },
      { value: "23", label: "Sin Respuesta" },
    ],
    alerts: [
      { color: "rose", count: 2 },
      { color: "amber", count: 1 },
    ],
  },
  {
    type: "text",
    icon: "bot",
    name: "Appointment Flow AI",
    goal: "SHOW-UP DE SUS CITAS",
    desc: "Contactos agendados · su trabajo: asegurar que asistan",
    metric: "68%",
    delta: { text: "▼ -2 pts", up: false },
    subtext: "58 de 86 agendaron",
    sentiment: { positivos: 70, neutrales: 20, molestos: 10 },
    ops: [
      { value: "86", label: "Conversaciones" },
      { value: "58", label: "Agendadas" },
      { value: "12", label: "Sin Respuesta" },
    ],
    alerts: [{ color: "amber", count: 2 }],
  },
  {
    type: "voz",
    icon: "phone",
    name: "Lead Flow Voz",
    goal: "% LLAMADOS → CITA EN 48H",
    desc: "Llama al lead recién capturado · califica y agenda en la llamada",
    metric: "15%",
    delta: { text: "▲ +2 pts", up: true },
    subtext: "23 de 150 agendaron",
    sentiment: { positivos: 60, neutrales: 30, molestos: 10 },
    ops: [
      { value: "150", label: "Llamados" },
      { value: "315", sub: "2.1/cto", label: "Totales" },
      { value: "45%", label: "Contestadas" },
      { value: "25%", label: "Sin Respuesta" },
      { value: "30%", label: "Buzón" },
      { value: "320", label: "Minutos" },
    ],
    alerts: [{ color: "rose", count: 1 }],
  },
  {
    type: "voz",
    icon: "phone",
    name: "Appointment Flow Voz",
    goal: "% CONFIRMACIONES LOGRADAS",
    desc: "Confirma la sesión · recuerda el video pre-call",
    metric: "82%",
    delta: { text: "▲ +5 pts", up: true },
    subtext: "49 de 60 agendaron",
    sentiment: { positivos: 90, neutrales: 5, molestos: 5 },
    ops: [
      { value: "60", label: "Llamados" },
      { value: "126", sub: "2.1/cto", label: "Totales" },
      { value: "70%", label: "Contestadas" },
      { value: "10%", label: "Sin Respuesta" },
      { value: "20%", label: "Buzón" },
      { value: "85", label: "Minutos" },
    ],
    alDia: true,
  },
];

interface Adjustment {
  date: string;
  issue: string;
  count: string;
  agentIcon: string;
  agentName: string;
  category: string;
  author: string;
}

const ADJUSTMENTS: Adjustment[] = [
  {
    date: "04 Jul 2026",
    issue: "Promesa vacía — bonos",
    count: "×8",
    agentIcon: "💬",
    agentName: "Lead Flow AI",
    category: "Base de conocimiento",
    author: "Diego M.",
  },
  {
    date: "02 Jul 2026",
    issue: "Tono demasiado formal",
    count: "×34",
    agentIcon: "💬",
    agentName: "Lead Flow AI",
    category: "Comportamiento",
    author: "Diego M.",
  },
  {
    date: "01 Jul 2026",
    issue: "Cuelga al buzón de voz",
    count: "×12",
    agentIcon: "📞",
    agentName: "Lead Flow Voz",
    category: "Comportamiento",
    author: "Diego M.",
  },
  {
    date: "28 Jun 2026",
    issue: "Falta de urgencia en cierre",
    count: "×15",
    agentIcon: "💬",
    agentName: "Appointment Flow AI",
    category: "Información adicional",
    author: "Ana S.",
  },
];

type Filter = "todos" | "text" | "voz";

const SENTIMENT_BTN =
  "flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-muted/30 hover:bg-muted/60 border border-border/40 hover:border-border transition-all text-left group/btn shadow-sm hover:shadow";
const SENTIMENT_LABEL =
  "text-[9px] font-bold text-muted-foreground uppercase tracking-widest group-hover/btn:text-foreground transition-colors";
const OP_CARD =
  "flex flex-col gap-1 p-4 rounded-2xl border border-border/80 dark:border-border bg-muted/90 dark:bg-muted/40 hover:bg-muted transition-colors shadow";

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <div className="text-card-foreground relative overflow-hidden border border-border/80 dark:border-border rounded-[2rem] bg-card shadow-lg hover:shadow-xl transition-all duration-500 flex flex-col group/card">
      {/* Alert badge / al día */}
      <div className="absolute top-6 right-6 flex items-center gap-2 cursor-pointer group/alert z-10">
        {agent.alDia ? (
          <div className="flex gap-1.5 items-center bg-background/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-border/50 shadow-sm">
            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              ✓ AL DÍA
            </span>
          </div>
        ) : (
          <div className="flex gap-1.5 items-center bg-background/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-border/50 shadow-sm hover:shadow transition-all hover:border-border">
            {agent.alerts?.map((a, i) => (
              <span
                key={i}
                className={cn(
                  "flex items-center gap-1 text-[10px] font-bold",
                  a.color === "rose"
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-amber-600 dark:text-amber-400"
                )}
              >
                <div
                  className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    a.color === "rose" ? "bg-rose-500" : "bg-amber-500"
                  )}
                />
                {a.count}
              </span>
            ))}
            <ChevronRight className="lucide lucide-chevron-right w-3 h-3 text-muted-foreground group-hover/alert:translate-x-0.5 transition-transform ml-1" />
          </div>
        )}
      </div>

      {/* Header */}
      <div className="p-8 pb-4 flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center border border-violet-500/20 text-violet-600 dark:text-violet-400 shadow-sm shrink-0">
          {agent.icon === "bot" ? (
            <Bot className="lucide lucide-bot w-5 h-5" />
          ) : (
            <PhoneCall className="lucide lucide-phone-call w-5 h-5" />
          )}
        </div>
        <div className="pt-1">
          <h3 className="text-lg font-semibold tracking-tight leading-none mb-1.5">
            {agent.name}
          </h3>
          <div className="text-[10px] font-bold text-foreground uppercase tracking-widest mb-1">
            {agent.goal}
          </div>
          <p className="text-[11px] text-muted-foreground font-medium max-w-[240px] leading-relaxed mb-1.5">
            {agent.desc}
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="px-8 pb-8 flex flex-col gap-8">
        <div className="flex items-start justify-between my-2">
          <div className="flex flex-col">
            <div className="flex items-baseline gap-3">
              <span className="text-6xl font-semibold tracking-tighter text-foreground leading-none">
                {agent.metric}
              </span>
              <span
                className={cn(
                  "text-[10px] font-bold flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted/50",
                  agent.delta.up
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400"
                )}
              >
                {agent.delta.text}
              </span>
            </div>
            <div className="text-xs font-medium text-muted-foreground mt-3 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
              {agent.subtext}
            </div>
          </div>

          {/* Sentiment */}
          <div className="flex gap-4 items-center h-[90px]">
            <div className="w-1.5 h-full rounded-full flex flex-col overflow-hidden bg-muted">
              <div
                className="bg-emerald-500 w-full"
                style={{ height: `${agent.sentiment.positivos}%` }}
              />
              <div
                className="bg-amber-400 w-full"
                style={{ height: `${agent.sentiment.neutrales}%` }}
              />
              <div
                className="bg-rose-500 w-full"
                style={{ height: `${agent.sentiment.molestos}%` }}
              />
            </div>
            <div className="flex flex-col justify-between h-full py-0.5">
              <button className={SENTIMENT_BTN}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold text-foreground w-8">
                  {agent.sentiment.positivos}%
                </span>
                <span className={SENTIMENT_LABEL}>Positivos</span>
              </button>
              <button className={SENTIMENT_BTN}>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span className="text-xs font-bold text-foreground w-8">
                  {agent.sentiment.neutrales}%
                </span>
                <span className={SENTIMENT_LABEL}>Neutrales</span>
              </button>
              <button className={SENTIMENT_BTN}>
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                <span className="text-xs font-bold text-foreground w-8">
                  {agent.sentiment.molestos}%
                </span>
                <span className={SENTIMENT_LABEL}>Molestos</span>
              </button>
            </div>
          </div>
        </div>

        <div
          className="shrink-0 h-[1px] w-full bg-border/40"
          data-orientation="horizontal"
          role="none"
        />

        {/* Ops */}
        <div className="flex flex-col gap-4">
          <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
            Operativos · Últimos 30 días
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {agent.ops.map((op, i) => (
              <div key={i} className={OP_CARD}>
                {op.sub ? (
                  <span className="text-lg font-semibold text-foreground flex items-baseline gap-1">
                    {op.value}
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {op.sub}
                    </span>
                  </span>
                ) : (
                  <span className="text-lg font-semibold text-foreground">
                    {op.value}
                  </span>
                )}
                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                  {op.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AgentsAudit() {
  const [filter, setFilter] = useState<Filter>("todos");

  const textAgents = AGENTS.filter((a) => a.type === "text");
  const vozAgents = AGENTS.filter((a) => a.type === "voz");

  const showText = filter === "todos" || filter === "text";
  const showVoz = filter === "todos" || filter === "voz";

  const filterBtn = (active: boolean) =>
    cn(
      "px-6 py-2 rounded-lg text-sm font-semibold transition-all duration-300",
      active
        ? "bg-card text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.05)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.2)] border border-border/50"
        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
    );

  return (
    <div className="flex-1 bg-[#fcfcfd] dark:bg-background overflow-y-scroll">
      <div className="p-10 max-w-[1200px] mx-auto space-y-8 pb-24">
        {/* Header */}
        <div className="flex items-end justify-between mb-10 pr-14 lg:pr-0">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center justify-center px-3 py-1.5 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-400 text-[10px] font-bold tracking-[0.2em] uppercase w-fit">
                AGENTES
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                Últimos 30 días
              </span>
            </div>
            <h1 className="text-4xl font-light tracking-tight text-foreground">
              Salud de los agentes
            </h1>
          </div>
          <div className="flex items-center p-1 bg-muted/30 rounded-xl border border-border/50 shadow-sm backdrop-blur-md">
            <button
              onClick={() => setFilter("todos")}
              className={filterBtn(filter === "todos")}
            >
              Todos
            </button>
            <button
              onClick={() => setFilter("text")}
              className={filterBtn(filter === "text")}
            >
              💬 Agentes de Texto
            </button>
            <button
              onClick={() => setFilter("voz")}
              className={filterBtn(filter === "voz")}
            >
              📞 Agentes de Voz
            </button>
          </div>
        </div>

        {/* Warning banner */}
        <div className="w-full bg-rose-500/5 border border-rose-500/20 rounded-2xl p-5 flex items-center justify-between cursor-pointer hover:bg-rose-500/10 transition-colors mb-8 group">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center">
              <div className="w-3 h-3 rounded-full bg-rose-500 animate-pulse" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-rose-600 dark:text-rose-400">
                3 casos graves abiertos (incluye voz)
              </h4>
              <p className="text-xs text-rose-600/70 dark:text-rose-400/70 mt-0.5 font-medium">
                El más antiguo lleva 2 días sin resolución
              </p>
            </div>
          </div>
          <div className="text-xs font-bold uppercase tracking-widest text-rose-600 dark:text-rose-400 flex items-center gap-1 opacity-80 group-hover:opacity-100 group-hover:translate-x-1 transition-all">
            Verlos
            <ChevronRight className="lucide lucide-chevron-right w-4 h-4" />
          </div>
        </div>

        {/* Agent groups */}
        <div className="space-y-12">
          {showText && (
            <div className="space-y-6">
              <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-2">
                💬 AGENTES DE TEXTO
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {textAgents.map((agent) => (
                  <AgentCard key={agent.name} agent={agent} />
                ))}
              </div>
            </div>
          )}

          {showVoz && (
            <div className="space-y-6">
              <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-2">
                📞 AGENTES DE VOZ
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {vozAgents.map((agent) => (
                  <AgentCard key={agent.name} agent={agent} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Historial de Ajustes */}
        <div className="pt-12">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Historial de Ajustes
              </h3>
              <span className="text-[10px] font-medium text-muted-foreground/60 px-2 py-0.5 rounded-full bg-muted/50">
                Queda guardado para siempre
              </span>
            </div>
          </div>
          <div className="border text-card-foreground shadow-md border-border/80 rounded-2xl bg-card overflow-hidden">
            <div className="relative w-full overflow-auto">
              <table className="w-full caption-bottom text-sm">
                <tbody className="[&_tr:last-child]:border-0">
                  {ADJUSTMENTS.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b transition-colors data-[state=selected]:bg-muted hover:bg-muted/30 border-border/30"
                    >
                      <td className="p-4 align-middle [&:has([role=checkbox])]:pr-0 w-12 text-center">
                        <div className="w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
                          <span className="text-emerald-600 dark:text-emerald-400 text-xs">
                            ✓
                          </span>
                        </div>
                      </td>
                      <td className="p-4 align-middle [&:has([role=checkbox])]:pr-0 text-xs text-muted-foreground w-32 font-medium">
                        {row.date}
                      </td>
                      <td className="p-4 align-middle [&:has([role=checkbox])]:pr-0 font-semibold text-sm text-foreground">
                        {row.issue}
                        <span className="text-muted-foreground font-normal ml-2 bg-muted px-1.5 py-0.5 rounded text-[10px]">
                          {row.count}
                        </span>
                      </td>
                      <td className="p-4 align-middle [&:has([role=checkbox])]:pr-0">
                        <div className="inline-flex items-center rounded-full border focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground cursor-pointer hover:bg-muted/50 transition-colors border-border/50 font-medium text-xs px-2 py-0.5 shadow-none">
                          {row.agentIcon} {row.agentName}
                        </div>
                      </td>
                      <td className="p-4 align-middle [&:has([role=checkbox])]:pr-0">
                        <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400 bg-violet-500/10 px-2 py-1 rounded-md tracking-widest uppercase">
                          {row.category}
                        </span>
                      </td>
                      <td className="p-4 align-middle [&:has([role=checkbox])]:pr-0 text-xs text-muted-foreground text-right font-medium">
                        {row.author}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
