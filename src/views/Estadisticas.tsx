/**
 * Estadísticas — el panel del negocio, con datos REALES (2026-08-07).
 *
 * ── Qué se reemplazó, y por qué era grave ─────────────────────────────
 *
 * Esta vista tenía 61 números y **ninguno salía de la base**. Los traía `gerenciaStore.tsx` de
 * tres constantes escritas a mano, más `settingsStore`, que es localStorage. Eso ya era la regla
 * D3 en su forma conocida.
 *
 * Lo peor no era eso. El encabezado de `gerenciaStore` afirmaba que la sección Equipo era
 * *"100% EN VIVO"* y que su contraprueba de automatización era *"genuina"* — y las dos
 * afirmaciones eran falsas: `SETTER_COCKPIT_BASE` estaba tan hardcodeado como el resto, y
 * `atribucionSetter` se declara pero **nunca se asigna en ninguna parte del código**, así que el
 * porcentaje de automatización salía siempre 100%. Un número inventado con etiqueta de real es el
 * peor caso: nadie lo verifica, porque el código dice que ya está verificado.
 *
 * ── La regla que gobierna lo que se ve ────────────────────────────────
 *
 * De los 61, **28 se pueden medir** con lo que hay en la base, y son los que se muestran. Los que
 * no tienen dato de origen **no están**: no hay velo, no hay cero, no hay guion de relleno. Es
 * §4.1 aplicada sin excepciones — *"sin dato, el elemento no se renderiza"*.
 *
 * Y no es una decisión de esta vista: el backend manda `sinDato` con el motivo de cada uno y acá
 * se lista al pie, para que quien mire el panel pueda distinguir *"el negocio no tiene este
 * número"* de *"el sistema todavía no lo mide"* — que son dos conclusiones opuestas. Lo que se
 * fue de la pantalla, con su motivo:
 *
 *   · **Distribución de leads** (caliente/tibio/probable-LT) — esa clasificación no existe.
 *   · **Automatización** — sin señal de intervención manual no hay nada que contrastar.
 *   · **El corte high-ticket / low-ticket** — ninguna marca sobre una venta lo distingue.
 *   · **Las cuatro del setter** — `api/setter/` todavía no escribe nada.
 *   · **ROAS, CAC, CPL, CPA** — dependen del gasto en pauta (fase 7 · Meta). Llegan `null` del
 *     backend y se dicen como pendientes, no como cero: un ROAS de 0 afirma que no hubo retorno;
 *     no saber cuánto se gastó es otra cosa.
 *   · **La tendencia de 6 meses** — no hay historial anterior a este sistema y no se fabrica.
 *
 * `gerenciaStore.tsx` se borró: quedó sin un solo consumidor, y un archivo con 250 líneas de
 * números inventados es una invitación a que alguien lo vuelva a enchufar. Los dos parámetros que
 * sí sirven —inversión en Meta Ads y objetivo de facturación— nunca vivieron ahí: están en
 * `settingsStore` y se siguen editando en Ajustes.
 */

import { useCallback, useEffect, useState } from "react";
import { Activity, ChevronDown, DollarSign, Gauge, Lock, Users } from "lucide-react";
import { cn } from "../lib/utils";
import { fetchEstadisticas, type EstadisticasResponse, type PeriodoEstadisticas, type TasaConBase } from "../lib/api";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;

const PERIODOS: { key: PeriodoEstadisticas; label: string }[] = [
  { key: "este_mes", label: "Este mes" },
  { key: "mes_pasado", label: "Mes pasado" },
  { key: "ultimos_3_meses", label: "Últimos 3 meses" },
];

/** Etiquetas de `closer_contactos.fuente`. Una clave desconocida se muestra tal cual, no se oculta. */
const NOMBRE_FUENTE: Record<string, string> = {
  meta_ads: "Meta Lead Ads",
  vsl: "VSL",
  directo: "Directo",
  instagram: "Instagram",
  sin_clasificar: "Sin clasificar",
};

/* ------------------------------------------------------------------ */
/* Piezas                                                             */
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
  return <div className={cn("bg-card border border-border rounded-2xl p-6 shadow-sm", className)}>{children}</div>;
}

/**
 * Un porcentaje con su base, o nada.
 *
 * `null` significa que la base era cero, y entonces **no se renderiza**: mostrar "0%" ahí
 * afirmaría una medición que nadie hizo. Es la regla transversal §6 del producto —todo porcentaje
 * lleva su base— y la §4.1 en el mismo lugar.
 */
function Tasa({ valor, etiqueta }: { valor: TasaConBase | null; etiqueta: string }) {
  if (!valor) return null;
  return (
    <div className="space-y-0.5">
      <div className="text-2xl font-bold tracking-tight">{valor.pct}%</div>
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">{etiqueta}</div>
      <div className="text-[11px] text-muted-foreground">
        {valor.de} de {valor.sobre}
      </div>
    </div>
  );
}

/** Un número medido. Un cero se atenúa; nunca se oculta un cero que SÍ se midió (§4.1). */
function Dato({ valor, etiqueta, formato }: { valor: number; etiqueta: string; formato?: (n: number) => string }) {
  return (
    <div className="space-y-0.5">
      <div className={cn("text-2xl font-bold tracking-tight", valor === 0 && "text-muted-foreground/50")}>
        {formato ? formato(valor) : valor}
      </div>
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">{etiqueta}</div>
    </div>
  );
}

function PeriodSelector({
  period,
  onChange,
}: {
  period: PeriodoEstadisticas;
  onChange: (p: PeriodoEstadisticas) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = PERIODOS.find((p) => p.key === period)?.label ?? "Este mes";
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
          <div className="absolute top-full right-0 mt-2 w-56 bg-popover text-popover-foreground border border-border rounded-xl shadow-xl p-1.5 z-20">
            {PERIODOS.map((p) => (
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
/* El embudo                                                          */
/* ------------------------------------------------------------------ */

function Embudo({ e }: { e: NonNullable<EstadisticasResponse["embudo"]> }) {
  const pasos = [
    { valor: e.entraron, label: "Entraron" },
    { valor: e.conversaron, label: "Conversaron" },
    { valor: e.agendaron, label: "Agendaron" },
    { valor: e.asistieron, label: "Asistieron" },
    { valor: e.compraron, label: "Compraron" },
  ];
  return (
    <Card className="space-y-6">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
        {pasos.map((p, i) => (
          <div key={p.label} className="flex items-end gap-8">
            <Dato valor={p.valor} etiqueta={p.label} />
            {i < pasos.length - 1 && <span className="text-muted-foreground/40 text-lg pb-5">→</span>}
          </div>
        ))}
      </div>
      <div className="border-t border-border/50 pt-5 flex flex-wrap gap-x-10 gap-y-5">
        <Tasa valor={e.tasas.conversacion} etiqueta="Conversación" />
        <Tasa valor={e.tasas.agenda} etiqueta="Agenda" />
        <Tasa valor={e.tasas.show} etiqueta="Show rate" />
        <Tasa valor={e.tasas.cierre} etiqueta="Cierre" />
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Vista principal                                                    */
/* ------------------------------------------------------------------ */

export default function Estadisticas({ role }: { role: string }) {
  const [periodo, setPeriodo] = useState<PeriodoEstadisticas>("este_mes");
  const [datos, setDatos] = useState<EstadisticasResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async (p: PeriodoEstadisticas) => {
    setCargando(true);
    const r = await fetchEstadisticas(p);
    setCargando(false);
    if (!r.ok) return setError(r.error ?? "No se pudieron cargar las estadísticas.");
    setError(null);
    setDatos(r);
  }, []);

  useEffect(() => {
    void cargar(periodo);
  }, [cargar, periodo]);

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
            <p className="text-sm text-muted-foreground mt-1">
              {datos?.etiqueta ?? "Visión global del negocio"}
              {datos?.zonaHoraria ? ` · ${datos.zonaHoraria}` : ""}
            </p>
          </div>
          <PeriodSelector period={periodo} onChange={setPeriodo} />
        </div>

        {error && <Card className="border-destructive/40 bg-destructive/5 text-sm text-destructive">{error}</Card>}

        {cargando && !datos && (
          <div className="py-20 flex justify-center">
            <div className="h-6 w-6 rounded-full border-2 border-muted border-t-primary animate-spin" />
          </div>
        )}

        {datos?.embudo && (
          <section className="space-y-4">
            <SectionHeader icon={Activity} title="Volumen y flujo" />
            <Embudo e={datos.embudo} />
          </section>
        )}

        {datos?.fuentes && Object.keys(datos.fuentes).length > 0 && (
          <section className="space-y-4">
            <SectionHeader icon={Gauge} title="De dónde vienen" />
            <Card className="space-y-3">
              {(() => {
                const filas = Object.entries(datos.fuentes).sort((a, b) => b[1] - a[1]);
                const max = Math.max(...filas.map(([, v]) => v), 1);
                return filas.map(([clave, valor]) => (
                  <div key={clave} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>{NOMBRE_FUENTE[clave] ?? clave}</span>
                      <span className="font-semibold">{valor}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-violet-500" style={{ width: `${(valor / max) * 100}%` }} />
                    </div>
                  </div>
                ));
              })()}
            </Card>
          </section>
        )}

        {datos?.dinero && (
          <section className="space-y-4">
            <SectionHeader icon={DollarSign} title="Dinero" />
            <Card className="flex flex-wrap gap-x-12 gap-y-6">
              <Dato valor={datos.dinero.revenue} etiqueta="Cash collected" formato={money} />
              {datos.dinero.ticketPromedio !== null && (
                <Dato valor={datos.dinero.ticketPromedio} etiqueta="Ticket promedio" formato={money} />
              )}
              <Dato valor={datos.dinero.sobreLaMesa} etiqueta="Sobre la mesa" formato={money} />
            </Card>
            {/*
              ROAS, CAC, CPL y CPA no se renderizan porque el backend los manda `null`: dependen del
              gasto en pauta. Se dice con palabras y no con un cero — la diferencia entre "no hubo
              retorno" y "no sabemos cuánto se gastó" es toda la diferencia.
            */}
            <p className="text-xs text-muted-foreground border-l-2 border-border pl-3">
              El ROAS, el CAC y los costos por lead y por adquisición necesitan el gasto en pauta, que
              todavía no se lee de Meta.
            </p>
          </section>
        )}

        {datos?.equipo && datos.equipo.personas.length > 0 && (
          <section className="space-y-4">
            <SectionHeader icon={Users} title="Rendimiento del equipo" />
            <Card className="p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="border-b border-border/50">
                  <tr>
                    <th className="text-left p-4 font-medium text-muted-foreground">Persona</th>
                    <th className="text-left p-4 font-medium text-muted-foreground">Ventas</th>
                    <th className="text-left p-4 font-medium text-muted-foreground">Cash collected</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.equipo.personas.map((p) => (
                    <tr key={p.id} className="border-b border-border/30 last:border-0">
                      <td className="p-4 font-medium">{p.nombre}</td>
                      <td className="p-4">{p.ventas}</td>
                      <td className="p-4">{money(p.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            {datos.equipo.sinAtribuir > 0 && (
              /*
                Las ventas sin autor SE DICEN en vez de repartirse. Son las anteriores a la migración
                025, cuando no había sesión: atribuirlas al closer más probable habría sido fabricar
                un hecho, y el total de arriba ya las incluye.
              */
              <p className="text-xs text-muted-foreground border-l-2 border-amber-500/40 pl-3">
                {datos.equipo.sinAtribuir} {datos.equipo.sinAtribuir === 1 ? "venta no tiene" : "ventas no tienen"} autor
                registrado — son anteriores a que el sistema tuviera cuentas. Cuentan en los totales y no
                en este desglose.
              </p>
            )}
          </section>
        )}

        {/*
          Lo que falta, con su motivo. Va al pie y no escondido en un doc: quien mira el panel tiene
          que poder distinguir "el negocio no tiene este número" de "el sistema todavía no lo mide".
        */}
        {datos?.sinDato && Object.keys(datos.sinDato).length > 0 && (
          <section className="space-y-3 pt-4 border-t border-border/40">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Lo que este panel todavía no puede medir
            </h3>
            <ul className="space-y-1.5">
              {Object.entries(datos.sinDato).map(([clave, motivo]) => (
                <li key={clave} className="text-xs text-muted-foreground leading-relaxed">
                  <span className="text-foreground/70">{clave}</span> — {motivo}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
