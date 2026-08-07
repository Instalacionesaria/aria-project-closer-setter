/**
 * La puerta de entrada y el cambio de contraseña forzado (ESPEC-MULTIEMPRESA §4.3 y §4.4).
 *
 * Dos pantallas en un archivo porque son el mismo momento del producto: nadie llega a la
 * segunda si no pasó por la primera, y la segunda bloquea todo lo demás hasta resolverse.
 *
 * ── El mensaje de error se muestra tal como viene ─────────────────────
 *
 * El backend responde siempre "Credenciales inválidas" exista el email o no (§4.3). Acá no se
 * lo reinterpreta ni se lo adorna: cualquier intento de ser más específico desde el cliente
 * —"revisá el correo", "esa cuenta no existe"— desharía justamente lo que ese mensaje protege.
 */

import { useState, type FormEvent } from "react";
import { AlertTriangle, KeyRound, Loader2, LogIn } from "lucide-react";
import { useAuth } from "../lib/authStore";

export default function Login() {
  const { estado, usuario, entrar, cambiarPassword, salir } = useAuth();

  // Con la contraseña temporal sin cambiar, el backend rechaza todo lo demás con 403
  // `password_temporal`. La UI acompaña esa regla en vez de dejar a alguien golpeando puertas.
  if (estado === "autenticado" && usuario?.debeCambiarPassword) {
    return <CambioForzado onCambiar={cambiarPassword} onSalir={salir} nombre={usuario.nombre} />;
  }
  return <Entrar onEntrar={entrar} />;
}

/* ─────────────────────────────── Entrar ─────────────────────────────── */

function Entrar({ onEntrar }: { onEntrar: (e: string, p: string) => Promise<{ ok: boolean; error?: string }> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (enviando) return;
    setEnviando(true);
    setError(null);
    const r = await onEntrar(email.trim(), password);
    if (!r.ok) {
      setError(r.error ?? "No se pudo entrar.");
      setPassword("");
    }
    setEnviando(false);
  };

  return (
    <Marco>
      <form onSubmit={enviar} className="space-y-4">
        <Campo
          etiqueta="Email"
          tipo="email"
          valor={email}
          onChange={setEmail}
          autoComplete="username"
          autoFocus
          requerido
        />
        <Campo
          etiqueta="Contraseña"
          tipo="password"
          valor={password}
          onChange={setPassword}
          autoComplete="current-password"
          requerido
        />

        {error && <Aviso>{error}</Aviso>}

        <button
          type="submit"
          disabled={enviando || !email.trim() || !password}
          className="w-full h-11 rounded-xl bg-foreground text-background font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          {enviando ? "Entrando…" : "Entrar"}
        </button>

        {/*
          §4.4: no hay recuperación por correo. Decirlo acá evita que alguien busque un enlace
          que no existe y termine escribiéndole a soporte.
        */}
        <p className="text-xs text-muted-foreground text-center leading-relaxed pt-1">
          ¿Olvidaste tu contraseña? Pedile a un administrador que te genere una temporal.
        </p>
      </form>
    </Marco>
  );
}

/* ───────────────────── Cambio forzado de contraseña ───────────────────── */

function CambioForzado({
  onCambiar,
  onSalir,
  nombre,
}: {
  onCambiar: (a: string, n: string) => Promise<{ ok: boolean; error?: string }>;
  onSalir: () => Promise<void>;
  nombre: string;
}) {
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [repetida, setRepetida] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (enviando) return;
    // Se compara acá y no solo en el servidor porque el servidor no puede saber que alguien
    // quiso escribir dos veces lo mismo y se equivocó en una.
    if (nueva !== repetida) {
      setError("Las dos contraseñas nuevas no coinciden.");
      return;
    }
    setEnviando(true);
    setError(null);
    const r = await onCambiar(actual, nueva);
    if (!r.ok) setError(r.error ?? "No se pudo cambiar.");
    setEnviando(false);
  };

  return (
    <Marco titulo="Definí tu contraseña" subtitulo={`Hola ${nombre}. Tu contraseña es temporal.`}>
      <form onSubmit={enviar} className="space-y-4">
        <Campo etiqueta="Contraseña temporal" tipo="password" valor={actual} onChange={setActual} autoComplete="current-password" autoFocus requerido />
        <Campo etiqueta="Contraseña nueva" tipo="password" valor={nueva} onChange={setNueva} autoComplete="new-password" requerido />
        <Campo etiqueta="Repetila" tipo="password" valor={repetida} onChange={setRepetida} autoComplete="new-password" requerido />

        <p className="text-xs text-muted-foreground leading-relaxed">
          Al menos 8 caracteres. Cambiarla cierra las demás sesiones que tengas abiertas.
        </p>

        {error && <Aviso>{error}</Aviso>}

        <button
          type="submit"
          disabled={enviando || !actual || !nueva || !repetida}
          className="w-full h-11 rounded-xl bg-foreground text-background font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
          {enviando ? "Guardando…" : "Guardar y entrar"}
        </button>

        <button
          type="button"
          onClick={() => void onSalir()}
          className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Salir
        </button>
      </form>
    </Marco>
  );
}

/* ─────────────────────────────── Piezas ─────────────────────────────── */

function Marco({
  children,
  titulo = "Comando Central",
  subtitulo = "Entrá con tu cuenta.",
}: {
  children: React.ReactNode;
  titulo?: string;
  subtitulo?: string;
}) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{titulo}</h1>
          <p className="text-sm text-muted-foreground mt-1">{subtitulo}</p>
        </div>
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );
}

function Campo({
  etiqueta,
  tipo,
  valor,
  onChange,
  autoComplete,
  autoFocus,
  requerido,
}: {
  etiqueta: string;
  tipo: string;
  valor: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  autoFocus?: boolean;
  requerido?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{etiqueta}</span>
      <input
        type={tipo}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        required={requerido}
        className="mt-1.5 w-full h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-foreground/15 transition-shadow"
      />
    </label>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="text-xs text-rose-700 dark:text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3 py-2.5 flex items-start gap-2 leading-relaxed"
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{children}</span>
    </p>
  );
}
