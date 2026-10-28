-- ============================================================
-- OMDA — Migration 0002 : ATTESTATION_DIFFUSION — membre (RLS)
-- Ordre : 2 sur 3 (après la migration 0001).
-- À exécuter dans le SQL editor Supabase (Dashboard > SQL Editor).
-- ============================================================

-- Propriétaire = membre de l'œuvre (oeuvre.membre_id relié à
-- auth.uid() via membre.utilisateur_id). Aucun DELETE n'est ouvert :
-- le remplacement de l'attestation est un UPDATE en place.

-- ------------------------------------------------------------
-- 1) SELECT : propriétaire de l'œuvre (politique du schéma
--    initial, recréée à l'identique — sans elle, la lecture des
--    attestations du membre serait impossible).
-- ------------------------------------------------------------
drop policy if exists "attestation_select_owner_or_staff" on public.attestation_diffusion;

create policy "attestation_select_owner_or_staff" on public.attestation_diffusion
  for select to authenticated using (
    oeuvre_id in (
      select id from public.oeuvre
      where membre_id in (select id from public.membre where utilisateur_id = auth.uid())
    )
    or public.is_agent_or_admin()
  );

-- ------------------------------------------------------------
-- 2) INSERT : le propriétaire joint une attestation à SON œuvre
--    (dépôt initial, règle métier 8).
-- ------------------------------------------------------------
drop policy if exists "attestation_insert_owner" on public.attestation_diffusion;

create policy "attestation_insert_owner" on public.attestation_diffusion
  for insert to authenticated with check (
    oeuvre_id in (
      select id from public.oeuvre
      where membre_id in (select id from public.membre where utilisateur_id = auth.uid())
    )
    or public.is_agent_or_admin()
  );

-- ------------------------------------------------------------
-- 3) UPDATE : remplacement de l'attestation par le propriétaire
--    (jamais de DELETE). WITH CHECK identique : impossible de
--    rattacher l'attestation à l'œuvre d'un autre membre.
-- ------------------------------------------------------------
drop policy if exists "attestation_update_owner" on public.attestation_diffusion;

create policy "attestation_update_owner" on public.attestation_diffusion
  for update to authenticated
  using (
    oeuvre_id in (
      select id from public.oeuvre
      where membre_id in (select id from public.membre where utilisateur_id = auth.uid())
    )
    or public.is_agent_or_admin()
  )
  with check (
    oeuvre_id in (
      select id from public.oeuvre
      where membre_id in (select id from public.membre where utilisateur_id = auth.uid())
    )
    or public.is_agent_or_admin()
  );

-- ------------------------------------------------------------
-- 4) Contrainte CHECK sur le type MIME : PDF, JPEG ou PNG
--    uniquement (formats d'attestation de l'application).
--    Idempotente ; toute ligne existante d'un autre format ferait
--    échouer l'ajout : corrigez d'abord les données, puis
--    relancez cette migration.
-- ------------------------------------------------------------
alter table public.attestation_diffusion
  drop constraint if exists attestation_diffusion_mime_chk;

alter table public.attestation_diffusion
  add constraint attestation_diffusion_mime_chk
  check (mime_type in ('application/pdf','image/jpeg','image/png'));
