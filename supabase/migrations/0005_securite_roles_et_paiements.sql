-- 0005 — Sécurisation des rôles et retrait du paiement de cotisation.
-- À appliquer après le schéma initial et les migrations 0001 à 0004.
-- Cette migration ne supprime aucune table ni aucune donnée historique.

-- 1) Un compte créé par Supabase Auth reçoit toujours le rôle MEMBRE.
-- Les métadonnées raw_user_meta_data sont contrôlées par le client et ne
-- doivent jamais accorder un rôle privilégié.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.utilisateur (id, email, role, statut)
  values (new.id, new.email, 'MEMBRE', 'ACTIF');
  return new;
end;
$$;

-- 2) Les comptes mobiles ne peuvent plus initier de paiement de cotisation.
-- L'adhésion reste gérée par l'API de confiance ; le membre ne peut initier
-- qu'un dépôt d'œuvre validé. Le montant et le statut sont imposés ici.
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
  else
    -- ADHESION : l'API de confiance gère le paiement après validation.
    -- COTISATION et tout autre contexte sont interdits aux clients mobiles.
    raise exception 'TYPE_PAIEMENT_NON_AUTORISE';
  end if;

  return new;
end;
$$;

-- 3) Réduire l'exposition des fonctions de déclencheur : elles sont invoquées
-- par leurs triggers, pas directement par les rôles clients.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.paiement_garde_insert_membre() from public, anon, authenticated;
