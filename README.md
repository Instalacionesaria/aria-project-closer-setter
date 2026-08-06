# Comando Central

Dashboard de un equipo comercial high-ticket que opera sobre GoHighLevel. GHL ejecuta y
archiva; esto es la cabina donde los humanos ven el estado y registran decisiones.

**Stack:** React 18 + Vite 5 + TypeScript estricto · Tailwind + shadcn/ui · Vercel Functions
(Node 24) · Supabase.

## Arrancar

```bash
npm install
npm run dev
```

Para que el backend funcione hace falta un `.env.local` con las credenciales de GHL y Supabase
— pedírselas a Fabio. Sin ellas la app levanta igual, pero `api/` responde en modo stub.

```bash
npm test -- --run     # tests (offline, sin credenciales)
npx tsc -b            # typecheck
npm run build         # build de producción
```

## Documentación

**Empezá por [`docs/00-MAPA.md`](docs/00-MAPA.md)** — tiene una tabla de "tengo esta pregunta →
leo esto".

Si venís de cero, los cuatro primeros documentos alcanzan para entender el sistema:
[producto](docs/01-PRODUCTO.md) → [arquitectura](docs/02-ARQUITECTURA.md) →
[integración con GHL](docs/03-INTEGRACION-GHL.md) → [datos y relojes](docs/04-DATOS-Y-RELOJES.md).

Las reglas de trabajo y las trampas del entorno están en [`CLAUDE.md`](CLAUDE.md).

## Estructura

```
src/
  App.tsx      shell, sidebar y navegación
  views/       una vista por módulo, cargadas con React.lazy
  lib/         stores (un provider por módulo) y módulos isomorfos
  lib/ghl/     el contrato con GHL — literales, derivaciones, autoría
api/
  _lib/        la lógica; no son endpoints
  closer/  setter/  agentes/  webhooks/     los endpoints
docs/          la documentación, un archivo por tema
docs/db/       las migraciones, en orden numérico
```

## Desplegar

Push a `main`. La integración de GitHub con Vercel publica sola. **No se usa `vercel --prod`.**

Después de desplegar, confirmar que el deploy quedó Ready: un check verde de GitHub no
significa que se construyó.
