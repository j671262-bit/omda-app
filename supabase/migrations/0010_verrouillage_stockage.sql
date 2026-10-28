-- 0010 — Verrouillage du stockage (buckets `pieces` et `oeuvres`).
--
-- Problème corrigé : le schéma initial créait des politiques `to public` avec
-- `using (bucket_id = 'pieces')` (lecture ET dépôt). Avec la clé anonyme, qui est
-- embarquée dans l'application, n'importe qui pouvait lister et télécharger les
-- pièces d'identité (CIN, photos, actes de naissance, autorisations parentales)
-- et déposer des fichiers en contournant les contrôles du serveur.
--
-- Nouveau modèle :
--   * le serveur de confiance (clé `service_role`) contourne RLS : il continue de
--     déposer les fichiers des candidats (chemins `<bucket>/<uuid aléatoire>/…`) ;
--   * un membre ne peut déposer, remplacer et supprimer que dans SON dossier
--     `<bucket>/<id utilisateur>/…` (l'application préfixe désormais ses chemins) ;
--   * un membre peut LIRE son dossier, ainsi que les fichiers référencés par ses
--     œuvres, attestations et pièces d'adhésion (dont ceux déposés par le serveur) ;
--   * agents et administrateurs lisent tout ; les anonymes n'ont aucun accès.
-- Cette migration ne supprime aucun objet ni aucune donnée.

begin;

-- 1) Retrait des politiques publiques (noms du schéma initial).
drop policy if exists "Autoriser upload pieces" on storage.objects;
drop policy if exists "Autoriser lecture pieces" on storage.objects;
drop policy if exists "Autoriser upload oeuvres" on storage.objects;
drop policy if exists "Autoriser lecture oeuvres" on storage.objects;

-- 2) Qui peut lire un objet ? (SECURITY DEFINER : lit les tables sans dépendre de leur RLS.)
create or replace function public.stockage_objet_lisible(p_bucket text, p_nom text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    public.is_agent_or_admin()
    -- dossier personnel du membre
    or split_part(p_nom, '/', 1) = auth.uid()::text
    -- fichier d'une de ses œuvres (directement ou via sa demande d'adhésion)
    or exists (
      select 1
        from public.oeuvre o
        left join public.demande_adhesion d on d.id = o.demande_adhesion_id
        join public.membre m on m.id = coalesce(o.membre_id, d.membre_id)
       where m.utilisateur_id = auth.uid()
         and o.chemin_fichier = p_bucket || '/' || p_nom
    )
    -- attestation de diffusion d'une de ses œuvres
    or exists (
      select 1
        from public.attestation_diffusion a
        join public.oeuvre o on o.id = a.oeuvre_id
        left join public.demande_adhesion d on d.id = o.demande_adhesion_id
        join public.membre m on m.id = coalesce(o.membre_id, d.membre_id)
       where m.utilisateur_id = auth.uid()
         and a.chemin_stockage = p_bucket || '/' || p_nom
    )
    -- pièce de sa demande d'adhésion
    or exists (
      select 1
        from public.piece p
        join public.demande_adhesion d on d.id = p.demande_adhesion_id
        join public.membre m on m.id = d.membre_id
       where m.utilisateur_id = auth.uid()
         and p.chemin_stockage = p_bucket || '/' || p_nom
    )
  );
$$;

revoke all on function public.stockage_objet_lisible(text, text) from public, anon;
grant execute on function public.stockage_objet_lisible(text, text) to authenticated;

-- 3) Nouvelles politiques (idempotentes).
drop policy if exists "stockage_lecture_proprietaire_ou_personnel" on storage.objects;
create policy "stockage_lecture_proprietaire_ou_personnel" on storage.objects
  for select to authenticated
  using (bucket_id in ('pieces', 'oeuvres') and public.stockage_objet_lisible(bucket_id, name));

drop policy if exists "stockage_depot_dossier_personnel" on storage.objects;
create policy "stockage_depot_dossier_personnel" on storage.objects
  for insert to authenticated
  with check (bucket_id in ('pieces', 'oeuvres') and split_part(name, '/', 1) = auth.uid()::text);

drop policy if exists "stockage_remplacement_dossier_personnel" on storage.objects;
create policy "stockage_remplacement_dossier_personnel" on storage.objects
  for update to authenticated
  using (bucket_id in ('pieces', 'oeuvres') and split_part(name, '/', 1) = auth.uid()::text)
  with check (bucket_id in ('pieces', 'oeuvres') and split_part(name, '/', 1) = auth.uid()::text);

drop policy if exists "stockage_suppression_dossier_personnel" on storage.objects;
create policy "stockage_suppression_dossier_personnel" on storage.objects
  for delete to authenticated
  using (bucket_id in ('pieces', 'oeuvres') and split_part(name, '/', 1) = auth.uid()::text);

commit;
