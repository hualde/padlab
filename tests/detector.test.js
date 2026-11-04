import test from 'node:test';
import assert from 'node:assert/strict';
import { OnsetDetector } from '../src/audio/detector.js';

const SR = 48000;

function seededNoise(seed = 7) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 4294967296) * 2 - 1;
  };
}

function buildSignal(events, { duration = 2.2, noiseLevel = 0.0008 } = {}) {
  const noise = seededNoise();
  const data = new Float32Array(Math.round(duration * SR));
  for (let i = 0; i < data.length; i += 1) {
    data[i] = noiseLevel * noise();
  }

  for (const event of events) {
    const start = Math.round(event.at * SR);
    const length = Math.round(0.12 * SR);
    for (let j = 0; j < length && start + j < data.length; j += 1) {
      const t = j / SR;
      const decay = Math.exp(-t / 0.012);
      data[start + j] += event.amp * decay * (0.65 * noise() + 0.5 * Math.sin(2 * Math.PI * 220 * t));
    }
  }
  return data;
}

function detect(samples, options = {}) {
  const detector = new OnsetDetector({
    sampleRate: SR,
    threshold: 2.4,
    minGapMs: 38,
    absFloor: 0.005,
    ...options,
  });
  const hits = [];
  const block = 128;
  for (let i = 0; i < samples.length; i += block) {
    hits.push(...detector.process(samples.subarray(i, i + block), i / SR));
  }
  return hits;
}

test('detecta golpes separados con precisión de milisegundos', () => {
  const events = [
    { at: 0.25, amp: 0.4 },
    { at: 0.6, amp: 0.25 },
    { at: 0.95, amp: 0.6 },
    { at: 1.3, amp: 0.18 },
  ];
  const hits = detect(buildSignal(events));

  assert.equal(hits.length, events.length);
  hits.forEach((hit, index) => {
    assert.ok(
      Math.abs(hit.time - events[index].at) < 0.01,
      `golpe ${index}: ${hit.time.toFixed(4)} vs ${events[index].at}`,
    );
  });
});

test('detecta dos golpes rápidos durante la cola del primero', () => {
  const events = [
    { at: 0.4, amp: 0.45 },
    { at: 0.46, amp: 0.3 },
  ];
  const hits = detect(buildSignal(events));
  assert.equal(hits.length, 2);
  assert.ok(Math.abs(hits[1].time - 0.46) < 0.01);
});

test('no dispara con silencio ni con ruido suave', () => {
  const silence = new Float32Array(SR);
  assert.equal(detect(silence).length, 0);

  const noise = seededNoise(3);
  const room = new Float32Array(SR);
  for (let i = 0; i < room.length; i += 1) room[i] = noise() * 0.001;
  assert.equal(detect(room).length, 0);
});

test('respeta el periodo refractario', () => {
  const events = [
    { at: 0.4, amp: 0.4 },
    { at: 0.42, amp: 0.4 },
  ];
  const hits = detect(buildSignal(events), { minGapMs: 50 });
  assert.equal(hits.length, 1);
});

test('un golpe fuerte seguido de su cola no se duplica', () => {
  const events = [{ at: 0.3, amp: 0.9 }];
  const hits = detect(buildSignal(events, { duration: 1.2 }));
  assert.equal(hits.length, 1);
});
