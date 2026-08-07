import { describe, expect, it } from "vitest";
import {
  generarPasswordTemporal,
  hashearPassword,
  LARGO_MINIMO,
  motivoPasswordInvalida,
  verificarPassword,
} from "./password";

describe("hashear y verificar", () => {
  it("una contraseña correcta verifica", async () => {
    const h = await hashearPassword("caballo-bateria-grapa");
    expect(await verificarPassword("caballo-bateria-grapa", h)).toBe(true);
  });

  it("una incorrecta no", async () => {
    const h = await hashearPassword("caballo-bateria-grapa");
    expect(await verificarPassword("caballo-bateria-grapo", h)).toBe(false);
  });

  it("dos hashes de la MISMA contraseña son distintos", async () => {
    // El salt es por usuario: sin esto, dos personas con la misma contraseña tendrían el
    // mismo hash y una tabla precomputada las rompería a las dos de una vez.
    const a = await hashearPassword("la-misma");
    const b = await hashearPassword("la-misma");
    expect(a).not.toBe(b);
    expect(await verificarPassword("la-misma", a)).toBe(true);
    expect(await verificarPassword("la-misma", b)).toBe(true);
  });

  it("el formato guardado lleva los parámetros de costo", async () => {
    // Van adentro del hash para poder subir el costo más adelante sin invalidar las
    // contraseñas viejas: cada hash sabe con qué parámetros se generó.
    const h = await hashearPassword("x".repeat(12));
    const partes = h.split("$");
    expect(partes[0]).toBe("scrypt");
    expect(Number(partes[1])).toBeGreaterThanOrEqual(16384);
    expect(partes).toHaveLength(6);
  });

  it("verifica contra un hash de costo distinto al actual", async () => {
    // Simula una contraseña vieja guardada con parámetros más bajos. Tiene que seguir
    // entrando: si no, subir el costo dejaría a todo el mundo afuera.
    const viejo = "scrypt$1024$8$1$" + Buffer.from("salt-viejo-16byt").toString("base64") + "$";
    const { scrypt } = await import("node:crypto");
    const clave = await new Promise<Buffer>((r, j) =>
      scrypt("vieja", Buffer.from("salt-viejo-16byt"), 64, { N: 1024, r: 8, p: 1 }, (e, k) => (e ? j(e) : r(k))),
    );
    expect(await verificarPassword("vieja", viejo + clave.toString("base64"))).toBe(true);
  });

  it("normaliza Unicode: la misma contraseña escrita distinto entra igual", async () => {
    // "á" precompuesta frente a "a" + tilde combinante. Son bytes distintos y la misma
    // contraseña para quien la escribe; sin normalizar, quien la tipeó desde otro teclado
    // no podría entrar nunca.
    const h = await hashearPassword("contraseña-ágil");
    expect(await verificarPassword("contraseña-ágil", h)).toBe(true);
  });
});

describe("hashes malformados: devuelven false, no explotan", () => {
  // Un registro corrupto tiene que impedir el login, no tumbar el endpoint con un 500 — que
  // además delataría que ese email existe.
  const basura = [
    null,
    undefined,
    "",
    "no-es-un-hash",
    "scrypt$16384$8$1$solo-cuatro-partes",
    "bcrypt$16384$8$1$c2FsdA==$aGFzaA==",
    "scrypt$abc$8$1$c2FsdA==$aGFzaA==",
    "scrypt$16384$8$1$$aGFzaA==",
    "scrypt$16384$8$1$c2FsdA==$",
  ];
  for (const h of basura) {
    it(`rechaza ${JSON.stringify(h)?.slice(0, 40)}`, async () => {
      expect(await verificarPassword("lo-que-sea", h as string | null)).toBe(false);
    });
  }

  it("rechaza un N absurdo sin intentar reservar la memoria", async () => {
    // Un registro manipulado con N gigante agotaría la memoria de la función. El techo corta
    // antes de llamar a scrypt.
    const inicio = Date.now();
    expect(await verificarPassword("x", "scrypt$999999999$8$1$c2FsdA==$aGFzaA==")).toBe(false);
    expect(Date.now() - inicio).toBeLessThan(500);
  });
});

describe("contraseñas temporales", () => {
  it("no repite y respeta el largo", () => {
    const vistas = new Set(Array.from({ length: 200 }, () => generarPasswordTemporal(14)));
    expect(vistas.size).toBe(200);
    for (const p of vistas) expect(p).toHaveLength(14);
  });

  it("no usa caracteres ambiguos: se dictan por teléfono", () => {
    for (let i = 0; i < 100; i++) {
      expect(generarPasswordTemporal(20)).not.toMatch(/[0O1lI5S]/);
    }
  });

  it("la que genera pasa la validación de largo", () => {
    expect(motivoPasswordInvalida(generarPasswordTemporal())).toBeNull();
  });
});

describe("validación de largo", () => {
  it(`rechaza menos de ${LARGO_MINIMO}`, () => {
    expect(motivoPasswordInvalida("corta")).toContain(String(LARGO_MINIMO));
  });

  it("rechaza solo espacios aunque sean largos", () => {
    expect(motivoPasswordInvalida("          ")).toBeTruthy();
  });

  it("acepta una razonable", () => {
    expect(motivoPasswordInvalida("una-normal-1")).toBeNull();
  });
});
