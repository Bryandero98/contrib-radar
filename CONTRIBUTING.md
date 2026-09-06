# Contributing to contrib-radar

Thanks for looking at this. contrib-radar is young and the rules below are
what keep it that way as more people touch it — short version: real tests,
clear commits, and CI green before anyone reviews your code.

## Before you start

For anything bigger than a typo fix, open an issue first (or comment on an
existing one) describing what you want to change and why. That avoids two
people solving the same problem, and catches a design disagreement before
you've written the code.

## Setup

```bash
git clone <this-repo>
cd contrib-radar
npm install
docker compose up -d
cp .env.example .env
npm run db:migrate
npm run start:dev
```

You need a real Postgres — `docker compose up -d` gives you one. No Docker?
Point `DATABASE_URL` in `.env` at any reachable Postgres.

A `GITHUB_TOKEN` (any personal access token with public read scope) is
required for anything that talks to GitHub - GraphQL has no anonymous tier.
A `GEMINI_API_KEY` (free, from [aistudio.google.com](https://aistudio.google.com))
is optional: sentiment classification degrades to deterministic-only
scoring without one, it doesn't block anything.

## How we write tests

**No mocks on the database.** Every test that touches persistence in this
repo runs against a real Postgres — the same one `DATABASE_URL` points at,
migrated (`npm run db:migrate`), not a mocked query builder. A mock can't
tell you a foreign key constraint fired or that a migration produced the
shape your code expects; a real database can. These suites skip themselves
automatically when `DATABASE_URL` isn't set (`describeIfDb` at the top of
each one) — set it before running `npm test` to actually exercise them.

**GitHub and Gemini are mocked, always.** Unlike the database, the two
external APIs are never called for real in a test - `github-graphql.provider.spec.ts`
and `gemini-sentiment.provider.spec.ts` mock `fetch` directly to pin down
the HTTP contract, and every other spec that needs a `GithubClient` or
`SentimentProvider` (`refresh.service.spec.ts`, the e2e suite) implements
the small interface directly as a test double instead. A CI run should
never need real credentials to pass.

`npm test` runs every suite against one shared database in-band (`--runInBand`)
on purpose — Jest's usual per-file parallelism would let two suites race
against the same live database.

Run the suite with:

```bash
npm test
npm run test:e2e
npm run lint
npm run build
```

All four need to pass before you open a PR.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), always:

```
<type>(<scope>): <summary>

<body, if the change needs explaining>
```

`type` is one of `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
`scope` is the module you touched (`scoring`, `github`, `sentiment`,
`refresh`, `dashboard`, `mcp`). Reference the issue you're closing:
`Fixes #12`.

## Opening a PR

1. Branch off `main`: `<type>/<short-description>`.
2. Keep it to one change. A second unrelated fix you noticed along the way
   is a separate PR.
3. Fill in what you actually ran (test output, not "should work").
4. Wait for CI to go green before pinging anyone for review.

## Adding or changing a scoring signal

Signals live one-per-file under `src/scoring/signals/`, each a pure
function taking a `GithubIssue` and returning `{ penalty, reasons }` - no
DB, no network. Add the weight as a named constant in `src/scoring/weights.ts`
(never a magic number inline), wire the signal into `ScoringService.score()`,
and add a case to `scoring.service.spec.ts`. If the change is motivated by
a real issue you ran into, add it as a fourth regression fixture alongside
the existing three (argo-cd #20801, fluxcd/source-controller #666,
jenkins #21801) rather than only asserting the new behavior in isolation.

## Changing the database schema

Edit `src/database/schema.ts`, then generate the migration instead of
writing SQL by hand:

```bash
npm run db:generate
```

Never edit a migration file under `drizzle/` once it's committed and shipped
— add a new schema change and generate a new migration instead.
