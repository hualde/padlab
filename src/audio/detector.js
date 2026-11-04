/**
 * Detector de golpes por envolvente y flanco de subida.
 *
 * - Filtro paso alto para quitar ruido grave y DC.
 * - Envolvente con ataque instantáneo y caída exponencial (~28 ms).
 * - Umbral adaptativo: suelo de ruido × multiplicador, con mínimo absoluto.
 * - Disparo por flanco positivo: un golpe que decae no vuelve a disparar,
 *   pero un segundo golpe durante la cola sí (redobles rápidos).
 *
 * Es una clase pura (sin Web Audio) para poder probarla en Node.
 */

import { clamp } from '../core/timing.js';

export class OnsetDetector {
  constructor({
    sampleRate,
    threshold = 2.4,
    minGapMs = 38,
    absFloor = 0.005,
    envDecayMs = 28,
    hpCutoffHz = 120,
  }) {
    if (!(sampleRate > 0)) throw new Error('sampleRate no válido.');
    this.sampleRate = sampleRate;
    this.threshold = threshold;
    this.minGapMs = minGapMs;
    this.absFloor = absFloor;
    this.envDecay = Math.exp(-1 / ((envDecayMs / 1000) * sampleRate));
    this.hpAlpha = 1 - Math.exp((-2 * Math.PI * hpCutoffHz) / sampleRate);
    this.reset();
  }

  configure({ threshold, minGapMs, absFloor }) {
    if (Number.isFinite(threshold)) this.threshold = clamp(threshold, 1.05, 8);
    if (Number.isFinite(minGapMs)) this.minGapMs = clamp(minGapMs, 15, 150);
    if (Number.isFinite(absFloor)) this.absFloor = clamp(absFloor, 0.0005, 0.2);
  }

  reset() {
    this.lp = 0;
    this.env = 0;
    this.prevEnv = 0;
    this.floor = 0.0005;
    this.lastHitTime = -Infinity;
  }

  /**
   * Procesa un bloque de muestras.
   * @param {Float32Array} samples
   * @param {number} startTime instante del primer sample en el reloj de audio
   * @returns {{time:number, strength:number}[]}
   */
  process(samples, startTime = 0) {
    const hits = [];
    const rate = this.sampleRate;
    const minGap = this.minGapMs / 1000;

    for (let i = 0; i < samples.length; i += 1) {
      const x = samples[i];
      this.lp += (x - this.lp) * this.hpAlpha;
      const highPassed = Math.abs(x - this.lp);

      this.env = highPassed > this.env * this.envDecay
        ? highPassed
        : this.env * this.envDecay;

      if (this.env < this.floor) {
        this.floor += (this.env - this.floor) * 0.05;
      } else {
        this.floor += (this.env - this.floor) * 0.00008;
      }
      if (this.floor < 0.0005) this.floor = 0.0005;

      const threshold = Math.max(this.absFloor, this.floor * this.threshold);
      const time = startTime + i / rate;
      const rising = this.env - this.prevEnv;
      const riseFloor = Math.max(threshold * 0.12, 0.0008);

      if (
        this.env > threshold &&
        rising > riseFloor &&
        time - this.lastHitTime >= minGap
      ) {
        hits.push({
          time,
          strength: clamp(this.env / Math.max(threshold, 1e-6), 1, 40),
        });
        this.lastHitTime = time;
      }

      this.prevEnv = this.env;
    }

    return hits;
  }
}
