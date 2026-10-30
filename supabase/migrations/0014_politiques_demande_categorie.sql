-- 0014 — Demande de catégorie par un membre : politiques RLS de membre_categorie
-- À exécuter dans l'éditeur SQL de Supabase. Idempotent : relançable sans risque.
-- Objectif : permettre à un membre de
--   1) créer une demande de catégorie au statut EN_ATTENTE (jamais ACTIVE) ;
--   2) annuler sa demande EN_ATTENTE (=> ANNULEE) ;
--   3) rouvrir une demande ANNULEE ou REJETEE (=> EN_ATTENTE).
-- Seul un agent/administrateur peut activer une catégorie (politique membre_categorie_staff_all).

alter table public.membre_categorie enable row level security;
grant select, insert, update on public.membre_categorie to authenticated;

-- 1) Lecture de ses propres appartenances (nécessaire pour retourner la ligne après INSERT/UPDATE)
drop policy if exists "membre_categorie_select" on public.membre_categorie;
create policy "membre_categorie_select" on public.membre_categorie
  for select to authenticated using (
    membre_id in (select id from public.membre where utilisateur_id = auth.uid())
    or public.is_agent_or_admin()
  );

-- 2) Création d'une demande
drop policy if exists "membre_categorie_insert_owner" on public.membre_categorie;
create policy "membre_categorie_insert_owner" on public.membre_categorie
  for insert to authenticated with check (
    membre_id in (select id from public.membre where utilisateur_id = auth.uid())
    and statut = 'EN_ATTENTE'
  );

-- 3) Annulation d'une demande en attente
drop policy if exists "membre_categorie_update_owner_annulation" on public.membre_categorie;
create policy "membre_categorie_update_owner_annulation" on public.membre_categorie
  for update to authenticated
  using (
    membre_id in (select id from public.membre where utilisateur_id = auth.uid())
    and statut = 'EN_ATTENTE'
  )
  with check (
    membre_id in (select id from public.membre where utilisateur_id = auth.uid())
    and statut = 'ANNULEE'
  );

-- 4) Réouverture d'une demande annulée ou rejetée
drop policy if exists "membre_categorie_update_owner_reouverture" on public.membre_categorie;
create policy "membre_categorie_update_owner_reouverture" on public.membre_categorie
  for update to authenticated
  using (
    membre_id in (select id from public.membre where utilisateur_id = auth.uid())
    and statut in ('ANNULEE', 'REJETEE')
  )
  with check (
    membre_id in (select id from public.membre where utilisateur_id = auth.uid())
    and statut = 'EN_ATTENTE'
  );

-- Vérification : doit lister 5 politiques
select policyname, cmd from pg_policies
where schemaname = 'public' and tablename = 'membre_categorie' order by policyname;
