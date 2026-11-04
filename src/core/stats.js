/** Agregados para la pestaña de progreso. */

import { mean, round } from './timing.js';

export function localDayKey(dateInput) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Días consecutivos con práctica. Si hoy aún no hay sesión, cuenta desde ayer.
 */
export function computeStreak(dates, now = new Date()) {
  const days = new Set(dates.map((date) => localDayKey(date)));
  if (!days.size) return 0;

  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(localDayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (days.has(localDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function buildProgress(sessions, now = new Date()) {
  const sorted = [...sessions].sort((a, b) => new Date(b.date) - new Date(a.date));
  const last10 = sorted.slice(0, 10);
  const totalSeconds = sorted.reduce((sum, session) => sum + (session.durationSec || 0), 0);
  const scores = last10.map((session) => session.score).filter(Number.isFinite);

  const perExercise = new Map();
  for (const session of sorted) {
    const current = perExercise.get(session.exerciseId) || {
      exerciseId: session.exerciseId,
      name: session.exerciseName,
      count: 0,
      bestScore: 0,
      lastDate: session.date,
      lastScore: session.score,
    };
    current.count += 1;
    current.bestScore = Math.max(current.bestScore, session.score || 0);
    perExercise.set(session.exerciseId, current);
  }

  return {
    totalSessions: sorted.length,
    totalMinutes: round(totalSeconds / 60, 1),
    totalHits: sorted.reduce((sum, session) => sum + (session.matched || 0), 0),
    streak: computeStreak(sorted.map((session) => session.date), now),
    avgScore: scores.length ? Math.round(mean(scores)) : null,
    perExercise: [...perExercise.values()],
    chart: sorted.slice(0, 12).reverse(),
    recent: sorted.slice(0, 10),
  };
}
