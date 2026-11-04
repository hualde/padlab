/**
 * Núcleo temporal: construcción de tomas, emparejamiento de golpes y métricas.
 * Sin dependencias del DOM para poder probarlo con `node --test`.
 */

export const PERFECT_MS = 20;
export const GOOD_MS = 40;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function stdDev(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function round(value, decimals = 0) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function formatSigned(value, unit = 'ms') {
  if (value == null || Number.isNaN(value)) return '—';
  const rounded = Math.round(value);
  if (rounded === 0) return `0 ${unit}`;
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} ${unit}`;
}

export function classifyError(errorMs) {
  const absolute = Math.abs(errorMs);
  if (absolute <= PERFECT_MS) return 'perfect';
  if (absolute <= GOOD_MS) return 'good';
  return 'off';
}

/**
 * Crea una toma con sus posiciones esperadas.
 * @param {object} options
 * @param {number} options.takeStart instante (reloj de audio) del primer golpe
 * @param {number} options.bpm
 * @param {number} options.density golpes por pulso
 * @param {string} options.pattern digitación de un compás
 * @param {number} [options.bars]
 * @param {number} [options.beatsPerBar]
 */
export function createTake({
  takeStart,
  bpm,
  density,
  pattern,
  bars = 4,
  beatsPerBar = 4,
}) {
  if (!(takeStart >= 0)) throw new Error('takeStart no válido.');
  if (!(bpm > 0)) throw new Error('BPM no válido.');
  if (!pattern || pattern.length === 0) throw new Error('El patrón está vacío.');

  const slotsPerBar = beatsPerBar * density;
  if (pattern.length % slotsPerBar !== 0) {
    throw new Error('La frase debe ocupar compases completos.');
  }

  const phraseBars = pattern.length / slotsPerBar;
  const stepDur = 60 / bpm / density;
  const slots = [];

  for (let bar = 0; bar < bars; bar += 1) {
    for (let inBar = 0; inBar < slotsPerBar; inBar += 1) {
      const index = bar * slotsPerBar + inBar;
      const patternIndex = index % pattern.length;
      slots.push({
        index,
        bar,
        inBar,
        phraseBar: Math.floor(index / slotsPerBar) % phraseBars,
        sticking: pattern[patternIndex],
        time: takeStart + index * stepDur,
        hit: null,
      });
    }
  }

  const duration = slots.length * stepDur;
  const windowMs = clamp(stepDur * 1000 * 0.45, 25, 120);

  return {
    takeStart,
    takeEnd: takeStart + duration,
    duration,
    stepDur,
    windowMs,
    bpm,
    density,
    bars,
    beatsPerBar,
    slotsPerBar,
    phraseBars,
    pattern,
    slots,
    hits: [],
  };
}

/**
 * Intenta asignar un golpe detectado al hueco esperado más cercano.
 * @param {ReturnType<typeof createTake>} take
 * @param {number} time instante del golpe en el reloj de audio
 */
export function registerHit(take, time) {
  const margin = take.windowMs / 1000;

  if (time < take.takeStart - margin || time > take.takeEnd + margin) {
    return { type: 'ignored' };
  }

  const guess = Math.round((time - take.takeStart) / take.stepDur);
  let best = null;

  for (let offset = -2; offset <= 2; offset += 1) {
    const index = guess + offset;
    if (index < 0 || index >= take.slots.length) continue;
    const slot = take.slots[index];
    if (slot.hit) continue;
    const errorMs = (time - slot.time) * 1000;
    if (Math.abs(errorMs) > take.windowMs) continue;
    if (!best || Math.abs(errorMs) < Math.abs(best.errorMs)) {
      best = { slot, errorMs };
    }
  }

  if (best) {
    const quality = classifyError(best.errorMs);
    const hit = {
      time,
      errorMs: best.errorMs,
      quality,
      slotIndex: best.slot.index,
    };
    best.slot.hit = hit;
    take.hits.push(hit);
    return {
      type: 'hit',
      hit,
      slot: best.slot,
      errorMs: best.errorMs,
      quality,
    };
  }

  const hit = { time, extra: true };
  take.hits.push(hit);
  return { type: 'extra', hit };
}

/**
 * Calcula las métricas de una toma.
 * @param {ReturnType<typeof createTake>} take
 * @param {number} [expectedCount] número de huecos que se evalúan (permite parar antes)
 */
export function summarizeTake(take, expectedCount = take.slots.length) {
  const count = clamp(Math.floor(expectedCount), 0, take.slots.length);
  const considered = take.slots.slice(0, count);
  const matched = considered.filter((slot) => slot.hit);
  const errors = matched.map((slot) => slot.hit.errorMs);
  const extras = take.hits.filter((hit) => hit.extra).length;

  const hitRate = considered.length ? matched.length / considered.length : 0;
  const perfectRate = considered.length
    ? errors.filter((error) => Math.abs(error) <= PERFECT_MS).length / considered.length
    : 0;
  const goodRate = considered.length
    ? errors.filter((error) => Math.abs(error) <= GOOD_MS).length / considered.length
    : 0;

  const biasMs = mean(errors);
  const sdMs = stdDev(errors);
  const meanAbsMs = mean(errors.map((error) => Math.abs(error)));
  const timingFactor = meanAbsMs == null ? 0 : clamp(1 - meanAbsMs / 100, 0, 1);
  const score = Math.round(100 * hitRate * (0.7 + 0.3 * timingFactor));

  return {
    expected: considered.length,
    matched: matched.length,
    missed: considered.length - matched.length,
    extras,
    hitRate,
    perfectRate,
    goodRate,
    biasMs,
    sdMs,
    meanAbsMs,
    score,
  };
}

export function scoreGrade(score) {
  if (score >= 90) return 'Excelente';
  if (score >= 75) return 'Muy bien';
  if (score >= 60) return 'Bien';
  if (score >= 40) return 'Sigue así';
  return 'Calentando';
}

/**
 * Mejor racha de golpes seguidos dentro de los huecos evaluados.
 * Un hueco sin golpe o con calidad "off" corta la racha.
 */
export function bestStreakForSlots(slots, count = slots.length) {
  let best = 0;
  let current = 0;
  const limit = Math.min(count, slots.length);
  for (let index = 0; index < limit; index += 1) {
    const hit = slots[index].hit;
    if (hit && hit.quality !== 'off') {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return best;
}
