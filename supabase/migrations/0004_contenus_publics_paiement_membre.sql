-- 0004 — Passage 100 % réel : opérateurs Mobile Money, garde-fous des paiements
-- du membre et protection des colonnes sensibles de `utilisateur`.
--
-- À exécuter dans l'éditeur SQL de Supabase, APRÈS le script initial
-- (docs/SCHEMA_DB.md) et les migrations 0001 → 0003. Idempotent : peut être
-- relancé sans risque.
--
-- Trois sections indépendantes :
--   1) table `operateur_mobile_money` (lue par l'application, absente du script initial) ;
--   2) garde-fou d'INSERT sur `paiement` : le montant et le statut sont imposés par la base ;
--   3) protection de `utilisateur` : un membre ne peut pas changer son rôle ni son statut.

-- ---------------------------------------------------------------------------
-- 1) Opérateurs Mobile Money
-- ---------------------------------------------------------------------------
create table if not exists public.operateur_mobile_money (
  code        operateur_paiement primary key,
  libelle     text not null,
  actif       boolean not null default true,
  ordre       integer not null default 0,
  updated_at  timestamptz not null default now()
);

alter table public.operateur_mobile_money enable row level security;

drop policy if exists "operateur_mobile_money_select_public" on public.operateur_mobile_money;
create policy "operateur_mobile_money_select_public" on public.operateur_mobile_money
  for select to public using (actif = true or public.is_agent_or_admin());

drop policy if exists "operateur_mobile_money_admin_all" on public.operateur_mobile_money;
create policy "operateur_mobile_money_admin_all" on public.operateur_mobile_money
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

grant select on public.operateur_mobile_money to anon, authenticated;

insert into public.operateur_mobile_money (code, libelle, actif, ordre)
values ('MVOLA', 'MVola', true, 1)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2) Paiements initiés par un membre : la base impose montant et statut
--    (la politique RLS d'INSERT du script initial vérifie seulement l'appartenance).
--    Les écritures du serveur (clé service_role, sans utilisateur) et du
--    personnel OMDA ne sont pas modifiées.
-- ---------------------------------------------------------------------------
create or replace function public.paiement_garde_insert_membre()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_categorie uuid;
  v_statut_oeuvre text;
  v_montant integer;
begin
  if auth.uid() is null or public.is_agent_or_admin() then
    return new;
  end if;

  -- Un utilisateur connecté ne crée qu'un paiement « INITIE » : la confirmation
  -- (REUSSI / ECHEC) est écrite par le serveur, jamais par l'application.
  new.statut := 'INITIE';
  new.reference_externe := null;
  new.motif_echec := null;
  new.date_confirmation := null;
  new.devise := 'MGA';

  if new.type::text = 'DEPOT_OEUVRE' then
    select o.categorie_id, o.statut::text
      into v_categorie, v_statut_oeuvre
      from public.oeuvre o
      join public.membre m on m.id = o.membre_id
     where o.id = new.oeuvre_id
       and m.utilisateur_id = auth.uid();
    if not found then
      raise exception 'OEUVRE_INTROUVABLE';
    end if;
    if v_statut_oeuvre <> 'VALIDEE' then
      raise exception 'OEUVRE_NON_VALIDEE';
    end if;

    select t.montant
      into v_montant
      from public.tarif t
     where t.type_operation::text = 'DEPOT_OEUVRE'
       and t.actif
       and (t.date_debut is null or t.date_debut <= current_date)
       and (t.date_fin is null or t.date_fin >= current_date)
       and (t.categorie_id = v_categorie or t.categorie_id is null)
     order by (t.categorie_id is null) asc
     limit 1;
    if v_montant is null then
      raise exception 'TARIF_INDISPONIBLE';
    end if;
    new.montant := v_montant;

  elsif new.type::text = 'COTISATION' then
    select c.montant
      into v_montant
      from public.cotisation c
      join public.membre m on m.id = c.membre_id
     where c.id = new.cotisation_id
       and m.utilisateur_id = auth.uid()
       and c.statut::text <> 'PAYEE';
    if v_montant is null then
      raise exception 'COTISATION_INTROUVABLE_OU_PAYEE';
    end if;
    new.montant := v_montant;

  else
    -- L'adhésion se règle par l'API Express (clé service_role), pas depuis un compte.
    raise exception 'TYPE_PAIEMENT_NON_AUTORISE';
  end if;

  return new;
end;
$$;

drop trigger if exists paiement_garde_insert_membre on public.paiement;
create trigger paiement_garde_insert_membre
  before insert on public.paiement
  for each row execute function public.paiement_garde_insert_membre();

-- ---------------------------------------------------------------------------
-- 3) Protection des colonnes sensibles de `utilisateur`
--    La politique `utilisateur_update_self_or_admin` autorise la mise à jour de
--    TOUTE la ligne de l'utilisateur : sans ce garde-fou, un membre pourrait se
--    donner le rôle ADMINISTRATEUR depuis l'API. Seul le téléphone (et les
--    horodatages) reste modifiable ; `doit_changer_mot_de_passe` ne peut passer
--    que de vrai à faux (changement de mot de passe effectué).
-- ---------------------------------------------------------------------------
create or replace function public.utilisateur_protege_colonnes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.role is distinct from old.role
     or new.statut is distinct from old.statut then
    raise exception 'MODIFICATION_NON_AUTORISEE';
  end if;

  if new.doit_changer_mot_de_passe is distinct from old.doit_changer_mot_de_passe
     and not (old.doit_changer_mot_de_passe = true and new.doit_changer_mot_de_passe = false) then
    raise exception 'MODIFICATION_NON_AUTORISEE';
  end if;

  return new;
end;
$$;

drop trigger if exists utilisateur_protege_colonnes on public.utilisateur;
create trigger utilisateur_protege_colonnes
  before update on public.utilisateur
  for each row execute function public.utilisateur_protege_colonnes();
