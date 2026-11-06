// Pushes the App Store listing in store/listing.json and the screenshots in
// store/screenshots/ to the app's editable version in App Store Connect. Safe to re-run:
// text is overwritten and the screenshot set is replaced.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { api } from './asc.mjs';

const cfg = JSON.parse(fs.readFileSync('store/setup.json', 'utf8'));
const L = JSON.parse(fs.readFileSync('store/listing.json', 'utf8'));
const step = (msg) => console.log(`- ${msg}`);
const problems = [];
async function attempt(label, fn) {
  try { await fn(); step(`${label}: done`); }
  catch (e) { problems.push(`${label}: ${e.message}`); console.log(`::warning title=${label}::${e.message}`); }
}

const app = (await api('GET', `/apps?filter[bundleId]=${encodeURIComponent(cfg.bundleId)}`)).data[0];
if (!app) { console.log(`::error::No app with bundle ID ${cfg.bundleId} in App Store Connect.`); process.exit(1); }
console.log(`App ${app.attributes.name} (${app.id})`);

// App-level info: subtitle, privacy policy URL, categories, content rights
const infos = (await api('GET', `/apps/${app.id}/appInfos`)).data;
const info = infos.find(i => !['READY_FOR_DISTRIBUTION', 'REPLACED_WITH_NEW_INFO'].includes(i.attributes.state || i.attributes.appStoreState)) || infos[0];
await attempt('Category', () => api('PATCH', `/appInfos/${info.id}`, {
  data: {
    type: 'appInfos', id: info.id,
    relationships: {
      primaryCategory: { data: { type: 'appCategories', id: L.primaryCategory } },
      primarySubcategoryOne: { data: { type: 'appCategories', id: L.subcategories[0] } },
      primarySubcategoryTwo: { data: { type: 'appCategories', id: L.subcategories[1] } },
    },
  },
}));
const infoLocs = (await api('GET', `/appInfos/${info.id}/appInfoLocalizations`)).data;
for (const loc of infoLocs) {
  await attempt(`Subtitle and privacy URL (${loc.attributes.locale})`, () => api('PATCH', `/appInfoLocalizations/${loc.id}`, {
    data: { type: 'appInfoLocalizations', id: loc.id, attributes: { subtitle: L.subtitle, privacyPolicyUrl: L.privacyPolicyUrl } },
  }));
}
await attempt('Content rights', () => api('PATCH', `/apps/${app.id}`, {
  data: { type: 'apps', id: app.id, attributes: { contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' } },
}));

// Version-level: description, keywords, URLs, copyright, screenshots
const versions = (await api('GET', `/apps/${app.id}/appStoreVersions?limit=20`)).data;
const editable = ['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY'];
const version = versions.find(v => editable.includes(v.attributes.appStoreState || v.attributes.appVersionState));
if (!version) { console.log('::error::No editable App Store version found (expected version 1.0 in Prepare for Submission).'); process.exit(1); }
console.log(`Version ${version.attributes.versionString} (${version.attributes.appStoreState})`);
await attempt('Copyright', () => api('PATCH', `/appStoreVersions/${version.id}`, {
  data: { type: 'appStoreVersions', id: version.id, attributes: { copyright: L.copyright } },
}));

const vLocs = (await api('GET', `/appStoreVersions/${version.id}/appStoreVersionLocalizations`)).data;
for (const loc of vLocs) {
  const tag = loc.attributes.locale;
  await attempt(`Description, keywords and URLs (${tag})`, () => api('PATCH', `/appStoreVersionLocalizations/${loc.id}`, {
    data: {
      type: 'appStoreVersionLocalizations', id: loc.id,
      attributes: { description: L.description, keywords: L.keywords, promotionalText: L.promotionalText, supportUrl: L.supportUrl, marketingUrl: L.marketingUrl },
    },
  }));

  await attempt(`Screenshots (${tag})`, async () => {
    const sets = (await api('GET', `/appStoreVersionLocalizations/${loc.id}/appScreenshotSets`)).data;
    let set = sets.find(s => s.attributes.screenshotDisplayType === L.screenshotDisplayType);
    if (!set) {
      set = (await api('POST', '/appScreenshotSets', {
        data: {
          type: 'appScreenshotSets', attributes: { screenshotDisplayType: L.screenshotDisplayType },
          relationships: { appStoreVersionLocalization: { data: { type: 'appStoreVersionLocalizations', id: loc.id } } },
        },
      })).data;
    }
    const old = (await api('GET', `/appScreenshotSets/${set.id}/appScreenshots`)).data;
    for (const s of old) await api('DELETE', `/appScreenshots/${s.id}`);
    for (const name of L.screenshots) {
      const bytes = fs.readFileSync(`store/screenshots/${name}`);
      const shot = (await api('POST', '/appScreenshots', {
        data: {
          type: 'appScreenshots', attributes: { fileName: name, fileSize: bytes.length },
          relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } },
        },
      })).data;
      for (const op of shot.attributes.uploadOperations || []) {
        const headers = Object.fromEntries((op.requestHeaders || []).map(h => [h.name, h.value]));
        const r = await fetch(op.url, { method: op.method, headers, body: bytes.subarray(op.offset, op.offset + op.length) });
        if (!r.ok) throw new Error(`upload of ${name} failed: ${r.status}`);
      }
      await api('PATCH', `/appScreenshots/${shot.id}`, {
        data: { type: 'appScreenshots', id: shot.id, attributes: { uploaded: true, sourceFileChecksum: crypto.createHash('md5').update(bytes).digest('hex') } },
      });
      step(`  uploaded ${name}`);
    }
  });
}

if (problems.length) {
  console.log(`::warning title=Some parts need a manual check::${problems.length} item(s) did not update; see the warnings above.`);
} else {
  console.log('::notice title=Listing updated::Text, category, screenshots and URLs are in App Store Connect.');
}
