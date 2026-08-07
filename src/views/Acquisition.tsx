/**
 * Acquisition Intelligence (ESPEC §9 · fase 7).
 *
 * Alcance del 15 de agosto: **leer y mostrar**. Lo que se ve acá sale de `closer_meta_metricas`,
 * que el cron diario llena desde la Graph API — nada calculado en el cliente, nada sembrado.
 *
 * ── Las cuatro secciones que se ven y no funcionan ────────────────────
 *
 * Atribución, alertas, recomendaciones y tracking están **detrás del velo de §8**: se ve su forma,
 * dice qué van a hacer, y no muestran un solo número. Es deliberado por dos motivos — el cliente
 * tiene que saber que existen y están viniendo, y un panel de atribución con cifras plausibles
 * sería el peor dato falso de todo el producto, porque se usa para decidir dónde poner plata.
 *
 * ── Tres vacíos que NO son el mismo ───────────────────────────────────
 *
 * Se distinguen a propósito, porque llevan a tres acciones distintas:
 *
 *   1. **Sin credenciales** (`conectado: false`) — nadie conectó la cuenta. Se arregla en Ajustes.
 *   2. **Con credenciales y sin sincronizar** (`sinSincronizarAun`) — el cron todavía no corrió.
 *      Se arregla esperando, o mirando por qué falló.
 *   3. **Sincronizado y sin actividad** — no hubo pauta en el período. No hay nada que arreglar.
 *
 * Colapsar los tres en "no hay datos" habría mandado a alguien a revisar credenciales que están
 * bien.
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BarChart3, Megaphone, Target, TrendingUp } from "lucide-react";
import { cn } from "../lib/utils";
import { EnDesarrollo } from "../lib/enDesarrollo";
import { fetchAcquisition, type AcquisitionResponse, type NivelAcquisition } from "../lib/api";

const NIVELES: { key: NivelAcquisition; label: string }[] = [
  { key: "cuenta", label: "Cuenta" },
  { key: "campana", label: "Campañas" },
  { key: "adset", label: "Ad sets" },
  { key: "anuncio", label: "Anuncios" },
];

const RANGOS = [7, 30, 90];

const money = (n: number) => `$${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
const entero = (n: number) => n.toLocaleString("es-AR");

/**
 * Un número medido, o nada.
 *
 * `null` no se renderiza: es la regla §4.1, y acá importa más que en otras vistas porque un cero en
 * una métrica de costo se lee como "gratis" y no como "no medido".
 */
function Metrica({ valor, etiqueta, formato }: { valor: number | null; etiqueta: string; formato?: (n: number) => string }) {
  if (valor === null) return null;
  return (
    <div className="space-y-0.5">
      <div className={cn("text-2xl font-bold tracking-tight", valor === 0 && "text-muted-foreground/50")}>
        {formato ? formato(valor) : entero(valor)}
      </div>
      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">{etiqueta}</div>
    </div>
  );
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("bg-card border border-border rounded-2xl p-6 shadow-sm", className)}>{children}</div>;
}

function SectionHeader({ icon: Icon, title }: { icon: typeof BarChart3; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="w-4 h-4 text-violet-600 dark:text-violet-400" />
      <h3 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground">{title}</h3>
    </div>
  );
}

/** El aviso de por qué está vacío. Los tres casos dicen qué hacer, no solo que no hay datos. */
function Vacio({ datos }: { datos: AcquisitionResponse }) {
  if (datos.conectado === false) {
    return (
      <Card className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="text-sm font-medium">La cuenta publicitaria no está conectada</div>
          <p className="text-xs text-muted-foreground">
            Se carga en <strong>Ajustes › Credenciales</strong>: la cuenta publicitaria de Meta y su token.
            Hasta entonces no hay nada que leer — y no se muestran ceros, porque un gasto en cero y un
            gasto que nadie midió no son lo mismo.
          </p>
        </div>
      </Card>
    );
  }
  if (datos.sinSincronizarAun) {
    return (
      <Card className="text-sm text-muted-foreground">
        Las credenciales están cargadas y la primera sincronización todavía no corrió. El cron trae los
        datos una vez por día.
      </Card>
    );
  }
  return <Card className="text-sm text-muted-foreground">No hubo actividad de pauta en este período.</Card>;
}

export default function Acquisition() {
  const [nivel, setNivel] = useState<NivelAcquisition>("campana");
  const [dias, setDias] = useState(30);
  const [datos, setDatos] = useState<AcquisitionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async (n: NivelAcquisition, d: number) => {
    setCargando(true);
    const r = await fetchAcquisition(n, d);
    setCargando(false);
    if (!r.ok) return setError(r.error ?? "No se pudo cargar la pauta.");
    setError(null);
    setDatos(r);
  }, []);

  useEffect(() => {
    void cargar(nivel, dias);
  }, [cargar, nivel, dias]);

  const hayFilas = (datos?.objetos?.length ?? 0) > 0;

  return (
    <div className="flex-1 bg-[#fcfcfd] dark:bg-background overflow-y-scroll">
      <div className="p-10 max-w-[1200px] mx-auto space-y-10 pb-24">
        <div className="flex items-end justify-between flex-wrap gap-4 pr-14 lg:pr-0">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Adquisición</h1>
            <p className="text-sm text-muted-foreground mt-1">Lo que se gastó en pauta y qué trajo</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-card border border-border/40 rounded-full p-1">
              {RANGOS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDias(d)}
                  className={cn(
                    "px-3 h-8 rounded-full text-xs font-medium transition-all",
                    dias === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {d}d
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 bg-card border border-border/40 rounded-full p-1">
              {NIVELES.map((n) => (
                <button
                  key={n.key}
                  onClick={() => setNivel(n.key)}
                  className={cn(
                    "px-3 h-8 rounded-full text-xs font-medium transition-all",
                    nivel === n.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {n.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <Card className="border-destructive/40 bg-destructive/5 text-sm text-destructive">{error}</Card>}

        {cargando && !datos && (
          <div className="py-20 flex justify-center">
            <div className="h-6 w-6 rounded-full border-2 border-muted border-t-primary animate-spin" />
          </div>
        )}

        {datos && !hayFilas && <Vacio datos={datos} />}

        {datos?.totales && hayFilas && (
          <section className="space-y-4">
            <SectionHeader icon={BarChart3} title="Totales del período" />
            <Card className="flex flex-wrap gap-x-12 gap-y-6">
              <Metrica valor={datos.totales.gasto} etiqueta="Gasto" formato={money} />
              <Metrica valor={datos.totales.impresiones} etiqueta="Impresiones" />
              <Metrica valor={datos.totales.clics} etiqueta="Clics" />
              <Metrica valor={datos.totales.alcance} etiqueta="Alcance" />
              <Metrica valor={datos.totales.leads} etiqueta="Leads" />
              <Metrica valor={datos.totales.ctr} etiqueta="CTR %" formato={(n) => `${n}%`} />
              <Metrica valor={datos.totales.cpc} etiqueta="CPC" formato={money} />
              <Metrica valor={datos.totales.cpm} etiqueta="CPM" formato={money} />
              <Metrica valor={datos.totales.cpl} etiqueta="CPL" formato={money} />
            </Card>
            {/*
              El CTR, el CPC, el CPM y el CPL de acá se recalculan del TOTAL en el backend, no se
              promedian por objeto: promediar promedios da un número que no es el promedio de nada.
            */}
            <p className="text-[11px] text-muted-foreground">
              Los costos se recalculan sobre el total del período, no como promedio de los objetos.
            </p>
          </section>
        )}

        {hayFilas && (
          <section className="space-y-4">
            <SectionHeader icon={Megaphone} title={NIVELES.find((n) => n.key === nivel)?.label ?? ""} />
            <Card className="p-0 overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="border-b border-border/50">
                  <tr>
                    {["Nombre", "Gasto", "Impresiones", "Clics", "CTR", "CPC", "Leads", "CPL"].map((h) => (
                      <th key={h} className="text-left p-4 font-medium text-muted-foreground whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datos?.objetos?.map((o) => (
                    <tr key={o.objetoId} className="border-b border-border/30 last:border-0">
                      {/* Sin nombre se muestra el id: es feo y es honesto — inventar un nombre sería peor. */}
                      <td className="p-4 font-medium">{o.nombre ?? o.objetoId}</td>
                      <td className="p-4">{o.gasto === null ? "—" : money(o.gasto)}</td>
                      <td className="p-4">{o.impresiones === null ? "—" : entero(o.impresiones)}</td>
                      <td className="p-4">{o.clics === null ? "—" : entero(o.clics)}</td>
                      <td className="p-4">{o.ctr === null ? "—" : `${o.ctr}%`}</td>
                      <td className="p-4">{o.cpc === null ? "—" : money(o.cpc)}</td>
                      <td className="p-4">{o.leads === null ? "—" : entero(o.leads)}</td>
                      <td className="p-4">{o.cpl === null ? "—" : money(o.cpl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        )}

        {/*
          ── Las cuatro de §8 ─────────────────────────────────────────────
          Se ven, dicen qué van a hacer, y no traen un solo número. La de atribución es la que más
          importa que quede así: cifras plausibles ahí se usan para decidir dónde poner plata.
        */}
        <section className="space-y-4">
          <SectionHeader icon={Target} title="Atribución" />
          <EnDesarrollo clave="acquisition.atribucion">
            <Card className="space-y-3">
              <div className="grid grid-cols-3 gap-4">
                {["Leads por anuncio", "Citas por anuncio", "Ventas por anuncio"].map((t) => (
                  <div key={t} className="space-y-1">
                    <div className="text-2xl font-bold tracking-tight text-muted-foreground/30">—</div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">{t}</div>
                  </div>
                ))}
              </div>
            </Card>
          </EnDesarrollo>
        </section>

        <section className="space-y-4">
          <SectionHeader icon={AlertTriangle} title="Alertas" />
          <EnDesarrollo clave="acquisition.alertas">
            <Card className="space-y-2">
              {["Fatiga de creativo", "Costo por lead disparado", "Caída de alcance"].map((t) => (
                <div key={t} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
                  <span className="text-sm">{t}</span>
                  <span className="text-muted-foreground/30">—</span>
                </div>
              ))}
            </Card>
          </EnDesarrollo>
        </section>

        <section className="space-y-4">
          <SectionHeader icon={TrendingUp} title="Recomendaciones" />
          <EnDesarrollo clave="acquisition.recomendaciones">
            <Card className="text-sm text-muted-foreground/40">
              Dónde mover presupuesto, con el número que respalda cada sugerencia.
            </Card>
          </EnDesarrollo>
        </section>

        <section className="space-y-4">
          <SectionHeader icon={Target} title="Tracking del visitante" />
          <EnDesarrollo clave="acquisition.tracking">
            <Card className="text-sm text-muted-foreground/40">
              El camino del visitante desde el anuncio hasta la landing y el formulario.
            </Card>
          </EnDesarrollo>
        </section>
      </div>
    </div>
  );
}
