# Palworld Breeding Route Planner

Breeding calculator for Palworld that plans routes starting from the Pals you already own, including the passive skills you want on the result.

Live at https://goubah.github.io/palworld-breeding-planner/

## What it does

Most breeding calculators answer "what do these two make?" or "which pairs give me this Pal?". This one goes the other way round:

1. Enter the Pals you own: species, gender, passives.
2. Pick a target Pal and up to four passives you want it to have.
3. Get ranked multi-generation routes that start from your roster only.

There's no "assume you can catch a good parent" fallback. If the target isn't reachable from what you own, it says so up front rather than searching for a while and coming back with nothing.

## Passive inheritance

The model uses the game's own numbers rather than estimates:

- The child's pool is the deduplicated union of both parents' passives.
- It inherits X of them, X in 1..4, weighted 40/30/20/10.
- If fewer than 4 slots end up filled, Y random passives are added, Y in 0..3, same weighting.
- If all 4 slots are already full, the random step is skipped rather than rolled.

That last rule is easy to miss and it changes the numbers. It's why landing a specific set of 4 passives is 10% and not 4%. The model reproduces the published rates (40/24/12/10 for pools of size 1 to 4) and there's a test pinning that.

Every step of a route shows the per-egg chance, how many eggs you should expect, and a rough time estimate.

A route can be read two ways. The family tree lays the whole plan out left to right, with the Pals you own on the left and the finished Pal on the right. The step list gives the same plan as numbered breeding pairs in the order you would do them. Either way, each Pal you own is listed with its actual passives, so you know which one to reach for when you own several of a species.

## Also accounted for

Gender ratios. Breeding needs one male and one female, and 44 species are skewed, some as far as 10% male, so that cost is part of the estimate.

Pal Reversers. Where a pairing only works by flipping a Pal's gender, the route says so rather than treating the pairing as free.

The two gender-specific pairs (Cattiva/Mistica and Katress/Wixen), where the child depends on which parent is male.

## Caveats

Route finding is a beam search. It finds good routes, not provably optimal ones. Hard targets sometimes need a larger beam width in Advanced Settings, and it's worth raising that gradually since search cost grows a lot faster than the number does.

Random passive additions are counted as junk, which keeps effort estimates conservative.

The effort numbers exist to compare routes against each other. They aren't a prediction of how your luck will actually go.

## Running it locally

Static site. No build step, no bundler, no Node.

```bash
py -m http.server 8000
```

Then open http://localhost:8000. On Windows you can double-click `run-server.bat` instead.

It has to be served over HTTP. Opening `index.html` off the filesystem won't work, since ES modules and `fetch()` are both blocked on `file://` origins.

## Tests

Open `tests.html` through the server. 28 tests covering the inheritance math, the breeding table, reachability, gender rules and the solver. Nothing to install.

## Regenerating the data

```bash
py tools/build_data.py
```

See [tools/UPDATING.md](tools/UPDATING.md) for the full patch-update process. The cached source files have to be deleted first, otherwise the script does nothing and doesn't say so.

## Credits

Game data is derived from [tylercamp/palcalc](https://github.com/tylercamp/palcalc), which reverse-engineers the game's own asset tables. The exhaustive breeding table and the passive inheritance constants under `data/` come from there.

> Copyright 2024, Tyler Camp
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Pal element types and artwork come from [paldb.cc](https://paldb.cc/), a community-maintained Palworld database.

## Disclaimer

Unofficial fan tool. Not affiliated with, endorsed by, or associated with Pocketpair, Inc.

Palworld and everything associated with it belongs to Pocketpair. The Pal artwork in this repo is theirs, and is used here for a free, non-commercial fan project.

Your roster is kept in your browser's local storage. Nothing is uploaded anywhere and there's no account.
