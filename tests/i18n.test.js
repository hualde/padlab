import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCALES,
  getLocale,
  setLocale,
  t,
  tn,
  translationKeys,
} from '../src/core/i18n.js';
import { EXERCISES } from '../src/core/exercises.js';

test('español e inglés tienen el mismo conjunto de claves', () => {
  const es = new Set(translationKeys('es'));
  const en = new Set(translationKeys('en'));
  assert.deepEqual([...es].filter((key) => !en.has(key)), []);
  assert.deepEqual([...en].filter((key) => !es.has(key)), []);
  const fr = new Set(translationKeys('fr'));
  assert.deepEqual([...es].filter((key) => !fr.has(key)), []);
  assert.deepEqual([...fr].filter((key) => !es.has(key)), []);
  assert.deepEqual(LOCALES.map((locale) => locale.id), ['es', 'en', 'fr']);
});

test('traduce, interpola y pluraliza', () => {
  setLocale('en');
  assert.equal(t('tabs.train'), 'Practice');
  assert.equal(t('train.hint.take', { bars: 8, bpm: 100 }), '4-click count-in · 8 bars · 100 BPM');
  assert.equal(tn('train.takeBadge', 1), '1 bar');
  assert.equal(tn('train.takeBadge', 8), '8 bars');
  assert.equal(tn('train.hits', 0), '0 hits');
  assert.equal(getLocale(), 'en');

  setLocale('es');
  assert.equal(t('tabs.train'), 'Entrenar');
  assert.equal(tn('train.hits', 1), '1 golpe');
  assert.equal(tn('train.hits', 3), '3 golpes');
});

test('los rudimentos tienen nombre y descripción en ambos idiomas', () => {
  for (const locale of ['es', 'en', 'fr']) {
    setLocale(locale);
    for (const exercise of EXERCISES) {
      assert.ok(t(exercise.nameKey) !== exercise.nameKey, `${locale} ${exercise.nameKey}`);
      assert.ok(t(exercise.descriptionKey) !== exercise.descriptionKey, `${locale} ${exercise.descriptionKey}`);
      assert.ok(t(exercise.tipKey) !== exercise.tipKey, `${locale} ${exercise.tipKey}`);
    }
    setLocale('es');
  }
  assert.ok(t('app.title').startsWith('PadLab'));
});

test('francés: traduce y pluraliza (0 y 1 en singular)', () => {
  setLocale('fr');
  assert.equal(t('tabs.calibrate'), 'Calibrer');
  assert.equal(tn('train.hits', 0), '0 coup');
  assert.equal(tn('train.hits', 1), '1 coup');
  assert.equal(tn('train.hits', 5), '5 coups');
  setLocale('es');
});
