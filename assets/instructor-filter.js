/*
 * instructor-filter
 *
 * Client-side filtering for the instructor roster. Every card is already in
 * the DOM -- at 73 entries the whole roster is one server render -- so
 * filtering is a class toggle, not a fetch. No URL change, no reload.
 *
 * WHY NOT DAWN'S facets.js
 * That drives collection filtering through URL params and a server round
 * trip, because a collection can hold thousands of products that were never
 * all sent to the browser. Neither condition holds here.
 *
 * THE LIMIT THIS INHERITS
 * It filters what is RENDERED. The section paginates at 250, so if the roster
 * ever exceeds one page these controls would silently filter the current page
 * only -- a real trap, since the UI would look like it searched everything.
 * The section renders a warning in that case. Above 250 instructors this needs
 * to become a server-side filter.
 *
 * Progressive enhancement: the toolbar is marked no-js-hidden, so with JS off
 * the full roster renders and nothing broken is visible.
 */

const SEPARATORS = /[,，;；|｜丨/／、\n\r]/;
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

const tokenize = (text) =>
  (text || '')
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .split(SEPARATORS)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

const keyOf = (value) => value.toLowerCase();

class InstructorFilter extends HTMLElement {
  connectedCallback() {
    this.cards = Array.from(this.querySelectorAll('[data-instructor-card]')).map((el) => ({
      el,
      name: (el.dataset.name || '').toLowerCase(),
      facets: {
        1: new Set(tokenize(el.dataset.facet1).map(keyOf)),
        2: new Set(tokenize(el.dataset.facet2).map(keyOf)),
      },
    }));
    this.querySelectorAll('[data-instructor-card] .club-faces__cert, [data-instructor-card] .club-faces__loc').forEach(
      (el) => {
        el.textContent = tokenize(el.textContent).join(' | ');
      }
    );
    this.search = this.querySelector('[data-instructor-search]');
    this.countEl = this.querySelector('[data-instructor-count]');
    this.emptyEl = this.querySelector('[data-instructor-empty]');
    this.clearEl = this.querySelector('[data-instructor-clear]');

    this.query = '';
    this.active = { 1: new Set(), 2: new Set() };
    this.chips = [];

    this.querySelectorAll('fieldset[data-facet-group]').forEach((fieldset) => {
      this.buildChips(fieldset, fieldset.dataset.facetGroup);
    });

    if (this.search) {
      this.search.addEventListener('input', (e) => {
        this.query = e.target.value.trim().toLowerCase();
        this.apply();
      });
      this.search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') e.preventDefault();
      });
    }

    if (this.clearEl) {
      this.clearEl.addEventListener('click', () => this.clear());
    }

    this.apply();
  }

  buildChips(fieldset, group) {
    const labels = new Map();
    this.cards.forEach((card) => {
      tokenize(card.el.dataset['facet' + group]).forEach((value) => {
        const key = keyOf(value);
        if (!labels.has(key)) labels.set(key, value);
      });
    });
    if (labels.size === 0) return;

    const sorted = Array.from(labels.entries()).sort((a, b) =>
      a[1].localeCompare(b[1], undefined, { numeric: true, sensitivity: 'base' })
    );

    sorted.forEach(([key, label]) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'club-filter__chip';
      chip.setAttribute('aria-pressed', 'false');
      chip.textContent = label;
      chip.addEventListener('click', () => {
        const set = this.active[group];
        const pressed = !set.has(key);
        if (pressed) set.add(key);
        else set.delete(key);
        chip.setAttribute('aria-pressed', String(pressed));
        this.apply();
      });
      fieldset.appendChild(chip);
      this.chips.push(chip);
    });
    fieldset.hidden = false;
  }

  clear() {
    this.query = '';
    if (this.search) this.search.value = '';
    this.active[1].clear();
    this.active[2].clear();
    this.chips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
    this.apply();
  }

  matches(card) {
    if (this.query && !card.name.includes(this.query)) return false;
    for (const group of [1, 2]) {
      const selected = this.active[group];
      if (selected.size === 0) continue;
      let hit = false;
      for (const key of selected) {
        if (card.facets[group].has(key)) {
          hit = true;
          break;
        }
      }
      if (!hit) return false;
    }
    return true;
  }

  apply() {
    let shown = 0;
    this.cards.forEach((card) => {
      const ok = this.matches(card);
      card.el.hidden = !ok;
      if (ok) shown += 1;
    });

    if (this.countEl) {
      const tpl = this.countEl.dataset.template || '';
      this.countEl.textContent = tpl.replace('[shown]', shown).replace('[total]', this.cards.length);
    }
    if (this.emptyEl) this.emptyEl.hidden = shown !== 0;

    const filtering = this.query !== '' || this.active[1].size > 0 || this.active[2].size > 0;
    if (this.clearEl) this.clearEl.hidden = !filtering;
  }
}

customElements.define('instructor-filter', InstructorFilter);
