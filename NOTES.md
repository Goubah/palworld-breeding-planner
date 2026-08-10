# Notes for working on this

Setup, testing and data regeneration are in the [README](README.md). This file
is the part that isn't obvious from reading the code: how it's laid out, the
mistakes that have already cost a debugging session, and the rules that keep the
numbers trustworthy.

These are working notes, not contribution guidelines. The repo has no licence
and isn't set up to take pull requests. It's published because the knowledge
below is worth keeping somewhere durable, and because anyone reading the code
will get further with it than without it.

## Rules that keep the numbers honest

**No invented numbers.** Every probability and cost in the solver traces to game
data or a measured observation. Anything that can't be sourced should be called
out as unsourced rather than shipped as a plausible-looking figure. The tool's
whole value is that its maths is real, and a single made-up constant undermines
all of it.

**Run the suite before every push.** Open `tests.html` through the server. No
test asserts a solver effort figure, so if a solver change breaks one, it has
broken behaviour rather than gone stale. The exception is the patch-specific
data counts listed in [tools/UPDATING.md](tools/UPDATING.md), which move only
when the game data is regenerated.

**Attribution stays.** Credit to [tylercamp/palcalc](https://github.com/tylercamp/palcalc)
(MIT) and [paldb.cc](https://paldb.cc/) belongs in both the README and the site
footer, and the disclaimer that this is an unofficial fan tool stays with it.

**`effort` is a sequential sum, and deliberately not a wall-clock estimate.** It
adds every step's cost, which models running the plan one pairing at a time. A
player with several breeding ranches can run independent branches at once, so
their real elapsed time is closer to the tree's critical path. Ranking by that
instead was measured against a real 293-Pal roster and rejected: no route the
solver produces can occupy more than **2** ranches at once, the ranking changed
on 1 of 13 targets (by 5.83 min, on a route needing a Pal Reverser), and the
saving is 0% on the many routes that are pure chains. The reason it barely
moves is that the final pairing dominates — on one route it is 64% of the
total, is shared by every variant, and cannot be parallelised. Switching
metrics is also not a matter of swapping the sum for a max: gender setup is
17-30% of a route's effort and is derived from a parent's *cumulative
sequential* effort, so it would have to be re-derived, and that is exactly the
monotonicity `pruneDominated` depends on (see below). Treat `effort` as what it
is: a comparison metric between routes, not a prediction of your evening.

## Layout

| path | role |
|---|---|
| `js/solver.js` | Beam search. Pure logic, no DOM. |
| `js/worker.js` | Wraps the solver in a Web Worker. Owns the escalating-beam retry loop and cancellation. |
| `js/probability.js` | Passive inheritance maths. |
| `js/breeding.js` | Parent pair to child lookup over `data/breeding.bin`. |
| `js/store.js` | Roster and settings persistence, plus import/export. |
| `js/ui/route-model.js` | Pure route analysis: tree layout, step order, Pal reuse, and which routes are worth showing. The one file under `js/ui/` with no DOM in it, and the only one under test. |
| `js/ui/route-views.js` | The two route renderers: family tree and numbered steps. |
| `js/ui/*.js` | Rendering only. |

`data/breeding.bin` is a `Uint16Array` holding one child index per unordered
pair, indexed `i*N - i*(i-1)/2 + (j-i)`.

Anything that needs to be under test belongs in `route-model.js` rather than a
renderer. That split is deliberate: it's what lets the display logic be verified
without a DOM.

## Things that have already caused bugs

Each of these cost a real debugging session. They're listed because none of them
are visible from reading the surrounding code.

### Solver

**Gender is a one-off setup cost, never per egg.** Once a male and a female are
paired, every egg they lay is usable. Multiplying gender into the child's
per-egg probability overcharges in proportion to how hard the step is, and hits
the final step hardest, which is the step that decides which route wins.
`pairGenderInfo` returns `{ p, reversalSide, setup }` where `p` is always 1 and
the cost lives in `setup`. The one deliberate exception is the Katress/Wixen
special pair, where the gender assignment selects the child species rather than
gating the pairing.

**Setup cost must stay monotone in effort.** `pruneDominated` discards a state
the moment another matches it at no greater effort, which is only sound because
a parent's setup cost rises with its effort. Break that and the solver silently
discards cheaper routes with nothing visible in the output. A sweep of over 200
parent and partner combinations in `tests.html` guards it, asserting that the
cheaper parent is never the more expensive one to line up.

**Don't delete solver states, mark them.** The pair that produced a state is
still in the frontier, so deleting causes it to be regenerated every round. That
churn measured four times slower. `pruneDominated` tombstones instead.

**Anything removed from the beam must keep its ancestors.** A surviving state's
parents are load-bearing for route reconstruction. Dropping them leaves a
dangling key that crashes `reconstructRoute`.

**A Reverser route and an item-free route are separate states on purpose.**
`dominates` refuses to let one collapse the other mid-search so the best of each
kind survives to be compared as finished plans. Deciding between them is the
UI's job, in `route-model.js`.

**`runSolver`'s `maleProbOf` option is a function, `(speciesIdx) => prob`, not
the raw `maleProbBySpecies` array.** `worker.js` is the only caller in the
shipped app and wraps the array into that closure before calling in; nothing
enforces the shape at the call site, so passing the array directly doesn't
fail until `pairGenderInfo` tries to call it, several frames deeper. Relevant
whenever `runSolver` is called directly (bypassing the worker), e.g. to build
a synthetic scenario in a test or a scratch script.

**Species reachability alone doesn't mean a route exists.** `checkPreflight`
used to treat "already own it" (`minGenerations === 0`) as always safe to
search from. It isn't: a self-bred-only species (`isSelfBredOnly` in
`breeding.js` — its only producing pair is itself) owned exactly once can
never get a second individual, so combining passives onto a fresh one is
impossible even though the species itself is trivially "reachable." Found via
a live search (Jetragon, one owned) that ran a real ~20s escalating search
before failing. `checkPreflight` now also returns `combiningImpossible` for
this exact shape and folds it into `blocked`; owning two is NOT this case,
since pairing them is a real route.

### Display

**`ownedRefs` index into the `ownedPals` array the solver was given, not into
`store.getRoster()`.** `runSearch` builds `ownedPals` and the parallel
`ownedEntries` in one pass for exactly this reason. Rebuilding the display list
separately shifts every index after any entry whose species fails to resolve,
and the route views then name the wrong Pal with total confidence. Measured with
three bad entries seeded into a 252-Pal roster: 11 of 11 leaves misidentified.

**Pal icon paths use `internalName`, never the display name.** Frostallion is
`IceHorse.webp`, Frostallion Noct is `IceHorse_Dark.webp`. Don't infer the file
from the display name and don't trust a plausible guess: `Kirin_Ice.webp` reads
like it ought to be the ice horse, but it belongs to Univolt Cryst. Look the
species up in `data/pals.json`.

**To check for clipped text, measure the element that actually clips.**
`overflow: hidden` sits on the individual chips (`.route-tree-line2
.passive-chip-sm` and `.route-step-operand-passives .passive-chip-sm`), not on
their containers, and the containers are grids with `minmax(0, 1fr)` tracks so
they never overflow either. A node box therefore reports
`scrollWidth === clientWidth` while the chips inside it are visibly cut.
Compare `scrollWidth` against `clientWidth` on each chip.

### Everything else

**`[hidden] { display: none !important; }` in `styles.css` must stay.** An
element toggled via the `hidden` attribute must never also carry an author rule
setting `display`. Browsers disagree when specificity ties, and this once broke
in Firefox only.

**`store.js` snapshots localStorage once, at module-eval time.** Any test
harness has to write its roster *before* the first `import` of `store.js`, or
anything that imports it. Writing localStorage afterwards changes nothing and
produces a test that silently proves nothing.

**Browsers cache ES modules hard.** Cache-busting the HTML does not cascade to
nested `import` statements, so an edit that is definitely on disk can behave as
though it never happened. Use a hard reload, or serve on a port that hasn't been
used yet in this session.

**A `<select>`'s option list and the code reading it can drift silently.**
`roster.js`'s sort dropdown offered "Recently added" (`value="added"`) for
who knows how long with no `else if (sortBy === 'added')` branch in
`renderList()` -- it just fell through and rendered unsorted, which happened
to look plausible rather than obviously broken. No error, no warning, just
the wrong order. Found by a full QA pass, not code review. When adding an
option to a `<select>` that drives a branch elsewhere, grep for every
existing branch on that value, not just add the option.

## Writing UI text

Em dashes are fine as a separator between a label and a value (`Route 1 — 1
generation`). Not as a rhetorical pause mid-sentence, where a comma or a full
stop belongs.

Prefer stating what the tool actually did over describing it in general terms. A
status line that says how many routes were found and how many candidates were
searched is more useful than one that says the search completed.

## Recording changes

Write down what was measured. This project has a habit of putting the numbers
behind a change into the commit message and the surrounding comments, so that
nobody has to re-derive them later. "A route got cheaper" is worth much less
than which target, on what roster, and by how much.
