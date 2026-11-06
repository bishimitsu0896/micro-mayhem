// Sets Micro Mayhem up in App Store Connect through the API. Safe to re-run.
//  1. Registers the bundle ID (com.bishimitsu.micromayhem) with Game Center switched on.
//  2. Once the app record exists in App Store Connect, turns on Game Center for it
//     and creates the high-score leaderboard with its English (UK) name.
//
// Needs env: ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY (contents of the .p8 file)

import crypto from 'node:crypto';
import fs from 'node:fs';

const API = 'https://api.appstoreconnect.apple.com/v1';
const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY } = process.env;
if (!ASC_ISSUER_ID || !ASC_KEY_ID || !ASC_PRIVATE_KEY) {
  console.error('Missing ASC_ISSUER_ID, ASC_KEY_ID or ASC_PRIVATE_KEY repository secrets.');
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync('store/setup.json', 'utf8'));

// Shape check on the secrets (never prints the values), so a mix-up is easy to spot.
{
  const iss = ASC_ISSUER_ID.trim(), kid = ASC_KEY_ID.trim(), pk = ASC_PRIVATE_KEY.replace(/\\n/g, '\n').trim();
  const checks = [
    ['ASC_ISSUER_ID looks like a UUID (8-4-4-4-12)', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(iss), `length ${iss.length}`],
    ['ASC_KEY_ID is 10 letters/digits', /^[A-Z0-9]{10}$/.test(kid), `length ${kid.length}`],
    ['ASC_PRIVATE_KEY starts with -----BEGIN PRIVATE KEY-----', pk.startsWith('-----BEGIN PRIVATE KEY-----'), `length ${pk.length}`],
    ['ASC_PRIVATE_KEY ends with -----END PRIVATE KEY-----', pk.endsWith('-----END PRIVATE KEY-----'), `${pk.split('\n').length} lines`],
  ];
  let keyOk = true;
  try { crypto.createPrivateKey(pk); } catch { keyOk = false; }
  checks.push(['ASC_PRIVATE_KEY parses as a private key', keyOk, '']);
  for (const [label, ok, info] of checks) console.log(`${ok ? 'OK  ' : 'BAD '} ${label} ${ok ? '' : '(' + info + ')'}`);
  if (/^AuthKey_/i.test(kid)) console.log('BAD  ASC_KEY_ID should be just the 10-character ID, without "AuthKey_"');
}

function token() {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: ASC_KEY_ID.trim(), typ: 'JWT' });
  const body = b64({ iss: ASC_ISSUER_ID.trim(), iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' });
  const key = crypto.createPrivateKey(ASC_PRIVATE_KEY.replace(/\\n/g, '\n').trim());
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

async function api(method, path, body) {
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const detail = (json.errors || []).map(e => `${e.title}: ${e.detail}`).join('; ');
    const err = new Error(`${method} ${path} -> ${res.status} ${detail || text}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const notice = (title, msg) => console.log(`::notice title=${title}::${msg}`);

async function ensureBundleId() {
  const found = await api('GET', `/bundleIds?filter[identifier]=${encodeURIComponent(cfg.bundleId)}&include=bundleIdCapabilities`);
  let bundle = (found.data || []).find(b => b.attributes.identifier === cfg.bundleId);
  if (!bundle) {
    bundle = (await api('POST', '/bundleIds', {
      data: { type: 'bundleIds', attributes: { identifier: cfg.bundleId, name: cfg.appName, platform: 'IOS' } },
    })).data;
    console.log(`+ Registered bundle ID ${cfg.bundleId}`);
  } else {
    console.log(`= Bundle ID ${cfg.bundleId} already registered`);
  }
  const caps = (found.included || []).filter(c => c.type === 'bundleIdCapabilities').map(c => c.attributes.capabilityType);
  if (!caps.includes('GAME_CENTER')) {
    try {
      await api('POST', '/bundleIdCapabilities', {
        data: {
          type: 'bundleIdCapabilities',
          attributes: { capabilityType: 'GAME_CENTER' },
          relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } } },
        },
      });
      console.log('+ Game Center switched on for the bundle ID');
    } catch (e) {
      // Game Center is on by default for new App IDs; a conflict here just means it is already there.
      console.log(`= Game Center capability: ${e.message}`);
    }
  }
  return bundle;
}

async function ensureLeaderboard(app) {
  let gcId;
  try {
    gcId = (await api('GET', `/apps/${app.id}/gameCenterDetail`)).data?.id;
  } catch (e) { if (e.status !== 404) throw e; }
  if (!gcId) {
    gcId = (await api('POST', '/gameCenterDetails', {
      data: { type: 'gameCenterDetails', relationships: { app: { data: { type: 'apps', id: app.id } } } },
    })).data.id;
    console.log('+ Game Center enabled for the app');
  }
  const lb = cfg.leaderboard;
  const existing = await api('GET', `/gameCenterDetails/${gcId}/gameCenterLeaderboards?limit=200`);
  let board = (existing.data || []).find(l => l.attributes.vendorIdentifier === lb.id);
  if (!board) {
    board = (await api('POST', '/gameCenterLeaderboards', {
      data: {
        type: 'gameCenterLeaderboards',
        attributes: {
          referenceName: lb.referenceName, vendorIdentifier: lb.id,
          defaultFormatter: 'INTEGER', submissionType: 'BEST_SCORE', scoreSortType: 'DESC',
        },
        relationships: { gameCenterDetail: { data: { type: 'gameCenterDetails', id: gcId } } },
      },
    })).data;
    console.log(`+ Leaderboard ${lb.id}`);
  } else {
    console.log(`= Leaderboard ${lb.id} already exists`);
  }
  const locs = await api('GET', `/gameCenterLeaderboards/${board.id}/localizations?limit=50`);
  if (!(locs.data || []).some(l => l.attributes.locale === cfg.locale)) {
    await api('POST', '/gameCenterLeaderboardLocalizations', {
      data: {
        type: 'gameCenterLeaderboardLocalizations',
        attributes: { locale: cfg.locale, name: lb.name, formatterSuffixSingular: lb.suffixSingular, formatterSuffix: lb.suffixPlural },
        relationships: { gameCenterLeaderboard: { data: { type: 'gameCenterLeaderboards', id: board.id } } },
      },
    });
    console.log(`+ Leaderboard name (${cfg.locale})`);
  }
}

async function main() {
  await ensureBundleId();
  const apps = await api('GET', `/apps?filter[bundleId]=${encodeURIComponent(cfg.bundleId)}`);
  const app = (apps.data || [])[0];
  if (!app) {
    notice('Next step', `Bundle ID is ready. Now create the app in App Store Connect (Apps > + > New App, bundle ID ${cfg.bundleId}), then run this workflow again to add the leaderboard.`);
    return;
  }
  console.log(`App ${app.attributes.name} (${app.id})`);
  await ensureLeaderboard(app);
  notice('Done', `Bundle ID, Game Center and the ${cfg.leaderboard.id} leaderboard are all set up.`);
}

main().catch(e => { console.log(`::error::${e.message}`); process.exit(1); });
