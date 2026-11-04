/**
 * AudioWorklet: detecta golpes en el hilo de audio con marca de tiempo exacta.
 * Se carga como módulo; importa el detector compartido con las pruebas.
 */

import { OnsetDetector } from './detector.js';

class PadLabOnsetProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.detector = new OnsetDetector({
      sampleRate,
      threshold: 2.4,
      minGapMs: 38,
    });

    this.port.onmessage = (event) => {
      const message = event.data;
      if (message && message.type === 'config') {
        this.detector.configure(message);
      }
    };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      const hits = this.detector.process(channel, currentFrame / sampleRate);
      for (const hit of hits) {
        this.port.postMessage({
          type: 'onset',
          time: hit.time,
          strength: hit.strength,
        });
      }
    }
    return true;
  }
}

registerProcessor('padlab-onset', PadLabOnsetProcessor);
