// Creates the Game Center achievements listed in store/achievements.json
// through the App Store Connect API, including English (UK) text and badge images.
// Safe to re-run: anything that already exists is skipped. (Adapted from Colour Connect.)
import fs from 'node:fs';
import { api } from './asc.mjs';

const config = JSON.parse(fs.readFileSync('store/achievements.json', 'utf8'));

async function getAll(path) {
  let url = path, out = [];
  while (url) {
    const page = await api('GET', url);
    out = out.concat(page.data || []);
    url = page.links && page.links.next;
  }
  return out;
}

async function uploadImage(localizationId, file) {
  const bytes = fs.readFileSync(file);
  const fileName = file.split('/').pop();
  const created = await api('POST', '/gameCenterAchievementImages', {
    data: {
      type: 'gameCenterAchievementImages',
      attributes: { fileName, fileSize: bytes.length },
      relationships: { gameCenterAchievementLocalization: { data: { type: 'gameCenterAchievementLocalizations', id: localizationId } } },
    },
  });
  const img = created.data;
  for (const op of img.attributes.uploadOperations || []) {
    const headers = Object.fromEntries((op.requestHeaders || []).map(h => [h.name, h.value]));
    const chunk = bytes.subarray(op.offset, op.offset + op.length);
    const r = await fetch(op.url, { method: op.method, headers, body: chunk });
    if (!r.ok) throw new Error(`Image upload failed for ${fileName}: ${r.status}`);
  }
  await api('PATCH', `/gameCenterAchievementImages/${img.id}`, {
    data: { type: 'gameCenterAchievementImages', id: img.id, attributes: { uploaded: true } },
  });
}

async function main() {
  const apps = await api('GET', `/apps?filter[bundleId]=${encodeURIComponent(config.bundleId)}`);
  const app = apps.data[0];
  if (!app) throw new Error(`No app found with bundle ID ${config.bundleId}`);
  let gcId;
  try { gcId = (await api('GET', `/apps/${app.id}/gameCenterDetail`)).data?.id; } catch (e) { if (e.status !== 404) throw e; }
  if (!gcId) throw new Error('Game Center is not enabled for this app yet. Run "Set up App Store Connect" first.');
  console.log(`App ${app.attributes.name} (${app.id}), Game Center ${gcId}`);

  const existing = await getAll(`/gameCenterDetails/${gcId}/gameCenterAchievements?limit=200`);
  const byVendorId = new Map(existing.map(a => [a.attributes.vendorIdentifier, a]));

  let created = 0, skipped = 0;
  const report = [], statuses = [];
  for (const a of config.achievements) {
    let ach = byVendorId.get(a.id);
    if (!ach) {
      ach = (await api('POST', '/gameCenterAchievements', {
        data: {
          type: 'gameCenterAchievements',
          attributes: { referenceName: a.referenceName, vendorIdentifier: a.id, points: a.points, showBeforeEarned: true, repeatable: false },
          relationships: { gameCenterDetail: { data: { type: 'gameCenterDetails', id: gcId } } },
        },
      })).data;
      created++;
      console.log(`+ ${a.id}`);
    } else {
      skipped++;
      console.log(`= ${a.id} already exists`);
    }

    const locs = await getAll(`/gameCenterAchievements/${ach.id}/localizations?limit=50`);
    let loc = locs.find(l => l.attributes.locale === config.locale);
    if (!loc) {
      loc = (await api('POST', '/gameCenterAchievementLocalizations', {
        data: {
          type: 'gameCenterAchievementLocalizations',
          attributes: { locale: config.locale, name: a.title, beforeEarnedDescription: a.before, afterEarnedDescription: a.after },
          relationships: { gameCenterAchievement: { data: { type: 'gameCenterAchievements', id: ach.id } } },
        },
      })).data;
      console.log(`  + ${config.locale} text`);
    }

    let img = null;
    try { img = (await api('GET', `/gameCenterAchievementLocalizations/${loc.id}/gameCenterAchievementImage`)).data; } catch { img = null; }
    const state = img && img.attributes && img.attributes.assetDeliveryState && img.attributes.assetDeliveryState.state;
    if (!img || state === 'FAILED' || state === 'AWAITING_UPLOAD') {
      if (img) { try { await api('DELETE', `/gameCenterAchievementImages/${img.id}`) } catch (e) { console.log('  delete failed', e.message) } }
      await uploadImage(loc.id, a.image);
      console.log(`  + image ${a.image}`);
      report.push(`${a.id}: image re-uploaded (was ${state || 'missing'})`);
    } else {
      report.push(`${a.id}: text ${loc.attributes.name ? 'ok' : 'MISSING'}, image ${state}`);
    }
    const st = (await api('GET', `/gameCenterAchievements/${ach.id}`)).data.attributes;
    statuses.push(`${a.id}=${JSON.stringify({archived: st.archived})}`);
  }
  console.log(`Done. Created ${created}, already there ${skipped}.`);
  console.log(`::notice title=Achievement check::${report.join(' | ')}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
