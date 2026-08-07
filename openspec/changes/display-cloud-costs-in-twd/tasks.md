## 1. Contract
- [x] 1.1 Verify the current Azure USD and TWD retail prices used by this deployment.
- [x] 1.2 Define the USD-ledger and TWD-presentation boundary.
- [x] 1.3 Document the external Azure Retail Prices dependency, atomic snapshot fallback, refresh lifecycle, and archive ownership boundary.

## 2. Implementation
- [x] 2.1 Add one shared USD-to-TWD formatter with source and as-of metadata.
- [x] 2.2 Use it for dashboard totals, admin detail, quota displays, and quota inputs.
- [x] 2.3 Update admin currency labels and explain the reference conversion.
- [x] 2.4 Expose the daily Azure TWD reference through operator configuration and apply it before operator/admin cost rendering.

## 3. Verification
- [x] 3.1 Run focused currency, dashboard, governance, and shell tests.
- [x] 3.2 Build the control plane and strictly validate this OpenSpec change.
- [x] 3.3 Render desktop and 390px operator/admin views and inspect TWD presentation.
- [x] 3.4 Rebuild and recreate only the production control-plane service, then verify live assets and health.
- [x] 3.5 Re-run focused pricing/currency/API checks and verify the deployed reference rate and refresh timestamp.
- [x] 3.6 Reconcile the proposal impact and design with the implemented adapter/domain/startup/API/UI scope.
- [x] 3.7 Reject a zero-valued provider meter before atomically replacing the
  verified catalog, with a last-known-good regression.
- [x] 3.8 Reject USD/TWD meter rows with different effective dates before
  atomically replacing the verified reference.
- [x] 3.9 Label a partial converted subtotal as `已知費用` and keep the unpriced-usage warning.
