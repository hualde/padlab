/**
 * Persistencia local tolerante a fallos (modo privado, cuota llena, etc.).
 * Si localStorage no está disponible, se usa memoria durante la sesión.
 */

const PREFIX = 'padlab.v1.';

export function createStorage() {
  let persistent = true;
  const memory = new Map();

  try {
    const probe = `${PREFIX}__probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
  } catch {
    persistent = false;
  }

  function read(key, fallback) {
    try {
      const raw = persistent
        ? window.localStorage.getItem(PREFIX + key)
        : memory.get(PREFIX + key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    const raw = JSON.stringify(value);
    try {
      if (persistent) window.localStorage.setItem(PREFIX + key, raw);
      else memory.set(PREFIX + key, raw);
    } catch {
      persistent = false;
      memory.set(PREFIX + key, raw);
    }
  }

  function remove(key) {
    try {
      if (persistent) window.localStorage.removeItem(PREFIX + key);
      else memory.delete(PREFIX + key);
    } catch {
      memory.delete(PREFIX + key);
    }
  }

  return {
    read,
    write,
    remove,
    get persistent() {
      return persistent;
    },
  };
}
