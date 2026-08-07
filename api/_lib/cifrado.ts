/**
 * Cifrado de credenciales en reposo (ESPEC-MULTIEMPRESA §5.1).
 *
 * **Módulo único.** Nadie más cifra ni descifra: si mañana hay que rotar la clave maestra o
 * cambiar el algoritmo, se toca acá y nada más.
 *
 * ── La consecuencia buscada ───────────────────────────────────────────
 *
 * > *"Una filtración del volcado de Supabase **no** entrega ningún token de GHL, Meta ni
 * > Anthropic."*
 *
 * La clave maestra vive en las variables de entorno de Vercel. Nunca en el repositorio y
 * **nunca en Supabase**: si estuviera en la misma base que los secretos cifrados, cifrarlos no
 * serviría de nada — sería poner la llave debajo del felpudo.
 *
 * ── Por qué GCM y no CBC ──────────────────────────────────────────────
 *
 * GCM es cifrado **autenticado**: además de ocultar el texto, detecta si alguien lo modificó.
 * Con CBC, un atacante con acceso de escritura a la base puede alterar el ciphertext y el
 * descifrado devuelve basura sin avisar; con GCM, `descifrar` lanza. Para una credencial eso
 * importa: un PIT de GHL corrupto que pase silenciosamente se convierte en llamadas fallidas
 * imposibles de diagnosticar.
 *
 * ── El IV es aleatorio por valor, y es obligatorio que lo sea ─────────
 *
 * Reusar un IV con la misma clave en GCM **rompe el cifrado por completo** — no lo debilita,
 * lo rompe: se puede recuperar la clave de autenticación. Por eso se genera uno nuevo en cada
 * `cifrar()` y se guarda junto al resultado.
 *
 * Formato: `iv:authTag:ciphertext`, los tres en base64.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const ALGORITMO = "aes-256-gcm";
/** GCM usa 96 bits de IV. Es el tamaño para el que está diseñado y el que NIST recomienda. */
const LARGO_IV = 12;
const LARGO_CLAVE = 32;

/**
 * La clave maestra, decodificada y validada.
 *
 * Se lee en cada llamada y no se cachea a nivel de módulo: es un `Buffer` con material
 * criptográfico y no hay razón para que sobreviva más de lo necesario en una instancia
 * caliente que puede atender a varias empresas.
 *
 * Acepta base64 o hex — 32 bytes de cualquiera de las dos formas. Un largo distinto es un
 * error de configuración y se dice cuál, no se rellena ni se recorta: una clave truncada
 * cifraría de forma más débil de lo que alguien cree.
 */
function claveMaestra(): Buffer {
  const crudo = process.env.CIFRADO_MASTER_KEY;
  if (!crudo) {
    throw new Error(
      "CIFRADO_MASTER_KEY sin configurar. Generala con " +
        "`node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"` " +
        "y ponela en las variables de entorno de Vercel (nunca en el repo ni en Supabase).",
    );
  }

  const candidatos = [Buffer.from(crudo, "base64"), Buffer.from(crudo, "hex")];
  const clave = candidatos.find((c) => c.length === LARGO_CLAVE);
  if (!clave) {
    throw new Error(
      `CIFRADO_MASTER_KEY tiene que ser de ${LARGO_CLAVE} bytes en base64 o hex. ` +
        `La configurada decodifica a ${candidatos[0].length} bytes.`,
    );
  }
  return clave;
}

/** ¿Está configurada y es válida? Para que el diagnóstico lo pueda decir sin descifrar nada. */
export function hayClaveMaestra(): boolean {
  try {
    claveMaestra();
    return true;
  } catch {
    return false;
  }
}

export function cifrar(texto: string): string {
  const iv = randomBytes(LARGO_IV);
  const cipher = createCipheriv(ALGORITMO, claveMaestra(), iv);
  const partes = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${partes.toString("base64")}`;
}

/**
 * Descifra, o **lanza**. No devuelve `null` a propósito.
 *
 * Un `null` acá se confundiría con "esta empresa no tiene la credencial configurada", que es
 * un estado normal. "El blob está corrupto o la clave maestra cambió" es un problema de
 * configuración que hay que ver, no un dato ausente (regla 2 del proyecto).
 */
export function descifrar(blob: string): string {
  const partes = blob.split(":");
  if (partes.length !== 3) {
    throw new Error("Blob cifrado malformado: se esperaba iv:authTag:ciphertext.");
  }

  const [ivB64, tagB64, datosB64] = partes;
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const datos = Buffer.from(datosB64, "base64");

  if (iv.length !== LARGO_IV) throw new Error(`IV de ${iv.length} bytes; se esperaban ${LARGO_IV}.`);
  if (tag.length !== 16) throw new Error(`authTag de ${tag.length} bytes; se esperaban 16.`);

  const decipher = createDecipheriv(ALGORITMO, claveMaestra(), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(datos), decipher.final()]).toString("utf8");
  } catch {
    // GCM falla la verificación: el valor se modificó, o se cifró con otra clave maestra.
    // El mensaje no incluye ni el blob ni la clave.
    throw new Error(
      "No se pudo descifrar la credencial: el valor fue modificado o la clave maestra cambió. " +
        "Hay que volver a cargarla desde el panel de administración.",
    );
  }
}

/**
 * Lo que se le muestra a un humano: `••••••1234`.
 *
 * La UI de administración **no tiene un botón de "ver"** (§5.1), solo "Reemplazar". Esta
 * máscara existe para que alguien pueda confirmar *cuál* credencial está cargada sin que la
 * credencial viaje al browser.
 *
 * Los últimos 4 caracteres alcanzan para reconocer un token propio y no alcanzan para
 * reconstruirlo. Con secretos muy cortos se enmascara todo: mostrar 4 de 6 caracteres sería
 * regalar dos tercios.
 */
export function enmascarar(secreto: string | null | undefined): string | null {
  if (!secreto) return null;
  if (secreto.length <= 8) return "•".repeat(secreto.length);
  return "•".repeat(6) + secreto.slice(-4);
}

/**
 * Compara dos secretos sin filtrar información por el tiempo. Para validar tokens de webhook
 * que vienen por empresa (§6.3).
 *
 * Los largos distintos se responden `false` antes de comparar: `timingSafeEqual` lanza si no
 * coinciden, y el largo de un token no es lo que se está protegiendo.
 */
export function secretoIgual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * ── Qué va cifrado y qué no, y por qué ────────────────────────────────
 *
 * **Cifradas** (las columnas `*_cifrado` / `*_cifrada`): el PIT de GHL, la key de Anthropic y
 * el token de Meta. Son credenciales de salida — nosotros las usamos para llamar a alguien —
 * así que solo hace falta descifrarlas en el momento del uso.
 *
 * **En claro**: `ghl_webhook_secret` y `assistable_token`. Son secretos **compartidos** que el
 * proveedor manda en cada request para que los comparemos. Cifrarlos obligaría a descifrar en
 * cada webhook para poder comparar, sin ganar nada: quien tuviera el volcado de la base
 * tendría igual el valor con el que se compara. Lo que sí se hace es compararlos con
 * `secretoIgual`, que no filtra por tiempo.
 *
 * La diferencia está en el nombre de la columna, a propósito: `_cifrado` significa que lo
 * está, y su ausencia significa que no. No hay que leer el código para saberlo.
 */
