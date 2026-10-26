# Bill of materials

Status: built.

The bill of materials says what one unit of the product needs, what has to
be bought to build N units, and what that costs: per unit, and as an order.
This document records what the earlier Protoboard web app's bill of materials does, which of
its rules the Stack ports and which it leaves, and the model and views that
came out of it.

Decisions this follows:

- One currency, US dollars for now: every price is converted to it.
- Port the earlier web app's pack-size and minimum-order logic, and show both
  the per-unit cost and the real cost of ordering, so a total never surprises
  the user once packs and minimums are applied.
- Restyle after the earlier web app's, with its features, and give the bill a
  data source beyond the CSV.
- Prices are shown when they come from the library over its API. How the
  library fetches them is never exposed to the user or their agent.

## 1. The earlier web app's bill of materials

Read from the earlier web app's source (v4.x):

| What | Where |
| --- | --- |
| Pack and cost arithmetic | `src/lib/bom/costing.ts`, `src/ui/components/left/utils/packCalculations.ts` |
| Hydration, supplier selection, refresh | `src/application/bom/BOMService.ts`, `src/lib/bom/suppliers.ts` |
| Types | `src/application/bom/types.ts` |
| The view | `src/ui/components/left/BillOfMaterials.tsx`, `BOMGroupedRow.tsx`, `SupplierDropdown.tsx` |
| Export | `exportBOMToCSV` in `BillOfMaterials.tsx`, `src/lib/pdf/bom-pdf.tsx` |
| The plan the pack columns came from | `docs/planning/pack-quantity-feature-plan.md` |

### 1.1 Rules

**Items.** One item per part template placed on the board, with the count of
its instances (`quantity`). Expanding an item lists its instances.

**Owned parts.** An instance, or a whole item, can be marked as owned. Owned
pieces are not bought: `unowned = quantity − owned`, and every cost below is
on the unowned quantity. A fully owned item shows "Owned" in place of a
total and is left out of the CSV.

**Suppliers.** An item has supplier records from two places: the part
library's suppliers for the part (only those with a parseable price), and
records kept on the board (added by hand, by the agent, or copied from the
library on a refresh). They are merged by vendor and link (or vendor and
vendor part id); where both have the record, the one with the newer price
timestamp gives the live fields. Each record has: vendor, link, vendor part
id, price in USD, pack quantity, minimum order quantity, stock quantity,
availability status, price timestamp, currency, product status, affiliate
flag.

**The active supplier.** The one the board names for the item, else the
first record. There is no ranking: the earlier web app never picks the cheapest. The
supplier column is a dropdown of the records; choosing one makes it active
and is saved on the board.

**Packs.** `packSize = ceil(packQuantity)`, 1 when absent or not positive.
`packsNeeded = ceil(unowned / packSize)`; `actualOrderQuantity = packsNeeded
× packSize`; the extra pieces are "extra / unplaced" (`wasted = received −
placed`).

**Price.** The supplier's price is the price of a pack.
`lineTotal = packPrice × packsNeeded`. The price of one piece is
`packPrice / packSize`, shown in a tooltip, and the cost of the extra pieces
is `unitPrice × wasted`. The estimated total is the sum of the line totals.
A custom price entered by hand replaces the supplier's and is marked.

**Minimum order quantity.** Carried on the supplier record and shown in the
supplier editor; it does not enter the arithmetic. The order quantity is
rounded to packs only.

**Currency.** The library stores `currentPriceUSD`; the `currency` field is
carried and not used. Everything is shown with a dollar sign.

**Stock.** `in_stock`, `limited_stock`, `out_of_stock` or `unknown` as the
library says; otherwise from the stock quantity: none is out of stock, under
10 is limited, else in stock.

**Freshness.** A price is fresh for 7 days from its timestamp. "Auto update"
re-reads the library's suppliers for every item and reports, per item:
price updated, unchanged, no remote source, failed; and whether the price
is fresh, stale or missing, with "research recommended" for the last two.

**Pricing status** of an item: priced, custom price, missing price (no
supplier), invalid price (a supplier whose price does not parse), no
supplier selected.

**Export.** CSV of the selected rows: part name, category, quantity
(unowned), unit cost (the pack price), total cost, pack size, actual
quantity, purchase link. A PDF of the same.

### 1.2 Look

- A page of its own: the title in the label face, then a row of summary
  cards with a small uppercase label and an icon: **BOM info** (the board's
  name, the app version), **Total parts** (the count, with Unique,
  Suppliers and In stock under it), **Affiliate links**, **Estimated cost**
  (the total in orange, "Total is calculated. Prices may vary. Tax and
  shipping not included.", and the Auto update button).
- A toolbar: Export (CSV, PDF), Mark as owned, delete; then rows per page,
  paging, a column chooser and full screen.
- A table with uppercase, sortable column headers that explain themselves
  in tooltips: a checkbox, expand, **Name**, part number, category,
  **Supplier** (the dropdown), **In-stock** (a badge with a coloured dot:
  In-Stock, Limited, Out-of-Stock, Unknown), **Price** (per pack), **Pack
  qty**, **Parts/pack**, **Total parts** (with a yellow warning triangle
  when pieces are left over, and an "extra / unplaced" row when expanded),
  **Total** (orange; "Owned" in cyan when owned), **Buy** (a link out),
  **Affiliate**, and a row menu.
- A footer row: "Estimated total" with the sum in orange.

## 2. What the Stack ports, and what it leaves

| Earlier web app's rule | Stack | Why |
| --- | --- | --- |
| Whole packs: `ceil(need / pack) × pack` | **Ported.** | The decision. |
| The extra pieces and their cost, with a warning on the line | **Ported**: `surplus` per line and in the totals, the warning triangle with what is left over and what it costs. | "Why is this coming out to 275." |
| Line total = what is ordered, not what is used | **Ported, and both are shown**: `perUnitCost` (the pieces a unit uses) and `orderCost` (the pieces bought). The earlier web app shows only the order. | The decision asks for both. |
| Minimum order quantity carried but not applied | **Changed: applied.** The order is the need raised to the minimum order, then to whole packs. | A minimum order is exactly the "real cost of ordering"; the earlier web app's omission is a gap, not a rule. |
| Price is per pack | **Changed: per piece.** The library's offers state a price per piece with price breaks; the pack is a quantity rule, not a price unit. The price used is the break the bought quantity reaches. | It is how the library and distributors state prices; it makes quantity discounts work, which the earlier web app has none of. |
| The active supplier: the board's choice, else the first | **Ported with a default rule.** The project's choice (`parts/bom.json`) wins; without one, the best offer by the rules of §3.3 rather than "the first". | "The first" is arbitrary; the Stack already ranks offers for a release (ext-sourcing). |
| Supplier dropdown per line, saved | **Ported**: the supplier chip opens the offers held; the choice is kept in the project. | |
| Supplier records merged from the library and the board | **Ported in the Stack's terms**: the library's offers (`parts/offers.json`) and the project's own sourcing records (`parts/evidence/<id>/sourcing.json`) are both a line's offers. | |
| Add or edit a supplier record by hand; custom price; custom link | **Left.** | The project's own record of an offer is a sourcing record (ext-sourcing's supplier-compare skill writes it, dated and sourced). A second, undated way to type a price in would undo that. |
| Owned parts | **Left.** | Stock on hand belongs to a build, not to the design; nothing in a project records it yet. Units to build covers "how many". Filed as a follow-up. |
| All prices in USD | **Ported, with conversion made explicit**: a dated rate table, converted prices marked (§3.4). The earlier web app relies on the library storing dollars. | The library's offers are in the supplier's currency. |
| Stock badge: in stock, limited, out, unknown | **Ported**, with "limited" meaning the stock does not cover this order (the earlier web app's "under 10" is arbitrary), and the supplier's own figure and date in the tooltip. | |
| Fresh for 7 days; refresh reports stale and missing | **Ported with another threshold**: stale after 90 days (the sourcing extension's figure), or when the library marks the offer stale. Stale prices are counted and marked; Refresh offers asks the library again. | Seven days suits a live storefront; the library's observations are dated and slower. 90 can be changed if it proves wrong. |
| Pricing status | **Ported** as the line's status: priced, unpriced (with the reason), needs a quote (made), included. | |
| Summary cards, uppercase headers with tooltips, supplier dropdown, stock badge, orange totals, footer total, warning triangle | **Ported** (§5). Orange only in the Protoboard themes; in a VS Code theme the totals take the theme's accent. | UI rules. |
| Affiliate links card and column | **Left.** | No affiliate programme in the Stack. |
| Selection checkboxes, paging, column chooser, full screen, row menu | **Left.** | They serve owned parts and deleting from the canvas; the bill is not an editor of the design. The table is short enough to scroll, and it is already a tab of its own. |
| Sort by column | **Left for now**; grouping by module, by supplier or not at all is there instead. | Grouping by top-level module is the requirement; a sort within groups is a small follow-up. |
| CSV export | **Ported, wider**: every line with both costs, the pack and minimum-order arithmetic, the supplier's own price and the rate (§4.3). | |
| PDF export | **Left.** | The release's `system/bom.pdf` is the printed bill. |

Rules the Stack has that the earlier web app lacks, kept: made parts and included
parts as lines without a price; a full reel is never quoted for fewer than
a reel unless a person chooses it; an offer whose stock does not cover the
order ranks after one whose stock does.

## 3. The model

`@protoboardai/core/bom` (`packages/core/src/bom-model.ts`): pure, no file
access, no clock, usable in a browser. `protoboard bom --format json` prints
it; the views draw it. Schema `protoboard.bom/v0`.

### 3.1 A line

| Field | Meaning |
| --- | --- |
| `key` | Unique in the bill: the part id, with `#<ordering code>` where placements of one part differ in it (a series resistor at several values). |
| `definition`, `item`, `manufacturer`, `mpn`, `value` | The part. |
| `kind` | `buy`; `make` (a module a capability provider designs, or a cable to assemble: it needs a quote); `included` (the model says it ships with another part). |
| `quantity` | Pieces one unit of the product needs, multiplied through the instance tree. |
| `packQuantity` | Pieces per pack the part's own model states (`pack_quantity`). |
| `group`, `instances` | The top-level module that uses it, and where. |
| `offers` | The offers the project holds (§3.2). |
| `needed` | `quantity` × units built. |
| `quotes` | Every offer worked out for `needed`, best first. |
| `chosen`, `choice` | The offer used, and whether the rules chose it (`auto`), a person did (`pinned`), or a person's choice is gone (`pinned-gone`). |
| `quote` | The used offer's figures: `buy`, `packSize`, `packs`, `minOrder`, `surplus`, `unitPrice` (USD), `orderCost`, `native` (the supplier's price, currency and the rate, when converted), `fit`, `covers`, `ageDays`, `stale`. |
| `perUnitCost` | `quantity` × `unitPrice`. |
| `orderCost` | `buy` × `unitPrice`. |
| `status`, `notes` | `priced`, `unpriced`, `make`, `included`; and what a reader should know. |

### 3.2 An offer

Supplier, the supplier's code, the ordering code, the link to the listing,
currency, price breaks (per piece), pack size (read from the listing's sale
unit: "4-pack", "pack of 10", "purchase unit 100 pcs"), minimum order,
packaging, stock, lead time, whether the seller is authorized, market, when
the price was observed, and whether the library marks it stale. Its
`origin` is `library` (`parts/offers.json`, written by `protoboard parts
offers` from the library's price API) or `project` (the project's own
sourcing record). Both are read by core's one offer reader
(`@protoboardai/core/offers`), which the board's supplier numbers
and KiCad fields use too; a line lists a project part's own offers first and
a library part's library offers first.

Nothing in an offer says how its price was obtained, and the reader drops
any such member an older file still holds.

### 3.3 What is bought, and which offer

For one offer and `needed` pieces:

    pack     = the listing's pack size, else the part's, else 1
    minimum  = max(minimum order, the first price break's quantity, 1)
    buy      = ceil(max(needed, minimum) / pack) × pack
    price    = the break with the largest quantity ≤ buy, converted to USD
    order    = buy × price
    surplus  = buy − needed

A listing that sells only in multiples of its minimum order ("sale-quantity
multiples": 5, 10, 15, never 8) has that minimum as its pack. The rule is
one function (`offerPackSize`) for the library's offers and the project's
own records.

**Raised to a price break.** Where buying up to a later price break costs
less in all than `buy` at its own break (8 single pieces at $1.00 against
10 at $0.50), the order is raised to that break, in whole packs, and the
quote says so: `raised: { from, fromCost }`, the pieces the need alone would
buy and what they would cost. The line's note, the Buy column's tooltip and
a release's `offer_flag` state both figures. A tie buys the fewer pieces
(the saving must be a cent or more), and a break the supplier's stated stock
cannot fill is not used when the stock covers the smaller order.

The offer used is the one a person chose; else the first of the offers
ranked: one with a price; not a full reel for fewer than a reel; stock that
covers the order, or is not stated; a current price before a stale one; the
lowest order cost in dollars; a price that needed no conversion; the
supplier's name. A full reel for fewer than a reel is never used by the
rules: the line stays unpriced and says a reel is offered.

Which of a part's offers are a line's:

- A line that is one value of a series part (a resistor placed at 5.1 kΩ;
  the line has a `value`) takes only the offers for its own ordering code:
  those that name it, and those that name none when its code is the
  definition's own (an offer without a code is for the definition's). It is
  never priced by another value's offer; with no offer for its code it is
  unpriced.
- Any other line: when some of the part's offers name the line's ordering
  code, only those and the offers that name none; else all of them.

A line with no usable offer is unpriced, with the reason. Nothing is ever
estimated.

### 3.4 One currency

Every amount is in US dollars. An offer in another currency is converted
with a rate table (`protoboard.fx/v0`): the project's own
`parts/fx-rates.json` when it has one, else the table shipped in
`packages/core/src/fx-rates.ts`: the European Central Bank's euro foreign
exchange reference rates, with their date (2026-10-07 as built). No rate is
fetched at check, build or release time, so totals do not change between
machines or runs.

A converted price is marked everywhere it shows: the supplier's currency
beside the unit price in the views (the tooltip gives the supplier's price,
the rate, the source and the date), a line in the CLI, and the supplier's
price, currency, rate and date in the JSON and the CSV. The bill names the
table (`fx.source`, `fx.date`, `fx.project`) and the rates it used.

An offer in a currency the table lacks cannot be converted: it is not used,
and the line says why.

To change the rates: write `parts/fx-rates.json`, for example

    { "schema": "protoboard.fx/v0", "base": "USD", "date": "2026-11-01",
      "source": "our bank's rate sheet", "rates": { "EUR": 0.91, "GBP": 0.77 } }

The shipped table is updated with a release of the Stack (replace the
figures and the date in `fx-rates.ts`).

### 3.5 Totals

| Total | Formula | Reads as |
| --- | --- | --- |
| `perUnit` | Σ `quantity` × `unitPrice` | What the parts of one unit cost, at the prices paid at this order size. |
| `order` | Σ `buy` × `unitPrice` | What ordering for N units costs. |
| `orderPerUnit` | `order` ÷ units | |
| `surplus` | Σ `surplus` × `unitPrice` | Of the order, what pays for pieces left over. |

Made, included and unpriced lines are in neither total; the counts say how
many there are. Tax and shipping are not included.

### 3.6 What the project keeps

`parts/bom.json` (`protoboard.bom-settings/v0`): the units to build and the
offers a person chose, by line key. Written by the views and by
`protoboard bom units` and `protoboard bom choose`. It is a small file meant
to be committed.

`protoboard check` reports a malformed `parts/bom.json`
(`PB_BOM_SETTINGS_INVALID`) or `parts/fx-rates.json` (`PB_FX_RATES_INVALID`)
as an error when the project loads, the same refusal `protoboard bom` and
the views give, so it is found before someone opens the bill.

### 3.7 Where lines come from

The design: the system's instance tree as last resolved (the CLI loads the
project; the VS Code extension reads the last build). `--release <version>`
(and opening a release's `system/ordering-list.csv` in VS Code) takes that
ordering list's lines instead, priced the same way from the offers held
today, not from the prices the release wrote down.

### 3.8 A release's ordering list

The Manufacturing Package's ordering list (`system/ordering-list.csv`,
ext-release `lib/bom.ts`) quotes each bought line with this model
(ext-sourcing `quoteHeldLines`): the offers the project holds, the offer a
person chose for the line in `parts/bom.json`, else the best by the rules
above; whole packs, minimum orders and price breaks; every price in US
dollars with the project's rate table. The bill and a release therefore
agree on supplier and price for the same pieces.

The one difference is the quantity: a release orders the need for
`release.build` products plus spares (`release.spares`, else the defaults),
the bill the need for the units to build and no spares. So a release's
total can be higher than the bill's for the same number of products.

Columns of the ordering list that carry the price: `unit_price`, `currency`
(always `USD` on a priced line), `extended`, and for a converted price
`supplier_unit_price`, `supplier_currency`, `fx_rate`, `fx_date`.
`offer_flag` says what to know about the quote: chosen in the bill of
materials, converted (from which currency, at which rate and date), a stale
price, a full reel, raised to a price break, or stock that does not cover
the order. `offer_alternatives` lists full reels held but not quoted. The
package's cost estimate is the sum of the lines; its note names the
currencies converted and the rate table's date.

What this replaced (stage 1): the ordering list chose offers by its
own rule in the project's `currency` (protoboard.config.ts), kept offers in
other currencies as alternatives and never converted. `currency` in
protoboard.config.ts is still accepted and validated but no longer changes
a release's quotes: an ordering list is in US dollars.

## 4. The CLI

    protoboard bom [--units <n>] [--release <version>] [--format json|csv]
    protoboard bom units <n>
    protoboard bom offers <line>
    protoboard bom choose <line> <offer id | supplier | auto>

### 4.1 Text

One block per top-level module; per line the quantity, unit price, per-unit
cost, pieces bought, order cost and supplier, with the line's notes under
it. Then both totals, the counts, the rate table and its date when anything
was converted, and when the prices were observed.

### 4.2 JSON

The whole model of §3: every line with every offer and every quote.

### 4.3 CSV

An export, not the source. Text a spreadsheet would run as a formula (a
cell starting with `=`, `+`, `-` or `@`) is written with an apostrophe in
front: names and notes come from library and project data. One row per line: `line, module, item,
definition, manufacturer, mpn, value, kind, status, qty_per_unit, units,
needed, buy, pack_size, packs, min_order, supplier, supplier_sku,
unit_price_usd, per_unit_cost_usd, order_cost_usd, supplier_unit_price,
supplier_currency, fx_rate, fx_date, stock, price_observed, stale,
offer_chosen_by, supplier_url, note`.

## 5. The views

One component, `BomEditor` in `@protoboardai/views`, drawn by the VS Code
extension (Protoboard: Open Bill of Materials; the Cloud view; a viewer's
BOM tab) and by the web viewer's BOM tab. Both have every feature below;
only where a click lands differs. In VS Code a part opens in the library's
part page or at its source, and Export CSV asks where to save. In the web
viewer (`protoboard dev`) a library part's page opens in place of the bill
with a way back, a part of the project's own goes to the diagram at its
first place (or says it has no page), Refresh offers posts to the dev
server (`POST parts/offers`, the page's session token like every write,
which runs `protoboard parts offers`), and Export CSV downloads the file.

- **Header**: the title, where the lines come from, and a toolbar of icon
  buttons with tooltips: units to build (a number with steppers), grouping
  (by module, by supplier, none), refresh offers, export CSV.
- **Summary cards** (the earlier web app's): Parts (pieces per unit; lines,
  suppliers, in stock, made), Prices (priced of bought; unpriced, stale,
  converted; when observed and the rate table's date), Per unit, Order (in
  the accent colour, with what of it buys left-over pieces).
- **Table** (wide): Part (name, ordering code; opens the part), Supplier
  (the chip; opens the offers held, each with its order cost and marks; a
  pin when a person chose it), Stock (the badge), Need, Buy (with the
  warning triangle when pieces are left over), Unit (with the supplier's
  currency when converted, a clock when stale), Per unit, Order, and the
  row's actions: open at the supplier, show in the viewer. Group rows carry
  the module's name, quantity, lines and order cost. A totals row closes
  the table.
- **Narrow** (under 1080 px of its container): each line is three short
  rows with the same content. Nothing scrolls sideways and nothing is cut
  off down to a 300 px wide tab (VS Code pads a webview by 20 px on each
  side, so the content's own minimum is 260 px).
- The view keeps what the reader just changed while the host's echo of an
  earlier click arrives (a few clicks on the stepper do not jump back).
- In VS Code the project's BOM tab comes back after a window reload or
  restart (a webview panel serializer; the page's saved state names the
  project).
- The view re-prices by itself when the units or an offer change, then
  tells its host, which writes `parts/bom.json`.
- Themes: VS Code's tokens, high contrast included; orange only in the
  Protoboard themes.

The Cloud view's cost estimate shows the per-unit figure, the order cost
when it differs, and how many prices were converted and at which date.

## 6. What is not shown

How the library obtains prices. The views and the CLI show the library's
results: supplier, price, stock, the date observed, the link to the
listing.

## 7. Follow-ups

- Spares in the bill of materials (a release adds them, §3.8), as an
  option.
- Owned parts (stock on hand) per build.
- Sort within groups.
- A rate table served by the library, so it is updated without a release.
