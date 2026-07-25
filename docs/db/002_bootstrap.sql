-- ============================================================================
-- Migración 002 · Datos base del módulo Closer
--
-- Una organización y un closer. Sin esto, `closer_seguimientos.closer_id` no tiene a qué
-- apuntar y el primer Avanzar falla con un error de FK poco descriptivo.
--
-- Idempotente: `on conflict do nothing`. Se puede volver a correr.
-- ============================================================================

-- Org única mientras no haya multi-tenant. El UUID está fijo a propósito y replicado en
-- `api/_lib/repo.ts` como ORG_ID — si cambia acá, cambia allá.
insert into closer_org_config (org_id, zona_horaria, canales_sin_seguimiento_automatico)
values (
  '00000000-0000-0000-0000-000000000001',
  'America/Lima',
  -- Instagram fuera del seguimiento automático: no tiene bot ni workflow (§11).
  -- Vaciar este array lo re-habilita en la UI sin necesidad de desplegar.
  array['instagram']
)
on conflict (org_id) do nothing;

-- Closer por defecto. Reemplaza el `CURRENT_CLOSER_NAME = "Diego M."` que está hardcodeado
-- en closerStore.tsx. `ghl_user_id` queda null hasta que sepamos el id real del usuario en
-- GHL — no se inventa, y sin él la atribución por closer sigue siendo de un solo usuario.
insert into closer_usuarios (id, org_id, nombre, rol)
values (
  '00000000-0000-0000-0000-0000000000c1',
  '00000000-0000-0000-0000-000000000001',
  'Diego M.',
  'closer'
)
on conflict (id) do nothing;
