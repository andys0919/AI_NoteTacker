## 1. Specification and ticket

- [x] 1.1 Create tracking issue `andys0919/AI_NoteTacker#11` for the speaker filter and the owner-note layout parity.
- [x] 1.2 Strictly validate this OpenSpec proposal, tasks, and `operator-dashboard` delta.

## 2. Speaker filter

- [x] 2.1 Count readable segments per speaker alongside the existing talk time.
- [x] 2.2 Render the filter group above the scrolling transcript, with an all-speakers control and one toned control per speaker, only when two or more speakers exist.
- [x] 2.3 Tag every turn with its speaker so filtering is a DOM toggle, with no re-render and no server call.
- [x] 2.4 Announce the visible count as a complete sentence through one atomic status region.
- [x] 2.5 Carry the selected filter through the reader state that survives an edit-triggered re-render.

## 3. Owner note layout parity

- [x] 3.1 Stop `.job-card` clipping the reader on the owner note page so the summary column sticks to the viewport as it does on the admin result page.

## 4. Responsive UI/UX

- [x] 4.1 Chips wrap instead of clipping, each label stays on one line, controls meet the touch target and focus rules, and the strip stays inside the monochrome theme.

## 5. Verification and review

- [x] 5.1 Add focused reader regressions for the filter markup, the single-speaker and legacy cases, and the preserved filter state.
- [x] 5.2 Run the control-plane typecheck and test suite, and compare failures against the pre-change baseline.
- [x] 5.3 Code review the change before deploying, and record the findings.
