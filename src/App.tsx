import { lazy, Suspense, useEffect, useState } from "react";
import {
  Zap,
  UserCheck,
  Bot,
  BrainCircuit,
  Megaphone,
  TrendingUp,
  Settings,
  Moon,
  Sun,
  LogOut,
  Building2,
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
 * el código de Setter, Auditoría de Agentes, Estadísticas y Ajustes. Con `React.lazy` cada una
 * viaja cuando se abre por primera vez.
 *
 * `ContactDrawer` (2400 líneas, el archivo más grande del repo) queda en el chunk de Closer
 * porque las dos vistas que lo usan ya son lazy — separarlo otra vez agregaría un salto de
 * red justo al abrir una ficha, que es la acción más frecuente de la app.
 *
 * Las secciones de administración viajan en el chunk de Ajustes desde que son pestañas suyas
 * (2026-08-07). Es más código en un solo chunk, pero ninguna de las dos partes se le sirve a
 * quien no es admin: la vista entera está detrás del mismo gate.
 *
 * Los cuatro providers SIGUEN en el chunk de entrada, y no es una omisión: `useSetter()` lo
 * consume también `AgentsAudit`, y `useAgentAudit()` lo consume `CloserAI` — bajarlos a su vista
 * los duplicaría en varios chunks.
 */
const CloserAI = lazy(() => import("./views/CloserAI"));
const SetterView = lazy(() => import("./views/SetterView"));
const AgentsAudit = lazy(() => import("./views/AgentsAudit"));
const Estadisticas = lazy(() => import("./views/Estadisticas"));
const Acquisition = lazy(() => import("./views/Acquisition"));
const Ajustes = lazy(() => import("./views/Ajustes"));
const Login = lazy(() => import("./views/Login"));

import { SettingsProvider } from "./lib/settingsStore";
import { ClosurerProvider } from "./lib/closerStore";
import { SetterProvider } from "./lib/setterStore";
import { AgentAuditProvider } from "./lib/agentAuditStore";

type View = "closer" | "setter" | "agents_audit" | "adquisicion" | "estadisticas" | "ajustes";

/**
 * Cada módulo declara QUÉ ROL lo habilita (ESPEC §3.2). El sidebar se arma desde acá, así que
 * agregar un módulo es agregar una fila — no hay una segunda lista de permisos en otro lado.
 *
 * Es cosmética: la protección real es el 403 del backend. Sirve para no mostrarle a alguien
 * una pestaña que le va a rebotar.
 *
 * ── Dos entradas que se fueron el 2026-08-07 ──────────────────────────
 *
 * **Auditoría de Llamadas** estaba deshabilitada con el cartel "Próximamente" desde siempre y
 * nunca tuvo vista. Lo que prometía ya lo hace Auditoría de Agentes, que tiene su pestaña de
 * agentes de voz. Una entrada que no lleva a ningún lado no reserva el lugar de una función:
 * la anuncia y no la entrega.
 *
 * **Administración** pasó a ser pestañas de Ajustes. Eran dos entradas de sidebar con el mismo
 * gate de rol que llevaban a dos pantallas de configuración; ahora es una sola.
 */
const NAV: {
  key: View;
  label: string;
  icon: typeof Zap;
  roles: Rol[];
  extra?: string;
}[] = [
  { key: "closer", label: "Closer", icon: UserCheck, roles: ["closer"] },
  { key: "setter", label: "Setter", icon: Bot, roles: ["setter"] },
  { key: "agents_audit", label: "Auditoría de Agentes", icon: BrainCircuit, roles: ["tecnico"] },
  /**
   * Estadísticas pasó de `super_admin` a `admin` el 2026-08-07, y no es que se aflojó un permiso:
   * **desapareció el motivo de la restricción**. Estaba limitada porque su dataset era inventado
   * y mostrarle métricas fabricadas al admin de una empresa cliente sería mostrarle datos falsos
   * a alguien que paga (D3). Ahora sale de `GET /api/estadisticas`, que calcula por query sobre
   * `closer_avances` y `closer_citas` de SU empresa, y lo que no se puede medir no se muestra.
   */
  /**
   * Adquisición (§9 · fase 7). `media_buyer` es el rol para el que existe, y hasta hoy **ese rol
   * no tenía ninguna entrada en el sidebar**: un usuario con solo ese rol entraba a la primera
   * vista disponible y le rebotaba entera con 403. Se podía asignar desde el panel de usuarios,
   * así que era un agujero real, no teórico.
   */
  { key: "adquisicion", label: "Adquisición", icon: Megaphone, roles: ["media_buyer", "admin"] },
  { key: "estadisticas", label: "Estadísticas", icon: TrendingUp, roles: ["admin"] },
  { key: "ajustes", label: "Ajustes", icon: Settings, roles: ["admin"], extra: "mt-4" },
];

function AppInner() {
  const { usuario, empresa, mirandoOtraEmpresa, tieneRol, salir, tema, alternarTema } = useAuth();

  /**
   * El sidebar sale de los roles de la sesión. Antes había un `role` en estado local con un
   * botón que lo ciclaba entre admin/closer/setter: era un simulador para desarrollar sin
   * autenticación, y con cuentas reales sería un cambio de permisos a un clic.
   */
  const visibleNav = NAV.filter((n) => tieneRol(...n.roles));

  /** Con un solo módulo, se entra directo a él (§3.2). */
  const [view, setView] = useState<View>(() => visibleNav[0]?.key ?? "closer");

  /**
   * `Estadísticas` y `Ajustes` siguen recibiendo un `role` de tres valores porque su UI interna
   * lo usa. Se deriva del rol real en vez de mantener un estado propio: una sola fuente.
   */
  const role: "admin" | "closer" | "setter" = tieneRol("admin") ? "admin" : tieneRol("setter") ? "setter" : "closer";
  /**
   * Si la vista abierta deja de estar permitida —cambió el rol, o el super admin se movió a
   * otra empresa— se vuelve a la primera disponible. Sin esto quedaría una pantalla en blanco
   * pidiendo datos que el backend rechaza con 403.
   */
  useEffect(() => {
    if (!visibleNav.some((n) => n.key === view)) {
      setView(visibleNav[0]?.key ?? "closer");
    }
  }, [visibleNav, view]);

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
          {visibleNav.map(({ key, label, icon: Icon, extra }) => {
            const active = view === key;
            return (
              <button
                key={key}
                onClick={() => setView(key)}
                className={cn(
                  "inline-flex items-center text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 py-2 w-full justify-start gap-3 rounded-2xl min-h-12 px-4 transition-all",
                  extra,
                  active
                    ? "bg-primary/5 text-primary hover:bg-primary/10"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-accent-foreground",
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{label}</span>
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
            {/*
              El tema y la salida, juntos y en ese orden. Los dos son de la persona, no de la
              empresa ni de la vista, así que viven pegados a su nombre y no en una franja
              aparte. El de salir queda último: es el destructivo de los dos.
            */}
            <button
              onClick={alternarTema}
              title={tema === "oscuro" ? "Modo claro" : "Modo oscuro"}
              className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center"
            >
              {tema === "oscuro" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={() => void salir()}
              title="Salir"
              className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center"
            >
              <LogOut className="w-4 h-4" />
            </button>
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
            {view === "closer" && <CloserAI />}
            {view === "setter" && <SetterView />}
            {view === "agents_audit" && <AgentsAudit />}
            {view === "adquisicion" && <Acquisition />}
            {view === "estadisticas" && <Estadisticas role={role} />}
            {view === "ajustes" && <Ajustes role={role} />}
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
