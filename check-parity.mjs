import { translationKeys } from './src/core/i18n.js';
const es = new Set(translationKeys('es'));
const en = new Set(translationKeys('en'));
console.log('es-only', [...es].filter(k=>!en.has(k)));
console.log('en-only', [...en].filter(k=>!es.has(k)));
console.log('counts', es.size, en.size);
