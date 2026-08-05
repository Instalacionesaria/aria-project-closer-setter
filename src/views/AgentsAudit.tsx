import { useEffect, useMemo, useState, type MouseEvent } from "react";
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
  ArrowDown,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { cn } from "../lib/utils";
import ContactDrawer from "./ContactDrawer";
import { useClosurer } from "../lib/closerStore";
import { useSetter } from "../lib/setterStore";
import {
  useAgentAudit,
  CATEGORY_LABEL,
  type AgentInfo,
  type AgentId,
  type AjusteAplicado,
  type AlertCategoria,
  type AlertSeveridad,
  type GrupoAlerta,
} from "../lib/agentAuditStore";

type Filter = "todos" | "text" | "voz";

const SENTIMENT_ROW =
  "flex items-center gap-2.5 px-3 py-1.5 rounded-full bg-muted/30 border border-border/40 text-left shadow-sm";
const SENTIMENT_LABEL = "text-[9px] font-bold text-muted-foreground uppercase tracking-widest";
const OP_CARD =
  "flex flex-col gap-1 p-4 rounded-2xl border border-border/80 dark:border-border bg-muted/90 dark:bg-muted/40 hover:bg-muted transition-colors shadow";
const PANEL_VACIO =
  "text-sm text-muted-foreground border border-dashed border-border/60 rounded-2xl p-6 leading-relaxed";
const ROTULO = "text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground";

/* ------------------------------------------------------------------ */
/* Formato                                                             */
/* ------------------------------------------------------------------ */

/** "hace 2 horas" / "hace 3 días". El servidor manda ISO y la vista compone (§ contrato de api.ts). */
function hace(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d > 1 ? "s" : ""}`;
}

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });

const diasTexto = (d: number) => (d === 0 ? "menos de 1 día" : `${d} día${d > 1 ? "s" : ""}`);

/** Grupos abiertos de un agente: con al menos un caso activo o resuelto por humano sin parchear. */
const gruposAbiertosDe = (grupos: GrupoAlerta[], agentId: AgentId) =>
  grupos.filter((g) => g.patron.agenteId === agentId && g.abierto);

/** Orden de la lista de trabajo: severidad (rojo primero), después antigüedad descendente. */
const ordenarCola = (grupos: GrupoAlerta[]) =>
  [...grupos].sort((a, b) => {
    if (a.patron.severidad !== b.patron.severidad) return a.patron.severidad === "rojo" ? -1 : 1;
    return b.diasAbierto - a.diasAbierto;
  });

/* ------------------------------------------------------------------ */
/* Piezas chicas                                                       */
/* ------------------------------------------------------------------ */

function SeverityDot({ severity }: { severity: AlertSeveridad }) {
  return <div className={cn("w-2 h-2 rounded-full shrink-0", severity === "rojo" ? "bg-rose-500" : "bg-amber-500")} />;
}

function CategoryChip({ category }: { category: AlertCategoria }) {
  return (
    <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400 bg-violet-500/10 px-2 py-1 rounded-md tracking-widest uppercase shrink-0">
      {CATEGORY_LABEL[category] ?? category}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Tarjeta de agente                                                   */
/* ------------------------------------------------------------------ */

/**
 * Una tarjeta puede estar en tres estados y los tres se ven distinto a propósito:
 *
 *   · **Sin auditor** — no hay quién lo evalúe todavía. Se explica el motivo, que es
 *     distinto para el de setter (decisión de diseño) que para los de voz (falta la fuente).
 *     No se atenúa: atenuarla la haría leer como "deshabilitada por un bug".
 *   · **Con auditor y sin análisis** — el estado normal de hoy. Un guion, no un `0%`: un
 *     cero afirma una medición que nadie hizo.
 *   · **Con datos** — como siempre.
 */
function AgentCard({
  agent,
  grupos,
  onClick,
}: {
  agent: AgentInfo;
  grupos: GrupoAlerta[];
  onClick: () => void;
}) {
  const abiertos = gruposAbiertosDe(grupos, agent.id);
  const rojos = abiertos.filter((g) => g.patron.severidad === "rojo").length;
  const amarillos = abiertos.filter((g) => g.patron.severidad === "amarillo").length;
  const sinDatos = agent.analisis === 0;

  return (
    <div
      onClick={agent.tieneAuditor ? onClick : undefined}
      className={cn(
        "text-card-foreground relative overflow-hidden border border-border/80 dark:border-border rounded-[2rem] bg-card shadow-lg transition-all duration-500 flex flex-col group/card",
        agent.tieneAuditor ? "hover:shadow-xl cursor-pointer" : "cursor-default",
      )}
    >
      {/* Badge de esquina */}
      <div className="absolute top-6 right-6 flex items-center gap-2 group/alert z-10">
        {!agent.tieneAuditor ? null : sinDatos ? (
          <div className="flex gap-1.5 items-center bg-muted/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-border/50 shadow-sm">
            {/* Ni "✓ AL DÍA" verde (afirma salud que nadie midió) ni contadores en cero. */}
            <span className="text-[10px] font-bold text-muted-foreground">SIN DATOS</span>
          </div>
        ) : abiertos.length === 0 ? (
          <div className="flex gap-1.5 items-center bg-muted/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-border/50 shadow-sm">
            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">✓ AL DÍA</span>
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

      {/* Header — siempre presente: los agentes son entidades reales del producto (§50.10) */}
      <div className="p-8 pb-4 flex items-start gap-4">
        <div className="w-12 h-12 rounded-2xl bg-violet-500/10 flex items-center justify-center border border-violet-500/20 text-violet-600 dark:text-violet-400 shadow-sm shrink-0">
          {agent.icon === "bot" ? <Bot className="w-5 h-5" /> : <PhoneCall className="w-5 h-5" />}
        </div>
        <div className="pt-1">
          <h3 className="text-lg font-semibold tracking-tight leading-none mb-1.5">{agent.name}</h3>
          <div className="text-[10px] font-bold text-foreground uppercase tracking-widest mb-1">{agent.goal}</div>
          <p className="text-[11px] text-muted-foreground font-medium max-w-[240px] leading-relaxed mb-1.5">
            {agent.desc}
          </p>
        </div>
      </div>

      <div className="px-8 pb-8 flex flex-col gap-8">
        {!agent.tieneAuditor ? (
          <div className={PANEL_VACIO}>
            <div className="font-semibold text-foreground mb-1.5">Sin auditor conectado</div>
            {agent.porQueNoHayAuditor}
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between my-2">
              <div className="flex flex-col">
                <div className="flex items-baseline gap-3">
                  {/* `—` en un cuerpo más chico: un guion de 6xl grita una ausencia. */}
                  <span
                    className={cn(
                      "font-semibold tracking-tighter leading-none",
                      agent.metric ? "text-6xl text-foreground" : "text-4xl text-muted-foreground/50",
                    )}
                  >
                    {agent.metric ?? "—"}
                  </span>
                  {agent.delta && (
                    <span
                      className={cn(
                        "text-[10px] font-bold flex items-center gap-1 px-2.5 py-1 rounded-full bg-muted/50",
                        agent.delta.up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
                      )}
                    >
                      {agent.delta.text}
                    </span>
                  )}
                </div>
                {agent.subtext && (
                  <div className="text-xs font-medium text-muted-foreground mt-3 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                    {agent.subtext}
                  </div>
                )}
              </div>

              {agent.sentiment && (
                <div className="flex gap-4 items-center h-[90px]">
                  <div className="w-1.5 h-full rounded-full flex flex-col overflow-hidden bg-muted">
                    <div className="bg-emerald-500 w-full" style={{ height: `${agent.sentiment.positivos}%` }} />
                    <div className="bg-amber-400 w-full" style={{ height: `${agent.sentiment.neutrales}%` }} />
                    <div className="bg-rose-500 w-full" style={{ height: `${agent.sentiment.molestos}%` }} />
                  </div>
                  {/*
                    Etiquetas, no botones. El drill-down de §6.D pide la FRASE DISPARADORA y
                    el auditor no emite ninguna: hoy solo se podría listar el último mensaje,
                    que es literalmente lo que esa spec prohíbe. Se les quitó el hover para
                    que no finjan una interacción que no existe.
                  */}
                  <div className="flex flex-col justify-between h-full py-0.5">
                    <span className={SENTIMENT_ROW}>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="text-xs font-bold text-foreground w-8">{agent.sentiment.positivos}%</span>
                      <span className={SENTIMENT_LABEL}>Positivos</span>
                    </span>
                    <span className={SENTIMENT_ROW}>
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      <span className="text-xs font-bold text-foreground w-8">{agent.sentiment.neutrales}%</span>
                      <span className={SENTIMENT_LABEL}>Neutrales</span>
                    </span>
                    <span className={SENTIMENT_ROW}>
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                      <span className="text-xs font-bold text-foreground w-8">{agent.sentiment.molestos}%</span>
                      <span className={SENTIMENT_LABEL}>Molestos</span>
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 h-[1px] w-full bg-border/40" />

            {sinDatos ? (
              <div className={PANEL_VACIO}>
                <div className="font-semibold text-foreground mb-1.5">Auditor conectado · sin análisis todavía</div>
                Ninguna conversación pasó por la rúbrica en el período.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Operativos</div>
                <div className={cn("grid gap-2.5", agent.ops.length > 3 ? "grid-cols-3 sm:grid-cols-6" : "grid-cols-3")}>
                  {agent.ops
                    .filter((op) => op.value !== null)
                    .map((op, i) => (
                      <div key={i} className={OP_CARD}>
                        <span className="text-lg font-semibold text-foreground flex items-baseline gap-1">
                          {op.value}
                          {op.sub && <span className="text-[10px] text-muted-foreground font-medium">{op.sub}</span>}
                        </span>
                        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
                          {op.label}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sparkline                                                           */
/* ------------------------------------------------------------------ */

/**
 * Marcas de los ajustes aplicados, ubicadas por su FECHA real.
 *
 * Antes estaban en las posiciones fijas `[len-2, len-6]` — inventadas, y por lo tanto una
 * afirmación falsa sobre cuándo se corrigió algo. Ahora cada ajuste cae en la semana que le
 * corresponde y, si quedó fuera de la ventana del gráfico, simplemente no hay marca.
 */
function indicesDeAjustes(history: AgentInfo["history"], ajustes: AjusteAplicado[]): number[] {
  if (history.length === 0) return [];
  const semanas = history.map((h) => h.week);
  const indices = new Set<number>();
  for (const a of ajustes) {
    const etiqueta = new Date(a.aplicadoEl)
      .toLocaleDateString("es-PE", { day: "2-digit", month: "short" })
      .replace(".", "");
    const i = semanas.findIndex((s) => s.toLowerCase() === etiqueta.toLowerCase());
    if (i >= 0) indices.add(i);
  }
  return [...indices];
}

function Sparkline({ history, ajustes }: { history: AgentInfo["history"]; ajustes: AjusteAplicado[] }) {
  const W = 680;
  const H = 160;
  const PAD = 12;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  /**
   * Con 0 puntos `stepX` sería negativo (`length - 1 = -1`) y el gráfico se dibujaría al
   * revés; con 1 punto no hay línea que trazar. Los dos casos son el estado normal mientras
   * el auditor no haya corrido, así que se dicen en vez de renderizar un SVG roto.
   */
  if (history.length === 0) {
    return (
      <p className={PANEL_VACIO}>
        Sin semanas medidas todavía. El gráfico empieza a dibujarse con el primer análisis.
      </p>
    );
  }
  if (history.length === 1) {
    return (
      <p className={PANEL_VACIO}>
        Una sola semana medida ({history[0].week}: {history[0].sentimientoPositivo}% positivo). Hace falta una
        segunda para ver una tendencia.
      </p>
    );
  }

  const stepX = (W - PAD * 2) / (history.length - 1);
  const xAt = (i: number) => PAD + i * stepX;
  const y = (v: number) => H - PAD - (v / 100) * (H - PAD * 2);

  // La tasa solo se dibuja si el servidor la mandó. Mientras sea `null` (no se puede
  // reconstruir hacia atrás) dibujarla sería trazar dos veces la misma serie.
  const hayTasa = history.some((h) => h.tasa !== null);
  const sentPoints = history.map((h, i) => `${xAt(i)},${y(h.sentimientoPositivo)}`).join(" ");
  const tasaPoints = hayTasa ? history.map((h, i) => `${xAt(i)},${y(h.tasa ?? 0)}`).join(" ") : "";
  const marcas = indicesDeAjustes(history, ajustes);

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
          <span className="w-4 h-0.5 bg-teal-500 inline-block" style={{ borderTop: "2px dashed" }} /> Sentimiento
          positivo
        </span>
        {hayTasa && (
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-0.5 bg-foreground inline-block" /> Tasa de trabajo
          </span>
        )}
        {marcas.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-violet-500 inline-block" /> Ajuste aplicado
          </span>
        )}
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-40 cursor-crosshair"
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {hoverIdx !== null && (
            <line
              x1={xAt(hoverIdx)}
              x2={xAt(hoverIdx)}
              y1={0}
              y2={H}
              stroke="currentColor"
              strokeWidth={1}
              className="text-border"
            />
          )}
          <polyline points={sentPoints} fill="none" stroke="#14b8a6" strokeWidth={2} strokeDasharray="4 4" />
          {hayTasa && (
            <polyline points={tasaPoints} fill="none" stroke="currentColor" strokeWidth={2} className="text-foreground" />
          )}
          {history.map((h, i) => (
            <circle key={`s-${i}`} cx={xAt(i)} cy={y(h.sentimientoPositivo)} r={2.5} fill="#14b8a6" />
          ))}
          {marcas.map((i) => (
            <circle
              key={`adj-${i}`}
              cx={xAt(i)}
              cy={y(history[i].sentimientoPositivo)}
              r={3.5}
              fill="#8b5cf6"
              stroke="white"
              strokeWidth={1.5}
            >
              <title>Ajuste aplicado</title>
            </circle>
          ))}
          {hovered && (
            <circle
              cx={xAt(hoverIdx!)}
              cy={y(hovered.sentimientoPositivo)}
              r={5}
              fill="white"
              stroke="#14b8a6"
              strokeWidth={2}
            />
          )}
        </svg>
        {hovered && (
          <div
            className="absolute top-2 z-10 pointer-events-none bg-popover text-popover-foreground border border-border rounded-lg shadow-lg px-3 py-2 text-xs whitespace-nowrap"
            style={{
              left: `${tooltipLeftPct}%`,
              transform: tooltipAlignRight ? "translateX(-100%)" : "translateX(8px)",
            }}
          >
            <div className="font-semibold mb-1">{hovered.week}</div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Sentimiento positivo:</span>
              <span className="font-bold text-teal-600 dark:text-teal-400">{hovered.sentimientoPositivo}%</span>
            </div>
            {hovered.tasa !== null && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Tasa de trabajo:</span>
                <span className="font-bold">{hovered.tasa}%</span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground px-1">
        {history
          .filter((_, i) => i % 2 === 0 || i === history.length - 1)
          .map((h, i) => (
            <span key={i}>{h.week}</span>
          ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detalle de agente                                                   */
/* ------------------------------------------------------------------ */

function AgentDetailView({
  agent,
  grupos,
  ajustes,
  ventanaDias,
  onBack,
  onOpenGroup,
  onOpenAdjustment,
}: {
  agent: AgentInfo;
  grupos: GrupoAlerta[];
  ajustes: AjusteAplicado[];
  ventanaDias: number;
  onBack: () => void;
  onOpenGroup: (agentId: AgentId, errorCode: string) => void;
  onOpenAdjustment: (entry: AjusteAplicado) => void;
}) {
  const abiertos = ordenarCola(gruposAbiertosDe(grupos, agent.id));
  const rojos = abiertos.filter((g) => g.patron.severidad === "rojo").length;
  const amarillos = abiertos.filter((g) => g.patron.severidad === "amarillo").length;
  // Se cruza por ID, no por el nombre visible: el join por string de display era el mismo
  // error de modelado que rompió "Abrir Ficha".
  const delAgente = ajustes.filter((a) => a.agenteId === agent.id);

  const pos = agent.sentiment?.positivos ?? null;
  const SentimentIcon = pos === null ? Meh : pos >= 70 ? Smile : pos >= 40 ? Meh : Frown;
  const sentimentColor =
    pos === null
      ? "text-muted-foreground/40 border-border"
      : pos >= 70
        ? "text-emerald-500 border-emerald-200"
        : pos >= 40
          ? "text-amber-500 border-amber-200"
          : "text-rose-500 border-rose-200";

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
            <div className={cn("text-lg font-semibold", !agent.metric && "text-muted-foreground/50")}>
              {agent.metric ?? "—"}
            </div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{agent.goal}</div>
          </div>
          {agent.sentiment && (
            <>
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
            </>
          )}
        </div>
      </div>

      <div className="border border-border/60 rounded-2xl bg-card p-6 shadow-sm">
        <div className={cn(ROTULO, "mb-4")}>
          Evolución del sentimiento{agent.history.length > 1 ? ` (${agent.history.length} semanas)` : ""}
        </div>
        <Sparkline history={agent.history} ajustes={delAgente} />
      </div>

      {agent.ops.some((op) => op.value !== null) && (
        <div>
          <div className="text-[9px] font-bold text-muted-foreground uppercase tracking-[0.2em] mb-3">
            Operativos · Últimos {ventanaDias} días
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
            {agent.ops
              .filter((op) => op.value !== null)
              .map((op, i) => (
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
      )}

      <div className="flex items-center gap-4 text-xs font-medium text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> {rojos} rojos abiertos
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> {amarillos} amarillos
        </span>
        <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
          ✓ {delAgente.length} ajustes aplicados
        </span>
      </div>

      <div>
        <div className={cn(ROTULO, "mb-3")}>Lista de trabajo del técnico</div>
        {abiertos.length === 0 ? (
          <p className={PANEL_VACIO}>
            {agent.analisis === 0
              ? "Todavía no hay conversaciones analizadas para este agente, así que no hay casos que revisar."
              : `Sin casos abiertos. Las ${agent.analisis} conversaciones analizadas en los últimos ${ventanaDias} días pasaron la rúbrica.`}
          </p>
        ) : (
          <div className="border border-border/60 rounded-2xl bg-card divide-y divide-border/50 shadow-sm overflow-hidden">
            {abiertos.map((g) => (
              <button
                key={g.key}
                onClick={() => onOpenGroup(g.patron.agenteId, g.patron.errorCode)}
                className="w-full flex items-center justify-between gap-4 p-4 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <SeverityDot severity={g.patron.severidad} />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate flex items-center gap-2">
                      {g.patron.titulo}
                      <span className="text-[10px] font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        ×{g.casesCount}
                      </span>
                      {g.patron.reincidenteDesde && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                          Reincidente
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      abierto hace {diasTexto(g.diasAbierto)}
                      {g.soloResueltosPorHumano && (
                        <span className="ml-2 text-emerald-600 dark:text-emerald-400">· salvado por humano</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <CategoryChip category={g.patron.categoria} />
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className={cn(ROTULO, "mb-3")}>Historial de ajustes de este agente</div>
        {delAgente.length === 0 ? (
          <p className={PANEL_VACIO}>Este agente no tiene ajustes registrados.</p>
        ) : (
          <div className="border border-border/60 rounded-2xl bg-card divide-y divide-border/50 shadow-sm overflow-hidden">
            {delAgente.map((row) => (
              <button
                key={row.id}
                onClick={() => onOpenAdjustment(row)}
                className="w-full flex items-center gap-4 p-4 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <span className="text-emerald-600 dark:text-emerald-400 text-xs">✓</span>
                </div>
                <span className="text-xs text-muted-foreground w-28 shrink-0">{fechaCorta(row.aplicadoEl)}</span>
                <span className="font-semibold text-sm text-foreground flex-1">
                  {row.titulo}
                  <span className="text-muted-foreground font-normal ml-1 bg-muted px-1.5 py-0.5 rounded text-[10px]">
                    ×{row.casosCerrados}
                  </span>
                </span>
                <CategoryChip category={row.categoria as AlertCategoria} />
                <span className="text-xs text-muted-foreground shrink-0">{row.autor}</span>
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
/* Bloque de corrección al prompt                                      */
/* ------------------------------------------------------------------ */

/**
 * DICE AHORA → DEBERÍA DECIR.
 *
 * Apilado y no en dos columnas: el drawer es `max-w-md`, y partirlo dejaría ~200px de ancho
 * para texto monoespaciado con líneas de prompt.
 *
 * `whitespace-pre-wrap` no es cosmético. Un fragmento real de prompt tiene viñetas, saltos y
 * sangría; sin esto llega al técnico como un chorizo de una línea que no se puede pegar de
 * vuelta. Con el `correctionBlock` sembrado —una frase— no se notaba.
 */
function BloqueCorreccion({ patron }: { patron: GrupoAlerta["patron"] }) {
  const [copiado, setCopiado] = useState(false);

  if (!patron.correccion) {
    return (
      <p className={PANEL_VACIO}>
        Este caso no dejó una corrección propuesta. Revisá el diagnóstico y la evidencia para decidir el ajuste.
      </p>
    );
  }

  const copiar = () => {
    const partes = [
      `# ${patron.titulo}  (${patron.errorCode})`,
      patron.promptRef ? `Archivo: ${patron.promptRef.archivo}${patron.promptSeccion ? ` · § ${patron.promptSeccion}` : ""}` : "",
      patron.fragmentoPrompt ? `\n## Dice ahora\n${patron.fragmentoPrompt}` : "",
      `\n## Debería decir\n${patron.correccion}`,
    ].filter(Boolean);
    navigator.clipboard?.writeText(partes.join("\n"));
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1600);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className={ROTULO}>
          {patron.ajustadoEl ? `Corrección aplicada el ${fechaCorta(patron.ajustadoEl)}` : "Corrección propuesta al prompt"}
        </div>
        {patron.promptRef && (
          <span className="text-[10px] font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded truncate max-w-[55%]">
            {patron.promptRef.archivo}
            {patron.promptSeccion ? ` · § ${patron.promptSeccion}` : ""}
          </span>
        )}
      </div>

      {patron.promptDesactualizado && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          El prompt cambió desde que se detectó esto: el fragmento citado puede ya no existir. Conviene revalidarlo
          antes de aplicar la corrección.
        </p>
      )}

      {patron.fragmentoPrompt ? (
        <>
          <div className="rounded-xl border-l-4 border-rose-500 bg-rose-500/5 p-3">
            <div className="text-[9px] font-bold uppercase tracking-widest text-rose-700 dark:text-rose-400 mb-1.5">
              Dice ahora
            </div>
            <div className="text-sm font-mono leading-relaxed whitespace-pre-wrap break-words">
              {patron.fragmentoPrompt}
            </div>
          </div>
          <div className="flex justify-center">
            <ArrowDown className="w-4 h-4 text-muted-foreground" />
          </div>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          El auditor no tenía el prompt del agente cuando detectó esto, así que no hay un fragmento que citar. La
          corrección de abajo es una instrucción para <strong>agregar</strong>.
        </p>
      )}

      <div className="rounded-xl border-l-4 border-emerald-500 bg-emerald-500/5 p-3">
        <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 mb-1.5">
          {patron.correccionTipo === "reemplazo" ? "Debería decir" : "Agregar al prompt"}
        </div>
        <div className="text-sm font-mono leading-relaxed whitespace-pre-wrap break-words">{patron.correccion}</div>
      </div>

      <button
        onClick={copiar}
        className="w-full flex items-center justify-center gap-2 h-10 rounded-md bg-foreground text-background text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        <Copy className="w-3.5 h-3.5" /> {copiado ? "¡Copiado!" : "Copiar corrección"}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer de grupo                                                     */
/* ------------------------------------------------------------------ */

function AlertGroupDrawer({
  grupo,
  onClose,
  onPatch,
  onOpenContact,
}: {
  grupo: GrupoAlerta;
  onClose: () => void;
  onPatch: () => Promise<void>;
  onOpenContact: (caso: GrupoAlerta["casos"][number]) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  const conEvidencia = grupo.casos.filter((c) => c.evidencia);
  const actual = conEvidencia[idx];
  const porCerrar = grupo.casos.filter((c) => c.estado !== "parcheado").length;

  const guardar = async () => {
    setGuardando(true);
    setErrorGuardar(null);
    try {
      await onPatch();
    } catch (e) {
      // El drawer queda abierto con el error: pintar la fila del historial antes de que el
      // servidor confirme sería el éxito falso que prohíbe la cabecera de api.ts.
      setErrorGuardar((e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-150" onClick={onClose} />
      <div className="relative w-full max-w-md bg-popover text-popover-foreground h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <div className="flex items-center justify-between p-5 border-b border-border/50">
          <div className="flex items-center gap-2">
            <SeverityDot severity={grupo.patron.severidad} />
            <CategoryChip category={grupo.patron.categoria} />
            <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full">
              abierto hace {diasTexto(grupo.diasAbierto)}
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <div>
            <h3 className="text-lg font-semibold">{grupo.patron.titulo}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                ×{grupo.casesCount} casos
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">{grupo.patron.errorCode}</span>
            </div>
          </div>

          {/* Reemplaza al microtexto que PROMETÍA la reapertura. Ahora se dice solo cuando pasó. */}
          {grupo.patron.reincidenteDesde && grupo.patron.ajustadoEl && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Este patrón volvió a aparecer el {fechaCorta(grupo.patron.reincidenteDesde)}, después del ajuste del{" "}
              {fechaCorta(grupo.patron.ajustadoEl)}. El ajuste anterior no lo corrigió.
            </p>
          )}

          {grupo.patron.diagnostico && (
            <div className="space-y-2">
              <div className={ROTULO}>Diagnóstico</div>
              <p className="text-sm text-foreground/90 bg-muted/40 border border-border/50 rounded-xl p-3.5 leading-relaxed">
                {grupo.patron.diagnostico}
              </p>
            </div>
          )}

          <BloqueCorreccion patron={grupo.patron} />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className={ROTULO}>Evidencia</div>
              {conEvidencia.length > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  Muestra {idx + 1} de {conEvidencia.length}
                </span>
              )}
            </div>
            {conEvidencia.length === 0 ? (
              <p className={PANEL_VACIO}>
                Los análisis de este patrón no dejaron el par de mensajes. Abrí la ficha del contacto para ver la
                conversación completa.
              </p>
            ) : (
              <div className="border border-border/50 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold flex items-center gap-2">
                    {actual.nombre ?? "Contacto sin nombre en la caché"}
                    {actual.estado === "resuelto_por_humano" && (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                        Salvado por humano
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{hace(actual.analizadoEl)}</span>
                </div>

                <div className="space-y-2">
                  <div className="bg-muted rounded-lg px-3 py-2 text-sm w-fit max-w-[85%] whitespace-pre-wrap">
                    {actual.evidencia!.mensajeUsuario}
                  </div>
                  <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200/60 dark:border-emerald-500/20 rounded-lg px-3 py-2 text-sm w-fit max-w-[85%] ml-auto whitespace-pre-wrap">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-400 mb-1">
                      Agente IA
                    </div>
                    {actual.evidencia!.mensajeIa}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => onOpenContact(actual)}
                    className="text-xs font-semibold text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1"
                  >
                    Abrir Ficha <ChevronRight className="w-3 h-3" />
                  </button>
                  {/* Antes era un <span> inerte. La URL la arma el servidor: el locationId no viaja al browser. */}
                  {actual.ghlUrl && (
                    <a
                      href={actual.ghlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" /> Ver en GHL
                    </a>
                  )}
                </div>

                {conEvidencia.length > 1 && (
                  <div className="flex items-center justify-center gap-3 pt-1">
                    <button
                      onClick={() => setIdx((i) => Math.max(0, i - 1))}
                      disabled={idx === 0}
                      className="p-1 rounded-full hover:bg-muted disabled:opacity-30 disabled:pointer-events-none"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setIdx((i) => Math.min(conEvidencia.length - 1, i + 1))}
                      disabled={idx === conEvidencia.length - 1}
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
          {errorGuardar && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              No se pudo guardar el ajuste: {errorGuardar}
            </p>
          )}
          <button
            onClick={guardar}
            disabled={guardando || porCerrar === 0}
            className="w-full h-11 rounded-md bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:pointer-events-none text-white text-sm font-semibold transition-colors"
          >
            {guardando ? "Guardando…" : `Marcar grupo resuelto — cierra los ×${porCerrar} casos`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detalle de un ajuste ya aplicado                                    */
/* ------------------------------------------------------------------ */

function AdjustmentDetailDrawer({
  entry,
  agentName,
  onClose,
}: {
  entry: AjusteAplicado;
  agentName: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-150" onClick={onClose} />
      <div className="relative w-full max-w-md bg-popover text-popover-foreground h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <div className="flex items-center justify-between p-5 border-b border-border/50">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">✓</span>
            </div>
            <span className="text-[10px] font-medium text-muted-foreground bg-muted px-2 py-1 rounded-full">
              {fechaCorta(entry.aplicadoEl)}
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">{entry.titulo}</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                ×{entry.casosCerrados} casos cerrados
              </span>
              <div className="inline-flex items-center rounded-full border text-foreground border-border/50 font-medium text-xs px-2 py-0.5">
                {agentName}
              </div>
              <CategoryChip category={entry.categoria as AlertCategoria} />
            </div>
          </div>

          {entry.diagnostico && (
            <div className="space-y-2">
              <div className={ROTULO}>Diagnóstico</div>
              <p className="text-sm text-foreground/90 bg-muted/40 border border-border/50 rounded-xl p-3.5 leading-relaxed">
                {entry.diagnostico}
              </p>
            </div>
          )}

          {entry.fragmentoPrompt && (
            <div className="space-y-2">
              <div className={ROTULO}>Decía</div>
              <div className="rounded-xl border-l-4 border-rose-500 bg-rose-500/5 p-3 text-sm font-mono leading-relaxed whitespace-pre-wrap break-words">
                {entry.fragmentoPrompt}
              </div>
            </div>
          )}

          {entry.correccion && (
            <div className="space-y-2">
              <div className={ROTULO}>Ajuste aplicado</div>
              <div className="rounded-xl border-l-4 border-emerald-500 bg-emerald-500/5 p-3 text-sm font-mono leading-relaxed whitespace-pre-wrap break-words">
                {entry.correccion}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-2 border-t border-border/50">
            Aplicado por <span className="font-medium text-foreground">{entry.autor}</span>
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
  const {
    estado,
    errorMensaje,
    ventanaDias,
    agents,
    grupos,
    ajustes,
    analisisTotales,
    refrescar,
    cargarSiHaceFalta,
    marcarGrupoResuelto,
  } = useAgentAudit();
  const closer = useClosurer();
  const setter = useSetter();

  // La carga la dispara la VISTA, no el provider: este vive en App.tsx y pedir estos datos
  // en cada arranque le sumaría tres requests a quien nunca abre esta pestaña.
  useEffect(() => {
    void cargarSiHaceFalta();
  }, [cargarSiHaceFalta]);

  const [filter, setFilter] = useState<Filter>("todos");
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>(null);
  const [openGroupKey, setOpenGroupKey] = useState<{ agentId: AgentId; errorCode: string } | null>(null);
  const [openAdjustment, setOpenAdjustment] = useState<AjusteAplicado | null>(null);

  const graves = useMemo(() => grupos.filter((g) => g.patron.severidad === "rojo" && g.hayActivos), [grupos]);
  const graveMasViejo = useMemo(() => [...graves].sort((a, b) => b.diasAbierto - a.diasAbierto)[0], [graves]);

  const textAgents = agents.filter((a) => a.type === "text");
  const vozAgents = agents.filter((a) => a.type === "voz");
  const showText = filter === "todos" || filter === "text";
  const showVoz = filter === "todos" || filter === "voz";

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;
  const openGroup = openGroupKey
    ? (grupos.find((g) => g.patron.agenteId === openGroupKey.agentId && g.patron.errorCode === openGroupKey.errorCode) ??
      null)
    : null;

  useEffect(() => {
    onScreenChange?.(selectedAgent ? `Auditoría de Agentes — ${selectedAgent.name}` : "Auditoría de Agentes");
  }, [selectedAgent, onScreenChange]);

  /**
   * La ficha la maneja la STORE, no un `useState` local con el nombre.
   *
   * El cruce por nombre estaba roto en dos niveles: el `Record` se indexa por `ghlContactId`
   * desde que se borraron las semillas del closer, y además la vista nunca le pasaba el
   * `ghlContactId` al drawer — que es lo que dispara los fetches de chat, notas e historial.
   * Aunque el join hubiera acertado, la ficha habría abierto vacía sobre una persona real.
   */
  const fichaAbierta = closer.openContactName;
  const contactoFicha = fichaAbierta ? (closer.contacts[fichaAbierta] ?? null) : null;
  const setterFicha = fichaAbierta ? (setter.contacts[fichaAbierta] ?? null) : null;

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
            grupos={grupos}
            ajustes={ajustes}
            ventanaDias={ventanaDias}
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
                  <span className="text-xs font-medium text-muted-foreground">Últimos {ventanaDias} días</span>
                  <button
                    onClick={() => void refrescar()}
                    disabled={estado === "cargando"}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    <RefreshCw className={cn("w-3 h-3", estado === "cargando" && "animate-spin")} /> Actualizar
                  </button>
                </div>
                <h1 className="text-4xl font-light tracking-tight text-foreground">Salud de los agentes</h1>
              </div>
              <div className="flex items-center p-1 bg-muted/30 rounded-xl border border-border/50 shadow-sm backdrop-blur-md">
                <button onClick={() => setFilter("todos")} className={filterBtn(filter === "todos")}>
                  Todos
                </button>
                <button onClick={() => setFilter("text")} className={filterBtn(filter === "text")}>
                  💬 Agentes de Texto
                </button>
                <button onClick={() => setFilter("voz")} className={filterBtn(filter === "voz")}>
                  📞 Agentes de Voz
                </button>
              </div>
            </div>

            {/*
              Franja de estado. Los tres casos —error, con graves, sin nada— tienen que verse
              DISTINTOS: sin semillas, un backend caído se vería idéntico al estado normal
              ("el auditor todavía no analizó nada"), que es el peor error posible acá.
            */}
            {estado === "error" ? (
              <div className="w-full bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5 flex items-center justify-between gap-4 mb-8">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                      No se pudo consultar al auditor
                    </h4>
                    <p className="text-xs text-amber-700/70 dark:text-amber-400/70 mt-0.5 font-medium">
                      {errorMensaje} — los números de abajo no están; no es que no haya nada medido.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => void refrescar()}
                  className="text-xs font-bold uppercase tracking-widest text-amber-700 dark:text-amber-400 shrink-0"
                >
                  Reintentar
                </button>
              </div>
            ) : graves.length > 0 ? (
              <div
                onClick={() => graveMasViejo && setSelectedAgentId(graveMasViejo.patron.agenteId)}
                className="w-full bg-rose-500/5 border border-rose-500/20 rounded-2xl p-5 flex items-center justify-between cursor-pointer hover:bg-rose-500/10 transition-colors mb-8 group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-rose-500/10 flex items-center justify-center">
                    <div className="w-3 h-3 rounded-full bg-rose-500 animate-pulse" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-rose-600 dark:text-rose-400">
                      {graves.length} caso{graves.length > 1 ? "s" : ""} grave{graves.length > 1 ? "s" : ""} abierto
                      {graves.length > 1 ? "s" : ""}
                    </h4>
                    <p className="text-xs text-rose-600/70 dark:text-rose-400/70 mt-0.5 font-medium">
                      El más antiguo lleva {diasTexto(graveMasViejo?.diasAbierto ?? 0)} sin resolución
                    </p>
                  </div>
                </div>
                <div className="text-xs font-bold uppercase tracking-widest text-rose-600 dark:text-rose-400 flex items-center gap-1 opacity-80 group-hover:opacity-100 group-hover:translate-x-1 transition-all">
                  Verlos <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            ) : analisisTotales === 0 ? (
              /* El estado que se va a ver durante días. La explicación larga vive ACÁ y solo
                 acá, para no repetir el mismo párrafo en las cuatro tarjetas. */
              <div className="w-full bg-muted/40 border border-border/60 rounded-2xl p-5 mb-8">
                <h4 className="text-sm font-semibold text-foreground">
                  El auditor todavía no analizó ninguna conversación
                </h4>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-3xl">
                  Solo audita los chats donde el agente de IA está atendiendo. Hoy ningún contacto tiene el agente
                  activado, así que no hay nada que medir — se destraba cuando los workflows de GHL empiecen a aplicar{" "}
                  <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">bot_activado</code>. El detalle
                  completo está en <code className="font-mono text-[11px]">/api/agentes/auditor-estado</code>.
                </p>
              </div>
            ) : (
              <div className="w-full bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-5 mb-8">
                <h4 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  Ningún caso grave abierto
                </h4>
                <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70 mt-0.5 font-medium">
                  {analisisTotales} conversaciones analizadas en los últimos {ventanaDias} días.
                </p>
              </div>
            )}

            <div className="space-y-12">
              {showText && (
                <div className="space-y-6">
                  <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-2">
                    💬 AGENTES DE TEXTO
                  </h2>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {textAgents.map((agent) => (
                      <AgentCard
                        key={agent.id}
                        agent={agent}
                        grupos={grupos}
                        onClick={() => setSelectedAgentId(agent.id)}
                      />
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
                      <AgentCard
                        key={agent.id}
                        agent={agent}
                        grupos={grupos}
                        onClick={() => setSelectedAgentId(agent.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Historial de Ajustes */}
            <div className="pt-12">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                  Historial de Ajustes
                </h3>
              </div>
              {ajustes.length === 0 ? (
                <p className={PANEL_VACIO}>
                  Todavía no se aplicó ningún ajuste. Cada vez que marques un grupo como resuelto, queda acá la
                  corrección exacta que se aplicó al prompt, con su fecha y su autor.
                </p>
              ) : (
                <div className="border text-card-foreground shadow-md border-border/80 rounded-2xl bg-card overflow-hidden">
                  <div className="relative w-full overflow-auto">
                    <table className="w-full caption-bottom text-sm">
                      <tbody className="[&_tr:last-child]:border-0">
                        {ajustes.map((row) => (
                          <tr
                            key={row.id}
                            onClick={() => setOpenAdjustment(row)}
                            className="border-b transition-colors hover:bg-muted/30 border-border/30 cursor-pointer"
                          >
                            <td className="p-4 align-middle w-12 text-center">
                              <div className="w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
                                <span className="text-emerald-600 dark:text-emerald-400 text-xs">✓</span>
                              </div>
                            </td>
                            <td className="p-4 align-middle text-xs text-muted-foreground w-32 font-medium">
                              {fechaCorta(row.aplicadoEl)}
                            </td>
                            <td className="p-4 align-middle font-semibold text-sm text-foreground">
                              {row.titulo}
                              <span className="text-muted-foreground font-normal ml-2 bg-muted px-1.5 py-0.5 rounded text-[10px]">
                                ×{row.casosCerrados}
                              </span>
                            </td>
                            <td className="p-4 align-middle">
                              <div className="inline-flex items-center rounded-full border text-foreground border-border/50 font-medium text-xs px-2 py-0.5">
                                {agents.find((a) => a.id === row.agenteId)?.name ?? row.agenteId}
                              </div>
                            </td>
                            <td className="p-4 align-middle">
                              <CategoryChip category={row.categoria as AlertCategoria} />
                            </td>
                            <td className="p-4 align-middle text-xs text-muted-foreground text-right font-medium">
                              {row.autor}
                            </td>
                            <td className="p-4 align-middle w-8">
                              <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {openGroup && !fichaAbierta && (
        <AlertGroupDrawer
          grupo={openGroup}
          onClose={() => setOpenGroupKey(null)}
          onPatch={async () => {
            await marcarGrupoResuelto(openGroup.patron.agenteId, openGroup.patron.errorCode);
            setOpenGroupKey(null);
          }}
          onOpenContact={(caso) => closer.openContact(caso.nombre ?? caso.ghlContactId, caso.ghlContactId)}
        />
      )}

      {openAdjustment && (
        <AdjustmentDetailDrawer
          entry={openAdjustment}
          agentName={agents.find((a) => a.id === openAdjustment.agenteId)?.name ?? openAdjustment.agenteId}
          onClose={() => setOpenAdjustment(null)}
        />
      )}

      <ContactDrawer
        name={fichaAbierta}
        /* Sin esto la ficha abre vacía sobre una persona real: es lo que dispara los fetches
           de chat, notas e historial en closerStore. */
        ghlContactId={closer.openGhlContactId}
        onClose={closer.closeContact}
        role={setterFicha && !contactoFicha ? "setter" : "closer"}
        contact={contactoFicha}
        setterContact={setterFicha}
        /* `situacion: result.situacionSlug` es obligatorio, igual que en CloserAI.tsx:2173.
           Sin ese mapeo el guard de `closerStore.advance()` —que exige `situacion` y `modo`
           para hacer el POST— nunca se cumplía, así que un Seguimiento registrado desde esta
           vista se veía guardado y solo vivía en memoria. */
        onAdvance={(result) =>
          fichaAbierta &&
          result.stage &&
          closer.advance(fichaAbierta, { ...result, stage: result.stage, situacion: result.situacionSlug })
        }
        onSetterAdvance={(result) => fichaAbierta && setter.advance(fichaAbierta, result)}
        onAddNota={(texto) => {
          if (!fichaAbierta) return;
          if (contactoFicha) closer.addNota(fichaAbierta, texto);
          else if (setterFicha) setter.addNota(fichaAbierta, texto);
        }}
        onResolveIntervention={() => {
          if (!fichaAbierta) return;
          if (contactoFicha) closer.resolveIntervention(fichaAbierta);
          else if (setterFicha) setter.resolveIntervention(fichaAbierta);
        }}
        onBotStateChange={(estadoBot, evento, autor) => {
          if (!fichaAbierta) return;
          if (contactoFicha) closer.setBotEstado(fichaAbierta, estadoBot, evento, autor);
          else if (setterFicha) setter.setBotEstado(fichaAbierta, estadoBot, evento, autor);
        }}
      />
    </div>
  );
}
