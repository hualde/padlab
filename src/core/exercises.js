/**
 * Catálogo de ejercicios y construcción de patrones de digitación.
 *
 * Cada ejercicio define una unidad base de digitación (`base`) que se repite
 * hasta llenar un compás de 4/4 a la densidad elegida.
 *
 * Densidad = golpes por pulso:
 *   2 → corcheas (8 golpes por compás)
 *   4 → semicorcheas (16 golpes por compás)
 */

export const BEATS_PER_BAR = 4;

export const TAKE_BARS = [2, 4, 8, 16, 32];

export const DENSITIES = [
  { value: 2, label: 'Corcheas', shortLabel: '8vos', description: '8 golpes por compás' },
  { value: 3, label: 'Tresillos', shortLabel: '3illos', description: '12 golpes por compás' },
  { value: 4, label: 'Semicorcheas', shortLabel: '16vos', description: '16 golpes por compás' },
];

for (const density of DENSITIES) {
  density.labelKey = `density.${density.value}`;
  density.shortKey = `density.${density.value}.short`;
}

export const EXERCISES = [
  {
    id: 'single',
    name: 'Golpes simples',
    short: 'R L R L',
    base: 'RL',
    densities: [2, 3, 4],
    defaultBpm: 100,
    minBpm: 40,
    maxBpm: 240,
    description: 'Alternancia continua. La frase cambia de mano cada compás.',
    tip: 'Busca un rebote cómodo y deja que el palo suba solo. Si te tensas, baja 10 BPM.',
  },
  {
    id: 'double',
    name: 'Doble golpe',
    short: 'R R L L',
    base: 'RRLL',
    densities: [2, 3, 4],
    defaultBpm: 80,
    minBpm: 40,
    maxBpm: 200,
    description: 'Dos golpes por mano, con la frase espejada al compás siguiente.',
    tip: 'Piensa en “dejar caer” el segundo golpe, no en empujarlo. Muñeca relajada.',
  },
  {
    id: 'paradiddle',
    name: 'Paradiddle',
    short: 'R L R R · L R L L',
    base: 'RLRRLRLL',
    densities: [2, 4],
    defaultBpm: 90,
    minBpm: 40,
    maxBpm: 200,
    description: 'El paradiddle simple, con cambio de mano al compás siguiente.',
    tip: 'Marca el acento natural en el pulso y mantén el resto al mismo volumen.',
  },
  {
    id: 'inverted',
    name: 'Paradiddle invertido',
    short: 'R L L R · L R R L',
    base: 'RLLRLRRL',
    densities: [2, 4],
    defaultBpm: 85,
    minBpm: 40,
    maxBpm: 200,
    description: 'La inversión del paradiddle: los dos golpes seguidos van al principio.',
    tip: 'Cuenta “uno, dos y…” para no perder el doble golpe central.',
  },
  {
    id: 'reverse',
    name: 'Paradiddle inverso',
    short: 'R R L R · L L R L',
    base: 'RRLRLLRL',
    densities: [2, 4],
    defaultBpm: 85,
    minBpm: 40,
    maxBpm: 200,
    description: 'El reverso del paradiddle, también con la mano espejada.',
    tip: 'Piensa en el doble golpe al principio de cada grupo de cuatro.',
  },
  {
    id: 'double-paradiddle',
    name: 'Paradiddle doble',
    short: 'R L R L R R',
    base: 'RLRLRRLRLRLL',
    densities: [3],
    defaultBpm: 70,
    minBpm: 40,
    maxBpm: 180,
    description: 'Dos pares alternos antes del doble golpe. Se practica en tresillos.',
    tip: 'En tresillos, cada golpe cae en una parte del pulso. Mantén las manos bajas.',
  },
  {
    id: 'paradiddle-diddle',
    name: 'Paradiddle-diddle',
    short: 'R L R R L L',
    base: 'RLRRLLLRLLRR',
    densities: [3],
    defaultBpm: 70,
    minBpm: 40,
    maxBpm: 180,
    description: 'Dos golpes dobles al final del grupo. Un clásico en tresillos.',
    tip: 'Deja que los dos golpes finales reboten; no los fuerces.',
  },
  {
    id: 'triple-paradiddle',
    name: 'Triple paradiddle',
    short: 'R L R L R L R R',
    base: 'RLRLRLRRLRLRLRLL',
    densities: [4],
    defaultBpm: 70,
    minBpm: 40,
    maxBpm: 180,
    description: 'Tres pares alternos y un doble golpe. El paradiddle más largo.',
    tip: 'Empieza lento: es fácil acelerar los pares y perder el doble final.',
  },
];

export function getExercise(id) {
  return EXERCISES.find((exercise) => exercise.id === id) || EXERCISES[0];
}

for (const exercise of EXERCISES) {
  exercise.nameKey = `exercise.${exercise.id}.name`;
  exercise.descriptionKey = `exercise.${exercise.id}.description`;
  exercise.tipKey = `exercise.${exercise.id}.tip`;
}

/**
 * Repite la unidad base hasta completar el compás.
 * @param {string} base
 * @param {number} density
 * @param {number} beatsPerBar
 * @returns {string}
 */
export function buildPattern(base, density, beatsPerBar = BEATS_PER_BAR) {
  if (!base || base.length === 0) throw new Error('El patrón base está vacío.');
  if (!Number.isInteger(density) || density < 1) throw new Error('Densidad no válida.');
  const length = beatsPerBar * density;
  let pattern = '';
  while (pattern.length < length) pattern += base;
  return pattern.slice(0, length);
}

export function patternFor(exerciseId, density, beatsPerBar = BEATS_PER_BAR) {
  return buildPattern(getExercise(exerciseId).base, density, beatsPerBar);
}

export function mirrorSticking(pattern) {
  return pattern
    .split('')
    .map((hand) => (hand === 'R' ? 'L' : hand === 'L' ? 'R' : hand))
    .join('');
}

/**
 * Construye una frase de varios compases.
 *
 * Con `alternate` activado, los compases impares invierten las manos:
 *   RLRLRLRL → LRLRLRLR
 * Así el rudimento deja de empezar siempre con la misma mano.
 */
export function buildPhrase(
  base,
  density,
  {
    beatsPerBar = BEATS_PER_BAR,
    phraseBars = 1,
    alternate = true,
  } = {},
) {
  const bar = buildPattern(base, density, beatsPerBar);
  if (phraseBars <= 1) return bar;

  let phrase = '';
  for (let index = 0; index < phraseBars; index += 1) {
    phrase += alternate && index % 2 === 1 ? mirrorSticking(bar) : bar;
  }
  return phrase;
}
