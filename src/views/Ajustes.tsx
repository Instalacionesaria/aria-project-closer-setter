/**
 * Ajustes — todo lo que se configura, en un solo lugar (2026-08-07).
 *
 * ── Por qué esta vista tiene pestañas ─────────────────────────────────
 *
 * Hasta hoy había dos entradas en el sidebar, **Ajustes** y **Administración**, con el mismo
 * gate de rol y llevando las dos a pantallas de configuración. Para saber dónde estaba cada
 * cosa había que conocer de antemano el criterio con el que se habían repartido. Fabio pidió
 * unificarlas y ahora son cinco pestañas de una vista sola.
 *
 * Las tres de administración viven en `Administracion.tsx` y se importan por nombre: no se
 * fusionaron los archivos porque entre los dos hay 1700 líneas.
 *
 * ── Las pestañas se montan y se desmontan ─────────────────────────────
 *
 * Cada pestaña se renderiza solo cuando está abierta, y eso es deliberado por dos motivos: las
 * de administración piden datos al montarse —tenerlas todas montadas dispararía cuatro
 * requests al abrir Ajustes— y la contraseña temporal de un usuario nuevo no debe sobrevivir
 * a la navegación.
 *
 * El costo es que cambiar de pestaña borra lo que esa pestaña tuviera a medias, y ahí entra
 * `retencion`: una sección puede avisar que se está por perder algo y la barra pregunta antes
 * de cambiar. Ver `Retencion` en `Administracion.tsx`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Building2,
  CircleCheck,
  ChevronDown,
  Copy,
  KeyRound,
  Plus,
  Save,
  Settings,
  SlidersHorizontal,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useAuth } from "../lib/authStore";
import { useSettings, type CatalogLink, type Role, type SonidoVenta } from "../lib/settingsStore";
import { playSaleSound } from "../lib/sound";
import { SeccionConfiguracion, SeccionEmpresas, SeccionUsuarios, type Retencion } from "./Administracion";
import {
  fetchComisiones,
  fetchUsuariosAdmin,
  guardarComision,
  type Rol,
  type TramoComision,
  type UsuarioAdmin,
} from "../lib/api";

const money = (n: number) => `$${n.toLocaleString("es-AR")}`;

const SONIDOS: { key: SonidoVenta; label: string }[] = [
  { key: "caja", label: "Caja registradora 💰" },
  { key: "aplausos", label: "Aplausos 👏" },
  { key: "silencio", label: "Silencio 🔇" },
];

/* ------------------------------------------------------------------ */
/* Catálogo de Enlaces — modal de alta/edición                         */
/* ------------------------------------------------------------------ */

interface CatalogFormState {
  etiqueta: string;
  categoria: string;
  url: string;
  procesador: string;
  monto: string;
  closer: boolean;
  setter: boolean;
}

const EMPTY_FORM: CatalogFormState = { etiqueta: "", categoria: "", url: "", procesador: "", monto: "", closer: false, setter: false };

function linkToForm(link: CatalogLink): CatalogFormState {
  return {
    etiqueta: link.etiqueta,
    categoria: link.categoria,
    url: link.url,
    procesador: link.procesador,
    monto: link.monto ? String(link.monto) : "",
    closer: link.scope.includes("closer"),
    setter: link.scope.includes("setter"),
  };
}

function CatalogModal({
  initial,
  categorias,
  onAddCategoria,
  onClose,
  onSave,
}: {
  initial: CatalogFormState;
  categorias: string[];
  onAddCategoria: (nombre: string) => void;
  onClose: () => void;
  onSave: (form: CatalogFormState) => void;
}) {
  const [form, setForm] = useState<CatalogFormState>(initial);
  const [creatingCategoria, setCreatingCategoria] = useState(false);
  const [nuevaCategoria, setNuevaCategoria] = useState("");

  const patch = (p: Partial<CatalogFormState>) => setForm((f) => ({ ...f, ...p }));

  const toggleTodos = (checked: boolean) => patch({ closer: checked, setter: checked });

  const confirmarCategoria = () => {
    const nombre = nuevaCategoria.trim();
    if (!nombre) return;
    onAddCategoria(nombre);
    patch({ categoria: nombre });
    setNuevaCategoria("");
    setCreatingCategoria(false);
  };

  const canSave = form.etiqueta.trim() && form.categoria.trim() && form.url.trim() && form.procesador.trim() && (form.closer || form.setter);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 animate-in fade-in duration-150">
      <div className="w-full max-w-md rounded-lg bg-card text-card-foreground border border-border/50 shadow-xl animate-in zoom-in-95 fade-in duration-150">
        <div className="flex items-center justify-between p-5 border-b border-border/50">
          <h3 className="font-semibold text-base">{initial.etiqueta ? "Editar Enlace" : "Nuevo Enlace"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Etiqueta</label>
            <input
              value={form.etiqueta}
              onChange={(e) => patch({ etiqueta: e.target.value })}
              placeholder="Plan Anual"
              className="flex h-9 w-full rounded-md border border-input bg-background dark:bg-secondary px-3 py-2 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Categoría</label>
            {creatingCategoria ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={nuevaCategoria}
                  onChange={(e) => setNuevaCategoria(e.target.value)}
                  placeholder="Nombre de la categoría"
                  className="flex h-9 w-full rounded-md border border-input bg-background dark:bg-secondary px-3 py-2 text-sm"
                />
                <button onClick={confirmarCategoria} className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium shrink-0">
                  Crear
                </button>
              </div>
            ) : (
              <select
                value={form.categoria}
                onChange={(e) => {
                  if (e.target.value === "__nueva__") setCreatingCategoria(true);
                  else patch({ categoria: e.target.value });
                }}
                className="flex h-9 w-full rounded-md border border-input bg-background dark:bg-secondary px-3 py-2 text-sm"
              >
                <option value="" disabled>Selecciona una categoría</option>
                {categorias.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
                <option value="__nueva__">+ Crear nueva</option>
              </select>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">URL</label>
            <input
              value={form.url}
              onChange={(e) => patch({ url: e.target.value })}
              placeholder="https://..."
              className="flex h-9 w-full rounded-md border border-input bg-background dark:bg-secondary px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Procesador</label>
              <input
                value={form.procesador}
                onChange={(e) => patch({ procesador: e.target.value })}
                placeholder="Stripe"
                className="flex h-9 w-full rounded-md border border-input bg-background dark:bg-secondary px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Monto (opcional)</label>
              <input
                type="number"
                min={0}
                value={form.monto}
                onChange={(e) => patch({ monto: e.target.value })}
                placeholder="0"
                className="flex h-9 w-full rounded-md border border-input bg-background dark:bg-secondary px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Visible para</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.closer} onChange={(e) => patch({ closer: e.target.checked })} />
                Closers
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.setter} onChange={(e) => patch({ setter: e.target.checked })} />
                Setters
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.closer && form.setter} onChange={(e) => toggleTodos(e.target.checked)} />
                Todos
              </label>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 p-5 border-t border-border/50">
          <button onClick={onClose} className="h-9 px-4 rounded-md border border-input text-sm font-medium hover:bg-accent transition-colors">
            Cancelar
          </button>
          <button
            disabled={!canSave}
            onClick={() => onSave(form)}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 disabled:pointer-events-none hover:bg-primary/90 transition-colors"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

function CatalogRow({ link, onEdit, onDelete }: { link: CatalogLink; onEdit: () => void; onDelete: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const visible = link.scope.length === 2 ? ["todos"] : link.scope;
  return (
    <tr className="border-b transition-colors hover:bg-muted/50">
      <td className="p-4 align-middle font-medium">{link.etiqueta}</td>
      <td className="p-4 align-middle">
        <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold text-foreground text-[10px] bg-muted/50">
          {link.categoria}
        </div>
      </td>
      <td className="p-4 align-middle">{link.monto ? money(link.monto) : "—"}</td>
      <td className="p-4 align-middle">{link.procesador}</td>
      <td className="p-4 align-middle">
        <div className="flex gap-1">
          {visible.map((v) => (
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
        {confirmDelete ? (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">¿Eliminar?</span>
            <button onClick={onDelete} className="text-xs font-semibold text-rose-600 hover:text-rose-700">Sí</button>
            <button onClick={() => setConfirmDelete(false)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">No</button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1">
            <button onClick={onEdit} className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-accent transition-colors">
              <Settings className="w-4 h-4 text-muted-foreground" />
            </button>
            <button onClick={() => setConfirmDelete(true)} className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-accent transition-colors">
              <Trash2 className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}


/* ------------------------------------------------------------------ */
/* Vista principal                                                     */
/* ------------------------------------------------------------------ */

/**
 * Las pestañas. `soloSuper` es cosmética —la protección es el 403 de `/api/admin/empresas`—
 * pero evita mostrar una pestaña que va a rebotar entera.
 */
const PESTANAS = [
  { key: "cuenta", label: "Mi cuenta", icon: User },
  { key: "operacion", label: "Operación", icon: SlidersHorizontal, soloAdmin: true },
  { key: "credenciales", label: "Credenciales", icon: KeyRound, soloAdmin: true },
  { key: "empresas", label: "Empresas", icon: Building2, soloAdmin: true, soloSuper: true },
  // Usuarios va a la derecha de Empresas (pedido de Fabio, 2026-08-10). Para un admin no-super,
  // Empresas se filtra y Usuarios queda último igual — el filtro preserva este orden.
  { key: "usuarios", label: "Usuarios", icon: Users, soloAdmin: true },
] as const;

type Pestana = (typeof PESTANAS)[number]["key"];

/** Las dos que editan el store de ajustes: son las únicas que usan el botón "Guardar Cambios". */
const PESTANAS_DE_AJUSTES = new Set<Pestana>(["cuenta", "operacion"]);

export default function Ajustes({ role = "admin" }: { role?: string }) {
  const {
    miCuenta, setMiCuenta,
    catalog, addCatalogLink, updateCatalogLink, removeCatalogLink,
    categorias, addCategoria,
    gerencia, setGerencia,
    hasUnsavedChanges, saveSettings,
  } = useSettings();

  const { usuario } = useAuth();
  const esSuper = Boolean(usuario?.esSuperAdmin);
  /**
   * Qué pestañas existen para quien está mirando.
   *
   * `soloAdmin` es redundante hoy —la entrada de Ajustes en `NAV` ya exige `admin`, así que
   * nadie sin ese rol llega hasta acá— y se deja igual. El módulo de administración tenía su
   * propio `if (!tieneRol("admin"))` antes de mudarse a esta vista, y perderlo en la mudanza
   * habría dejado la protección colgando de una sola línea en otro archivo. Sigue siendo
   * cosmética: la de verdad es el 403 de `api/admin/*`.
   */
  const pestanas = PESTANAS.filter(
    (p) => (!("soloSuper" in p && p.soloSuper) || esSuper) && (!("soloAdmin" in p && p.soloAdmin) || role === "admin"),
  );

  const [pestana, setPestana] = useState<Pestana>("cuenta");

  /**
   * Lo que la pestaña abierta pide preguntar antes de irse. Vive en un ref y no en estado
   * porque cambia en cada render de la sección y no tiene que provocar uno nuevo acá: es un
   * buzón que la barra de pestañas consulta al hacer clic, no algo que se renderice.
   */
  const retencion = useRef<() => string | null>(() => null);
  const registrar: Retencion = (motivo) => {
    retencion.current = motivo;
  };

  const irA = (destino: Pestana) => {
    if (destino === pestana) return;

    /**
     * Dos retenciones distintas y las dos hacen falta.
     *
     * La primera es la de la sección abierta —una contraseña temporal, una credencial a medio
     * escribir— y la segunda es la del store de ajustes: como la barra de "Guardar Cambios"
     * solo se muestra en las pestañas que lo editan, irse a Usuarios con una comisión cambiada
     * escondía el aviso Y el único botón para guardarla, sin decir nada.
     */
    const motivo =
      retencion.current() ??
      (hasUnsavedChanges && !PESTANAS_DE_AJUSTES.has(destino)
        ? "Tenés cambios sin guardar en Ajustes y esta pestaña es la única que los guarda. ¿Cambiar igual?"
        : null);
    if (motivo && !confirm(motivo)) return;

    // Se limpia acá y no en el desmontaje de la sección: el orden entre el clic y el efecto de
    // limpieza no está garantizado, y una retención vieja bloquearía la pestaña siguiente.
    retencion.current = () => null;
    setPestana(destino);
  };

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [metaInput, setMetaInput] = useState(String(miCuenta.metaComision));
  const [objetivoInput, setObjetivoInput] = useState(String(gerencia.objetivoFacturacion));

  /**
   * ── Las filas de comisiones salen de los USUARIOS (2026-08-07) ────────
   *
   * Antes salían de un mapa semilla del store: `{"Jorge Q.": 10, "Ariel C.": 12}`. "Ariel C." no
   * fue nunca un usuario —era un ejemplo hardcodeado— y se veía exactamente igual que un dato
   * real, en la tabla desde la que se calculan comisiones. Y una empresa nueva heredaba las dos.
   *
   * Ahora la tabla la arman los usuarios activos de ESTA empresa con rol `closer` (o `setter`), y
   * el mapa del store guarda solo el porcentaje que alguien fijó. Sin porcentaje, el campo va
   * vacío: un 10% de arranque es un número inventado sobre el que después se paga plata.
   *
   * `fetchUsuariosAdmin` alcanza porque esta pestaña ya es admin-only — la pide `soloAdmin` arriba
   * y la refuerza el 403 de `api/admin/*`.
   */
  const [equipo, setEquipo] = useState<UsuarioAdmin[] | null>(null);
  /**
   * ── Los porcentajes salen de la BASE (2026-08-08) ──────────────────
   *
   * Vivían en `settingsStore` → `localStorage`, o sea por navegador: dos admins de la misma
   * empresa veían números distintos del mismo closer y ninguno estaba equivocado. Ese número
   * multiplica plata cobrada.
   *
   * Y estaban indexados por **nombre**, así que renombrar a alguien le borraba su comisión en
   * silencio. Ahora la clave es `usuario_id` y renombrar es renombrar.
   */
  const [comisionesBase, setComisionesBase] = useState<Record<string, Partial<Record<TramoComision, number>>>>({});

  const cargarOperacion = useCallback(async () => {
    const [us, cs] = await Promise.all([fetchUsuariosAdmin(), fetchComisiones()]);
    setEquipo(us.ok ? (us.usuarios ?? []) : []);
    setComisionesBase(cs.ok ? (cs.comisiones ?? {}) : {});
  }, []);

  useEffect(() => {
    if (pestana !== "operacion") return;
    void cargarOperacion();
  }, [pestana, cargarOperacion]);

  /**
   * Las filas son los usuarios, con su id — no su nombre. El `%` se busca por id contra lo que
   * devolvió la base, así que dos personas homónimas dejan de pisarse.
   */
  const conRol = (rol: Rol) => (equipo ?? []).filter((u) => u.activo && u.roles.includes(rol));
  const closers = conRol("closer");
  const setters = conRol("setter");

  /** Guarda y recarga: el servidor confirma, la pantalla no adivina. */
  const fijarComision = async (usuarioId: string, tipo: TramoComision, valor: string) => {
    const pct = valor.trim() === "" ? null : Number(valor);
    if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) return;
    await guardarComision(usuarioId, tipo, pct);
    await cargarOperacion();
  };
  const [savedToast, setSavedToast] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  const copyLinkPersonal = async () => {
    try {
      await navigator.clipboard.writeText(miCuenta.linkPersonal);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // Clipboard no disponible (permiso denegado/contexto no seguro) — falla en silencio, no es crítico para el demo.
    }
  };

  const commitMeta = () => {
    const n = Number(metaInput);
    if (Number.isFinite(n) && n > 0) setMiCuenta({ metaComision: n });
    else setMetaInput(String(miCuenta.metaComision));
  };

  const commitObjetivo = () => {
    const n = Number(objetivoInput);
    if (Number.isFinite(n) && n >= 0) setGerencia({ objetivoFacturacion: n });
    else setObjetivoInput(String(gerencia.objetivoFacturacion));
  };

  const handleSave = () => {
    saveSettings();
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2400);
  };

  const openNuevo = () => { setEditingId(null); setModalOpen(true); };
  const openEditar = (id: string) => { setEditingId(id); setModalOpen(true); };

  const editingLink = editingId ? catalog.find((l) => l.id === editingId) ?? null : null;

  const saveCatalog = (form: CatalogFormState) => {
    const scope: Role[] = [...(form.closer ? (["closer"] as Role[]) : []), ...(form.setter ? (["setter"] as Role[]) : [])];
    const link: Omit<CatalogLink, "id"> = {
      etiqueta: form.etiqueta.trim(),
      categoria: form.categoria.trim(),
      url: form.url.trim(),
      procesador: form.procesador.trim(),
      monto: form.monto ? Number(form.monto) : undefined,
      scope,
    };
    if (editingId) updateCatalogLink(editingId, link);
    else addCatalogLink(link);
    setModalOpen(false);
  };

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin bg-background">
      <div className="p-6 max-w-5xl mx-auto space-y-8 mt-4 pr-14 lg:pr-6">
        {/* Barra de pestañas — mismo lenguaje de píldoras que Closer y Setter. */}
        <div className="flex items-center gap-1.5 bg-card border border-border/40 rounded-full p-1.5 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.05)] w-fit max-w-full overflow-x-auto">
          {pestanas.map(({ key, label, icon: Icon }) => {
            const activa = pestana === key;
            return (
              <button
                key={key}
                onClick={() => irA(key)}
                className={cn(
                  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 h-9 text-xs font-medium transition-all shrink-0",
                  activa
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            );
          })}
        </div>

        {/* MI CUENTA */}
        {pestana === "cuenta" && (
        <section className="space-y-4">
          <h2 className="text-sm font-bold tracking-[0.2em] text-muted-foreground uppercase">Mi Cuenta</h2>
          <div className="rounded-lg bg-card text-card-foreground border border-border/50 shadow-sm">
            <div className="p-6 space-y-6">
              {role === "closer" && (
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Mi meta del mes</label>
                  <div className="relative max-w-xs">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                    <input
                      type="number"
                      min={0}
                      value={metaInput}
                      onChange={(e) => setMetaInput(e.target.value)}
                      onBlur={commitMeta}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      className="flex h-10 w-full rounded-md border border-input px-3 py-2 pl-7 text-sm bg-background dark:bg-secondary"
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Alimenta el anillo de comisión de tu Inicio.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Conectar Calendario</label>
                <div className="flex items-center gap-4">
                  <div className="flex-1 max-w-xs">
                    {miCuenta.calendarConectado ? (
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
                    onClick={() => setMiCuenta({ calendarConectado: !miCuenta.calendarConectado })}
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background dark:bg-secondary hover:bg-accent hover:text-accent-foreground h-9 rounded-md px-3"
                  >
                    {miCuenta.calendarConectado ? "Desconectar" : "Conectar"}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Mi enlace de agendamiento</label>
                <div className="flex items-center gap-2 max-w-sm">
                  <input
                    value={miCuenta.linkPersonal}
                    onChange={(e) => setMiCuenta({ linkPersonal: e.target.value })}
                    placeholder="https://calendly.com/mi-link"
                    className="flex h-10 w-full rounded-md border border-input px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm bg-background dark:bg-secondary"
                  />
                  <button
                    type="button"
                    onClick={copyLinkPersonal}
                    title="Copiar enlace"
                    className="inline-flex items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 border border-input bg-background dark:bg-secondary hover:bg-accent hover:text-accent-foreground h-10 px-3 rounded-md shrink-0"
                  >
                    {linkCopied ? <CircleCheck className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Tu enlace personal que aparece en el menú + del chat.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Sonido de Venta</label>
                <div className="flex gap-2 max-w-sm">
                  {SONIDOS.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => { setMiCuenta({ sonidoVenta: s.key }); playSaleSound(s.key); }}
                      className={cn(
                        "flex-1 min-h-10 py-2 rounded-md border px-2 text-xs font-medium leading-tight text-center whitespace-nowrap transition-colors",
                        miCuenta.sonidoVenta === s.key
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-input bg-background dark:bg-secondary hover:bg-accent",
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
        )}

        {/*
          OPERACIÓN — lo que era la sección "Administración" de esta misma vista.
          Se renombró porque el nombre ahora lo usa otra cosa (las tres pestañas de §7) y tener
          dos "Administración" en la misma pantalla no ayudaba a nadie. Lo de acá es cómo opera
          el equipo: enlaces de cobro, comisiones, parámetros del panel.
        */}
        {pestana === "operacion" && role === "admin" && (
          <section className="space-y-4">
            <h2 className="text-sm font-bold tracking-[0.2em] text-muted-foreground uppercase">Operación del equipo</h2>
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
                        {catalog.map((link) => (
                          <CatalogRow
                            key={link.id}
                            link={link}
                            onEdit={() => openEditar(link.id)}
                            onDelete={() => removeCatalogLink(link.id)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="p-4 border-t border-border/50">
                    <button
                      onClick={openNuevo}
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors border border-input bg-background dark:bg-secondary hover:bg-accent hover:text-accent-foreground h-9 rounded-md px-3 w-full border-dashed"
                    >
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
                        {closers.length === 0 && (
                          <tr>
                            <td colSpan={2} className="p-4 text-sm text-muted-foreground">
                              {/* Los tres estados se distinguen: cargando, cargado y vacío, error. */}
                              {equipo === null ? "Cargando el equipo…" : "Esta empresa no tiene ningún usuario con rol Closer."}
                            </td>
                          </tr>
                        )}
                        {closers.map((u) => (
                          <tr key={u.id} className="border-b transition-colors hover:bg-muted/50">
                            <td className="p-4 align-middle font-medium">{u.nombre}</td>
                            <td className="p-4 align-middle">
                              <div className="flex items-center gap-2 max-w-[100px]">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  /* Sin porcentaje fijado va VACÍO, no en 0: un 0% afirma que no cobra comisión. */
                                  defaultValue={comisionesBase[u.id]?.closer ?? ""}
                                  placeholder="—"
                                  /* `onBlur` y no `onChange`: cada tecla sería un PUT. Se guarda al salir del campo. */
                                  onBlur={(e) => void fijarComision(u.id, "closer", e.target.value)}
                                  className="flex w-full rounded-md border border-input px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm h-8 bg-background dark:bg-secondary"
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

              {/* § correcciones dashboards (2026-07-11): comisión del Setter tiene 2 tramos — directa (LT que vende) y diferida (HT que cierra el closer sobre un lead que originó). Misma fórmula parametrizada que el closer. */}
              <div className="rounded-lg bg-card text-card-foreground border border-border/50 shadow-sm">
                <div className="flex flex-col space-y-1.5 p-6 pb-4 border-b border-border/50 bg-muted/10">
                  <h3 className="font-semibold tracking-tight text-lg">Comisiones por Setter</h3>
                  <p className="text-xs text-muted-foreground">Directa = vende Low-Ticket él mismo. Diferida = el closer cierra un lead que él originó/rescató.</p>
                </div>
                <div className="p-0">
                  <div className="relative w-full overflow-auto">
                    <table className="w-full caption-bottom text-sm">
                      <thead className="[&_tr]:border-b">
                        <tr className="border-b transition-colors hover:bg-muted/50">
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Setter</th>
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">% Directa (LT)</th>
                          <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">% Diferida</th>
                        </tr>
                      </thead>
                      <tbody className="[&_tr:last-child]:border-0">
                        {setters.length === 0 && (
                          <tr>
                            <td colSpan={3} className="p-4 text-sm text-muted-foreground">
                              {equipo === null ? "Cargando el equipo…" : "Esta empresa no tiene ningún usuario con rol Setter."}
                            </td>
                          </tr>
                        )}
                        {setters.map((u) => (
                          <tr key={u.id} className="border-b transition-colors hover:bg-muted/50">
                            <td className="p-4 align-middle font-medium">{u.nombre}</td>
                            <td className="p-4 align-middle">
                              <div className="flex items-center gap-2 max-w-[100px]">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  defaultValue={comisionesBase[u.id]?.setter_lt ?? ""}
                                  placeholder="—"
                                  onBlur={(e) => void fijarComision(u.id, "setter_lt", e.target.value)}
                                  className="flex w-full rounded-md border border-input px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm h-8 bg-background dark:bg-secondary"
                                />
                                <span className="text-sm text-muted-foreground">%</span>
                              </div>
                            </td>
                            <td className="p-4 align-middle">
                              <div className="flex items-center gap-2 max-w-[100px]">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  defaultValue={comisionesBase[u.id]?.setter_diferida ?? ""}
                                  placeholder="—"
                                  onBlur={(e) => void fijarComision(u.id, "setter_diferida", e.target.value)}
                                  className="flex w-full rounded-md border border-input px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:text-sm h-8 bg-background dark:bg-secondary"
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

              {/* § Estadísticas (2026-07-13, renombrado el 2026-08-07) — los 2 únicos parámetros que ese panel lee de Ajustes, además de las comisiones de arriba. */}
              <div className="rounded-lg bg-card text-card-foreground border border-border/50 shadow-sm">
                <div className="flex flex-col space-y-1.5 p-6 pb-4 border-b border-border/50 bg-muted/10">
                  <h3 className="font-semibold tracking-tight text-lg">Parámetros de Estadísticas</h3>
                  <p className="text-xs text-muted-foreground">La meta de facturación del panel de Estadísticas.</p>
                </div>
                {/*
                  "Inversión Meta Ads" se fue de acá el 2026-08-07.
                  Era un campo manual con semilla 3000 que **nadie leía**: Estadísticas mandaba el
                  ROAS, el CAC, el CPL y el CPA en `null` con el motivo "sin integración con Meta".
                  Ahora el gasto sale de `closer_meta_metricas`, que llena el cron diario por
                  empresa. Dejar el campo habría sido dejar una perilla que no mueve nada — y peor,
                  una segunda fuente para el mismo hecho, que es la regla 3 de CLAUDE.md.
                  Si una empresa no tiene Meta conectado, los cuatro indicadores siguen viajando
                  `null` y el panel no los renderiza. No hay número inventado en ninguna punta.
                */}
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium leading-none">Objetivo de facturación (mensual)</label>
                    <div className="relative max-w-xs">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <input
                        type="number"
                        min={0}
                        value={objetivoInput}
                        onChange={(e) => setObjetivoInput(e.target.value)}
                        onBlur={commitObjetivo}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                        className="flex h-10 w-full rounded-md border border-input px-3 py-2 pl-7 text-sm bg-background dark:bg-secondary"
                      />
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </section>
        )}

        {/* Las tres de §7. Viven en Administracion.tsx; acá solo se eligen. */}
        {pestana === "usuarios" && role === "admin" && <SeccionUsuarios esSuper={esSuper} registrar={registrar} />}
        {pestana === "credenciales" && role === "admin" && <SeccionConfiguracion registrar={registrar} />}
        {/* Doble condición: la pestaña elegida y el rol. Si alguien fuerza el estado, igual no
            se monta — y si se montara, el backend contesta 403 por partida doble. */}
        {pestana === "empresas" && esSuper && <SeccionEmpresas />}
      </div>

      {/*
        La barra de guardado es del store de ajustes, así que solo aparece en las pestañas que
        lo editan. En Credenciales habría dos botones de guardar con la misma pinta y semántica
        distinta —uno escribe localStorage, el otro rota un secreto en la base— y esa confusión
        se paga cara.
      */}
      {PESTANAS_DE_AJUSTES.has(pestana) && hasUnsavedChanges && (
        <div className="sticky bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-sm px-6 py-4">
          <div className="max-w-5xl mx-auto pr-14 lg:pr-6 flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
              Tenés cambios sin guardar — se perderán si recargás la página.
            </span>
            <button
              onClick={handleSave}
              className="inline-flex items-center gap-2 whitespace-nowrap text-sm font-semibold transition-colors bg-primary text-primary-foreground hover:bg-primary/90 h-10 rounded-md px-5 shrink-0"
            >
              <Save className="w-4 h-4" /> Guardar Cambios
            </button>
          </div>
        </div>
      )}

      {savedToast && (
        <div className="fixed top-6 right-6 z-[80] animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="flex items-center gap-3 bg-popover text-popover-foreground border border-border shadow-lg rounded-xl px-4 py-3">
            <div className="h-8 w-8 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <CircleCheck className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium leading-snug">Cambios guardados</span>
          </div>
        </div>
      )}

      {modalOpen && (
        <CatalogModal
          initial={editingLink ? linkToForm(editingLink) : EMPTY_FORM}
          categorias={categorias}
          onAddCategoria={addCategoria}
          onClose={() => setModalOpen(false)}
          onSave={saveCatalog}
        />
      )}
    </div>
  );
}
