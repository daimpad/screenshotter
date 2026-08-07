/* screenshotter — Report-Interaktionen (Vanilla JS, keine Abhängigkeiten).
   Der Report funktioniert auch ohne JavaScript; dieses Skript ergänzt
   Sortierung, Filter, Lightbox und Theme-Umschalter. */

(function () {
  'use strict';

  var THEME_KEY = 'screenshotter-theme';

  /* ------------------------------------------------------------------ Theme */

  function initTheme() {
    var button = document.getElementById('theme-toggle');
    if (!button) return;

    var label = button.querySelector('[data-theme-label]');

    function apply(theme) {
      if (theme === 'light' || theme === 'dark') {
        document.documentElement.setAttribute('data-theme', theme);
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
      if (label) {
        label.textContent = theme === 'dark' ? 'Dunkel' : theme === 'light' ? 'Hell' : 'System';
      }
      button.setAttribute('aria-label', 'Farbschema umschalten (aktuell: ' + (label ? label.textContent : theme) + ')');
    }

    var stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch (error) {
      stored = null;
    }
    apply(stored || 'system');

    button.addEventListener('click', function () {
      var order = ['system', 'light', 'dark'];
      var current = document.documentElement.getAttribute('data-theme') || 'system';
      var next = order[(order.indexOf(current) + 1) % order.length];
      apply(next);
      try {
        if (next === 'system') localStorage.removeItem(THEME_KEY);
        else localStorage.setItem(THEME_KEY, next);
      } catch (error) {
        /* localStorage kann blockiert sein (file://, Privatmodus) — egal. */
      }
    });
  }

  /* -------------------------------------------------------------- Sortierung */

  function cellValue(row, columnIndex, type) {
    var cell = row.cells[columnIndex];
    if (!cell) return type === 'number' ? 0 : '';
    var raw = cell.getAttribute('data-sort-value');
    if (raw === null) raw = cell.textContent;
    raw = String(raw).trim();
    if (type === 'number') {
      var parsed = parseFloat(raw);
      return isNaN(parsed) ? -Infinity : parsed;
    }
    return raw.toLowerCase();
  }

  function initSortableTable(table) {
    var body = table.tBodies[0];
    if (!body) return;
    var headers = table.querySelectorAll('th.sortable');

    Array.prototype.forEach.call(headers, function (header, index) {
      header.setAttribute('tabindex', '0');
      header.setAttribute('role', 'columnheader');

      function sort() {
        var columnIndex = parseInt(header.getAttribute('data-column'), 10);
        if (isNaN(columnIndex)) columnIndex = index;
        var type = header.getAttribute('data-sort-type') || 'text';
        var current = header.getAttribute('aria-sort');
        var direction = current === 'ascending' ? -1 : 1;

        Array.prototype.forEach.call(headers, function (other) {
          other.removeAttribute('aria-sort');
        });
        header.setAttribute('aria-sort', direction === 1 ? 'ascending' : 'descending');

        var rows = Array.prototype.slice.call(body.rows).filter(function (row) {
          return !row.classList.contains('empty-row');
        });

        rows.sort(function (a, b) {
          var left = cellValue(a, columnIndex, type);
          var right = cellValue(b, columnIndex, type);
          if (left < right) return -1 * direction;
          if (left > right) return 1 * direction;
          return 0;
        });

        var fragment = document.createDocumentFragment();
        rows.forEach(function (row) {
          fragment.appendChild(row);
        });
        body.appendChild(fragment);
      }

      header.addEventListener('click', sort);
      header.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          sort();
        }
      });
    });
  }

  /* ------------------------------------------------------------------ Filter */

  function initFilters() {
    var table = document.getElementById('shots-table');
    var search = document.getElementById('search');
    var counter = document.getElementById('result-count');
    var chips = document.querySelectorAll('.chip[data-filter]');
    if (!table) return;

    var body = table.tBodies[0];
    if (!body) return;

    var emptyRow = document.getElementById('no-results');
    var state = 'all';

    function refresh() {
      var term = search ? search.value.trim().toLowerCase() : '';
      var visible = 0;
      var total = 0;

      Array.prototype.forEach.call(body.rows, function (row) {
        if (row.classList.contains('empty-row')) return;
        total += 1;
        var haystack = row.getAttribute('data-search') || row.textContent.toLowerCase();
        var matchesText = !term || haystack.indexOf(term) !== -1;
        var matchesState = state === 'all' || row.getAttribute('data-state') === state;
        var show = matchesText && matchesState;
        row.hidden = !show;
        if (show) visible += 1;
      });

      if (emptyRow) emptyRow.hidden = visible !== 0;
      if (counter) {
        counter.textContent = visible === total ? total + ' Einträge' : visible + ' von ' + total + ' Einträgen';
      }
    }

    if (search) {
      search.addEventListener('input', refresh);
      search.addEventListener('search', refresh);
    }

    Array.prototype.forEach.call(chips, function (chip) {
      chip.addEventListener('click', function () {
        state = chip.getAttribute('data-filter');
        Array.prototype.forEach.call(chips, function (other) {
          other.setAttribute('aria-pressed', String(other === chip));
        });
        refresh();
      });
    });

    refresh();
  }

  /* --------------------------------------------------------------- Lightbox */

  function initLightbox() {
    var box = document.getElementById('lightbox');
    if (!box) return;

    var image = box.querySelector('.lightbox__img');
    var title = box.querySelector('.lightbox__title');
    var subtitle = box.querySelector('.lightbox__sub');
    var counter = box.querySelector('.lightbox__counter');
    var openLink = box.querySelector('[data-lb="open"]');
    var prevButton = box.querySelector('[data-lb="prev"]');
    var nextButton = box.querySelector('[data-lb="next"]');
    var items = [];
    var current = -1;
    var lastFocus = null;

    function visibleLinks() {
      return Array.prototype.filter.call(document.querySelectorAll('a.shot-link'), function (link) {
        var row = link.closest('tr');
        return !row || !row.hidden;
      });
    }

    function show(index) {
      if (index < 0 || index >= items.length) return;
      current = index;
      var link = items[index];

      box.classList.remove('lightbox--zoom');
      image.src = link.getAttribute('href');
      image.alt = 'Screenshot von ' + (link.getAttribute('data-url') || '');
      if (title) title.textContent = link.getAttribute('data-title') || link.getAttribute('data-url') || '';
      if (subtitle) {
        subtitle.textContent = [link.getAttribute('data-url'), link.getAttribute('data-status'), link.getAttribute('data-time')]
          .filter(Boolean)
          .join('  ·  ');
      }
      if (counter) counter.textContent = index + 1 + ' / ' + items.length;
      if (openLink) openLink.href = link.getAttribute('href');
      if (prevButton) prevButton.disabled = index === 0;
      if (nextButton) nextButton.disabled = index === items.length - 1;
      box.querySelector('.lightbox__stage').scrollTop = 0;
    }

    function open(link) {
      items = visibleLinks();
      var index = items.indexOf(link);
      if (index === -1) {
        items = [link];
        index = 0;
      }
      lastFocus = document.activeElement;
      box.hidden = false;
      document.body.style.overflow = 'hidden';
      show(index);
      var closeButton = box.querySelector('[data-lb="close"]');
      if (closeButton) closeButton.focus();
    }

    function close() {
      box.hidden = true;
      box.classList.remove('lightbox--zoom');
      image.removeAttribute('src');
      document.body.style.overflow = '';
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    }

    document.addEventListener('click', function (event) {
      var link = event.target.closest ? event.target.closest('a.shot-link') : null;
      if (!link) return;
      event.preventDefault();
      open(link);
    });

    box.addEventListener('click', function (event) {
      var action = event.target.closest ? event.target.closest('[data-lb]') : null;
      var name = action ? action.getAttribute('data-lb') : null;

      if (name === 'close') close();
      else if (name === 'prev') show(current - 1);
      else if (name === 'next') show(current + 1);
      else if (name === 'image') box.classList.toggle('lightbox--zoom');
      else if (event.target === box || event.target.classList.contains('lightbox__stage')) close();
    });

    document.addEventListener('keydown', function (event) {
      if (box.hidden) return;
      if (event.key === 'Escape') close();
      else if (event.key === 'ArrowLeft') show(current - 1);
      else if (event.key === 'ArrowRight') show(current + 1);
    });
  }

  /* -------------------------------------------------------------------- Init */

  function init() {
    initTheme();
    Array.prototype.forEach.call(document.querySelectorAll('table[data-sortable]'), initSortableTable);
    initFilters();
    initLightbox();
    document.documentElement.classList.add('js-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
