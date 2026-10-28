-- ============================================================
-- OMDA — Migration 0003 : MEMBRE_CATEGORIE — membre (RLS)
-- Ordre : 3 sur 3 (après les migrations 0001 et 0002).
-- À exécuter dans le SQL editor Supabase (Dashboard > SQL Editor).
-- ============================================================

-- ------------------------------------------------------------
-- 1) INSERT : le membre crée une demande de catégorie
--    supplémentaire au statut EN_ATTENTE, sur une catégorie nouvelle
--    pour SON profil (règle métier 9). Le statut est EXIGÉ à
--    l'insertion : aucun membre ne peut s'auto-attribuer ACTIVE —
--    seule la décision d'un agent OMDA active une catégorie
--    (politique membre_categorie_staff_all inchangée).
-- ------------------------------------------------------------
drop policy if exists "membre_categorie_insert_owner" on public.membre_categorie;

create policy "membre_categorie_insert_owner" on public.membre_categorie
  for insert to authenticated with check (
    membre_id in (select id from public.membre where utilisateur_id = auth.uid())
    and statut = 'EN_ATTENTE'
  );

-- ------------------------------------------------------------
-- 2) UPDATE : annulation d'une demande, UNIQUEMENT :
--    - ligne d'origine (USING) : une demande EN_ATTENTE du membre
--      connecté ;
--    - ligne résultante (WITH CHECK) : la même ligne passe à
--      ANNULEE (la mise à jour de date_activation reste libre).
--
--    LIMITES CONNUES (hors périmètre de cette migration) :
--    - la réouverture d'une demande ANNULEE ou REJETEE vers
--      EN_ATTENTE (demanderCategorieSupplementaireAvecOeuvres de
--      l'étape 23) reste bloquée par cette politique ;
--    - aucune autre écriture membre n'est ouverte sur cette table.
-- ------------------------------------------------------------
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
