import { createContext, useCallback, useContext, useState } from "react";

/**
 * Single source of truth para Ajustes (§ arquitectura de Ajustes, 2026-07-10): Mi Cuenta +
 * Operación. El menú + del chat y el anillo de comisión de Inicio leen de aquí — nunca guardan
 * su propia copia.
 *
 * El buzón de Sugerencias vivía también acá y se fue el 2026-08-07, por pedido de Fabio: el
 * botón para mandarlas ya se había ido del sidebar, así que la bandeja quedaba como un archivo
 * de lo enviado sin forma de agregar.
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
  /**
   * `inversionMetaAds` se fue el 2026-08-07. Era manual, con semilla 3000, y **nadie la leía**:
   * Estadísticas mandaba ROAS/CAC/CPL/CPA en `null`. Hoy el gasto sale de `closer_meta_metricas`,
   * que llena el cron diario de Meta por empresa. Dos fuentes para el mismo hecho divergen.
   */
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

/**
 * ── Las semillas se vaciaron (2026-08-07, patrón D4) ──────────────────
 *
 * `linkPersonal` traía `https://cal.example.com/jorge-q`: un dominio de ejemplo con el nombre de
 * una persona real. Se copiaba a cualquier empresa nueva y se mostraba como si fuera su link.
 * Vacío es un estado válido y honesto — la UI lo pide en vez de mostrar uno falso.
 *
 * `metaComision` y `calendarConectado` NO son semillas: son el valor inicial de una preferencia
 * personal y el estado de una integración. Se dejan.
 */
const DEFAULT_MI_CUENTA: MiCuenta = {
  metaComision: 3000,
  calendarConectado: true,
  linkPersonal: "",
  sonidoVenta: "caja",
};

/**
 * ── Vacío a propósito (2026-08-07) ────────────────────────────────────
 *
 * Traía `{"Jorge Q.": 10, "Ariel C.": 12}`. "Ariel C." no es ni fue nunca un usuario: era un
 * ejemplo hardcodeado que se veía igual que un dato real, en la tabla desde la que se calculan
 * comisiones. "Jorge Q." sí existe, pero su fila ahora sale de la base como la de cualquiera.
 *
 * **Las filas de la tabla las ponen los usuarios de la empresa con rol `closer`**, no este mapa.
 * Acá solo vive el porcentaje que alguien fijó, indexado por nombre. Una empresa nueva arranca
 * con sus closers y sin porcentaje — que es lo que hay que completar, no un 10% inventado.
 */
const SEED_COMISIONES: Record<string, number> = {};

/** § correcciones dashboards (2026-07-11) — comisión del Setter tiene 2 tramos (§ doc de Fabio): directa (LT que vende él) y diferida (HT que cierra el closer sobre un lead que el setter originó/rescató). */
const SEED_COMISIONES_SETTER_LT: Record<string, number> = {};
const SEED_COMISIONES_SETTER_DIFERIDA: Record<string, number> = {};

/**
 * El objetivo de facturación **no** es una semilla que haya que vaciar: no hay ninguna otra fuente
 * de la que pueda salir —es una decisión del negocio— y arrancar en 0 haría que el panel mostrara
 * "0% de la meta" el primer día, que es peor que un valor de arranque editable.
 */
const DEFAULT_GERENCIA: GerenciaParams = {
  objetivoFacturacion: 46000,
};

const SEED_CATEGORIAS = ["Enlaces de pago", "Low-ticket", "Recursos"];

/**
 * Vacío (2026-08-07, patrón D4). Eran dos enlaces a `pay.example.com` que el closer veía en el
 * menú del chat junto a los reales: un link de cobro falso que se puede mandar por accidente es
 * peor que la ausencia del menú. El catálogo lo carga cada empresa.
 *
 * Las CATEGORÍAS sí se dejan: son etiquetas de organización, no datos que se puedan confundir con
 * algo cobrable, y sin ninguna el formulario de alta arranca sin dónde clasificar.
 */
const SEED_CATALOG: CatalogLink[] = [];

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${++idCounter}`;

/**
 * Persistencia real (2026-07-12): antes Ajustes vivía solo en memoria — refrescar la página
 * volvía a la configuración semilla, aunque se hubiera editado todo. Ahora cada campo se
 * guarda en localStorage, pero SOLO cuando el usuario aprieta "Guardar Cambios" (no en cada
 * tecla) — así el botón que pidió Fabio tiene un propósito real, no cosmético.
 */
const STORAGE_KEY = "comando-central:ajustes";

interface PersistedSettings {
  miCuenta: MiCuenta;
  comisiones: Record<string, number>;
  comisionesSetterLT: Record<string, number>;
  comisionesSetterDiferida: Record<string, number>;
  catalog: CatalogLink[];
  categorias: string[];
  /**
   * `sugerencias` estuvo acá hasta el 2026-08-07. **La clave se deja de escribir pero NO se
   * borra de los blobs que ya existen**: `loadPersisted` devuelve el JSON entero y las claves
   * que la interfaz no declara simplemente se ignoran. Si algún día hace falta recuperar lo que
   * el equipo había mandado, sigue estando en el localStorage de cada uno.
   */
  /**
   * **No renombrar a `estadisticas`.** El módulo pasó a llamarse Estadísticas el 2026-08-07,
   * pero esta es la clave literal del JSON que ya está escrito en el navegador de cada
   * usuario. Si se renombra, la lectura de abajo no la encuentra, cae a `DEFAULT_GERENCIA` y
   * la Inversión en Meta Ads y el Objetivo de facturación vuelven a los valores semilla — sin
   * error, sin aviso, y con el ROAS y el CAC del panel cambiando de golpe.
   *
   * Ojo además con el atajo de propiedad de `saveSettings`: ahí la clave del JSON sale del
   * NOMBRE de la variable local, así que un rename "solo de variable" cambiaría el formato
   * guardado igual. Si algún día hace falta, va con shim: `p.estadisticas ?? p.gerencia`.
   */
  gerencia: GerenciaParams;
}

function loadPersisted(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const datos = raw ? (JSON.parse(raw) as Partial<PersistedSettings>) : {};

    /**
     * Acá vivía la normalización de `Sugerencia.pantalla` de "Gerencia" a "Estadísticas". Se
     * fue con la bandeja: la clave ya no se lee, así que normalizarla no tenía consumidor.
     */
    return datos;
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

  const setGerencia = useCallback((patch: Partial<GerenciaParams>) => {
    setGerenciaState((prev) => ({ ...prev, ...patch }));
    setHasUnsavedChanges(true);
  }, []);

  const saveSettings = useCallback(() => {
    const blob: PersistedSettings = { miCuenta: miCuentaState, comisiones, comisionesSetterLT, comisionesSetterDiferida, catalog, categorias, gerencia };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
    } catch {
      // localStorage no disponible (modo privado, cuota excedida) — falla en silencio, no es crítico para el demo.
    }
    setHasUnsavedChanges(false);
  }, [miCuentaState, comisiones, comisionesSetterLT, comisionesSetterDiferida, catalog, categorias, gerencia]);

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
