# Contributing to LiveX

Thank you for your interest in contributing! LiveX is a local-first, privacy-respecting video player — contributions that preserve those guarantees are always welcome.

## Ground rules

- **No backend, no uploads.** Video bytes must never leave the user's device in local-file mode.
- **No new external runtime dependencies** without discussion. The local build must stay fully offline.
- **TypeScript only** — all source files in `src/` are `.ts`. Avoid `any` unless you can demonstrate why a narrower type is impossible.
- **Tests required.** New features need either a Vitest unit test (`tests/unit/`) or a Playwright spec (`tests/e2e/`).

## Development setup

```bash
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run typecheck  # zero TypeScript errors before opening a PR
npm run test:unit  # fast unit tests (Vitest)
npm test           # full browser suite (Playwright)
npm run audit      # fixture/doc drift + DOM-id wiring checks
```

## Branch naming

| Type | Pattern | Example |
| --- | --- | --- |
| Feature | `feat/<short-name>` | `feat/chapter-export` |
| Bug fix | `fix/<issue-or-name>` | `fix/seek-clamp-edge` |
| Docs | `docs/<topic>` | `docs/wasm-feasibility` |
| Refactor | `refactor/<area>` | `refactor/session-state` |

## Pull request checklist

- [ ] `npm run typecheck` passes with zero errors.
- [ ] `npm run test:unit` passes.
- [ ] `npm test` passes (or failures are pre-existing and documented).
- [ ] `npm run audit` passes (no fixture/doc drift, no broken DOM IDs).
- [ ] New behaviour is documented in `README.md` or `docs/`.
- [ ] No video content is ever sent to a server or stored outside `localStorage`/`IndexedDB`.

## Reporting issues

Open a GitHub Issue. Include:
- Browser and OS version.
- Video container + codec (e.g. "MKV / HEVC").
- Steps to reproduce.
- Console errors, if any.

## Code style

- **No formatter config yet** — match the surrounding style (2-space indent, single quotes, semicolons).
- Keep functions small and focused. The `SessionManager` state machine is the canonical example of the preferred style.
- Prefer `const` over `let`; avoid `var`.
- DOM queries go in `WorkspaceUI.ts`, not in service classes.

## Architecture overview

See [`README.md#architecture`](README.md#architecture) and [`docs/UPGRADE-AUDIT.md`](docs/UPGRADE-AUDIT.md) for the full picture.
