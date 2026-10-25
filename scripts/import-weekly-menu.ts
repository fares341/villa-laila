import { readFileSync } from 'node:fs';
import { importMenu } from '../src/services/weekly-menu';

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('Usage: tsx scripts/import-weekly-menu.ts <file.json>'); process.exit(1); }
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const r = await importMenu(Array.isArray(json) ? json : json.days, 'script:import-weekly-menu');
  console.log(`Imported ${r.days} day(s).`);
  if (r.imageErrors.length) console.log('Photos that could not be downloaded:\n  ' + r.imageErrors.join('\n  '));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
