// Prints the Apple team ID (the App ID prefix of the app's bundle ID).
import crypto from 'node:crypto';
import fs from 'node:fs';
const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_PRIVATE_KEY } = process.env;
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const head = b64({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' });
const body = b64({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: crypto.createPrivateKey(process.env.KEY_PATH ? fs.readFileSync(process.env.KEY_PATH, 'utf8') : ASC_PRIVATE_KEY), dsaEncoding: 'ieee-p1363' });
const res = await fetch('https://api.appstoreconnect.apple.com/v1/bundleIds?filter[identifier]=com.bishimitsu.micromayhem', {
  headers: { Authorization: `Bearer ${head}.${body}.${sig.toString('base64url')}` },
});
const json = await res.json();
const match = (json.data || []).find(b => b.attributes.identifier === 'com.bishimitsu.micromayhem');
if (!match) { console.error('Bundle ID not found', JSON.stringify(json.errors || json)); process.exit(1); }
console.log(match.attributes.seedId);
