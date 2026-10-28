-- 0013 — Comptes de test : AGENT OMDA et ADMINISTRATEUR
-- À exécuter dans l'éditeur SQL de Supabase, APRÈS avoir créé les deux utilisateurs Auth :
--   Authentication > Users > Add user > Create new user (cochez « Auto Confirm User »).
-- Idempotent : relançable sans doublon. Adaptez les deux emails ci-dessous.
-- Un compte inscrit via Supabase Auth démarre toujours comme MEMBRE (trigger handle_new_user) :
-- ce script lui attribue le rôle de personnel.

do $$
declare
  v_email_agent text := 'agent.test@omda.mg';   -- <== À ADAPTER
  v_email_admin text := 'admin.test@omda.mg';   -- <== À ADAPTER
  v_id uuid;
  v_email text;
  v_role role_utilisateur;
begin
  for v_email, v_role in
    select * from (values (v_email_agent, 'AGENT'::role_utilisateur),
                          (v_email_admin, 'ADMINISTRATEUR'::role_utilisateur)) as t(email, role)
  loop
    select id into v_id from auth.users where lower(email) = lower(v_email);
    if v_id is null then
      raise exception 'Aucun utilisateur Auth avec l''email %. Créez-le d''abord dans Authentication > Users.', v_email;
    end if;

    insert into public.utilisateur (id, email, role, statut, doit_changer_mot_de_passe)
    values (v_id, v_email, v_role, 'ACTIF', false)
    on conflict (id) do update
      set role = excluded.role, statut = 'ACTIF', doit_changer_mot_de_passe = false, updated_at = now();

    raise notice 'Compte % prêt : %', v_role, v_email;
  end loop;
end $$;

-- Vérification
select email, role, statut from public.utilisateur
where role in ('AGENT', 'ADMINISTRATEUR') order by role;
