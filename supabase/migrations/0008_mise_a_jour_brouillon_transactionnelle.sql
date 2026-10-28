-- Mise à jour atomique d'un brouillon candidat, appelée uniquement par l'API serveur.
-- La vérification du code de suivi est effectuée par le serveur avant cet appel.
create or replace function public.omda_mettre_a_jour_brouillon(
  p_demande_id uuid,
  p_candidat_id uuid,
  p_identite jsonb default '{}'::jsonb,
  p_categorie_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demande public.demande_adhesion%rowtype;
  v_candidat public.candidat%rowtype;
begin
  select * into v_demande
  from public.demande_adhesion
  where id = p_demande_id and candidat_id = p_candidat_id
  for update;

  if not found then
    raise exception 'DEMANDE_INTROUVABLE' using errcode = 'P0002';
  end if;
  if v_demande.statut <> 'BROUILLON' then
    raise exception 'DEMANDE_NON_MODIFIABLE' using errcode = 'P0001';
  end if;

  select * into v_candidat from public.candidat where id = p_candidat_id for update;
  if not found then
    raise exception 'CANDIDAT_INTROUVABLE' using errcode = 'P0002';
  end if;

  update public.candidat set
    nom = coalesce(nullif(btrim(p_identite->>'nom'), ''), nom),
    prenom = coalesce(nullif(btrim(p_identite->>'prenom'), ''), prenom),
    date_naissance = coalesce(nullif(p_identite->>'date_naissance', '')::date, date_naissance),
    cin = coalesce(nullif(btrim(p_identite->>'cin'), ''), cin),
    telephone = coalesce(nullif(btrim(p_identite->>'telephone'), ''), telephone),
    email = coalesce(nullif(lower(btrim(p_identite->>'email')), ''), email),
    adresse = coalesce(nullif(btrim(p_identite->>'adresse'), ''), adresse),
    updated_at = now()
  where id = p_candidat_id;

  if p_categorie_id is not null then
    if not exists (select 1 from public.categorie where id = p_categorie_id and actif = true) then
      raise exception 'CATEGORIE_INDISPONIBLE' using errcode = 'P0001';
    end if;
    update public.demande_adhesion set categorie_id = p_categorie_id, updated_at = now()
    where id = p_demande_id;
  else
    update public.demande_adhesion set updated_at = now() where id = p_demande_id;
  end if;

  return jsonb_build_object(
    'demande_id', v_demande.id,
    'numero_dossier', v_demande.numero_dossier,
    'statut', v_demande.statut,
    'created_at', v_demande.created_at
  );
end;
$$;

revoke all on function public.omda_mettre_a_jour_brouillon(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.omda_mettre_a_jour_brouillon(uuid, uuid, jsonb, uuid) to service_role;
