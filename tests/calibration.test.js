import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateLatency } from '../src/core/calibration.js';

function clicksAt(start, count, interval) {
  return Array.from({ length: count }, (_, index) => start + index * interval);
}

test('estima la mediana del retardo', () => {
  const clicks = clicksAt(0, 10, 0.6);
  const hits = clicks.slice(2).map((click, index) => click + 0.03 + (index % 3 === 0 ? 0.006 : 0));

  const result = estimateLatency({ hits, clicks: clicks.slice(2) });
  assert.equal(result.ok, true);
  assert.equal(result.samples, 8);
  assert.ok(result.offsetMs >= 30 && result.offsetMs <= 36);
  assert.ok(result.spreadMs != null && result.spreadMs < 5);
});

test('descarta golpes fuera de la ventana', () => {
  const clicks = clicksAt(0, 8, 0.6);
  const hits = [0.03, 0.63, 0.9, 1.23, 1.83];
  const result = estimateLatency({ hits, clicks, minSamples: 3 });
  assert.equal(result.ok, true);
  assert.equal(result.samples, 4);
});

test('no inventa resultados con pocas muestras', () => {
  const clicks = clicksAt(0, 8, 0.6);
  const result = estimateLatency({ hits: [0.02], clicks });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'pocas-muestras');
});
