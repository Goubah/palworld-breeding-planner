// Rendering helpers and picker factories shared across the roster, target,
// and results tabs. Pal artwork comes from assets/pals/<internalName>.webp
// (scraped once at build time, see tools/build_data.py); any Pal missing an
// icon (a handful of secret/boss variants the CDN 403'd on) falls back to an
// element-colored initials badge, so the UI degrades gracefully rather than
// showing a broken image.

import { getPals, getPassives } from '../data.js';
import { createSearchPicker } from './picker.js';

// A single shared custom tooltip, used instead of the native `title`
// attribute -- the browser's own title tooltip has a fixed ~1-2s show delay
// that CSS/JS can't shorten, which reads as sluggish for something meant to
// give a quick at-a-glance passive description. This shows in ~120ms and is
// styled to match the app's dark theme instead of the OS default tooltip box.
let _tooltipEl = null;
let _tooltipShowTimer = null;

function ensureTooltipEl() {
  if (_tooltipEl) return _tooltipEl;
  _tooltipEl = document.createElement('div');
  _tooltipEl.className = 'app-tooltip';
  _tooltipEl.hidden = true;
  document.body.appendChild(_tooltipEl);
  return _tooltipEl;
}

function positionTooltip(anchorRect) {
  const tip = ensureTooltipEl();
  const tipRect = tip.getBoundingClientRect();
  let left = anchorRect.left;
  let top = anchorRect.bottom + 6;
  if (left + tipRect.width > window.innerWidth - 8) left = window.innerWidth - tipRect.width - 8;
  if (top + tipRect.height > window.innerHeight - 8) top = anchorRect.top - tipRect.height - 6;
  tip.style.left = Math.max(8, left) + 'px';
  tip.style.top = Math.max(8, top) + 'px';
}

function showTooltip(anchorEl, text) {
  const tip = ensureTooltipEl();
  tip.textContent = text;
  tip.hidden = false;
  positionTooltip(anchorEl.getBoundingClientRect());
}

function hideTooltip() {
  clearTimeout(_tooltipShowTimer);
  if (_tooltipEl) _tooltipEl.hidden = true;
}

/**
 * "1 route" / "2 routes". Used instead of writing "route(s)" -- the counts
 * here are almost always concrete (a route count, a generation depth), so
 * there's no reason to make the reader do the agreement themselves.
 */
export function plural(n, singular, pluralForm = singular + 's') {
  return `${n.toLocaleString()} ${n === 1 ? singular : pluralForm}`;
}

/** Minutes as the coarsest unit that still reads precisely. */
export function formatEffort(minutes) {
  if (!isFinite(minutes)) return 'unknown';
  if (minutes < 60) return `~${minutes.toFixed(0)} min`;
  const hrs = minutes / 60;
  if (hrs < 48) return `~${hrs.toFixed(1)} hr`;
  return `~${(hrs / 24).toFixed(1)} days`;
}

/** Wires up a fast custom hover tooltip on `el`. No-op if `text` is falsy. */
export function attachTooltip(el, text) {
  if (!text) return;
  el.addEventListener('mouseenter', () => {
    clearTimeout(_tooltipShowTimer);
    _tooltipShowTimer = setTimeout(() => showTooltip(el, text), 120);
  });
  el.addEventListener('mouseleave', hideTooltip);
  el.addEventListener('mousedown', hideTooltip);
}

// Keys must match data/pals.json's actual element strings exactly (verified
// against the full dataset: Normal, Fire, Water, Leaf, Electricity, Ice,
// Earth, Dark, Dragon -- 9 distinct values, no others exist).
const ELEMENT_COLORS = {
  Normal: '#9e9e9e',
  Fire: '#e6553b',
  Water: '#3d9bdc',
  Leaf: '#4caf50',
  Electricity: '#f2c531',
  Ice: '#6fd0e0',
  Earth: '#b98a4d',
  Dark: '#8a63d2',
  Dragon: '#c0392b',
};

export function elementColor(el) {
  return ELEMENT_COLORS[el] || '#777';
}

export function renderPalIcon(pal, size = 32) {
  const wrap = document.createElement('span');
  wrap.className = 'pal-icon';
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';
  if (!pal) {
    wrap.classList.add('pal-icon-fallback');
    wrap.textContent = '?';
    return wrap;
  }
  const img = document.createElement('img');
  img.src = `assets/pals/${pal.internalName}.webp`;
  img.alt = pal.name;
  img.loading = 'lazy';
  img.addEventListener('error', () => {
    img.remove();
    wrap.classList.add('pal-icon-fallback');
    wrap.style.background = elementColor(pal.elements[0]);
    wrap.textContent = pal.name.slice(0, 2).toUpperCase();
  }, { once: true });
  wrap.appendChild(img);
  return wrap;
}

export function renderElementBadges(pal) {
  const wrap = document.createElement('span');
  wrap.className = 'element-badges';
  for (const el of pal.elements) {
    const badge = document.createElement('span');
    badge.className = 'element-badge';
    badge.style.background = elementColor(el);
    badge.textContent = el;
    wrap.appendChild(badge);
  }
  return wrap;
}

// In-game passive skills are grouped into ranked tiers, shown with distinct
// colored borders in the game's own UI. This maps our data's `rank` field
// (5 down to -3) onto that tier scheme.
//
// Rank 5 and rank 4 are mechanically distinct, not just two shades of the
// same tier: every rank-5 passive in the source data is tagged "World Tree
// exclusive" and pairs a bonus with a matching penalty (e.g. God of
// Destruction: Attack +40%/Defense +20% but Max Health -50%), while rank-4
// passives (Legend, Lucky, Swift, Workaholic, ...) are the community's
// "Rainbow" tier -- purely positive, no drawback. paldb.cc's stdtheme.css
// (an actively-maintained fan database built from the game's own UI assets)
// also gives rank 5 a more purple-leaning tint versus rank 4's cyan, which
// is the basis for splitting them into two colors here. Gold covers rank
// 2-3, neutral for rank 1, red flags the negative/debuff ranks. This is the
// best available reference, not a verified pixel-for-pixel match to your
// game client -- flag it if something looks off and it can be adjusted.
export function passiveTierClass(rank) {
  if (rank === 5) return 'tier-worldtree';
  if (rank === 4) return 'tier-rainbow';
  if (rank >= 2) return 'tier-gold';
  if (rank === 1) return 'tier-neutral';
  return 'tier-negative';
}

export function passiveTierLabel(rank) {
  if (rank === 5) return 'Tier 5 (World Tree)';
  if (rank === 4) return 'Tier 4 (Rainbow)';
  if (rank < 0) return `Tier ${rank} (Debuff)`;
  return `Tier ${rank}`;
}

export const PASSIVE_TIER_ORDER = [5, 4, 3, 2, 1, -1, -2, -3];

/**
 * The four mutation passives (Babysitter, Heavily Armored, Idiosyncratic,
 * Immortality) share a MutationPal_ prefix in the game's own data, which is
 * the only marker distinguishing them -- there is no separate flag.
 *
 * They are worth calling out because "parent-only" alone understates the
 * problem: it reads as "breed it from a parent that has it", but no amount of
 * breeding will produce the first one. Confirmed by testing that they DO
 * inherit once a parent carries one.
 */
export function isMutationPassive(passive) {
  return typeof passive.internalName === 'string'
    && passive.internalName.startsWith('MutationPal_');
}

export function renderPassiveChip(passive) {
  const chip = document.createElement('span');
  chip.className = 'passive-chip ' + passiveTierClass(passive.rank);
  chip.textContent = passive.name;
  attachTooltip(chip, passive.description);
  return chip;
}

/**
 * Paldeck order: by dex number, with a variant placed immediately after the
 * base form it shares a number with (the game shows those as 5 and 5B). The
 * eleven Terraria collab Pals carry dex numbers in the 10000s and so fall at
 * the end, which is where the Paldeck lists them too.
 *
 * Sorting is display-only. Nothing here is persisted, and the stored roster
 * references species by internalName, so ordering cannot affect saved data.
 */
export function paldeckOrder(a, b) {
  return a.dex - b.dex
    || (a.isVariant === b.isVariant ? 0 : (a.isVariant ? 1 : -1))
    || a.name.localeCompare(b.name);
}

export function createSpeciesPicker(onChange) {
  const pals = [...getPals()].sort(paldeckOrder);
  return createSearchPicker({
    items: pals,
    getId: p => p.internalName,
    getLabel: p => p.name,
    getSearchText: p => p.name + ' ' + p.elements.join(' '),
    renderRow: (row, pal) => {
      row.appendChild(renderPalIcon(pal, 24));
      const label = document.createElement('span');
      label.className = 'picker-row-label';
      label.textContent = pal.name;
      row.appendChild(label);
      row.appendChild(renderElementBadges(pal));
    },
    placeholder: 'Search Pal...',
    onChange,
  });
}

export function createPassivePicker(onChange, { isExcluded } = {}) {
  const passives = getPassives();
  const sorted = [...passives].sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name));
  return createSearchPicker({
    items: sorted,
    getId: p => p.internalName,
    getLabel: p => p.name,
    getSearchText: p => p.name,
    groupBy: p => p.rank,
    groupLabel: passiveTierLabel,
    groupOrder: PASSIVE_TIER_ORDER,
    maxResults: Infinity, // show every tier when browsing, not just the first N alphabetically/by-rank
    isExcluded,
    renderRow: (row, passive) => {
      row.appendChild(renderPassiveChip(passive));
      if (isMutationPassive(passive)) {
        const tag = document.createElement('span');
        tag.className = 'passive-tag passive-tag-mutation';
        tag.textContent = 'mutation';
        attachTooltip(tag, 'A mutation passive. It does pass down through breeding (confirmed in game), but some Pal has to have it first: breeding alone will never produce one.');
        row.appendChild(tag);
      }
      if (!passive.randomAllowed) {
        const tag = document.createElement('span');
        tag.className = 'passive-tag';
        tag.textContent = 'parent-only';
        attachTooltip(tag, 'Can never be randomly rolled. Must come from a parent.');
        row.appendChild(tag);
      }
    },
    placeholder: 'Search passive...',
    onChange,
  });
}
