/**
 * Motor de audio: contexto, micrófono, detección de golpes y clicks del metrónomo.
 *
 * El detector corre preferentemente en un AudioWorklet (marca de tiempo exacta
 * en el reloj de audio). Si el navegador no puede cargarlo, se usa
 * ScriptProcessorNode como red de seguridad.
 */

import { OnsetDetector } from './detector.js';

const MIN_GAP_MS = 38;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.detectorNode = null;
    this.scriptNode = null;
    this.scriptDetector = null;
    this.silentSink = null;
    this.clickBus = null;
    this.micActive = false;
    this.volume = 0.7;
    this.sensitivity = 55;
    this.workletState = 'idle';
    this.transport = '—';
    this.levelBuffer = null;
    this.onsetHandlers = new Set();
    this.workletUrl = new URL('./onset-worklet.js', import.meta.url);
  }

  async ensure() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('Este navegador no soporta Web Audio.');
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.clickBus = this.ctx.createGain();
      this.clickBus.gain.value = this.volume;
      this.clickBus.connect(this.ctx.destination);
      this.silentSink = this.ctx.createGain();
      this.silentSink.gain.value = 0;
      this.silentSink.connect(this.ctx.destination);
    }

    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* el navegador decidirá; seguimos para mostrar el error real */
      }
    }
    return this.ctx;
  }

  onOnset(handler) {
    this.onsetHandlers.add(handler);
    return () => this.onsetHandlers.delete(handler);
  }

  emitOnset(hit) {
    for (const handler of this.onsetHandlers) handler(hit);
  }

  thresholdForSensitivity(sensitivity = this.sensitivity) {
    const normalized = Math.min(100, Math.max(0, sensitivity)) / 100;
    return 3.8 - normalized * 2.4;
  }

  absFloorForSensitivity(sensitivity = this.sensitivity) {
    const normalized = Math.min(100, Math.max(0, sensitivity)) / 100;
    return 0.01 - normalized * 0.0075;
  }

  setSensitivity(sensitivity) {
    this.sensitivity = sensitivity;
    const config = {
      type: 'config',
      threshold: this.thresholdForSensitivity(),
      absFloor: this.absFloorForSensitivity(),
      minGapMs: MIN_GAP_MS,
    };
    if (this.detectorNode) this.detectorNode.port.postMessage(config);
    if (this.scriptDetector) this.scriptDetector.configure(config);
  }

  setVolume(volume) {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.clickBus && this.ctx) {
      this.clickBus.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01);
    }
  }

  async enableMic(deviceId = null) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Este navegador no permite acceder al micrófono.');
    }

    await this.ensure();
    this.disableMic();

    const baseAudio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    };
    const constraints = {
      video: false,
      audio: deviceId ? { ...baseAudio, deviceId: { exact: deviceId } } : baseAudio,
    };

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      if (deviceId && (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')) {
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: baseAudio });
      } else {
        throw error;
      }
    }

    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.15;
    this.source.connect(this.analyser);
    this.levelBuffer = new Float32Array(this.analyser.fftSize);

    try {
      await this.attachDetector();
    } catch (error) {
      this.disableMic();
      throw error;
    }

    this.micActive = true;
    return stream;
  }

  async attachDetector() {
    await this.ensureWorklet();

    if (this.workletState === 'ready') {
      try {
        const node = new AudioWorkletNode(this.ctx, 'padlab-onset', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
          channelCountMode: 'explicit',
        });
        node.port.onmessage = (event) => {
          const message = event.data;
          if (message && message.type === 'onset') {
            this.emitOnset({
              time: message.time,
              strength: message.strength,
              source: 'worklet',
            });
          }
        };
        node.port.postMessage({
          type: 'config',
          threshold: this.thresholdForSensitivity(),
          absFloor: this.absFloorForSensitivity(),
          minGapMs: MIN_GAP_MS,
        });
        this.source.connect(node);
        node.connect(this.silentSink);
        this.detectorNode = node;
        this.transport = 'AudioWorklet';
        return;
      } catch (error) {
        console.warn('[PadLab] No se pudo crear el AudioWorkletNode; usando ScriptProcessor.', error);
        this.workletState = 'failed';
      }
    }

    const node = this.ctx.createScriptProcessor(256, 1, 1);
    const detector = new OnsetDetector({
      sampleRate: this.ctx.sampleRate,
      threshold: this.thresholdForSensitivity(),
      absFloor: this.absFloorForSensitivity(),
      minGapMs: MIN_GAP_MS,
    });
    node.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const start = Number.isFinite(event.playbackTime)
        ? event.playbackTime
        : this.ctx.currentTime;
      const hits = detector.process(input, start);
      for (const hit of hits) {
        this.emitOnset({ time: hit.time, strength: hit.strength, source: 'script' });
      }
    };
    this.source.connect(node);
    node.connect(this.silentSink);
    this.scriptNode = node;
    this.scriptDetector = detector;
    this.transport = 'ScriptProcessor';
  }

  async ensureWorklet() {
    if (this.workletState !== 'idle') return;
    try {
      if (!this.ctx.audioWorklet) throw new Error('AudioWorklet no disponible');
      await this.ctx.audioWorklet.addModule(this.workletUrl);
      this.workletState = 'ready';
    } catch (error) {
      console.warn('[PadLab] AudioWorklet no disponible; usando ScriptProcessor.', error);
      this.workletState = 'failed';
    }
  }

  disableMic() {
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* noop */
      }
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        /* noop */
      }
    }
    if (this.detectorNode) {
      this.detectorNode.port.onmessage = null;
      try {
        this.detectorNode.disconnect();
      } catch {
        /* noop */
      }
    }
    if (this.scriptNode) {
      this.scriptNode.onaudioprocess = null;
      try {
        this.scriptNode.disconnect();
      } catch {
        /* noop */
      }
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
    }

    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.detectorNode = null;
    this.scriptNode = null;
    this.scriptDetector = null;
    this.levelBuffer = null;
    this.micActive = false;
    this.transport = '—';
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  playClick(time, level = 1) {
    if (!this.ctx) return null;
    const start = Math.max(time, this.ctx.currentTime + 0.003);
    const oscillator = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(level >= 0.9 ? 2200 : level >= 0.55 ? 1700 : 1400, start);
    const peak = Math.max(0.0002, 0.2 * this.volume * (0.35 + level * 0.65));
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
    oscillator.connect(gain).connect(this.clickBus);
    oscillator.start(start);
    oscillator.stop(start + 0.06);
    return { oscillator, gain };
  }

  cancelClicks(nodes) {
    if (!this.ctx || !nodes) return;
    const now = this.ctx.currentTime;
    for (const node of nodes) {
      if (!node) continue;
      try {
        node.oscillator.stop(now);
      } catch {
        /* ya terminó */
      }
      try {
        node.gain.gain.cancelScheduledValues(now);
        node.gain.gain.setValueAtTime(0.0001, now);
        node.gain.disconnect();
      } catch {
        /* noop */
      }
    }
    nodes.length = 0;
  }

  /** Nivel de entrada 0..1 (pico suavizado). */
  readLevel() {
    if (!this.analyser || !this.levelBuffer) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuffer);
    let peak = 0;
    for (let i = 0; i < this.levelBuffer.length; i += 1) {
      const value = Math.abs(this.levelBuffer[i]);
      if (value > peak) peak = value;
    }
    return Math.min(1, Math.sqrt(peak * 3));
  }

  diagnostics() {
    return {
      sampleRate: this.ctx ? this.ctx.sampleRate : null,
      transport: this.transport,
      state: this.ctx ? this.ctx.state : 'sin contexto',
      baseLatency: this.ctx && Number.isFinite(this.ctx.baseLatency)
        ? Math.round(this.ctx.baseLatency * 1000)
        : null,
    };
  }
}
