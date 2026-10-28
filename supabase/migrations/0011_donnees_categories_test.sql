-- 0011 — Catégories d'adhésion (données de référence) + tarifs de test
-- À exécuter dans l'éditeur SQL de Supabase. Idempotent : relançable sans risque.
-- Ajustez les libellés et les montants selon les catégories réelles de l'OMDA.

-- Sécurité : lecture publique (déjà prévue par le schéma, on s'assure du droit SELECT)
grant select on public.categorie to anon, authenticated;
grant select on public.tarif     to anon, authenticated;

-- 1) Catégories d'adhésion
insert into public.categorie (code, libelle, description, actif) values
  ('MUSIQUE',        'Musique',                    'Compositeurs, auteurs de textes et interprètes d''œuvres musicales.', true),
  ('LITTERATURE',    'Littérature',                'Romans, poésie, nouvelles, essais et autres écrits.',                  true),
  ('ARTS_VISUELS',   'Arts visuels',               'Peinture, sculpture, photographie, illustration.',                     true),
  ('AUDIOVISUEL',    'Audiovisuel',                'Films, documentaires, séries et créations vidéo.',                     true),
  ('SPECTACLE',      'Arts du spectacle',          'Théâtre, danse, humour, contes.',                                      true)
on conflict (code) do update
  set libelle = excluded.libelle,
      description = excluded.description,
      actif = true,
      updated_at = now();

-- 2) Tarifs de test (montants fictifs en MGA, à remplacer)
insert into public.tarif (type_operation, categorie_id, montant, devise, actif)
select 'ADHESION'::type_operation_tarif, c.id, 20000, 'MGA', true
from public.categorie c
where not exists (
  select 1 from public.tarif t
  where t.type_operation = 'ADHESION' and t.categorie_id = c.id and t.actif = true
);

insert into public.tarif (type_operation, categorie_id, montant, devise, actif)
select 'DEPOT_OEUVRE'::type_operation_tarif, c.id, 10000, 'MGA', true
from public.categorie c
where not exists (
  select 1 from public.tarif t
  where t.type_operation = 'DEPOT_OEUVRE' and t.categorie_id = c.id and t.actif = true
);

-- 3) Vérification
select code, libelle, actif from public.categorie order by libelle;
