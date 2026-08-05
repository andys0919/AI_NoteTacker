## Context

Cloud usage settlement and API contracts are denominated in USD. The Taiwan
operator and admin surfaces need one TWD presentation reference without
rewriting immutable accounting or treating a public retail conversion as an
invoice price.

## Goals / Non-Goals

**Goals:**
- Present all operator/admin money through one current, dated TWD reference.
- Keep the USD ledger, reservations, quota calculations, and API inputs intact.
- Reuse the control-plane's Azure Retail Prices integration without adding an
  SDK, database table, or second refresh loop.

**Non-Goals:**
- Calculate subscription `EffectivePrice` or mutate historical ledger rows.
- Accept a partial, zero, future-dated, or inconsistent provider snapshot.

## Decisions

1. **Use the existing control-plane Azure Retail Prices adapter.** At startup,
   before listening, and every 24 hours thereafter, it queries the verified
   Luna USD meters and the exact MAI USD/TWD meter with a finite timeout.
2. **Apply one complete snapshot atomically.** Luna pricing and the MAI-derived
   TWD reference update together only after identity, currency, unit, effective
   date, and rate validation. Any HTTP, pagination, shape, missing-meter, or
   consistency failure keeps the last verified in-memory snapshot; the bundled
   verified snapshot remains the cold-start fallback.
3. **Convert only at the presentation boundary.** Operator configuration
   exposes the current rate, source, and refresh time. Dashboard/admin code uses
   that reference for display and converts admin TWD quota input back to the
   existing USD API precision. Unpriced and lower-bound warnings remain visible.

## Ownership and Archive Order

`update-cloud-summary-azure-responses` owns the Azure adapter, catalog identity,
startup/24-hour refresh, and complete-snapshot fallback contract. This change
owns the operator-config projection and TWD presentation of that verified
state. Archive the foundational pricing change first; then rebase and strictly
revalidate this change against the published cloud-governance requirements
before archiving it. This change does not authorize either archive.

## Migration Plan

Deploy the control-plane as one release. No database or ledger migration is
required; rollback restores the prior control-plane image and keeps USD records
unchanged.
