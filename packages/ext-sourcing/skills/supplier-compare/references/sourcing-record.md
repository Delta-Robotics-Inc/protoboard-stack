# sourcing.json

`parts/evidence/<id>/sourcing.json`, schema `protoboard.sourcing/v0`: what was
observed about buying one ordering code. Written by **supplier-compare** (offers)
and **lifecycle-alternates** (lifecycle, alternates, risks); checked by the
`sourcing` check and `scripts/compare.ts`. Types: `lib/sourcing.ts` in
`@protoboardai/ext-sourcing`.

```json
{
  "schema": "protoboard.sourcing/v0",
  "part": "acme-ldo3300-33",
  "manufacturer": "ACME",
  "mpn": "LDO3300-33SOT-TR",
  "need": { "quantity": 20, "note": "2 per board × 8 boards + 4 spares" },
  "offers": [
    {
      "supplier": "Distributor A",
      "supplier_sku": "123-LDO3300-33SOT-TR-CT",
      "mpn": "LDO3300-33SOT-TR",
      "url": "https://distributor-a.example/product/123-LDO3300-33SOT-TR-CT",
      "as_of": "2026-09-26",
      "via": "api",
      "authorized": true,
      "stock": 4210,
      "moq": 1,
      "packaging": "cut tape",
      "price_breaks": [
        { "quantity": 1, "unit_price": 0.62, "currency": "USD" },
        { "quantity": 10, "unit_price": 0.48, "currency": "USD" },
        { "quantity": 100, "unit_price": 0.35, "currency": "USD" }
      ],
      "market": "US"
    },
    {
      "supplier": "Distributor B",
      "mpn": "LDO3300-33SOT-TR",
      "url": "https://distributor-b.example/p/LDO3300-33SOT-TR",
      "as_of": "2026-09-26",
      "via": "web",
      "authorized": true,
      "stock": 0,
      "lead_time_weeks": 16,
      "price_breaks": [{ "quantity": 1, "unit_price": 0.66, "currency": "USD" }]
    }
  ],
  "lifecycle": {
    "status": "active",
    "source": "https://acme.example/products/ldo3300",
    "as_of": "2026-09-26",
    "notes": "Manufacturer product page status; no PCN listed"
  },
  "alternates": [
    {
      "mpn": "XYZ1117-3.3",
      "manufacturer": "XYZ",
      "relation": "near-miss",
      "differences": "Same package and pinout order; dropout 1.1 V at 800 mA",
      "lost_because": "Dropout too high for the 3.7 V minimum input",
      "evidence": "docs/sourcing/ldo-3v3.md"
    }
  ],
  "risks": [
    {
      "code": "single-source",
      "reason": "Distributor B is out of stock with 16 weeks lead; 20 units are covered 200× at Distributor A",
      "accepted_by": "J. Engineer",
      "date": "2026-09-26"
    }
  ],
  "capability": [
    { "source": "Distributor A API", "available": true, "used": true },
    { "source": "Distributor B (web)", "available": true, "used": true },
    { "source": "Aggregator API", "available": false, "used": false, "note": "no key in this environment" }
  ]
}
```

Suppliers, URLs and parts in the example are fictional.

## Keys

| Key | Required | Meaning |
| --- | --- | --- |
| `part` | yes | The UHD definition id; the record lives in `parts/evidence/<part>/`. |
| `manufacturer`, `mpn` | yes | The exact ordering code, suffix included. |
| `need.quantity` | for coverage | Units the project needs, spares included. |
| `offers[]` | yes (may be empty) | One per supplier listing read. `supplier`, `mpn`, `url`, `as_of`, `via` (`api`, `web`, `human`) are required; the rest when shown. |
| `offers[].stock` | — | Whole number; `null` when the supplier does not show it. `0` means out of stock. |
| `offers[].authorized` | — | Franchised distributor for that manufacturer: `true`, `false`, or `null` when not known. |
| `offers[].price_breaks[]` | — | `{ quantity, unit_price, currency }`, ISO 4217 currency, as shown. |
| `lifecycle` | recommended | `status` (`active`, `nrnd`, `ltb`, `eol`, `obsolete`, `unknown`), `source`, `as_of`. The manufacturer's statement wins over a distributor's field. |
| `alternates[]` | when stock or lifecycle needs one | `mpn`, `manufacturer`, `relation` (`family-variant`, `form-fit-function`, `pin-compatible`, `near-miss`), `differences`; a near-miss also has `lost_because`. |
| `risks[]` | to accept a disqualifier | `code` (`single-source`, `low-stock`, `lifecycle`), `reason`, `accepted_by` (a named person), `date`. |
| `capability[]` | recommended | Which sources were available and used, so a reader knows the coverage. |

Forbidden anywhere in the record: order, cart, checkout, purchase-order,
token, key, secret, password, session or cookie fields. The record is evidence
of what was observed; it is never an order or a credential store.
