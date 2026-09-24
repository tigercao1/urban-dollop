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

class InstructorFilter extends HTMLElement {
  connectedCallback() {
    this.cards = Array.from(this.querySelectorAll('[data-instructor-card]'));
    this.search = this.querySelector('[data-instructor-search]');
    this.chips = Array.from(this.querySelectorAll('[data-facet-value]'));
    this.countEl = this.querySelector('[data-instructor-count]');
    this.emptyEl = this.querySelector('[data-instructor-empty]');
    this.clearEl = this.querySelector('[data-instructor-clear]');

    this.query = '';
    // One Set per facet group. Multi-select WITHIN a group is OR
    // ("CASI 2 or CSIA 1"), across groups it is AND.
    this.active = { 1: new Set(), 2: new Set() };

    if (this.search) {
      this.search.addEventListener('input', (e) => {
        this.query = e.target.value.trim().toLowerCase();
        this.apply();
      });
      // Enter in a lone text input would submit an enclosing form and reload.
      this.search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') e.preventDefault();
      });
    }

    this.chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const group = chip.dataset.facetGroup;
        const value = chip.dataset.facetValue;
        const set = this.active[group];
        if (set.has(value)) {
          set.delete(value);
          chip.setAttribute('aria-pressed', 'false');
        } else {
          set.add(value);
          chip.setAttribute('aria-pressed', 'true');
        }
        this.apply();
      });
    });

    if (this.clearEl) {
      this.clearEl.addEventListener('click', () => this.clear());
    }

    this.apply();
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
    if (this.query) {
      const name = (card.dataset.name || '').toLowerCase();
      if (!name.includes(this.query)) return false;
    }
    for (const group of [1, 2]) {
      const set = this.active[group];
      if (set.size === 0) continue;
      // Values are stored pipe-delimited and pipe-wrapped so a substring test
      // cannot match a partial token: "|CASI 1|" never matches "|CASI 10|".
      const haystack = card.dataset['facet' + group] || '';
      let hit = false;
      for (const v of set) {
        if (haystack.includes('|' + v + '|')) {
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
      card.hidden = !ok;
      if (ok) shown += 1;
    });

    if (this.countEl) {
      const tpl = this.countEl.dataset.template || '';
      this.countEl.textContent = tpl
        .replace('[shown]', shown)
        .replace('[total]', this.cards.length);
    }
    if (this.emptyEl) this.emptyEl.hidden = shown !== 0;

    const filtering = this.query !== '' || this.active[1].size > 0 || this.active[2].size > 0;
    if (this.clearEl) this.clearEl.hidden = !filtering;
  }
}

customElements.define('instructor-filter', InstructorFilter);
