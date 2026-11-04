/**
 * Calibración del retardo total (salida + acústica + entrada + reacción).
 * El resultado se resta al instante de cada golpe detectado.
 */

import { clamp, median, stdDev, round } from './timing.js';

/**
 * @param {object} options
 * @param {number[]} options.hits instantes de golpes (segundos)
 * @param {number[]} options.clicks instantes de clicks (segundos)
 * @param {number} [options.windowMs] ventana máxima alrededor del click
 * @param {number} [options.minSamples]
 */
export function estimateLatency({
  hits,
  clicks,
  windowMs = 160,
  minSamples = 5,
}) {
  const usedClicks = new Set();
  const offsets = [];

  for (const hit of hits) {
    let best = null;
    clicks.forEach((click, index) => {
      if (usedClicks.has(index)) return;
      const deltaMs = (hit - click) * 1000;
      if (Math.abs(deltaMs) > windowMs) return;
      if (!best || Math.abs(deltaMs) < Math.abs(best.deltaMs)) {
        best = { index, deltaMs };
      }
    });
    if (best) {
      usedClicks.add(best.index);
      offsets.push(best.deltaMs);
    }
  }

  if (offsets.length < minSamples) {
    return {
      ok: false,
      reason: 'pocas-muestras',
      samples: offsets.length,
      offsets,
    };
  }

  const offsetMs = clamp(Math.round(median(offsets)), -100, 150);
  const spreadMs = stdDev(offsets);

  return {
    ok: true,
    offsetMs,
    spreadMs: spreadMs == null ? null : round(spreadMs),
    samples: offsets.length,
    offsets,
  };
}
