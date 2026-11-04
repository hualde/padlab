/**
 * Guía visual de golpes: línea temporal que avanza hacia un cabezal fijo.
 *
 * - Cada nota muestra la mano (R o L) y su color.
 * - El cabezal marca el golpe que toca ahora.
 * - En modo toma, las notas y la entrada de 4 clicks se mueven con el reloj
 *   de audio; en reposo se muestra el patrón completo del compás.
 */

import { clamp } from '../core/timing.js';

const HANDS = {
  R: { rgb: '255, 180, 84', hex: '#ffb454' },
  L: { rgb: '125, 211, 252', hex: '#7dd3fc' },
};

const MONO = 'ui-monospace, "Cascadia Code", SFMono-Regular, Menlo, Consolas, monospace';

export class StrokeLane {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.mode = 'preview';
    this.pattern = 'RL';
    this.density = 2;
    this.previewSlots = [];
    this.take = null;
    this.lastNow = null;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement || canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.width = rect.width;
    this.height = rect.height;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw(this.lastNow);
  }

  setPreview(pattern, density, slotsPerBar = density * 4, labels = null) {
    this.mode = 'preview';
    this.take = null;
    this.pattern = pattern;
    this.density = density;
    const previewLength = Math.min(pattern.length, Math.max(1, slotsPerBar));
    this.previewSlots = pattern.slice(0, previewLength).split('').map((sticking, index) => ({
      index,
      inBar: index,
      sticking,
      rest: sticking === '-',
      label: labels?.[index] || '',
      bar: 0,
      hit: null,
    }));
    this.lastNow = null;
    this.draw();
  }

  setTake(take) {
    this.mode = 'take';
    this.take = take;
    this.pattern = take.pattern;
    this.density = take.density;
    this.draw(take.takeStart);
  }

  clear() {
    this.mode = 'preview';
    this.take = null;
    this.draw();
  }

  draw(now = this.lastNow) {
    if (now != null) this.lastNow = now;
    const ctx = this.ctx;
    if (!ctx || !this.width || !this.height) return;

    const { width, height } = this;
    ctx.clearRect(0, 0, width, height);

    if (this.mode === 'take' && this.take) {
      this.drawTake(ctx, width, height, now ?? this.take.takeStart);
    } else {
      this.drawPreview(ctx, width, height);
    }
  }

  drawPreview(ctx, width, height) {
    const notes = this.previewSlots;
    if (!notes.length) return;

    const startX = 24;
    const step = clamp((width - startX * 2) / Math.max(1, notes.length - 1), 14, 40);
    const playheadX = startX - 7;
    const y = height * 0.52;

    this.drawGrid(ctx, width, height, (index) => startX + index * step, notes, this.density, true);
    const firstIndex = Math.max(0, notes.findIndex((note) => !note.rest));
    this.drawPlayhead(ctx, playheadX, height, HANDS[notes[firstIndex].sticking]?.hex || HANDS.R.hex, 0.45);

    notes.forEach((note, index) => {
      const x = startX + index * step;
      if (note.rest) return;
      this.drawNote(ctx, x, y, note, {
        step,
        next: index === firstIndex,
        past: false,
        alpha: index === 0 ? 1 : 0.82,
      });
    });
  }

  drawTake(ctx, width, height, now) {
    const take = this.take;
    const notes = take.slots;
    const step = clamp(width / 10, 26, 40);
    const playheadX = step * 3;
    const y = height * 0.52;
    const f = (now - take.takeStart) / take.stepDur;

    const minIndex = Math.max(0, Math.floor(f - playheadX / step) - 1);
    const maxIndex = Math.min(notes.length - 1, Math.ceil(f + (width - playheadX) / step) + 1);
    let nextIndex = clamp(Math.ceil(f - 0.5), 0, notes.length - 1);
    while (nextIndex < notes.length - 1 && notes[nextIndex].rest) nextIndex += 1;
    const nextHand = notes[nextIndex]?.sticking || 'R';

    const xAt = (index) => playheadX + (index - f) * step;

    this.drawGrid(ctx, width, height, xAt, notes, take.density, false);
    this.drawPlayhead(ctx, playheadX, height, HANDS[nextHand]?.hex || HANDS.R.hex, 0.85);
    this.drawCountIn(ctx, take, f, step, playheadX, height, width);

    for (let index = minIndex; index <= maxIndex; index += 1) {
      const note = notes[index];
      if (note.rest) continue;
      const x = xAt(index);
      if (x < -step || x > width + step) continue;
      this.drawNote(ctx, x, y, note, {
        step,
        next: index === nextIndex,
        past: index < f - 0.5,
        alpha: index < f - 0.5 ? 0.32 : 1,
      });
    }
  }

  drawGrid(ctx, width, height, xAt, notes, density, preview) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = `600 7.5px ${MONO}`;

    for (let index = 0; index < notes.length; index += 1) {
      const note = notes[index];
      if (note.inBar % density !== 0) continue;
      const x = xAt(index);
      if (x < 0 || x > width) continue;
      const barStart = note.inBar === 0;
      ctx.beginPath();
      ctx.strokeStyle = barStart ? 'rgba(255, 180, 84, 0.22)' : 'rgba(255, 255, 255, 0.055)';
      ctx.lineWidth = barStart ? 1.4 : 1;
      ctx.moveTo(x, 12);
      ctx.lineTo(x, height - 8);
      ctx.stroke();

      const beat = Math.floor(note.inBar / density) + 1;
      ctx.fillStyle = barStart ? 'rgba(255, 180, 84, 0.6)' : 'rgba(152, 162, 178, 0.4)';
      ctx.fillText(String(beat), x, height - 5);
    }

    if (preview) {
      const x = xAt(notes.length);
      if (x < width - 8) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.beginPath();
        ctx.moveTo(x, 12);
        ctx.lineTo(x, height - 8);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  drawCountIn(ctx, take, f, step, playheadX, height, width) {
    if (!take.countInTicks?.length) return;
    const y = height * 0.52;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const tick of take.countInTicks) {
      const slotPos = (tick.time - take.takeStart) / take.stepDur;
      const x = playheadX + (slotPos - f) * step;
      if (x < -12 || x > width) continue;

      ctx.beginPath();
      ctx.fillStyle = 'rgba(20, 25, 34, 0.9)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1;
      ctx.arc(x, y, Math.min(11, step * 0.3), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = 'rgba(232, 238, 247, 0.6)';
      ctx.font = `600 ${Math.min(10, step * 0.28)}px ${MONO}`;
      ctx.fillText(String(tick.number), x, y + 0.5);
    }

    ctx.restore();
  }

  drawNote(ctx, x, y, note, { step, next, past, alpha }) {
    const hand = HANDS[note.sticking] || HANDS.R;
    const base = Math.min(14, step * 0.37);
    const radius = next ? base * 1.14 : base;
    const fontSize = Math.max(8, Math.min(13, radius * 0.95));

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (next) {
      ctx.shadowColor = `rgba(${hand.rgb}, 0.8)`;
      ctx.shadowBlur = 16;
    }

    ctx.beginPath();
    ctx.fillStyle = `rgba(${hand.rgb}, ${next ? 0.2 : past ? 0.04 : 0.1})`;
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(${hand.rgb}, ${alpha})`;
    ctx.lineWidth = next ? 2 : 1.4;
    ctx.stroke();

    ctx.shadowBlur = 0;

    ctx.fillStyle = `rgba(${hand.rgb}, ${alpha})`;
    ctx.font = `700 ${fontSize}px ${MONO}`;
    ctx.fillText(note.sticking, x, y + 0.5);

    if (note.label) {
      ctx.fillStyle = `rgba(232, 238, 247, ${Math.min(0.8, alpha * 0.8)})`;
      ctx.font = `600 ${Math.max(8, Math.min(10, step * 0.26))}px ${MONO}`;
      ctx.fillText(note.label, x, y - radius - 7);
    }

    if (note.hit) {
      const color = note.hit.quality === 'perfect'
        ? '74, 222, 128'
        : note.hit.quality === 'good'
          ? '251, 191, 36'
          : '251, 113, 133';
      ctx.beginPath();
      ctx.fillStyle = `rgba(${color}, 0.9)`;
      ctx.arc(x, y + radius + 4, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawPlayhead(ctx, x, height, color, alpha) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 8);
    ctx.lineTo(x, height - 8);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x - 4, 8);
    ctx.lineTo(x + 4, 8);
    ctx.lineTo(x, 14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
