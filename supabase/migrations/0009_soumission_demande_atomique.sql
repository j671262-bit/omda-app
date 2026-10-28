-- Soumission atomique d'une demande candidat : pièces, œuvres, attestations et statut.
-- À appliquer après sauvegarde et vérification de l'environnement Supabase.

create table if not exists public.omda_envoi_idempotence (
  cle text primary key,
  demande_adhesion_id uuid not null references public.demande_adhesion(id) on delete cascade,
  reponse jsonb not null,
  created_at timestamptz not null default now()
);

revoke all on table public.omda_envoi_idempotence from public, anon, authenticated;

create or replace function public.omda_soumettre_demande(
  p_demande_id uuid,
  p_candidat_id uuid,
  p_categorie_id uuid,
  p_pieces jsonb,
  p_oeuvres jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demande public.demande_adhesion%rowtype;
  v_candidat public.candidat%rowtype;
  v_oeuvre jsonb;
  v_fichier jsonb;
  v_oeuvre_id uuid;
  v_age integer;
  v_date timestamptz;
  v_reponse jsonb;
  v_existante public.omda_envoi_idempotence%rowtype;
  v_piece_count integer;
  v_has_photo boolean;
  v_has_cin boolean;
  v_has_parental boolean;
begin
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) < 8 or length(p_idempotency_key) > 200 then
    raise exception 'CLE_IDEMPOTENCE_INVALIDE' using errcode = '22023';
  end if;
  if jsonb_typeof(p_pieces) <> 'array' or jsonb_typeof(p_oeuvres) <> 'array' or jsonb_array_length(p_oeuvres) < 2 then
    raise exception 'DOSSIER_INCOMPLET' using errcode = '22023';
  end if;

  select * into v_demande from public.demande_adhesion
  where id = p_demande_id and candidat_id = p_candidat_id for update;
  if not found then raise exception 'DEMANDE_INTROUVABLE' using errcode = 'P0002'; end if;

  select * into v_existante from public.omda_envoi_idempotence where cle = p_idempotency_key;
  if found then
    if v_existante.demande_adhesion_id <> p_demande_id then
      raise exception 'CLE_IDEMPOTENCE_DEJA_UTILISEE' using errcode = '23505';
    end if;
    return v_existante.reponse;
  end if;
  if v_demande.statut <> 'BROUILLON' then raise exception 'DEMANDE_NON_MODIFIABLE' using errcode = 'P0001'; end if;

  select * into v_candidat from public.candidat where id = p_candidat_id for update;
  if not found then raise exception 'CANDIDAT_INTROUVABLE' using errcode = 'P0002'; end if;
  v_age := extract(year from age(current_date, v_candidat.date_naissance));
  if v_age < 15 then raise exception 'AGE_INSUFFISANT' using errcode = 'P0001'; end if;

  if not exists (select 1 from public.categorie where id = p_categorie_id and actif = true) then
    raise exception 'CATEGORIE_INDISPONIBLE' using errcode = 'P0001';
  end if;

  select count(*), bool_or(type = 'PHOTO'), bool_or(type = 'CIN'), bool_or(type = 'AUTORISATION_PARENTALE')
    into v_piece_count, v_has_photo, v_has_cin, v_has_parental
  from jsonb_to_recordset(p_pieces) as x(type text, chemin_stockage text, mime_type text, taille_octets integer)
  where type in ('PHOTO','CIN','ACTE_NAISSANCE','CERTIFICAT_RESIDENCE','AUTORISATION_PARENTALE','AUTRE')
    and chemin_stockage like 'pieces/%'
    and mime_type in ('application/pdf','image/jpeg','image/png')
    and taille_octets between 1 and 20971520;
  if v_piece_count <> jsonb_array_length(p_pieces) or not coalesce(v_has_photo, false) or not coalesce(v_has_cin, false) then
    raise exception 'DOSSIER_INCOMPLET' using errcode = '22023';
  end if;
  if v_age < 18 and not coalesce(v_has_parental, false) then
    raise exception 'AUTORISATION_PARENTALE_REQUISE' using errcode = 'P0001';
  end if;

  insert into public.piece (demande_adhesion_id, type, chemin_stockage, mime_type, taille_octets)
  select p_demande_id, x.type::public.type_piece, x.chemin_stockage, x.mime_type, x.taille_octets
  from jsonb_to_recordset(p_pieces) as x(type text, chemin_stockage text, mime_type text, taille_octets integer);

  for v_oeuvre in select value from jsonb_array_elements(p_oeuvres) loop
    if nullif(btrim(v_oeuvre->>'titre'), '') is null then raise exception 'DOSSIER_INCOMPLET' using errcode = '22023'; end if;
    if not exists (select 1 from public.categorie where id = (v_oeuvre->>'categorie_id')::uuid and actif = true) then
      raise exception 'CATEGORIE_INDISPONIBLE' using errcode = 'P0001';
    end if;
    v_fichier := v_oeuvre->'fichier';
    if v_fichier is null or v_fichier->>'chemin_stockage' not like 'oeuvres/%'
      or v_fichier->>'mime_type' not in ('audio/mpeg','audio/wav','application/pdf','image/jpeg','image/png')
      or coalesce((v_fichier->>'taille_octets')::integer, 0) not between 1 and 20971520
      or jsonb_typeof(v_oeuvre->'attestations') <> 'array'
      or jsonb_array_length(v_oeuvre->'attestations') < 1 then
      raise exception 'DOSSIER_INCOMPLET' using errcode = '22023';
    end if;
    insert into public.oeuvre (demande_adhesion_id, categorie_id, titre, description, annee, statut, chemin_fichier, mime_type, taille_octets)
    values (p_demande_id, (v_oeuvre->>'categorie_id')::uuid, btrim(v_oeuvre->>'titre'), nullif(v_oeuvre->>'description',''), nullif(v_oeuvre->>'annee','')::integer,
      'ENVOYEE', v_fichier->>'chemin_stockage', v_fichier->>'mime_type', (v_fichier->>'taille_octets')::integer)
    returning id into v_oeuvre_id;

    for v_fichier in select value from jsonb_array_elements(v_oeuvre->'attestations') loop
      if v_fichier->>'chemin_stockage' not like 'pieces/%'
        or v_fichier->>'mime_type' not in ('application/pdf','image/jpeg','image/png')
        or coalesce((v_fichier->>'taille_octets')::integer, 0) not between 1 and 20971520 then
        raise exception 'DOSSIER_INCOMPLET' using errcode = '22023';
      end if;
      insert into public.attestation_diffusion (oeuvre_id, chemin_stockage, mime_type, taille_octets)
      values (v_oeuvre_id, v_fichier->>'chemin_stockage', v_fichier->>'mime_type', (v_fichier->>'taille_octets')::integer);
    end loop;
  end loop;

  v_date := now();
  update public.demande_adhesion set categorie_id = p_categorie_id, statut = 'ENVOYEE', date_soumission = v_date, updated_at = v_date
  where id = p_demande_id;
  v_reponse := jsonb_build_object('numero_dossier', v_demande.numero_dossier, 'statut', 'ENVOYEE', 'date_soumission', v_date);
  insert into public.omda_envoi_idempotence (cle, demande_adhesion_id, reponse) values (p_idempotency_key, p_demande_id, v_reponse);
  return v_reponse;
end;
$$;

revoke all on function public.omda_soumettre_demande(uuid, uuid, uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.omda_soumettre_demande(uuid, uuid, uuid, jsonb, jsonb, text) to service_role;
