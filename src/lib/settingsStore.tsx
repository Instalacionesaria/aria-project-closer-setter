import { createContext, useCallback, useContext, useState } from "react";

/**
 * Single source of truth para Ajustes (§ arquitectura de Ajustes, 2026-07-10): Mi Cuenta +
 * Administración. El menú + del chat, el anillo de comisión de Inicio, y el buzón de
 * Sugerencias leen de aquí — nunca guardan su propia copia.
 */

export type SonidoVenta = "caja" | "aplausos" | "silencio";
export type Role = "closer" | "setter";

export interface MiCuenta {
  /** Solo closers — alimenta el denominador del anillo de comisión en Inicio. */
  metaComision: number;
  calendarConectado: boolean;
  /** "Mi link para agendar" — se inyecta en el menú + del chat, sección MI CALENDARIO. */
  linkPersonal: string;
  sonidoVenta: SonidoVenta;
}

/** § Gerencia (2026-07-13) — únicos 2 parámetros que ese dashboard lee de Ajustes (además de las comisiones ya existentes): inversión de pauta (ROAS/CAC) y objetivo de facturación mensual. Admin-level, no por-usuario. */
export interface GerenciaParams {
  inversionMetaAds: number;
  objetivoFacturacion: number;
}

export interface CatalogLink {
  id: string;
  etiqueta: string;
  /** Libre — nace de `categorias`; "+ Crear nueva" agrega una entrada ahí. */
  categoria: string;
  url: string;
  procesador: string;
  monto?: number;
  /** ["closer"], ["setter"], o ambos = "Todos". */
  scope: Role[];
}

export interface Sugerencia {
  id: string;
  fecha: string;
  /** Rol capitalizado ("Closer"/"Setter"/"Admin") — no hay auth real en el demo. */
  autor: string;
  /** Vista de origen (ej. "Mi Día", "Pipeline Setter") — clicable en Administración para filtrar. */
  pantalla: string;
  texto: string;
  atendida: boolean;
}

const DEFAULT_MI_CUENTA: MiCuenta = {
  metaComision: 3000,
  calendarConectado: true,
  linkPersonal: "https://cal.example.com/jorge-q",
  sonidoVenta: "caja",
};

const SEED_COMISIONES: Record<string, number> = {
  "Jorge Q.": 10,
  "Ariel C.": 12,
};

/** § correcciones dashboards (2026-07-11) — comisión del Setter tiene 2 tramos (§ doc de Francisco): directa (LT que vende él) y diferida (HT que cierra el closer sobre un lead que el setter originó/rescató). */
const SEED_COMISIONES_SETTER_LT: Record<string, number> = {
  "Jorge Q.": 20,
};
const SEED_COMISIONES_SETTER_DIFERIDA: Record<string, number> = {
  "Jorge Q.": 10,
};

const DEFAULT_GERENCIA: GerenciaParams = {
  inversionMetaAds: 3000,
  objetivoFacturacion: 46000,
};

const SEED_CATEGORIAS = ["Enlaces de pago", "Low-ticket", "Recursos"];

const SEED_CATALOG: CatalogLink[] = [
  { id: "seed-cat-1", etiqueta: "Plan Anual", categoria: "Enlaces de pago", url: "https://pay.example.com/plan-anual", procesador: "Stripe", monto: 3000, scope: ["closer"] },
  { id: "seed-cat-2", etiqueta: "Sesión 1 a 1", categoria: "Low-ticket", url: "https://pay.example.com/sesion-1a1", procesador: "Stripe", monto: 500, scope: ["closer", "setter"] },
];

const SEED_SUGERENCIAS: Sugerencia[] = [
  { id: "seed-sug-1", fecha: "07 Jul", autor: "Closer", pantalla: "Mi Día", texto: "Me gustaría poder ver el historial de llamadas más rápido.", atendida: false },
];

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++idCounter}`;

/**
 * Persistencia real (2026-07-12): antes Ajustes vivía solo en memoria — refrescar la página
 * volvía a la configuración semilla, aunque se hubiera editado todo. Ahora cada campo se
 * guarda en localStorage, pero SOLO cuando el usuario aprieta "Guardar Cambios" (no en cada
 * tecla) — así el botón que pidió Francisco tiene un propósito real, no cosmético.
 */
const STORAGE_KEY = "comando-central:ajustes";

interface PersistedSettings {
  miCuenta: MiCuenta;
  comisiones: Record<string, number>;
  comisionesSetterLT: Record<string, number>;
  comisionesSetterDiferida: Record<string, number>;
  catalog: CatalogLink[];
  categorias: string[];
  sugerencias: Sugerencia[];
  gerencia: GerenciaParams;
}

function loadPersisted(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

interface SettingsStoreValue {
  miCuenta: MiCuenta;
  setMiCuenta: (patch: Partial<MiCuenta>) => void;
  comisiones: Record<string, number>;
  setComisionPct: (closer: string, pct: number) => void;
  /** § correcciones dashboards (2026-07-11) — % de comisión directa (LT) y diferida (HT) por setter. */
  comisionesSetterLT: Record<string, number>;
  setComisionSetterLTPct: (setter: string, pct: number) => void;
  comisionesSetterDiferida: Record<string, number>;
  setComisionSetterDiferidaPct: (setter: string, pct: number) => void;
  catalog: CatalogLink[];
  addCatalogLink: (link: Omit<CatalogLink, "id">) => void;
  updateCatalogLink: (id: string, patch: Omit<CatalogLink, "id">) => void;
  removeCatalogLink: (id: string) => void;
  categorias: string[];
  addCategoria: (nombre: string) => void;
  sugerencias: Sugerencia[];
  addSugerencia: (texto: string, pantalla: string, autor: string) => void;
  toggleSugerenciaAtendida: (id: string) => void;
  /** § Gerencia (2026-07-13) — inversión de pauta y objetivo de facturación, los únicos 2 parámetros nuevos que ese dashboard necesita de Ajustes. */
  gerencia: GerenciaParams;
  setGerencia: (patch: Partial<GerenciaParams>) => void;
  /** true si hay cambios sin guardar desde el último "Guardar Cambios" (o desde que cargó la página). */
  hasUnsavedChanges: boolean;
  /** Persiste todo el estado actual a localStorage — es lo único que lo hace sobrevivir a un refresh. */
  saveSettings: () => void;
}

const SettingsCtx = createContext<SettingsStoreValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const persisted = loadPersisted();
  const [miCuentaState, setMiCuentaState] = useState<MiCuenta>(persisted.miCuenta ?? DEFAULT_MI_CUENTA);
  const [comisiones, setComisiones] = useState<Record<string, number>>(persisted.comisiones ?? SEED_COMISIONES);
  const [comisionesSetterLT, setComisionesSetterLT] = useState<Record<string, number>>(persisted.comisionesSetterLT ?? SEED_COMISIONES_SETTER_LT);
  const [comisionesSetterDiferida, setComisionesSetterDiferida] = useState<Record<string, number>>(persisted.comisionesSetterDiferida ?? SEED_COMISIONES_SETTER_DIFERIDA);
  const [catalog, setCatalog] = useState<CatalogLink[]>(persisted.catalog ?? SEED_CATALOG);
  const [categorias, setCategorias] = useState<string[]>(persisted.categorias ?? SEED_CATEGORIAS);
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>(persisted.sugerencias ?? SEED_SUGERENCIAS);
  const [gerencia, setGerenciaState] = useState<GerenciaParams>(persisted.gerencia ?? DEFAULT_GERENCIA);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const setMiCuenta = useCallback((patch: Partial<MiCuenta>) => {
    setMiCuentaState((prev) => ({ ...prev, ...patch }));
    setHasUnsavedChanges(true);
  }, []);

  const setComisionPct = useCallback((closer: string, pct: number) => {
    setComisiones((prev) => ({ ...prev, [closer]: pct }));
    setHasUnsavedChanges(true);
  }, []);

  const setComisionSetterLTPct = useCallback((setter: string, pct: number) => {
    setComisionesSetterLT((prev) => ({ ...prev, [setter]: pct }));
    setHasUnsavedChanges(true);
  }, []);

  const setComisionSetterDiferidaPct = useCallback((setter: string, pct: number) => {
    setComisionesSetterDiferida((prev) => ({ ...prev, [setter]: pct }));
    setHasUnsavedChanges(true);
  }, []);

  const addCatalogLink = useCallback((link: Omit<CatalogLink, "id">) => {
    setCatalog((prev) => [...prev, { ...link, id: nextId("cat") }]);
    setHasUnsavedChanges(true);
  }, []);

  const updateCatalogLink = useCallback((id: string, patch: Omit<CatalogLink, "id">) => {
    setCatalog((prev) => prev.map((l) => (l.id === id ? { ...patch, id } : l)));
    setHasUnsavedChanges(true);
  }, []);

  const removeCatalogLink = useCallback((id: string) => {
    setCatalog((prev) => prev.filter((l) => l.id !== id));
    setHasUnsavedChanges(true);
  }, []);

  const addCategoria = useCallback((nombre: string) => {
    setCategorias((prev) => (prev.includes(nombre) ? prev : [...prev, nombre]));
    setHasUnsavedChanges(true);
  }, []);

  const addSugerencia = useCallback((texto: string, pantalla: string, autor: string) => {
    setSugerencias((prev) => [
      { id: nextId("sug"), fecha: "Hoy", autor, pantalla, texto, atendida: false },
      ...prev,
    ]);
    setHasUnsavedChanges(true);
  }, []);

  const toggleSugerenciaAtendida = useCallback((id: string) => {
    setSugerencias((prev) => prev.map((s) => (s.id === id ? { ...s, atendida: !s.atendida } : s)));
    setHasUnsavedChanges(true);
  }, []);

  const setGerencia = useCallback((patch: Partial<GerenciaParams>) => {
    setGerenciaState((prev) => ({ ...prev, ...patch }));
    setHasUnsavedChanges(true);
  }, []);

  const saveSettings = useCallback(() => {
    const blob: PersistedSettings = { miCuenta: miCuentaState, comisiones, comisionesSetterLT, comisionesSetterDiferida, catalog, categorias, sugerencias, gerencia };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
    } catch {
      // localStorage no disponible (modo privado, cuota excedida) — falla en silencio, no es crítico para el demo.
    }
    setHasUnsavedChanges(false);
  }, [miCuentaState, comisiones, comisionesSetterLT, comisionesSetterDiferida, catalog, categorias, sugerencias, gerencia]);

  const value: SettingsStoreValue = {
    miCuenta: miCuentaState,
    setMiCuenta,
    comisiones,
    setComisionPct,
    comisionesSetterLT,
    setComisionSetterLTPct,
    comisionesSetterDiferida,
    setComisionSetterDiferidaPct,
    catalog,
    addCatalogLink,
    updateCatalogLink,
    removeCatalogLink,
    categorias,
    addCategoria,
    sugerencias,
    addSugerencia,
    toggleSugerenciaAtendida,
    gerencia,
    setGerencia,
    hasUnsavedChanges,
    saveSettings,
  };

  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): SettingsStoreValue {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error("useSettings debe usarse dentro de SettingsProvider");
  return ctx;
}
