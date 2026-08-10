/**
 * Las secciones "En desarrollo" (ESPEC-MULTIEMPRESA §8).
 *
 * > *"La sección **se ve completa** (su layout, sus tarjetas) con una capa encima que dice **En
 * > desarrollo** y una línea de qué va a hacer. **Nunca con números inventados** — esto es la
 * > regla D3, y romperla acá sería mostrarle datos falsos a un cliente que paga."*
 *
 * ── Qué problema resuelve, y qué problema NO ──────────────────────────
 *
 * Hay funcionalidad que se lanza visible pero bloqueada, para que el cliente sepa que existe y
 * está viniendo. La tentación con una sección así es llenarla de números plausibles "para que se
 * vea"; eso es exactamente lo que D3 prohíbe, y con un cliente que paga es peor que dejarla
 * vacía: los números falsos se usan para tomar decisiones.
 *
 * Lo que este módulo NO es: una forma de esconder algo roto. Una sección en desarrollo dice *qué
 * va a hacer*, no *por qué todavía no lo hace* — si el motivo es que falta un dato de origen,
 * eso va en `docs/10-ESTADO.md`, no en un velo.
 *
 * ── Por qué la lista es literal y no una variable de entorno ───────────
 *
 * Activar una sección tiene que ser un cambio revisable: cambiar `false` por `true` acá aparece
 * en un diff y alguien lo mira. Con una variable de entorno se puede encender en producción sin
 * que quede rastro en el repo, y lo que se encendería es una sección que muestra números — que
 * es justo la decisión que no queremos que sea invisible.
 */

import type { ReactNode } from "react";
import { Construction } from "lucide-react";
import { cn } from "./utils";

/**
 * Las seis de §8. La clave es un literal para que el compilador rechace un typo: una clave mal
 * escrita en `estaEnDesarrollo()` devolvería `false` y **destaparía** la sección, que es el modo
 * de fallar peligroso.
 */
export type ClaveEnDesarrollo =
  | "acquisition.atribucion"
  | "acquisition.alertas"
  | "acquisition.recomendaciones"
  | "acquisition.tracking"
  | "ci.auditor_setter"
  | "ci.auditor_voz";

interface Seccion {
  /** Qué va a hacer, en una línea, en presente. Lo lee un cliente, no un desarrollador. */
  queVaAHacer: string;
  /** `true` = todavía bloqueada. Activar es cambiar esto a `false`, y nada más. */
  enDesarrollo: boolean;
}

const SECCIONES: Record<ClaveEnDesarrollo, Seccion> = {
  "acquisition.atribucion": {
    queVaAHacer: "Va a decir de qué anuncio salió cada lead, cada cita y cada venta.",
    enDesarrollo: true,
  },
  "acquisition.alertas": {
    queVaAHacer: "Va a avisar cuando un anuncio se fatigue o su costo por lead se dispare.",
    enDesarrollo: true,
  },
  "acquisition.recomendaciones": {
    queVaAHacer: "Va a sugerir dónde mover presupuesto, con el número que respalda cada sugerencia.",
    enDesarrollo: true,
  },
  "acquisition.tracking": {
    queVaAHacer: "Va a seguir al visitante desde el anuncio hasta la landing y el formulario.",
    enDesarrollo: true,
  },
  /**
   * ── Las dos `ci.*` NO usan el velo, y es deliberado ─────────────────
   *
   * Están en este catálogo porque §8 las lista, pero su UI la resuelve otro patrón que ya
   * existía: la tarjeta de `AgentsAudit` se ve completa —header, objetivo, descripción— y en
   * lugar de las métricas muestra `porQueNoHayAuditor`. O sea que ya cumple lo que §8 pide.
   *
   * Ponerles el velo encima sería una **segunda derivación de la misma regla** (D6): dos
   * mecanismos distintos afirmando "esto todavía no está", que es exactamente cómo dos vitrinas
   * del mismo hecho empiezan a divergir. Y visualmente sería un velo sobre una tarjeta que ya
   * explica su ausencia.
   *
   * Quién manda de verdad: `AUDITORES_ACTIVOS` en `api/_lib/analizador.ts`. Estas dos entradas
   * tienen que decir lo mismo que esa constante, y un test lo hace cumplir — si alguien enciende
   * el auditor del setter allá y se olvida de acá, falla `enDesarrollo.test.ts`.
   */
  /**
   * **Encendido el 2026-08-08.** Tiene su rúbrica propia de pre-agenda (`CRITERIOS_SETTER` en
   * `analizador.ts`): seis criterios que no existen en el closer más `dato_faltante`, que
   * significa lo mismo en las dos etapas.
   *
   * La entrada se deja en el catálogo en vez de borrarse: el test de coherencia la compara contra
   * `AUDITORES_ACTIVOS`, así que si alguien apaga el auditor allá y no vuelve a poner el velo acá,
   * la suite lo caza. Borrarla dejaría ese guard sin nada que verificar.
   */
  "ci.auditor_setter": {
    queVaAHacer:
      "Va a auditar al agente que califica y agenda. Su rúbrica es distinta de la del closer: " +
      "juzga calificar y agendar, no confirmar y acompañar.",
    enDesarrollo: false,
  },
  "ci.auditor_voz": {
    queVaAHacer: "Va a auditar las llamadas de los agentes de voz sobre su transcripción.",
    enDesarrollo: true,
  },
};

/** ¿Esta sección todavía está bloqueada? */
export function estaEnDesarrollo(clave: ClaveEnDesarrollo): boolean {
  return SECCIONES[clave].enDesarrollo;
}

/** Qué va a hacer, para mostrarlo en el velo. */
export function queVaAHacer(clave: ClaveEnDesarrollo): string {
  return SECCIONES[clave].queVaAHacer;
}

/** Solo para el test que fija las seis claves. */
export const _CLAVES = Object.keys(SECCIONES) as ClaveEnDesarrollo[];

/**
 * El velo.
 *
 * ── Envuelve, no reemplaza ────────────────────────────────────────────
 *
 * `children` se renderiza igual y el velo va encima. Es lo que §8 pide —*"la sección se ve
 * completa"*— y es también lo que la hace útil: el cliente ve la forma de lo que viene, no un
 * cartel. Reemplazar el contenido por un mensaje habría sido más fácil de escribir y habría
 * dejado la promesa sin nada que la respalde.
 *
 * `aria-hidden` y `pointer-events-none` sobre el contenido, no solo opacidad: sin eso un lector
 * de pantalla lee números que nadie midió, y un tab llega a controles que no hacen nada.
 */
export function EnDesarrollo({
  clave,
  children,
  className,
}: {
  clave: ClaveEnDesarrollo;
  children: ReactNode;
  className?: string;
}) {
  // Activada: desaparece por completo, sin dejar wrapper ni clases que puedan afectar el layout.
  if (!estaEnDesarrollo(clave)) return <>{children}</>;

  return (
    <div className={cn("relative isolate", className)}>
      <div aria-hidden className="pointer-events-none select-none blur-[2px] opacity-40">
        {children}
      </div>

      {/*
        `bg-background/60` y no un color propio: el velo tiene que verse igual en claro y en
        oscuro, y las variables del tema ya resuelven eso. Ver el § de dark mode en 01-PRODUCTO.
      */}
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[1px] p-6">
        <div className="max-w-sm text-center space-y-2.5">
          <div className="w-10 h-10 rounded-2xl bg-muted flex items-center justify-center mx-auto border border-border/50">
            <Construction className="w-4 h-4 text-muted-foreground" />
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">En desarrollo</div>
          <p className="text-sm text-foreground/80 leading-relaxed">{queVaAHacer(clave)}</p>
        </div>
      </div>
    </div>
  );
}
