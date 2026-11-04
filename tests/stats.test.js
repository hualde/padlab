import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStreak, localDayKey, buildProgress } from '../src/core/stats.js';

test('calcula rachas de días consecutivos', () => {
  const now = new Date(2026, 10, 4, 12, 0, 0);
  const dates = [
    new Date(2026, 10, 4, 9).toISOString(),
    new Date(2026, 10, 3, 9).toISOString(),
    new Date(2026, 10, 2, 9).toISOString(),
    new Date(2026, 9, 30, 9).toISOString(),
  ];
  assert.equal(computeStreak(dates, now), 3);
});

test('si hoy no hay sesión, la racha sigue viva desde ayer', () => {
  const now = new Date(2026, 10, 4, 12, 0, 0);
  const dates = [
    new Date(2026, 10, 3, 9).toISOString(),
    new Date(2026, 10, 2, 9).toISOString(),
  ];
  assert.equal(computeStreak(dates, now), 2);
});

test('sin sesiones no hay racha', () => {
  assert.equal(computeStreak([], new Date()), 0);
});

test('agrupa el progreso', () => {
  const now = new Date(2026, 10, 4, 12);
  const sessions = [
    {
      date: new Date(2026, 10, 4, 10).toISOString(),
      exerciseId: 'single',
      exerciseName: 'Golpes simples',
      score: 90,
      matched: 30,
      durationSec: 60,
    },
    {
      date: new Date(2026, 10, 4, 11).toISOString(),
      exerciseId: 'single',
      exerciseName: 'Golpes simples',
      score: 80,
      matched: 20,
      durationSec: 60,
    },
    {
      date: new Date(2026, 10, 3, 11).toISOString(),
      exerciseId: 'double',
      exerciseName: 'Doble golpe',
      score: 70,
      matched: 10,
      durationSec: 30,
    },
  ];

  const result = buildProgress(sessions, now);
  assert.equal(result.totalSessions, 3);
  assert.equal(result.totalMinutes, 2.5);
  assert.equal(result.totalHits, 60);
  assert.equal(result.streak, 2);
  assert.equal(result.avgScore, 80);
  assert.equal(result.perExercise.length, 2);
  assert.equal(result.chart.length, 3);
  assert.equal(result.chart[2].score, 80, 'el gráfico va de antiguo a reciente');
});

test('localDayKey usa la fecha local', () => {
  const local = new Date(2026, 0, 5, 23, 30);
  assert.equal(localDayKey(local), '2026-01-05');
});
