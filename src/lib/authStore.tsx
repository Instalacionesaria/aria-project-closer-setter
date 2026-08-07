/**
 * La sesión del lado del navegador (ESPEC-MULTIEMPRESA §3.2).
 *
 * > *"Frontend: oculta lo que el rol no puede usar. Es cosmética — **nunca** es la protección
 * > real."*
 *
 * Todo lo que hay acá sirve para no mostrarle a alguien una pestaña que le va a rebotar con
 * 403. La protección de verdad es el `exigir()` del backend, y esa se ejecuta igual aunque
 * alguien edite este archivo desde la consola del navegador.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  cambiarEmpresaActiva,
  cambiarPassword as cambiarPasswordRemoto,
  EVENTO_SIN_SESION,
  fetchSesion,
  guardarTema,
  login as loginRemoto,
  logout as logoutRemoto,
  type EmpresaSesion,
  type Rol,
  type Tema,
  type UsuarioSesion,
} from "./api";

/**
 * ── El tema, y por qué hay una copia en el navegador ──────────────────
 *
 * La fuente de verdad es la columna `tema` de `closer_usuarios`: así viaja con la cuenta y no
 * con la máquina, que es lo que pidió Fabio. Pero resolverla exige una vuelta al servidor, y
 * durante ese instante la app ya está pintada — quien tiene el modo oscuro vería un fogonazo
 * blanco en cada recarga.
 *
 * Por eso se guarda además una copia local, que se aplica antes del primer render y se corrige
 * sola cuando la sesión responde. La copia es una CACHÉ, no la preferencia: si el servidor dice
 * otra cosa, gana el servidor.
 *
 * La clave NO lleva el id del usuario, y no se puede: la caché se lee para pintar el primer
 * frame, cuando todavía no se sabe quién entró. La consecuencia es acotada y vale la pena
 * nombrarla — en una máquina compartida, el primer instante puede mostrar el tema de quien
 * salió, hasta que la sesión responde y lo corrige. Un fogonazo en el caso raro a cambio de
 * ninguno en el habitual.
 */
const CLAVE_TEMA = "comando-central:tema";

function aplicarTema(tema: Tema) {
  document.documentElement.classList.toggle("dark", tema === "oscuro");
}

/** El tema cacheado de quien entró último, para pintar bien el primer frame. */
export function temaCacheado(): Tema | null {
  try {
    const v = localStorage.getItem(CLAVE_TEMA);
    return v === "claro" || v === "oscuro" ? v : null;
  } catch {
    return null;
  }
}

function cachearTema(tema: Tema) {
  try {
    localStorage.setItem(CLAVE_TEMA, tema);
  } catch {
    /* Modo privado o storage lleno: se pierde solo el anti-fogonazo, no la preferencia. */
  }
}

/**
 * `cargando` existe y no es lo mismo que `sin sesión`: sin ese estado, el primer render
 * mostraría la pantalla de login por un instante a alguien que ya está autenticado. Es el
 * parpadeo que hace que una app se sienta rota.
 */
type Estado = "cargando" | "autenticado" | "anonimo";

interface AuthValue {
  estado: Estado;
  usuario: UsuarioSesion | null;
  empresa: EmpresaSesion | null;
  mirandoOtraEmpresa: boolean;
  tieneRol: (...roles: Rol[]) => boolean;
  entrar: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  salir: () => Promise<void>;
  cambiarPassword: (actual: string, nueva: string) => Promise<{ ok: boolean; error?: string }>;
  /** Solo el super admin (§7.1). `null` vuelve a la empresa propia. */
  mirarEmpresa: (orgId: string | null) => Promise<{ ok: boolean; error?: string }>;
  /** El tema que se está viendo. Nunca `null`: sin preferencia guardada, claro. */
  tema: Tema;
  alternarTema: () => void;
}

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [empresa, setEmpresa] = useState<EmpresaSesion | null>(null);
  const [mirandoOtraEmpresa, setMirandoOtra] = useState(false);
  const [tema, setTema] = useState<Tema>(() => temaCacheado() ?? "claro");

  const releer = useCallback(async () => {
    const r = await fetchSesion().catch(() => ({ ok: false, autenticado: false }) as const);
    if (r.autenticado && "usuario" in r && r.usuario) {
      setUsuario(r.usuario);
      /**
       * El servidor manda. Si la persona nunca eligió (`null`) NO se escribe nada: se deja lo
       * que ya haya —la caché de esta máquina o el claro por defecto— en vez de convertir un
       * "no eligió" en una elección.
       */
      if (r.usuario.tema) {
        setTema(r.usuario.tema);
        aplicarTema(r.usuario.tema);
        cachearTema(r.usuario.tema);
      }
      setEmpresa(("empresa" in r ? r.empresa : null) ?? null);
      setMirandoOtra(Boolean("mirandoOtraEmpresa" in r && r.mirandoOtraEmpresa));
      setEstado("autenticado");
    } else {
      setUsuario(null);
      setEmpresa(null);
      setMirandoOtra(false);
      setEstado("anonimo");
    }
  }, []);

  useEffect(() => {
    void releer();
  }, [releer]);

  /**
   * Cualquier 401 en cualquier parte de la app devuelve a la pantalla de login.
   *
   * Sin esto, una sesión vencida se vería como "todos los paneles fallan a la vez" y nadie
   * entendería por qué. El evento lo emite `pedir()` en `api.ts`.
   */
  useEffect(() => {
    const alPerderSesion = () => {
      setUsuario(null);
      setEmpresa(null);
      setEstado("anonimo");
    };
    window.addEventListener(EVENTO_SIN_SESION, alPerderSesion);
    return () => window.removeEventListener(EVENTO_SIN_SESION, alPerderSesion);
  }, []);

  const entrar = useCallback(
    async (email: string, password: string) => {
      const r = await loginRemoto(email, password);
      if (!r.ok) return { ok: false, error: r.error ?? "No se pudo entrar." };
      // Se relee en vez de confiar en la respuesta del login: `/api/auth/sesion` es la fuente
      // única de qué empresa se está mirando, y así hay un solo lugar que compone ese estado.
      await releer();
      return { ok: true };
    },
    [releer],
  );

  const salir = useCallback(async () => {
    await logoutRemoto();
    setUsuario(null);
    setEmpresa(null);
    setMirandoOtra(false);
    setEstado("anonimo");
  }, []);

  const cambiarPassword = useCallback(
    async (actual: string, nueva: string) => {
      const r = await cambiarPasswordRemoto(actual, nueva);
      if (!r.ok) return { ok: false, error: r.error ?? "No se pudo cambiar." };
      await releer();
      return { ok: true };
    },
    [releer],
  );

  /**
   * Cambiar de empresa **no es un filtro de la vista**: cambia la empresa efectiva de la sesión
   * en el servidor, y a partir de ahí todos los endpoints devuelven los datos de esa empresa.
   *
   * Por eso al terminar se relee la sesión y no se toca el estado a mano: el `mirandoOtraEmpresa`
   * que enciende el banner lo decide el backend, y si el cambio falló la UI tiene que seguir
   * mostrando la empresa vieja — que es la que el backend sigue usando.
   */
  const mirarEmpresa = useCallback(
    async (orgId: string | null) => {
      const r = await cambiarEmpresaActiva(orgId);
      if (!r.ok) return { ok: false, error: r.error ?? "No se pudo cambiar de empresa." };
      await releer();
      return { ok: true };
    },
    [releer],
  );

  /**
   * El super admin pasa por todos lados (§3.1): es el dueño de la plataforma. Se resuelve acá
   * y no en cada vista para que no haya dos criterios de "puede ver esto".
   */
  const tieneRol = useCallback(
    (...roles: Rol[]) => {
      if (!usuario) return false;
      if (usuario.esSuperAdmin) return true;
      return roles.some((r) => usuario.roles.includes(r));
    },
    [usuario],
  );

  /**
   * Alterna el tema. Aplica primero y guarda después, en ese orden: el botón tiene que
   * responder en el mismo frame, no cuando conteste el servidor.
   *
   * Si el guardado falla no se revierte nada ni se muestra un error. Lo único que se pierde es
   * que la preferencia sobreviva a la sesión, y tirarle un cartel rojo a alguien que apretó un
   * botón de luz sería peor que el problema. Queda en la consola por si alguien lo busca.
   */
  const alternarTema = useCallback(() => {
    const siguiente: Tema = tema === "oscuro" ? "claro" : "oscuro";
    setTema(siguiente);
    aplicarTema(siguiente);
    cachearTema(siguiente);
    void guardarTema(siguiente).then((r) => {
      if (!r.ok) console.warn(`[tema] no se pudo guardar la preferencia: ${r.error ?? "sin detalle"}`);
    });
  }, [tema]);

  const valor = useMemo<AuthValue>(
    () => ({ estado, usuario, empresa, mirandoOtraEmpresa, tieneRol, entrar, salir, cambiarPassword, mirarEmpresa, tema, alternarTema }),
    [estado, usuario, empresa, mirandoOtraEmpresa, tieneRol, entrar, salir, cambiarPassword, mirarEmpresa, tema, alternarTema],
  );

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth fuera de <AuthProvider>");
  return v;
}
