import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DENSITIES,
  EXERCISES,
  buildPattern,
  buildPhrase,
  getExercise,
} from '../src/core/exercises.js';
import { createTake } from '../src/core/timing.js';

test('incluye los rudimentos clásicos detectables', () => {
  assert.equal(EXERCISES.length, 8);
  assert.deepEqual(
    EXERCISES.map((exercise) => exercise.id),
    [
      'single',
      'double',
      'paradiddle',
      'inverted',
      'reverse',
      'double-paradiddle',
      'paradiddle-diddle',
      'triple-paradiddle',
    ],
  );
  assert.deepEqual(getExercise('double-paradiddle').densities, [3]);
  assert.deepEqual(getExercise('triple-paradiddle').densities, [4]);
});

test('cada rudimento encaja en sus densidades permitidas', () => {
  for (const exercise of EXERCISES) {
    for (const density of exercise.densities) {
      const bar = buildPattern(exercise.base, density);
      assert.equal(bar.length, 4 * density, `${exercise.id} a densidad ${density}`);

      const phrase = buildPhrase(exercise.base, density, { phraseBars: 2 });
      assert.equal(phrase.length, 8 * density);

      const take = createTake({
        takeStart: 0,
        bpm: exercise.defaultBpm,
        density,
        pattern: phrase,
        bars: 4,
      });
      assert.equal(take.slotsPerBar, 4 * density);
      assert.equal(take.phraseBars, 2);
      assert.equal(take.slots.length, 16 * density);
    }
  }
});

test('los tresillos producen 12 golpes por compás', () => {
  assert.equal(DENSITIES.length, 3);
  assert.equal(DENSITIES.find((density) => density.value === 3).label, 'Tresillos');

  const phrase = buildPattern('RLRLRRLRLRLL', 3);
  assert.equal(phrase, 'RLRLRRLRLRLL');

  const take = createTake({
    takeStart: 0,
    bpm: 70,
    density: 3,
    pattern: phrase,
    bars: 2,
  });
  assert.equal(take.slots.length, 24);
  assert.equal(take.slots[0].sticking, 'R');
  assert.equal(take.slots[6].sticking, 'L');
  assert.equal(take.slots[11].sticking, 'L');
  assert.equal(take.slots[12].inBar, 0);
  assert.equal(take.slots[12].bar, 1);
});
