import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createOmdaServer } from '../src/server.mjs';
import { readConfig, paymentIntegrationReady } from '../src/config.mjs';

async function withServer(fn, settings = readConfig({ HOST: '127.0.0.1', PORT: '8080' }), fetchImpl = fetch) {
  const server = createOmdaServer({ settings, logger: { warn() {}, error() {} }, fetchImpl });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try { await fn(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); }
}

test('health exposes integration readiness without exposing secrets', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.integrations.paymentProviderConfigured, false);
    assert.equal(body.integrations.paymentInitiationEnabled, false);
    assert.equal(body.integrations.paymentCallbackEnabled, false);
    assert.equal(JSON.stringify(body).includes('secret'), false);
  });
});

test('payment initiation fails closed and never reports success', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/paiements`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'test-key' },
      body: JSON.stringify({ numero_dossier: 'OMDA-TEST', mode: 'MOBILE_MONEY' }),
    });
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.code, 'INTEGRATION_MVOLA_NON_IMPLEMENTEE');
    assert.match(body.message, /Aucune transaction n’a été initiée ni confirmée/);
    assert.notEqual(body.statut, 'REUSSI');
  });
});

test('candidate draft rejects invalid payloads before any database call', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/demandes`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'IDENTITE_INVALIDE');
  });
});

test('candidate draft fails closed when tracking secret is not configured', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/demandes`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        identite: { nom: 'RAKOTO', prenom: 'Jean', date_naissance: '1996-04-12', cin: '101234567890', telephone: '+261341234567', email: 'jean@example.mg', adresse: 'Antananarivo' },
        categorie_id: '8f0f0d3a-1c2b-4a1e-9f0e-1d2c3b4a5e6f',
      }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'CONFIGURATION_SECURITE_INCOMPLETE');
  });
});

test('candidate draft enforces minimum age', async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/demandes`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        identite: { nom: 'RAKOTO', prenom: 'Jean', date_naissance: '2015-01-01', cin: '101234567890', telephone: '+261341234567', email: 'jean@example.mg', adresse: 'Antananarivo' },
        categorie_id: '8f0f0d3a-1c2b-4a1e-9f0e-1d2c3b4a5e6f',
      }),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'AGE_INSUFFISANT');
  });
});

test('production rejects unlisted browser origins', async () => {
  const settings = readConfig({ NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '8080', CORS_ALLOWED_ORIGINS: 'https://app.omda.mg' });
  await withServer(async (base) => {
    const response = await fetch(`${base}/health`, { headers: { origin: 'https://evil.example' } });
    assert.equal(response.status, 403);
  }, settings);
});

test('payment readiness requires every secret and explicit enable flag', () => {
  assert.equal(paymentIntegrationReady(readConfig({})), false);
  assert.equal(paymentIntegrationReady(readConfig({
    SUPABASE_URL: 'https://omda-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
    MVOLA_ENABLED: 'true',
    MVOLA_BASE_URL: 'https://api.mvola.test',
    MVOLA_CLIENT_ID: 'id',
    MVOLA_CLIENT_SECRET: 'secret',
    MVOLA_CALLBACK_SECRET: 'callback-secret',
  })), true);
  assert.equal(paymentIntegrationReady(readConfig({
    SUPABASE_URL: 'http://omda-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
    MVOLA_ENABLED: 'true',
    MVOLA_BASE_URL: 'https://api.mvola.test',
    MVOLA_CLIENT_ID: 'id',
    MVOLA_CLIENT_SECRET: 'secret',
    MVOLA_CALLBACK_SECRET: 'callback-secret',
  })), false);
  assert.equal(paymentIntegrationReady(readConfig({
    SUPABASE_URL: 'https://omda-project.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-key',
    MVOLA_ENABLED: 'true',
    MVOLA_BASE_URL: 'https://mvola.example',
    MVOLA_CLIENT_ID: 'id',
    MVOLA_CLIENT_SECRET: 'secret',
    MVOLA_CALLBACK_SECRET: 'callback-secret',
  })), false);
});

test('draft update rejects malformed payloads before any database call', async () => {
  const settings = readConfig({ HOST: '127.0.0.1', PORT: '8080', TRACKING_CODE_PEPPER: 'x'.repeat(40) });
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/demandes/OMDA-2026-ABCD`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-code-suivi': 'ABCD1234' },
      body: JSON.stringify({ categorie_id: 'invalid' }),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'DONNEES_BROUILLON_INVALIDES');
  }, settings);
});

test('draft update requires a tracking code before any database call', async () => {
  const settings = readConfig({ HOST: '127.0.0.1', PORT: '8080', TRACKING_CODE_PEPPER: 'x'.repeat(40) });
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/demandes/OMDA-2026-ABCD`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identite: { nom: 'Rakoto' } }),
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'CODE_SUIVI_INVALIDE');
  }, settings);
});

test('file upload rejects missing dossier credentials before reading the multipart body', async () => {
  const settings = readConfig({ HOST: '127.0.0.1', PORT: '8080' });
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/fichiers`, { method: 'POST', body: 'not multipart' });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'CODE_SUIVI_INVALIDE');
  }, settings);
});

test('file upload rejects a file whose bytes do not match its declared MIME type', async () => {
  const pepper = 'x'.repeat(40);
  const code = 'ABCD2345';
  const settings = readConfig({ HOST: '127.0.0.1', PORT: '8080', TRACKING_CODE_PEPPER: pepper,
    SUPABASE_URL: 'https://omda-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key' });
  const fetchImpl = async (url) => {
    if (String(url).includes('/rest/v1/demande_adhesion')) return new Response(JSON.stringify([{ id: 'd', jeton_suivi_hash: createHash('sha256').update(`${pepper}:${code}`).digest('hex'), statut: 'BROUILLON' }]), { status: 200 });
    throw new Error('Le stockage ne doit pas être appelé pour un fichier invalide.');
  };
  await withServer(async (base) => {
    const form = new FormData();
    form.append('bucket', 'pieces');
    form.append('chemin_stockage', 'pieces/PHOTO/photo.jpg');
    form.append('fichier', new Blob(['not really a jpeg'], { type: 'image/jpeg' }), 'photo.jpg');
    const response = await fetch(`${base}/v1/fichiers`, { method: 'POST', headers: { 'x-numero-dossier': 'OMDA-2026-TEST', 'x-code-suivi': code }, body: form });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'TYPE_FICHIER_NON_AUTORISE');
  }, settings, fetchImpl);
});

test('file upload fails closed when Supabase is not configured', async () => {
  const settings = readConfig({ HOST: '127.0.0.1', PORT: '8080', TRACKING_CODE_PEPPER: 'x'.repeat(40) });
  await withServer(async (base) => {
    const form = new FormData();
    form.append('bucket', 'pieces');
    form.append('chemin_stockage', 'pieces/PHOTO/photo.pdf');
    form.append('fichier', new Blob(['%PDF-1.7\nfixture'], { type: 'application/pdf' }), 'photo.pdf');
    const response = await fetch(`${base}/v1/fichiers`, { method: 'POST', headers: { 'x-numero-dossier': 'OMDA-2026-TEST', 'x-code-suivi': 'ABCD1234' }, body: form });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'SUPABASE_NON_CONFIGURE');
  }, settings);
});


test('submission rejects a dossier with fewer than two works before database access', async () => {
  const settings = readConfig({ HOST: '127.0.0.1', PORT: '8080', TRACKING_CODE_PEPPER: 'x'.repeat(40) });
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/demandes/OMDA-2026-ABCD/envoi`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-numero-dossier': 'OMDA-2026-ABCD', 'x-code-suivi': 'ABCD2345', 'idempotency-key': 'test-key-123' },
      body: JSON.stringify({ categorie_id: '8f0f0d3a-1c2b-4a1e-9f0e-1d2c3b4a5e6f', pieces: [], oeuvres: [] }),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'DOSSIER_INCOMPLET');
  }, settings);
});


test('submission verifies the draft and stored files then returns server confirmation without payment', async () => {
  const pepper = 'x'.repeat(40);
  const code = 'ABCD2345';
  const numero = 'OMDA-2026-TEST';
  const categorie = '8f0f0d3a-1c2b-4a1e-9f0e-1d2c3b4a5e6f';
  const settings = readConfig({ HOST: '127.0.0.1', PORT: '8080', TRACKING_CODE_PEPPER: pepper,
    SUPABASE_URL: 'https://omda-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key' });
  const hash = createHash('sha256').update(`${pepper}:${code}`).digest('hex');
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    if (target.includes('/rest/v1/demande_adhesion?')) return new Response(JSON.stringify([{ id: 'demande-id', candidat_id: 'candidat-id', numero_dossier: numero, jeton_suivi_hash: hash, statut: 'BROUILLON', categorie_id: categorie }]), { status: 200 });
    if (target.includes('/storage/v1/object/')) return new Response(null, { status: 200, headers: { 'content-type': target.includes('audio.wav') ? 'audio/wav' : target.includes('photo.jpg') ? 'image/jpeg' : 'application/pdf', 'content-length': target.includes('photo.jpg') ? '100' : '200' } });
    if (target.includes('/rest/v1/rpc/omda_soumettre_demande')) return new Response(JSON.stringify({ numero_dossier: numero, statut: 'ENVOYEE', date_soumission: '2026-10-26T10:00:00.000Z' }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`Unexpected mocked request: ${target}`);
  };
  const uuid = '11111111-1111-4111-8111-111111111111';
  const pdfUuid = '22222222-2222-4222-8222-222222222222';
  const pieces = [
    { type: 'PHOTO', chemin_stockage: `pieces/${uuid}/photo.jpg`, mime_type: 'image/jpeg', taille_octets: 100 },
    { type: 'CIN', chemin_stockage: `pieces/${pdfUuid}/cin.pdf`, mime_type: 'application/pdf', taille_octets: 200 },
  ];
  const oeuvres = [1, 2].map((n) => ({
    titre: `Oeuvre ${n}`, categorie_id: categorie,
    fichier: { chemin_stockage: `oeuvres/${n === 1 ? uuid : pdfUuid}/audio.wav`, mime_type: 'audio/wav', taille_octets: 200 },
    attestations: [{ chemin_stockage: `pieces/${n === 1 ? pdfUuid : uuid}/attestation.pdf`, mime_type: 'application/pdf', taille_octets: 200 }],
  }));
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/demandes/${numero}/envoi`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-numero-dossier': numero, 'x-code-suivi': code, 'idempotency-key': 'test-key-123456' },
      body: JSON.stringify({ categorie_id: categorie, pieces, oeuvres }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.numero_dossier, numero);
    assert.equal(body.statut, 'ENVOYEE');
    assert.equal(body.delai_indicatif_heures, 72);
    assert.equal(body.date_soumission, '2026-10-26T10:00:00.000Z');
    assert.equal('paiement' in body, false);
  }, settings, fetchImpl);
});

test('file upload sends validated bytes to private Storage and returns a canonical path', async () => {
  const pepper = 'x'.repeat(40);
  const code = 'ABCD2345';
  const settings = readConfig({
    HOST: '127.0.0.1', PORT: '8080',
    SUPABASE_URL: 'https://omda-test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key',
    TRACKING_CODE_PEPPER: pepper,
  });
  let storageRequest;
  const fetchImpl = async (url, init = {}) => {
    if (String(url).includes('/rest/v1/demande_adhesion')) return new Response(JSON.stringify([{ id: 'd', jeton_suivi_hash: createHash('sha256').update(`${pepper}:${code}`).digest('hex'), statut: 'BROUILLON' }]), { status: 200 });
    storageRequest = { url, init };
    return new Response(JSON.stringify({ Key: 'pieces/uuid/photo.pdf' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const server = createOmdaServer({ settings, logger: { warn() {}, error() {} }, fetchImpl });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const form = new FormData();
    form.append('bucket', 'pieces');
    form.append('chemin_stockage', 'pieces/PHOTO/photo.pdf');
    form.append('fichier', new Blob(['%PDF-1.7\\nfixture'], { type: 'application/pdf' }), 'photo.pdf');
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/fichiers`, { method: 'POST', headers: { 'x-numero-dossier': 'OMDA-2026-TEST', 'x-code-suivi': code }, body: form });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.mime_type, 'application/pdf');
    assert.equal(body.taille_octets, Buffer.byteLength('%PDF-1.7\\nfixture'));
    assert.match(body.chemin_stockage, /^pieces\/[0-9a-f-]{36}\/photo\.pdf$/i);
    assert.match(storageRequest.url, /\/storage\/v1\/object\/pieces\//);
    assert.equal(storageRequest.init.headers['x-upsert'], 'false');
    assert.equal(storageRequest.init.headers.apikey, 'server-only-test-key');
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});


test('file upload rejects requests without a dossier tracking context before reading the file', async () => {
  await withServer(async (base) => {
    const form = new FormData();
    form.append('bucket', 'pieces');
    form.append('chemin_stockage', 'pieces/PHOTO/photo.pdf');
    form.append('fichier', new Blob(['%PDF-1.7\nfixture'], { type: 'application/pdf' }), 'photo.pdf');
    const response = await fetch(`${base}/v1/fichiers`, { method: 'POST', body: form });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'CODE_SUIVI_INVALIDE');
  });
});

test('file upload rejects an incorrect tracking code before storage is called', async () => {
  const pepper = 'tracking-pepper-long-enough-for-tests-123456';
  const settings = readConfig({ HOST: '127.0.0.1', PORT: '8080', TRACKING_CODE_PEPPER: pepper,
    SUPABASE_URL: 'https://omda-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key' });
  let storageCalled = false;
  const fetchImpl = async (url) => {
    if (String(url).includes('/rest/v1/demande_adhesion?')) return new Response(JSON.stringify([{ jeton_suivi_hash: createHash('sha256').update(`${pepper}:REALCODE`).digest('hex'), statut: 'BROUILLON' }]), { status: 200 });
    storageCalled = true;
    throw new Error('Storage must not be called for an invalid tracking code.');
  };
  await withServer(async (base) => {
    const form = new FormData();
    form.append('bucket', 'pieces');
    form.append('chemin_stockage', 'pieces/PHOTO/photo.pdf');
    form.append('fichier', new Blob(['%PDF-1.7\nfixture'], { type: 'application/pdf' }), 'photo.pdf');
    const response = await fetch(`${base}/v1/fichiers`, { method: 'POST', headers: { 'x-numero-dossier': 'OMDA-2026-TEST', 'x-code-suivi': 'WRONGCODE' }, body: form });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'CODE_SUIVI_INVALIDE');
    assert.equal(storageCalled, false);
  }, settings, fetchImpl);
});

test('file upload refuses a dossier that is no longer a draft', async () => {
  const pepper = 'tracking-pepper-long-enough-for-tests-123456';
  const code = 'ABCD2345';
  const settings = readConfig({ HOST: '127.0.0.1', PORT: '8080', TRACKING_CODE_PEPPER: pepper,
    SUPABASE_URL: 'https://omda-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key' });
  const fetchImpl = async (url) => {
    if (String(url).includes('/rest/v1/demande_adhesion?')) return new Response(JSON.stringify([{ jeton_suivi_hash: createHash('sha256').update(`${pepper}:${code}`).digest('hex'), statut: 'ENVOYEE' }]), { status: 200 });
    throw new Error('Storage must not be called for a submitted dossier.');
  };
  await withServer(async (base) => {
    const form = new FormData();
    form.append('bucket', 'pieces');
    form.append('chemin_stockage', 'pieces/PHOTO/photo.pdf');
    form.append('fichier', new Blob(['%PDF-1.7\nfixture'], { type: 'application/pdf' }), 'photo.pdf');
    const response = await fetch(`${base}/v1/fichiers`, { method: 'POST', headers: { 'x-numero-dossier': 'OMDA-2026-TEST', 'x-code-suivi': code }, body: form });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'DEMANDE_NON_MODIFIABLE');
  }, settings, fetchImpl);
});

test('tracking returns the actual last update and never exposes an adhesion fee before validation', async () => {
  const pepper = 'tracking-pepper-long-enough-for-tests-123456';
  const code = 'ABCD2345';
  const numero = 'OMDA-2026-SUIVI';
  const hash = createHash('sha256').update(`${pepper}:${code}`).digest('hex');
  const settings = readConfig({ HOST: '127.0.0.1', PORT: '8080', TRACKING_CODE_PEPPER: pepper,
    SUPABASE_URL: 'https://omda-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key' });
  let tariffRequested = false;
  const fetchImpl = async (url) => {
    if (String(url).includes('/rest/v1/demande_adhesion?')) return new Response(JSON.stringify([{
      id: 'd', numero_dossier: numero, jeton_suivi_hash: hash, statut: 'ENVOYEE', motif_rejet: null,
      date_soumission: '2026-10-20T10:00:00.000Z', date_decision: null, updated_at: '2026-10-25T10:00:00.000Z', categorie_id: 'cat',
    }]), { status: 200 });
    if (String(url).includes('/rest/v1/tarif?')) { tariffRequested = true; return new Response('[]', { status: 200 }); }
    throw new Error(`Unexpected request: ${url}`);
  };
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/suivi/${numero}`, { headers: { 'x-code-suivi': code } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.derniere_mise_a_jour, '2026-10-25T10:00:00.000Z');
    assert.equal(body.paiement_du, null);
    assert.equal(body.etapes.find((step) => step.statut === 'REJETEE').realisee, false);
    assert.equal(tariffRequested, false);
  }, settings, fetchImpl);
});

test('tracking returns rejection reason and rejection date for a rejected dossier', async () => {
  const pepper = 'tracking-pepper-long-enough-for-tests-123456';
  const code = 'ABCD2345';
  const hash = createHash('sha256').update(`${pepper}:${code}`).digest('hex');
  const settings = readConfig({ HOST: '127.0.0.1', PORT: '8080', TRACKING_CODE_PEPPER: pepper,
    SUPABASE_URL: 'https://omda-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key' });
  const fetchImpl = async (url) => {
    if (String(url).includes('/rest/v1/demande_adhesion?')) return new Response(JSON.stringify([{
      numero_dossier: 'OMDA-2026-REJETE', jeton_suivi_hash: hash, statut: 'REJETEE', motif_rejet: 'Pièce illisible',
      date_soumission: '2026-10-20T10:00:00.000Z', date_decision: '2026-10-24T12:00:00.000Z', updated_at: '2026-10-24T12:00:00.000Z', categorie_id: 'cat',
    }]), { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/suivi/OMDA-2026-REJETE`, { headers: { 'x-code-suivi': code } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.statut, 'REJETEE');
    assert.equal(body.motif_rejet, 'Pièce illisible');
    assert.equal(body.etapes.find((step) => step.statut === 'REJETEE').realisee, true);
    assert.equal(body.etapes.find((step) => step.statut === 'REJETEE').date, '2026-10-24T12:00:00.000Z');
    assert.equal(body.etapes.find((step) => step.statut === 'VALIDEE').realisee, false);
    assert.equal(body.paiement_du, null);
  }, settings, fetchImpl);
});

test('tracking fails closed if a rejected dossier has no rejection reason', async () => {
  const pepper = 'tracking-pepper-long-enough-for-tests-123456';
  const code = 'ABCD2345';
  const hash = createHash('sha256').update(`${pepper}:${code}`).digest('hex');
  const settings = readConfig({ HOST: '127.0.0.1', PORT: '8080', TRACKING_CODE_PEPPER: pepper,
    SUPABASE_URL: 'https://omda-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key' });
  const fetchImpl = async (url) => {
    if (String(url).includes('/rest/v1/demande_adhesion?')) return new Response(JSON.stringify([{
      numero_dossier: 'OMDA-2026-REJETE', jeton_suivi_hash: hash, statut: 'REJETEE', motif_rejet: ' ',
      date_soumission: '2026-10-20T10:00:00.000Z', date_decision: '2026-10-24T12:00:00.000Z', updated_at: '2026-10-24T12:00:00.000Z', categorie_id: 'cat',
    }]), { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/suivi/OMDA-2026-REJETE`, { headers: { 'x-code-suivi': code } });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'DOSSIER_INCOHERENT');
  }, settings, fetchImpl);
});

test('tracking chooses the category-specific adhesion tariff before the default tariff', async () => {
  const pepper = 'tracking-pepper-long-enough-for-tests-123456';
  const code = 'ABCD2345';
  const categorie = 'cat-specific';
  const hash = createHash('sha256').update(`${pepper}:${code}`).digest('hex');
  const settings = readConfig({ HOST: '127.0.0.1', PORT: '8080', TRACKING_CODE_PEPPER: pepper,
    SUPABASE_URL: 'https://omda-test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-key' });
  const fetchImpl = async (url) => {
    if (String(url).includes('/rest/v1/demande_adhesion?')) return new Response(JSON.stringify([{
      numero_dossier: 'OMDA-2026-VALIDE', jeton_suivi_hash: hash, statut: 'VALIDEE', motif_rejet: null,
      date_soumission: '2026-10-20T10:00:00.000Z', date_decision: '2026-10-24T12:00:00.000Z', updated_at: '2026-10-24T12:00:00.000Z', categorie_id: categorie,
    }]), { status: 200 });
    if (String(url).includes('/rest/v1/tarif?')) return new Response(JSON.stringify([
      { categorie_id: null, montant: 150000, devise: 'MGA' },
      { categorie_id: categorie, montant: 90000, devise: 'MGA' },
    ]), { status: 200 });
    throw new Error(`Unexpected request: ${url}`);
  };
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/suivi/OMDA-2026-VALIDE`, { headers: { 'x-code-suivi': code } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.paiement_du, { type: 'ADHESION', montant: 90000, devise: 'MGA' });
  }, settings, fetchImpl);
});

// ---------------------------------------------------------------------------
// Durcissement (27/10/2026)
// ---------------------------------------------------------------------------

const PEPPER = 'p'.repeat(40);
const reglagesSecurises = (extra = {}) => ({ ...readConfig({ HOST: '127.0.0.1', PORT: '8080', TRACKING_CODE_PEPPER: PEPPER }), ...extra });

async function withServerLimites(fn, limites, settings = reglagesSecurises(), fetchImpl = fetch) {
  const server = createOmdaServer({ settings, logger: { warn() {}, error() {} }, fetchImpl, limites });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())); }
}

test('un numéro de dossier mal encodé renvoie 400 et ne fait jamais planter le serveur', async () => {
  await withServer(async (base) => {
    for (const chemin of ['/v1/suivi/%E0%A4%A', '/v1/demandes/%ZZ', '/v1/demandes/%E0%A4%A/envoi']) {
      const methode = chemin.endsWith('/envoi') ? 'POST' : chemin.startsWith('/v1/demandes') ? 'PATCH' : 'GET';
      const response = await fetch(`${base}${chemin}`, {
        method: methode,
        headers: { 'x-code-suivi': 'ABCD2345', 'x-numero-dossier': '%E0%A4%A', 'idempotency-key': 'cle-test-12345', 'content-type': 'application/json' },
        body: methode === 'GET' ? undefined : '{}',
      });
      assert.equal(response.status, 400, chemin);
      assert.equal((await response.json()).code, 'NUMERO_DOSSIER_INVALIDE');
    }
    assert.equal((await fetch(`${base}/health`)).status, 200);
  }, reglagesSecurises());
});

test('une exception interne est convertie en 500 sans arrêter le serveur', async () => {
  const fetchQuiPlante = async () => { throw new TypeError('panne simulée'); };
  await withServer(async (base) => {
    const response = await fetch(`${base}/v1/suivi/OMDA-2026-AAAAAAAAAA`, { headers: { 'x-code-suivi': 'ABCD2345' } });
    assert.ok([500, 503].includes(response.status));
    assert.equal((await fetch(`${base}/health`)).status, 200);
  }, reglagesSecurises({ supabaseUrl: 'https://projet.supabase.co', supabaseServiceRoleKey: 'cle-service' }), fetchQuiPlante);
});

test('la création de dossiers est limitée par adresse IP', async () => {
  await withServerLimites(async (base) => {
    const appel = () => fetch(`${base}/v1/demandes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
    assert.equal((await appel()).status, 422);
    assert.equal((await appel()).status, 422);
    const bloque = await appel();
    assert.equal(bloque.status, 429);
    assert.equal((await bloque.json()).code, 'TROP_DE_DEMANDES');
    assert.ok(Number(bloque.headers.get('retry-after')) > 0);
  }, { creationsParHeure: 2 });
});

test('trop de codes de suivi erronés bloquent le dossier visé, y compris avec le bon code', async () => {
  const numero = 'OMDA-2026-AAAAAAAAAA';
  const vraiCode = 'ABCD2345';
  const hash = createHash('sha256').update(`${PEPPER}:${vraiCode}`).digest('hex');
  const fetchSupabase = async () => new Response(JSON.stringify([{ id: 'x', numero_dossier: numero, jeton_suivi_hash: hash, statut: 'ENVOYEE', date_soumission: '2026-10-01T00:00:00Z' }]), { status: 200, headers: { 'content-type': 'application/json' } });
  const reglages = reglagesSecurises({ supabaseUrl: 'https://projet.supabase.co', supabaseServiceRoleKey: 'cle-service' });
  await withServerLimites(async (base) => {
    const suivre = (code) => fetch(`${base}/v1/suivi/${numero}`, { headers: { 'x-code-suivi': code } });
    assert.equal((await suivre('MAUVAIS11')).status, 401);
    assert.equal((await suivre('MAUVAIS22')).status, 401);
    assert.equal((await suivre('MAUVAIS33')).status, 401);   // 3e échec : encore traité, puis le dossier est verrouillé
    assert.equal((await suivre('MAUVAIS44')).status, 429);
    assert.equal((await suivre(vraiCode)).status, 429);      // même le bon code est refusé pendant le verrouillage
  }, { echecsCodeParHeure: 3 }, reglages, fetchSupabase);
});

test('le code de suivi correct reste accepté tant que la limite n’est pas atteinte', async () => {
  const numero = 'OMDA-2026-BBBBBBBBBB';
  const vraiCode = 'ABCD2345';
  const hash = createHash('sha256').update(`${PEPPER}:${vraiCode}`).digest('hex');
  const fetchSupabase = async () => new Response(JSON.stringify([{ id: 'x', numero_dossier: numero, jeton_suivi_hash: hash, statut: 'ENVOYEE', date_soumission: '2026-10-01T00:00:00Z' }]), { status: 200, headers: { 'content-type': 'application/json' } });
  const reglages = reglagesSecurises({ supabaseUrl: 'https://projet.supabase.co', supabaseServiceRoleKey: 'cle-service' });
  await withServerLimites(async (base) => {
    const response = await fetch(`${base}/v1/suivi/${numero}`, { headers: { 'x-code-suivi': vraiCode } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).statut, 'ENVOYEE');
  }, {}, reglages, fetchSupabase);
});

test('TRUST_PROXY_HOPS : l’adresse du client vient de X-Forwarded-For uniquement si un proxy est de confiance', async () => {
  await withServerLimites(async (base) => {
    const appel = (ip) => fetch(`${base}/v1/demandes`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({}) });
    assert.equal((await appel('203.0.113.1')).status, 422);
    assert.equal((await appel('203.0.113.2')).status, 422);   // autre client : compteur distinct
    assert.equal((await appel('203.0.113.1')).status, 429);   // même client : bloqué
  }, { creationsParHeure: 1 }, reglagesSecurises({ trustProxyHops: 1 }));
  // Sans proxy de confiance, l'en-tête est ignoré : un attaquant ne peut pas contourner la limite en le changeant.
  await withServerLimites(async (base) => {
    const appel = (ip) => fetch(`${base}/v1/demandes`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({}) });
    assert.equal((await appel('203.0.113.1')).status, 422);
    assert.equal((await appel('203.0.113.2')).status, 429);
  }, { creationsParHeure: 1 }, reglagesSecurises({ trustProxyHops: 0 }));
});

test('TRUST_PROXY_HOPS invalide est refusé à la lecture de la configuration', () => {
  assert.throws(() => readConfig({ TRUST_PROXY_HOPS: '9' }), /TRUST_PROXY_HOPS/);
  assert.throws(() => readConfig({ TRUST_PROXY_HOPS: 'abc' }), /TRUST_PROXY_HOPS/);
  assert.equal(readConfig({}).trustProxyHops, 0);
});

test('les limites de débit se règlent par variables d’environnement', async () => {
  const reglages = readConfig({ LIMITE_CREATIONS_PAR_HEURE: '1', TRACKING_CODE_PEPPER: 'p'.repeat(40) });
  assert.equal(reglages.limites.creationsParHeure, 1);
  assert.equal(reglages.limites.televersementsParHeure, undefined);
  assert.throws(() => readConfig({ LIMITE_TELEVERSEMENTS_PAR_HEURE: '0' }), /LIMITE_TELEVERSEMENTS_PAR_HEURE/);
  await withServerLimites(async (base) => {
    const appel = () => fetch(`${base}/v1/demandes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal((await appel()).status, 422);
    assert.equal((await appel()).status, 429);
  }, {}, reglages);
});
