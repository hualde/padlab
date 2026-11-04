/**
 * Canciones tradicionales o de dominio público para practicar con melodía.
 *
 * Cada canción se escribe en 4/4 sobre una rejilla de corcheas (density = 2):
 * una unidad = una corchea, así que negra = 2, blanca = 4, redonda = 8.
 * Formato de `notes`: tokens `Nota:duración` separados por espacios,
 * con `-` como nota para un silencio (`-:2`).
 *
 * Todas las melodías son tradicionales o anteriores a 1930 (dominio público).
 */

// Se define aquí (y no se importa de exercises.js) para evitar un ciclo de módulos.
const BEATS_PER_BAR = 4;

const NAMES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteToMidi(name) {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!match) return null;
  const [, letter, accidental, octave] = match;
  const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return 12 * (Number(octave) + 1) + NAMES[letter] + shift;
}

/**
 * Convierte la notación en eventos con inicio y duración en pasos de rejilla.
 * @returns {{ start: number, dur: number, midi: number|null, name: string }[]}
 */
export function parseNotes(notes) {
  const events = [];
  let start = 0;
  for (const token of notes.trim().split(/\s+/)) {
    const [name, rawDur] = token.split(':');
    const dur = Number(rawDur);
    if (!name || !Number.isInteger(dur) || dur < 1) {
      throw new Error(`Nota no válida: "${token}"`);
    }
    const midi = name === '-' ? null : noteToMidi(name);
    if (name !== '-' && midi == null) throw new Error(`Nota no válida: "${token}"`);
    events.push({ start, dur, midi, name });
    start += dur;
  }
  return events;
}

export const SONGS = [
  {
    id: 'song-mary',
    notes: [
      'E4:2 D4:2 C4:2 D4:2', 'E4:2 E4:2 E4:4', 'D4:2 D4:2 D4:4', 'E4:2 G4:2 G4:4',
      'E4:2 D4:2 C4:2 D4:2', 'E4:2 E4:2 E4:2 E4:2', 'D4:2 D4:2 E4:2 D4:2', 'C4:8',
    ].join(' '),
    defaultBpm: 80,
  },
  {
    id: 'song-twinkle',
    notes: [
      'C4:2 C4:2 G4:2 G4:2', 'A4:2 A4:2 G4:4',
      'F4:2 F4:2 E4:2 E4:2', 'D4:2 D4:2 C4:4',
      'G4:2 G4:2 F4:2 F4:2', 'E4:2 E4:2 D4:4',
      'G4:2 G4:2 F4:2 F4:2', 'E4:2 E4:2 D4:4',
      'C4:2 C4:2 G4:2 G4:2', 'A4:2 A4:2 G4:4',
      'F4:2 F4:2 E4:2 E4:2', 'D4:2 D4:2 C4:4',
    ].join(' '),
    defaultBpm: 80,
  },
  {
    id: 'song-jacques',
    notes: [
      'C4:2 D4:2 E4:2 C4:2', 'C4:2 D4:2 E4:2 C4:2',
      'E4:2 F4:2 G4:4', 'E4:2 F4:2 G4:4',
      'G4:1 A4:1 G4:1 F4:1 E4:2 C4:2', 'G4:1 A4:1 G4:1 F4:1 E4:2 C4:2',
      'C4:2 G3:2 C4:4', 'C4:2 G3:2 C4:4',
    ].join(' '),
    defaultBpm: 76,
  },
  {
    id: 'song-ode',
    notes: [
      'E4:2 E4:2 F4:2 G4:2', 'G4:2 F4:2 E4:2 D4:2', 'C4:2 C4:2 D4:2 E4:2', 'E4:3 D4:1 D4:4',
      'E4:2 E4:2 F4:2 G4:2', 'G4:2 F4:2 E4:2 D4:2', 'C4:2 C4:2 D4:2 E4:2', 'D4:3 C4:1 C4:4',
    ].join(' '),
    defaultBpm: 84,
  },
  {
    id: 'song-jingle',
    notes: [
      'E4:2 E4:2 E4:4', 'E4:2 E4:2 E4:4', 'E4:2 G4:2 C4:3 D4:1', 'E4:8',
      'F4:2 F4:2 F4:3 F4:1', 'F4:2 E4:2 E4:2 E4:1 E4:1', 'E4:2 D4:2 D4:2 E4:2', 'D4:4 G4:4',
    ].join(' '),
    defaultBpm: 76,
  },
  {
    id: 'song-clair',
    notes: [
      'C4:2 C4:2 C4:2 D4:2', 'E4:4 D4:4', 'C4:2 E4:2 D4:2 D4:2', 'C4:8',
    ].join(' '),
    defaultBpm: 76,
  },
  {
    id: 'song-buns',
    notes: [
      'E4:2 D4:2 C4:4', 'E4:2 D4:2 C4:4', 'C4:1 C4:1 C4:1 C4:1 D4:1 D4:1 D4:1 D4:1', 'E4:2 D4:2 C4:4',
    ].join(' '),
    defaultBpm: 76,
  },
];

for (const song of SONGS) {
  song.kind = 'song';
  song.density = 2;
  song.densities = [2];
  song.minBpm = 40;
  song.maxBpm = 160;
  song.nameKey = `${song.id}.name`;
  song.descriptionKey = `${song.id}.description`;
  song.tipKey = 'song.tip';
  song.events = parseNotes(song.notes);

  const steps = song.events.reduce((total, event) => total + event.dur, 0);
  const slotsPerBar = BEATS_PER_BAR * song.density;
  if (steps % slotsPerBar !== 0) {
    throw new Error(`${song.id}: la canción no ocupa compases completos (${steps} pasos).`);
  }
  song.bars = steps / slotsPerBar;

  const played = song.events.filter((event) => event.midi != null);
  song.short = `${played.slice(0, 7).map((event) => event.name.replace(/\d/, '')).join(' ')}…`;
}

export function isSong(piece) {
  return piece?.kind === 'song';
}

export function getSong(id) {
  return SONGS.find((song) => song.id === id) || null;
}

/**
 * Digitación de la canción: una mano por nota (alternando R/L), `-` en los
 * pasos sin golpe (notas largas y silencios).
 */
export function songPattern(song) {
  const total = song.bars * BEATS_PER_BAR * song.density;
  const pattern = Array(total).fill('-');
  let hand = 0;
  for (const event of song.events) {
    if (event.midi == null) continue;
    pattern[event.start] = hand % 2 === 0 ? 'R' : 'L';
    hand += 1;
  }
  return pattern.join('');
}

/** Nombre de nota (sin octava) en cada paso de golpe, para mostrarlo en la guía. */
export function songLabels(song) {
  const total = song.bars * BEATS_PER_BAR * song.density;
  const labels = Array(total).fill('');
  for (const event of song.events) {
    if (event.midi != null) labels[event.start] = event.name.replace(/\d/, '');
  }
  return labels;
}
