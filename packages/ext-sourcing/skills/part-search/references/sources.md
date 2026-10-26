# Part and CAD sources: reference card

What each kind of source is good for and the traps that cost an afternoon.
No source here is a default: a project chooses its suppliers and assembler.
Named services are examples of a kind. Every observation carries the date it
was made and is a re-verify item: terms, quotas and APIs change.

The rule above all of these: **try an API before a web search**, and the
**manufacturer is the authority** for the part, wherever it is bought.

## Manufacturers

Good for datasheets, the current revision, errata, ordering-code tables,
lifecycle notices (PCNs, EOL/LTB letters), official photos and often CAD.

- A distributor's copy of a datasheet can be a revision behind. When a fact
  decides the design, cite the manufacturer's document title, revision and the
  date read.
- The ordering-code table decides the variant: suffixes change temperature
  grade, gain, package, packaging and sometimes pinout.

## Authorized (franchised) distributors

Examples: DigiKey, Mouser, Arrow, Newark, Farnell. Good for parametric search,
stock, price breaks, MOQ, packaging options and a lifecycle field.

Observed 2026-09-20, re-verify before relying on them:

- **DigiKey's API sandbox returns plausible, wrong part numbers, stock and
  prices with no error.** Confirm a result came from production before
  trusting it.
- DigiKey replaced the `X-DIGIKEY-Customer-Id` header with
  `X-DIGIKEY-Account-Id` (sunset 2025-11-24); the account id is a different
  identifier, and with the wrong one contract pricing silently resolves to
  list prices.
- A DigiKey page id is not an orderable part number.
- Mouser's search API is keyword-only (no attribute data), its terms prohibit
  caching or storing its content, failures arrive as HTTP 200 with an
  `Errors[]` array, and the key is an `apiKey` query parameter on every call,
  so it lands in every log: redact it, and never store such a URL in evidence.
  Mouser's API explorer is not a sandbox: orders placed through it are real.
  Do not open it.
- Detail URLs often break without the supplier's own token; store the
  canonical URL the API returns.

Their job in sourcing is also independence: two listings from different
distributors are what make "available from one distributor only" checkable.

## Assembler catalogs

Examples: JLCPCB/LCSC, PCBWay. Good for whether the assembler stocks and can
place the part, its part tier and fees, and the key the assembly BOM uses.

Observed 2026-09-20, re-verify:

- **Stock figures disagree between sources**: the same part on the same day
  differed by up to a factor of eight between JLC's official data, community
  mirrors and the LCSC warehouse view. A stock figure that decides anything is
  read on the part's own page, with the date.
- Assembler stock and the parent distributor's stock can be different
  warehouses.
- `www.lcsc.com/datasheet/<C#>.pdf` is an HTML viewer, not the PDF.
- JLC keys its assembly BOM on its C-number; PCBWay keys on the MPN. Record
  both supplier part number and MPN so a change of assembler does not mean
  rebuilding the BOM.
- JLC Economic PCBA ran a fixed 255 ± 5 °C reflow profile, which can damage
  connectors, electrolytics, crystals and modules rated to 245–250 °C. Check
  the peak reflow rating against your assembler's profile.
- A keyless community mirror of the JLC catalog exists
  (`jlcsearch.tscircuit.com`); a mirror is a shortlist tool, not the stock
  evidence.

## Aggregators

Examples: Octopart (Nexar), FindChips. Good for finding secondary
distributors and a quick multi-source view.

- Observed 2026-09: Nexar's free evaluation tier was 100 matched parts for the
  lifetime of the key, counted per part returned, never reset. Query one part
  at a time, last, and stop when a quota is exhausted.

## Marketplaces

Examples: Amazon, AliExpress. Good for module and dev-board SKUs no
distributor lists.

- Listings rarely give an MPN; never infer one from a title.
- The seller and the silicon can change under the same listing. Treat a
  marketplace module's identity as an assumption until the board in hand is
  checked (chip ID register, markings).
- Short links cannot be resolved to a product without following the redirect;
  resolve, do not guess.

## Mechanical and hardware suppliers

Examples: McMaster-Carr, Misumi, Bossard. Good for fasteners, bearings,
shafts, o-rings, extrusion, with dimensioned drawings and often free CAD.

- Usually no API: record the part number and a dated spec snapshot (dimensions
  relied on, material, finish, price, URL, date). A link with no snapshot is
  not evidence.
- Search in catalog language ("socket head cap screw", not "allen bolt") and
  use the category filters: they are the parametric search.
- The durable URL is the part-number URL, never a search-result URL.
- Standard parts (ISO/DIN fasteners) are defined by the standard; the
  supplier's drawing is distributor-authority evidence.

## CAD, footprint and 3D model sources

Recorded as sources (`type: "cad"` in `sources.json`) for whoever needs them:
the `cad` and `circuit` capability providers. **Never as UHD fields**: a
footprint, land pattern or library reference is tool knowledge.

- Manufacturer CAD first; then the distributor's model link; then
  library services (SnapMagic/SnapEDA, Ultra Librarian); then community
  uploads (GrabCAD, Printables) only with a licence stated on the page.
- Community models are unverified: dimensions are often wrong or a different
  revision. Fit checks only, until checked against the manufacturer drawing.
- Licences vary per file. Share-alike terms (for example CC-BY-SA, common for
  models derived from KiCad libraries) can propagate into a deliverable. Copy
  the licence text into the source row, or write "not stated".
- Library-service footprints come at an IPC density level (least, nominal,
  most); the provider that uses them needs to know which.
