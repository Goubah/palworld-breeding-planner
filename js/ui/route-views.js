// The two ways a breeding route can be read.
//
//  - The family tree answers "what IS this plan": generations as columns,
//    your own Pals on the left, the target on the right.
//  - The numbered steps answer "what do I DO next": one pairing per line, in
//    an order you can actually follow.
//
// Both are driven entirely by js/ui/route-model.js, so they agree on
// structure by construction and only differ in presentation.
//
// Why not the old nested layout: at one or two generations it read fine, but
// every level below the first stacked vertically and restated its child with
// an "=", so a four-generation route became four levels of indentation, nine
// restatements and ten collapse toggles -- 1147px tall and still scrolling
// sideways. The indentation became the structure instead of the Pals.

import { getPals, passiveByInternal } from '../data.js';
import { renderPalIcon, passiveTierClass, attachTooltip } from './shared.js';
import { collectOwnedLeaves, countOwnedUses, desiredFirst, flattenSteps, layoutTree, leafStateKey } from './route-model.js';

// Tree geometry.
//
// Passives sit in a 2x2 grid rather than one row. A single row fitted about
// two and a half names before clipping -- measured against the real data, six
// nodes on a four-generation route lost text, including the final target
// losing part of "Eternal Engine". A grid holds all four, and four is always
// enough: an owned Pal can carry at most 4 passives, and a bred one shows at
// most popcount(mask) chips plus a single "+N unwanted", which the
// popcount(mask) + junk <= 4 invariant caps at 4 as well.
//
// NODE_W is therefore sized to fit two names side by side. Passive names
// measure 63px at the median and 93px at the 90th percentile, so ~100px per
// column covers all but the longest few, which ellipsis with the full name on
// hover. Odd chips out span both columns rather than wasting the empty cell.
const COL_W = 244, NODE_W = 216, NODE_H = 66, SUB_H = 13;
// One sub-label line per node, always reserved. Every note a node can carry
// (egg count, Reverser, interchangeable candidates) is merged onto that single
// line -- stacking them instead would force the row pitch up by 13px for every
// row, to serve the handful of nodes that need two.
const ROW_H = NODE_H + 12 + SUB_H;
const SVG_NS = 'http://www.w3.org/2000/svg';

function speciesOf(node) { return getPals()[node.species]; }
function genderMark(tag) { return tag === 'M' ? ' ♂' : tag === 'F' ? ' ♀' : ''; }

function passiveChip(text, className, tooltip) {
  const el = document.createElement('span');
  el.className = 'passive-chip-sm ' + className;
  el.textContent = text;
  if (tooltip) attachTooltip(el, tooltip);
  return el;
}

/** The roster entry a solver leaf refers to. See the ownedRefs note in results.js. */
function entryFor(node, ownedEntries) {
  return node.ownedRefs && node.ownedRefs.length ? ownedEntries[node.ownedRefs[0]] : null;
}

/**
 * An owned Pal's real passives, desired ones first and coloured by rank; the
 * rest muted. Every passive is shown -- a roster entry carries at most four
 * (store.js caps it), which is exactly what the tree's 2x2 grid holds, and
 * hiding any of them behind a "+N" defeats the point of listing them: telling
 * you which of several same-species Pals to actually grab.
 */
function ownedPassiveChips(entry, desiredNames) {
  const chips = [];
  if (!entry) return chips;
  const ordered = desiredFirst(entry.passiveInternalNames, desiredNames);
  if (ordered.length === 0) {
    chips.push(passiveChip('no passives', 'none'));
    return chips;
  }
  for (const internalName of ordered) {
    const info = passiveByInternal(internalName);
    chips.push(passiveChip(
      info ? info.name : internalName,
      desiredNames.includes(internalName) ? passiveTierClass(info ? info.rank : 0) : 'junk',
      info ? info.description : '',
    ));
  }
  return chips;
}

/**
 * A bred Pal's passives. Only the desired ones can be named: junk identity is
 * never tracked by the solver (see probability.js), so which extra passives
 * tag along is genuinely unknown -- only how many.
 */
function bredPassiveChips(node, desiredPassives) {
  const chips = [];
  for (let bit = 0; bit < desiredPassives.length; bit++) {
    if (!(node.mask & (1 << bit))) continue;
    const p = desiredPassives[bit];
    chips.push(passiveChip(p.name, passiveTierClass(p.rank), p.description));
  }
  if (node.junk > 0) {
    chips.push(passiveChip(`+${node.junk} unwanted`, 'junk',
      'Extra passives that tag along. Which ones you get is random, so only the count is known.'));
  }
  if (!node.mask && !node.junk) chips.push(passiveChip('no passives', 'none'));
  return chips;
}

/* ------------------------------------------------------------------ tree */

export function renderRouteTree(route, { desiredPassives, ownedEntries }) {
  const desiredNames = desiredPassives.map(p => p.internalName);
  const { nodes, columns, rows } = layoutTree(route);
  const uses = countOwnedUses(route);

  const width = columns * COL_W - (COL_W - NODE_W) + 8;
  const height = rows * ROW_H + 24;

  const scroll = document.createElement('div');
  scroll.className = 'route-tree-scroll';
  const canvas = document.createElement('div');
  canvas.className = 'route-tree';
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  const x = rec => rec.col * COL_W;
  const y = rec => rec.row * ROW_H + 12;
  const centreY = rec => y(rec) + NODE_H / 2;

  // Connectors first so nodes paint over them.
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('aria-hidden', 'true');
  for (const rec of nodes) {
    for (const kid of rec.kids) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d',
        `M ${x(kid) + NODE_W} ${centreY(kid)} H ${x(rec) - 18} V ${centreY(rec)} H ${x(rec)}`);
      path.setAttribute('class', 'route-tree-link');
      svg.appendChild(path);
    }
  }
  canvas.appendChild(svg);

  for (const rec of nodes) {
    const node = rec.node;
    const isTarget = rec.col === columns - 1;
    const box = document.createElement('div');
    box.className = 'route-tree-node ' + node.type + (isTarget ? ' target' : '');
    box.style.left = x(rec) + 'px';
    box.style.top = y(rec) + 'px';
    box.style.width = NODE_W + 'px';
    box.style.height = NODE_H + 'px';

    const line1 = document.createElement('div');
    line1.className = 'route-tree-line1';
    line1.appendChild(renderPalIcon(speciesOf(node), 22));
    const label = document.createElement('span');
    label.className = 'route-node-label';
    label.textContent = speciesOf(node).name + (node.type === 'owned' ? genderMark(node.genderTag) : '');
    line1.appendChild(label);

    // A Pal used in several pairings is one Pal, not several -- see
    // countOwnedUses. Without saying so the tree implies you need copies.
    const useCount = node.type === 'owned' ? uses.get(leafStateKey(node)) : 1;
    if (useCount > 1) {
      const badge = document.createElement('span');
      badge.className = 'route-reuse-badge';
      badge.textContent = `↺${useCount}`;
      attachTooltip(badge, `The same Pal is used in ${useCount} different pairings. Breeding never consumes a parent, so you only need one.`);
      line1.appendChild(badge);
    }
    box.appendChild(line1);

    const line2 = document.createElement('div');
    line2.className = 'route-tree-line2';
    const chips = node.type === 'owned'
      ? ownedPassiveChips(entryFor(node, ownedEntries), desiredNames)
      : bredPassiveChips(node, desiredPassives);
    // An odd chip out takes the full width instead of leaving the neighbouring
    // cell empty -- otherwise a Pal with one long passive gets truncated to
    // half the node while the other half sits unused.
    if (chips.length % 2 === 1) chips[chips.length - 1].classList.add('span2');
    for (const chip of chips) line2.appendChild(chip);
    box.appendChild(line2);
    canvas.appendChild(box);

    // Notes, merged onto one line under the node. See ROW_H.
    const notes = [], tooltips = [];
    if (node.type === 'bred') notes.push(`~${node.attempts.toFixed(0)} eggs`);
    if (node.needsReversal) {
      notes.push('⇄ needs a Pal Reverser');
      tooltips.push('This pairing needs this Pal\'s gender flipped before it will work.');
    }
    // Several roster Pals can fit one leaf. They are interchangeable to the
    // solver, so say "use any" rather than arbitrarily naming one.
    if (node.type === 'owned' && node.ownedRefs.length > 1) {
      notes.push(`${node.ownedRefs.length} of yours fit`);
      const alternatives = node.ownedRefs.map((ref, i) => {
        const entry = ownedEntries[ref];
        const names = entry
          ? desiredFirst(entry.passiveInternalNames, desiredNames)
              .map(n => (passiveByInternal(n) || { name: n }).name).join(', ')
          : '';
        return `${i + 1}. ${names || 'no passives'}`;
      });
      tooltips.push('Any of these works. They are interchangeable here:\n' + alternatives.join('\n'));
    }
    if (notes.length) {
      const sub = document.createElement('div');
      sub.className = 'route-tree-sub'
        + (node.needsReversal ? ' reverser' : '')
        + (node.type === 'owned' && node.ownedRefs.length > 1 ? ' choice' : '');
      sub.style.left = x(rec) + 'px';
      sub.style.top = (y(rec) + NODE_H + 1) + 'px';
      sub.style.maxWidth = NODE_W + 'px';
      sub.textContent = notes.join(' · ');
      if (tooltips.length) attachTooltip(sub, tooltips.join('\n\n'));
      canvas.appendChild(sub);
    }
  }

  scroll.appendChild(canvas);
  return scroll;
}

/* ------------------------------------------------------------------ steps */

export function renderRouteSteps(route, { desiredPassives, ownedEntries }) {
  const desiredNames = desiredPassives.map(p => p.internalName);
  const steps = flattenSteps(route);
  const uses = countOwnedUses(route);

  const list = document.createElement('ol');
  list.className = 'route-steps';
  // Safari/VoiceOver drops list semantics from a list styled list-style:none,
  // which would cost a screen-reader user the "10 items" count and the step
  // numbering -- the two things this view is for. Restating the role keeps it.
  list.setAttribute('role', 'list');

  steps.forEach((step, index) => {
    const item = document.createElement('li');
    item.className = 'route-step' + (index === steps.length - 1 ? ' final' : '');

    const number = document.createElement('div');
    number.className = 'route-step-num';
    number.textContent = String(step.stepNumber);
    item.appendChild(number);

    const body = document.createElement('div');
    body.className = 'route-step-body';

    const equation = document.createElement('div');
    equation.className = 'route-step-eq';
    equation.appendChild(renderOperand(step.node.parentA, step.aStep, { desiredNames, desiredPassives, ownedEntries, uses }));
    equation.appendChild(connector('+'));
    equation.appendChild(renderOperand(step.node.parentB, step.bStep, { desiredNames, desiredPassives, ownedEntries, uses }));
    equation.appendChild(connector('→'));
    equation.appendChild(renderOperand(step.node, null, { desiredNames, desiredPassives, ownedEntries, uses }));
    body.appendChild(equation);

    const cost = document.createElement('div');
    cost.className = 'route-step-cost';
    const pct = step.node.p * 100;
    cost.textContent = `${pct >= 0.1 ? pct.toFixed(1) : pct.toExponential(1)}% chance per egg, about ${step.node.attempts.toFixed(0)} eggs expected`;
    body.appendChild(cost);

    // A step producing none of the desired passives looks like wasted work.
    // It is not: it reaches a species the route needs, and it dilutes unwanted
    // passives out of the pool before a later pairing. On a real route that
    // second job has been worth several hours.
    //
    // The wording covers both jobs on purpose. Claiming dilution alone would
    // be wrong for the steps that are mainly a species stepping stone.
    if (step.node.mask === 0) {
      const why = document.createElement('div');
      why.className = 'route-step-why';
      why.textContent = 'Carries none of the passives you picked. That is deliberate: it gets you to the right species and dilutes unwanted passives, so a later pairing needs far fewer eggs.';
      body.appendChild(why);
    }

    item.appendChild(body);
    list.appendChild(item);
  });

  return list;
}

function connector(symbol) {
  const el = document.createElement('span');
  el.className = 'route-step-connector';
  el.textContent = symbol;
  return el;
}

/**
 * One Pal in a step's equation, laid out as a small block: name on top,
 * passives in a 2x2 grid beneath it, then any notes.
 *
 * Same grid as the tree, and for the same reason -- names run to 135px at
 * worst, so a single row of them either clips or forces the three operands of
 * an equation to wrap unpredictably. Stacking them keeps each operand a
 * predictable width and makes the two views read identically.
 */
function renderOperand(node, fromStep, { desiredNames, desiredPassives, ownedEntries, uses }) {
  const el = document.createElement('span');
  el.className = 'route-step-operand'
    // Dashed means "a Pal you already have", matching the tree. Worth keeping
    // consistent across the two views: it used to mark from-step operands
    // here and owned ones there, which are close to opposite meanings.
    + (node.type === 'owned' ? ' owned' : '')
    + (fromStep ? ' from-step' : '');

  // Provenance goes ABOVE the Pal rather than trailing its name, so the eye
  // hits "where does this come from" before "what is it", and so the name
  // line stays the same shape as every other operand's.
  if (fromStep) {
    const from = document.createElement('span');
    from.className = 'route-step-operand-from';
    from.textContent = `From step ${fromStep}`;
    el.appendChild(from);
  }

  const head = document.createElement('span');
  head.className = 'route-step-operand-head';
  if (node.needsReversal) head.appendChild(renderReverserBadge());
  head.appendChild(renderPalIcon(speciesOf(node), 20));
  const label = document.createElement('span');
  label.className = 'route-node-label';
  label.textContent = speciesOf(node).name + (fromStep ? '' : genderMark(node.genderTag));
  head.appendChild(label);
  el.appendChild(head);

  // Every operand shows its passives, including the ones carried over from an
  // earlier step. Making the reader scroll back to step 5 to recall what it
  // produced is the kind of cross-referencing this view exists to remove.
  const chips = node.type === 'owned'
    ? ownedPassiveChips(entryFor(node, ownedEntries), desiredNames)
    : bredPassiveChips(node, desiredPassives);
  if (chips.length) {
    if (chips.length % 2 === 1) chips[chips.length - 1].classList.add('span2');
    const grid = document.createElement('span');
    grid.className = 'route-step-operand-passives';
    for (const chip of chips) grid.appendChild(chip);
    el.appendChild(grid);
  }

  const notes = [], tooltips = [];
  if (node.needsReversal) {
    notes.push('⇄ needs a Pal Reverser');
    tooltips.push('This pairing needs this Pal\'s gender flipped before it will work.');
  }
  if (node.type === 'owned') {
    const useCount = uses.get(leafStateKey(node));
    if (useCount > 1) {
      notes.push(`↺ same Pal, ${useCount} steps`);
      tooltips.push('Breeding never consumes a parent, so one of these covers every step it appears in.');
    }
    if (node.ownedRefs.length > 1) {
      notes.push(`${node.ownedRefs.length} of yours fit`);
      const alternatives = node.ownedRefs.map((ref, i) => {
        const entry = ownedEntries[ref];
        const names = entry
          ? desiredFirst(entry.passiveInternalNames, desiredNames)
              .map(n => (passiveByInternal(n) || { name: n }).name).join(', ')
          : '';
        return `${i + 1}. ${names || 'no passives'}`;
      });
      tooltips.push('Any of these works. They are interchangeable here:\n' + alternatives.join('\n'));
    }
  }
  if (notes.length) {
    const note = document.createElement('span');
    note.className = 'route-step-operand-note' + (node.needsReversal ? ' reverser' : '');
    note.textContent = notes.join(' · ');
    if (tooltips.length) attachTooltip(note, tooltips.join('\n\n'));
    el.appendChild(note);
  }
  return el;
}

/**
 * Shown when a pairing only works by using a Pal Reverser on this Pal -- e.g.
 * you own two males of a species and one must be flipped. Purely visual: the
 * same fact is stated in words alongside, which is what screen readers and
 * touch users (who get no hover tooltip) should receive.
 */
function renderReverserBadge() {
  const badge = document.createElement('span');
  badge.className = 'reverser-badge';
  badge.textContent = '⇄';
  badge.setAttribute('aria-hidden', 'true');
  attachTooltip(badge, 'Needs a Pal Reverser: this Pal must have its gender flipped before it can be paired this way.');
  return badge;
}
