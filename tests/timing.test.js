import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bestStreakForSlots,
  createTake,
  registerHit,
  summarizeTake,
  classifyError,
  formatSigned,
  mean,
  median,
  stdDev,
} from '../src/core/timing.js';
import { buildPattern, buildPhrase, mirrorSticking } from '../src/core/exercises.js';

test('construye patrones que llenan el compás', () => {
  assert.equal(buildPattern('RL', 2), 'RLRLRLRL');
  assert.equal(buildPattern('RL', 4), 'RLRLRLRLRLRLRLRL');
  assert.equal(buildPattern('RRLL', 2), 'RRLLRRLL');
  assert.equal(buildPattern('RLRRLRLL', 4), 'RLRRLRLLRLRRLRLL');
});

test('construye frases de dos compases alternando la mano', () => {
  const phrase = buildPhrase('RLRRLRLL', 2, { phraseBars: 2 });
  assert.equal(phrase, 'RLRRLRLLLRLLRLRR');
  assert.equal(phrase.length, 16);
  assert.equal(mirrorSticking('RLRRLRLL'), 'LRLLRLRR');
  assert.equal(buildPhrase('RL', 2, { phraseBars: 2 }), 'RLRLRLRLLRLRLRLR');
  assert.equal(buildPhrase('RL', 2, { phraseBars: 2, alternate: false }), 'RLRLRLRLRLRLRLRL');
});

test('crea tomas con frases de varios compases', () => {
  const phrase = buildPhrase('RL', 2, { phraseBars: 2 });
  const take = createTake({
    takeStart: 0,
    bpm: 120,
    density: 2,
    pattern: phrase,
    bars: 3,
  });

  assert.equal(take.slotsPerBar, 8);
  assert.equal(take.phraseBars, 2);
  assert.equal(take.slots.length, 24);
  assert.equal(take.slots[0].sticking, 'R');
  assert.equal(take.slots[7].sticking, 'L');
  assert.equal(take.slots[8].sticking, 'L');
  assert.equal(take.slots[15].sticking, 'R');
  assert.equal(take.slots[16].sticking, 'R');
  assert.equal(take.slots[16].inBar, 0);
  assert.equal(take.slots[16].bar, 2);
});

test('crea huecos equiespaciados', () => {
  const take = createTake({
    takeStart: 10,
    bpm: 120,
    density: 2,
    pattern: 'RLRLRLRL',
    bars: 2,
  });
  assert.equal(take.slots.length, 16);
  assert.equal(take.stepDur, 0.25);
  assert.equal(take.slots[0].time, 10);
  assert.equal(take.slots[1].time, 10.25);
  assert.equal(take.slots[8].time, 12);
  assert.ok(Math.abs(take.windowMs - 112.5) < 1e-9);
});

test('clasifica la desviación', () => {
  assert.equal(classifyError(0), 'perfect');
  assert.equal(classifyError(-20), 'perfect');
  assert.equal(classifyError(21), 'good');
  assert.equal(classifyError(-40), 'good');
  assert.equal(classifyError(41), 'off');
});

test('empareja golpes y detecta extras', () => {
  const take = createTake({
    takeStart: 0,
    bpm: 120,
    density: 2,
    pattern: 'RLRLRLRL',
    bars: 1,
  });

  const first = registerHit(take, 0.01);
  assert.equal(first.type, 'hit');
  assert.equal(first.slot.index, 0);
  assert.equal(first.quality, 'perfect');
  assert.ok(Math.abs(first.errorMs - 10) < 1e-6);

  const extra = registerHit(take, 0.13);
  assert.equal(extra.type, 'extra', 'un golpe a mitad de camino no pertenece a ningún hueco');

  const second = registerHit(take, 0.26);
  assert.equal(second.type, 'hit');
  assert.equal(second.slot.index, 1);
  assert.equal(second.quality, 'perfect');

  const reused = registerHit(take, 0.27);
  assert.equal(reused.type, 'extra', 'un hueco ya ocupado no se reutiliza');
});

test('resume precisión, desviación y consistencia', () => {
  const take = createTake({
    takeStart: 0,
    bpm: 120,
    density: 2,
    pattern: 'RLRLRLRL',
    bars: 1,
  });

  registerHit(take, 0.0);
  registerHit(take, 0.26);
  registerHit(take, 0.5);
  registerHit(take, 0.76);
  registerHit(take, 1.01);

  const summary = summarizeTake(take);
  assert.equal(summary.expected, 8);
  assert.equal(summary.matched, 5);
  assert.equal(summary.missed, 3);
  assert.equal(summary.hitRate, 5 / 8);
  assert.ok(summary.perfectRate > 0.4);
  assert.ok(summary.biasMs > 0);
  assert.ok(summary.sdMs >= 0);
  assert.ok(summary.score > 0 && summary.score < 100);
});

test('permite evaluar una toma parcial', () => {
  const take = createTake({
    takeStart: 0,
    bpm: 120,
    density: 2,
    pattern: 'RLRLRLRL',
    bars: 1,
  });
  registerHit(take, 0.0);
  const summary = summarizeTake(take, 2);
  assert.equal(summary.expected, 2);
  assert.equal(summary.missed, 1);
});

test('calcula la mejor racha dentro de los huecos evaluados', () => {
  const take = createTake({
    takeStart: 0,
    bpm: 120,
    density: 2,
    pattern: 'RLRLRLRL',
    bars: 1,
  });
  take.slots[0].hit = { quality: 'perfect' };
  take.slots[1].hit = { quality: 'good' };
  take.slots[2].hit = { quality: 'off' };
  take.slots[3].hit = { quality: 'perfect' };
  take.slots[4].hit = { quality: 'perfect' };

  assert.equal(bestStreakForSlots(take.slots), 2);
  assert.equal(bestStreakForSlots(take.slots, 2), 2);
  assert.equal(bestStreakForSlots(take.slots, 3), 2);
});

test('utilidades numéricas', () => {
  assert.equal(mean([2, 4, 6]), 4);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.ok(Math.abs(stdDev([2, 4, 4, 4, 5, 5, 7, 9]) - 2) < 1e-9);
  assert.equal(formatSigned(12.4), '+12 ms');
  assert.equal(formatSigned(-8), '−8 ms');
  assert.equal(formatSigned(null), '—');
});
