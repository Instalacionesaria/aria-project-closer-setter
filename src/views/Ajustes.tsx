import { useState } from "react";
import { CircleCheck, ChevronDown, Plus, Settings } from "lucide-react";

interface EnlaceRow {
  etiqueta: string;
  categoria: string;
  monto: string;
  procesador: string;
  visible: string[];
}

const ENLACES: EnlaceRow[] = [
  { etiqueta: "Plan Anual", categoria: "Enlaces de pago", monto: "$3.000", procesador: "Stripe", visible: ["closer", "admin"] },
  { etiqueta: "Sesión 1 a 1", categoria: "Low-ticket", monto: "$500", procesador: "Stripe", visible: ["closer", "setter", "admin"] },
];

const COMISIONES: { closer: string; pct: number }[] = [
  { closer: "Diego M.", pct: 10 },
  { closer: "Ariel C.", pct: 12 },
];

const SUGERENCIAS = [
  {
    fecha: "07 Jul",
    autor: "Closer",
    pantalla: "Mi Día",
    texto: "Me gustaría poder ver el historial de llamadas más rápido.",
  },
];

export default function Ajustes({ role = "admin" }: { role?: string }) {
  const [connected, setConnected] = useState(true);
  const [link, setLink] = useState("https://calendly.com/mi-link");

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin bg-background">
      <div className="p-6 max-w-5xl mx-auto space-y-10 mt-4 pr-14 lg:pr-6">
        {/* MI CUENTA */}
        <section className="space-y-4">
          <h2 className="text-sm font-bold tracking-[0.2em] text-muted-foreground uppercase">Mi Cuenta</h2>
          <div className="rounded-lg bg-card text-card-foreground border border-border/50 shadow-sm">
            <div className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Conectar Calendario</label>
                <div className="flex items-center gap-4">
                  <div className="flex-1 max-w-xs">
                    {connected ? (
                      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500 bg-green-500/10 p-2.5 rounded-lg border border-green-500/20">
                        <CircleCheck className="w-4 h-4 shrink-0" />
                        <span>Conectado</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/30 p-2.5 rounded-lg border border-border/50">
                        <span>No conectado</span>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setConnected((c) => !c)}
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 rounded-md px-3"
                  >
                    {connected ? "Desconectar" : "Conectar"}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Mi enlace de agendamiento</label>
                <div className="relative max-w-xs">
                  <input
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    placeholder="https://calendly.com/mi-link"
                    className="flex h-10 w-full rounded-md border border-input px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm bg-background"
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Tu enlace personal que aparece en el menú + del chat.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Sonido de Venta</label>
                <button
                  type="button"
                  className="flex h-10 items-center justify-between rounded-md border border-input px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 w-full max-w-xs bg-background"
                >
                  <span>Caja registradora 💰</span>
                  <ChevronDown className="h-4 w-4 opacity-50" />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ADMINISTRACIÓN — solo rol admin */}
        {role === "admin" && (
          <section className="space-y-4">
            <h2 className="text-sm font-bold tracking-[0.2em] text-muted-foreground uppercase">Administración</h2>
            <div className="grid grid-cols-1 gap-6">
              {/* Catálogo de Enlaces */}
              <div className="rounded-lg bg-card text-card-foreground border border-border/50 shadow-sm">
                <div className="flex flex-col space-y-1.5 p-6 pb-4 border-b border-border/50 bg-muted/10">
                  <h3 className="font-semibold tracking-tight text-lg">Catálogo de Enlaces</h3>
                </div>
                <div className="p-0">
                  <div className="relative w-full overflow-auto">
                    <table className="w-full caption-bottom text-sm">
                      <thead className="[&_tr]:border-b">
                        <tr className="border-b transition-colors hover:bg-muted/50">
                          {["Etiqueta", "Categoría", "Monto", "Procesador", "Visible para", ""].map((h, i) => (
                            <th key={i} className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="[&_tr:last-child]:border-0">
                        {ENLACES.map((r) => (
                          <tr key={r.etiqueta} className="border-b transition-colors hover:bg-muted/50">
                            <td className="p-4 align-middle font-medium">{r.etiqueta}</td>
                            <td className="p-4 align-middle">
                              <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold text-foreground text-[10px] bg-muted/50">
                                {r.categoria}
                              </div>
                            </td>
                            <td className="p-4 align-middle">{r.monto}</td>
                            <td className="p-4 align-middle">{r.procesador}</td>
                            <td className="p-4 align-middle">
                              <div className="flex gap-1">
                                {r.visible.map((v) => (
                                  <div
                                    key={v}
                                    className="inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80 text-[10px] uppercase"
                                  >
                                    {v}
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td className="p-4 align-middle text-right">
                              <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground rounded-md h-8 w-8 p-0">
                                <Settings className="w-4 h-4 text-muted-foreground" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="p-4 border-t border-border/50">
                    <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 rounded-md px-3 w-full border-dashed">
                      <Plus className="w-4 h-4 mr-2" /> Agregar Enlace
                    </button>
                  </div>
                </div>
              </div>

              {/* Comisiones por Closer */}
              <div className="rounded-lg bg-card text-card-foreground border border-border/50 shadow-sm">
                <div className="flex flex-col space-y-1.5 p-6 pb-4 border-b border-border/50 bg-muted/10">
                  <h3 className="font-semibold tracking-tight text-lg">Comisiones por Closer</h3>
                </div>
                <div className="p-0">
                  <div className="relative w-full overflow-auto">
                    <table className="w-full caption-bottom text-sm">
                      <thead className="[&_tr]:border-b">
                        <tr className="border-b transition-colors hover:bg-muted/50">
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Closer</th>
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">% Comisión</th>
                        </tr>
                      </thead>
                      <tbody className="[&_tr:last-child]:border-0">
                        {COMISIONES.map((c) => (
                          <tr key={c.closer} className="border-b transition-colors hover:bg-muted/50">
                            <td className="p-4 align-middle font-medium">{c.closer}</td>
                            <td className="p-4 align-middle">
                              <div className="flex items-center gap-2 max-w-[100px]">
                                <input
                                  type="number"
                                  defaultValue={c.pct}
                                  className="flex w-full rounded-md border border-input px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm h-8 bg-background"
                                />
                                <span className="text-sm text-muted-foreground">%</span>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Sugerencias del Equipo */}
              <div className="rounded-lg bg-card text-card-foreground border border-border/50 shadow-sm">
                <div className="flex flex-col space-y-1.5 p-6 pb-4 border-b border-border/50 bg-muted/10">
                  <h3 className="font-semibold tracking-tight text-lg">Sugerencias del Equipo</h3>
                </div>
                <div className="p-0">
                  <div className="divide-y divide-border/50">
                    {SUGERENCIAS.map((s, i) => (
                      <div key={i} className="p-4 flex gap-4 items-start hover:bg-muted/5 transition-colors">
                        <div className="flex-1 space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{s.fecha}</span>
                            <span className="text-sm font-medium">{s.autor}</span>
                            <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold border-transparent text-secondary-foreground text-[10px] bg-muted cursor-pointer hover:bg-primary/10 transition-colors">
                              {s.pantalla}
                            </div>
                          </div>
                          <p className="text-sm text-foreground/90">{s.texto}</p>
                        </div>
                        <button className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors h-8 w-8 text-muted-foreground hover:text-green-600 hover:bg-green-500/10 rounded-full shrink-0">
                          <CircleCheck className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
