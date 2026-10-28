-- 0006 — Suppression définitive des cotisations du schéma mobile OMDA.
-- À appliquer uniquement après sauvegarde et vérification des données.
-- Cette migration REFUSE de supprimer des données de cotisation existantes.
-- Si le précontrôle échoue, archiver/exporter les lignes puis traiter ce cas
-- explicitement avant de relancer. Aucun paiement ADHESION/DEPOT_OEUVRE n'est supprimé.

begin;

-- Précontrôle non destructif : arrêter la migration si des données métier
-- cotisation existent encore (cotisations, paiements ou tarifs).
do $preflight$
declare
  v_cotisations bigint := 0;
  v_paiements bigint := 0;
  v_tarifs bigint := 0;
begin
  if to_regclass('public.cotisation') is not null then
    execute 'select count(*) from public.cotisation' into v_cotisations;
  end if;
  if to_regclass('public.paiement') is not null then
    execute $q$select count(*) from public.paiement where type::text = 'COTISATION'$q$ into v_paiements;
  end if;
  if to_regclass('public.tarif') is not null then
    execute $q$select count(*) from public.tarif where type_operation::text = 'COTISATION'$q$ into v_tarifs;
  end if;

  if v_cotisations > 0 or v_paiements > 0 or v_tarifs > 0 then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Migration 0006 annulée : données de cotisation présentes (cotisation=%s, paiements=%s, tarifs=%s). Exporter/archiver ces données et les traiter explicitement avant suppression.',
        v_cotisations, v_paiements, v_tarifs
      );
  end if;
end;
$preflight$;

-- Retirer les dépendances de la table de cotisation.
do $drop_policies$
begin
  if to_regclass('public.cotisation') is not null then
    execute 'drop policy if exists "cotisation_select_owner_or_staff" on public.cotisation';
    execute 'drop policy if exists "cotisation_staff_manage" on public.cotisation';
  end if;
end;
$drop_policies$;
drop index if exists public.paiement_cotisation_reussi_unique;
drop index if exists public.paiement_adhesion_reussi_unique;
drop index if exists public.paiement_depot_reussi_unique;
drop index if exists public.tarif_actif_unique;
alter table public.paiement drop constraint if exists paiement_contexte_chk;
alter table public.paiement drop column if exists cotisation_id;
drop table if exists public.cotisation;
drop type if exists public.statut_cotisation;

-- PostgreSQL ne permet pas de retirer directement une valeur d'un ENUM.
-- Si le schéma initial contient encore COTISATION, reconstruire l'ENUM. Si le
-- schéma de référence à jour est déjà installé, ces blocs ne font rien.
do $rebuild_payment_enum$
begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'type_paiement' and e.enumlabel = 'COTISATION'
  ) then
    execute 'create type public.type_paiement_sans_cotisation as enum (''ADHESION'', ''DEPOT_OEUVRE'')';
    execute 'alter table public.paiement alter column type type public.type_paiement_sans_cotisation using type::text::public.type_paiement_sans_cotisation';
    execute 'drop type public.type_paiement';
    execute 'alter type public.type_paiement_sans_cotisation rename to type_paiement';
  end if;
end;
$rebuild_payment_enum$;

do $rebuild_tariff_enum$
begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'type_operation_tarif' and e.enumlabel = 'COTISATION'
  ) then
    execute 'create type public.type_operation_tarif_sans_cotisation as enum (''ADHESION'', ''DEPOT_OEUVRE'')';
    execute 'alter table public.tarif alter column type_operation type public.type_operation_tarif_sans_cotisation using type_operation::text::public.type_operation_tarif_sans_cotisation';
    execute 'drop type public.type_operation_tarif';
    execute 'alter type public.type_operation_tarif_sans_cotisation rename to type_operation_tarif';
  end if;
end;
$rebuild_tariff_enum$;

-- Recréer les index qui utilisent les ENUM nouvellement définis.
create unique index tarif_actif_unique
  on public.tarif (type_operation, coalesce(categorie_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where actif = true;

create unique index paiement_adhesion_reussi_unique
  on public.paiement (demande_adhesion_id)
  where type = 'ADHESION' and statut = 'REUSSI';

create unique index paiement_depot_reussi_unique
  on public.paiement (oeuvre_id)
  where type = 'DEPOT_OEUVRE' and statut = 'REUSSI';

-- La contrainte de contexte ne conserve que les deux opérations supportées.
alter table public.paiement
  add constraint paiement_contexte_chk check (
    (type = 'ADHESION' and demande_adhesion_id is not null)
    or
    (type = 'DEPOT_OEUVRE' and oeuvre_id is not null)
  );

commit;
