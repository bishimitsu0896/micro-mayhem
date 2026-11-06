// App Store Connect API helpers shared by the store scripts.
// Needs env: ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY (with or without its BEGIN/END lines)
import crypto from 'node:crypto';

export const API = 'https://api.appstoreconnect.apple.com/v1';
const { ASC_ISSUER_ID, ASC_KEY_ID } = process.env;
let KEY = process.env.ASC_PRIVATE_KEY;
if (!ASC_ISSUER_ID || !ASC_KEY_ID || !KEY) {
  console.log('::error::Missing ASC_ISSUER_ID, ASC_KEY_ID or ASC_PRIVATE_KEY repository secrets.');
  process.exit(1);
}
KEY = KEY.replace(/\\n/g, '\n').trim();
if (!KEY.includes('BEGIN PRIVATE KEY')) {
  KEY = `-----BEGIN PRIVATE KEY-----\n${KEY.replace(/\s+/g, '').match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----`;
}

function token() {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: ASC_KEY_ID.trim(), typ: 'JWT' });
  const body = b64({ iss: ASC_ISSUER_ID.trim(), iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: crypto.createPrivateKey(KEY), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

export async function api(method, path, body) {
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
