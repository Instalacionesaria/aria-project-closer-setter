/**
 * El canal para decirle a la persona que algo NO salió como parece.
 *
 * ── Por qué existe ──
 *
 * Avanzar es optimista: la píldora cambia y el toast de éxito sale antes de que el servidor
 * conteste, porque esperar medio segundo hace sentir la app rota. El precio es que cuando el
 * servidor contesta "quedó registrado, **pero la nota no se guardó**", ya no hay a quién
 * decírselo: `advance()` no espera a nadie y el `.then()` corre sin vista a la que hablarle.
 *
 * Hasta el 2026-08-15 eso terminaba en un `console.warn`. El backend decía la verdad —y desde
 * el arreglo de las notas dice más— pero el usuario veía un toast verde. La regla 2 pide que si
 * una escritura falla la respuesta lo diga, y una consola que nadie abre no es decirlo.
 *
 * ── Por qué un evento y no un store ──
 *
 * Mismo motivo que `EVENTO_SIN_SESION` en `api.ts`: quien avisa es una capa de datos y quien
 * muestra es una vista. Si el store importara al drawer —o el drawer expusiera un setter global—
 * habría un ciclo o un singleton. Un evento del navegador los deja sin conocerse.
 */

/** `detail` es el texto ya listo para un humano. Nunca un código ni un objeto de error. */
export const EVENTO_AVISO = "cc:aviso";

/**
 * Publica un aviso. Silencioso fuera del navegador (los tests corren en Node sin `window`).
 *
 * No hace nada con un texto vacío: un aviso en blanco abriría un toast que no dice nada, y el
 * usuario aprendería a ignorarlos.
 */
export function emitirAviso(mensaje: string | undefined | null): void {
  const texto = mensaje?.trim();
  if (!texto || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENTO_AVISO, { detail: texto }));
}

/** Varios de una: cada advertencia del backend es una frase suelta ya escrita para leer. */
export function emitirAvisos(mensajes: readonly string[] | undefined): void {
  for (const m of mensajes ?? []) emitirAviso(m);
}
