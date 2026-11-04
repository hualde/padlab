/**
 * PadLab · entrenador de pad acústico
 * Orquesta la interfaz, el transporte, la detección y la persistencia.
 */

import { AudioEngine } from './audio/engine.js';
import { StrokeLane } from './ui/stroke-lane.js';
import { LOCALES, applyTranslations, localeTag, setLocale, t, tn } from './core/i18n.js';
import { DENSITIES, EXERCISES, TAKE_BARS, buildPhrase, getExercise } from './core/exercises.js';
import {
  bestStreakForSlots,
  clamp,
  createTake,
  formatSigned,
  mean,
  registerHit,
  summarizeTake,
} from './core/timing.js';
import { estimateLatency } from './core/calibration.js';
import { buildProgress } from './core/stats.js';
import { createStorage } from './core/storage.js';
import { SONGS, isSong, songLabels, songPattern } from './core/songs.js';

const DEFAULT_SETTINGS = {
  exerciseId: 'single',
  density: 2,
  bpm: 100,
  bars: 8,
  alternateLead: true,
  melody: true,
  mode: 'exercise',
  locale: 'es',
  volume: 0.7,
  sensitivity: 55,
  latencyOffsetMs: 0,
  deviceId: null,
};

const SESSION_LIMIT = 300;
const VALID_VIEWS = ['train', 'calibrate', 'progress', 'settings'];

const store = createStorage();
const engine = new AudioEngine();
const params = new URLSearchParams(window.location.search);

let settings = loadSettings();
let sessions = loadSessions();
let records = loadRecords();
let calibration = store.read('calibration', null);
let strokeLane = null;

const state = {
  view: 'train',
  sheet: null,
  mic: 'off',
  micError: '',
  requesting: false,
  starting: false,
  detectedHits: 0,
  take: null,
  metronome: null,
  calibration: null,
  lastSummary: null,
  lastFocus: null,
  toastTimer: null,
  padTimer: null,
  idleTimer: null,
  deepTimer: null,
  saveTimer: null,
};

const els = {};

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function percent(ratio) {
  return `${Math.round(clamp(ratio, 0, 1) * 100)}%`;
}

function densityLabel(density = settings.density) {
  return t(`density.${Number(density)}`);
}

function densityShort(density = settings.density) {
  return t(`density.${Number(density)}.short`);
}

function exerciseName(exercise) {
  return t(exercise.nameKey || 'exercise.single.name');
}

function exerciseDescription(exercise) {
  return t(exercise.descriptionKey || 'exercise.single.description');
}

function exerciseTip(exercise) {
  return t(exercise.tipKey || 'exercise.single.tip');
}

function formatMinutes(minutes) {
  return new Intl.NumberFormat(localeTag(), { maximumFractionDigits: 1 }).format(minutes);
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const day = date.toLocaleDateString(localeTag(), { day: '2-digit', month: 'short' });
  const time = date.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

function formatDayShort(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function uid() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `s_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function toast(message, duration = 3400) {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.classList.add('is-visible');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    els.toast.classList.remove('is-visible');
  }, duration);
}

/* ------------------------------------------------------------------ */
/* Persistencia                                                        */
/* ------------------------------------------------------------------ */

function loadSettings() {
  const raw = store.read('settings', {});
  const merged = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };

  if (![...EXERCISES, ...SONGS].some((exercise) => exercise.id === merged.exerciseId)) {
    merged.exerciseId = DEFAULT_SETTINGS.exerciseId;
  }
  merged.density = [2, 3, 4].includes(Number(merged.density)) ? Number(merged.density) : 2;
  merged.bars = TAKE_BARS.includes(Number(merged.bars)) ? Number(merged.bars) : 8;
  merged.alternateLead = typeof merged.alternateLead === 'boolean' ? merged.alternateLead : true;
  merged.melody = typeof merged.melody === 'boolean' ? merged.melody : true;
  merged.mode = merged.mode === 'metronome' ? 'metronome' : 'exercise';
  merged.locale = LOCALES.some((l) => l.id === merged.locale) ? merged.locale : 'es';
  merged.bpm = clamp(Math.round(Number(merged.bpm) || DEFAULT_SETTINGS.bpm), 40, 240);
  merged.volume = clamp(Number(merged.volume), 0, 1);
  if (!Number.isFinite(merged.volume)) merged.volume = DEFAULT_SETTINGS.volume;
  merged.sensitivity = Number.isFinite(Number(merged.sensitivity))
    ? clamp(Math.round(Number(merged.sensitivity)), 0, 100)
    : DEFAULT_SETTINGS.sensitivity;
  merged.latencyOffsetMs = clamp(Math.round(Number(merged.latencyOffsetMs) || 0), -100, 150);
  merged.deviceId = typeof merged.deviceId === 'string' && merged.deviceId ? merged.deviceId : null;
  const exercise = getExercise(merged.exerciseId);
  if (merged.mode === 'exercise' && !exercise.densities.includes(merged.density)) {
    merged.density = exercise.densities[0];
  }
  return merged;
}

function loadSessions() {
  const raw = store.read('sessions', []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((session) => session && typeof session === 'object' && session.date && session.exerciseId)
    .slice(0, SESSION_LIMIT);
}

function loadRecords() {
  const raw = store.read('records', {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  const migrated = {};
  for (const [key, value] of Object.entries(raw)) {
    const parts = key.split(':');
    if (parts.length === 2) {
      // Los récords anteriores eran siempre de un compás fijo.
      const migratedKey = `${key}:1`;
      if (!(migratedKey in raw) && !(migratedKey in migrated)) {
        migrated[migratedKey] = value;
      }
    } else {
      migrated[key] = value;
    }
  }
  return migrated;
}

function takeBarsFor(exercise = getExercise(settings.exerciseId)) {
  return isSong(exercise) ? exercise.bars : settings.bars;
}

function restCount(slots) {
  return slots.filter((slot) => slot.rest).length;
}

function minExpectedFor(take) {
  const playable = take.slots.length - restCount(take.slots);
  return Math.min(playable, 4 * take.density * 2);
}

function currentPhraseBars() {
  return settings.alternateLead ? 2 : 1;
}

function recordKey(exerciseId, density = settings.density, phraseBars = currentPhraseBars()) {
  return `${exerciseId}:${density}:${phraseBars}`;
}

function saveSettings(immediate = false) {
  clearTimeout(state.saveTimer);
  if (immediate) {
    store.write('settings', settings);
    return;
  }
  state.saveTimer = setTimeout(() => store.write('settings', settings), 180);
}

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

function cacheElements() {
  const ids = [
    'mic-pill', 'mic-pill-text',
    'exercise-list', 'exercise-tip',
    'stage-eyebrow', 'stage-title', 'beat-dots', 'take-state', 'progress-fill',
    'pad', 'ring-level', 'pad-kicker', 'pad-main', 'pad-sub', 'pad-cta', 'pad-mic-btn',
    'feedback', 'feedback-value', 'feedback-label',
    'stroke-canvas', 'sticking-meta', 'stroke-now', 'stroke-next',
    'mini-hits', 'mini-acc', 'mini-bias', 'mini-streak',
    'take-badge', 'transport-title', 'mode-control', 'bpm-minus', 'bpm-value', 'bpm-plus', 'bpm-range',
    'density-control', 'alternate-lead', 'melody-toggle', 'melody-note', 'alternate-note', 'bars-select', 'start-btn', 'start-label', 'start-hint',
    'input-state', 'level-fill', 'hit-count', 'mic-toggle',
    'sensitivity', 'sensitivity-out', 'mic-error',
    'cal-current', 'cal-start', 'cal-start-label', 'cal-cancel', 'cal-hint', 'cal-pulse', 'cal-status',
    'cal-progress', 'cal-dots', 'cal-result', 'cal-offset', 'cal-detail',
    'cal-apply', 'cal-retry', 'cal-level-fill',
    'kpis', 'chart', 'chart-count', 'records-list', 'records-mode', 'history-count',
    'sessions-table', 'progress-clear',
    'settings-mic-state', 'device-select', 'settings-mic', 'settings-level-fill',
    'settings-sensitivity', 'settings-sensitivity-out', 'calibration-badge',
    'latency-offset', 'latency-out', 'settings-calibrate',
    'volume-badge', 'volume', 'volume-out',
    'export-btn', 'clear-btn', 'diagnostics',
    'language-toggle', 'language-control',
    'mobile-dock', 'dock-settings', 'open-rudiments', 'sheet-rudiments', 'sheet-settings', 'sheet-backdrop', 'dock-minus', 'dock-plus', 'dock-bpm', 'dock-start', 'dock-start-label',
    'toast', 'modal', 'modal-card', 'modal-x', 'modal-eyebrow', 'modal-title', 'score-ring',
    'score-value', 'score-grade', 'score-note',
    'sum-acc', 'sum-perfect', 'sum-bias', 'sum-sd', 'sum-extra', 'sum-streak',
    'record-badge', 'modal-repeat', 'modal-bump', 'modal-close',
  ];

  for (const id of ids) {
    const key = id.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    els[key] = document.getElementById(id);
  }

  els.tabs = $$('.tab');
  els.views = $$('.view');
  els.viewTrain = document.getElementById('view-train');
  els.startIcon = els.startBtn.querySelector('use');
  els.beatSpans = $$('span', els.beatDots);
  els.modalBackdrop = $('.modal-backdrop');
  els.dockIcon = els.dockStart.querySelector('use');
}

function init() {
  setLocale(settings.locale);
  document.title = t('app.title');
  cacheElements();
  applyTranslations();
  updateLanguageControls();
  strokeLane = new StrokeLane(els.strokeCanvas);
  applyModeUI();

  engine.setSensitivity(settings.sensitivity);
  engine.setVolume(settings.volume);
  engine.onOnset(handleOnset);

  bindEvents();
  renderAll();

  const requestedView = params.get('view');
  if (VALID_VIEWS.includes(requestedView)) {
    switchView(requestedView, { initial: true });
  }

  if (!window.isSecureContext) {
    els.padSub.textContent = t('train.pad.insecure');
  }

  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/* Eventos                                                             */
/* ------------------------------------------------------------------ */

function bindEvents() {
  for (const tab of els.tabs) {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  }

  $('.brand').addEventListener('click', (event) => {
    event.preventDefault();
    switchView('train');
  });

  els.micPill.addEventListener('click', toggleMic);
  els.micToggle.addEventListener('click', toggleMic);
  els.padMicBtn.addEventListener('click', toggleMic);
  els.settingsMic.addEventListener('click', toggleMic);

  els.startBtn.addEventListener('click', () => startTransport());

  els.bpmMinus.addEventListener('click', () => setBpm(settings.bpm - 5));
  els.bpmPlus.addEventListener('click', () => setBpm(settings.bpm + 5));
  els.bpmRange.addEventListener('input', () => setBpm(Number(els.bpmRange.value)));

  els.densityControl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-density]');
    if (!button || state.take) return;
    setDensity(Number(button.dataset.density));
  });

  els.alternateLead.addEventListener('click', () => {
    if (state.take || state.metronome) return;
    settings.alternateLead = !settings.alternateLead;
    saveSettings();
    renderBpm();
    renderStrokeGuide();
    buildExerciseList();
  });

  els.melodyToggle.addEventListener('click', () => {
    if (state.take || state.metronome) return;
    settings.melody = !settings.melody;
    saveSettings();
    renderBpm();
  });

  els.barsSelect.addEventListener('change', () => {
    if (state.take || state.metronome) return;
    settings.bars = Number(els.barsSelect.value);
    saveSettings();
    renderBpm();
  });

  els.exerciseList.addEventListener('click', (event) => {
    const button = event.target.closest('.exercise');
    if (!button || state.take) return;
    selectExercise(button.dataset.exercise);
    closeSheets();
  });

  els.openRudiments.addEventListener('click', () => openSheet('rudiments'));
  els.dockSettings.addEventListener('click', () => openSheet('settings'));
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-close-sheet]')) closeSheets();
  });
  window.matchMedia('(min-width: 1024px)').addEventListener('change', (event) => {
    if (event.matches) closeSheets();
  });

  els.sensitivity.addEventListener('input', () => applySensitivity(Number(els.sensitivity.value)));
  els.settingsSensitivity.addEventListener('input', () => applySensitivity(Number(els.settingsSensitivity.value)));

  els.volume.addEventListener('input', () => applyVolume(Number(els.volume.value) / 100));
  els.latencyOffset.addEventListener('input', () => applyLatency(Number(els.latencyOffset.value)));

  els.deviceSelect.addEventListener('change', changeDevice);

  els.calStart.addEventListener('click', startCalibration);
  els.calCancel.addEventListener('click', () => cancelCalibration());
  els.calApply.addEventListener('click', applyCalibration);
  els.calRetry.addEventListener('click', startCalibration);
  els.settingsCalibrate.addEventListener('click', () => switchView('calibrate'));

  els.dockMinus.addEventListener('click', () => setBpm(settings.bpm - 5));
  els.dockPlus.addEventListener('click', () => setBpm(settings.bpm + 5));
  els.dockStart.addEventListener('click', () => startTransport());

  els.modeControl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mode]');
    if (!button) return;
    setMode(button.dataset.mode);
  });

  els.languageToggle.addEventListener('click', () => {
    changeLocale(nextLocaleId());
  });
  els.languageControl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-locale]');
    if (!button) return;
    changeLocale(button.dataset.locale);
  });

  els.progressClear.addEventListener('click', () => requestClear(els.progressClear));
  els.clearBtn.addEventListener('click', () => requestClear(els.clearBtn));
  els.exportBtn.addEventListener('click', exportHistory);

  els.modalX.addEventListener('click', closeModal);
  els.modalClose.addEventListener('click', closeModal);
  els.modalBackdrop.addEventListener('click', closeModal);
  els.modalRepeat.addEventListener('click', repeatTake);
  els.modalBump.addEventListener('click', bumpAndRepeat);

  document.addEventListener('keydown', onKeyDown);

  window.addEventListener('beforeunload', () => {
    store.write('settings', settings);
  });
}

function onKeyDown(event) {
  const target = event.target;
  const isFormField = target instanceof HTMLElement
    && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName);

  if (event.key === 'Escape') {
    if (!els.modal.hidden) {
      closeModal();
      return;
    }
    if (state.sheet) {
      closeSheets();
      return;
    }
    if (state.take) {
      stopTake();
      return;
    }
    if (state.metronome?.running) {
      stopMetronome();
      return;
    }
    if (state.calibration?.running) {
      cancelCalibration();
    }
    return;
  }

  if (!els.modal.hidden && event.key === 'Tab') {
    const focusable = $$('button, [href], input, select, textarea', els.modal)
      .filter((element) => !element.disabled && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (document.activeElement === els.modalCard) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
    return;
  }

  if (isFormField) return;
  if (!els.modal.hidden) return;

  if (event.code === 'Space') {
    event.preventDefault();
    if (state.view !== 'train') return;
    startTransport();
    return;
  }

  if (state.view === 'train' && !state.take && !state.metronome) {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setBpm(settings.bpm + 5);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setBpm(settings.bpm - 5);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Navegación y controles                                              */
/* ------------------------------------------------------------------ */

function switchView(view, { initial = false } = {}) {
  if (!VALID_VIEWS.includes(view)) return;
  if (state.take && view !== 'train') {
    toast(t('toast.finishTakeFirst'));
    return;
  }
  if (state.calibration?.running && view !== 'calibrate') {
    cancelCalibration(false);
    toast(t('cal.toast.cancelled'));
  }
  if (state.metronome?.running && view !== 'train') {
    stopMetronome();
  }

  state.view = view;

  for (const tab of els.tabs) {
    const active = tab.dataset.view === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }

  for (const section of els.views) {
    section.hidden = section.dataset.view !== view;
  }

  if (els.mobileDock) els.mobileDock.hidden = view !== 'train';
  closeSheets();

  if (view === 'progress') renderProgress();
  if (view === 'settings') renderSettings();
  if (view === 'calibrate') updateCalibrationUI();
  if (view === 'train') {
    strokeLane.resize();
  }

  if (!initial) window.scrollTo(0, 0);
}

function setBpm(value) {
  if (state.take || state.metronome?.running) return;
  settings.bpm = clamp(Math.round(value), 40, 240);
  saveSettings();
  renderBpm();
}

function setDensity(value) {
  if (state.take || state.metronome?.running) return;
  const exercise = getExercise(settings.exerciseId);
  if (settings.mode !== 'metronome' && !exercise.densities.includes(value)) return;
  settings.density = value;
  saveSettings();
  renderBpm();
  renderStrokeGuide();
  buildExerciseList();
}

function selectExercise(id) {
  if (state.take) return;
  if (settings.exerciseId === id) return;
  const exercise = getExercise(id);
  settings.exerciseId = exercise.id;
  settings.bpm = exercise.defaultBpm;
  if (!exercise.densities.includes(settings.density)) {
    settings.density = exercise.densities[0];
  }
  saveSettings();
  buildExerciseList();
  renderBpm();
  renderStrokeGuide();
}

function applySensitivity(value) {
  settings.sensitivity = clamp(Math.round(value), 0, 100);
  engine.setSensitivity(settings.sensitivity);
  syncSensitivity();
  saveSettings();
}

function applyVolume(value) {
  settings.volume = clamp(value, 0, 1);
  engine.setVolume(settings.volume);
  syncVolume();
  saveSettings();
}

function applyLatency(value) {
  settings.latencyOffsetMs = clamp(Math.round(value), -100, 150);
  syncLatency();
  saveSettings();
  updateCalibrationBadge();
}

async function changeDevice() {
  const deviceId = els.deviceSelect.value || null;
  settings.deviceId = deviceId;
  saveSettings(true);
  if (state.mic !== 'live') return;

  try {
    await engine.enableMic(deviceId);
    toast(t('mic.toast.device'));
  } catch (error) {
    setMicError(micErrorMessage(error));
  }
  renderMicUI();
  updateDiagnostics();
}

/* ------------------------------------------------------------------ */
/* Render                                                              */
/* ------------------------------------------------------------------ */

function renderAll() {
  buildExerciseList();
  renderBpm();
  renderStrokeGuide();
  renderMicUI();
  renderTransportUI();
  renderSettings();
  resetCalibrationUI();
  renderProgress();
  updateDiagnostics();
  updateCalibrationBadge();
}

function buildExerciseList() {
  els.exerciseList.innerHTML = '';

  for (const exercise of EXERCISES) {
    const best = records[recordKey(exercise.id)]?.bestBpm;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `exercise${exercise.id === settings.exerciseId ? ' is-active' : ''}`;
    button.dataset.exercise = exercise.id;
    button.setAttribute('role', 'listitem');
    button.disabled = Boolean(state.take);
    button.innerHTML = `
      <span class="exercise-name">${escapeHtml(exerciseName(exercise))}</span>
      <span class="exercise-short">${escapeHtml(exercise.short)}</span>
      <span class="exercise-meta">${best ? `${best} BPM` : '—'}</span>
    `;
    els.exerciseList.append(button);
  }

  const heading = document.createElement('div');
  heading.className = 'exercise-group';
  heading.setAttribute('role', 'presentation');
  heading.textContent = t('train.songs');
  els.exerciseList.append(heading);

  for (const song of SONGS) {
    const best = records[recordKey(song.id, song.density, song.bars)]?.bestBpm;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `exercise exercise-song${song.id === settings.exerciseId ? ' is-active' : ''}`;
    button.dataset.exercise = song.id;
    button.setAttribute('role', 'listitem');
    button.disabled = Boolean(state.take);
    button.innerHTML = `
      <span class="exercise-name">${escapeHtml(exerciseName(song))}</span>
      <span class="exercise-short">${escapeHtml(song.short)}</span>
      <span class="exercise-meta">${best ? `${best} BPM` : '—'}</span>
    `;
    els.exerciseList.append(button);
  }
}

function renderStrokeGuide() {
  const exercise = getExercise(settings.exerciseId);
  const song = isSong(exercise) ? exercise : null;
  const phraseBars = song ? song.bars : settings.alternateLead ? 2 : 1;
  const phrase = song
    ? songPattern(song)
    : buildPhrase(exercise.base, settings.density, { phraseBars });
  const [first, second] = phrase.replace(/-/g, '');
  const slotsPerBar = 4 * settings.density;
  els.stickingMeta.textContent = song
    ? tn('train.takeBadge', song.bars)
    : phraseBars === 1 ? t('train.guide.oneBar') : t('train.guide.twoBars');
  els.strokeNow.textContent = t('train.guide.start', { hand: first });
  els.strokeNext.textContent = second
    ? t('train.guide.next', { hand: second })
    : t('train.guide.last');
  els.strokeNow.style.color = first === 'R' ? 'var(--accent)' : 'var(--sky)';
  els.strokeNext.style.color = second
    ? second === 'R' ? 'var(--accent)' : 'var(--sky)'
    : 'var(--faint)';
  els.pad.removeAttribute('data-hand');
  if (strokeLane) {
    strokeLane.setPreview(phrase, settings.density, slotsPerBar, song ? songLabels(song) : null);
  }
}

function renderBpm() {
  const exercise = getExercise(settings.exerciseId);
  const metronome = settings.mode === 'metronome';
  els.bpmValue.textContent = String(settings.bpm);
  els.bpmRange.value = String(settings.bpm);
  els.dockBpm.textContent = String(settings.bpm);
  const song = isSong(exercise);
  const bars = takeBarsFor(exercise);
  els.barsSelect.value = String(settings.bars);
  els.viewTrain.classList.toggle('is-song', song && !metronome);
  els.stageEyebrow.textContent = song && !metronome
    ? t('train.songEyebrow', { bpm: settings.bpm })
    : `${densityLabel()} · ${settings.bpm} BPM · 4/4`;

  if (metronome) {
    els.stageTitle.textContent = t('train.metronome.title');
    els.transportTitle.textContent = t('train.metronome.title');
    els.exerciseTip.textContent = t('train.metronomeOnlyHint');
    els.takeBadge.textContent = t('train.soloClick');
    els.startHint.textContent = t('train.hint.metronome', {
      bpm: settings.bpm,
      density: densityLabel().toLowerCase(),
    });
  } else {
    els.stageTitle.textContent = exerciseName(exercise);
    els.transportTitle.textContent = t('train.take');
    els.exerciseTip.textContent = `${exerciseDescription(exercise)} ${exerciseTip(exercise)}`;
    els.takeBadge.textContent = tn('train.takeBadge', bars);
    els.startHint.textContent = t('train.hint.take', {
      bars,
      bpm: settings.bpm,
    });
  }

  els.melodyToggle.setAttribute('aria-checked', String(settings.melody));
  els.melodyNote.textContent = settings.melody ? t('train.melodyOn') : t('train.melodyOff');
  els.alternateLead.setAttribute('aria-checked', String(settings.alternateLead));
  els.alternateNote.textContent = settings.alternateLead
    ? t('train.rudimentLongSub')
    : t('train.rudimentShortSub');
  els.alternateLead.title = settings.alternateLead
    ? t('train.rudimentLongSub')
    : t('train.rudimentShortSub');

  for (const button of $$('button', els.densityControl)) {
    const value = Number(button.dataset.density);
    const allowed = metronome || exercise.densities.includes(value);
    const active = value === settings.density;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    button.disabled = !allowed;
    button.title = allowed
      ? ''
      : t('train.densityUnavailable', { exercise: exerciseName(exercise) });
  }

  if (metronome && !state.metronome) renderMetronomeIdle();
}

function renderMicUI() {
  const live = state.mic === 'live';
  const requesting = state.requesting;
  const error = state.mic === 'error';

  els.micPill.dataset.state = requesting ? 'requesting' : state.mic;
  els.micPill.title = live ? t('mic.pill.disable') : t('mic.pill.enable');
  els.micPill.setAttribute('aria-label', live ? t('mic.live') : requesting ? t('mic.requesting') : error ? t('mic.blocked') : t('mic.off'));
  els.micPillText.textContent = requesting
    ? t('mic.requesting')
    : live
      ? t('mic.live')
      : error
        ? t('mic.blocked')
        : t('mic.off');

  els.inputState.textContent = requesting
    ? t('mic.status.requesting')
    : live
      ? t('mic.status.live')
      : error
        ? t('mic.status.error')
        : t('mic.status.off');
  els.inputState.classList.toggle('is-live', live);
  els.inputState.classList.toggle('is-error', error);
  els.inputState.classList.toggle('is-requesting', requesting);

  els.settingsMicState.textContent = live
    ? t('settings.mic.active')
    : requesting
      ? t('mic.status.requesting')
      : t('settings.mic.off');
  els.settingsMicState.classList.toggle('is-live', live);
  els.settingsMicState.classList.toggle('is-requesting', requesting);

  els.micToggle.textContent = live ? t('mic.deactivate') : requesting ? t('mic.requesting') : t('mic.activate');
  els.settingsMic.textContent = live ? t('mic.deactivate') : t('mic.activate');
  els.micToggle.disabled = requesting || Boolean(state.take);

  els.padCta.hidden = live || requesting;
  els.pad.classList.toggle('no-mic', !live && !requesting);
  els.micError.hidden = !error;
  els.micError.textContent = state.micError || '';

  if (!state.take && !state.metronome?.running) {
    els.padSub.textContent = requesting
      ? t('train.pad.requesting')
      : live
        ? t('train.pad.listening')
        : error
          ? t('train.pad.blocked')
          : t('train.pad.off');
  }

  els.calHint.textContent = live ? t('cal.hint.ready') : t('cal.hint.ask');

  if (!state.take) renderIdlePad();
  if (!state.take && state.view === 'train') renderIdleFeedback();
  updateHitCount();
}

function renderTransportUI() {
  const metronomeMode = settings.mode === 'metronome';
  const take = state.take;
  const metronome = state.metronome;
  const metronomeRunning = Boolean(metronome?.running);
  const running = metronomeMode ? metronomeRunning : Boolean(take);

  if (metronomeMode) {
    els.startLabel.textContent = running ? t('train.stopMetronome') : t('train.startMetronome');
  } else {
    els.startLabel.textContent = running
      ? take.started
        ? t('train.stop')
        : t('train.cancelCount')
      : t('train.start');
  }
  els.startIcon.setAttribute('href', running ? '#i-stop' : '#i-play');
  els.startBtn.classList.toggle('is-running', running);
  els.startBtn.disabled = state.requesting || Boolean(state.calibration?.running);

  els.dockStartLabel.textContent = running ? t('train.dock.stop') : t('train.dock.start');
  els.dockIcon.setAttribute('href', running ? '#i-stop' : '#i-play');
  els.dockStart.classList.toggle('is-running', running);
  els.dockStart.disabled = state.requesting || Boolean(state.calibration?.running);
  els.dockMinus.disabled = running || state.requesting;
  els.dockPlus.disabled = running || state.requesting;
  els.openRudiments.hidden = running;
  els.dockSettings.disabled = running;

  els.takeBadge.textContent = metronomeMode ? t('train.soloClick') : tn('train.takeBadge', settings.bars);
  if (!running) {
    if (metronomeMode) {
      els.takeState.textContent = t('train.state.ready');
      els.progressFill.style.width = '0%';
      setBeatDots(-1, 0);
      renderMetronomeIdle();
    } else {
      els.takeState.textContent = state.mic === 'live' ? t('train.state.listening') : t('train.state.ready');
      els.progressFill.style.width = '0%';
      setBeatDots(-1, 0);
      renderStrokeGuide();
      renderIdlePad();
    }
  } else if (metronomeMode) {
    els.takeState.textContent = t('train.state.playing');
  } else {
    els.takeState.textContent = take.started
      ? t('train.state.bar', { n: 1, total: take.bars })
      : t('train.state.entering');
  }

  const locked = running;
  for (const button of $$('.exercise')) button.disabled = locked || metronomeMode;
  for (const element of [els.bpmMinus, els.bpmPlus, els.bpmRange, els.barsSelect]) {
    element.disabled = locked;
  }
  for (const button of $$('button', els.densityControl)) {
    const value = Number(button.dataset.density);
    const allowed = metronomeMode || getExercise(settings.exerciseId).densities.includes(value);
    button.disabled = locked || !allowed;
  }
  els.alternateLead.disabled = locked;
  els.melodyToggle.disabled = locked;
  for (const button of $$('button', els.modeControl)) {
    button.disabled = locked || state.requesting;
  }
  els.languageToggle.disabled = locked || state.requesting;
  for (const button of $$('button', els.languageControl)) {
    button.disabled = locked || state.requesting;
  }

  els.micToggle.disabled = Boolean(state.take) || state.requesting;
  els.micPill.disabled = Boolean(state.take);
  els.settingsMic.disabled = Boolean(state.take);
}

function renderIdlePad() {
  if (state.take) return;
  if (settings.mode === 'metronome') {
    if (!state.metronome) renderMetronomeIdle();
    return;
  }
  const micState = state.requesting ? 'requesting' : state.mic;
  els.pad.classList.remove('is-count');
  els.pad.classList.toggle('no-mic', micState !== 'live' && micState !== 'requesting');
  els.pad.removeAttribute('data-hand');
  els.padKicker.textContent = micState === 'live' ? t('train.pad.liveKicker') : t('train.pad.entryKicker');
  els.padMain.innerHTML = t('train.pad.hit');
  els.padSub.textContent = micState === 'requesting'
    ? t('train.pad.requesting')
    : micState === 'live'
      ? t('train.pad.listening')
      : micState === 'error'
        ? t('train.pad.blocked')
        : t('train.pad.off');
}

function renderMetronomeIdle() {
  if (settings.mode !== 'metronome' || state.metronome) return;
  els.pad.classList.remove('is-count', 'no-mic');
  els.pad.removeAttribute('data-hand');
  els.padKicker.textContent = t('train.metronome.kicker');
  els.padMain.textContent = t('train.metronome.click');
  els.padSub.textContent = t('train.metronome.sub', { density: densityLabel(), bpm: settings.bpm });
  els.feedback.dataset.quality = 'idle';
  els.feedbackValue.textContent = '—';
  els.feedbackLabel.textContent = t('train.soloClick');
  setBeatDots(-1, 0);
}

function renderIdleFeedback() {
  if (state.take || settings.mode === 'metronome') return;
  els.feedback.dataset.quality = 'idle';
  els.feedbackValue.textContent = '—';
  els.feedbackLabel.textContent = state.mic === 'live'
    ? t('train.feedback.ready')
    : t('train.feedback.activate');
}

function setBeatDots(active, bar) {
  els.beatSpans.forEach((span, index) => {
    span.classList.toggle('is-on', index === active);
    span.classList.toggle('is-bar', index === 0 && bar > 0 && index !== active);
  });
}

function lastPlayableBefore(take, index) {
  for (let i = index; i >= 0; i -= 1) {
    if (!take.slots[i].rest) return i;
  }
  return -1;
}

function updateHandCue(take, now) {
  if (!take.started) return;

  const position = (now - take.takeStart) / take.stepDur;
  const index = clamp(Math.ceil(position - 0.5), 0, take.slots.length - 1);
  if (take.cueIndex === index) return;
  take.cueIndex = index;

  const currentIndex = take.slots[index].rest
    ? lastPlayableBefore(take, index)
    : index;
  const hand = take.slots[currentIndex]?.sticking || null;
  if (!hand || hand === '-') return;
  const next = take.slots.slice(index + 1).find((slot) => !slot.rest)?.sticking || null;
  const handName = t(`train.hand.${hand}`);

  els.pad.dataset.hand = hand;
  els.padKicker.textContent = t('train.pad.cue');
  els.padMain.innerHTML = `<span class="hand-cue hand-${hand}">${hand}</span>`;
  els.padSub.textContent = next
    ? t('train.pad.cueSub', { hand: handName, next })
    : t('train.pad.cueLast', { hand: handName });
  els.strokeNow.textContent = t('train.guide.now', { hand });
  els.strokeNow.style.color = hand === 'R' ? 'var(--accent)' : 'var(--sky)';
  els.strokeNext.textContent = next ? t('train.guide.next', { hand: next }) : t('train.guide.last');
  els.strokeNext.style.color = next
    ? next === 'R' ? 'var(--accent)' : 'var(--sky)'
    : 'var(--faint)';
}

function setMini(name, value) {
  const map = {
    hits: els.miniHits,
    acc: els.miniAcc,
    bias: els.miniBias,
    streak: els.miniStreak,
  };
  if (map[name]) map[name].textContent = String(value);
}

function resetMini() {
  setMini('hits', 0);
  setMini('acc', '—');
  setMini('bias', '—');
  setMini('streak', 0);
}

function updateLiveStats(take) {
  const matched = take.hits.filter((hit) => !hit.extra);
  const errors = matched.map((hit) => hit.errorMs);
  const elapsed = engine.now() - take.takeStart;
  const expected = clamp(Math.floor(elapsed / take.stepDur) + 1, 1, take.slots.length);
  const partial = summarizeTake(take, expected);

  setMini('hits', matched.length);
  setMini('acc', percent(partial.hitRate));
  setMini('bias', errors.length ? formatSigned(mean(errors)) : '—');
  setMini('streak', take.streak || 0);
}

function updateHitCount() {
  const count = state.detectedHits;
  els.hitCount.textContent = tn('train.hits', count);
}

function renderSettings() {
  syncSensitivity();
  syncVolume();
  syncLatency();
  updateCalibrationBadge();
  updateDiagnostics();

  if (state.mic === 'live') {
    refreshDeviceList().catch(() => {});
  }
}

function syncSensitivity() {
  els.sensitivity.value = String(settings.sensitivity);
  els.settingsSensitivity.value = String(settings.sensitivity);
  els.sensitivityOut.value = String(settings.sensitivity);
  els.sensitivityOut.textContent = String(settings.sensitivity);
  els.settingsSensitivityOut.value = String(settings.sensitivity);
  els.settingsSensitivityOut.textContent = String(settings.sensitivity);
}

function syncVolume() {
  const percentage = Math.round(settings.volume * 100);
  els.volume.value = String(percentage);
  els.volumeOut.value = `${percentage}%`;
  els.volumeOut.textContent = `${percentage}%`;
  els.volumeBadge.textContent = `${percentage}%`;
}

function syncLatency() {
  els.latencyOffset.value = String(settings.latencyOffsetMs);
  const text = formatSigned(settings.latencyOffsetMs);
  els.latencyOut.value = text;
  els.latencyOut.textContent = text;
  els.calCurrent.textContent = text;
}

function updateCalibrationBadge() {
  if (calibration && Number.isFinite(calibration.offsetMs)) {
    const manual = settings.latencyOffsetMs !== calibration.offsetMs;
    els.calibrationBadge.textContent = manual ? t('settings.manual') : t('settings.calibrated');
    els.calibrationBadge.title = manual
      ? t('settings.calibrationSaved', { offset: formatSigned(calibration.offsetMs) })
      : t('settings.lastCalibration', { date: formatDate(calibration.at) });
  } else if (settings.latencyOffsetMs !== 0) {
    els.calibrationBadge.textContent = t('settings.manual');
    els.calibrationBadge.title = t('settings.manualHint');
  } else {
    els.calibrationBadge.textContent = t('settings.uncalibrated');
    els.calibrationBadge.title = '';
  }
}

function updateDiagnostics() {
  if (!els.diagnostics) return;
  const info = engine.diagnostics();
  const storage = store.persistent ? t('settings.storage.local') : t('settings.storage.memory');
  if (!info.sampleRate) {
    els.diagnostics.textContent = t('settings.diagnostics.off', { storage });
    return;
  }
  const sr = `${Math.round(info.sampleRate / 1000)} kHz`;
  const latency = Number.isFinite(info.baseLatency)
    ? t('settings.latencyBase', { ms: info.baseLatency })
    : t('settings.latencyUnknown');
  els.diagnostics.textContent = t('settings.diagnostics.on', {
    sr,
    transport: info.transport,
    latency,
    storage,
  });
}

/* ------------------------------------------------------------------ */
/* Micrófono                                                           */
/* ------------------------------------------------------------------ */

function micErrorMessage(error) {
  if (!window.isSecureContext) {
    return t('mic.error.insecure');
  }
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return t('mic.error.denied');
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return t('mic.error.notfound');
    case 'NotReadableError':
    case 'TrackStartError':
      return t('mic.error.busy');
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return t('mic.error.constraint');
    case 'AbortError':
      return t('mic.error.abort');
    default:
      return t('mic.error.generic', { message: error?.message || '' });
  }
}

function setMicError(message) {
  state.mic = 'error';
  state.micError = message;
  renderMicUI();
}

async function enableMic() {
  if (state.requesting) return false;
  if (state.take) {
    toast(t('mic.toast.finishTake'));
    return false;
  }

  if (!window.isSecureContext) {
    setMicError(micErrorMessage({ name: 'SecurityError' }));
    toast(t('mic.toast.insecure'), 5000);
    return false;
  }

  state.requesting = true;
  state.micError = '';
  renderMicUI();

  try {
    await engine.enableMic(settings.deviceId);
    state.mic = 'live';
    state.requesting = false;
    state.detectedHits = 0;
    state.micError = '';
    renderMicUI();
    updateDiagnostics();
    await refreshDeviceList();
    toast(t('mic.toast.active'));
    return true;
  } catch (error) {
    state.requesting = false;
    setMicError(micErrorMessage(error));
    toast(state.micError, 5000);
    return false;
  }
}

function disableMic() {
  if (state.take) {
    toast(t('toast.micFirst'));
    return;
  }
  if (state.calibration?.running) cancelCalibration(false);
  engine.disableMic();
  state.mic = 'off';
  state.micError = '';
  state.detectedHits = 0;
  renderMicUI();
  renderIdleFeedback();
  updateDiagnostics();
}

async function toggleMic() {
  if (state.take) {
    toast(t('toast.micFirst'));
    return;
  }
  if (state.requesting) return;
  if (state.mic === 'live') disableMic();
  else await enableMic();
}

async function refreshDeviceList() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === 'audioinput');

  if (settings.deviceId && !inputs.some((device) => device.deviceId === settings.deviceId)) {
    settings.deviceId = null;
    saveSettings();
  }

  const options = [`<option value="">${escapeHtml(t('mic.device.default'))}</option>`];
  inputs.forEach((device, index) => {
    const label = device.label || t('mic.device.number', { n: index + 1 });
    options.push(`<option value="${escapeHtml(device.deviceId)}">${escapeHtml(label)}</option>`);
  });
  els.deviceSelect.innerHTML = options.join('');
  els.deviceSelect.value = settings.deviceId || '';
}

/* ------------------------------------------------------------------ */
/* Transporte y tomas                                                  */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* Transporte: ejercicio o solo metrónomo                              */
/* ------------------------------------------------------------------ */

function openSheet(name) {
  if (state.take || state.starting) return;
  closeSheets();
  state.sheet = name;
  document.body.classList.add(`sheet-${name}`);
  const sheet = name === 'rudiments' ? els.sheetRudiments : els.sheetSettings;
  sheet.querySelector('[data-close-sheet]')?.focus({ preventScroll: true });
}

function closeSheets() {
  if (!state.sheet) return;
  const trigger = state.sheet === 'rudiments' ? els.openRudiments : els.dockSettings;
  document.body.classList.remove('sheet-rudiments', 'sheet-settings');
  state.sheet = null;
  if (trigger.offsetParent !== null) trigger.focus({ preventScroll: true });
}

function startTransport() {
  closeSheets();
  if (settings.mode === 'metronome') {
    startMetronome();
    return;
  }
  startTake();
}

function setMode(mode) {
  if (!['exercise', 'metronome'].includes(mode)) return;
  if (mode === settings.mode) return;
  if (state.take || state.starting || state.metronome?.running || state.calibration?.running) return;

  settings.mode = mode;
  if (mode === 'exercise') {
    const exercise = getExercise(settings.exerciseId);
    if (!exercise.densities.includes(settings.density)) {
      settings.density = exercise.densities[0];
    }
  }
  saveSettings();
  applyModeUI();
  renderBpm();
  renderTransportUI();
  strokeLane.resize();

  if (mode === 'exercise') {
    renderStrokeGuide();
    renderIdlePad();
    renderIdleFeedback();
  } else {
    renderMetronomeIdle();
  }
}

function applyModeUI() {
  const metronome = settings.mode === 'metronome';
  els.viewTrain.classList.toggle('is-metronome', metronome);

  for (const button of $$('button', els.modeControl)) {
    const active = button.dataset.mode === settings.mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function nextLocaleId() {
  const index = LOCALES.findIndex((l) => l.id === settings.locale);
  return LOCALES[(index + 1) % LOCALES.length].id;
}

function updateLanguageControls() {
  const nextLocale = nextLocaleId();
  const switchLabel = t('language.switchTo', { language: t(`language.${nextLocale}`) });
  els.languageToggle.textContent = settings.locale.toUpperCase();
  els.languageToggle.title = switchLabel;
  els.languageToggle.setAttribute('aria-label', switchLabel);

  for (const button of $$('button', els.languageControl)) {
    const active = button.dataset.locale === settings.locale;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function changeLocale(next) {
  if (!LOCALES.some((l) => l.id === next) || next === settings.locale) return;
  if (state.take || state.metronome || state.calibration?.running || state.starting) {
    toast(t('toast.languageBusy'));
    return;
  }

  settings.locale = next;
  saveSettings(true);
  setLocale(next);
  document.title = t('app.title');
  applyTranslations();
  updateLanguageControls();
  renderAll();
  if (state.view === 'calibrate') updateCalibrationUI();
}

async function startMetronome() {
  if (state.starting) return;
  if (state.take || state.calibration?.running) return;
  if (state.metronome?.running) {
    stopMetronome();
    return;
  }

  state.starting = true;
  try {
    await engine.ensure();

    const density = settings.density;
    const bpm = settings.bpm;
    const stepDur = 60 / bpm / density;
    const beatDur = 60 / bpm;
    const meta = {
      running: true,
      startTime: engine.now() + 0.15,
      beatDur,
      stepDur,
      density,
      bpm,
      nextTime: 0,
      step: 0,
      nodes: [],
      timer: null,
      lastBeat: -1,
    };
    meta.nextTime = meta.startTime;
    state.metronome = meta;

    const schedule = () => {
      if (state.metronome !== meta) return;
      const horizon = engine.now() + 0.2;
      while (meta.nextTime < horizon) {
        const stepInBar = meta.step % (density * 4);
        const level = stepInBar === 0 ? 1 : meta.step % density === 0 ? 0.66 : 0.36;
        const node = engine.playClick(meta.nextTime, level);
        if (node) meta.nodes.push(node);
        meta.nextTime += stepDur;
        meta.step += 1;
      }
      if (meta.nodes.length > 400) meta.nodes.splice(0, meta.nodes.length - 200);
    };

    schedule();
    meta.timer = setInterval(schedule, 30);

    els.pad.classList.remove('is-count', 'no-mic');
    els.pad.removeAttribute('data-hand');
    els.padKicker.textContent = t('train.metronome.kicker');
    els.padMain.textContent = '1';
    els.padSub.textContent = t('train.metronome.sub', { density: densityLabel(density), bpm });
    els.takeState.textContent = t('train.state.playing');
    setBeatDots(0, 0);
    renderTransportUI();
    updateMetronomeVisuals();
  } catch (error) {
    console.error('[PadLab] No se pudo iniciar el metrónomo.', error);
    toast(t('toast.metronomeError'));
  } finally {
    state.starting = false;
  }
}

function stopMetronome() {
  const meta = state.metronome;
  if (!meta) return;
  clearInterval(meta.timer);
  engine.cancelClicks(meta.nodes);
  state.metronome = null;
  renderMetronomeIdle();
  renderTransportUI();
}

function updateMetronomeVisuals() {
  const meta = state.metronome;
  if (!meta?.running) return;

  const now = engine.now();
  if (now < meta.startTime) return;
  const beat = Math.floor((now - meta.startTime) / meta.beatDur) % 4;
  if (beat === meta.lastBeat) return;

  meta.lastBeat = beat;
  els.padMain.textContent = String(beat + 1);
  els.padKicker.textContent = t('train.metronome.kicker');
  els.padSub.textContent = t('train.metronome.sub', {
    density: densityLabel(meta.density),
    bpm: meta.bpm,
  });
  els.takeState.textContent = t('train.state.playing');
  setBeatDots(beat, 0);
  pulsePad();
}

/* ------------------------------------------------------------------ */
/* Tomas de ejercicio                                                  */
/* ------------------------------------------------------------------ */

async function startTake(options = {}) {
  if (state.starting) return;
  if (settings.mode === 'metronome') return;
  if (state.take) {
    stopTake();
    return;
  }
  if (state.metronome?.running) return;
  if (state.calibration?.running) {
    toast(t('toast.calibrationFirst'));
    return;
  }

  state.starting = true;
  try {
    const simulate = Boolean(options.simulate);
    let noMic = false;

    if (!simulate) {
      if (state.mic !== 'live') {
        // Sin micrófono (no hay, permiso denegado, HTTP…) la toma sigue
        // adelante: click, cuenta atrás y guía de golpes, pero sin análisis.
        const ok = await enableMic();
        if (!ok) {
          noMic = true;
          toast(t('toast.takeNoMic'), 4500);
        }
      }
    } else if (!engine.ctx) {
      await engine.ensure();
    } else if (engine.ctx.state !== 'running') {
      await engine.ctx.resume();
    }

    await beginTake({ simulate, simulateOptions: options, noMic });
  } finally {
    state.starting = false;
  }
}

async function beginTake({ simulate = false, simulateOptions = {}, noMic = false } = {}) {
  await engine.ensure();

  if (simulate && state.mic !== 'live') {
    state.mic = 'live';
    renderMicUI();
  }

  const exercise = getExercise(settings.exerciseId);
  const density = Number(settings.density);
  const song = isSong(exercise) ? exercise : null;
  const bars = song ? song.bars : Number(settings.bars);
  const phraseBars = settings.alternateLead ? 2 : 1;
  const pattern = song
    ? songPattern(song)
    : buildPhrase(exercise.base, density, { phraseBars });
  const beatDur = 60 / settings.bpm;
  const firstCountAt = engine.now() + 0.38;
  const takeStart = firstCountAt + 4 * beatDur;
  const take = createTake({
    takeStart,
    bpm: settings.bpm,
    density,
    pattern,
    bars,
  });

  take.exercise = exercise;
  take.exerciseId = exercise.id;
  take.started = false;
  take.countInTicks = Array.from({ length: 4 }, (_, index) => ({
    time: firstCountAt + index * beatDur,
    number: index + 1,
  }));
  take.countIndex = 0;
  take.currentBar = -1;
  take.currentBeat = -1;
  take.cueIndex = -1;
  take.streak = 0;
  take.bestStreak = 0;
  take.lastUi = 0;
  take.finishing = false;
  take.simulated = simulate;
  take.noMic = noMic;
  take.clickNodes = [];

  for (const tick of take.countInTicks) {
    take.clickNodes.push(engine.playClick(tick.time, tick.number === 1 ? 1 : 0.72));
  }

  for (const slot of take.slots) {
    const onBeat = slot.inBar % density === 0;
    // En una canción solo suena el pulso: los silencios y las notas largas no llevan click.
    if (song && !onBeat) continue;
    const level = slot.inBar === 0 ? 1 : onBeat ? 0.66 : 0.36;
    take.clickNodes.push(engine.playClick(slot.time, level));
  }

  if (song) {
    take.song = song;
    const labels = songLabels(song);
    take.slots.forEach((slot, index) => {
      slot.label = labels[index % labels.length];
    });
    if (settings.melody) {
      for (const event of song.events) {
        if (event.midi == null) continue;
        for (let bar = 0; bar < bars / song.bars; bar += 1) {
          const time = takeStart + (bar * song.bars * 4 * density + event.start) * take.stepDur;
          take.clickNodes.push(engine.playNote(time, event.midi, event.dur * take.stepDur * 0.92));
        }
      }
    }
  }

  state.take = take;
  state.lastSummary = null;
  resetMini();
  els.feedback.dataset.quality = 'idle';
  els.feedbackValue.textContent = '—';
  els.feedbackLabel.textContent = t('train.feedback.entering');
  els.progressFill.style.width = '0%';
  setBeatDots(-1, 0);
  els.pad.classList.remove('is-count');
  els.pad.removeAttribute('data-hand');
  els.padMain.innerHTML = t('train.pad.hit');
  els.padKicker.textContent = t('train.pad.entryKicker');
  els.padSub.textContent = t('train.pad.countInSub');
  els.strokeNow.textContent = t('train.guide.countIn', { n: 1 });
  els.strokeNext.textContent = t('train.guide.prepare');
  strokeLane.setTake(take);

  renderTransportUI();

  take.finishTimer = setTimeout(
    () => finishTake('auto'),
    Math.max(0, (take.takeEnd - engine.now() + 0.45) * 1000),
  );

  if (simulate) {
    scheduleSimulatedHits(take, simulateOptions);
  }
}

function scheduleSimulatedHits(take, { errorMs = 0, jitter = 0, missEvery = 0 } = {}) {
  const origin = engine.now();
  take.slots.forEach((slot, index) => {
    if (slot.rest) return;
    if (missEvery && index % missEvery === missEvery - 1) return;
    const offset = errorMs + (jitter ? Math.sin(index * 1.7) * jitter : 0);
    const delay = (slot.time + offset / 1000 - origin) * 1000;
    if (delay < 0) return;
    setTimeout(() => {
      if (state.take !== take) return;
      handleOnset({
        time: slot.time + offset / 1000,
        strength: 4,
        source: 'simulated',
      });
    }, delay);
  });
}

function stopTake() {
  const take = state.take;
  if (!take) return;
  if (!take.started) {
    cancelTake();
    return;
  }
  finishTake('manual');
}

function cancelTake({ silent = false } = {}) {
  const take = state.take;
  if (!take) return;
  take.finishing = true;
  clearTimeout(take.finishTimer);
  engine.cancelClicks(take.clickNodes);
  state.take = null;
  els.progressFill.style.width = '0%';
  setBeatDots(-1, 0);
  resetMini();
  renderTransportUI();
  renderIdlePad();
  renderIdleFeedback();
  if (!silent) toast(t('toast.takeCancelled'));
}

function finishTake(reason = 'auto') {
  const take = state.take;
  if (!take || take.finishing) return;

  take.finishing = true;
  clearTimeout(take.finishTimer);
  engine.cancelClicks(take.clickNodes);

  if (take.noMic) {
    // Sin micrófono no hay nada que analizar: no se guarda ni se resume.
    cancelTake({ silent: true });
    if (reason === 'auto') toast(t('toast.takeNoMicDone'), 4000);
    return;
  }

  const now = engine.now();
  const elapsed = clamp(now - take.takeStart, 0, take.duration);
  const expected = reason === 'auto'
    ? take.slots.length
    : clamp(Math.floor(elapsed / take.stepDur) + 1, 0, take.slots.length);

  if (expected < 4) {
    cancelTake({ silent: false });
    return;
  }

  const summary = summarizeTake(take, expected);
  summary.streak = bestStreakForSlots(take.slots, expected);
  const durationSec = reason === 'auto' ? take.duration : clamp(elapsed, 0, take.duration);
  const exercise = take.exercise || getExercise(take.exerciseId);

  const session = {
    id: uid(),
    date: new Date().toISOString(),
    exerciseId: take.exerciseId,
    exerciseName: exerciseName(exercise),
    density: take.density,
    phraseBars: take.phraseBars,
    bpm: take.bpm,
    bars: take.bars,
    durationSec,
    ...summary,
  };

  const recordInfo = updateRecords(take, summary);
  sessions.unshift(session);
  if (sessions.length > SESSION_LIMIT) sessions.length = SESSION_LIMIT;
  store.write('sessions', sessions);

  state.take = null;
  state.lastSummary = { take, summary, session, ...recordInfo };

  setMini('hits', summary.matched);
  setMini('acc', percent(summary.hitRate));
  setMini('bias', summary.biasMs == null ? '—' : formatSigned(summary.biasMs));
  setMini('streak', summary.streak);

  els.progressFill.style.width = '100%';
  setBeatDots(-1, 0);

  buildExerciseList();
  renderTransportUI();
  renderIdlePad();
  renderIdleFeedback();
  renderProgress();
  showSummaryModal(state.lastSummary);
}

function updateRecords(take, summary) {
  const key = `${take.exerciseId}:${take.density}:${take.phraseBars}`;
  const previous = records[key] || { bestBpm: 0, bestScore: 0, attempts: 0 };
  const minExpected = minExpectedFor(take);
  const qualified = summary.expected >= minExpected
    && summary.extras <= Math.max(2, summary.expected * 0.08);
  const newBestBpm = Boolean(qualified && summary.hitRate >= 0.9 && take.bpm > previous.bestBpm);
  const newBestScore = Boolean(qualified && summary.score > previous.bestScore);

  records[key] = {
    bestBpm: newBestBpm ? take.bpm : previous.bestBpm,
    bestScore: qualified ? Math.max(previous.bestScore, summary.score) : previous.bestScore,
    lastScore: summary.score,
    attempts: previous.attempts + 1,
    updatedAt: new Date().toISOString(),
  };
  store.write('records', records);

  return { newBestBpm, newBestScore };
}

/* ------------------------------------------------------------------ */
/* Golpes y feedback                                                   */
/* ------------------------------------------------------------------ */

function handleOnset(event) {
  const time = Number(event?.time);
  if (!Number.isFinite(time)) return;
  if (settings.mode === 'metronome') return;

  if (state.take?.simulated && event?.source !== 'simulated') return;

  state.detectedHits += 1;
  updateHitCount();
  pulsePad();

  if (state.calibration?.running) {
    registerCalibrationHit(time);
    return;
  }

  if (!state.take) {
    if (state.mic === 'live' && state.view === 'train') showIdleHit();
    return;
  }

  const take = state.take;
  if (!take || take.finishing) return;

  const compensated = time - settings.latencyOffsetMs / 1000;
  if (compensated < take.takeStart - 0.25) return;

  const result = registerHit(take, compensated);

  if (result.type === 'hit') {
    take.streak = result.quality === 'off' ? 0 : take.streak + 1;
    take.bestStreak = Math.max(take.bestStreak, take.streak);
    showFeedback(result.errorMs, result.quality);
    setMini('streak', take.streak);
    updateLiveStats(take);
  } else if (result.type === 'extra') {
    take.streak = 0;
    showExtraHit();
    setMini('streak', 0);
    updateLiveStats(take);
  }
}

function pulsePad() {
  els.pad.classList.add('is-hit');
  clearTimeout(state.padTimer);
  state.padTimer = setTimeout(() => els.pad.classList.remove('is-hit'), 140);
}

function showFeedback(errorMs, quality) {
  els.feedback.dataset.quality = quality;
  els.feedbackValue.textContent = formatSigned(errorMs);

  if (quality === 'perfect') {
    els.feedbackLabel.textContent = t('train.feedback.perfect');
  } else if (quality === 'good') {
    els.feedbackLabel.textContent = errorMs > 0 ? t('train.feedback.goodLate') : t('train.feedback.goodEarly');
  } else {
    els.feedbackLabel.textContent = errorMs > 0 ? t('train.feedback.late') : t('train.feedback.early');
  }
}

function showExtraHit() {
  els.feedback.dataset.quality = 'extra';
  els.feedbackValue.textContent = '—';
  els.feedbackLabel.textContent = t('train.feedback.extra');
}

function showIdleHit() {
  if (state.take) return;
  els.feedback.dataset.quality = 'good';
  els.feedbackValue.textContent = t('train.feedback.ok');
  els.feedbackLabel.textContent = t('train.feedback.detected');
  clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    if (!state.take && state.mic === 'live') renderIdleFeedback();
  }, 1200);
}

/* ------------------------------------------------------------------ */
/* Calibración                                                         */
/* ------------------------------------------------------------------ */

async function startCalibration() {
  if (state.calibration?.running) return;
  if (state.take) {
    toast(t('toast.finishTakeFirst'));
    return;
  }
  if (state.requesting) return;

  if (state.mic !== 'live') {
    const ok = await enableMic();
    if (!ok) return;
  }

  await engine.ensure();

  const total = 12;
  const beatDur = 60 / 90;
  const first = engine.now() + 0.7;
  const clickTimes = Array.from({ length: total }, (_, index) => first + index * beatDur);
  const nodes = clickTimes.map((time, index) => engine.playClick(time, index % 4 === 0 ? 1 : 0.7));

  state.calibration = {
    running: true,
    total,
    beatDur,
    clickTimes,
    nodes,
    hits: [],
    pulseIndex: -1,
    timer: setTimeout(() => finishCalibration(), (total * beatDur + 0.75) * 1000),
  };

  els.calStart.hidden = true;
  els.calCancel.hidden = false;
  els.calResult.hidden = true;
  els.calDots.innerHTML = '';
  els.calPulse.textContent = '·';
  els.calPulse.classList.remove('is-beat');
  els.calStatus.textContent = t('cal.status.running');
  els.calProgress.style.width = '0%';
  els.calCurrent.textContent = formatSigned(settings.latencyOffsetMs);
}

function registerCalibrationHit(time) {
  const cal = state.calibration;
  if (!cal?.running) return;

  const clickIndex = Math.round((time - cal.clickTimes[0]) / cal.beatDur);
  if (clickIndex < 2 || clickIndex >= cal.total) return;
  if (cal.hits.some((hit) => hit.clickIndex === clickIndex)) return;

  const offsetMs = (time - cal.clickTimes[clickIndex]) * 1000;
  if (Math.abs(offsetMs) > 170) return;

  cal.hits.push({ clickIndex, offsetMs, time });

  const chip = document.createElement('span');
  chip.className = `cal-chip ${offsetMs >= 0 ? 'is-late' : 'is-early'}`;
  chip.textContent = formatSigned(offsetMs);
  els.calDots.append(chip);

  els.calStatus.textContent = tn('cal.status.hits', cal.hits.length);
}

function finishCalibration() {
  const cal = state.calibration;
  if (!cal?.running) return;

  cal.running = false;
  clearTimeout(cal.timer);
  engine.cancelClicks(cal.nodes);

  const result = estimateLatency({
    hits: cal.hits.map((hit) => hit.time),
    clicks: cal.clickTimes.slice(2),
    minSamples: 5,
  });

  state.calibration = { ...cal, running: false, result };
  els.calCancel.hidden = true;
  els.calStart.hidden = false;
  els.calPulse.classList.remove('is-beat');

  if (!result.ok) {
    els.calStartLabel.textContent = t('cal.retryStart');
    els.calPulse.textContent = '?';
    els.calStatus.textContent = t('cal.status.few', { count: result.samples });
    els.calResult.hidden = true;
    els.calProgress.style.width = '0%';
    return;
  }

  els.calPulse.textContent = '✓';
  els.calStart.hidden = true;
  els.calStatus.textContent = t('cal.status.done');
  els.calResult.hidden = false;
  els.calOffset.textContent = formatSigned(result.offsetMs);

  const quality = result.spreadMs == null
    ? t('cal.quality.none')
    : result.spreadMs < 22
      ? t('cal.quality.stable')
      : result.spreadMs < 45
        ? t('cal.quality.acceptable')
        : t('cal.quality.high');

  els.calDetail.textContent = t('cal.detail', {
    samples: result.samples,
    spread: result.spreadMs ?? '—',
    quality,
  });
  els.calProgress.style.width = '100%';
}

function applyCalibration() {
  const result = state.calibration?.result;
  if (!result?.ok) return;

  settings.latencyOffsetMs = clamp(result.offsetMs, -100, 150);
  calibration = {
    offsetMs: settings.latencyOffsetMs,
    spreadMs: result.spreadMs,
    samples: result.samples,
    at: new Date().toISOString(),
  };
  store.write('calibration', calibration);
  saveSettings(true);
  syncLatency();
  updateCalibrationBadge();
  toast(t('cal.toast.applied', { offset: formatSigned(settings.latencyOffsetMs) }));
  switchView('train');
}

function cancelCalibration(showToast = true) {
  const cal = state.calibration;
  if (!cal) return;
  clearTimeout(cal.timer);
  cal.running = false;
  engine.cancelClicks(cal.nodes);
  state.calibration = null;
  resetCalibrationUI();
  if (showToast) toast(t('cal.toast.cancelled'));
}

function resetCalibrationUI() {
  els.calStart.hidden = false;
  els.calStartLabel.textContent = t('cal.start');
  els.calCancel.hidden = true;
  els.calResult.hidden = true;
  els.calDots.innerHTML = '';
  els.calPulse.textContent = '·';
  els.calPulse.classList.remove('is-beat');
  els.calStatus.textContent = t('cal.status.idle');
  els.calProgress.style.width = '0%';
  els.calCurrent.textContent = formatSigned(settings.latencyOffsetMs);
}

function updateCalibrationUI() {
  els.calCurrent.textContent = formatSigned(settings.latencyOffsetMs);
  if (state.calibration?.running) {
    els.calStart.hidden = true;
    els.calCancel.hidden = false;
  } else if (state.calibration?.result?.ok) {
    els.calStart.hidden = true;
    els.calResult.hidden = false;
  } else {
    els.calStart.hidden = false;
    els.calStartLabel.textContent = t('cal.start');
    els.calCancel.hidden = true;
    els.calResult.hidden = true;
  }
}

/* ------------------------------------------------------------------ */
/* Resumen                                                             */
/* ------------------------------------------------------------------ */

function summaryNote(summary) {
  const messages = [];
  const bias = summary.biasMs;

  if (summary.hitRate < 0.75) {
    messages.push(t('summary.note.missed'));
  } else if (summary.hitRate > 0.96 && bias != null && Math.abs(bias) <= 15) {
    messages.push(t('summary.note.solid'));
  }

  if (bias != null && bias > 12) {
    messages.push(t('summary.note.late', { ms: Math.round(bias) }));
  } else if (bias != null && bias < -12) {
    messages.push(t('summary.note.early', { ms: Math.abs(Math.round(bias)) }));
  }

  if (summary.sdMs != null && summary.sdMs > 32) {
    messages.push(t('summary.note.consistency'));
  }

  if (!messages.length) {
    messages.push(t('summary.note.default'));
  }

  return messages.slice(0, 2).join(' ');
}

function scoreGradeLabel(score) {
  if (score >= 90) return t('summary.grade.excellent');
  if (score >= 75) return t('summary.grade.veryGood');
  if (score >= 60) return t('summary.grade.good');
  if (score >= 40) return t('summary.grade.keepGoing');
  return t('summary.grade.warming');
}

function showSummaryModal(payload) {
  const { take, summary, newBestBpm, newBestScore } = payload;
  if (!take) return;

  state.lastFocus = document.activeElement;
  els.modal.hidden = false;
  document.body.classList.add('modal-open');

  els.modalEyebrow.textContent = summary.expected < take.slots.length
    ? t('summary.eyebrowPartial', {
      played: Math.max(1, Math.ceil(summary.expected / (4 * take.density))),
      bars: take.bars,
      density: densityLabel(take.density),
    })
    : t('summary.eyebrowFull', { bars: take.bars, density: densityLabel(take.density) });
  els.modalTitle.textContent = t('summary.title', {
    exercise: exerciseName(take.exercise),
    bpm: take.bpm,
  });
  els.scoreValue.textContent = String(summary.score);
  els.scoreRing.style.setProperty('--score', String(clamp(summary.score, 0, 100)));
  els.scoreGrade.textContent = scoreGradeLabel(summary.score);
  els.scoreNote.textContent = summaryNote(summary);

  els.sumAcc.textContent = percent(summary.hitRate);
  els.sumPerfect.textContent = percent(summary.perfectRate);
  els.sumBias.textContent = summary.biasMs == null ? '—' : formatSigned(summary.biasMs);
  els.sumSd.textContent = summary.sdMs == null ? '—' : `±${Math.round(summary.sdMs)} ms`;
  els.sumExtra.textContent = String(summary.extras);
  els.sumStreak.textContent = String(summary.streak ?? take.bestStreak ?? 0);

  const recordText = newBestBpm
    ? t('summary.recordBpm', { bpm: take.bpm })
    : newBestScore
      ? t('summary.recordScore')
      : '';
  els.recordBadge.hidden = !recordText;
  els.recordBadge.textContent = recordText;

  const minExpected = minExpectedFor(take);
  const enoughHits = summary.extras <= Math.max(2, summary.expected * 0.08);
  els.modalBump.hidden = !(
    summary.hitRate >= 0.9
    && summary.expected >= minExpected
    && enoughHits
    && take.bpm < 240
  );

  requestAnimationFrame(() => els.modalCard.focus({ preventScroll: true }));
}

function closeModal() {
  if (els.modal.hidden) return;
  els.modal.hidden = true;
  document.body.classList.remove('modal-open');
  if (state.lastFocus instanceof HTMLElement) {
    state.lastFocus.focus({ preventScroll: true });
  }
}

function repeatTake() {
  closeModal();
  startTake();
}

function bumpAndRepeat() {
  const baseBpm = state.lastSummary?.take?.bpm ?? settings.bpm;
  closeModal();
  setBpm(baseBpm + 5);
  startTake();
}

/* ------------------------------------------------------------------ */
/* Progreso                                                            */
/* ------------------------------------------------------------------ */

function renderProgress() {
  const progress = buildProgress(sessions);

  els.kpis.innerHTML = [
    kpi(t('progress.kpi.takes'), progress.totalSessions, tn('progress.kpi.sessions', progress.totalSessions)),
    kpi(t('progress.kpi.minutes'), formatMinutes(progress.totalMinutes), t('progress.kpi.practice')),
    kpi(t('progress.kpi.streak'), progress.streak, tn('progress.kpi.days', progress.streak)),
    kpi(t('progress.kpi.average'), progress.avgScore == null ? '—' : progress.avgScore, '/100'),
  ].join('');

  els.chartCount.textContent = tn('progress.chart.count', progress.chart.length);
  els.recordsMode.textContent = t('progress.recordsMode', { count: currentPhraseBars() });
  els.historyCount.textContent = tn('progress.chart.count', sessions.length);

  if (!progress.chart.length) {
    els.chart.innerHTML = `<div class="chart-empty">${t('progress.chart.empty')}</div>`;
  } else {
    els.chart.innerHTML = renderChart(progress.chart);
  }

  els.recordsList.innerHTML = renderRecords(progress);
  els.sessionsTable.innerHTML = renderSessionsTable(progress.recent);
}

function kpi(label, value, suffix) {
  return `<div class="kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong><small>${escapeHtml(suffix)}</small></div>`;
}

function renderChart(chart) {
  const width = 640;
  const height = 210;
  const padX = 18;
  const padTop = 20;
  const padBottom = 34;
  const plotHeight = height - padTop - padBottom;
  const step = (width - padX * 2) / chart.length;
  const barWidth = Math.max(7, Math.min(34, step * 0.55));

  const bars = chart.map((session, index) => {
    const x = padX + step * index + (step - barWidth) / 2;
    const barHeight = Math.max(2, (session.score / 100) * plotHeight);
    const y = padTop + plotHeight - barHeight;
    const color = session.score >= 75 ? '#4ade80' : session.score >= 50 ? '#fbbf24' : '#fb7185';
    const label = t('progress.chart.tooltip', {
      exercise: exerciseName(getExercise(session.exerciseId)),
      bpm: session.bpm,
      score: session.score,
    });
    const showLabel = chart.length <= 8 || index % 2 === 0;
    return `
      <g>
        <title>${escapeHtml(label)}</title>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="3" fill="${color}" opacity="0.85"></rect>
        <text x="${(x + barWidth / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" font-size="9" fill="#98a2b2">${session.score}</text>
        ${showLabel ? `<text x="${(x + barWidth / 2).toFixed(1)}" y="${height - 12}" text-anchor="middle" font-size="8" fill="#687382">${formatDayShort(session.date)}</text>` : ''}
      </g>
    `;
  }).join('');

  const goalY = padTop + plotHeight * (1 - 0.75);

  return `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(t('progress.chart.aria'))}">
      <line x1="${padX}" y1="${goalY}" x2="${width - padX}" y2="${goalY}" stroke="rgba(255,180,84,.2)" stroke-dasharray="4 5"></line>
      <text x="${width - padX}" y="${goalY - 5}" text-anchor="end" font-size="8" fill="#ffb454" opacity=".7">75</text>
      ${bars}
    </svg>
  `;
}

function renderRecords(progress) {
  const byExercise = new Map(progress.perExercise.map((item) => [item.exerciseId, item]));
  const phraseBars = currentPhraseBars();

  return [...EXERCISES, ...SONGS].map((exercise) => {
    const stats = byExercise.get(exercise.id);
    const pBars = isSong(exercise) ? exercise.bars : phraseBars;
    const modeRecords = DENSITIES
      .map((density) => records[recordKey(exercise.id, density.value, pBars)])
      .filter(Boolean);
    const chips = DENSITIES.map((density) => {
      const record = records[recordKey(exercise.id, density.value, pBars)];
      if (!record || !record.bestBpm) return '';
      return `<span class="best-chip">${escapeHtml(densityShort(density.value))} <b>${record.bestBpm}</b> BPM</span>`;
    }).filter(Boolean);
    const bestScore = modeRecords.reduce((best, record) => Math.max(best, record.bestScore || 0), 0);

    if (!chips.length && bestScore) {
      chips.push(`<span class="best-chip">${t('progress.record.best', { score: bestScore })}</span>`);
    }

    return `
      <div class="record-row">
        <div>
          <div class="record-name">${escapeHtml(exerciseName(exercise))}</div>
          <div class="record-meta">${stats ? tn('progress.record.meta', stats.count, { score: stats.lastScore }) : t('progress.record.empty')}</div>
        </div>
        <div class="record-bests">${chips.join('') || '<span class="record-meta">—</span>'}</div>
      </div>
    `;
  }).join('');
}

function renderSessionsTable(recent) {
  if (!recent.length) {
    return `<div class="table-empty">${t('progress.table.empty')}</div>`;
  }

  const rows = recent.map((session) => {
    const scoreClass = session.score >= 75 ? 'good' : session.score >= 50 ? 'mid' : 'low';
    const exercise = getExercise(session.exerciseId);
    return `
      <tr>
        <td class="num">${escapeHtml(formatDate(session.date))}</td>
        <td class="strong">${escapeHtml(exerciseName(exercise))}</td>
        <td>${escapeHtml(densityShort(session.density))}${session.phraseBars === 2 ? t('progress.phraseSuffix', { count: 2 }) : ''}</td>
        <td class="num">${session.bpm}</td>
        <td class="num">${percent(session.hitRate ?? 0)}</td>
        <td class="num">${session.biasMs == null ? '—' : formatSigned(session.biasMs)}</td>
        <td class="num">${session.sdMs == null ? '—' : `±${Math.round(session.sdMs)}`}</td>
        <td><span class="score-pill ${scoreClass}">${session.score}</span></td>
      </tr>
    `;
  }).join('');

  return `
    <table>
      <thead>
        <tr>
          <th>${escapeHtml(t('progress.table.date'))}</th>
          <th>${escapeHtml(t('progress.table.exercise'))}</th>
          <th>${escapeHtml(t('progress.table.density'))}</th>
          <th>${escapeHtml(t('progress.table.bpm'))}</th>
          <th>${escapeHtml(t('progress.table.accuracy'))}</th>
          <th>${escapeHtml(t('progress.table.bias'))}</th>
          <th>${escapeHtml(t('progress.table.consistency'))}</th>
          <th>${escapeHtml(t('progress.table.score'))}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

/* ------------------------------------------------------------------ */
/* Datos                                                               */
/* ------------------------------------------------------------------ */

function requestClear(button) {
  if (button.dataset.confirm === '1') {
    clearHistory();
    return;
  }

  button.dataset.confirm = '1';
  button.dataset.originalHtml = button.innerHTML;
  button.textContent = t('confirm.clear');
  button.classList.add('is-confirming');

  clearTimeout(state.deepTimer);
  state.deepTimer = setTimeout(() => {
    if (!button.isConnected) return;
    button.dataset.confirm = '';
    button.innerHTML = button.dataset.originalHtml || button.innerHTML;
    button.classList.remove('is-confirming');
  }, 3600);
}

function clearHistory() {
  sessions = [];
  records = {};
  store.write('sessions', sessions);
  store.write('records', records);
  renderProgress();
  buildExerciseList();
  resetClearButtons();
  toast(t('toast.historyCleared'));
}

function resetClearButtons() {
  for (const button of [els.progressClear, els.clearBtn]) {
    button.dataset.confirm = '';
    button.classList.remove('is-confirming');
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

function exportHistory() {
  const payload = {
    app: 'PadLab',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    sessions,
    records,
    calibration,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `padlab-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(t('toast.exported'));
}

/* ------------------------------------------------------------------ */
/* Bucle visual                                                        */
/* ------------------------------------------------------------------ */

let levelSmooth = 0;
let lastLevelPaint = 0;

function frame() {
  requestAnimationFrame(frame);

  const now = performance.now();
  if (now - lastLevelPaint > 30) {
    lastLevelPaint = now;
    updateLevel();
  }

  if (state.view === 'train') {
    strokeLane.draw(engine.now());
    updateTakeVisuals();
    updateMetronomeVisuals();
  }

  updateCalibrationPulse();
}

function updateLevel() {
  const target = engine.micActive ? engine.readLevel() : 0;
  const factor = target > levelSmooth ? 0.5 : 0.08;
  levelSmooth += (target - levelSmooth) * factor;
  if (levelSmooth < 0.004) levelSmooth = 0;
  if (!engine.micActive) levelSmooth = 0;

  const percentage = Math.min(100, levelSmooth * 100);
  for (const bar of [els.levelFill, els.settingsLevelFill, els.calLevelFill]) {
    if (bar) bar.style.width = `${percentage.toFixed(1)}%`;
  }

  if (els.ringLevel) {
    const circumference = 703.72;
    els.ringLevel.style.strokeDashoffset = String(circumference * (1 - Math.min(1, levelSmooth)));
    els.ringLevel.style.opacity = String(engine.micActive ? 0.35 + levelSmooth * 0.65 : 0.12);
  }
}

function updateTakeVisuals() {
  const take = state.take;
  if (!take) return;

  const now = engine.now();

  while (take.countIndex < take.countInTicks.length && now + 0.004 >= take.countInTicks[take.countIndex].time) {
    showCountIn(take.countInTicks[take.countIndex].number);
    take.countIndex += 1;
  }

  if (!take.started && now >= take.takeStart) {
    take.started = true;
    beginPlaybackUI(take);
  }

  if (now < take.takeStart) return;

  const elapsed = now - take.takeStart;
  if (now - take.lastUi < 0.04) return;
  take.lastUi = now;

  const step = Math.floor(elapsed / take.stepDur);
  const slotIndex = clamp(step, 0, take.slots.length - 1);
  const slot = take.slots[slotIndex];
  const beat = Math.floor(slot.inBar / take.density);

  if (slot.bar !== take.currentBar || beat !== take.currentBeat) {
    take.currentBar = slot.bar;
    take.currentBeat = beat;
    setBeatDots(beat, slot.bar);
    els.takeState.textContent = t('train.state.bar', { n: slot.bar + 1, total: take.bars });
  }

  updateHandCue(take, now);
  els.progressFill.style.width = `${clamp((elapsed / take.duration) * 100, 0, 100)}%`;

  if (now >= take.takeEnd) finishTake('auto');
}

function showCountIn(number) {
  const take = state.take;
  if (!take) return;
  els.pad.classList.add('is-count');
  els.pad.removeAttribute('data-hand');
  els.padMain.textContent = String(number);
  els.padKicker.textContent = t('train.pad.entryKicker');
  els.padSub.textContent = number === 4
    ? t('train.countIn.last')
    : t('train.countIn.of', { n: number });
  els.feedback.dataset.quality = 'idle';
  els.feedbackValue.textContent = '—';
  els.feedbackLabel.textContent = t('train.feedback.countIn', { n: number });
  els.strokeNow.textContent = t('train.guide.countIn', { n: number });
  els.strokeNow.style.color = 'var(--accent)';
  els.strokeNext.textContent = t('train.guide.prepare');
  els.strokeNext.style.color = 'var(--sky)';
  setBeatDots(number - 1, 0);
}

function beginPlaybackUI(take) {
  els.pad.classList.remove('is-count');
  renderTransportUI();
  els.feedback.dataset.quality = 'idle';
  els.feedbackValue.textContent = '—';
  els.feedbackLabel.textContent = t('train.feedback.dale');
  setBeatDots(0, 0);
  els.takeState.textContent = t('train.state.bar', { n: 1, total: take.bars });
  take.cueIndex = -1;
  updateHandCue(take, take.takeStart);

  clearTimeout(state.daleTimer);
  state.daleTimer = setTimeout(() => {
    if (state.take?.started && els.feedbackLabel.textContent === t('train.feedback.dale')) {
      els.feedbackLabel.textContent = t('train.feedback.live');
    }
  }, 750);
}

function updateCalibrationPulse() {
  const cal = state.calibration;
  if (!cal?.running) return;

  const now = engine.now();
  const index = Math.floor((now - cal.clickTimes[0]) / cal.beatDur);
  if (index < 0 || index >= cal.total || index === cal.pulseIndex) return;

  cal.pulseIndex = index;
  els.calPulse.textContent = String(index + 1);
  els.calPulse.classList.remove('is-beat');
  void els.calPulse.offsetWidth;
  els.calPulse.classList.add('is-beat');
  els.calProgress.style.width = `${((index + 1) / cal.total) * 100}%`;

  setTimeout(() => {
    if (state.calibration?.running) els.calPulse.classList.remove('is-beat');
  }, 120);
}

/* ------------------------------------------------------------------ */
/* Debug (solo con ?debug=1)                                           */
/* ------------------------------------------------------------------ */

function exposeDebugApi() {
  window.__padlab = {
    getState: () => ({
      view: state.view,
      mic: state.mic,
      bpm: settings.bpm,
      density: settings.density,
      exerciseId: settings.exerciseId,
      take: state.take
        ? {
          started: state.take.started,
          takeStart: state.take.takeStart,
          takeEnd: state.take.takeEnd,
          slots: state.take.slots.length,
        }
        : null,
      summary: state.lastSummary
        ? {
          score: state.lastSummary.summary.score,
          hitRate: state.lastSummary.summary.hitRate,
          expected: state.lastSummary.summary.expected,
          matched: state.lastSummary.summary.matched,
        }
        : null,
      sessions: sessions.length,
      modalOpen: !els.modal.hidden,
    }),
    simulateTake: (options = {}) => startTake({ simulate: true, ...options }),
    stopTake,
    closeModal,
  };
}

/* ------------------------------------------------------------------ */

init();

if (params.get('debug') === '1') {
  exposeDebugApi();
}
