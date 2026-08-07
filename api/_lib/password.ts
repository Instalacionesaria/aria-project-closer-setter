/**
 * Contraseñas: hash y verificación (ESPEC-MULTIEMPRESA §4.1).
 *
 * `scrypt` de `node:crypto`, sin dependencias externas. No es una preferencia estética: cada
 * dependencia nueva en la ruta de autenticación es superficie de ataque que hay que auditar y
 * mantener, y Node ya trae la primitiva correcta.
 *
 * ── Por qué scrypt y no un hash rápido ────────────────────────────────
 *
 * Un SHA-256 de una contraseña se prueba a mil millones por segundo en una GPU. scrypt es
 * deliberadamente caro en CPU **y en memoria**, que es lo que lo hace resistente al hardware
 * dedicado. Los parámetros van guardados junto al hash para poder subirlos más adelante sin
 * invalidar las contraseñas viejas: cada hash sabe con qué costo se generó.
 *
 * ── Formato ───────────────────────────────────────────────────────────
 *
 *   scrypt$N$r$p$<salt en base64>$<hash en base64>
 *
 * El salt es aleatorio y **por usuario**: dos personas con la misma contraseña tienen hashes
 * distintos, así que una tabla precomputada no sirve y romper una no rompe la otra.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Costo. `N` es el factor de trabajo y va en potencias de dos.
 *
 * 16384 · 8 · 1 es el default recomendado de Node y tarda ~100 ms en el runtime de Vercel:
 * imperceptible para quien entra una vez, carísimo para quien prueba un diccionario. Necesita
 * `128 * N * r` bytes = 16 MB, por debajo del `maxmem` por defecto de 32 MB.
 */
const N = 16384;
const R = 8;
const P = 1;
const LARGO_CLAVE = 64;
const LARGO_SALT = 16;

/** Mínimo de la especificación §4.1. */
export const LARGO_MINIMO = 8;

function derivar(texto: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolver, rechazar) => {
    scrypt(texto.normalize("NFKC"), salt, LARGO_CLAVE, { N: n, r, p }, (err, clave) =>
      err ? rechazar(err) : resolver(clave),
    );
  });
}

/**
 * `normalize("NFKC")` antes de derivar: dos formas Unicode distintas de la misma contraseña
 * —una tilde compuesta frente a una precompuesta— producirían hashes distintos, y quien la
 * escribió desde otro teclado no podría entrar nunca. Se normaliza en las dos puntas.
 */
export async function hashearPassword(texto: string): Promise<string> {
  const salt = randomBytes(LARGO_SALT);
  const clave = await derivar(texto, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${clave.toString("base64")}`;
}

/**
 * Verifica sin filtrar información por el tiempo de respuesta.
 *
 * `timingSafeEqual` y nunca `===`: una comparación que corta en el primer byte distinto tarda
 * un poco menos cuando el primer byte acierta, y con suficientes intentos eso se mide. Es un
 * ataque real contra comparaciones de secretos.
 *
 * Devuelve `false` ante cualquier hash malformado en vez de lanzar: un registro corrupto en la
 * base tiene que impedir el login, no tumbar el endpoint con un 500 que además delata que ese
 * email existe.
 */
export async function verificarPassword(texto: string, guardado: string | null | undefined): Promise<boolean> {
  if (!guardado) return false;

  const partes = guardado.split("$");
  if (partes.length !== 6 || partes[0] !== "scrypt") return false;

  const n = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Un `N` absurdo en un registro manipulado agotaría la memoria de la función. El techo es
  // generoso frente al costo actual y barato frente a un intento de negación de servicio.
  if (n < 1024 || n > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return false;

  let salt: Buffer;
  let esperado: Buffer;
  try {
    salt = Buffer.from(partes[4], "base64");
    esperado = Buffer.from(partes[5], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || esperado.length === 0) return false;

  let calculado: Buffer;
  try {
    calculado = await derivar(texto, salt, n, r, p);
  } catch {
    return false;
  }

  // `timingSafeEqual` exige el mismo largo; si difieren, ya sabemos que no coincide.
  if (calculado.length !== esperado.length) return false;
  return timingSafeEqual(calculado, esperado);
}

/**
 * Contraseña temporal para el flujo de recuperación sin correo (§4.4): el admin la genera, se
 * muestra **una sola vez** y el usuario está obligado a cambiarla al entrar.
 *
 * Alfabeto sin `0/O`, `1/l/I` ni `5/S`: esta contraseña se dicta por teléfono o se pega en un
 * chat, y un carácter ambiguo se convierte en un ticket de soporte.
 *
 * `randomBytes` y no `Math.random()`, y con rechazo de los valores que caen en el resto de la
 * división: tomar el módulo directo sesga los primeros caracteres del alfabeto.
 */
const ALFABETO = "ABCDEFGHJKMNPQRTUVWXYZabcdefghijkmnpqrstuvwxyz2346789@#%+=";

export function generarPasswordTemporal(largo = 14): string {
  const limite = 256 - (256 % ALFABETO.length);
  let salida = "";
  while (salida.length < largo) {
    for (const byte of randomBytes(largo * 2)) {
      if (byte >= limite) continue;
      salida += ALFABETO[byte % ALFABETO.length];
      if (salida.length === largo) break;
    }
  }
  return salida;
}

/** El motivo por el que una contraseña no sirve, o `null` si está bien. */
export function motivoPasswordInvalida(texto: string): string | null {
  if (texto.length < LARGO_MINIMO) return `La contraseña necesita al menos ${LARGO_MINIMO} caracteres.`;
  if (texto.trim().length === 0) return "La contraseña no puede ser solo espacios.";
  return null;
}
