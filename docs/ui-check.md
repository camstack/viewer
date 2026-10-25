# `ui:check` baseline

`npm run ui:check -- src app embed/src --summary`, measured 2026-10-09 on
`main`:

| Rule | Findings | Files | Replace with |
| --- | --- | --- | --- |
| `raw-hex` | 303 | 75 | `useTheme().colors.*` / `BAND.*` from `src/theme/tokens.ts` |
| `raw-color-fn` | 59 | 33 | a token (alpha through the token, not `rgba()`) |
| `raw-modal` | 16 | 16 | `SheetModal` / `PickerSheet` |
| `rn-switch` | 3 | 3 | `ToggleRow` |

Total: 381 findings in 92 of 993 UI files. `named-color`, `alert-call` and
the embed's `palette-class` are at 0.

The drift is paid down ON TOUCH: a file you edit leaves with no new findings.
A deliberate exception (a video letterbox that must stay black on every theme)
carries `ui-check-ok: <reason>` on the line or the line above. `ui:check` is a
developer tool and never a CI gate.

The rules themselves live in the server repository: the `camstack-ui` and
`camstack-ui-viewer` skills and `docs/ui/viewer.md` (see the UI block at the
top of `AGENTS.md`).
