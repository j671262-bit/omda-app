-- 0007 — Renforcement du garde-fou d'insertion des paiements.
-- Corrige le comportement historique qui laissait passer tout INSERT lorsque
-- auth.uid() était NULL. Seul le rôle serveur de confiance (service_role) peut
-- créer un paiement sans utilisateur authentifié.
-- Cette migration ne confirme jamais un paiement et ne supprime aucune donnée.

begin;

create or replace function public.paiement_garde_insert_membre()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_categorie uuid;
  v_statut_oeuvre text;
  v_montant integer;
begin
  -- L'API serveur de confiance traite notamment le paiement d'adhésion.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  -- Une session absente ne doit jamais désactiver les contrôles métier.
  if auth.uid() is null then
    raise exception 'AUTHENTIFICATION_REQUISE';
  end if;

  -- Les rôles internes préexistants gardent leurs permissions de confiance.
  if public.is_agent_or_admin() then
    return new;
  end if;

  -- Un membre ne peut créer qu'un paiement initialisé pour un dépôt validé.
  new.statut := 'INITIE';
  new.reference_externe := null;
  new.motif_echec := null;
  new.date_confirmation := null;
  new.devise := 'MGA';

  if new.type::text <> 'DEPOT_OEUVRE' then
    raise exception 'TYPE_PAIEMENT_NON_AUTORISE';
  end if;

  if new.oeuvre_id is null or new.demande_adhesion_id is not null then
    raise exception 'CONTEXTE_PAIEMENT_INVALIDE';
  end if;

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
  new.membre_id := (select m.id from public.membre m where m.utilisateur_id = auth.uid());
  new.candidat_id := null;
  new.demande_adhesion_id := null;
  return new;
end;
$$;

revoke all on function public.paiement_garde_insert_membre() from public, anon, authenticated;

-- Chaque paiement doit référencer exactement le contexte correspondant à son type.
alter table public.paiement drop constraint if exists paiement_contexte_chk;
alter table public.paiement add constraint paiement_contexte_chk check (
  (type = 'ADHESION' and demande_adhesion_id is not null and oeuvre_id is null)
  or
  (type = 'DEPOT_OEUVRE' and oeuvre_id is not null and demande_adhesion_id is null)
);

commit;
