/**
 * Las dos reglas del checklist de alta que se pueden equivocar en silencio (plan §4.1).
 *
 * Se prueban las funciones sueltas y no el endpoint: las dos son derivaciones puras y no necesitan
 * ni base ni sesión. El resto de los ítems son un `Boolean(credencial)` y no tienen nada que
 * verificar más allá de leerlos.
 *
 * ── Por qué justo estas dos ───────────────────────────────────────────
 *
 * Porque las dos pueden decir **verde sobre algo que no está**, y ése es el único modo de fallo que
 * vuelve inútil un checklist:
 *
 *   · Un webhook con URL y secreto generados parece listo, y no lo está: nadie sabe si el cliente
 *     los pegó del otro lado. La única evidencia es un evento recibido.
 *   · Un admin creado con su contraseña temporal parece listo, y no lo está: el mail pudo no
 *     llegar. La única evidencia es `ultimo_acceso_el`.
 *
 * Las dos veces la tentación es la misma —"el campo tiene algo, poné verde"— y las dos veces el
 * error se descubre el día del lanzamiento.
 *
 * ── El guion bajo del nombre no es decorativo ─────────────────────────
 *
 * Vercel convierte en función serverless **todo** `.ts` bajo `api/` y su único filtro son los que
 * llevan `/_` en la ruta. Sin el guion bajo esto se publicaría como `/api/admin/alta.test` con
 * vitest empaquetado adentro. Ver `_usuarios.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { itemUsuarios, itemWebhook, type FilaUsuario } from "./alta.js";

const BASE = { clave: "webhook_ghl", titulo: "Webhook", donde: "GHL" };

describe("itemWebhook · un secreto generado no prueba que el cliente lo pegó", () => {
  it("con eventos recibidos queda listo", () => {
    const i = itemWebhook({ ...BASE, secreto: true, eventos: 12 });
    expect(i.estado).toBe("listo");
    expect(i.detalle).toContain("12 evento");
  });

  /** La regla entera de este ítem. Si algún día pasa a `listo`, el checklist empezó a mentir. */
  it("con secreto pero SIN eventos NO queda listo", () => {
    const i = itemWebhook({ ...BASE, secreto: true, eventos: 0 });
    expect(i.estado).toBe("falta");
    expect(i.detalle).toContain("nunca llegó un evento");
    expect(i.accion).toBeTruthy();
  });

  it("sin secreto y sin eventos también falta, pero lo dice distinto", () => {
    const i = itemWebhook({ ...BASE, secreto: false, eventos: 0 });
    expect(i.estado).toBe("falta");
    expect(i.detalle).toContain("Sin secreto");
  });

  /** `null` = no se pudo contar. No es cero (regla 2 de `CLAUDE.md`). */
  it("si no se pudo contar los eventos queda sin_dato, no falta", () => {
    expect(itemWebhook({ ...BASE, secreto: true, eventos: null }).estado).toBe("sin_dato");
  });

  it("el singular y el plural del contador", () => {
    expect(itemWebhook({ ...BASE, secreto: true, eventos: 1 }).detalle).toContain("1 evento recibido:");
    expect(itemWebhook({ ...BASE, secreto: true, eventos: 2 }).detalle).toContain("2 eventos recibidos:");
  });

  it("bloqueante por defecto, y se puede declarar que no", () => {
    expect(itemWebhook({ ...BASE, secreto: false, eventos: 0 }).bloqueante).toBe(true);
    expect(itemWebhook({ ...BASE, secreto: false, eventos: 0, bloqueante: false }).bloqueante).toBe(false);
  });
});

const usuario = (p: Partial<FilaUsuario> = {}): FilaUsuario => ({
  nombre: "Alguien",
  roles: ["closer"],
  activo: true,
  es_admin_principal: false,
  ultimo_acceso_el: "2026-08-01T10:00:00Z",
  debe_cambiar_password: false,
  ...p,
});

describe("itemUsuarios · crear el admin no es lo mismo que el admin habiendo entrado", () => {
  it("sin ningún admin activo, bloquea", () => {
    const i = itemUsuarios([usuario(), usuario()]);
    expect(i.estado).toBe("falta");
    expect(i.bloqueante).toBe(true);
    expect(i.detalle).toContain("ninguno con rol admin");
  });

  /** Un admin desactivado no cuenta: no puede entrar, así que no puede configurar nada. */
  it("un admin desactivado no cuenta como admin", () => {
    const i = itemUsuarios([usuario({ roles: ["admin"], activo: false })]);
    expect(i.estado).toBe("falta");
    expect(i.detalle).toContain("ninguno con rol admin");
  });

  /** La regla entera de este ítem. */
  it("admin creado que NUNCA entró: falta y bloquea", () => {
    const i = itemUsuarios([usuario({ roles: ["admin"], es_admin_principal: true, ultimo_acceso_el: null })]);
    expect(i.estado).toBe("falta");
    expect(i.bloqueante).toBe(true);
    expect(i.detalle).toContain("todavía no entró nunca");
  });

  it("admin que entró y cambió su contraseña: listo y no bloquea", () => {
    const i = itemUsuarios([usuario({ roles: ["admin"], es_admin_principal: true })]);
    expect(i.estado).toBe("listo");
    expect(i.bloqueante).toBe(false);
    expect(i.detalle).toContain("cambió su contraseña");
  });

  /**
   * Entró pero sigue con la temporal: **listo**, porque la empresa puede operar, y con acción,
   * porque esa contraseña circuló por un canal que no controlamos. Un `falta` acá bloquearía un
   * lanzamiento por algo que no lo impide.
   */
  it("entró pero sigue con la contraseña temporal: listo, con acción", () => {
    const i = itemUsuarios([usuario({ roles: ["admin"], es_admin_principal: true, debe_cambiar_password: true })]);
    expect(i.estado).toBe("listo");
    expect(i.detalle).toContain("sin cambiar");
    expect(i.accion).toBeTruthy();
  });

  /**
   * Sin admin principal marcado, alcanza con que **alguno** de los admins haya entrado. Es el caso
   * de una empresa con dos admins donde nadie marcó cuál es el principal: exigir el principal
   * dejaría el ítem en rojo para siempre.
   */
  it("sin admin principal, alcanza con que algún admin haya entrado", () => {
    const i = itemUsuarios([
      usuario({ roles: ["admin"], ultimo_acceso_el: null }),
      usuario({ roles: ["admin"] }),
    ]);
    expect(i.estado).toBe("listo");
  });

  /** Con principal marcado, manda el principal: que entre otro admin no prueba que él recibió su acceso. */
  it("con admin principal marcado, es SU acceso el que cuenta", () => {
    const i = itemUsuarios([
      usuario({ roles: ["admin"], es_admin_principal: true, ultimo_acceso_el: null }),
      usuario({ roles: ["admin"] }),
    ]);
    expect(i.estado).toBe("falta");
  });

  it("cuenta activos, admins y operativos", () => {
    const i = itemUsuarios([
      usuario({ roles: ["admin"], es_admin_principal: true }),
      usuario({ roles: ["closer"] }),
      usuario({ roles: ["setter"] }),
      usuario({ roles: ["tecnico"] }),
      usuario({ roles: ["closer"], activo: false }),
    ]);
    // 4 activos · 1 admin · 2 operativos — el desactivado no entra en ninguno.
    expect(i.detalle).toContain("4 activos");
    expect(i.detalle).toContain("1 admin");
    expect(i.detalle).toContain("2 operativos");
  });

  /**
   * `operativos` cuenta **personas**, no roles: alguien que es closer y setter a la vez es una
   * persona. Fijado con un test porque la primera versión de este archivo esperaba 2 y el código
   * decía 1 — y el código tenía razón. Es un contador de gente para saber si la empresa tiene con
   * quién operar; contar roles diría "2 operativos" sobre una sola persona.
   */
  it("alguien con dos roles operativos cuenta como UNA persona", () => {
    const i = itemUsuarios([
      usuario({ roles: ["admin"], es_admin_principal: true }),
      usuario({ roles: ["closer", "setter"] }),
    ]);
    expect(i.detalle).toContain("1 operativo");
    expect(i.detalle).not.toContain("2 operativo");
  });

  /** `roles` es `null` en filas viejas. No debe explotar ni contar como admin. */
  it("roles en null no rompe", () => {
    expect(itemUsuarios([usuario({ roles: null })]).estado).toBe("falta");
  });
});
