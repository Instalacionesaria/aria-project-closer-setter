import { useEffect, useState, type MouseEvent } from "react";
import {
  Bot,
  PhoneCall,
  ChevronRight,
  ChevronLeft,
  ArrowLeft,
  X,
  Copy,
  ExternalLink,
  Smile,
  Meh,
  Frown,
} from "lucide-react";
import { cn } from "../lib/utils";
import ContactDrawer from "./ContactDrawer";
import { useClosurer } from "../lib/closerStore";
import { useSetter } from "../lib/setterStore";
import {
  useAgentAudit,
  groupAlerts,
  CATEGORY_LABEL,
  type AgentInfo,
  type AgentId,
  type AlertGroupSummary,
  type AdjustmentEntry,
} from "../lib/agentAuditStore";

type Filter = "todos" | "text" | "voz";

const SENTIMENT_BTN =
  "flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-muted/30 hover:bg-muted/60 border border-border/40 hover:border-border transition-all text-left group/btn shadow-sm hover:shadow";
const SENTIMENT_LABEL =
  "text-[9px] font-bold text-muted-foreground uppercase tracking-widest group-hover/btn:text-foreground transition-colors";
const OP_CARD =
  "flex flex-col gap-1 p-4 rounded-2xl border border-border/80 dark:border-border bg-muted/90 dark:bg-muted/40 hover:bg-muted transition-colors shadow";

/** Grupos "abiertos" (con al menos un caso activo o resuelto por humano, pendiente de parche) para un agente. */
function openGroupsFor(groups: AlertGroupSummary[], agentId: AgentId) {
  return groups.filter((g) => g.agentId === agentId && g.isOpen);
}

/** Orden de la lista de trabajo del técnico: severidad (rojo primero), luego antigüedad descendente. */
function sortWorkQueue(groups: AlertGroupSummary[]) {
  return [...groups].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "rojo" ? -1 : 1;
    return b.openedDaysAgo - a.openedDaysAgo;
  });
}

/* ------------------------------------------------------------------ */
/* Tarjeta de agente (grid)                                            */
/* ------------------------------------------------------------------ */

function AgentCard({ agent, groups, onClick }: { agent: AgentInfo; groups: AlertGroupSummary[]; onClick: () => void }) {
  const open = openGroupsFor(groups, agent.id);
  const rojos = open.filter((g) => g.severity === "rojo").length;
  const amarillos = open.filter((g) => g.severity === "amarillo").length;
  const alDia = open.length === 0;

  return (
    <div
      onClick={onClick}
      className="text-card-foreground relative overflow-hidden border border-border/80 dark:border-border rounded-[2rem] bg-card shadow-lg hover:shadow-xl transition-all duration-500 flex flex-col group/card cursor-pointer"
    >
      {/* Alert badge / al día */}
      <div className="absolute top-6 right-6 flex items-center gap-2 group/alert z-10">
        {alDia ? (
          <div className="flex gap-1.5 items-center bg-muted/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-border/50 shadow-sm">
            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              ✓ AL DÍA
            </span>
          </div>
        ) : (
          <div className="flex gap-1.5 items-center bg-muted/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-border/50 shadow-sm hover:shadow transition-all hover:border-border">
            {rojos > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-rose-600 dark:text-rose-400">
                <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                {rojos}
              </span>
            )}
            {amarillos > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                {amarillos}
              </span>
            )}
            <ChevronRight className="w-3 h-3 text-muted-foreground group-hover/alert:translate-x-0.5 transition-transform ml-1" />
          </div>
        )}
      </div>

      {/* Header */}
      <div className="p-8 pb-4 flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center border border-violet-500/20 text-violet-600 dark:text-violet-400 shadow-sm shrink-0">
          {agent.icon === "bot" ? <Bot className="w-5 h-5" /> : <PhoneCall className="w-5 h-5" />}
        </div>
        <div className="pt-1">
          <h3 className="text-lg font-semibold tracking-tight leading-none mb-1.5">{agent.name}</h3>
          <div className="text-[10px] font-bold text-foreground uppercase tracking-widest mb-1">{agent.goal}</div>
          <p className="text-[11px] text-muted-foreground font-medium max-w-[240px] leading-relaxed mb-1.5">{agent.desc}</p>
        </div>
      </div>

      {/* Body */}
      <div className="px-8 pb-8 flex flex-col gap-8">
        <div className="flex items-start justify-between my-2">
          <div className="flex flex-col">
            <div className="flex items-baseline gap-3">
              <span className="text-6xl font-semibold tracking-tighter text-foreground leading-none">{agent.metric}</span>
              <span
                className={cn(
                  "text-[10px] font-bold flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted/50",
                  agent.delta.up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
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
              <div className="bg-emerald-500 w-full" style={{ height: `${agent.sentiment.positivos}%` }} />
              <div className="bg-amber-400 w-full" style={{ height: `${agent.sentiment.neutrales}%` }} />
              <div className="bg-rose-500 w-full" style={{ height: `${agent.sentiment.molestos}%` }} />
            </div>
            <div className="flex flex-col justify-between h-full py-0.5">
              <span className={SENTIMENT_BTN}>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold text-foreground w-8">{agent.sentiment.positivos}%</span>
                <span className={SENTIMENT_LABEL}>Positivos</span>
              </span>
              <span className={SENTIMENT_BTN}>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span className="text-xs font-bold text-foreground w-8">{agent.sentiment.neutrales}%</span>
                <span className={SENTIMENT_LABEL}>Neutrales</span>
              </span>
              <span className={SENTIMENT_BTN}>
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                <span className="text-xs font-bold text-foreground w-8">{agent.sentiment.molestos}%</span>
                <span className={SENTIMENT_LABEL}>Molestos</span>
              </span>
            </div>
          </div>
        </div>

        <div className="shrink-0 h-[1px] w-full bg-border/40" />

        {/* Ops */}
        <div className="flex flex-col gap-4">
          <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Operativos · Últimos 30 días</div>
          <div className="grid grid-cols-3 gap-2.5">
            {agent.ops.map((op, i) => (
              <div key={i} className={OP_CARD}>
                {op.sub ? (
                  <span className="text-lg font-semibold text-foreground flex items-baseline gap-1">
                    {op.value}
                    <span className="text-[10px] text-muted-foreground font-medium">{op.sub}</span>
                  </span>
                ) : (
                  <span className="text-lg font-semibold text-foreground">{op.value}</span>
                )}
                <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">{op.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sparkline SVG (12 semanas) — sin librería de charts, polyline a mano */
/* ------------------------------------------------------------------ */

/**
 * Marcas de ajustes (§6.D de CLAUDE.md, "sparkline 2 líneas con marcas de ajustes") — puntos
 * en la línea de tasa donde el técnico aplicó un ajuste. Sin fechas exactas por semana en el
 * historial, se ubican en las últimas semanas del rango (donde de hecho ocurrieron los ajustes
 * recientes) en vez de inventar un mapeo fecha→semana preciso.
 */
function adjustmentMarkerIndices(historyLength: number, adjustmentCount: number): number[] {
  if (adjustmentCount <= 0) return [];
  const indices = [historyLength - 2, historyLength - 6];
  return indices.filter((i) => i >= 0).slice(0, adjustmentCount);
}

function Sparkline({ history, adjustmentCount = 0 }: { history: AgentInfo["history"]; adjustmentCount?: number }) {
  const W = 680;
  const H = 160;
  const PAD = 12;
  const max = 100;
  const min = 0;
  const stepX = (W - PAD * 2) / (history.length - 1);
  const xAt = (i: number) => PAD + i * stepX;
  const y = (v: number) => H - PAD - ((v - min) / (max - min)) * (H - PAD * 2);
  const tasaPoints = history.map((h, i) => `${xAt(i)},${y(h.tasa)}`).join(" ");
  const sentPoints = history.map((h, i) => `${xAt(i)},${y(h.sentimientoPositivo)}`).join(" ");
  const markers = adjustmentMarkerIndices(history.length, adjustmentCount);

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const handleMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round((svgX - PAD) / stepX);
    setHoverIdx(Math.min(history.length - 1, Math.max(0, idx)));
  };

  const hovered = hoverIdx !== null ? history[hoverIdx] : null;
  const tooltipLeftPct = hoverIdx !== null ? (xAt(hoverIdx) / W) * 100 : 0;
  const tooltipAlignRight = tooltipLeftPct > 65;

  return (
    <div className="space-y-2 relative">
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-foreground inline-block" /> Tasa de trabajo
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 bg-teal-500 inline-block" style={{ borderTop: "2px dashed" }} /> Sentimiento positivo
        </span>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-40 cursor-crosshair"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {hoverIdx !== null && (
            <line x1={xAt(hoverIdx)} x2={xAt(hoverIdx)} y1={0} y2={H} stroke="currentColor" strokeWidth={1} className="text-border" />
          )}
          <polyline points={sentPoints} fill="none" stroke="#14b8a6" strokeWidth={2} strokeDasharray="4 4" />
          <polyline points={tasaPoints} fill="none" stroke="currentColor" strokeWidth={2} className="text-foreground" />
          {history.map((h, i) => (
            <circle key={`s-${i}`} cx={xAt(i)} cy={y(h.sentimientoPositivo)} r={2.5} fill="#14b8a6" />
          ))}
          {history.map((h, i) => (
            <circle key={`t-${i}`} cx={xAt(i)} cy={y(h.tasa)} r={2.5} className="fill-foreground" />
          ))}
          {markers.map((i) => (
            <circle key={`adj-${i}`} cx={xAt(i)} cy={y(history[i].tasa)} r={3.5} fill="#8b5cf6" stroke="white" strokeWidth={1.5}>
              <title>Ajuste aplicado</title>
            </circle>
          ))}
          {hovered && (
            <>
              <circle cx={xAt(hoverIdx!)} cy={y(hovered.sentimientoPositivo)} r={5} fill="white" stroke="#14b8a6" strokeWidth={2} />
              <circle cx={xAt(hoverIdx!)} cy={y(hovered.tasa)} r={5} fill="white" stroke="currentColor" className="text-foreground" strokeWidth={2} />
            </>
          )}
        </svg>
        {hovered && (
          <div
            className="absolute top-2 z-10 pointer-events-none bg-popover text-popover-foreground border border-border rounded-lg shadow-lg px-3 py-2 text-xs whitespace-nowrap"
            style={{ left: `${tooltipLeftPct}%`, transform: tooltipAlignRight ? "translateX(-100%)" : "translateX(8px)" }}
          >
            <div className="font-semibold mb-1">{hovered.week}</div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Tasa de trabajo:</span>
              <span className="font-bold">{hovered.tasa}%</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Sentimiento positivo:</span>
              <span className="font-bold text-teal-600 dark:text-teal-400">{hovered.sentimientoPositivo}%</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground px-1">
        {history.filter((_, i) => i % 2 === 0 || i === history.length - 1).map((h, i) => (
          <span key={i}>{h.week}</span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detalle de agente                                                    */
/* ------------------------------------------------------------------ */

function SeverityDot({ severity }: { severity: "rojo" | "amarillo" }) {
  return <div className={cn("w-2 h-2 rounded-full shrink-0", severity === "rojo" ? "bg-rose-500" : "bg-amber-500")} />;
}

function CategoryChip({ category }: { category: keyof typeof CATEGORY_LABEL }) {
  return (
    <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400 bg-violet-500/10 px-2 py-1 rounded-md tracking-widest uppercase shrink-0">
      {CATEGORY_LABEL[category]}
    </span>
  );
}

function AgentDetailView({
  agent,
  groups,
  adjustments,
  onBack,
  onOpenGroup,
  onOpenAdjustment,
}: {
  agent: AgentInfo;
  groups: AlertGroupSummary[];
  adjustments: AdjustmentEntry[];
  onBack: () => void;
  onOpenGroup: (agentId: AgentId, errorCode: string) => void;
  onOpenAdjustment: (entry: AdjustmentEntry) => void;
}) {
  const open = sortWorkQueue(openGroupsFor(groups, agent.id));
  const rojos = open.filter((g) => g.severity === "rojo").length;
  const amarillos = open.filter((g) => g.severity === "amarillo").length;
  const resueltosEnPeriodo = adjustments.filter((a) => a.agentName === agent.name).length;
  const agentAdjustments = adjustments.filter((a) => a.agentName === agent.name);

  const SentimentIcon = agent.sentiment.positivos >= 70 ? Smile : agent.sentiment.positivos >= 40 ? Meh : Frown;
  const sentimentColor = agent.sentiment.positivos >= 70 ? "text-emerald-500 border-emerald-200" : agent.sentiment.positivos >= 40 ? "text-amber-500 border-amber-200" : "text-rose-500 border-rose-200";

  return (
    <div className="space-y-8">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Salud de los agentes
      </button>

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center border border-violet-500/20 text-violet-600 dark:text-violet-400 shadow-sm shrink-0">
            {agent.icon === "bot" ? <Bot className="w-5 h-5" /> : <PhoneCall className="w-5 h-5" />}
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{agent.name}</h2>
            <p className="text-xs text-muted-foreground">{agent.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 bg-card border border-border/60 rounded-2xl px-4 py-2.5 shadow-sm">
          <div className="text-right">
            <div className="text-lg font-semibold">{agent.metric}</div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{agent.goal}</div>
          </div>
          <div className="w-[1px] h-8 bg-border/50" />
          <div className={cn("w-9 h-9 rounded-full border-2 flex items-center justify-center shrink-0", sentimentColor)}>
            <SentimentIcon className="w-4 h-4" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Sentimiento</span>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold">
              <span className="text-emerald-600">{agent.sentiment.positivos}%</span>
              <span className="text-amber-600">{agent.sentiment.neutrales}%</span>
              <span className="text-rose-600">{agent.sentiment.molestos}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="border border-border/60 rounded-2xl bg-card p-6 shadow-sm">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-4">Evolución de la tasa (12 semanas)</div>
        <Sparkline history={agent.history} adjustmentCount={agentAdjustments.length} />
      </div>

      <div>
        <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-[0.2em] mb-3">Operativos · Últimos 30 días</div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
          {agent.ops.map((op, i) => (
            <div key={i} className={OP_CARD}>
              <span className="text-lg font-semibold text-foreground flex items-baseline gap-1">
                {op.value}
                {op.sub && <span className="text-[10px] text-muted-foreground font-medium">{op.sub}</span>}
              </span>
              <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">{op.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> {rojos} rojos abiertos</span>
        <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> {amarillos} amarillos</span>
        <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">✓ {resueltosEnPeriodo} resueltos en el período</span>
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-3">Lista de trabajo del técnico</div>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground border border-dashed border-border/60 rounded-2xl p-6 text-center">
            Sin casos abiertos — agente al día.
          </p>
        ) : (
          <div className="border border-border/60 rounded-2xl bg-card divide-y divide-border/50 shadow-sm overflow-hidden">
            {open.map((g) => (
              <button
                key={g.key}
                onClick={() => onOpenGroup(g.agentId, g.errorCode)}
                className="w-full flex items-center justify-between gap-4 p-4 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <SeverityDot severity={g.severity} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate flex items-center gap-2">
                      {g.title}
                      <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">×{g.casesCount}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      abierto hace {g.openedDaysAgo === 0 ? "menos de 1 día" : `${g.openedDaysAgo} día${g.openedDaysAgo > 1 ? "s" : ""}`}
                      {g.hasUnresolvedByHumanOnly && <span className="ml-2 text-emerald-600 dark:text-emerald-400">· salvado por humano</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <CategoryChip category={g.category} />
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Historial de ajustes de este agente</div>
          <button onClick={onBack} className="text-xs font-medium text-violet-600 dark:text-violet-400 hover:underline">
            Ver historial completo ›
          </button>
        </div>
        {agentAdjustments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin ajustes registrados todavía.</p>
        ) : (
          <div className="border border-border/60 rounded-2xl bg-card divide-y divide-border/50 shadow-sm overflow-hidden">
            {agentAdjustments.map((row, i) => (
              <button
                key={i}
                onClick={() => onOpenAdjustment(row)}
                className="w-full flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <span className="text-emerald-600 dark:text-emerald-400 text-xs">✓</span>
                </div>
                <span className="text-xs text-muted-foreground w-24 shrink-0">{row.date}</span>
                <span className="font-semibold text-sm text-foreground flex-1">
                  {row.issue} <span className="text-muted-foreground font-normal ml-1 bg-muted px-1.5 py-0.5 rounded text-[10px]">{row.count}</span>
                </span>
                <CategoryChip category={Object.keys(CATEGORY_LABEL).find((k) => CATEGORY_LABEL[k as keyof typeof CATEGORY_LABEL] === row.category) as keyof typeof CATEGORY_LABEL} />
                <span className="text-xs text-muted-foreground shrink-0">{row.author}</span>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer de grupo de alerta                                            */
/* ------------------------------------------------------------------ */

function AlertGroupDrawer({
  group,
  onClose,
  onPatch,
  onOpenContact,
}: {
  group: AlertGroupSummary;
  onClose: () => void;
  onPatch: () => void;
  onOpenContact: (name: string) => void;
}) {
  const [evidenceIdx, setEvidenceIdx] = useState(0);
  const [copied, setCopied] = useState(false);
  const evidence = group.evidence;
  const current = evidence[evidenceIdx];

  const copyBlock = () => {
    if (!group.correctionBlock) return;
    navigator.clipboard?.writeText(group.correctionBlock);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-150" onClick={onClose} />
      <div className="relative w-full max-w-md bg-popover text-popover-foreground h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <div className="flex items-center justify-between p-5 border-b border-border/50">
          <div className="flex items-center gap-2">
            <SeverityDot severity={group.severity} />
            <CategoryChip category={group.category} />
            <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full">
              abierto hace {group.openedDaysAgo === 0 ? "menos de 1 día" : `${group.openedDaysAgo} día${group.openedDaysAgo > 1 ? "s" : ""}`}
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <div>
            <h3 className="text-lg font-semibold">{group.title}</h3>
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">×{group.casesCount} casos</span>
          </div>

          {group.diagnostico && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Diagnóstico</div>
              <p className="text-sm text-foreground/90 bg-muted/40 border border-border/50 rounded-xl p-3.5 leading-relaxed">{group.diagnostico}</p>
            </div>
          )}

          {group.correctionBlock && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Bloque de corrección</div>
              <div className="bg-[#0a0a0a] text-white rounded-xl p-3.5 text-sm font-mono leading-relaxed">{group.correctionBlock}</div>
              <button
                onClick={copyBlock}
                className="w-full flex items-center justify-center gap-2 h-10 rounded-md bg-foreground text-background text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                <Copy className="w-3.5 h-3.5" /> {copied ? "¡Copiado!" : "Copiar bloque"}
              </button>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Evidencia</div>
              <span className="text-[10px] text-muted-foreground">
                Muestra {evidence.length > 0 ? evidenceIdx + 1 : 0} de {group.casesCount}
              </span>
            </div>
            {evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground italic text-center py-6 border border-dashed border-border/50 rounded-xl">
                No hay ejemplos para mostrar.
              </p>
            ) : (
              <div className="border border-border/50 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold flex items-center gap-2">
                    {current.contactName}
                    {current.status === "resolved_by_human" && (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                        Salvado por humano
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{current.timestamp}</span>
                </div>
                {current.kind === "call" ? (
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <PhoneCall className="w-3.5 h-3.5" />
                      <span>Duración {current.duracion}</span>
                      {current.resultado && <span>· {current.resultado}</span>}
                    </div>
                    {current.resumenIA && (
                      <div className="bg-muted/50 border border-border/50 rounded-lg px-3 py-2.5 text-sm leading-relaxed">
                        <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Transcript (resumen IA)</div>
                        {current.resumenIA}
                      </div>
                    )}
                    {current.audioUrl && (
                      <button className="w-full flex items-center justify-center gap-2 h-9 rounded-md border border-border/60 text-sm font-medium hover:bg-muted/40 transition-colors">
                        <PhoneCall className="w-3.5 h-3.5" /> Escuchar grabación
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="bg-muted rounded-lg px-3 py-2 text-sm w-fit max-w-[85%]">{current.userMsg}</div>
                    <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/60 dark:border-emerald-500/20 rounded-lg px-3 py-2 text-sm w-fit max-w-[85%] ml-auto">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 mb-1">Agente IA</div>
                      {current.aiMsg}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <button onClick={() => onOpenContact(current.contactName)} className="text-xs font-semibold text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1">
                    Abrir Ficha <ChevronRight className="w-3 h-3" />
                  </button>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" /> Ver en GHL
                  </span>
                </div>
                {evidence.length > 1 && (
                  <div className="flex items-center justify-center gap-3 pt-1">
                    <button
                      onClick={() => setEvidenceIdx((i) => Math.max(0, i - 1))}
                      disabled={evidenceIdx === 0}
                      className="p-1 rounded-full hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setEvidenceIdx((i) => Math.min(evidence.length - 1, i + 1))}
                      disabled={evidenceIdx === evidence.length - 1}
                      className="p-1 rounded-full hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="p-5 border-t border-border/50 space-y-2">
          <button
            onClick={onPatch}
            className="w-full h-11 rounded-md bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold transition-colors"
          >
            Marcar grupo resuelto — cierra los ×{group.casesCount} casos
          </button>
          <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
            Si el patrón reaparece tras resolverse, se reabre marcado como "el ajuste anterior no funcionó"
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detalle de un ajuste ya aplicado (fila del Historial)                */
/* ------------------------------------------------------------------ */

function AdjustmentDetailDrawer({ entry, onClose }: { entry: AdjustmentEntry; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-150" onClick={onClose} />
      <div className="relative w-full max-w-md bg-popover text-popover-foreground h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <div className="flex items-center justify-between p-5 border-b border-border/50">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">✓</span>
            </div>
            <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full">{entry.date}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">{entry.issue}</h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{entry.count} casos</span>
              <div className="inline-flex items-center rounded-full border text-foreground border-border/50 font-medium text-xs px-2 py-0.5">
                {entry.agentIcon} {entry.agentName}
              </div>
              <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400 bg-violet-500/10 px-2 py-1 rounded-md tracking-widest uppercase">
                {entry.category}
              </span>
            </div>
          </div>

          {entry.diagnostico && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Diagnóstico</div>
              <p className="text-sm text-foreground/90 bg-muted/40 border border-border/50 rounded-xl p-3.5 leading-relaxed">{entry.diagnostico}</p>
            </div>
          )}

          {entry.correctionBlock && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Ajuste aplicado</div>
              <div className="bg-[#0a0a0a] text-white rounded-xl p-3.5 text-sm font-mono leading-relaxed">{entry.correctionBlock}</div>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border/50">
            Aplicado por <span className="font-medium text-foreground">{entry.author}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vista principal                                                     */
/* ------------------------------------------------------------------ */

export default function AgentsAudit({ onScreenChange }: { onScreenChange?: (label: string) => void }) {
  const { agents, alerts, adjustments, patchAlertGroup } = useAgentAudit();
  const closer = useClosurer();
  const setter = useSetter();

  const [filter, setFilter] = useState<Filter>("todos");
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>(null);
  const [openGroupKey, setOpenGroupKey] = useState<{ agentId: AgentId; errorCode: string } | null>(null);
  const [ficheName, setFicheName] = useState<string | null>(null);
  const [openAdjustment, setOpenAdjustment] = useState<AdjustmentEntry | null>(null);

  const groups = groupAlerts(alerts);
  const graveGroups = groups.filter((g) => g.severity === "rojo" && g.hasActive);
  const oldestGrave = [...graveGroups].sort((a, b) => b.openedDaysAgo - a.openedDaysAgo)[0];

  const textAgents = agents.filter((a) => a.type === "text");
  const vozAgents = agents.filter((a) => a.type === "voz");
  const showText = filter === "todos" || filter === "text";
  const showVoz = filter === "todos" || filter === "voz";

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;
  const openGroup = openGroupKey ? groups.find((g) => g.agentId === openGroupKey.agentId && g.errorCode === openGroupKey.errorCode) ?? null : null;

  useEffect(() => {
    onScreenChange?.(selectedAgent ? `Auditoría de Agentes — ${selectedAgent.name}` : "Auditoría de Agentes");
  }, [selectedAgent, onScreenChange]);

  const isCloserContact = ficheName ? !!closer.contacts[ficheName] : false;
  const isSetterContact = ficheName ? !!setter.contacts[ficheName] : false;

  const filterBtn = (active: boolean) =>
    cn(
      "px-6 py-2 rounded-lg text-sm font-semibold transition-all duration-300",
      active
        ? "bg-card text-foreground shadow-[0_2px_10px_rgba(0,0,0,0.05)] dark:shadow-[0_2px_10px_rgba(0,0,0,0.2)] border border-border/50"
        : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
    );

  return (
    <div className="flex-1 bg-[#fcfcfd] dark:bg-background overflow-y-scroll">
      <div className="p-10 max-w-[1200px] mx-auto space-y-8 pb-24">
        {selectedAgent ? (
          <AgentDetailView
            agent={selectedAgent}
            groups={groups}
            adjustments={adjustments}
            onBack={() => setSelectedAgentId(null)}
            onOpenGroup={(agentId, errorCode) => setOpenGroupKey({ agentId, errorCode })}
            onOpenAdjustment={(entry) => setOpenAdjustment(entry)}
          />
        ) : (
          <>
            {/* Header */}
            <div className="flex items-end justify-between mb-10 pr-14 lg:pr-0">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center justify-center px-3 py-1.5 rounded-full bg-violet-500/10 text-violet-700 dark:text-violet-400 text-[10px] font-bold tracking-[0.2em] uppercase w-fit">
                    AGENTES
                  </div>
                  <span className="text-xs font-medium text-muted-foreground">Últimos 30 días</span>
                </div>
                <h1 className="text-4xl font-light tracking-tight text-foreground">Salud de los agentes</h1>
              </div>
              <div className="flex items-center p-1 bg-muted/30 rounded-xl border border-border/50 shadow-sm backdrop-blur-md">
                <button onClick={() => setFilter("todos")} className={filterBtn(filter === "todos")}>Todos</button>
                <button onClick={() => setFilter("text")} className={filterBtn(filter === "text")}>💬 Agentes de Texto</button>
                <button onClick={() => setFilter("voz")} className={filterBtn(filter === "voz")}>📞 Agentes de Voz</button>
              </div>
            </div>

            {/* Warning banner */}
            {graveGroups.length > 0 && (
              <div
                onClick={() => oldestGrave && setSelectedAgentId(oldestGrave.agentId)}
                className="w-full bg-rose-500/5 border border-rose-500/20 rounded-2xl p-5 flex items-center justify-between cursor-pointer hover:bg-rose-500/10 transition-colors mb-8 group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center">
                    <div className="w-3 h-3 rounded-full bg-rose-500 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-rose-600 dark:text-rose-400">
                      {graveGroups.length} casos graves abiertos (incluye voz)
                    </h4>
                    <p className="text-xs text-rose-600/70 dark:text-rose-400/70 mt-0.5 font-medium">
                      El más antiguo lleva {oldestGrave?.openedDaysAgo} día{(oldestGrave?.openedDaysAgo ?? 0) > 1 ? "s" : ""} sin resolución
                    </p>
                  </div>
                </div>
                <div className="text-xs font-bold uppercase tracking-widest text-rose-600 dark:text-rose-400 flex items-center gap-1 opacity-80 group-hover:opacity-100 group-hover:translate-x-1 transition-all">
                  Verlos <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            )}

            {/* Agent groups */}
            <div className="space-y-12">
              {showText && (
                <div className="space-y-6">
                  <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-2">💬 AGENTES DE TEXTO</h2>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {textAgents.map((agent) => (
                      <AgentCard key={agent.id} agent={agent} groups={groups} onClick={() => setSelectedAgentId(agent.id)} />
                    ))}
                  </div>
                </div>
              )}

              {showVoz && (
                <div className="space-y-6">
                  <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-2">📞 AGENTES DE VOZ</h2>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {vozAgents.map((agent) => (
                      <AgentCard key={agent.id} agent={agent} groups={groups} onClick={() => setSelectedAgentId(agent.id)} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Historial de Ajustes */}
            <div className="pt-12">
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-3">
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Historial de Ajustes</h3>
                  <span className="text-[10px] font-medium text-muted-foreground/60 px-2 py-0.5 rounded-full bg-muted/50">
                    Queda guardado para siempre
                  </span>
                </div>
              </div>
              <div className="border text-card-foreground shadow-md border-border/80 rounded-2xl bg-card overflow-hidden">
                <div className="relative w-full overflow-auto">
                  <table className="w-full caption-bottom text-sm">
                    <tbody className="[&_tr:last-child]:border-0">
                      {adjustments.map((row, i) => (
                        <tr
                          key={i}
                          onClick={() => setOpenAdjustment(row)}
                          className="border-b transition-colors hover:bg-muted/30 border-border/30 cursor-pointer"
                        >
                          <td className="p-4 align-middle w-12 text-center">
                            <div className="w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
                              <span className="text-emerald-600 dark:text-emerald-400 text-xs">✓</span>
                            </div>
                          </td>
                          <td className="p-4 align-middle text-xs text-muted-foreground w-32 font-medium">{row.date}</td>
                          <td className="p-4 align-middle font-semibold text-sm text-foreground">
                            {row.issue}
                            <span className="text-muted-foreground font-normal ml-2 bg-muted px-1.5 py-0.5 rounded text-[10px]">{row.count}</span>
                          </td>
                          <td className="p-4 align-middle">
                            <div className="inline-flex items-center rounded-full border text-foreground border-border/50 font-medium text-xs px-2 py-0.5">
                              {row.agentIcon} {row.agentName}
                            </div>
                          </td>
                          <td className="p-4 align-middle">
                            <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400 bg-violet-500/10 px-2 py-1 rounded-md tracking-widest uppercase">
                              {row.category}
                            </span>
                          </td>
                          <td className="p-4 align-middle text-xs text-muted-foreground text-right font-medium">{row.author}</td>
                          <td className="p-4 align-middle w-8">
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {openGroup && !ficheName && (
        <AlertGroupDrawer
          group={openGroup}
          onClose={() => setOpenGroupKey(null)}
          onPatch={() => {
            patchAlertGroup(openGroup.agentId, openGroup.errorCode);
            setOpenGroupKey(null);
          }}
          onOpenContact={(name) => setFicheName(name)}
        />
      )}

      {openAdjustment && <AdjustmentDetailDrawer entry={openAdjustment} onClose={() => setOpenAdjustment(null)} />}

      <ContactDrawer
        name={ficheName}
        onClose={() => setFicheName(null)}
        role={isSetterContact && !isCloserContact ? "setter" : "closer"}
        contact={isCloserContact ? closer.contacts[ficheName ?? ""] ?? null : null}
        setterContact={isSetterContact ? setter.contacts[ficheName ?? ""] ?? null : null}
        /* `situacion: result.situacionSlug` es obligatorio, igual que en CloserAI.tsx:2173.
           Sin ese mapeo el guard de `closerStore.advance()` —que exige `situacion` y `modo`
           para hacer el POST— nunca se cumplía, así que un Seguimiento registrado desde esta
           vista se veía guardado y solo vivía en memoria. */
        onAdvance={(result) => ficheName && result.stage && closer.advance(ficheName, { ...result, stage: result.stage, situacion: result.situacionSlug })}
        onSetterAdvance={(result) => ficheName && setter.advance(ficheName, result)}
        onAddNota={(texto) => {
          if (!ficheName) return;
          if (isCloserContact) closer.addNota(ficheName, texto);
          else if (isSetterContact) setter.addNota(ficheName, texto);
        }}
        onResolveIntervention={() => {
          if (!ficheName) return;
          if (isCloserContact) closer.resolveIntervention(ficheName);
          else if (isSetterContact) setter.resolveIntervention(ficheName);
        }}
        onBotStateChange={(estado, evento, autor) => {
          if (!ficheName) return;
          if (isCloserContact) closer.setBotEstado(ficheName, estado, evento, autor);
          else if (isSetterContact) setter.setBotEstado(ficheName, estado, evento, autor);
        }}
      />
    </div>
  );
}
