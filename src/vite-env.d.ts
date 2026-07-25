/// <reference types="vite/client" />

/**
 * Sin este archivo, `import.meta.env` no compila: el tsconfig no declara `types`, así que
 * gana el `ImportMeta` de @types/node, que no tiene `.env`.
 *
 * El frontend no lee ninguna variable propia: la ruta del API es `/api` por constante y el
 * "modo demo" sale del manejo de errores, no de configuración. Se deja el archivo porque
 * `vite/client` también declara los tipos de los imports de assets.
 */
interface ImportMetaEnv {
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
