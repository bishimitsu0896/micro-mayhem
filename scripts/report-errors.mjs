// Turns the error lines in an xcodebuild log into GitHub annotations,
// so failures can be read from the run summary without opening the log.
import fs from 'node:fs';
const log = fs.readFileSync(process.argv[2], 'utf8').split('\n');
const keep = log.filter(l => /error:|\berror\b.*:|failed|Provisioning|No profiles|No Accounts|not permitted|permission|Signing/i.test(l))
  .map(l => l.trim()).filter(Boolean);
const unique = [...new Set(keep)].slice(-25);
if (!unique.length) unique.push(...log.filter(Boolean).slice(-15));
for (const l of unique) console.log(`::error::${l.replace(/%/g, '%25').replace(/\r/g, '').slice(0, 900)}`);
