/**
 * Estadísticas — visión global del negocio y rendimiento del equipo.
 *
 * ── Por qué el store todavía se llama `gerenciaStore` (2026-08-07) ────
 *
 * El módulo se llamaba **Gerencia** y Fabio lo renombró a Estadísticas. Se renombró lo que se
 * ve y el archivo de la vista; **no** el store ni la clave `gerencia` de los ajustes, y no es
 * pereza: esa clave es una propiedad de nivel 1 del JSON que `settingsStore` guarda en
 * localStorage. Renombrarla sin migración hace que la lectura no la encuentre, caiga al
 * default y le borre a cada usuario su Inversión en Meta Ads y su Objetivo de facturación —
 * en silencio, porque el fallback no falla, sustituye. Un nombre viejo en un archivo que nadie
 * abre es más barato que eso.
 */

import { useState, type MouseEvent } from "react";
import {
  Activity,
  PieChart,
  Gauge,
  DollarSign,
  Users,
  TrendingUp,
  ChevronDown,
  Lock,
  Bot,
  Video,
  UserCheck,
  UserX,
  Timer,
  Target,
} from "lucide-react";
import { cn } from "../lib/utils";
import { GERENCIA_PERIODS, GERENCIA_TREND, useGerenciaMetrics, type GerenciaPeriodKey } from "../lib/gerenciaStore";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const moneyK = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : money(n));

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

function SectionHeader({ icon: Icon, title }: { icon: typeof Activity; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="w-4 h-4 text-violet-600 dark:text-violet-400" />
      <h3 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground">{title}</h3>
    </div>
  );
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("bg-card border border-border rounded-2xl p-6 shadow-sm", className)}>
      {children}
    </div>
  );
}

function DeltaBadge({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-bold px-1.5 py-0.5 rounded-md",
        up ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
      )}
    >
      {up ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Selector de período                                                  */
/* ------------------------------------------------------------------ */

function PeriodSelector({ period, onChange }: { period: GerenciaPeriodKey; onChange: (p: GerenciaPeriodKey) => void }) {
  const [open, setOpen] = useState(false);
  const label = GERENCIA_PERIODS.find((p) => p.key === period)?.label ?? "Este mes";
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 items-center gap-2 border px-4 py-2 text-sm font-medium rounded-full bg-background dark:bg-secondary border-border hover:bg-muted/30 transition-colors"
      >
        {label}
        <ChevronDown className="h-4 w-4 opacity-50" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-2 w-56 bg-popover text-popover-foreground border border-border rounded-xl shadow-xl p-1.5 z-20 animate-in fade-in slide-in-from-top-2 duration-150">
            {GERENCIA_PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => {
                  onChange(p.key);
                  setOpen(false);
                }}
                className={cn(
                  "w-full flex items-center px-3 py-2 rounded-lg text-sm text-left transition-colors hover:bg-muted",
                  period === p.key && "font-semibold text-primary",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sección 1 — Volumen y Flujo                                         */
/* ------------------------------------------------------------------ */

function LeadsPorFuenteCard({ leadsPorFuente }: { leadsPorFuente: { metaAds: number; vsl: number; directo: number } }) {
  const max = Math.max(leadsPorFuente.metaAds, leadsPorFuente.vsl, leadsPorFuente.directo);
  const rows = [
    { label: "Meta Lead Ads", value: leadsPorFuente.metaAds, cls: "bg-sky-500" },
    { label: "VSL", value: leadsPorFuente.vsl, cls: "bg-violet-500" },
    { label: "Directos", value: leadsPorFuente.directo, cls: "bg-muted-foreground/50" },
  ];
  return (
    <Card className="space-y-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Leads por fuente</div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground">{r.label}</span>
              <span className="font-semibold">{r.value}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={cn("h-full rounded-full", r.cls)} style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AgendasCard({ agendaron, deltaPct, vsAnterior }: { agendaron: number; deltaPct: number | null; vsAnterior: number | null }) {
  return (
    <Card className="space-y-2 flex flex-col justify-center">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Agendas del período</div>
      <div className="flex items-center gap-2">
        <span className="text-4xl font-bold tracking-tight">{agendaron}</span>
        {deltaPct !== null && <DeltaBadge pct={deltaPct} />}
      </div>
      {vsAnterior !== null && <p className="text-xs text-muted-foreground">vs. período anterior ({vsAnterior})</p>}
    </Card>
  );
}

function DistribucionLeadsCard({
  distribucion,
  totalCalificados,
  objetivoFacturacion,
}: {
  distribucion: { caliente: number; tibio: number; probableLT: number };
  totalCalificados: number;
  objetivoFacturacion: number;
}) {
  const segs = [
    { label: "Caliente", pct: distribucion.caliente, cls: "bg-rose-200 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300" },
    { label: "Tibio", pct: distribucion.tibio, cls: "bg-amber-200 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300" },
    { label: "Probable LT", pct: distribucion.probableLT, cls: "bg-indigo-200 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300" },
  ];
  return (
    <Card className="space-y-4">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Distribución de leads</div>
      <div className="flex rounded-xl overflow-hidden h-11 text-xs font-bold">
        {segs.map((s) => (
          <div key={s.label} className={cn("flex items-center justify-center", s.cls)} style={{ width: `${s.pct}%` }}>
            {s.pct}%
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Total calificados: {totalCalificados}</span>
        <span>Objetivo facturación: {moneyK(objetivoFacturacion)}</span>
      </div>
    </Card>
  );
}

function FunnelStep({ value, label, sub, subCls, last }: { value: number; label: string; sub?: string; subCls?: string; last?: boolean }) {
  return (
    <div className="flex items-center flex-1">
      <div className="flex-1 flex flex-col items-center text-center gap-1.5 py-2">
        <span className="text-3xl font-bold tracking-tight">{value}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
        {sub && <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted", subCls)}>{sub}</span>}
      </div>
      {!last && <ChevronDown className="w-4 h-4 text-muted-foreground/40 shrink-0 -rotate-90 mx-1" />}
    </div>
  );
}

function Funnel({ metrics }: { metrics: ReturnType<typeof useGerenciaMetrics> }) {
  const { funnel, conversionPct, agendaConvPct, showRatePct, closeRatePct } = metrics;
  return (
    <Card>
      <div className="flex items-stretch divide-x divide-border/60">
        <FunnelStep value={funnel.entraron} label="Entraron" />
        <FunnelStep value={funnel.conversaron} label="Conversaron" sub={`${conversionPct}% conv.`} />
        <FunnelStep value={funnel.agendaron} label="Agendaron" sub={`${agendaConvPct}% conv.`} />
        <FunnelStep value={funnel.asistieron} label="Asistieron" sub={`${showRatePct}% show rate`} />
        <FunnelStep value={funnel.compraron} label="Compraron" sub={`${closeRatePct}% close rate`} subCls="text-emerald-600 dark:text-emerald-400 bg-emerald-500/10" last />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Sección 2 — Destino de los que no compraron (donut)                  */
/* ------------------------------------------------------------------ */

function Donut({ segments }: { segments: { label: string; value: number; cls: string; stroke: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const R = 60;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <svg viewBox="0 0 160 160" className="w-40 h-40 -rotate-90 shrink-0">
      <circle cx="80" cy="80" r={R} fill="none" stroke="currentColor" className="text-muted" strokeWidth={20} />
      {segments.map((s) => {
        const frac = s.value / total;
        const dash = frac * C;
        const el = (
          <circle
            key={s.label}
            cx="80"
            cy="80"
            r={R}
            fill="none"
            stroke={s.stroke}
            strokeWidth={20}
            strokeDasharray={`${dash} ${C - dash}`}
            strokeDashoffset={-offset}
            strokeLinecap="butt"
          />
        );
        offset += dash;
        return el;
      })}
    </svg>
  );
}

function DestinoSection({ metrics }: { metrics: ReturnType<typeof useGerenciaMetrics> }) {
  const { destino, asistenciasSinVenta } = metrics;
  const segments = [
    { label: "Nurture", value: destino.nurture, cls: "bg-sky-500", stroke: "#0ea5e9" },
    { label: "Seguimiento", value: destino.seguimiento, cls: "bg-amber-500", stroke: "#f59e0b" },
    { label: "Derivados a LT", value: destino.derivadosLT, cls: "bg-violet-500", stroke: "#8b5cf6" },
    { label: "Descalificados", value: destino.descalificados, cls: "bg-slate-400", stroke: "#94a3b8" },
  ];
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <Card className="space-y-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        Destino de los que no compraron ({asistenciasSinVenta} asistencias sin venta)
      </div>
      <div className="flex items-center gap-8 flex-wrap">
        <Donut segments={segments} />
        <div className="flex-1 min-w-[200px] space-y-3">
          {segments.map((s) => (
            <div key={s.label} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", s.cls)} />
                {s.label}
              </span>
              <span className="font-semibold">
                {s.value} <span className="text-muted-foreground font-normal">({Math.round((s.value / total) * 100)}%)</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Sección 3 — Eficacia del Sistema                                     */
/* ------------------------------------------------------------------ */

function MiniStatCard({
  icon: Icon,
  label,
  value,
  delta,
  caption,
  iconCls,
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  delta?: number;
  caption?: string;
  iconCls?: string;
}) {
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">{label}</span>
        <Icon className={cn("w-4 h-4 text-muted-foreground/70", iconCls)} />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-2xl font-bold tracking-tight">{value}</span>
        {delta !== undefined && <DeltaBadge pct={delta} />}
      </div>
      {caption && <p className="text-xs text-muted-foreground leading-snug">{caption}</p>}
    </Card>
  );
}

function EficaciaSection({ metrics }: { metrics: ReturnType<typeof useGerenciaMetrics> }) {
  const {
    automatizacionPct, sinIntervencion, rescateSetter, liveSinIntervencion, liveConRescate, liveAutomatizacionPct,
    eficaciaBotPct, funnel, videoCierrePct, videoConVideo, showRatePct, noShowRatePct, closeRatePct, speedToLeadMin,
  } = metrics;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:row-span-2 flex flex-col items-center justify-center text-center gap-3 py-8">
        <div className="w-10 h-10 rounded-full bg-violet-500/10 flex items-center justify-center">
          <Bot className="w-5 h-5 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Tasa de automatización</div>
        <div className="text-5xl font-bold tracking-tight">{automatizacionPct}%</div>
        <p className="text-xs text-muted-foreground">Ventas logradas 100% automáticas</p>
        <div className="flex items-center gap-6 pt-3 border-t border-border/50 w-full justify-center text-sm">
          <div>
            <div className="font-bold">{sinIntervencion} ventas</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Sin intervención</div>
          </div>
          <div className="w-px h-8 bg-border" />
          <div>
            <div className="font-bold">{rescateSetter} ventas</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Rescate setter</div>
          </div>
        </div>
        {liveAutomatizacionPct !== null && (
          <p className="text-[10px] text-muted-foreground pt-2 border-t border-dashed border-border/50 w-full">
            En el dataset en vivo: {liveSinIntervencion} sin intervención · {liveConRescate} con rescate ({liveAutomatizacionPct}%)
          </p>
        )}
      </Card>
      <MiniStatCard icon={Bot} label="Eficacia del bot" value={`${eficaciaBotPct}%`} caption={`De los ${funnel.entraron} leads que entraron, el bot agendó a ${funnel.agendaron}.`} />
      <MiniStatCard icon={Video} label="Video ↔ Cierre" value={`${videoCierrePct}%`} caption={`De las ${funnel.compraron} compras, ${videoConVideo} vieron el video antes de la llamada.`} />
      <MiniStatCard icon={UserCheck} label="Show rate global" value={`${showRatePct}%`} caption={`${funnel.asistieron} asistencias de ${funnel.agendaron} agendas.`} iconCls="text-emerald-500" />
      <MiniStatCard icon={UserX} label="No-show rate" value={`${noShowRatePct}%`} caption={`${funnel.agendaron - funnel.asistieron} ausencias de ${funnel.agendaron} agendas.`} iconCls="text-rose-500" />
      <MiniStatCard icon={Target} label="Close rate global" value={`${closeRatePct}%`} caption={`${funnel.compraron} ventas de ${funnel.asistieron} asistencias.`} iconCls="text-emerald-500" />
      <MiniStatCard icon={Timer} label="Speed-to-lead" value={`${speedToLeadMin.toFixed(1)} min`} caption="Tiempo promedio al primer contacto." />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sección 4 — Dinero y Retorno                                         */
/* ------------------------------------------------------------------ */

function DineroSection({ metrics }: { metrics: ReturnType<typeof useGerenciaMetrics> }) {
  const { revenueTotal, revenueAutomatico, revenueAsistido, revenueHT, revenueLT, inversion, roas, cpl, cpa, cpv, ticketHT, ticketLT } = metrics;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="space-y-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Revenue Total</div>
          <div className="text-4xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">{money(revenueTotal)} <span className="text-sm font-medium text-muted-foreground">USD</span></div>
          <div className="grid grid-cols-2 gap-4 pt-3 border-t border-border/50 text-sm">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Por origen</div>
              <div className="flex justify-between"><span>Automático</span><span className="font-semibold">{money(revenueAutomatico)}</span></div>
              <div className="flex justify-between"><span>Asistido</span><span className="font-semibold">{money(revenueAsistido)}</span></div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Por tipo</div>
              <div className="flex justify-between"><span>High-Ticket</span><span className="font-semibold">{money(revenueHT)}</span></div>
              <div className="flex justify-between"><span>Low-Ticket</span><span className="font-semibold">{money(revenueLT)}</span></div>
            </div>
          </div>
        </Card>
        <Card className="space-y-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Inversión &amp; Retorno</div>
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Inversión Meta Ads</div>
              <div className="text-2xl font-bold">{money(inversion)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">ROAS Global</div>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{roas.toFixed(1)}x</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border/50 text-center">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">CPL</div>
              <div className="font-bold">{money(cpl)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">CPA</div>
              <div className="font-bold">{money(cpa)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">CPV</div>
              <div className="font-bold">{money(cpv)}</div>
            </div>
          </div>
        </Card>
      </div>
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-6">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Ticket Promedio</div>
          <div className="flex items-center gap-10">
            <div>
              <div className="text-xs text-muted-foreground mb-1">High-Ticket</div>
              <div className="text-2xl font-bold">{money(ticketHT)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Low-Ticket</div>
              <div className="text-2xl font-bold">{money(ticketLT)}</div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sección 5 — Rendimiento del Equipo                                   */
/* ------------------------------------------------------------------ */

function EquipoSection({ metrics }: { metrics: ReturnType<typeof useGerenciaMetrics> }) {
  const { closer, setter } = metrics.equipo;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="space-y-5 border-t-2 border-t-amber-400">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400 font-bold text-sm shrink-0">
            {setter.nombre.charAt(0)}
          </div>
          <div>
            <div className="font-semibold">{setter.nombre}</div>
            <div className="text-xs text-muted-foreground">Setter</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Agendas rescatadas</div>
            <div className="text-xl font-bold">{setter.agendasRescatadas}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Tasa de rescate</div>
            <div className="text-xl font-bold">{setter.tasaRescate}%</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Ventas Low-Ticket</div>
            <div className="text-xl font-bold">{setter.ventasLT}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Comisión período</div>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{money(setter.comision)}</div>
          </div>
        </div>
      </Card>
      <Card className="space-y-5 border-t-2 border-t-violet-400">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-violet-500/10 flex items-center justify-center text-violet-600 dark:text-violet-400 font-bold text-sm shrink-0">
            {closer.nombre.charAt(0)}
          </div>
          <div>
            <div className="font-semibold">{closer.nombre}</div>
            <div className="text-xs text-muted-foreground">Closer</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Cash cerrado</div>
            <div className="text-xl font-bold">{money(closer.cashCerrado)}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Close rate</div>
            <div className="text-xl font-bold">{closer.closeRate}%</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Ticket promedio</div>
            <div className="text-xl font-bold">{money(closer.ticketPromedio)}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Comisión período</div>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{money(closer.comision)}</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sección 6 — Tendencia Histórica (SVG a mano, sin librería de charts) */
/* ------------------------------------------------------------------ */

function TrendChart({
  data,
  seriesA,
  seriesB,
}: {
  data: typeof GERENCIA_TREND;
  seriesA: { key: "revenue" | "entraron"; label: string; color: string; format: (v: number) => string };
  seriesB: { key: "roas" | "automatizacionPct"; label: string; color: string; format: (v: number) => string };
}) {
  const W = 560;
  const H = 200;
  const PAD = 16;
  const stepX = (W - PAD * 2) / (data.length - 1);
  const xAt = (i: number) => PAD + i * stepX;

  const aVals = data.map((d) => d[seriesA.key] as number);
  const bVals = data.map((d) => d[seriesB.key] as number);
  const aMax = Math.max(...aVals) * 1.15;
  const bMax = Math.max(...bVals) * 1.15;
  const yA = (v: number) => H - PAD - (v / aMax) * (H - PAD * 2);
  const yB = (v: number) => H - PAD - (v / bMax) * (H - PAD * 2);

  const aPoints = data.map((d, i) => `${xAt(i)},${yA(d[seriesA.key] as number)}`).join(" ");
  const bPoints = data.map((d, i) => `${xAt(i)},${yB(d[seriesB.key] as number)}`).join(" ");

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const handleMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round((svgX - PAD) / stepX);
    setHoverIdx(Math.min(data.length - 1, Math.max(0, idx)));
  };
  const hovered = hoverIdx !== null ? data[hoverIdx] : null;
  const tooltipLeftPct = hoverIdx !== null ? (xAt(hoverIdx) / W) * 100 : 0;
  const tooltipAlignRight = tooltipLeftPct > 65;

  return (
    <div className="space-y-2 relative">
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 inline-block" style={{ backgroundColor: seriesA.color }} /> {seriesA.label}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-0.5 inline-block" style={{ borderTop: `2px dashed ${seriesB.color}` }} /> {seriesB.label}
        </span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-48 cursor-crosshair" onMouseMove={handleMove} onMouseLeave={() => setHoverIdx(null)}>
          {hoverIdx !== null && <line x1={xAt(hoverIdx)} x2={xAt(hoverIdx)} y1={0} y2={H} stroke="currentColor" strokeWidth={1} className="text-border" />}
          <polyline points={bPoints} fill="none" stroke={seriesB.color} strokeWidth={2} strokeDasharray="4 4" />
          <polyline points={aPoints} fill="none" stroke={seriesA.color} strokeWidth={2} />
          {data.map((d, i) => (
            <circle key={`b-${i}`} cx={xAt(i)} cy={yB(d[seriesB.key] as number)} r={2.5} fill={seriesB.color} />
          ))}
          {data.map((d, i) => (
            <circle key={`a-${i}`} cx={xAt(i)} cy={yA(d[seriesA.key] as number)} r={2.5} fill={seriesA.color} />
          ))}
          {hovered && (
            <>
              <circle cx={xAt(hoverIdx!)} cy={yB(hovered[seriesB.key] as number)} r={5} fill="white" stroke={seriesB.color} strokeWidth={2} />
              <circle cx={xAt(hoverIdx!)} cy={yA(hovered[seriesA.key] as number)} r={5} fill="white" stroke={seriesA.color} strokeWidth={2} />
            </>
          )}
        </svg>
        {hovered && (
          <div
            className="absolute top-2 z-10 pointer-events-none bg-popover text-popover-foreground border border-border rounded-lg shadow-lg px-3 py-2 text-xs whitespace-nowrap"
            style={{ left: `${tooltipLeftPct}%`, transform: tooltipAlignRight ? "translateX(-100%)" : "translateX(8px)" }}
          >
            <div className="font-semibold mb-1">{hovered.mes}</div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{seriesA.label}:</span>
              <span className="font-bold" style={{ color: seriesA.color }}>{seriesA.format(hovered[seriesA.key] as number)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{seriesB.label}:</span>
              <span className="font-bold" style={{ color: seriesB.color }}>{seriesB.format(hovered[seriesB.key] as number)}</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground px-1">
        {data.map((d) => <span key={d.mes}>{d.mes}</span>)}
      </div>
    </div>
  );
}

function TendenciaSection() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-4">Evolución de Revenue &amp; ROAS</div>
        <TrendChart
          data={GERENCIA_TREND}
          seriesA={{ key: "revenue", label: "Revenue", color: "#10b981", format: money }}
          seriesB={{ key: "roas", label: "ROAS", color: "#6366f1", format: (v) => `${v.toFixed(1)}x` }}
        />
      </Card>
      <Card>
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-4">Volumen &amp; Automatización</div>
        <TrendChart
          data={GERENCIA_TREND}
          seriesA={{ key: "entraron", label: "Leads entrados", color: "#0ea5e9", format: (v) => String(v) }}
          seriesB={{ key: "automatizacionPct", label: "% Automatización", color: "#f59e0b", format: (v) => `${v}%` }}
        />
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vista principal                                                     */
/* ------------------------------------------------------------------ */

export default function Estadisticas({ role }: { role: string }) {
  const [period, setPeriod] = useState<GerenciaPeriodKey>("este_mes");
  const metrics = useGerenciaMetrics(period);


  if (role !== "admin") {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#fcfcfd] dark:bg-background">
        <div className="text-center space-y-3 max-w-sm">
          <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mx-auto">
            <Lock className="w-5 h-5 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">Acceso restringido</h2>
          <p className="text-sm text-muted-foreground">
            Estadísticas es una vista de nivel dueño/admin — no está disponible para roles operativos.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[#fcfcfd] dark:bg-background overflow-y-scroll">
      <div className="p-10 max-w-[1200px] mx-auto space-y-10 pb-24">
        <div className="flex items-end justify-between flex-wrap gap-4 pr-14 lg:pr-0">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Estadísticas</h1>
            <p className="text-sm text-muted-foreground mt-1">Visión global del negocio y rendimiento del equipo</p>
          </div>
          <PeriodSelector period={period} onChange={setPeriod} />
        </div>

        {metrics.isPersonalizado && (
          <div className="text-xs text-muted-foreground bg-muted/30 border border-dashed border-border rounded-xl px-4 py-2.5">
            El selector de rango personalizado todavía no está conectado — mostrando los datos de "Este mes" mientras se define el origen (¿picker de fechas contra Supabase?).
          </div>
        )}

        <div className="space-y-5">
          <SectionHeader icon={Activity} title="Volumen y Flujo" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <LeadsPorFuenteCard leadsPorFuente={metrics.leadsPorFuente} />
            <AgendasCard agendaron={metrics.funnel.agendaron} deltaPct={metrics.agendasDeltaPct} vsAnterior={metrics.vsAnteriorAgendas} />
            <DistribucionLeadsCard distribucion={metrics.distribucionLeads} totalCalificados={metrics.funnel.conversaron} objetivoFacturacion={metrics.objetivoFacturacion} />
          </div>
          <Funnel metrics={metrics} />
        </div>

        <div className="space-y-5">
          <SectionHeader icon={PieChart} title="Destino de los que no compraron" />
          <DestinoSection metrics={metrics} />
        </div>

        <div className="space-y-5">
          <SectionHeader icon={Gauge} title="Eficacia del Sistema" />
          <EficaciaSection metrics={metrics} />
        </div>

        <div className="space-y-5">
          <SectionHeader icon={DollarSign} title="Dinero y Retorno" />
          <DineroSection metrics={metrics} />
        </div>

        <div className="space-y-5">
          <SectionHeader icon={Users} title="Rendimiento del Equipo" />
          <EquipoSection metrics={metrics} />
        </div>

        <div className="space-y-5">
          <SectionHeader icon={TrendingUp} title="Tendencia Histórica" />
          <TendenciaSection />
        </div>
      </div>
    </div>
  );
}
