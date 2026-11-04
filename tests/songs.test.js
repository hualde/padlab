import test from 'node:test';
import assert from 'node:assert/strict';
import { SONGS, noteToMidi, parseNotes, songLabels, songPattern } from '../src/core/songs.js';
import { getExercise } from '../src/core/exercises.js';
import { bestStreakForSlots, createTake, registerHit, summarizeTake } from '../src/core/timing.js';

test('convierte nombres de nota en MIDI', () => {
  assert.equal(noteToMidi('A4'), 69);
  assert.equal(noteToMidi('C4'), 60);
  assert.equal(noteToMidi('G3'), 55);
  assert.equal(noteToMidi('F#4'), 66);
  assert.equal(noteToMidi('H4'), null);
});

test('parseNotes calcula inicios y rechaza notación inválida', () => {
  const events = parseNotes('C4:2 -:2 E4:4');
  assert.deepEqual(events.map((e) => [e.start, e.dur, e.midi]), [[0, 2, 60], [2, 2, null], [4, 4, 64]]);
  assert.throws(() => parseNotes('C4:0'));
  assert.throws(() => parseNotes('X9:2'));
});

test('todas las canciones ocupan compases completos y son localizables', () => {
  assert.ok(SONGS.length >= 6);
  for (const song of SONGS) {
    assert.ok(Number.isInteger(song.bars) && song.bars >= 4, song.id);
    assert.equal(songPattern(song).length, song.bars * 8, song.id);
    assert.equal(songLabels(song).length, song.bars * 8, song.id);
    assert.equal(getExercise(song.id), song);
  }
});

test('la digitación alterna las manos por nota y deja huecos en las notas largas', () => {
  const buns = SONGS.find((song) => song.id === 'song-buns');
  assert.equal(songPattern(buns).slice(0, 8), 'R-L-R---');
  assert.equal(songLabels(buns).slice(0, 8).join(' ').trim().replace(/\s+/g, ' '), 'E D C');
});

test('los silencios no son huecos esperados ni cortan la racha', () => {
  const take = createTake({ takeStart: 10, bpm: 120, density: 2, pattern: 'R-L-R---', bars: 1 });
  assert.equal(take.slots.filter((slot) => slot.rest).length, 5);

  // Un golpe sobre un hueco de silencio cuenta como extra.
  const stray = registerHit(take, take.slots[1].time);
  assert.equal(stray.type, 'extra');

  for (const index of [0, 2, 4]) registerHit(take, take.slots[index].time + 0.005);
  const summary = summarizeTake(take);
  assert.equal(summary.expected, 3);
  assert.equal(summary.matched, 3);
  assert.equal(summary.hitRate, 1);
  assert.equal(bestStreakForSlots(take.slots), 3);
});
