-- 0012 — Compte MEMBRE de test (profil, catégorie, œuvres, paiement, notifications)
-- À exécuter dans l'éditeur SQL de Supabase, APRÈS avoir créé l'utilisateur Auth :
--   Authentication > Users > Add user > Create new user
--   (email + mot de passe, cochez « Auto Confirm User »).
-- Idempotent : relançable sans doublon. Remplacez l'email ci-dessous par celui du compte créé.

do $$
declare
  v_email     text := 'membre.test@omda.mg';     -- <== À ADAPTER
  v_user      uuid;
  v_candidat  uuid;
  v_membre    uuid;
  v_cat1      uuid;
  v_cat2      uuid;
  v_oeuvre_f  uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);
  if v_user is null then
    raise exception 'Aucun utilisateur Auth avec l''email %. Créez-le d''abord dans Authentication > Users.', v_email;
  end if;

  select id into v_cat1 from public.categorie where code = 'MUSIQUE';
  select id into v_cat2 from public.categorie where code = 'LITTERATURE';
  if v_cat1 is null or v_cat2 is null then
    raise exception 'Catégories absentes : exécutez d''abord 0011_donnees_categories_test.sql.';
  end if;

  -- 1) utilisateur (normalement créé par le trigger handle_new_user)
  insert into public.utilisateur (id, email, telephone, role, statut, doit_changer_mot_de_passe)
  values (v_user, v_email, '0340000001', 'MEMBRE', 'ACTIF', false)
  on conflict (id) do update
    set role = 'MEMBRE', statut = 'ACTIF', doit_changer_mot_de_passe = false,
        telephone = excluded.telephone, updated_at = now();

  -- 2) candidat (identité) lié au compte
  insert into public.candidat (nom, prenom, cin, date_naissance, telephone, email, adresse, utilisateur_id)
  values ('RAKOTO', 'Jean', '101011000001', date '1995-05-12', '0340000001', v_email,
          'Lot II A 12, Antananarivo', v_user)
  on conflict (utilisateur_id) do update
    set nom = excluded.nom, prenom = excluded.prenom, telephone = excluded.telephone,
        email = excluded.email, adresse = excluded.adresse, updated_at = now();
  select id into v_candidat from public.candidat where utilisateur_id = v_user;

  -- 3) membre
  insert into public.membre (utilisateur_id, candidat_id, numero_adherent, statut)
  values (v_user, v_candidat, 'ADH-TEST-0001', 'ACTIF')
  on conflict (utilisateur_id) do update set statut = 'ACTIF', updated_at = now();
  select id into v_membre from public.membre where utilisateur_id = v_user;

  -- 4) catégorie active du membre (Musique) ; Littérature reste disponible pour tester « demander une catégorie »
  insert into public.membre_categorie (membre_id, categorie_id, statut)
  values (v_membre, v_cat1, 'ACTIVE')
  on conflict (membre_id, categorie_id) do update set statut = 'ACTIVE';

  -- 5) œuvres dans différents états (fichiers non renseignés : données de test)
  if not exists (select 1 from public.oeuvre where membre_id = v_membre) then
    insert into public.oeuvre (membre_id, categorie_id, titre, description, annee, statut, date_soumission)
    values (v_membre, v_cat1, 'Tantara Test (brouillon)', 'Œuvre en brouillon, modifiable.', 2024, 'BROUILLON', null);

    insert into public.oeuvre (membre_id, categorie_id, titre, description, annee, statut, date_soumission)
    values (v_membre, v_cat1, 'Mozika Vaovao (envoyée)', 'En attente de validation par un agent.', 2025, 'ENVOYEE', now() - interval '2 days');

    insert into public.oeuvre (membre_id, categorie_id, titre, description, annee, statut, date_soumission, date_decision)
    values (v_membre, v_cat1, 'Hira Tsara (validée)', 'Validée : le paiement du dépôt est disponible.', 2025, 'VALIDEE', now() - interval '5 days', now() - interval '1 day');

    insert into public.oeuvre (membre_id, categorie_id, titre, description, annee, statut, motif_rejet, date_soumission, date_decision)
    values (v_membre, v_cat1, 'Rakitra Hafa (rejetée)', 'Rejetée pour test.', 2023, 'REJETEE',
            'Attestation de diffusion illisible : merci de la renvoyer.', now() - interval '6 days', now() - interval '3 days');

    insert into public.oeuvre (membre_id, categorie_id, titre, description, annee, statut, date_soumission, date_decision)
    values (v_membre, v_cat1, 'Fiainana (dépôt finalisé)', 'Dépôt payé et finalisé.', 2024, 'DEPOT_FINALISE', now() - interval '20 days', now() - interval '18 days');
  end if;

  -- 6) paiement réussi pour l'œuvre finalisée
  select id into v_oeuvre_f from public.oeuvre where membre_id = v_membre and statut = 'DEPOT_FINALISE' limit 1;
  -- Le garde-fou 0007 refuse tout paiement sans session, sauf rôle service_role.
  -- On simule ce rôle serveur uniquement le temps de cette insertion (transaction locale).
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  insert into public.paiement (type, montant, numero_telephone, reference_interne, statut, oeuvre_id, membre_id, date_confirmation)
  values ('DEPOT_OEUVRE', 10000, '0340000001', 'TEST-PAY-' || left(v_membre::text, 8), 'REUSSI', v_oeuvre_f, v_membre, now() - interval '17 days')
  on conflict (reference_interne) do nothing;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);

  -- 7) notifications
  if not exists (select 1 from public.notification where utilisateur_id = v_user) then
    insert into public.notification (utilisateur_id, type, titre, message, lue, date_envoi) values
      (v_user, 'IDENTIFIANTS_ENVOYES', 'Bienvenue à l''OMDA', 'Votre compte membre est actif.', true,  now() - interval '20 days'),
      (v_user, 'OEUVRE_VALIDEE',       'Œuvre validée',       'Votre œuvre « Hira Tsara » est validée. Vous pouvez payer le dépôt.', false, now() - interval '1 day'),
      (v_user, 'OEUVRE_REJETEE',       'Œuvre rejetée',       'Votre œuvre « Rakitra Hafa » a été rejetée.', false, now() - interval '3 days'),
      (v_user, 'PAIEMENT_REUSSI',      'Paiement confirmé',   'Le dépôt de « Fiainana » est finalisé.', true,  now() - interval '17 days');
  end if;

  raise notice 'Compte membre prêt : % (membre %)', v_email, v_membre;
end $$;

-- Vérification
select u.email, u.role, m.numero_adherent, mc.statut as categorie_statut,
       (select count(*) from public.oeuvre o where o.membre_id = m.id) as nb_oeuvres,
       (select count(*) from public.notification n where n.utilisateur_id = u.id) as nb_notifications
from public.utilisateur u
join public.membre m on m.utilisateur_id = u.id
left join public.membre_categorie mc on mc.membre_id = m.id
where u.email = 'membre.test@omda.mg';   -- <== même email qu'en haut
