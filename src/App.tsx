import { lazy, Suspense, useEffect, useState } from "react";
import {
  Zap,
  UserCheck,
  Bot,
  PhoneCall,
  BrainCircuit,
  TrendingUp,
  Settings,
  Moon,
  Sun,
} from "lucide-react";
import { cn } from "./lib/utils";
import { LimiteDeError } from "./components/LimiteDeError";

/**
 * ── Una vista, un chunk (2026-08-04) ──
 *
 * Antes las cinco entraban en un único bundle: alguien que solo usa Closer descargaba igual
 * el código de Setter, Auditoría de Agentes, Gerencia y Ajustes. Con `React.lazy` cada una
 * viaja cuando se abre por primera vez.
 *
 * `ContactDrawer` (2400 líneas, el archivo más grande del repo) queda en el chunk de Closer
 * porque las dos vistas que lo usan ya son lazy — separarlo otra vez agregaría un salto de
 * red justo al abrir una ficha, que es la acción más frecuente de la app.
 *
 * Los cuatro providers SIGUEN en el chunk de entrada, y no es una omisión: `useSetter()` lo
 * consumen también `gerenciaStore` y `AgentsAudit`, y `useAgentAudit()` lo consume `CloserAI`
 * — bajarlos a su vista los duplicaría en varios chunks.
 */
const CloserAI = lazy(() => import("./views/CloserAI"));
const SetterView = lazy(() => import("./views/SetterView"));
const AgentsAudit = lazy(() => import("./views/AgentsAudit"));
const Gerencia = lazy(() => import("./views/Gerencia"));
const Ajustes = lazy(() => import("./views/Ajustes"));

import { SettingsProvider, useSettings } from "./lib/settingsStore";
import { ClosurerProvider } from "./lib/closerStore";
import { SetterProvider } from "./lib/setterStore";
import { AgentAuditProvider } from "./lib/agentAuditStore";

type View = "closer" | "setter" | "sales_calls" | "agents_audit" | "gerencia" | "ajustes";

const NAV: {
  key: View;
  label: string;
  icon: typeof Zap;
  disabled?: boolean;
  soon?: boolean;
  extra?: string;
}[] = [
  { key: "closer", label: "Closer AI", icon: UserCheck },
  { key: "setter", label: "Setter", icon: Bot },
  { key: "sales_calls", label: "Auditoría de Llamadas", icon: PhoneCall, disabled: true, soon: true },
  { key: "agents_audit", label: "Auditoría de Agentes", icon: BrainCircuit },
  { key: "gerencia", label: "Gerencia", icon: TrendingUp },
  { key: "ajustes", label: "Ajustes", icon: Settings, extra: "mt-4" },
];

function AppInner() {
  const [view, setView] = useState<View>("closer");
  const [role, setRole] = useState<"admin" | "closer" | "setter">("admin");
  const [dark, setDark] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestText, setSuggestText] = useState("");
  const [screenLabel, setScreenLabel] = useState("Inicio");
  const { addSugerencia } = useSettings();

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  };

  const cycleRole = () =>
    setRole((r) => (r === "admin" ? "closer" : r === "closer" ? "setter" : "admin"));

  // Closer/Setter reportan su propia sub-pestaña (Mi Día, Pipeline Setter, etc.) vía onScreenChange;
  // el resto de las vistas no tienen sub-pestañas, así que usan directamente el label de NAV.
  useEffect(() => {
    if (view !== "closer" && view !== "setter" && view !== "gerencia") {
      setScreenLabel(NAV.find((n) => n.key === view)?.label ?? "");
    }
  }, [view]);

  // Gerencia es nivel dueño/admin (§ IMPLEMENTACION-Gerencia-VSCode.md) — ni el ítem del sidebar
  // ni la vista deben quedar accesibles para roles operativos. Si el usuario cambia de rol
  // mientras está parado en Gerencia, lo devuelve a un default seguro.
  useEffect(() => {
    if (role !== "admin" && view === "gerencia") setView("closer");
  }, [role, view]);

  const visibleNav = NAV.filter((n) => n.key !== "gerencia" || role === "admin");

  const enviarSugerencia = () => {
    const texto = suggestText.trim();
    if (!texto) return;
    const autor = role.charAt(0).toUpperCase() + role.slice(1);
    addSugerencia(texto, screenLabel, autor);
    setSuggestText("");
    setSuggestOpen(false);
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden text-foreground">
      {/* Sidebar */}
      <div className="w-[280px] border-r border-border/30 bg-background flex flex-col shrink-0">
        <div className="p-8 border-b border-border/30">
          <h2 className="font-light text-xl tracking-tight flex items-center gap-3">
            <Zap className="w-5 h-5 text-primary opacity-80" />
            Comando Central
          </h2>
        </div>

        <div className="p-6 flex flex-col gap-2 flex-1">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.15em] mb-4 px-2">
            Vistas de Operación
          </div>
          {visibleNav.map(({ key, label, icon: Icon, disabled, soon, extra }) => {
            const active = view === key;
            return (
              <button
                key={key}
                disabled={disabled}
                onClick={() => !disabled && setView(key)}
                className={cn(
                  "inline-flex items-center text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 py-2 w-full justify-start gap-3 rounded-2xl min-h-12 px-4 transition-all",
                  extra,
                  disabled
                    ? "opacity-40 cursor-not-allowed text-muted-foreground"
                    : active
                      ? "bg-primary/5 text-primary hover:bg-primary/10"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-accent-foreground"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {soon ? (
                  <span className="flex flex-col items-start min-w-0">
                    <span className="truncate">{label}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">
                      Próximamente
                    </span>
                  </span>
                ) : (
                  <span className="truncate">{label}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-border/30 bg-muted/10 space-y-4">
          {/* User card — click cycles role */}
          <div onClick={cycleRole} className="flex items-center gap-4 cursor-pointer group">
            <span className="relative flex shrink-0 overflow-hidden rounded-full h-10 w-10 border border-border/50 shadow-sm group-hover:ring-2 ring-primary/20 transition-all">
              <span className="flex h-full w-full items-center justify-center rounded-full bg-primary/5 text-primary text-xs font-semibold">
                US
              </span>
            </span>
            <div className="flex flex-col">
              <span className="text-sm font-medium">Usuario Activo</span>
              <span className="text-[10px] text-muted-foreground capitalize tracking-wider mt-0.5 group-hover:text-primary transition-colors">
                Rol: {role} (Click para cambiar)
              </span>
            </div>
          </div>

          {/* Sugerir Mejora + dark toggle */}
          <div className="relative flex gap-2">
            <button
              onClick={() => setSuggestOpen((o) => !o)}
              className="inline-flex items-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 h-10 px-4 py-2 flex-1 justify-start gap-2 bg-background/50 border border-dashed border-input text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <div className="w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center shrink-0">
                <span className="text-[10px]">💡</span>
              </div>
              <span className="text-xs font-medium">Sugerir Mejora</span>
            </button>
            <button
              onClick={toggleDark}
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 h-10 w-10 shrink-0 bg-background/50 border border-dashed border-input text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {suggestOpen && (
              <div className="absolute bottom-12 left-0 z-50 w-80 p-4 rounded-md border border-border bg-popover text-popover-foreground shadow-md">
                <div className="space-y-3">
                  <h4 className="text-sm font-medium">¿Qué mejorarías de esta pantalla?</h4>
                  <textarea
                    value={suggestText}
                    onChange={(e) => setSuggestText(e.target.value)}
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 text-sm min-h-[100px] resize-none"
                    placeholder="Escribe tu sugerencia aquí..."
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={enviarSugerencia}
                      disabled={!suggestText.trim()}
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:pointer-events-none h-9 rounded-md px-3"
                    >
                      Enviar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* El boundary va POR FUERA del Suspense: cubre tanto el chunk que no se puede
            descargar como cualquier error de render de la vista ya cargada. El `key` lo
            reinicia al cambiar de vista, para que un error en una no deje muertas las otras. */}
        <LimiteDeError key={view}>
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center">
                <div className="h-6 w-6 rounded-full border-2 border-muted border-t-primary animate-spin" />
              </div>
            }
          >
            {view === "closer" && <CloserAI onScreenChange={setScreenLabel} />}
            {view === "setter" && <SetterView onScreenChange={setScreenLabel} />}
            {view === "agents_audit" && <AgentsAudit onScreenChange={setScreenLabel} />}
            {view === "gerencia" && <Gerencia role={role} onScreenChange={setScreenLabel} />}
            {view === "ajustes" && <Ajustes role={role} />}
          </Suspense>
        </LimiteDeError>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <AgentAuditProvider>
        <ClosurerProvider>
          <SetterProvider>
            <AppInner />
          </SetterProvider>
        </ClosurerProvider>
      </AgentAuditProvider>
    </SettingsProvider>
  );
}
