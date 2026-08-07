/** Datei oder URL im Standardprogramm des Systems öffnen. */

import { spawn } from 'node:child_process';

/** Passendes Öffnen-Kommando für die Plattform. */
export function openCommand(target, platform = process.platform) {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', target] };
  if (platform === 'darwin') return { command: 'open', args: [target] };
  return { command: 'xdg-open', args: [target] };
}

/**
 * Öffnet `target` und wartet nicht darauf. Schlägt das fehl (z.B. Server ohne
 * Desktop), ist das kein Grund den Lauf scheitern zu lassen.
 *
 * @returns {Promise<boolean>} ob der Start des Programms geklappt hat
 */
export function openInDefaultApp(target) {
  const { command, args } = openCommand(target);

  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: 'ignore', detached: true });
      child.on('error', () => resolve(false));
      child.unref();
      // Ein sofortiger Fehler kommt im nächsten Tick, danach gilt es als gestartet.
      setTimeout(() => resolve(true), 120);
    } catch {
      resolve(false);
    }
  });
}
