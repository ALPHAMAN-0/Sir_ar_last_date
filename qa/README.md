# QA — "Test it" button harness

A registry-driven click test for the React app. Every clickable control is
listed in `qa/buttons.json`; `qa/test-it.test.tsx` walks the list, finds each
control in a jsdom-rendered copy of the app, clicks it, and asserts the app
does not throw or log a console error.

## Run it

```bash
npm test -- qa/test-it
```

The run prints one line per registered button:

```
  Test it: 22 buttons — 20 pass, 2 skip, 0 fail
    [pass] header.title — Sir ar Last Date
    [pass] header.tab.register — Register
    …
    [skip] register.columns — Columns (control not found: text=Columns)
```

- `pass` — clicked, no `console.error`, DOM still rendered.
- `skip` — control not in the DOM for the seeded route (e.g. "Columns" only
  appears when the auto-detect cannot find a repo-link column). Skips are
  expected; the registry grows with the app.
- `fail` — clicked and a `console.error` was logged, or the click threw, or
  the page went blank. The run fails.

## Add a button

1. Find the component and the text/selector for the control.
2. Add an entry to `qa/buttons.json`:
   ```json
   {
     "id": "screen.action",
     "label": "The visible text",
     "selector": "button.button--primary",
     "screen": "register",
     "requires": { "hasSheet": true, "route": "#/" },
     "notes": "What it does, in one sentence."
   }
   ```
3. Selector is plain CSS, or `text=…` for a clickable whose only label is its
   text. Pre-clicks (e.g. "Yes, remove" needs "Clear" first) go in
   `preClicks: ["text=Clear"]`.
4. Re-run `npm test -- qa/test-it`. A new `[pass]` line confirms the click
   is now covered.

## How the runner works

- **Seed** — sets `localStorage` (sheet + optional deadline) and the route
  hash, then `vi.resetModules()` and calls `start()` on the store so each
  click starts from a clean slate.
- **Render** — dynamically imports `App.tsx` and renders it inside
  `@testing-library/react` with `jsdom`.
- **Click** — finds the control with the registered selector, fires a
  `preClicks` warm-up if any, then fires the main click.
- **Assert** — checks `console.error` was not called and `document.body` still
  has content.

The same `stubApi` / `saveSheet` helpers that the in-`src/` screen tests use
are reused here, so the API is the same fake Worker the rest of the suite
hits. No production code is changed.

## Coverage

`qa/` is not in the `coverage.include` glob (`vitest.config.ts`), so it does
not change the `src/` coverage numbers. The runner exists to catch
click-time crashes, not to lift lines.
