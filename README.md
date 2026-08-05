# Palworld Breeding Route Planner

A Palworld breeding calculator that works backwards from the Pals you actually own — including the passive skills you want the child to inherit.

**→ [goubah.github.io/palworld-breeding-planner](https://goubah.github.io/palworld-breeding-planner/)**

## What makes it different

Most Palworld breeding calculators answer *"what do these two Pals make?"* or *"which pairs produce this Pal?"*. This one starts from the opposite end:

1. Enter the Pals you own — species, gender, and their passive skills.
2. Name a target Pal and up to four passive skills you want it to have.
3. Get ranked, multi-generation breeding routes that start **only from your roster**.

No assuming you can go catch a perfect parent. If a target genuinely isn't reachable from what you own, it says so up front instead of searching and returning nothing.

## Passive skills are part of the search, not an afterthought

Passive inheritance is modelled on the game's own numbers rather than estimated:

- A child draws passives from the **deduplicated union** of both parents' passives.
- It inherits `X ∈ {1,2,3,4}` of them at a **40/30/20/10** weighting.
- If fewer than 4 slots are filled, `Y ∈ {0,1,2,3}` random passives are added at the same weighting.
- **When all 4 slots are already filled, the random step is skipped entirely.**

That last rule is the one most easily got wrong, and it matters: it's why inheriting a specific set of 4 desired passives lands at **10%**, not 4%. The model reproduces the published rates exactly (40 / 24 / 12 / 10 for pools of size 1–4) and that's pinned by a test.

Every step of a route shows the real chance per egg, expected number of eggs, and a time estimate — so you can tell a one-hour plan from a twenty-hour one before committing.

## Other things it accounts for

- **Gender ratios.** Breeding needs one male and one female, and 44 species are gender-skewed (down to 10% male). That cost is priced into every step.
- **Pal Reversers.** Where a pairing only works by flipping a Pal's gender, the route says so explicitly rather than pretending the pairing is free.
- **Gender-specific breeding rules.** The Cattiva/Mistica and Katress/Wixen pairs, whose child depends on which parent is male, are special-cased.

## Honest limitations

- Route finding is a **heuristic beam search**. It returns good routes, not proven-optimal ones. Hard targets can need a higher "Beam width" in Advanced Settings — raise it gradually, since search cost grows much faster than the number itself.
- Random passive additions are treated as junk, which keeps effort estimates conservative.
- Effort numbers are estimates for comparing routes against each other, not predictions of your actual luck.

## Running it locally

It's a zero-build static site — vanilla ES modules, no bundler, no Node.

```bash
py -m http.server 8000
```

Then open <http://localhost:8000>. Windows users can double-click `run-server.bat` instead.

It **must** be served over HTTP. Opening `index.html` via `file://` will not work — ES modules and `fetch()` are blocked on that origin.

## Tests

Open `tests.html` in the browser (via the server, not `file://`). 28 tests covering the inheritance math, the breeding table, reachability, gender rules, and the solver. No test runner to install.

## Regenerating the data

```bash
py tools/build_data.py
```

See [`tools/UPDATING.md`](tools/UPDATING.md) for the full patch-update runbook — the cached source files must be deleted first, or the script silently does nothing.

## Credits

Game data is derived from **[tylercamp/palcalc](https://github.com/tylercamp/palcalc)**, which reverse-engineers the game's own asset tables. The exhaustive breeding table and passive-inheritance constants in `data/` come from that project.

> Copyright 2024, Tyler Camp
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Pal element types and artwork are sourced from **[paldb.cc](https://paldb.cc/)**, a community-maintained Palworld database.

## Disclaimer

This is an **unofficial fan-made tool**. It is not affiliated with, endorsed by, or associated with Pocketpair, Inc.

Palworld and all related names, artwork, and assets are the property of Pocketpair, Inc. Pal artwork included in this repository remains their copyright and is used here for a free, non-commercial fan tool.

Your roster is stored in your own browser's local storage. Nothing is uploaded anywhere, and there is no account or server.
