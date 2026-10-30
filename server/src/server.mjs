import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { readConfig, paymentIntegrationReady } from './config.mjs';

const config = readConfig();

const STATUTS_DEMANDE = new Set(['BROUILLON', 'ENVOYEE', 'EN_COURS_DE_VERIFICATION', 'VALIDEE', 'REJETEE', 'ADHESION_TERMINEE']);
const CODE_SUIVI_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genererCodeSuivi() {
  const bytes = randomBytes(8);
  return Array.from(bytes, (byte) => CODE_SUIVI_ALPHABET[byte % CODE_SUIVI_ALPHABET.length]).join('');
}
function hashCodeSuivi(code, pepper) {
  return createHash('sha256').update(`${pepper}:${String(code).trim().toUpperCase()}`).digest('hex');
}
function comparerHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function ageEnAnnees(dateNaissance) {
  const date = new Date(`${dateNaissance}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateNaissance) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateNaissance) return null;
  const maintenant = new Date();
  let age = maintenant.getUTCFullYear() - date.getUTCFullYear();
  if (maintenant.getUTCMonth() < date.getUTCMonth() || (maintenant.getUTCMonth() === date.getUTCMonth() && maintenant.getUTCDate() < date.getUTCDate())) age--;
  return age;
}
/** Décodage tolérant d'un segment d'URL : une séquence % invalide ne doit jamais faire planter le serveur. */
function decoderSegment(valeur) {
  try { return decodeURIComponent(valeur); } catch { return null; }
}

/**
 * Compteur à fenêtre fixe, en mémoire (une instance de serveur = un état).
 * `atteint` renvoie le nombre de secondes d'attente si la limite est atteinte, sinon 0.
 */
function creerCompteur(max, fenetreMs) {
  const fenetres = new Map();
  return {
    atteint(cle, maintenant = Date.now()) {
      const f = fenetres.get(cle);
      if (!f || maintenant - f.debut >= fenetreMs || f.nombre < max) return 0;
      return Math.max(1, Math.ceil((f.debut + fenetreMs - maintenant) / 1000));
    },
    ajouter(cle, maintenant = Date.now()) {
      const f = fenetres.get(cle);
      if (!f || maintenant - f.debut >= fenetreMs) fenetres.set(cle, { debut: maintenant, nombre: 1 });
      else f.nombre++;
      if (fenetres.size > 5000) {
        for (const [k, v] of fenetres) if (maintenant - v.debut >= fenetreMs) fenetres.delete(k);
      }
    },
  };
}

/**
 * Adresse du client. Derrière un reverse proxy (TRUST_PROXY_HOPS > 0), on lit X-Forwarded-For
 * en partant de la droite ; sans proxy de confiance, l'en-tête est ignoré (il est falsifiable).
 */
function adresseClient(req, sauts = 0) {
  if (sauts > 0) {
    const liste = String(req.headers['x-forwarded-for'] ?? '').split(',').map((v) => v.trim()).filter(Boolean);
    const candidate = liste[liste.length - sauts];
    if (candidate) return candidate;
  }
  return String(req.socket.remoteAddress ?? 'inconnu');
}

function erreur(status, code, message, reference, details) {
  return { status, body: { code, message, ...(details ? { details } : {}), ...(reference ? { reference } : {}) } };
}
async function supabaseRequest(settings, path, { method = 'GET', body, prefer, fetchImpl = fetch } = {}) {
  if (!settings.supabaseUrl || !settings.supabaseServiceRoleKey) {
    const e = new Error('La connexion à la base Supabase n’est pas configurée.');
    e.status = 503; e.code = 'SUPABASE_NON_CONFIGURE'; throw e;
  }
  const headers = {
    apikey: settings.supabaseServiceRoleKey,
    authorization: `Bearer ${settings.supabaseServiceRoleKey}`,
    accept: 'application/json',
  };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.prefer = prefer;
  const response = await fetchImpl(`${settings.supabaseUrl.replace(/\/+$/, '')}/rest/v1/${path}`, {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* réponse non JSON */ }
  if (!response.ok) {
    const e = new Error('La base de données a refusé l’opération.');
    e.status = response.status === 409 ? 409 : response.status >= 500 ? 503 : 422;
    e.code = response.status === 409 ? 'DONNEES_DEJA_EXISTANTES' : 'OPERATION_BASE_REFUSEE';
    throw e;
  }
  return data;
}

const MAX_FICHIER_OCTETS = 20 * 1024 * 1024;
const MAX_MULTIPART_OCTETS = MAX_FICHIER_OCTETS + 256 * 1024;
const MIME_PAR_BUCKET = Object.freeze({
  pieces: new Set(['image/jpeg', 'image/png', 'application/pdf']),
  oeuvres: new Set(['audio/mpeg', 'audio/wav', 'application/pdf', 'image/jpeg', 'image/png']),
});

function lireBuffer(req, limite) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    let termine = false;
    req.on('data', (chunk) => {
      if (termine) return;
      total += chunk.length;
      if (total > limite) {
        termine = true;
        reject(Object.assign(new Error('Corps de requête trop volumineux.'), { status: 413 }));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!termine) resolve(Buffer.concat(chunks)); });
    req.on('error', (error) => { if (!termine) reject(error); });
  });
}

function extraireMultipart(buffer, contentType) {
  const match = /multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 200) throw Object.assign(new Error('Frontière multipart invalide.'), { status: 400, code: 'MULTIPART_INVALIDE' });
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = new Map();
  let cursor = 0;
  if (buffer.subarray(0, delimiter.length).compare(delimiter) !== 0) throw Object.assign(new Error('Multipart invalide.'), { status: 400, code: 'MULTIPART_INVALIDE' });
  while (cursor < buffer.length) {
    if (buffer.subarray(cursor, cursor + delimiter.length).compare(delimiter) !== 0) throw Object.assign(new Error('Multipart invalide.'), { status: 400, code: 'MULTIPART_INVALIDE' });
    cursor += delimiter.length;
    if (buffer.subarray(cursor, cursor + 2).toString() === '--') break;
    if (buffer.subarray(cursor, cursor + 2).toString() !== '\r\n') throw Object.assign(new Error('Multipart invalide.'), { status: 400, code: 'MULTIPART_INVALIDE' });
    cursor += 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd < 0 || headerEnd - cursor > 8192) throw Object.assign(new Error('En-têtes multipart invalides.'), { status: 400, code: 'MULTIPART_INVALIDE' });
    const headers = buffer.subarray(cursor, headerEnd).toString('latin1');
    const disposition = /content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i.exec(headers);
    const mime = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim().toLowerCase() ?? 'text/plain';
    if (!disposition) throw Object.assign(new Error('Partie multipart invalide.'), { status: 400, code: 'MULTIPART_INVALIDE' });
    const dataStart = headerEnd + 4;
    const nextBoundary = buffer.indexOf(Buffer.concat([Buffer.from('\r\n'), delimiter]), dataStart);
    if (nextBoundary < 0) throw Object.assign(new Error('Fin de partie multipart introuvable.'), { status: 400, code: 'MULTIPART_INVALIDE' });
    const data = buffer.subarray(dataStart, nextBoundary);
    const name = disposition[1];
    if (fields.has(name)) throw Object.assign(new Error('Champ multipart répété.'), { status: 400, code: 'MULTIPART_INVALIDE' });
    fields.set(name, disposition[2] !== undefined ? { filename: disposition[2], mime, data } : { value: data.toString('utf8') });
    cursor = nextBoundary + 2;
  }
  return fields;
}

function mimeReel(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return 'audio/wav';
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg';
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
}

function nomFichierSecurise(filename) {
  const base = String(filename ?? '').replace(/\\/g, '/').split('/').pop().normalize('NFKC');
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 100);
  return safe || 'fichier';
}

function numeroDossier() {
  const annee = new Date().getUTCFullYear();
  return `OMDA-${annee}-${randomBytes(5).toString('hex').toUpperCase()}`;
}
function codeErreurDepuis(error, requestId) {
  const status = error.status ?? 503;
  return erreur(status, error.code ?? 'SERVICE_INDISPONIBLE', error.status === 422 ? 'Les informations du dossier sont incompatibles avec les règles de gestion.' : error.status === 409 ? 'Un dossier utilisant certaines de ces informations existe déjà.' : 'Le service de dossiers est momentanément indisponible.', requestId, error.details);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES_PIECE = new Set(['PHOTO', 'CIN', 'ACTE_NAISSANCE', 'CERTIFICAT_RESIDENCE', 'AUTORISATION_PARENTALE', 'AUTRE']);
const MIME_ATTESTATION = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function validerFichierReference(file, bucket, { attestation = false } = {}) {
  if (!file || typeof file !== 'object' || typeof file.chemin_stockage !== 'string' || typeof file.mime_type !== 'string' || !Number.isInteger(file.taille_octets)) return false;
  const mime = file.mime_type.toLowerCase();
  if (file.taille_octets < 1 || file.taille_octets > MAX_FICHIER_OCTETS) return false;
  if (attestation && !MIME_ATTESTATION.has(mime)) return false;
  if (!MIME_PAR_BUCKET[bucket]?.has(mime)) return false;
  const prefix = `${bucket}/`;
  const path = file.chemin_stockage;
  if (!path.startsWith(prefix)) return false;
  const parts = path.slice(prefix.length).split('/');
  return parts.length === 2 && UUID_RE.test(parts[0]) && parts[1] !== '.' && parts[1] !== '..' && /^[a-zA-Z0-9._-]{1,100}$/.test(parts[1]);
}

function validerSoumission(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'DONNEES_ENVOI_INVALIDES';
  if (typeof body.categorie_id !== 'string' || !UUID_RE.test(body.categorie_id)) return 'DONNEES_ENVOI_INVALIDES';
  if (!Array.isArray(body.pieces) || !Array.isArray(body.oeuvres)) return 'DONNEES_ENVOI_INVALIDES';
  if (body.oeuvres.length < 2) return 'DOSSIER_INCOMPLET';
  for (const piece of body.pieces) {
    if (!piece || !TYPES_PIECE.has(piece.type) || !validerFichierReference(piece, 'pieces')) return 'DOSSIER_INCOMPLET';
  }
  if (!body.pieces.some((piece) => piece.type === 'PHOTO') || !body.pieces.some((piece) => piece.type === 'CIN')) return 'DOSSIER_INCOMPLET';
  for (const oeuvre of body.oeuvres) {
    if (!oeuvre || typeof oeuvre.titre !== 'string' || !oeuvre.titre.trim() || oeuvre.titre.trim().length > 200 || typeof oeuvre.categorie_id !== 'string' || !UUID_RE.test(oeuvre.categorie_id)) return 'DONNEES_ENVOI_INVALIDES';
    if (oeuvre.description != null && (typeof oeuvre.description !== 'string' || oeuvre.description.length > 5000)) return 'DONNEES_ENVOI_INVALIDES';
    if (oeuvre.annee != null && (!Number.isInteger(oeuvre.annee) || oeuvre.annee < 1800 || oeuvre.annee > new Date().getUTCFullYear())) return 'DONNEES_ENVOI_INVALIDES';
    if (!validerFichierReference(oeuvre.fiche_declaration, 'oeuvres') || !validerFichierReference(oeuvre.fichier, 'oeuvres') || !Array.isArray(oeuvre.attestations) || oeuvre.attestations.length < 1 || oeuvre.attestations.some((file) => !validerFichierReference(file, 'pieces', { attestation: true }))) return 'DOSSIER_INCOMPLET';
  }
  return null;
}

const json = (res, status, body) => {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  });
  res.end(JSON.stringify(body));
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(Object.assign(new Error('Corps de requête trop volumineux.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const LIMITES_PAR_DEFAUT = Object.freeze({
  creationsParHeure: 10,        // POST /v1/demandes, par adresse IP
  requetesCodeParDix_min: 120,  // routes protégées par le code de suivi, par adresse IP
  echecsCodeParHeure: 10,       // codes de suivi erronés, par numéro de dossier
  televersementsParHeure: 30,   // fichiers déposés, par adresse IP
});

export function createOmdaServer({ settings = config, logger = console, fetchImpl = fetch, limites = {} } = {}) {
  const lim = { ...LIMITES_PAR_DEFAUT, ...(settings.limites ?? {}), ...limites };
  const HEURE = 60 * 60 * 1000;
  const creations = creerCompteur(lim.creationsParHeure, HEURE);
  const requetesCode = creerCompteur(lim.requetesCodeParDix_min, 10 * 60 * 1000);
  const echecsCode = creerCompteur(lim.echecsCodeParHeure, HEURE);
  const televersements = creerCompteur(lim.televersementsParHeure, HEURE);

  const refuserTropDeRequetes = (res, attente, code, message, reference) => {
    res.setHeader('retry-after', String(attente));
    return json(res, 429, { code, message, reference });
  };
  /** Vrai (et réponse 429 envoyée) si ce dossier a reçu trop de codes erronés. */
  const bloqueParEchecs = (res, numero, reference) => {
    const attente = echecsCode.atteint(numero);
    if (!attente) return false;
    refuserTropDeRequetes(res, attente, 'TROP_DE_TENTATIVES', 'Trop de tentatives avec un code de suivi incorrect. Réessayez plus tard.', reference);
    return true;
  };

  const gerer = async (req, res) => {
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId);

    const origin = req.headers.origin;
    if (origin && settings.allowedOrigins.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-headers', 'content-type, idempotency-key, x-code-suivi, x-numero-dossier, authorization');
      res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, OPTIONS');
    } else if (origin && settings.nodeEnv === 'production') {
      return json(res, 403, { code: 'ORIGINE_NON_AUTORISEE', message: 'Cette origine n’est pas autorisée.' });
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    // L'hôte demandé n'est jamais utilisé : une base fixe évite qu'un en-tête Host invalide lève une exception.
    const url = new URL(req.url ?? '/', 'http://localhost');
    const ip = adresseClient(req, settings.trustProxyHops ?? 0);

    if (url.pathname === '/v1/demandes' && req.method === 'POST') {
      const attente = creations.atteint(ip);
      if (attente) return refuserTropDeRequetes(res, attente, 'TROP_DE_DEMANDES', 'Trop de dossiers ont été créés depuis cette connexion. Réessayez plus tard.', requestId);
      creations.ajouter(ip);
    }
    if (/^\/v1\/(suivi\/[^/]+|demandes\/[^/]+(\/envoi)?|fichiers)$/.test(url.pathname) && req.method !== 'OPTIONS') {
      const attente = requetesCode.atteint(ip);
      if (attente) return refuserTropDeRequetes(res, attente, 'TROP_DE_REQUETES', 'Trop de requêtes depuis cette connexion. Réessayez dans quelques minutes.', requestId);
      requetesCode.ajouter(ip);
    }
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, {
        status: 'ok',
        service: 'omda-api',
        version: '1.0.0',
        integrations: {
          supabaseConfigured: Boolean(settings.supabaseUrl && settings.supabaseServiceRoleKey),
          paymentProviderConfigured: paymentIntegrationReady(settings),
          paymentInitiationEnabled: false,
          paymentCallbackEnabled: false,
        },
      });
    }

    // Public candidate endpoints. All database access stays server-side.
    if (url.pathname === '/v1/demandes' && req.method === 'POST') {
      if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
        return json(res, 415, { code: 'TYPE_CONTENU_NON_AUTORISE', message: 'Le contenu doit être au format JSON.', reference: requestId });
      }
      let body;
      try {
        const raw = await readBody(req, settings.maxBodyBytes);
        body = raw ? JSON.parse(raw) : null;
      } catch (error) {
        const status = error.status ?? 400;
        return json(res, status, { code: status === 413 ? 'REQUETE_TROP_VOLUMINEUSE' : 'JSON_INVALIDE', message: status === 413 ? 'La requête dépasse la taille maximale autorisée.' : 'Le corps JSON est invalide.', reference: requestId });
      }
      const identite = body?.identite;
      const categorieId = body?.categorie_id;
      const champs = ['nom', 'prenom', 'pseudonyme', 'date_naissance', 'cin', 'telephone', 'email', 'adresse'];
      if (!identite || typeof identite !== 'object' || champs.some((key) => typeof identite[key] !== 'string' || !identite[key].trim()) || typeof categorieId !== 'string' || !/^[0-9a-f-]{36}$/i.test(categorieId)) {
        return json(res, 422, { code: 'IDENTITE_INVALIDE', message: 'Veuillez vérifier les informations d’identité et la catégorie sélectionnée.', reference: requestId });
      }
      const age = ageEnAnnees(identite.date_naissance);
      if (age === null) return json(res, 422, { code: 'DATE_NAISSANCE_INVALIDE', message: 'La date de naissance doit être une date valide au format AAAA-MM-JJ.', reference: requestId });
      if (age < 15) return json(res, 422, { code: 'AGE_INSUFFISANT', message: 'Une demande d’adhésion est possible à partir de 15 ans.', reference: requestId });
      if (!settings.trackingCodePepper || settings.trackingCodePepper.length < 32) {
        return json(res, 503, { code: 'CONFIGURATION_SECURITE_INCOMPLETE', message: 'Le service de création de dossier n’est pas encore configuré de manière sécurisée.', reference: requestId });
      }
      try {
        const candidatRows = await supabaseRequest(settings, 'candidat?select=id', {
          fetchImpl, method: 'POST', prefer: 'return=representation', body: [{
            nom: identite.nom.trim(), prenom: identite.prenom.trim(), date_naissance: identite.date_naissance,
            cin: identite.cin.trim(), telephone: identite.telephone.trim(), email: identite.email.trim().toLowerCase(), adresse: identite.adresse.trim(),
          }],
        });
        const candidat = Array.isArray(candidatRows) ? candidatRows[0] : null;
        if (!candidat?.id) throw Object.assign(new Error('La création du candidat n’a pas retourné d’identifiant.'), { status: 503, code: 'CREATION_CANDIDAT_INCOMPLETE' });
        const codeSuivi = genererCodeSuivi();
        const numero = numeroDossier();
        let demandeRows;
        try {
          demandeRows = await supabaseRequest(settings, 'demande_adhesion?select=id,numero_dossier,statut,created_at', {
            fetchImpl, method: 'POST', prefer: 'return=representation', body: [{
              numero_dossier: numero, jeton_suivi_hash: hashCodeSuivi(codeSuivi, settings.trackingCodePepper),
              candidat_id: candidat.id, categorie_id: categorieId, statut: 'BROUILLON',
            }],
          });
        } catch (error) {
          // Best-effort rollback to avoid orphan candidate rows if demand creation fails.
          try { await supabaseRequest(settings, `candidat?id=eq.${encodeURIComponent(candidat.id)}`, { fetchImpl, method: 'DELETE', prefer: 'return=minimal' }); } catch { /* recorded by outer error handling */ }
          throw error;
        }
        const demande = Array.isArray(demandeRows) ? demandeRows[0] : null;
        if (!demande?.id) throw Object.assign(new Error('La création du dossier n’a pas retourné d’identifiant.'), { status: 503, code: 'CREATION_DEMANDE_INCOMPLETE' });
        return json(res, 201, { demande_id: demande.id, numero_dossier: demande.numero_dossier, code_suivi: codeSuivi, statut: demande.statut, created_at: demande.created_at });
      } catch (error) {
        logger.error?.({ requestId, errorCode: error.code, status: error.status }, 'Candidate draft creation failed');
        const mapped = codeErreurDepuis(error, requestId);
        return json(res, mapped.status, mapped.body);
      }
    }

    const updateDraftMatch = url.pathname.match(/^\/v1\/demandes\/([^/]+)$/);
    if (updateDraftMatch && req.method === 'PATCH') {
      const numero = decoderSegment(updateDraftMatch[1]);
      if (numero === null) return json(res, 400, { code: 'NUMERO_DOSSIER_INVALIDE', message: 'Le numéro de dossier est invalide.', reference: requestId });
      const codeSuivi = String(req.headers['x-code-suivi'] ?? '').trim();
      if (!codeSuivi || !settings.trackingCodePepper || settings.trackingCodePepper.length < 32) {
        return json(res, 401, { code: 'CODE_SUIVI_INVALIDE', message: 'Le numéro de dossier et le code de suivi ne correspondent pas.', reference: requestId });
      }
      if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
        return json(res, 415, { code: 'TYPE_CONTENU_NON_AUTORISE', message: 'Le contenu doit être au format JSON.', reference: requestId });
      }
      let body;
      try {
        const raw = await readBody(req, settings.maxBodyBytes);
        body = raw ? JSON.parse(raw) : null;
      } catch (error) {
        const status = error.status ?? 400;
        return json(res, status, { code: status === 413 ? 'REQUETE_TROP_VOLUMINEUSE' : 'JSON_INVALIDE', message: status === 413 ? 'La requête dépasse la taille maximale autorisée.' : 'Le corps JSON est invalide.', reference: requestId });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body) || (body.identite !== undefined && (!body.identite || typeof body.identite !== 'object' || Array.isArray(body.identite))) || (body.categorie_id !== undefined && (typeof body.categorie_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.categorie_id))) || (body.identite === undefined && body.categorie_id === undefined)) {
        return json(res, 422, { code: 'DONNEES_BROUILLON_INVALIDES', message: 'Fournissez une identité partielle ou une catégorie valide.', reference: requestId });
      }
      const champs = ['nom', 'prenom', 'date_naissance', 'cin', 'telephone', 'email', 'adresse'];
      if (body.identite && Object.keys(body.identite).some((key) => !champs.includes(key) || typeof body.identite[key] !== 'string')) {
        return json(res, 422, { code: 'IDENTITE_INVALIDE', message: 'Un ou plusieurs champs d’identité sont invalides.', reference: requestId });
      }
      if (body.identite?.date_naissance !== undefined) {
        const age = ageEnAnnees(body.identite.date_naissance);
        if (age === null) return json(res, 422, { code: 'DATE_NAISSANCE_INVALIDE', message: 'La date de naissance doit être au format AAAA-MM-JJ.', reference: requestId });
        if (age < 15) return json(res, 422, { code: 'AGE_INSUFFISANT', message: 'Une demande d’adhésion est possible à partir de 15 ans.', reference: requestId });
      }
      try {
        if (bloqueParEchecs(res, numero, requestId)) return;
        const rows = await supabaseRequest(settings, `demande_adhesion?numero_dossier=eq.${encodeURIComponent(numero)}&select=id,numero_dossier,candidat_id,jeton_suivi_hash,statut,created_at`, { fetchImpl });
        const demande = Array.isArray(rows) ? rows[0] : null;
        const fourni = hashCodeSuivi(codeSuivi, settings.trackingCodePepper);
        if (!demande || !comparerHash(fourni, demande.jeton_suivi_hash ?? '')) {
          echecsCode.ajouter(numero);
          return json(res, 401, { code: 'CODE_SUIVI_INVALIDE', message: 'Le numéro de dossier et le code de suivi ne correspondent pas.', reference: requestId });
        }
        if (demande.statut !== 'BROUILLON') {
          return json(res, 409, { code: 'DEMANDE_NON_MODIFIABLE', message: 'Seul un brouillon peut être modifié.', reference: requestId });
        }
        const result = await supabaseRequest(settings, 'rpc/omda_mettre_a_jour_brouillon', {
          fetchImpl, method: 'POST', body: {
            p_demande_id: demande.id,
            p_candidat_id: demande.candidat_id,
            p_identite: body.identite ?? {},
            p_categorie_id: body.categorie_id ?? null,
          },
        });
        const updated = Array.isArray(result) ? result[0] : result;
        return json(res, 200, {
          demande_id: updated.demande_id ?? demande.id,
          numero_dossier: updated.numero_dossier ?? numero,
          code_suivi: codeSuivi,
          statut: updated.statut ?? 'BROUILLON',
          created_at: updated.created_at ?? demande.created_at,
        });
      } catch (error) {
        logger.error?.({ requestId, errorCode: error.code, status: error.status }, 'Candidate draft update failed');
        if (String(error.message).includes('DEMANDE_NON_MODIFIABLE')) return json(res, 409, { code: 'DEMANDE_NON_MODIFIABLE', message: 'Seul un brouillon peut être modifié.', reference: requestId });
        if (String(error.message).includes('CATEGORIE_INDISPONIBLE')) return json(res, 422, { code: 'CATEGORIE_INDISPONIBLE', message: 'La catégorie sélectionnée n’est plus disponible.', reference: requestId });
        const mapped = codeErreurDepuis(error, requestId);
        return json(res, mapped.status, mapped.body);
      }
    }

    const suiviMatch = url.pathname.match(/^\/v1\/suivi\/([^/]+)$/);
    if (suiviMatch && req.method === 'GET') {
      const numero = decoderSegment(suiviMatch[1]);
      if (numero === null) return json(res, 400, { code: 'NUMERO_DOSSIER_INVALIDE', message: 'Le numéro de dossier est invalide.', reference: requestId });
      const codeSuivi = String(req.headers['x-code-suivi'] ?? '').trim();
      if (!codeSuivi || !settings.trackingCodePepper || settings.trackingCodePepper.length < 32) {
        return json(res, 401, { code: 'CODE_SUIVI_INVALIDE', message: 'Le numéro de dossier et le code de suivi ne correspondent pas.', reference: requestId });
      }
      try {
        if (bloqueParEchecs(res, numero, requestId)) return;
        const rows = await supabaseRequest(settings, `demande_adhesion?numero_dossier=eq.${encodeURIComponent(numero)}&select=id,numero_dossier,jeton_suivi_hash,statut,motif_rejet,date_soumission,date_decision,updated_at,categorie_id`, { fetchImpl });
        const demande = Array.isArray(rows) ? rows[0] : null;
        const fourni = Buffer.from(hashCodeSuivi(codeSuivi, settings.trackingCodePepper));
        const attendu = Buffer.from(demande?.jeton_suivi_hash ?? '0'.repeat(64));
        if (!demande || !comparerHash(fourni.toString(), attendu.toString())) {
          echecsCode.ajouter(numero);
          return json(res, 401, { code: 'CODE_SUIVI_INVALIDE', message: 'Le numéro de dossier et le code de suivi ne correspondent pas.', reference: requestId });
        }
        if (demande.statut === 'REJETEE' && (typeof demande.motif_rejet !== 'string' || !demande.motif_rejet.trim())) {
          logger.error?.({ requestId, numero_dossier: numero }, 'Rejected demand is missing its rejection reason');
          return json(res, 503, { code: 'DOSSIER_INCOHERENT', message: 'Le dossier présente une incohérence et son suivi est momentanément indisponible.', reference: requestId });
        }
        const statutsApresEnvoi = ['ENVOYEE', 'EN_COURS_DE_VERIFICATION', 'VALIDEE', 'REJETEE', 'ADHESION_TERMINEE'];
        const verificationTerminee = ['VALIDEE', 'REJETEE', 'ADHESION_TERMINEE'].includes(demande.statut);
        const validationReussie = ['VALIDEE', 'ADHESION_TERMINEE'].includes(demande.statut);
        const etapes = [
          { statut: 'ENVOYEE', libelle: 'Demande reçue', realisee: statutsApresEnvoi.includes(demande.statut), date: demande.date_soumission ?? null },
          { statut: 'EN_COURS_DE_VERIFICATION', libelle: 'Vérification du dossier', realisee: demande.statut === 'EN_COURS_DE_VERIFICATION' || verificationTerminee, date: null },
          { statut: 'VALIDEE', libelle: 'Demande validée', realisee: validationReussie, date: validationReussie ? (demande.date_decision ?? null) : null },
          { statut: 'REJETEE', libelle: 'Demande rejetée', realisee: demande.statut === 'REJETEE', date: demande.statut === 'REJETEE' ? (demande.date_decision ?? null) : null },
          { statut: 'ADHESION_TERMINEE', libelle: 'Adhésion terminée', realisee: demande.statut === 'ADHESION_TERMINEE', date: null },
        ];
        let paiementDu = null;
        if (demande.statut === 'VALIDEE') {
          const tarifs = await supabaseRequest(settings, `tarif?type_operation=eq.ADHESION&actif=eq.true&select=montant,devise,categorie_id`, { fetchImpl });
          const listeTarifs = Array.isArray(tarifs) ? tarifs : [];
          const tarif = listeTarifs.find((t) => t.categorie_id === demande.categorie_id)
            ?? listeTarifs.find((t) => !t.categorie_id);
          if (tarif && Number.isInteger(tarif.montant) && tarif.montant >= 0 && /^[A-Z]{3}$/.test(tarif.devise ?? 'MGA')) {
            paiementDu = { type: 'ADHESION', montant: tarif.montant, devise: tarif.devise ?? 'MGA' };
          }
          if (!paiementDu) return json(res, 503, { code: 'TARIF_ADHESION_INDISPONIBLE', message: 'Le tarif d’adhésion ne peut pas être déterminé pour le moment.', reference: requestId });
        }
        return json(res, 200, {
          numero_dossier: demande.numero_dossier,
          statut: demande.statut,
          derniere_mise_a_jour: demande.updated_at ?? demande.date_decision ?? demande.date_soumission,
          etapes,
          motif_rejet: demande.statut === 'REJETEE' ? demande.motif_rejet.trim() : null,
          paiement_du: paiementDu,
        });
      } catch (error) {
        logger.error?.({ requestId, errorCode: error.code, status: error.status }, 'Candidate tracking failed');
        const mapped = codeErreurDepuis(error, requestId);
        return json(res, mapped.status, mapped.body);
      }
    }

    const submitMatch = url.pathname.match(/^\/v1\/demandes\/([^/]+)\/envoi$/);
    if (submitMatch && req.method === 'POST') {
      const numero = decoderSegment(submitMatch[1]);
      if (numero === null) return json(res, 400, { code: 'NUMERO_DOSSIER_INVALIDE', message: 'Le numéro de dossier est invalide.', reference: requestId });
      const codeSuivi = String(req.headers['x-code-suivi'] ?? '').trim();
      const numeroEntete = String(req.headers['x-numero-dossier'] ?? '').trim();
      const idempotencyKey = String(req.headers['idempotency-key'] ?? '').trim();
      if (!codeSuivi || !numeroEntete || numeroEntete !== numero || !settings.trackingCodePepper || settings.trackingCodePepper.length < 32) {
        return json(res, 401, { code: 'CODE_SUIVI_INVALIDE', message: 'Le numéro de dossier et le code de suivi ne correspondent pas.', reference: requestId });
      }
      if (!idempotencyKey || idempotencyKey.length > 200) return json(res, 400, { code: 'CLE_IDEMPOTENCE_REQUISE', message: 'Une clé d’idempotence valide est obligatoire pour envoyer le dossier.', reference: requestId });
      if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) return json(res, 415, { code: 'TYPE_CONTENU_NON_AUTORISE', message: 'Le contenu doit être au format JSON.', reference: requestId });
      let body;
      try {
        const raw = await readBody(req, settings.maxBodyBytes);
        body = raw ? JSON.parse(raw) : null;
      } catch (error) {
        const status = error.status ?? 400;
        return json(res, status, { code: status === 413 ? 'REQUETE_TROP_VOLUMINEUSE' : 'JSON_INVALIDE', message: status === 413 ? 'La requête dépasse la taille maximale autorisée.' : 'Le corps JSON est invalide.', reference: requestId });
      }
      const validation = validerSoumission(body);
      if (validation) {
        const code = validation;
        return json(res, 422, { code, message: code === 'DOSSIER_INCOMPLET' ? 'Votre dossier est incomplet : chaque œuvre doit être accompagnée de sa fiche de déclaration, et d’une attestation de diffusion selon votre situation (cas A/B/C de la règle 3).' : 'Les informations envoyées ne respectent pas le contrat de soumission.', reference: requestId });
      }
      try {
        if (bloqueParEchecs(res, numero, requestId)) return;
        const rows = await supabaseRequest(settings, `demande_adhesion?numero_dossier=eq.${encodeURIComponent(numero)}&select=id,numero_dossier,candidat_id,jeton_suivi_hash,statut,categorie_id`, { fetchImpl });
        const demande = Array.isArray(rows) ? rows[0] : null;
        if (!demande || !comparerHash(hashCodeSuivi(codeSuivi, settings.trackingCodePepper), demande.jeton_suivi_hash ?? '')) { echecsCode.ajouter(numero); return json(res, 401, { code: 'CODE_SUIVI_INVALIDE', message: 'Le numéro de dossier et le code de suivi ne correspondent pas.', reference: requestId }); }
        if (!['BROUILLON', 'ENVOYEE'].includes(demande.statut)) return json(res, 409, { code: 'DEMANDE_NON_MODIFIABLE', message: 'Seul un brouillon peut être envoyé. Vérifiez le statut actuel du dossier.', reference: requestId });
        if (!settings.supabaseUrl || !settings.supabaseServiceRoleKey) return json(res, 503, { code: 'SUPABASE_NON_CONFIGURE', message: 'La base et le stockage ne sont pas configurés.', reference: requestId });
        // Vérifier que chaque chemin correspond à un objet qui existe réellement dans le stockage privé.
        const fichiers = [
          ...body.pieces.map((file) => ({ ...file, bucket: 'pieces' })),
          ...body.oeuvres.flatMap((work) => [{ ...work.fiche_declaration, bucket: 'oeuvres' }, { ...work.fichier, bucket: 'oeuvres' }, ...work.attestations.map((file) => ({ ...file, bucket: 'pieces' }))]),
        ];
        for (const file of fichiers) {
          const objectPath = file.chemin_stockage.slice(file.bucket.length + 1);
          const storageUrl = `${settings.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${file.bucket}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
          const stored = await fetchImpl(storageUrl, { method: 'HEAD', headers: { apikey: settings.supabaseServiceRoleKey, authorization: `Bearer ${settings.supabaseServiceRoleKey}` } });
          if (!stored.ok) return json(res, 422, { code: 'FICHIER_INTROUVABLE', message: 'Un des fichiers joints est absent du stockage. Veuillez le téléverser à nouveau.', reference: requestId });
          const storageMime = stored.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
          const storageSize = Number(stored.headers.get('content-length'));
          if ((storageMime && storageMime !== file.mime_type.toLowerCase()) || (Number.isFinite(storageSize) && storageSize > 0 && storageSize !== file.taille_octets)) return json(res, 422, { code: 'METADONNEES_FICHIER_INCOHERENTES', message: 'Les informations d’un fichier joint ne correspondent pas au fichier stocké.', reference: requestId });
        }
        const result = await supabaseRequest(settings, 'rpc/omda_soumettre_demande', {
          method: 'POST', fetchImpl, body: {
            p_demande_id: demande.id,
            p_candidat_id: demande.candidat_id,
            p_categorie_id: body.categorie_id,
            p_pieces: body.pieces,
            p_oeuvres: body.oeuvres,
            p_idempotency_key: idempotencyKey,
          },
        });
        const confirmation = Array.isArray(result) ? result[0] : result;
        if (!confirmation?.date_soumission) throw Object.assign(new Error('Réponse de soumission incomplète.'), { status: 503, code: 'CONFIRMATION_ENVOI_INCOMPLETE' });
        return json(res, 200, { numero_dossier: confirmation.numero_dossier ?? numero, code_suivi: codeSuivi, statut: confirmation.statut ?? 'ENVOYEE', date_soumission: confirmation.date_soumission, delai_indicatif_heures: 72 });
      } catch (error) {
        logger.error?.({ requestId, errorCode: error.code, status: error.status }, 'Candidate submission failed');
        if (String(error.message).includes('AUTORISATION_PARENTALE_REQUISE')) return json(res, 422, { code: 'AUTORISATION_PARENTALE_REQUISE', message: 'Une autorisation parentale est exigée pour les personnes de 15 à 17 ans.', reference: requestId });
        if (String(error.message).includes('AGE_INSUFFISANT')) return json(res, 422, { code: 'AGE_INSUFFISANT', message: 'Une demande d’adhésion est possible à partir de 15 ans.', reference: requestId });
        if (String(error.message).includes('DEMANDE_NON_MODIFIABLE')) return json(res, 409, { code: 'DEMANDE_NON_MODIFIABLE', message: 'Seul un brouillon peut être envoyé.', reference: requestId });
        if (String(error.message).includes('CATEGORIE_INDISPONIBLE')) return json(res, 422, { code: 'CATEGORIE_INDISPONIBLE', message: 'La catégorie sélectionnée n’est plus disponible.', reference: requestId });
        const mapped = codeErreurDepuis(error, requestId);
        return json(res, mapped.status, mapped.body);
      }
    }

    if (url.pathname === '/v1/fichiers' && req.method === 'POST') {
      // Every upload must belong to an authenticated candidate draft. The tracking
      // code is checked before accepting up to 20 MiB of data.
      const numeroDossierUpload = String(req.headers['x-numero-dossier'] ?? '').trim();
      const codeSuiviUpload = String(req.headers['x-code-suivi'] ?? '').trim();
      if (!numeroDossierUpload || !codeSuiviUpload || !settings.trackingCodePepper || settings.trackingCodePepper.length < 32) {
        return json(res, 401, { code: 'CODE_SUIVI_INVALIDE', message: 'Un numéro de dossier et un code de suivi valides sont obligatoires pour déposer un fichier.', reference: requestId });
      }
      if (!settings.supabaseUrl || !settings.supabaseServiceRoleKey) {
        return json(res, 503, { code: 'SUPABASE_NON_CONFIGURE', message: 'La base et le stockage des fichiers ne sont pas configurés.', reference: requestId });
      }
      try {
        if (bloqueParEchecs(res, numeroDossierUpload, requestId)) return;
        const drafts = await supabaseRequest(settings, `demande_adhesion?numero_dossier=eq.${encodeURIComponent(numeroDossierUpload)}&select=jeton_suivi_hash,statut`, { fetchImpl });
        const draft = Array.isArray(drafts) ? drafts[0] : null;
        if (!draft || !comparerHash(hashCodeSuivi(codeSuiviUpload, settings.trackingCodePepper), draft.jeton_suivi_hash ?? '')) {
          echecsCode.ajouter(numeroDossierUpload);
          return json(res, 401, { code: 'CODE_SUIVI_INVALIDE', message: 'Le numéro de dossier et le code de suivi ne correspondent pas.', reference: requestId });
        }
        if (draft.statut !== 'BROUILLON') {
          return json(res, 409, { code: 'DEMANDE_NON_MODIFIABLE', message: 'Les fichiers ne peuvent être ajoutés qu’à un brouillon.', reference: requestId });
        }
      } catch (error) {
        logger.error?.({ requestId, errorCode: error.code, status: error.status }, 'Upload authorization failed');
        const mapped = codeErreurDepuis(error, requestId);
        return json(res, mapped.status, mapped.body);
      }
      const attenteUpload = televersements.atteint(ip);
      if (attenteUpload) {
        return refuserTropDeRequetes(res, attenteUpload, 'LIMITE_TELEVERSEMENT_ATTEINTE', 'Trop de fichiers ont été envoyés depuis cette connexion. Réessayez plus tard.', requestId);
      }
      televersements.ajouter(ip);
      const contentType = String(req.headers['content-type'] ?? '');
      if (!/^multipart\/form-data\s*;/i.test(contentType)) {
        return json(res, 415, { code: 'TYPE_CONTENU_NON_AUTORISE', message: 'Le fichier doit être envoyé en multipart/form-data.', reference: requestId });
      }
      let parts;
      try {
        const raw = await lireBuffer(req, MAX_MULTIPART_OCTETS);
        parts = extraireMultipart(raw, contentType);
      } catch (error) {
        const status = error.status ?? 400;
        return json(res, status, { code: status === 413 ? 'FICHIER_TROP_VOLUMINEUX' : (error.code ?? 'MULTIPART_INVALIDE'), message: status === 413 ? 'Le fichier dépasse la taille maximale de 20 Mo.' : 'Le formulaire de téléversement est invalide.', reference: requestId });
      }
      const bucket = parts.get('bucket')?.value;
      const cheminDemande = parts.get('chemin_stockage')?.value;
      const fichier = parts.get('fichier');
      if (!['pieces', 'oeuvres'].includes(bucket) || !cheminDemande || !fichier?.data || !fichier.filename) {
        return json(res, 422, { code: 'DONNEES_TELEVERSEMENT_INVALIDES', message: 'Le bucket, le chemin et le fichier sont obligatoires.', reference: requestId });
      }
      if (fichier.data.length === 0) return json(res, 422, { code: 'FICHIER_VIDE', message: 'Le fichier est vide.', reference: requestId });
      if (fichier.data.length > MAX_FICHIER_OCTETS) return json(res, 413, { code: 'FICHIER_TROP_VOLUMINEUX', message: 'Le fichier dépasse la taille maximale de 20 Mo.', reference: requestId });
      const mimeAnnonce = fichier.mime;
      const mimeDetecte = mimeReel(fichier.data);
      if (!MIME_PAR_BUCKET[bucket].has(mimeAnnonce) || !mimeDetecte || mimeDetecte !== mimeAnnonce) {
        return json(res, 422, { code: 'TYPE_FICHIER_NON_AUTORISE', message: 'Le contenu du fichier ne correspond pas à un format autorisé pour ce dépôt.', reference: requestId });
      }
      // Le chemin fourni par le mobile n'est jamais utilisé comme chemin de destination.
      // Un préfixe aléatoire empêche les collisions et limite la possibilité de deviner un objet temporaire.
      const nom = nomFichierSecurise(fichier.filename || cheminDemande.split('/').pop());
      const cheminObjet = `${randomUUID()}/${nom}`;
      const cheminRetour = `${bucket}/${cheminObjet}`;
      try {
        const segments = cheminObjet.split('/').map((segment) => encodeURIComponent(segment)).join('/');
        const storageUrl = `${settings.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/${bucket}/${segments}`;
        const response = await fetchImpl(storageUrl, {
          method: 'POST',
          headers: {
            apikey: settings.supabaseServiceRoleKey,
            authorization: `Bearer ${settings.supabaseServiceRoleKey}`,
            'content-type': mimeDetecte,
            'cache-control': '3600',
            'x-upsert': 'false',
          },
          body: fichier.data,
        });
        if (!response.ok) {
          logger.error?.({ requestId, storageStatus: response.status }, 'Storage upload rejected');
          return json(res, response.status === 413 ? 413 : 503, { code: response.status === 413 ? 'FICHIER_TROP_VOLUMINEUX' : 'STOCKAGE_INDISPONIBLE', message: response.status === 413 ? 'Le fichier dépasse la taille maximale autorisée.' : 'Le stockage a refusé le fichier. Réessayez plus tard.', reference: requestId });
        }
        return json(res, 201, { chemin_stockage: cheminRetour, mime_type: mimeDetecte, taille_octets: fichier.data.length });
      } catch (error) {
        logger.error?.({ requestId, errorCode: error.code }, 'Storage upload failed');
        return json(res, 503, { code: 'STOCKAGE_INDISPONIBLE', message: 'Le stockage est momentanément indisponible.', reference: requestId });
      }
    }

    // Fail closed: these endpoints must never fabricate a payment or a success.
    if (url.pathname.startsWith('/v1/paiements') || url.pathname === '/v1/webhooks/mvola') {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
          if (!contentType.includes('application/json')) {
            return json(res, 415, { code: 'TYPE_CONTENU_NON_AUTORISE', message: 'Le contenu doit être au format JSON.', reference: requestId });
          }
          await readBody(req, settings.maxBodyBytes);
        }
      } catch (error) {
        return json(res, error.status ?? 400, { code: 'REQUETE_INVALIDE', message: error.status === 413 ? 'La requête dépasse la taille maximale autorisée.' : 'La requête n’a pas pu être lue.', reference: requestId });
      }

      logger.warn?.({ requestId, path: url.pathname }, 'Payment endpoint is deliberately disabled until the official provider adapter and callback verification are implemented');
      return json(res, 503, {
        code: 'INTEGRATION_MVOLA_NON_IMPLEMENTEE',
        message: 'L’intégration MVola côté serveur n’est pas encore implémentée. Aucune transaction n’a été initiée ni confirmée.',
        reference: requestId,
      });
    }

    if (url.pathname.startsWith('/v1/')) {
      return json(res, 501, {
        code: 'ENDPOINT_NON_IMPLEMENTE',
        message: 'Cet endpoint de l’API OMDA n’est pas encore implémenté.',
        reference: requestId,
      });
    }

    return json(res, 404, { code: 'ROUTE_INTROUVABLE', message: 'La route demandée n’existe pas.', reference: requestId });
  };

  // Garde globale : aucune exception d'une requête ne doit arrêter le processus.
  return createServer((req, res) => {
    gerer(req, res).catch((error) => {
      logger.error?.({ requestId: res.getHeader('x-request-id'), errorName: error?.name, errorMessage: error?.message }, 'Unhandled request error');
      if (!res.headersSent) json(res, 500, { code: 'ERREUR_INTERNE', message: 'Une erreur interne est survenue.', reference: res.getHeader('x-request-id') });
      else res.end();
    });
  });
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const server = createOmdaServer();
  server.listen(config.port, config.host, () => {
    console.log(`OMDA API listening on http://${config.host}:${config.port}`);
  });
  process.on('unhandledRejection', (raison) => console.error('Promesse rejetée non gérée :', raison));
  process.on('uncaughtException', (erreurNonGeree) => console.error('Exception non gérée :', erreurNonGeree));
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
