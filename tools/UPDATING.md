# Updating for a new Palworld patch

This site's data comes from [tylercamp/palcalc](https://github.com/tylercamp/palcalc)
(MIT), a community project that reverse-engineers the game's own data files.
**We depend on that project having already updated for the new patch before
any of this is worth doing** — there's no way to get ahead of them, since we
don't parse the game's files ourselves. If a patch just shipped and palcalc's
`db.json`/`breeding.json` haven't moved yet, wait.

Once palcalc has updated:

## 1. Clear the cache — the step it's easy to forget

`tools/build_data.py` caches `db.json` and `breeding.json` in `tools/cache/`
and reuses them forever once present — re-running the script without
deleting these does **nothing**, silently:

```bash
rm tools/cache/db.json tools/cache/breeding.json
```

Leave `tools/cache/elements.json` and `assets/pals/*.webp` alone — those are
keyed per-Pal and already fetch-if-missing, so brand new Pals get pulled in
automatically without a full re-scrape of paldb.cc. Only delete a specific
Pal's icon/element cache entry if you have a specific reason to believe
*that Pal's* data changed (e.g. a reported wrong element) — full re-scrapes
are slow and paldb.cc rate-limits bursts.

## 2. Regenerate

```bash
py tools/build_data.py
```

Read the summary it prints at the end (pal count, passive count, breeding
table size, icons fetched) — sanity-check the numbers look plausible for
what the patch added before moving on.

## 3. Update the patch-specific numbers in `tests.html`

A handful of tests assert *exact counts for the current patch*, and will
correctly fail after a data refresh until updated to match:

Line numbers drift every time a test is added, so search for the assertion
rather than trusting the number if it doesn't land where you expect.

- `tests.html:40` — `assertEqual(ctx.pals.length, 299)`
- `tests.html:179` — `assertEqual(ctx.passives.length, 115, ...)`
- `tests.html:180` — `assertEqual(nonRandom.length, 30, ...)`
- `tests.html:190` — `assertEqual(reached.size, 202, ...)` (Melpaca + Lapiron
  reachability closure) — re-derive this the same way it was originally
  verified: an independent Python pass over the fresh `data/breeding.bin`
  (see the "Verified game mechanics" section of this project's build
  history for the method), not a guess.

Don't just search-and-replace with a hoped-for number — derive the real one
from the fresh data first, the same way each of these was originally pinned.

The breeding fixture tests (`Relaxaurus + Sparkit -> Relaxaurus Lux`, etc.)
and the Katress/Wixen gender-override tests are a different case: existing
breeding relationships essentially never get removed or changed by a patch,
so these should just keep passing as-is. If one of them fails, that's a
real signal worth investigating, not an expected update.

## 4. Check the hardcoded inheritance weights (rarely needed)

The 40/30/20/10 passive inheritance weights are hardcoded directly in
`js/probability.js:15-16` (`INHERIT_WEIGHTS`, `RANDOM_WEIGHTS`) rather than
read live from `data/meta.json` at runtime — a deliberate simplicity
tradeoff. `data/meta.json`'s `passiveInheritanceWeights` /
`passiveRandomWeights` fields **do** get refreshed by the pipeline, so
compare them against the hardcoded constants after a big patch. If Pocketpair
ever reworked this core formula (unlikely, but it's the one part of the math
that wouldn't auto-update), this is where you'd catch it.

## 5. Run the full suite and eyeball the site

Open `tests.html`, confirm everything passes. Then actually click through
the real UI once — add a Pal, run a search — before pushing. Automated
tests catch data-shape regressions; they don't catch "this new Pal's icon
is broken" or "the new passive tier looks wrong."

## 6. Commit and push

```bash
git add data/ assets/ tests.html js/probability.js
git commit -m "Update data for Palworld patch <version/date>"
git push origin main
```

GitHub Pages redeploys automatically within a minute or two.
