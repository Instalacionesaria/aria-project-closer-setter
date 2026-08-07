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
  LogOut,
  Building2,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import { cn } from "./lib/utils";
import { LimiteDeError } from "./components/LimiteDeError";
import { AuthProvider, useAuth } from "./lib/authStore";
import { fetchEmpresas, type EmpresaAdmin, type Rol } from "./lib/api";

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
const Administracion = lazy(() => import("./views/Administracion"));
const Login = lazy(() => import("./views/Login"));

import { SettingsProvider, useSettings } from "./lib/settingsStore";
import { ClosurerProvider } from "./lib/closerStore";
import { SetterProvider } from "./lib/setterStore";
import { AgentAuditProvider } from "./lib/agentAuditStore";

type View = "closer" | "setter" | "sales_calls" | "agents_audit" | "gerencia" | "ajustes" | "administracion";

/**
 * Cada módulo declara QUÉ ROL lo habilita (ESPEC §3.2). El sidebar se arma desde acá, así que
 * agregar un módulo es agregar una fila — no hay una segunda lista de permisos en otro lado.
 *
 * Es cosmética: la protección real es el 403 del backend. Sirve para no mostrarle a alguien
 * una pestaña que le va a rebotar.
 */
const NAV: {
  key: View;
  label: string;
  icon: typeof Zap;
  roles: Rol[];
  disabled?: boolean;
  soon?: boolean;
  extra?: string;
}[] = [
  { key: "closer", label: "Closer AI", icon: UserCheck, roles: ["closer"] },
  { key: "setter", label: "Setter", icon: Bot, roles: ["setter"] },
  { key: "sales_calls", label: "Auditoría de Llamadas", icon: PhoneCall, roles: ["tecnico"], disabled: true, soon: true },
  { key: "agents_audit", label: "Auditoría de Agentes", icon: BrainCircuit, roles: ["tecnico"] },
  /**
   * Gerencia queda SOLO para el super admin, y no es una decisión de producto: su dataset es
   * inventado (`src/lib/gerenciaStore.tsx`) y la especificación §8 no la incluye entre las
   * secciones "en desarrollo". Mostrarle métricas fabricadas al admin de una empresa cliente
   * sería mostrarle datos falsos a alguien que paga — la regla D3. Con `super_admin` la ve
   * solo quien sabe que es una maqueta. Pendiente de decisión de Fabio.
   */
  { key: "gerencia", label: "Gerencia", icon: TrendingUp, roles: ["super_admin"] },
  { key: "ajustes", label: "Ajustes", icon: Settings, roles: ["admin"], extra: "mt-4" },
  /**
   * §7 · Empresas, usuarios y credenciales. Va debajo de Ajustes y no arriba: se usa al dar de
   * alta un cliente y después casi nunca, mientras que las de operación se usan todos los días.
   */
  { key: "administracion", label: "Administración", icon: ShieldCheck, roles: ["admin"] },
];

function AppInner() {
  const { usuario, empresa, mirandoOtraEmpresa, tieneRol, salir } = useAuth();

  /**
   * El sidebar sale de los roles de la sesión. Antes había un `role` en estado local con un
   * botón que lo ciclaba entre admin/closer/setter: era un simulador para desarrollar sin
   * autenticación, y con cuentas reales sería un cambio de permisos a un clic.
   */
  const visibleNav = NAV.filter((n) => tieneRol(...n.roles));

  /** Con un solo módulo, se entra directo a él (§3.2). */
  const [view, setView] = useState<View>(() => visibleNav.find((n) => !n.disabled)?.key ?? "closer");

  /**
   * `Gerencia` y `Ajustes` siguen recibiendo un `role` de tres valores porque su UI interna lo
   * usa. Se deriva del rol real en vez de mantener un estado propio: una sola fuente.
   */
  const role: "admin" | "closer" | "setter" = tieneRol("admin") ? "admin" : tieneRol("setter") ? "setter" : "closer";
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

  // Closer/Setter reportan su propia sub-pestaña (Mi Día, Pipeline Setter, etc.) vía onScreenChange;
  // el resto de las vistas no tienen sub-pestañas, así que usan directamente el label de NAV.
  useEffect(() => {
    if (view !== "closer" && view !== "setter" && view !== "gerencia") {
      setScreenLabel(NAV.find((n) => n.key === view)?.label ?? "");
    }
  }, [view]);

  /**
   * Si la vista abierta deja de estar permitida —cambió el rol, o el super admin se movió a
   * otra empresa— se vuelve a la primera disponible. Sin esto quedaría una pantalla en blanco
   * pidiendo datos que el backend rechaza con 403.
   */
  useEffect(() => {
    if (!visibleNav.some((n) => n.key === view)) {
      setView(visibleNav.find((n) => !n.disabled)?.key ?? "closer");
    }
  }, [visibleNav, view]);

  const enviarSugerencia = () => {
    const texto = suggestText.trim();
    if (!texto) return;
    const autor = usuario?.nombre ?? "Usuario";
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
          {/* Quién está usando la herramienta. Los roles vienen de la sesión, no se eligen. */}
          <div className="flex items-center gap-4">
            <span className="relative flex shrink-0 overflow-hidden rounded-full h-10 w-10 border border-border/50 shadow-sm">
              <span className="flex h-full w-full items-center justify-center rounded-full bg-primary/5 text-primary text-xs font-semibold">
                {iniciales(usuario?.nombre)}
              </span>
            </span>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-sm font-medium truncate">{usuario?.nombre ?? "—"}</span>
              <span className="text-[10px] text-muted-foreground tracking-wider mt-0.5 truncate">
                {(usuario?.roles ?? []).join(" · ") || "sin rol"}
              </span>
            </div>
            <button
              onClick={() => void salir()}
              title="Salir"
              className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center"
            >
              <LogOut className="w-4 h-4" />
            </button>
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
        {/*
          §7.1 · Mientras el super admin mira una empresa que no es la suya, un banner
          PERMANENTE lo dice. Es para que nadie confunda de qué empresa son los datos que
          tiene delante — y para que no registre un resultado en la cuenta equivocada.
        */}
        {mirandoOtraEmpresa && (
          <div className="shrink-0 px-4 py-2 bg-amber-500/15 border-b border-amber-500/30 text-xs font-medium text-amber-900 dark:text-amber-200 flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5 shrink-0" />
            Estás viendo los datos de <strong>{empresa?.nombre ?? "otra empresa"}</strong>, no los de ARIA.
          </div>
        )}
        {/* Solo el super admin cambia de empresa (§7.1). Para todos los demás no hay selector
            porque no hay nada que elegir: su sesión está atada a una sola. */}
        {usuario?.esSuperAdmin && <SelectorEmpresa />}
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
            {view === "administracion" && <Administracion />}
          </Suspense>
        </LimiteDeError>
      </div>
    </div>
  );
}

/**
 * El selector de empresa activa del super admin (§7.1).
 *
 * ── No filtra la vista: cambia la sesión ──────────────────────────────
 *
 * Elegir una empresa acá hace un PATCH a `/api/auth/sesion` y **el backend** pasa a devolver
 * los datos de esa empresa en todos los endpoints. Por eso al terminar se recarga la página
 * entera: los cuatro providers ya tienen en memoria los contactos, la agenda y las alertas de
 * la empresa anterior, y no hay forma de invalidarlos todos sin que alguno quede mostrando
 * datos de una empresa con el nombre de otra encima. Eso es exactamente lo que el banner
 * existe para evitar.
 *
 * La lista se pide una sola vez al abrir el desplegable, no al montar: es un endpoint de admin
 * y esto se renderiza en cada pantalla de la app.
 */
function SelectorEmpresa() {
  const { empresa, mirarEmpresa } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const [empresas, setEmpresas] = useState<EmpresaAdmin[] | null>(null);
  const [cambiando, setCambiando] = useState(false);

  const abrir = () => {
    setAbierto((o) => !o);
    if (empresas === null) void fetchEmpresas().then((r) => setEmpresas(r.empresas ?? []));
  };

  const elegir = async (orgId: string) => {
    if (orgId === empresa?.id) return setAbierto(false);
    setCambiando(true);
    const r = await mirarEmpresa(orgId);
    if (!r.ok) {
      setCambiando(false);
      setAbierto(false);
      return;
    }
    window.location.reload();
  };

  return (
    <div className="shrink-0 px-4 py-1.5 border-b border-border/30 bg-muted/20 flex items-center gap-2 relative">
      <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">Empresa</span>
      <button
        onClick={abrir}
        disabled={cambiando}
        className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-xs font-medium hover:bg-accent disabled:opacity-50"
      >
        <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
        {empresa?.nombre ?? "—"}
        <ChevronDown className={cn("w-3 h-3 text-muted-foreground transition-transform", abierto && "rotate-180")} />
      </button>

      {abierto && (
        <>
          {/* Un panel invisible detrás cierra el desplegable al hacer clic en cualquier lado. */}
          <div className="fixed inset-0 z-40" onClick={() => setAbierto(false)} />
          <div className="absolute top-full left-16 z-50 mt-1 w-64 rounded-md border border-border bg-popover shadow-md py-1">
            {empresas === null ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Cargando…</div>
            ) : (
              empresas.map((e) => (
                <button
                  key={e.id}
                  onClick={() => void elegir(e.id)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center justify-between gap-2",
                    e.id === empresa?.id && "text-primary font-medium",
                  )}
                >
                  <span className="truncate">{e.nombre}</span>
                  {/* Una empresa desactivada se puede mirar —para diagnosticar por qué lo
                      está— pero se dice que lo está antes de entrar. */}
                  {!e.activa && <span className="text-[10px] text-muted-foreground shrink-0">desactivada</span>}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Iniciales para el avatar. Sin nombre no se inventa nada: dos guiones. */
function iniciales(nombre?: string | null): string {
  const partes = (nombre ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "—";
  return (partes[0][0] + (partes[1]?.[0] ?? "")).toUpperCase();
}

/**
 * La compuerta.
 *
 * Los cuatro providers de datos montan relojes que golpean endpoints protegidos apenas
 * existen. Por eso el login va **por fuera** de ellos: si estuvieran adentro, alguien sin
 * sesión dispararía un tick cada 10 segundos contra un backend que le responde 401.
 *
 * `cargando` es su propio estado y no se confunde con "no hay sesión": sin él, quien ya está
 * autenticado vería la pantalla de login por un instante en cada recarga.
 */
function Compuerta() {
  const { estado, usuario } = useAuth();

  if (estado === "cargando") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-6 w-6 rounded-full border-2 border-muted border-t-primary animate-spin" />
      </div>
    );
  }

  if (estado === "anonimo" || usuario?.debeCambiarPassword) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-background" />}>
        <Login />
      </Suspense>
    );
  }

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

export default function App() {
  return (
    <AuthProvider>
      <Compuerta />
    </AuthProvider>
  );
}
