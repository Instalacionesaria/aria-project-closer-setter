# Estado del proyecto — Comando Central

**Última actualización: 2026-07-25.** Este documento dice qué está hecho, qué está a medias
y qué no existe. Se actualiza en cada sesión de trabajo.

> Para el **porqué** de las decisiones: `CLAUDE.md` §50 y
> `docs/CONTEXTO-Seguimiento-Closer-Backend.md`.
> Para el **esquema de la base**: `docs/db/README.md`.
> Para **armar los webhooks en GHL**: `docs/WEBHOOKS-GHL-para-Francisco.md`.

---

## Resumen en una línea

El **frontend está completo** desde hace tiempo. El **backend recién arranca**: de todo el
producto, hoy solo la sección *Seguimientos* del closer escribe y lee de verdad.

---

## Infraestructura — lista

| Pieza | Estado |
|---|---|
| Base de datos (Supabase SOFIA, 9 tablas `closer_*`) | ✅ Aplicada y verificada |
| Integración con GHL (lectura y escritura) | ✅ Funcionando en producción |
| Despliegue automático (push a `main` → Vercel) | ✅ Funcionando |
| Diagnóstico (`/api/diagnostico`) | ✅ `ok: true` |
| Tests | ✅ 91 unitarios + 10 de integración |

---

## Módulo Closer

### Mi Día

| Sección | Backend | Notas |
|---|---|---|
| **Seguimientos de hoy** | ✅ Completo | Lee, escribe, persiste, y escribe tags y campos en GHL |
| **Agenda de Hoy** | 🟡 A medias | La tabla y la consulta existen; falta que el endpoint la sirva y el front la lea. Necesita el webhook de cita |
| **Respondieron / Buzón** | 🟡 A medias | Igual que Agenda: la lógica está en la vista SQL, falta servirla. Necesita los webhooks de mensaje |
| **Completadas Hoy** | 🟡 A medias | Se calcula en la vista; falta exponerla |
| **Intervenciones urgentes** | ❌ Sin backend | **Fuera de alcance por decisión de Francisco** — lo toma otra persona |

### Avanzar (las 6 salidas)

| Salida | Estado |
|---|---|
| Seguimiento | ✅ Completo, probado contra GHL real |
| Venta · Acordó comprar · No le interesa · No-show · Nurture | 🟡 Mapeadas, sin ejecutar |

El catálogo `src/lib/ghl/resultados.ts` ya tiene, para las 6, su tag, su custom field y sus
opciones. Falta generalizar el caso de uso —hoy solo sabe registrar Seguimiento— y quitar el
`501`.

⚠️ **Hueco conocido en Venta**: el monto tiene que llegar al *Opportunity Value* de GHL, y no
hay ningún custom field documentado para eso. O se crea uno, o hay que llamar a la API de
oportunidades. Sin resolver.

### La ficha del contacto

| Tab | Estado |
|---|---|
| **Notas** | 🟡 Tabla creada, sin endpoint ni lectura. Es lo que pidió Francisco para que el closer conserve sus apuntes |
| **Historial** | 🟡 A medias — los eventos **sí se escriben** en la base, pero la ficha muestra un array fijo. Falta el camino de vuelta |
| **Perfil** | ❌ Seed. Los custom fields ya están mapeados, así que sería directo |
| **Chat** | ❌ Seed, y peor: un único array compartido por *todos* los contactos |
| **Llamada** | ❌ Seed |
| Enviar un mensaje | ❌ Solo actualiza la pantalla |

### Otras vistas del closer

- **Pipeline**: seed.
- **Inicio (cockpit)**: números literales en el código; solo se mueven con lo registrado en
  la sesión.

---

## Webhooks

**El endpoint está construido y desplegado** (`/api/webhooks/ghl`) y entiende 8 eventos.
Guarda todo crudo antes de interpretarlo, así que nada se pierde aunque el mapeo falle.

**Falta crearlos en GHL** — es trabajo de Francisco, con la ficha exacta de cada uno en
`docs/WEBHOOKS-GHL-para-Francisco.md`.

También existe `/api/closer/sincronizar`, que barre GHL y trae todos los contactos con
`zona_closer`. Es la red de seguridad si un webhook se pierde, y lo que carga los contactos
que ya tenían el tag desde antes.

---

## Lo que no tiene nada de backend

- **Módulo Setter completo** — ni una línea. Sus dos series están mapeadas pero nada las
  dispara.
- **Auditoría de Agentes** — todo seed, incluidos los conteos.
- **Gerencia** — dos objetos fijos en el código; el selector de rango no está conectado.
- **Ajustes** — `localStorage`, solo en el navegador de cada uno. El catálogo de enlaces, las
  comisiones y las sugerencias no se comparten.
- **Autenticación** — no existe. El closer está fijo como "Diego M." y el rol se cambia
  haciendo clic.
- **La IA que redacta los toques** — era parte del pedido original y sigue sin construirse.
  Es también la única parte con costo por uso.

---

## Decisiones que hay que tomar

| Qué | Quién |
|---|---|
| El valor del `X-Webhook-Secret` | Francisco |
| Confirmar los merge fields de cita de GHL | Francisco |
| `descalificado` se pinta de **tres formas** distintas: `NO LE INTERESA · X` (Avanzar), `DESCALIFICADO · X` (contrato §4 y §39.5) y `NO INTERESADO · PRECIO` (semilla) | Francisco |
| Cómo llega el monto de la venta al *Opportunity Value* | Francisco |
| `seguimiento_terminado` existe en la cuenta y no está en el contrato — parece el disparador de "serie agotada" | Francisco |
| `seguimiento: 1a/1b/2a/2b/3a/3b` parecen marcar cada toque; si es así, evitan depender de webhooks | Francisco |
| El contrato se contradice sobre `cita_agendada`: §9 dice que se quita al cerrar la cita, §8 dice que no | Francisco |

---

## Orden sugerido para seguir

1. **Crear los webhooks en GHL** (Francisco) y probar con un contacto de prueba. Es lo que
   destraba Agenda, Respondieron y Buzón, que ya tienen su lógica escrita.
2. **Servir el resto de las secciones de Mi Día** desde la vista `closer_mi_dia`, que ya las
   calcula.
3. **Las 5 salidas restantes de Avanzar** — el catálogo está hecho, es generalizar el caso de
   uso.
4. **Notas e Historial** en la ficha.
5. Después: Perfil, Chat real, y el módulo Setter.

---

## Cosas operativas que conviene no olvidar

- **Los datos de demostración empiezan con `EJEMPLO`.** Si ves un contacto sin ese prefijo,
  es real y viene de GHL.
- **El commit lo tiene que firmar `instalacionesariaia@gmail.com`** o Vercel bloquea el
  build *y marca el deploy como exitoso igual*. Detalle en `CLAUDE.md` §50.8.
- **Los imports de `api/` llevan extensión `.js`.** `tsc` no lo detecta; falla solo en
  producción. `CLAUDE.md` §50.9.
- **`CONTRATO-GHL.md` no está en el repo** — está en `.gitignore`. Pedírselo a Francisco.
- **Rotar credenciales**: el token de Supabase y el de GHL circularon por un chat. Conviene
  regenerarlos.
