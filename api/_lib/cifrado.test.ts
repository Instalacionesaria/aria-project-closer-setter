import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { cifrar, descifrar, enmascarar, hayClaveMaestra, secretoIgual } from "./cifrado";

const CLAVE_A = randomBytes(32).toString("base64");
const CLAVE_B = randomBytes(32).toString("base64");

let original: string | undefined;
beforeEach(() => {
  original = process.env.CIFRADO_MASTER_KEY;
  process.env.CIFRADO_MASTER_KEY = CLAVE_A;
});
afterEach(() => {
  if (original === undefined) delete process.env.CIFRADO_MASTER_KEY;
  else process.env.CIFRADO_MASTER_KEY = original;
});

describe("ida y vuelta", () => {
  it("descifra lo que cifró", () => {
    const secreto = "pit-abc123-un-token-de-ghl-cualquiera";
    expect(descifrar(cifrar(secreto))).toBe(secreto);
  });

  it("soporta acentos y emojis", () => {
    const secreto = "contraseña con ñ, á y 🔐";
    expect(descifrar(cifrar(secreto))).toBe(secreto);
  });

  it("soporta un token largo", () => {
    const secreto = "x".repeat(4000);
    expect(descifrar(cifrar(secreto))).toBe(secreto);
  });

  it("el mismo texto cifrado dos veces da blobs DISTINTOS", () => {
    // El IV es aleatorio por valor. Si dos cifrados del mismo texto dieran lo mismo, alguien
    // con el volcado de la base podría saber qué empresas comparten una credencial. Y reusar
    // un IV en GCM no debilita el cifrado: lo rompe.
    const a = cifrar("el-mismo-token");
    const b = cifrar("el-mismo-token");
    expect(a).not.toBe(b);
    expect(descifrar(a)).toBe("el-mismo-token");
    expect(descifrar(b)).toBe("el-mismo-token");
  });

  it("el blob NO contiene el texto en claro", () => {
    const secreto = "sk-ant-api03-secreto-reconocible";
    const blob = cifrar(secreto);
    expect(blob).not.toContain(secreto);
    expect(blob).not.toContain("sk-ant");
  });

  it("el formato es iv:authTag:ciphertext", () => {
    const partes = cifrar("x").split(":");
    expect(partes).toHaveLength(3);
    expect(Buffer.from(partes[0], "base64")).toHaveLength(12);
    expect(Buffer.from(partes[1], "base64")).toHaveLength(16);
  });
});

describe("GCM detecta manipulación — es el punto de usarlo", () => {
  it("lanza si alguien altera el ciphertext", () => {
    const blob = cifrar("token-original");
    const [iv, tag, datos] = blob.split(":");
    const alterado = Buffer.from(datos, "base64");
    alterado[0] ^= 0xff;
    expect(() => descifrar(`${iv}:${tag}:${alterado.toString("base64")}`)).toThrow(/modificado|clave maestra/);
  });

  it("lanza si alguien altera el authTag", () => {
    const blob = cifrar("token-original");
    const [iv, tag, datos] = blob.split(":");
    const alterado = Buffer.from(tag, "base64");
    alterado[0] ^= 0xff;
    expect(() => descifrar(`${iv}:${alterado.toString("base64")}:${datos}`)).toThrow();
  });

  it("lanza con OTRA clave maestra — y el mensaje lo dice", () => {
    // El caso real: alguien rota CIFRADO_MASTER_KEY sin volver a cargar las credenciales.
    // Tiene que ser un error visible, no un token vacío que produzca 401 de GHL.
    const blob = cifrar("token-original");
    process.env.CIFRADO_MASTER_KEY = CLAVE_B;
    expect(() => descifrar(blob)).toThrow(/clave maestra cambió/);
  });

  it("lanza con un blob malformado", () => {
    for (const basura of ["", "no-tiene-dos-puntos", "solo:dos", "a:b:c:d"]) {
      expect(() => descifrar(basura)).toThrow();
    }
  });
});

describe("la clave maestra", () => {
  it("acepta base64 y hex de 32 bytes", () => {
    process.env.CIFRADO_MASTER_KEY = randomBytes(32).toString("hex");
    expect(hayClaveMaestra()).toBe(true);
    expect(descifrar(cifrar("x"))).toBe("x");
  });

  it("rechaza una clave del largo equivocado en vez de rellenarla", () => {
    // Rellenar o recortar cifraría con una clave más débil de lo que alguien cree.
    process.env.CIFRADO_MASTER_KEY = Buffer.from("demasiado-corta").toString("base64");
    expect(hayClaveMaestra()).toBe(false);
    expect(() => cifrar("x")).toThrow(/32 bytes/);
  });

  it("sin clave configurada, el error dice cómo generarla", () => {
    delete process.env.CIFRADO_MASTER_KEY;
    expect(hayClaveMaestra()).toBe(false);
    expect(() => cifrar("x")).toThrow(/randomBytes\(32\)/);
  });
});

describe("enmascarar", () => {
  it("muestra los últimos 4 y nada más", () => {
    expect(enmascarar("pit-abcdefgh1234")).toBe("••••••1234");
  });

  it("con un secreto corto no muestra nada", () => {
    // Mostrar 4 de 6 caracteres sería regalar dos tercios del secreto.
    expect(enmascarar("corto")).toBe("•••••");
    expect(enmascarar("12345678")).toBe("••••••••");
  });

  it("sin secreto devuelve null, no una máscara vacía", () => {
    // `null` significa "no hay credencial cargada"; una máscara significa "hay una".
    expect(enmascarar(null)).toBeNull();
    expect(enmascarar("")).toBeNull();
  });
});

describe("secretoIgual", () => {
  it("compara bien", () => {
    expect(secretoIgual("token-abc", "token-abc")).toBe(true);
    expect(secretoIgual("token-abc", "token-abd")).toBe(false);
  });

  it("largos distintos dan false sin lanzar", () => {
    // `timingSafeEqual` lanza si los largos difieren; el largo no es lo que se protege.
    expect(secretoIgual("corto", "mucho-mas-largo")).toBe(false);
  });

  it("nulos y vacíos nunca coinciden", () => {
    expect(secretoIgual(null, null)).toBe(false);
    expect(secretoIgual("", "")).toBe(false);
    expect(secretoIgual("algo", undefined)).toBe(false);
  });
});
