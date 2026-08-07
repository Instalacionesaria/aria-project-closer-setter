/**
 * El módulo Administración (ESPEC-MULTIEMPRESA §7).
 *
 * Tres secciones detrás de la misma pestaña: **Empresas** (solo el super admin), **Usuarios** y
 * **Configuración**. Van juntas porque son el mismo trabajo —dar de alta un cliente— y
 * separarlas en tres entradas del sidebar obligaría a saber cuál de las tres abrir.
 *
 * ── Nada de lo que hay acá protege nada ───────────────────────────────
 *
 * Los botones que no se muestran, las secciones que no aparecen y los roles que no están en el
 * selector son **cosmética** (§3.2). La protección real es el `exigir()` del backend, que
 * corre igual aunque alguien edite este archivo desde la consola. Acá se esconde lo que va a
 * rebotar con 403, no lo que no debe pasar.
 *
 * ── Las contraseñas temporales se muestran una vez ────────────────────
 *
 * Cuando el backend devuelve una, queda en un cartel que hay que cerrar a mano. No se guarda en
 * estado que sobreviva a la navegación, no se relee, no está en ningún GET: si se cierra sin
 * copiarla, se regenera. Es incómodo a propósito.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  Check,
  Copy,
  Eye,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useAuth } from "../lib/authStore";
import {
  crearEmpresa,
  crearUsuario,
  desactivarEmpresa,
  editarEmpresa,
  editarUsuario,
  eliminarUsuario,
  fetchConfiguracion,
  fetchEmpresas,
  fetchUsuariosAdmin,
  guardarConfiguracion,
  regenerarPassword,
  type ConfiguracionResponse,
  type EmpresaAdmin,
  type Rol,
  type UsuarioAdmin,
} from "../lib/api";

type Seccion = "empresas" | "usuarios" | "configuracion";

const ETIQUETA_ROL: Record<Rol, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  closer: "Closer",
  setter: "Setter",
  tecnico: "Técnico",
  media_buyer: "Media buyer",
};

/** Las que ofrece el selector al crear. Cualquier otra igual se acepta escribiéndola. */
const ZONAS = ["America/Lima", "America/Bogota", "America/Mexico_City", "America/Argentina/Buenos_Aires", "America/Santiago", "Europe/Madrid"];

export default function Administracion() {
  const { tieneRol, usuario } = useAuth();
  const esSuper = Boolean(usuario?.esSuperAdmin);

  // Un admin de empresa cliente no ve que existen otras empresas: ni la sección, ni la pestaña.
  const [seccion, setSeccion] = useState<Seccion>(esSuper ? "empresas" : "usuarios");

  const secciones: { key: Seccion; label: string; icon: typeof Building2 }[] = [
    ...(esSuper ? [{ key: "empresas" as const, label: "Empresas", icon: Building2 }] : []),
    { key: "usuarios", label: "Usuarios", icon: Users },
    { key: "configuracion", label: "Configuración", icon: KeyRound },
  ];

  if (!tieneRol("admin")) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Esta sección es solo para administradores.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-light tracking-tight">Administración</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {esSuper ? "Empresas, usuarios y credenciales de la plataforma." : "Los usuarios y la configuración de tu empresa."}
          </p>
        </div>

        <div className="flex gap-1 border-b border-border/40">
          {secciones.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setSeccion(key)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
                seccion === key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {seccion === "empresas" && esSuper && <SeccionEmpresas />}
        {seccion === "usuarios" && <SeccionUsuarios esSuper={esSuper} />}
        {seccion === "configuracion" && <SeccionConfiguracion />}
      </div>
    </div>
  );
}

/* ══════════════════════════════ Empresas (§7.1) ══════════════════════════════ */

function SeccionEmpresas() {
  const { empresa: empresaActiva, mirarEmpresa } = useAuth();
  const [empresas, setEmpresas] = useState<EmpresaAdmin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const r = await fetchEmpresas();
    if (!r.ok) return setError(r.error ?? "No se pudieron cargar las empresas.");
    setError(null);
    setEmpresas(r.empresas ?? []);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const alternarActiva = async (e: EmpresaAdmin) => {
    setTrabajando(e.id);
    const r = await editarEmpresa({ orgId: e.id, activa: !e.activa });
    setTrabajando(null);
    if (!r.ok) return setError(r.error ?? "No se pudo cambiar.");
    setError(null);
    await cargar();
  };

  const desactivar = async (e: EmpresaAdmin) => {
    if (!confirm(`¿Desactivar "${e.nombre}"? Sus usuarios no van a poder entrar. Los datos quedan.`)) return;
    setTrabajando(e.id);
    const r = await desactivarEmpresa(e.id);
    setTrabajando(null);
    if (!r.ok) return setError(r.error ?? "No se pudo desactivar.");
    setError(null);
    await cargar();
  };

  return (
    <div className="space-y-4">
      {error && <Aviso tono="error" texto={error} onCerrar={() => setError(null)} />}

      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">
          {empresas ? `${empresas.length} ${empresas.length === 1 ? "empresa" : "empresas"}` : ""}
        </span>
        <button
          onClick={() => setCreando(true)}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
        >
          <Plus className="w-3.5 h-3.5" />
          Nueva empresa
        </button>
      </div>

      {empresas === null ? (
        <Cargando />
      ) : (
        <div className="space-y-2">
          {empresas.map((e) => (
            <div
              key={e.id}
              className={cn(
                "rounded-lg border border-border/50 bg-card p-4 flex items-center gap-4",
                !e.activa && "opacity-60",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{e.nombre}</span>
                  {e.esPrincipal && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                      Principal
                    </span>
                  )}
                  {!e.activa && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      Desactivada
                    </span>
                  )}
                  {empresaActiva?.id === e.id && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      Estás acá
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  <span>/{e.slug}</span>
                  <span>{e.usuarios === 1 ? "1 usuario" : `${e.usuarios} usuarios`}</span>
                  <span>{e.zonaHoraria}</span>
                  {/* Sin subcuenta de GHL la empresa no puede operar: se dice, no se omite. */}
                  {e.ghlLocationId ? <span>GHL {e.ghlLocationId}</span> : <span className="text-amber-600 dark:text-amber-400">Sin GHL</span>}
                  {/* §4.1: un `0%` medido y uno no medido no son el mismo hecho. Acá igual: */}
                  {e.ultimoAcceso ? <span>Último acceso {fecha(e.ultimoAcceso)}</span> : <span className="opacity-60">Nadie entró todavía</span>}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {empresaActiva?.id !== e.id && (
                  <button
                    onClick={() => void mirarEmpresa(e.id)}
                    title="Ver los datos de esta empresa"
                    className="h-8 px-2.5 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground inline-flex items-center gap-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    Ver
                  </button>
                )}
                {/* La principal no se toca: el trigger de la 018 lo impide y el botón tampoco está. */}
                {!e.esPrincipal &&
                  (e.activa ? (
                    <button
                      onClick={() => void desactivar(e)}
                      disabled={trabajando === e.id}
                      title="Desactivar"
                      className="h-8 w-8 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex items-center justify-center disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => void alternarActiva(e)}
                      disabled={trabajando === e.id}
                      className="h-8 px-2.5 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                    >
                      Reactivar
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {creando && (
        <ModalEmpresa
          onCerrar={() => setCreando(false)}
          onCreada={async () => {
            setCreando(false);
            await cargar();
          }}
        />
      )}
    </div>
  );
}

function ModalEmpresa({ onCerrar, onCreada }: { onCerrar: () => void; onCreada: () => void }) {
  const [nombre, setNombre] = useState("");
  const [slug, setSlug] = useState("");
  const [zona, setZona] = useState(ZONAS[0]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  /**
   * El slug se propone desde el nombre pero deja de seguirlo apenas alguien lo edita: es parte
   * de la URL y de los índices únicos, así que pisarlo con cada tecla del nombre sería peor
   * que no proponerlo.
   */
  const [slugTocado, setSlugTocado] = useState(false);

  const alNombre = (v: string) => {
    setNombre(v);
    if (!slugTocado) setSlug(aSlug(v));
  };

  const guardar = async () => {
    setGuardando(true);
    const r = await crearEmpresa({ nombre: nombre.trim(), slug: slug.trim(), zonaHoraria: zona });
    setGuardando(false);
    if (!r.ok) return setError(r.error ?? "No se pudo crear.");
    onCreada();
  };

  const puede = nombre.trim().length > 0 && /^[a-z0-9-]{2,40}$/.test(slug);

  return (
    <Modal titulo="Nueva empresa" onCerrar={onCerrar}>
      <div className="space-y-4">
        {error && <Aviso tono="error" texto={error} />}
        <Campo etiqueta="Nombre">
          <input value={nombre} onChange={(e) => alNombre(e.target.value)} placeholder="Consultora Ejemplo" className={INPUT} />
        </Campo>
        <Campo etiqueta="Identificador" ayuda="Minúsculas, sin espacios ni acentos. No se puede cambiar después.">
          <input
            value={slug}
            onChange={(e) => {
              setSlugTocado(true);
              setSlug(e.target.value.toLowerCase());
            }}
            placeholder="consultora-ejemplo"
            className={INPUT}
          />
        </Campo>
        <Campo etiqueta="Zona horaria" ayuda="Define qué es 'hoy' para los seguimientos de esta empresa.">
          <select value={zona} onChange={(e) => setZona(e.target.value)} className={INPUT}>
            {ZONAS.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </Campo>

        <p className="text-xs text-muted-foreground border-l-2 border-border pl-3">
          Nace activa pero <strong>sin credenciales</strong>: no va a poder hablar con GHL hasta que cargues su token en
          Configuración. Es a propósito — una empresa a medio configurar no debe operar con las credenciales de otra.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCerrar} className="h-9 px-3 rounded-md text-sm text-muted-foreground hover:bg-accent">
            Cancelar
          </button>
          <button
            onClick={() => void guardar()}
            disabled={!puede || guardando}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 inline-flex items-center gap-2"
          >
            {guardando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Crear
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ══════════════════════════════ Usuarios (§7.2) ══════════════════════════════ */

function SeccionUsuarios({ esSuper }: { esSuper: boolean }) {
  const { empresa: empresaActiva } = useAuth();
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[] | null>(null);
  const [rolesOtorgables, setRolesOtorgables] = useState<Rol[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaAdmin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<UsuarioAdmin | null>(null);
  const [temporal, setTemporal] = useState<{ email: string; password: string; aviso: string } | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const r = await fetchUsuariosAdmin();
    if (!r.ok) return setError(r.error ?? "No se pudieron cargar los usuarios.");
    setError(null);
    setUsuarios(r.usuarios ?? []);
    setRolesOtorgables(r.rolesQuePuedeOtorgar ?? []);
  }, []);

  useEffect(() => {
    void cargar();
    // El super admin necesita los nombres de las empresas para agrupar y para elegir destino.
    if (esSuper) void fetchEmpresas().then((r) => setEmpresas(r.empresas ?? []));
  }, [cargar, esSuper]);

  const nombreEmpresa = useMemo(() => new Map(empresas.map((e) => [e.id, e.nombre])), [empresas]);

  const regenerar = async (u: UsuarioAdmin) => {
    if (!confirm(`¿Generar una contraseña temporal para ${u.nombre}? Se le cierran todas las sesiones.`)) return;
    setTrabajando(u.id);
    const r = await regenerarPassword(u.id);
    setTrabajando(null);
    if (!r.ok || !r.passwordTemporal) return setError(r.error ?? "No se pudo regenerar.");
    setError(null);
    setTemporal({ email: u.email ?? u.nombre, password: r.passwordTemporal, aviso: r.aviso ?? "" });
    await cargar();
  };

  const alternarActivo = async (u: UsuarioAdmin) => {
    setTrabajando(u.id);
    const r = await editarUsuario({ id: u.id, activo: !u.activo });
    setTrabajando(null);
    if (!r.ok) return setError(r.error ?? "No se pudo cambiar.");
    setError(null);
    await cargar();
  };

  const eliminar = async (u: UsuarioAdmin) => {
    if (!confirm(`¿Borrar a ${u.nombre}? Si tiene trabajo registrado, se va a rechazar.`)) return;
    setTrabajando(u.id);
    const r = await eliminarUsuario(u.id);
    setTrabajando(null);
    // El 409 con `tiene_historial` no es una falla: es la respuesta correcta y dice qué hacer.
    if (!r.ok) return setError(r.error ?? "No se pudo borrar.");
    setError(null);
    await cargar();
  };

  return (
    <div className="space-y-4">
      {error && <Aviso tono="error" texto={error} onCerrar={() => setError(null)} />}
      {temporal && <CartelPassword datos={temporal} onCerrar={() => setTemporal(null)} />}

      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">
          {usuarios ? `${usuarios.length} ${usuarios.length === 1 ? "usuario" : "usuarios"}` : ""}
        </span>
        <button
          onClick={() => setCreando(true)}
          className="inline-flex items-center gap-2 h-9 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90"
        >
          <Plus className="w-3.5 h-3.5" />
          Nuevo usuario
        </button>
      </div>

      {usuarios === null ? (
        <Cargando />
      ) : (
        <div className="space-y-2">
          {usuarios.map((u) => (
            <div key={u.id} className={cn("rounded-lg border border-border/50 bg-card p-4 flex items-center gap-4", !u.activo && "opacity-60")}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm truncate">{u.nombre}</span>
                  {u.esAdminPrincipal && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                      Admin principal
                    </span>
                  )}
                  {!u.activo && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      Inactivo
                    </span>
                  )}
                  {u.bloqueado && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                      Bloqueado
                    </span>
                  )}
                  {u.debeCambiarPassword && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                      Contraseña temporal
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  <span>{u.email ?? "sin email"}</span>
                  <span>{u.roles.map((r) => ETIQUETA_ROL[r] ?? r).join(" · ") || "sin rol"}</span>
                  {esSuper && <span>{nombreEmpresa.get(u.orgId) ?? "—"}</span>}
                  {u.ultimoAcceso ? <span>Entró {fecha(u.ultimoAcceso)}</span> : <span className="opacity-60">Nunca entró</span>}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setEditando(u)}
                  className="h-8 px-2.5 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  Editar
                </button>
                <button
                  onClick={() => void regenerar(u)}
                  disabled={trabajando === u.id}
                  title="Generar contraseña temporal"
                  className="h-8 w-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground inline-flex items-center justify-center disabled:opacity-40"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                {/* Al admin principal no se le esconde el botón de regenerar —su contraseña sí se
                    puede cambiar— pero desactivarlo y borrarlo los impide un trigger. */}
                {!u.esAdminPrincipal && (
                  <>
                    <button
                      onClick={() => void alternarActivo(u)}
                      disabled={trabajando === u.id}
                      className="h-8 px-2.5 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                    >
                      {u.activo ? "Desactivar" : "Activar"}
                    </button>
                    <button
                      onClick={() => void eliminar(u)}
                      disabled={trabajando === u.id}
                      title="Borrar"
                      className="h-8 w-8 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive inline-flex items-center justify-center disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {(creando || editando) && (
        <ModalUsuario
          usuario={editando}
          rolesOtorgables={rolesOtorgables}
          empresas={esSuper ? empresas.filter((e) => e.activa) : []}
          empresaPorDefecto={empresaActiva?.id ?? null}
          onCerrar={() => {
            setCreando(false);
            setEditando(null);
          }}
          onListo={async (nueva) => {
            setCreando(false);
            setEditando(null);
            if (nueva) setTemporal(nueva);
            await cargar();
          }}
        />
      )}
    </div>
  );
}

function ModalUsuario({
  usuario,
  rolesOtorgables,
  empresas,
  empresaPorDefecto,
  onCerrar,
  onListo,
}: {
  usuario: UsuarioAdmin | null;
  rolesOtorgables: Rol[];
  empresas: EmpresaAdmin[];
  /** La empresa que el super admin está mirando. Crear en otra tiene que ser una decisión. */
  empresaPorDefecto: string | null;
  onCerrar: () => void;
  onListo: (temporal: { email: string; password: string; aviso: string } | null) => void;
}) {
  const [nombre, setNombre] = useState(usuario?.nombre ?? "");
  const [email, setEmail] = useState(usuario?.email ?? "");
  const [roles, setRoles] = useState<Rol[]>(usuario?.roles ?? []);
  const [orgId, setOrgId] = useState(usuario?.orgId ?? empresaPorDefecto ?? empresas[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const alternarRol = (r: Rol) => setRoles((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]));

  const guardar = async () => {
    setGuardando(true);
    if (usuario) {
      const r = await editarUsuario({ id: usuario.id, nombre: nombre.trim(), roles });
      setGuardando(false);
      if (!r.ok) return setError(r.error ?? "No se pudo guardar.");
      return onListo(null);
    }
    const r = await crearUsuario({
      nombre: nombre.trim(),
      email: email.trim(),
      roles,
      ...(empresas.length > 0 ? { orgId } : {}),
    });
    setGuardando(false);
    if (!r.ok || !r.passwordTemporal) return setError(r.error ?? "No se pudo crear.");
    onListo({ email: email.trim(), password: r.passwordTemporal, aviso: r.aviso ?? "" });
  };

  const puede = nombre.trim().length > 0 && roles.length > 0 && (usuario !== null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));

  return (
    <Modal titulo={usuario ? `Editar a ${usuario.nombre}` : "Nuevo usuario"} onCerrar={onCerrar}>
      <div className="space-y-4">
        {error && <Aviso tono="error" texto={error} />}

        <Campo etiqueta="Nombre">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={INPUT} />
        </Campo>

        {usuario ? (
          // El email es la identidad con la que entra: cambiarlo sería otra cuenta. Se muestra
          // pero no se edita, así queda claro que no es un olvido.
          <Campo etiqueta="Email">
            <div className="h-9 flex items-center px-3 rounded-md bg-muted/40 text-sm text-muted-foreground">{usuario.email ?? "—"}</div>
          </Campo>
        ) : (
          <Campo etiqueta="Email" ayuda="Con este entra. No se puede cambiar después.">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@empresa.com" className={INPUT} />
          </Campo>
        )}

        {!usuario && empresas.length > 0 && (
          <Campo etiqueta="Empresa">
            <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className={INPUT}>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </Campo>
        )}

        <Campo etiqueta="Roles" ayuda="Hasta 4. El backend rechaza los que no podés otorgar.">
          <div className="flex flex-wrap gap-2">
            {/* La lista viene del backend: un admin común no ve `admin` ni `super_admin`. */}
            {rolesOtorgables.map((r) => (
              <button
                key={r}
                onClick={() => alternarRol(r)}
                className={cn(
                  "h-8 px-3 rounded-full text-xs font-medium border transition-colors",
                  roles.includes(r)
                    ? "bg-primary/10 border-primary/40 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                {ETIQUETA_ROL[r] ?? r}
              </button>
            ))}
          </div>
        </Campo>

        {usuario?.esAdminPrincipal && (
          <p className="text-xs text-muted-foreground border-l-2 border-amber-500/40 pl-3">
            Es el admin principal de su empresa: no se puede desactivar, borrar ni quitarle el rol de admin.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onCerrar} className="h-9 px-3 rounded-md text-sm text-muted-foreground hover:bg-accent">
            Cancelar
          </button>
          <button
            onClick={() => void guardar()}
            disabled={!puede || guardando}
            className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 inline-flex items-center gap-2"
          >
            {guardando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {usuario ? "Guardar" : "Crear"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * El cartel de la contraseña temporal.
 *
 * No se cierra solo ni al hacer clic afuera: si desaparece antes de que la copien, hay que
 * regenerarla y cerrarle las sesiones al usuario otra vez.
 */
function CartelPassword({
  datos,
  onCerrar,
}: {
  datos: { email: string; password: string; aviso: string };
  onCerrar: () => void;
}) {
  const [copiado, setCopiado] = useState(false);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(datos.password);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles no se dice "copiado": la contraseña está a la vista igual.
      setCopiado(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Contraseña temporal de {datos.email}
          </p>
          <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">{datos.aviso}</p>
        </div>
        <button onClick={onCerrar} className="text-amber-700 dark:text-amber-300 hover:opacity-70 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-sm bg-background/60 rounded px-3 py-2 select-all break-all">{datos.password}</code>
        <button
          onClick={() => void copiar()}
          className="h-9 px-3 rounded-md bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 inline-flex items-center gap-1.5 shrink-0"
        >
          {copiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copiado ? "Copiada" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════ Configuración (§7.3) ══════════════════════════ */

function SeccionConfiguracion() {
  const [datos, setDatos] = useState<ConfiguracionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  /** Solo lo que se editó en esta pantalla. Lo que no está acá, el backend no lo toca. */
  const [cambios, setCambios] = useState<Record<string, string>>({});
  const [borrar, setBorrar] = useState<string[]>([]);

  const cargar = useCallback(async () => {
    const r = await fetchConfiguracion();
    if (!r.ok) return setError(r.error ?? "No se pudo cargar la configuración.");
    setError(null);
    setDatos(r);
    setCambios({});
    setBorrar([]);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const guardar = async () => {
    setGuardando(true);
    const r = await guardarConfiguracion({ ...cambios, ...(borrar.length > 0 ? { borrar } : {}) });
    setGuardando(false);
    if (!r.ok) return setError(r.error ?? "No se pudo guardar.");
    setError(null);
    setGuardado(true);
    setTimeout(() => setGuardado(false), 2500);
    await cargar();
  };

  if (datos === null) return error ? <Aviso tono="error" texto={error} /> : <Cargando />;

  const hayCambios = Object.keys(cambios).length > 0 || borrar.length > 0;
  const editar = (clave: string, valor: string) => {
    setCambios((c) => ({ ...c, [clave]: valor }));
    // Editar una credencial que estaba marcada para borrar cancela el borrado: si no, el
    // borrado ganaría y el valor recién escrito se perdería sin decir nada.
    setBorrar((b) => b.filter((x) => x !== clave));
  };

  return (
    <div className="space-y-6">
      {error && <Aviso tono="error" texto={error} onCerrar={() => setError(null)} />}

      <div className="text-xs text-muted-foreground">
        Configurando <strong className="text-foreground">{datos.empresa?.nombre}</strong> · {datos.empresa?.zonaHoraria}
      </div>

      {datos.puedeGuardarCifrado === false && (
        <Aviso
          tono="error"
          texto="Falta CIFRADO_MASTER_KEY en el servidor: las credenciales cifradas no se pueden guardar hasta que exista."
        />
      )}

      {/* ── Credenciales ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Credenciales</h2>
        <p className="text-xs text-muted-foreground -mt-1">
          Se muestran enmascaradas. Dejá un campo vacío para no tocarlo; escribí uno nuevo para reemplazarlo.
        </p>
        <div className="space-y-3">
          {(datos.credenciales ?? []).map((c) => {
            const marcada = borrar.includes(c.clave);
            return (
              <div key={c.clave} className="rounded-lg border border-border/50 bg-card p-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <label className="text-xs font-medium">
                    {c.etiqueta}
                    {c.cifrado && <span className="ml-2 text-[10px] text-muted-foreground uppercase tracking-wider">cifrada</span>}
                  </label>
                  {c.cargada && !marcada && (
                    <button
                      onClick={() => setBorrar((b) => [...b, c.clave])}
                      className="text-[11px] text-muted-foreground hover:text-destructive"
                    >
                      Borrar
                    </button>
                  )}
                  {marcada && (
                    <button onClick={() => setBorrar((b) => b.filter((x) => x !== c.clave))} className="text-[11px] text-muted-foreground hover:text-foreground">
                      Cancelar borrado
                    </button>
                  )}
                </div>
                <input
                  value={cambios[c.clave] ?? ""}
                  onChange={(e) => editar(c.clave, e.target.value)}
                  disabled={marcada || (c.cifrado && datos.puedeGuardarCifrado === false)}
                  /**
                   * Los tres estados del `valor` se muestran distinto: la máscara como
                   * placeholder, "sin cargar" cuando no hay nada, y el error de descifrado
                   * explícito — porque se arregla revisando la clave maestra, no cargándola
                   * de nuevo.
                   */
                  placeholder={c.valor === "error" ? "No se pudo descifrar — revisá la clave maestra" : (c.valor ?? "Sin cargar")}
                  className={cn(INPUT, marcada && "line-through opacity-50", c.valor === "error" && "border-destructive/50")}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Auditor ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Auditor</h2>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Modelo">
            <input
              value={cambios.anthropicModelo ?? datos.auditor?.modelo ?? ""}
              onChange={(e) => editar("anthropicModelo", e.target.value)}
              placeholder={datos.auditor?.modeloPorDefecto}
              className={INPUT}
            />
          </Campo>
          <Campo etiqueta="Esfuerzo">
            <select
              value={cambios.anthropicThinking ?? datos.auditor?.thinking ?? ""}
              onChange={(e) => editar("anthropicThinking", e.target.value)}
              className={INPUT}
            >
              <option value="">Por defecto ({datos.auditor?.thinkingPorDefecto})</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
            </select>
          </Campo>
        </div>
      </section>

      {/* ── Prompts ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Prompts de los agentes</h2>
        <p className="text-xs text-muted-foreground -mt-1">
          Lo que el auditor usa como referencia de cómo debería comportarse cada agente. Vacío es un estado válido: el
          auditor lo reporta como no cargado en vez de inventar uno.
        </p>
        {(datos.prompts ?? []).map((p) => (
          <div key={p.clave} className="rounded-lg border border-border/50 bg-card p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-medium">{p.agente}</label>
              <span className="text-[11px] text-muted-foreground">
                {p.hash ? `${p.lineas} ${p.lineas === 1 ? "línea" : "líneas"} · ${p.hash}` : "sin cargar"}
              </span>
            </div>
            <textarea
              value={cambios[p.clave] ?? p.texto}
              onChange={(e) => editar(p.clave, e.target.value)}
              rows={5}
              placeholder="Pegá acá el prompt del agente…"
              className="w-full rounded-md border border-input bg-background dark:bg-secondary px-3 py-2 text-xs font-mono resize-y"
            />
          </div>
        ))}
      </section>

      <div className="flex items-center justify-end gap-3 sticky bottom-0 py-3 bg-background/90 backdrop-blur border-t border-border/40">
        {guardado && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" />
            Guardado
          </span>
        )}
        <button
          onClick={() => void guardar()}
          disabled={!hayCambios || guardando}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 inline-flex items-center gap-2"
        >
          {guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Guardar cambios
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════ Piezas ══════════════════════════════ */

const INPUT = "flex h-9 w-full rounded-md border border-input bg-background dark:bg-secondary px-3 py-2 text-sm";

function Campo({ etiqueta, ayuda, children }: { etiqueta: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{etiqueta}</label>
      {children}
      {ayuda && <p className="text-[11px] text-muted-foreground/80">{ayuda}</p>}
    </div>
  );
}

function Aviso({ tono, texto, onCerrar }: { tono: "error"; texto: string; onCerrar?: () => void }) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-xs flex items-start gap-2",
        tono === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span className="flex-1">{texto}</span>
      {onCerrar && (
        <button onClick={onCerrar} className="shrink-0 hover:opacity-70">
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function Cargando() {
  return (
    <div className="py-12 flex justify-center">
      <div className="h-5 w-5 rounded-full border-2 border-muted border-t-primary animate-spin" />
    </div>
  );
}

function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-card text-card-foreground border border-border/50 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-border/50 sticky top-0 bg-card">
          <h3 className="font-semibold text-base">{titulo}</h3>
          <button onClick={onCerrar} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/** Propone un slug desde el nombre. Sin acentos, sin espacios: es parte de la URL. */
function aSlug(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Fecha corta y local. Sin hora: en una lista de accesos el día alcanza. */
function fecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit" });
}
