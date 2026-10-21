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

const SEPARATORS = /[,，;；|｜丨/／、·•・\n\r]/;
const SEGMENT_SEPARATORS = /[;；|｜丨·•・\n\r]/;
const LIST_SEPARATORS = /[,，、/／]/;
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;
const DISCIPLINE_PREFIX = /^([^:：]{1,24})[:：](.*)$/;
const TYPE_ALIASES = {
  ski: ['ski', 'skiing', 'skier', '双板', '雙板'],
  snowboard: ['snowboard', 'snowboarding', 'snowboarder', '单板', '單板'],
};

const clean = (text) => (text || '').normalize('NFKC').replace(INVISIBLE, '');
const tidy = (part) => part.replace(/\s+/g, ' ').trim();
const keyOf = (value) => value.toLowerCase();
const normalizeName = (text) => tidy(clean(text)).toLowerCase();
const compact = (text) => text.replace(/\s+/g, '');
const HAN = /\p{Script=Han}/u;
const PINYIN_READINGS = ['off', 'head'];
const PARTIAL_LEVEL = /^(csia|casi) level ([2-4]) (?:partial|teach|teaching|riding|ski|skiing)$/;
const levelBelowPartial = (key) => {
  const match = key.match(PARTIAL_LEVEL);
  return match ? `${match[1]} level ${Number(match[2]) - 1}` : null;
};

const readCache = (key) => {
  try {
    return JSON.parse(sessionStorage.getItem(key));
  } catch (e) {
    return null;
  }
};

const writeCache = (key, value) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
};

const splitPlain = (text, separators = SEPARATORS) => clean(text).split(separators).map(tidy).filter(Boolean);

const splitCertifications = (text) => {
  const tokens = [];
  clean(text)
    .split(SEGMENT_SEPARATORS)
    .forEach((segment) => {
      const match = tidy(segment).match(DISCIPLINE_PREFIX);
      const discipline = match ? tidy(match[1]) : '';
      const rest = match ? match[2] : segment;
      rest
        .split(LIST_SEPARATORS)
        .map(tidy)
        .filter(Boolean)
        .forEach((part) => {
          tokens.push(discipline && /^trainer\b/i.test(part) ? `${discipline} ${part}` : part);
        });
    });
  return tokens;
};

class InstructorFilter extends HTMLElement {
  connectedCallback() {
    this.valueLabels = this.readValueLabels();
    this.groups = Array.from(this.querySelectorAll('fieldset[data-facet-group]')).map((fieldset) => ({
      name: fieldset.dataset.facetGroup,
      fieldset,
      active: new Set(),
    }));

    this.cards = Array.from(this.querySelectorAll('[data-instructor-card]')).map((el) => {
      const facets = {};
      this.groups.forEach(({ name }) => {
        facets[name] = new Set(this.facetKeys(el.getAttribute(`data-facet-${name.replace(/_/g, '-')}`), name));
      });
      const minAge = parseInt(el.dataset.minAge, 10);
      return {
        el,
        handle: el.dataset.handle || '',
        names: [normalizeName(el.dataset.name)].filter(Boolean),
        pinyin: [],
        initials: [],
        facets,
        minAge: Number.isNaN(minAge) ? null : minAge,
      };
    });

    this.tidyCardText();

    this.search = this.querySelector('[data-instructor-search]');
    this.countEl = this.querySelector('[data-instructor-count]');
    this.emptyEl = this.querySelector('[data-instructor-empty]');
    this.clearEl = this.querySelector('[data-instructor-clear]');
    this.query = '';
    this.age = null;
    this.chips = [];

    this.groups.forEach((group) => this.buildChips(group));
    this.buildAgeFilter();

    if (this.search) {
      this.search.addEventListener('focus', () => this.loadSearchTerms(), { once: true });
      this.search.addEventListener('input', (e) => {
        this.loadSearchTerms();
        this.query = normalizeName(e.target.value);
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

  loadSearchTerms() {
    if (this.searchTermsRequested) return;
    this.searchTermsRequested = true;
    this.loadOtherLocaleNames();
    this.loadPinyin();
  }

  loadOtherLocaleNames() {
    const sectionId = this.dataset.sectionId;
    if (!sectionId) return;
    (this.dataset.alternateRoots || '')
      .split(/\s+/)
      .filter(Boolean)
      .forEach((root) => {
        this.fetchNames(this.alternateUrl(root, sectionId))
          .then((names) => this.addNames(names))
          .catch(() => {});
      });
  }

  alternateUrl(root, sectionId) {
    const currentRoot = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
    const { pathname, search, origin } = window.location;
    const path = pathname.startsWith(currentRoot) ? pathname.slice(currentRoot.length) : pathname.replace(/^\//, '');
    const url = new URL(`${root.replace(/\/?$/, '/')}${path}${search}`, origin);
    url.searchParams.set('section_id', sectionId);
    return url;
  }

  fetchNames(url) {
    const key = `instructor-filter:names:${url.pathname}?section_id=${url.searchParams.get('section_id')}`;
    const cached = readCache(key);
    if (cached) return Promise.resolve(cached);
    return fetch(url.toString())
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((html) => {
        const names = {};
        new DOMParser()
          .parseFromString(html, 'text/html')
          .querySelectorAll('[data-instructor-card][data-handle]')
          .forEach((el) => {
            if (el.dataset.handle && el.dataset.name) names[el.dataset.handle] = el.dataset.name;
          });
        if (Object.keys(names).length > 0) writeCache(key, names);
        return names;
      });
  }

  addNames(names) {
    this.cards.forEach((card) => {
      const name = card.handle && normalizeName(names[card.handle]);
      if (!name || card.names.includes(name)) return;
      card.names.push(name);
      this.indexPinyin(card);
    });
    if (this.query) this.apply();
  }

  loadPinyin() {
    const src = this.dataset.pinyinSrc;
    if (!src) return;
    const ready = () => {
      if (!window.pinyinPro) return;
      this.cards.forEach((card) => this.indexPinyin(card));
      if (this.query) this.apply();
    };
    if (window.pinyinPro) {
      ready();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.addEventListener('load', ready);
    document.head.appendChild(script);
  }

  indexPinyin(card) {
    if (!window.pinyinPro) return;
    const full = new Set();
    const initials = new Set();
    card.names
      .filter((name) => HAN.test(name))
      .forEach((name) => {
        PINYIN_READINGS.forEach((surname) => {
          const syllables = window.pinyinPro.pinyin(name, {
            toneType: 'none',
            type: 'array',
            nonZh: 'removed',
            surname,
          });
          const joined = syllables.join('').toLowerCase();
          full.add(joined.replace(/ü/g, 'v'));
          full.add(joined.replace(/ü/g, 'u'));
          initials.add(syllables.map((syllable) => syllable.charAt(0)).join('').toLowerCase());
        });
      });
    card.pinyin = Array.from(full);
    card.initials = Array.from(initials);
  }

  matchesName(card) {
    const query = compact(this.query);
    return (
      card.names.some((name) => name.includes(this.query) || compact(name).includes(query)) ||
      card.pinyin.some((term) => term.includes(query)) ||
      card.initials.some((term) => term.startsWith(query))
    );
  }

  readValueLabels() {
    try {
      return JSON.parse(this.dataset.valueLabels || '{}');
    } catch (e) {
      return {};
    }
  }

  translateType(value) {
    const key = keyOf(value);
    const canonical = Object.keys(TYPE_ALIASES).find((name) => TYPE_ALIASES[name].includes(key));
    return canonical && this.valueLabels[canonical] ? this.valueLabels[canonical] : value;
  }

  tokenize(text, field) {
    if (field === 'certification') return splitCertifications(text);
    if (field === 'type') {
      return splitPlain(text, /[,，;；|｜丨/／、·•・&＆\n\r]/).map((value) => this.translateType(value));
    }
    return splitPlain(text);
  }

  facetKeys(text, field) {
    const keys = this.tokenize(text, field).map(keyOf);
    if (field !== 'certification') return keys;
    return keys.concat(keys.map(levelBelowPartial).filter(Boolean));
  }

  tidyCardText() {
    const metaField = this.dataset.cardMetaField || 'type';
    this.cards.forEach(({ el }) => {
      const cert = el.querySelector('.club-faces__cert');
      const meta = el.querySelector('.club-faces__loc');
      if (cert) cert.textContent = this.tokenize(cert.textContent, 'certification').join(' | ');
      if (meta) meta.textContent = this.tokenize(meta.textContent, metaField).join(' | ');
    });
  }

  buildChips(group) {
    const labels = new Map();
    this.cards.forEach((card) => {
      this.tokenize(card.el.getAttribute(`data-facet-${group.name.replace(/_/g, '-')}`), group.name).forEach((value) => {
        const key = keyOf(value);
        if (!labels.has(key)) labels.set(key, value);
      });
    });
    if (labels.size === 0) return;

    Array.from(labels.entries())
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true, sensitivity: 'base' }))
      .forEach(([key, label]) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'club-filter__chip';
        chip.setAttribute('aria-pressed', 'false');
        chip.textContent = label;
        chip.addEventListener('click', () => {
          const pressed = !group.active.has(key);
          if (pressed) group.active.add(key);
          else group.active.delete(key);
          chip.setAttribute('aria-pressed', String(pressed));
          this.apply();
        });
        group.fieldset.appendChild(chip);
        this.chips.push(chip);
      });
    group.fieldset.hidden = false;
  }

  buildAgeFilter() {
    const wrapper = this.querySelector('[data-age-filter]');
    if (!wrapper) return;
    const ages = this.cards.map((card) => card.minAge).filter((age) => age !== null);
    if (ages.length === 0) return;

    this.ageSelect = wrapper.querySelector('select');
    const template = this.ageSelect.dataset.optionTemplate || '[age]';
    const any = document.createElement('option');
    any.value = '';
    any.textContent = this.ageSelect.dataset.anyLabel || '';
    this.ageSelect.appendChild(any);
    for (let age = Math.min(...ages); age <= 18; age += 1) {
      const option = document.createElement('option');
      option.value = String(age);
      option.textContent = template.replace('[age]', age);
      this.ageSelect.appendChild(option);
    }
    this.ageSelect.addEventListener('change', () => {
      this.age = this.ageSelect.value === '' ? null : parseInt(this.ageSelect.value, 10);
      this.apply();
    });
    wrapper.hidden = false;
  }

  clear() {
    this.query = '';
    if (this.search) this.search.value = '';
    this.age = null;
    if (this.ageSelect) this.ageSelect.value = '';
    this.groups.forEach((group) => group.active.clear());
    this.chips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
    this.apply();
  }

  matches(card) {
    if (this.query && !this.matchesName(card)) return false;
    if (this.age !== null && card.minAge !== null && card.minAge > this.age) return false;
    return this.groups.every(({ name, active }) => {
      if (active.size === 0) return true;
      for (const key of active) {
        if (card.facets[name].has(key)) return true;
      }
      return false;
    });
  }

  isFiltering() {
    return this.query !== '' || this.age !== null || this.groups.some((group) => group.active.size > 0);
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
    if (this.clearEl) this.clearEl.hidden = !this.isFiltering();
  }
}

customElements.define('instructor-filter', InstructorFilter);
