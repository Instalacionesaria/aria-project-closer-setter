/// <reference types="vite/client" />

/**
 * Sin este archivo, `import.meta.env` no compila: el tsconfig no declara `types`,
 * así que gana el `ImportMeta` de @types/node, que no tiene `.env`.
 */
interface ImportMetaEnv {
  /** Ver `.env.example`. Sin definir = modo `seed` (demo en memoria, sin red). */
  readonly VITE_SEGUIMIENTOS_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
