-- ============================================================
-- OMDA — Migration 0001 : OEUVRE — écritures du membre (RLS)
-- Ordre : 1 sur 3 (après le script initial de docs/SCHEMA_DB.md).
-- À exécuter dans le SQL editor Supabase (Dashboard > SQL Editor).
-- ============================================================

-- ------------------------------------------------------------
-- 1) INSERT : déjà présent dans le schéma initial — VÉRIFICATION.
--    Le membre ne crée des œuvres que pour lui-même ; le parcours
--    candidat (œuvres d'un dossier d'adhésion) reste couvert par la
--    même politique. Rien à recréer ici si le script initial a tenu.
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'oeuvre'
      and policyname = 'oeuvre_insert_owner_or_staff'
  ) then
    raise exception 'Politique oeuvre_insert_owner_or_staff introuvable : exécutez d''abord le script initial de docs/SCHEMA_DB.md.';
  end if;
  raise notice 'Vérification OK : oeuvre_insert_owner_or_staff présente (INSERT membre déjà autorisé).';
end $$;

-- ------------------------------------------------------------
-- 2) UPDATE : le membre modifie uniquement SES œuvres
--    (membre_id du membre lié à auth.uid()) et uniquement tant que
--    le statut est modifiable : BROUILLON, ENVOYEE,
--    EN_COURS_DE_VALIDATION.
--    Les deux côtés sont contrôlés (USING sur la ligne d'origine,
--    WITH CHECK sur la ligne résultante) : le membre ne peut ni
--    toucher une œuvre déjà statuée (VALIDEE, REJETEE,
--    DEPOT_FINALISE) ni faire sortir le statut de cette liste —
--    la transition BROUILLON vers ENVOYEE de soumettreOeuvre reste
--    autorisée. La politique agents existante (oeuvre_update_staff)
--    est conservée à côté (politiques permissives cumulables).
-- ------------------------------------------------------------
drop policy if exists "oeuvre_update_owner_modifiable" on public.oeuvre;

create policy "oeuvre_update_owner_modifiable" on public.oeuvre
  for update to authenticated
  using (
    membre_id in (select id from public.membre where utilisateur_id = auth.uid())
    and statut in ('BROUILLON', 'ENVOYEE', 'EN_COURS_DE_VALIDATION')
  )
  with check (
    membre_id in (select id from public.membre where utilisateur_id = auth.uid())
    and statut in ('BROUILLON', 'ENVOYEE', 'EN_COURS_DE_VALIDATION')
  );
