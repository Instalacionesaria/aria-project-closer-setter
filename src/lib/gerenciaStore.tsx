import { useMemo } from "react";
import { useClosurer } from "./closerStore";
import { useSetter } from "./setterStore";
import { useSettings } from "./settingsStore";

/**
 * Gerencia (§ IMPLEMENTACION-Gerencia-VSCode.md, 2026-07-13) — dashboard de dueño/admin.
 * Principio rector del doc de Francisco: "TODOS los números derivan de un dataset común
 * (contactos + oportunidades + eventos) y de los parámetros de Ajustes... NADA hardcodeado
 * por tarjeta." Esto NO es un store de estado (Gerencia no muta nada) — es un hook de
 * derivación puro sobre closerStore + setterStore + settingsStore, mismo principio que ya
 * usan los cockpits de Closer/Setter.
 *
 * Arquitectura de datos (decisión explícita, documentada en CLAUDE.md §46):
 * - Secciones 1-3 (Volumen, Destino, Eficacia del sistema) leen de `GERENCIA_PERIOD_BASE` —
 *   una base de referencia POR PERÍODO (mismo patrón que `BUZON_COUNTS`/`SETTER_COCKPIT_BASE`)
 *   porque el dataset de contactos sembrado en este demo (~29 por store) es una muestra, no el
 *   volumen real de una agencia (cientos de leads/mes) — no hay 450 contactos reales que contar.
 * - Sección 4 (Dinero y Retorno) es HÍBRIDA: revenue/ticket vienen de la base del período, pero
 *   Inversión Meta Ads y Objetivo de Facturación son 100% en vivo desde Ajustes (`useSettings().gerencia`)
 *   — ROAS/CAC se recalculan de inmediato si Francisco cambia esos parámetros.
 * - Sección 5 (Rendimiento del equipo) es 100% EN VIVO — lee directo de `useClosurer().cockpit` y
 *   `useSetter().cockpit`, que ya son reactivos a las comisiones de Ajustes. Es la prueba más
 *   directa del principio del doc: cambiar el % de comisión en Ajustes mueve a Gerencia al instante.
 * - "Tasa de automatización" (hero de la sección 3) tiene DOS números: el de la base del período
 *   (grande, ilustrativo) y un conteo real en vivo (`ContactosLive`) derivado de
 *   `ClosurerContact.atribucionSetter` en los contactos "ganado" reales — pequeño pero genuino,
 *   y sí cambia si se registra una venta nueva con ese campo.
 * - Sección 6 (Tendencia histórica) es un array ilustrativo de 6 meses, mismo patrón que
 *   `CHART_HIST` de `CloserAI.tsx` — no está atado a la base por período (igual que el histórico
 *   de Inicio tampoco está atado al cockpit en vivo).
 */

export type GerenciaPeriodKey = "este_mes" | "mes_pasado" | "ultimos_3_meses" | "personalizado";

export const GERENCIA_PERIODS: { key: GerenciaPeriodKey; label: string }[] = [
  { key: "este_mes", label: "Este mes" },
  { key: "mes_pasado", label: "Mes pasado" },
  { key: "ultimos_3_meses", label: "Últimos 3 meses" },
  { key: "personalizado", label: "Personalizado" },
];

interface GerenciaPeriodBase {
  leadsPorFuente: { metaAds: number; vsl: number; directo: number };
  funnel: { entraron: number; conversaron: number; agendaron: number; asistieron: number; compraron: number };
  /** Solo "este_mes" trae comparación vs. período anterior (mismo criterio que el resto del proyecto: no se inventa un 4º dataset "hace 2 meses" solo para tener deltas en todos lados). */
  vsAnterior?: { agendas: number };
  distribucionLeads: { caliente: number; tibio: number; probableLT: number };
  destino: { nurture: number; seguimiento: number; derivadosLT: number; descalificados: number };
  automatizacion: { sinIntervencion: number; rescateSetter: number };
  videoConVideo: number;
  speedToLeadMin: number;
  ventasHTCount: number;
  ticketHT: number;
  ventasLTCount: number;
  ticketLT: number;
}

/**
 * "Este mes" reproduce el volumen/funnel/CPL-CPA-CPV exactos de la referencia de Francisco.
 * El revenue/ticket SÍ se corrigió a propósito: la referencia mostraba Revenue Total $43,100
 * conviviendo con Ticket Promedio HT $5,200 sobre 23 ventas — matemáticamente esos dos números
 * de la referencia no cuadran entre sí (23 × $5,200 = $119,600, no $43,100). Se prioriza la
 * consistencia interna y el rango real de precio HT de CLAUDE.md §1 ($4-8k) sobre calcar el
 * mockup al dígito — mismo criterio que otras veces que la prosa/imagen de Francisco no
 * cuadraban exactamente (§21, cero emojis vs. la captura).
 */
const ESTE_MES: GerenciaPeriodBase = {
  leadsPorFuente: { metaAds: 305, vsl: 100, directo: 45 },
  funnel: { entraron: 450, conversaron: 380, agendaron: 120, asistieron: 92, compraron: 23 },
  vsAnterior: { agendas: 111 },
  distribucionLeads: { caliente: 20, tibio: 50, probableLT: 30 },
  destino: { nurture: 35, seguimiento: 15, derivadosLT: 10, descalificados: 9 },
  automatizacion: { sinIntervencion: 15, rescateSetter: 8 },
  videoConVideo: 19,
  speedToLeadMin: 3.2,
  ventasHTCount: 23,
  ticketHT: 5200,
  ventasLTCount: 15,
  ticketLT: 100,
};

const MES_PASADO: GerenciaPeriodBase = {
  leadsPorFuente: { metaAds: 275, vsl: 95, directo: 40 },
  funnel: { entraron: 410, conversaron: 344, agendaron: 111, asistieron: 80, compraron: 18 },
  distribucionLeads: { caliente: 18, tibio: 52, probableLT: 30 },
  destino: { nurture: 32, seguimiento: 14, derivadosLT: 9, descalificados: 7 },
  automatizacion: { sinIntervencion: 11, rescateSetter: 7 },
  videoConVideo: 14,
  speedToLeadMin: 3.6,
  ventasHTCount: 18,
  ticketHT: 4900,
  ventasLTCount: 11,
  ticketLT: 100,
};

const ULTIMOS_3_MESES: GerenciaPeriodBase = {
  leadsPorFuente: { metaAds: 790, vsl: 260, directo: 115 },
  funnel: { entraron: 1165, conversaron: 960, agendaron: 300, asistieron: 225, compraron: 54 },
  distribucionLeads: { caliente: 19, tibio: 51, probableLT: 30 },
  destino: { nurture: 88, seguimiento: 37, derivadosLT: 24, descalificados: 22 },
  automatizacion: { sinIntervencion: 35, rescateSetter: 19 },
  videoConVideo: 44,
  speedToLeadMin: 3.4,
  ventasHTCount: 54,
  ticketHT: 5100,
  ventasLTCount: 38,
  ticketLT: 100,
};

const GERENCIA_PERIOD_BASE: Record<"este_mes" | "mes_pasado" | "ultimos_3_meses", GerenciaPeriodBase> = {
  este_mes: ESTE_MES,
  mes_pasado: MES_PASADO,
  ultimos_3_meses: ULTIMOS_3_MESES,
};

/** Sección 6 — tendencia ilustrativa de 6 meses, mismo patrón que `CHART_HIST` de CloserAI.tsx (no atado a la base por período). */
export const GERENCIA_TREND: { mes: string; revenue: number; roas: number; entraron: number; automatizacionPct: number }[] = [
  { mes: "Ene", revenue: 26000, roas: 6.5, entraron: 310, automatizacionPct: 45 },
  { mes: "Feb", revenue: 32000, roas: 7.8, entraron: 340, automatizacionPct: 50 },
  { mes: "Mar", revenue: 34000, roas: 8.2, entraron: 360, automatizacionPct: 55 },
  { mes: "Abr", revenue: 40000, roas: 9.6, entraron: 390, automatizacionPct: 60 },
  { mes: "May", revenue: 48000, roas: 11.2, entraron: 420, automatizacionPct: 68 },
  { mes: "Jun", revenue: 54000, roas: 12.8, entraron: 440, automatizacionPct: 72 },
];

export interface GerenciaMetrics {
  period: GerenciaPeriodKey;
  label: string;
  isPersonalizado: boolean;
  leadsPorFuente: { metaAds: number; vsl: number; directo: number };
  funnel: { entraron: number; conversaron: number; agendaron: number; asistieron: number; compraron: number };
  conversionPct: number;
  agendaConvPct: number;
  showRatePct: number;
  noShowRatePct: number;
  closeRatePct: number;
  vsAnteriorAgendas: number | null;
  agendasDeltaPct: number | null;
  distribucionLeads: { caliente: number; tibio: number; probableLT: number };
  destino: { nurture: number; seguimiento: number; derivadosLT: number; descalificados: number };
  asistenciasSinVenta: number;
  automatizacionPct: number;
  sinIntervencion: number;
  rescateSetter: number;
  liveSinIntervencion: number;
  liveConRescate: number;
  liveAutomatizacionPct: number | null;
  eficaciaBotPct: number;
  videoCierrePct: number;
  videoConVideo: number;
  speedToLeadMin: number;
  revenueTotal: number;
  revenueAutomatico: number;
  revenueAsistido: number;
  revenueHT: number;
  revenueLT: number;
  ticketHT: number;
  ticketLT: number;
  inversion: number;
  roas: number;
  cpl: number;
  cpa: number;
  cpv: number;
  objetivoFacturacion: number;
  equipo: {
    closer: { nombre: string; cashCerrado: number; closeRate: number; ticketPromedio: number; comision: number };
    setter: { nombre: string; agendasRescatadas: number; tasaRescate: number; ventasLT: number; comision: number };
  };
}

export function useGerenciaMetrics(period: GerenciaPeriodKey): GerenciaMetrics {
  const { contacts: closerContacts, cockpit: closerCockpit } = useClosurer();
  const { cockpit: setterCockpit } = useSetter();
  const { gerencia } = useSettings();

  return useMemo(() => {
    const baseKey = period === "personalizado" ? "este_mes" : period;
    const base = GERENCIA_PERIOD_BASE[baseKey];
    const f = base.funnel;

    const conversionPct = Math.round((f.conversaron / f.entraron) * 100);
    const agendaConvPct = Math.round((f.agendaron / f.conversaron) * 100);
    const showRatePct = Math.round((f.asistieron / f.agendaron) * 100);
    const noShowRatePct = 100 - showRatePct;
    const closeRatePct = Math.round((f.compraron / f.asistieron) * 100);
    const agendasDeltaPct = base.vsAnterior ? Math.round(((f.agendaron - base.vsAnterior.agendas) / base.vsAnterior.agendas) * 100) : null;

    const automatizacionPct = Math.round((base.automatizacion.sinIntervencion / f.compraron) * 100);
    const eficaciaBotPct = Math.round((f.agendaron / f.entraron) * 100);
    const videoCierrePct = Math.round((base.videoConVideo / f.compraron) * 100);

    const revenueHT = base.ventasHTCount * base.ticketHT;
    const revenueLT = base.ventasLTCount * base.ticketLT;
    const revenueAutomatico = Math.round(revenueHT * (base.automatizacion.sinIntervencion / f.compraron));
    const revenueAsistidoHT = revenueHT - revenueAutomatico;
    const revenueAsistido = revenueAsistidoHT + revenueLT;
    const revenueTotal = revenueAutomatico + revenueAsistido;

    // Inversión de pauta: un solo parámetro vivo en Ajustes (mes en curso) — para períodos más
    // largos se escala proporcional al volumen de leads de ese período (proxy razonable: más
    // leads normalmente implica más gasto), en vez de aplicar el mismo monto absoluto de "este
    // mes" a un agregado de 3 meses, lo que rompería el ROAS/CAC sin sentido.
    const inversionBase = gerencia.inversionMetaAds;
    const inversion = Math.round(inversionBase * (f.entraron / ESTE_MES.funnel.entraron));
    const roas = inversion > 0 ? revenueTotal / inversion : 0;
    const cpl = f.entraron > 0 ? inversion / f.entraron : 0;
    const cpa = f.agendaron > 0 ? inversion / f.agendaron : 0;
    const cpv = f.compraron > 0 ? inversion / f.compraron : 0;

    // Contraprueba en vivo (dataset real, independiente del período elegido): cuántas de las
    // ventas "ganado" HOY sembradas en Closer tuvieron rescate de un setter (`atribucionSetter`).
    const ganadoContacts = Object.values(closerContacts).filter((c) => c.stage === "ganado");
    const liveSinIntervencion = ganadoContacts.filter((c) => !c.atribucionSetter).length;
    const liveConRescate = ganadoContacts.filter((c) => c.atribucionSetter).length;
    const liveTotal = liveSinIntervencion + liveConRescate;
    const liveAutomatizacionPct = liveTotal > 0 ? Math.round((liveSinIntervencion / liveTotal) * 100) : null;

    // Equipo — 100% en vivo, mismo persona demo que "Jorge Q." usa en el resto de la app (§17/§26/§30) tanto para Closer como para Setter (un solo usuario demo jugando ambos roles, sin auth real).
    const asistieronCloserLive = Object.values(closerContacts).filter((c) => c.stage !== "agendado" && c.stage !== "no_show").length;
    const closerCloseRateLive = asistieronCloserLive > 0 ? Math.round((closerCockpit.ventas / asistieronCloserLive) * 100) : 0;
    const closerTicketPromedio = closerCockpit.ventas > 0 ? Math.round(closerCockpit.cashCollected / closerCockpit.ventas) : 0;
    const setterTasaRescate = setterCockpit.agendasTotal > 0 ? Math.round((setterCockpit.agendasGeneradas / setterCockpit.agendasTotal) * 100) : 0;

    return {
      period,
      label: GERENCIA_PERIODS.find((p) => p.key === period)?.label ?? "",
      isPersonalizado: period === "personalizado",
      leadsPorFuente: base.leadsPorFuente,
      funnel: f,
      conversionPct,
      agendaConvPct,
      showRatePct,
      noShowRatePct,
      closeRatePct,
      vsAnteriorAgendas: base.vsAnterior?.agendas ?? null,
      agendasDeltaPct,
      distribucionLeads: base.distribucionLeads,
      destino: base.destino,
      asistenciasSinVenta: f.asistieron - f.compraron,
      automatizacionPct,
      sinIntervencion: base.automatizacion.sinIntervencion,
      rescateSetter: base.automatizacion.rescateSetter,
      liveSinIntervencion,
      liveConRescate,
      liveAutomatizacionPct,
      eficaciaBotPct,
      videoCierrePct,
      videoConVideo: base.videoConVideo,
      speedToLeadMin: base.speedToLeadMin,
      revenueTotal,
      revenueAutomatico,
      revenueAsistido,
      revenueHT,
      revenueLT,
      ticketHT: base.ticketHT,
      ticketLT: base.ticketLT,
      inversion,
      roas,
      cpl,
      cpa,
      cpv,
      objetivoFacturacion: gerencia.objetivoFacturacion,
      equipo: {
        closer: {
          nombre: "Jorge Q.",
          cashCerrado: closerCockpit.cashCollected,
          closeRate: closerCloseRateLive,
          ticketPromedio: closerTicketPromedio,
          comision: closerCockpit.comision,
        },
        setter: {
          nombre: "Jorge Q.",
          agendasRescatadas: setterCockpit.agendasGeneradas,
          tasaRescate: setterTasaRescate,
          ventasLT: setterCockpit.ltVentasCount,
          comision: setterCockpit.comisionTotal,
        },
      },
    };
  }, [period, closerContacts, closerCockpit, setterCockpit, gerencia]);
}
