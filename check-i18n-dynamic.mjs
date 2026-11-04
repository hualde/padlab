import { readFileSync } from 'node:fs';
import { setLocale, t } from './src/core/i18n.js';
const src = readFileSync('src/app.js','utf8');
const keys = [];
for (const m of src.matchAll(/\bt\('([^']+)'/g)) keys.push(m[1]);
for (const m of src.matchAll(/\btn\('([^']+)'/g)) { keys.push(m[1]+'.one', m[1]+'.many'); }
for (const k of ['density.2','density.3','density.4','density.2.short','density.3.short','density.4.short']) keys.push(k);
const unique=[...new Set(keys)];
for (const loc of ['es','en']) {
  setLocale(loc);
  const missing = unique.filter(k=>t(k)===k);
  console.log(loc, 'keys', unique.length, 'missing', missing);
}
