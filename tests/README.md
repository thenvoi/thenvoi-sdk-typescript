# Test Layout

Tests are intentionally kept mostly flat.

Rationale:
- The SDK surface is broad but shallow; most test files map 1:1 to one adapter or one integration module.
- A flat list keeps adapter parity checks quick to scan during releases.
- Vitest startup/runtime is unaffected at this project size.

When this directory grows substantially beyond the current footprint, group by domain (`adapters/`, `runtime/`, `integrations/`) and keep `examples-*` tests together.
