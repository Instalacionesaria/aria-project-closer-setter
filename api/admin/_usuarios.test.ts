/**
 * La regla que decide qué roles puede tocar quién (ESPEC-MULTIEMPRESA §7.2).
 *
 * Es un guard de escalada de privilegios: si se afloja, un `admin` de una empresa cliente se
 * otorga `super_admin` y pasa a ver los datos de las otras cuatro. El trigger de la 023 tapa
 * el caso más grave —un super admin fuera de la empresa principal— pero un admin **de ARIA**
 * pasaría por ahí sin que nada lo frene. Esta función es el único freno.
 *
 * Se prueba la función suelta y no el endpoint entero a propósito: la regla es aritmética de
 * conjuntos y no necesita ni base ni sesión para verificarse.
 *
 * ── El guion bajo del nombre no es decorativo ─────────────────────────
 *
 * Vercel convierte en función serverless **todo** archivo `.ts` bajo `api/`, y su único filtro
 * son los que llevan `/_` o `/.` en la ruta: no excluye los tests. Sin el guion bajo, esto se
 * desplegaría como el endpoint `/api/admin/usuarios.test` con vitest empaquetado adentro. Es
 * el mismo motivo por el que el resto de los tests del backend viven en `api/_lib/`.
 *
 * El `include` de vitest (`api/**\/*.test.ts`, en vite.config.ts) lo sigue levantando igual.
 */

import { describe, expect, it } from "vitest";
import { validarRoles } from "./usuarios.js";

const ADMIN = { esSuperAdmin: false };
const SUPER = { esSuperAdmin: true };

describe("validarRoles · qué roles puede otorgar quién", () => {
  describe("lo que vale para todos", () => {
    it("exige al menos un rol", () => {
      expect(validarRoles([], SUPER)?.codigo).toBe("sin_roles");
    });

    it("corta en 4 roles", () => {
      const cinco = ["closer", "setter", "tecnico", "media_buyer", "admin"];
      expect(validarRoles(cinco, SUPER)?.codigo).toBe("demasiados_roles");
    });

    it("rechaza un rol inventado", () => {
      expect(validarRoles(["contador"], SUPER)?.codigo).toBe("rol_invalido");
    });

    it("rechaza un rol repetido", () => {
      expect(validarRoles(["closer", "closer"], SUPER)?.codigo).toBe("rol_repetido");
    });
  });

  describe("un admin común", () => {
    it("puede otorgar los cuatro roles operativos", () => {
      expect(validarRoles(["closer", "setter", "tecnico", "media_buyer"], ADMIN)).toBeNull();
    });

    it("NO puede crear un super_admin", () => {
      const r = validarRoles(["super_admin"], ADMIN);
      expect(r?.codigo).toBe("rol_no_permitido");
      expect(r?.status).toBe(403);
    });

    it("NO puede crear otro admin", () => {
      expect(validarRoles(["admin"], ADMIN)?.codigo).toBe("rol_no_permitido");
    });

    it("NO puede ascender a admin a alguien que era closer", () => {
      expect(validarRoles(["closer", "admin"], ADMIN, ["closer"])?.codigo).toBe("rol_no_permitido");
    });

    /**
     * El bug del 2026-08-07. La versión anterior miraba la lista y no el cambio, así que
     * cualquier edición sobre un admin —incluso corregirle una tilde al nombre— viajaba con
     * `admin` en el array y se comía un 403 que hablaba de roles. Un admin no podía editar ni
     * su propia cuenta.
     */
    it("SÍ puede editar a alguien que YA era admin, sin tocarle ese rol", () => {
      expect(validarRoles(["admin"], ADMIN, ["admin"])).toBeNull();
    });

    it("puede agregarle un rol operativo a un admin existente", () => {
      expect(validarRoles(["admin", "closer"], ADMIN, ["admin"])).toBeNull();
    });

    it("puede quitarle un rol operativo a un admin existente", () => {
      expect(validarRoles(["admin"], ADMIN, ["admin", "closer"])).toBeNull();
    });

    /** Degradar al admin principal de la empresa es tan grave como ascenderse. */
    it("NO puede quitarle el rol admin a un admin", () => {
      const r = validarRoles(["closer"], ADMIN, ["admin", "closer"]);
      expect(r?.codigo).toBe("rol_no_permitido");
      expect(r?.error).toContain("quitar");
    });

    it("NO puede cambiar admin por super_admin de una", () => {
      expect(validarRoles(["super_admin"], ADMIN, ["admin"])?.codigo).toBe("rol_no_permitido");
    });

    /**
     * El orden y los repetidos no pueden cambiar el veredicto: si lo hicieran, mandar
     * `["closer", "admin"]` en vez de `["admin", "closer"]` sería una forma de saltear la regla.
     */
    it("no depende del orden de la lista", () => {
      expect(validarRoles(["closer", "admin"], ADMIN, ["admin", "closer"])).toBeNull();
      expect(validarRoles(["admin", "closer"], ADMIN, ["closer", "admin"])).toBeNull();
    });
  });

  describe("el super admin", () => {
    it("puede otorgar super_admin", () => {
      expect(validarRoles(["super_admin"], SUPER)).toBeNull();
    });

    it("puede degradar a un admin a rol operativo", () => {
      expect(validarRoles(["closer"], SUPER, ["admin"])).toBeNull();
    });

    it("igual no se salta el tope de roles", () => {
      expect(validarRoles(["super_admin", "admin", "closer", "setter", "tecnico"], SUPER)?.codigo).toBe(
        "demasiados_roles",
      );
    });
  });
});
