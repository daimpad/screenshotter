/* Farbschema-Umschalter der Vorschauseite.
 *
 * Dieselbe Bauart wie im Report (lib/assets/report.js): drei Zustände im
 * Rundlauf, und das Zeichen zeigt das ZIEL des nächsten Klicks, nicht den
 * aktuellen Zustand — Hausregel 19 des Erscheinungsbilds.
 *
 * Ohne JavaScript folgt die Seite weiter dem Betriebssystem; der Knopf ist
 * dann schlicht wirkungslos, nichts bricht.
 */
(function () {
  'use strict';

  var KEY = 'screenshotter-theme';
  var ORDER = ['system', 'light', 'dark'];
  var NAMES = { system: 'System', light: 'Hell', dark: 'Dunkel' };
  var MARKS = { system: '◐', light: '☀', dark: '☾' };

  var button = document.getElementById('theme-toggle');
  if (!button) return;
  var mark = button.querySelector('[data-theme-mark]');

  function gespeichert() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      // Privates Fenster oder gesperrter Speicher — dann eben ohne Gedächtnis.
      return null;
    }
  }

  function speichern(wert) {
    try {
      if (wert) localStorage.setItem(KEY, wert);
      else localStorage.removeItem(KEY);
    } catch (e) {
      /* egal */
    }
  }

  function anwenden(thema) {
    if (thema === 'light' || thema === 'dark') {
      document.documentElement.setAttribute('data-theme', thema);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    var naechstes = ORDER[(ORDER.indexOf(thema) + 1) % ORDER.length];
    if (mark) mark.textContent = MARKS[naechstes];
    button.setAttribute(
      'aria-label',
      'Farbschema umschalten — aktuell ' + NAMES[thema] + ', weiter zu ' + NAMES[naechstes]
    );
  }

  anwenden(gespeichert() || 'system');

  button.addEventListener('click', function () {
    var jetzt = document.documentElement.getAttribute('data-theme') || 'system';
    var naechstes = ORDER[(ORDER.indexOf(jetzt) + 1) % ORDER.length];
    anwenden(naechstes);
    speichern(naechstes === 'system' ? null : naechstes);
  });
})();
