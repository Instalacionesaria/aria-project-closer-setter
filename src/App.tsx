import { useState } from "react";
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
import CloserAI from "./views/CloserAI";
import SetterView from "./views/SetterView";
import AgentsAudit from "./views/AgentsAudit";
import Ajustes from "./views/Ajustes";

type View = "closer" | "setter" | "sales_calls" | "agents_audit" | "gerencia" | "ajustes";

const NAV: {
  key: View;
  label: string;
  icon: typeof Zap;
  disabled?: boolean;
  soon?: boolean;
  extra?: string;
}[] = [
  { key: "closer", label: "Closer", icon: UserCheck },
  { key: "setter", label: "Setter", icon: Bot },
  { key: "sales_calls", label: "Sales Calls Audit", icon: PhoneCall, disabled: true },
  { key: "agents_audit", label: "Agents Audit", icon: BrainCircuit },
  { key: "gerencia", label: "Gerencia", icon: TrendingUp, disabled: true, soon: true },
  { key: "ajustes", label: "Ajustes", icon: Settings, extra: "mt-4" },
];

export default function App() {
  const [view, setView] = useState<View>("closer");
  const [role, setRole] = useState<"admin" | "closer" | "setter">("admin");
  const [dark, setDark] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  };

  const cycleRole = () =>
    setRole((r) => (r === "admin" ? "closer" : r === "closer" ? "setter" : "admin"));

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
          {NAV.map(({ key, label, icon: Icon, disabled, soon, extra }) => {
            const active = view === key;
            return (
              <button
                key={key}
                disabled={disabled}
                onClick={() => !disabled && setView(key)}
                className={cn(
                  "inline-flex items-center whitespace-nowrap text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 py-2 w-full justify-start gap-3 rounded-2xl h-12 px-4 transition-all",
                  extra,
                  disabled
                    ? "opacity-40 cursor-not-allowed text-muted-foreground"
                    : active
                      ? "bg-primary/5 text-primary hover:bg-primary/10"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-accent-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
                {soon && (
                  <span className="ml-auto text-[9px] font-bold uppercase tracking-wider bg-muted/50 px-1.5 py-0.5 rounded-sm">
                    Próximamente
                  </span>
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
                    className="flex w-full rounded-md border border-input bg-background px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 text-sm min-h-[100px] resize-none"
                    placeholder="Escribe tu sugerencia aquí..."
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() => setSuggestOpen(false)}
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-3"
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
        {view === "closer" && <CloserAI />}
        {view === "setter" && <SetterView />}
        {view === "agents_audit" && <AgentsAudit />}
        {view === "ajustes" && <Ajustes role={role} />}
      </div>
    </div>
  );
}
