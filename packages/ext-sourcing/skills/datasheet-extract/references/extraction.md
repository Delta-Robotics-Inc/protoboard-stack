# extraction.json and the quote check

`parts/evidence/<id>/datasheet/extraction.json`, schema
`protoboard.extraction/v0`. One file per source document and ordering code;
name it `extraction-<source-id>.json` when a part has more than one document.

```json
{
  "schema": "protoboard.extraction/v0",
  "part": "acme-pf2020-7",
  "ordering_code": "PF2020-7",
  "source": {
    "id": "src_datasheet",
    "title": "ACME PF2020 P-channel MOSFET datasheet, Rev. 3",
    "sha256": "<sha256 of the PDF bytes>"
  },
  "extractor": { "name": "<agent or person>", "model": "<model id, or null for a person>", "created_at": "2026-09-22T11:00:00Z" },
  "fields": [
    {
      "path": "ratings.vds_max",
      "label": "Drain-source voltage, absolute maximum",
      "symbol": "VDSS",
      "value": -20,
      "unit": "V",
      "conditions": null,
      "footnotes": [],
      "evidence": [{ "quote": "Drain-Source Voltage VDSS -20 V", "page": 2 }],
      "status": "stated",
      "note": "Absolute Maximum Ratings table, @TA = +25°C unless otherwise specified"
    },
    {
      "path": "thermal.rth_ja",
      "label": "Thermal resistance junction to ambient",
      "value": null,
      "status": "absent",
      "note": "Not stated for this package in this revision"
    },
    {
      "path": "mechanical.lead_pitch",
      "label": "Terminal pitch",
      "value": 0.95,
      "unit": "mm",
      "evidence": [{
        "kind": "figure", "page": 6, "image": "figures/p6-outline.png",
        "image_sha256": "<sha256 of the crop>", "reading": "e 0.95 BSC"
      }],
      "readings": [
        { "reader": "agent-a", "value": 0.95, "unit": "mm" },
        { "reader": "agent-b", "value": 0.95, "unit": "mm" }
      ],
      "status": "stated"
    }
  ]
}
```

ACME and its part are fictional: the example shows the shape, not facts.

## Fields

| Key | Meaning |
| --- | --- |
| `path` | The design's name for the value (letters, digits, `_`, `.`). Unique in the file. |
| `label` | Our wording; `symbol` is the document's symbol or parameter wording, copied as printed. |
| `value`, `min`, `typ`, `max` | As printed (signs included), never rounded. `value` may be an array of verbatim strings for a list answer. |
| `unit` | The unit the document prints. |
| `conditions` | Measurement qualifiers only. |
| `footnotes` | Footnote text that qualifies the value, copied in full. |
| `evidence` | Text: `{ quote, page }` (page is 1-based). Figure: `{ kind: "figure", page, image, image_sha256, reading }`, no quote; `image` is relative to the extraction file. |
| `readings` | For figure values: one entry per independent reader, `{ reader, value, unit }`. |
| `status` | `stated` (needs evidence), `derived` (needs `derived_from` and `working`), `absent` (value null, no evidence). |
| `note` | Where it was found, which variant or column it applies to. |

## What the checker does

`scripts/quote-check.ts` reads the text layer (`pdftotext -layout`, pages
split at form feeds) and, for each field:

- normalises both sides for differences a careful copy can legitimately have:
  Unicode compatibility forms (ligatures, µ), the various dashes and minus
  signs, curly quotes, runs of whitespace;
- finds each quote on its cited page (grounded), on another page or only when
  case is ignored (weak), or nowhere (ungrounded);
- requires every number the field states (`value`, `min`, `typ`, `max`) in
  one of its quotes, compared as numbers (`3`, `3.0` and `3.00` are one
  figure); a number glued to a preceding letter is a part number and does not
  count (`AD1000`), except a dimension chain (`2.5x3.0`); a minus sign counts
  unless it joins two tokens (`4.5-5.5`, `SOT-23`). A thousands-grouped figure
  (`1,000`, `10,000 h`) counts both as the whole number and as its groups,
  because a comma list (`10,100,1000 Hz`) looks the same; a decimal comma
  (`2,5 V`) is not recognised and leaves the field weak. String values must
  appear in a quote. A missing number makes the field weak;
- for figure evidence, checks the cited page exists, the crop exists and
  hashes to `image_sha256`, that no reader appears twice, and whether two or
  more readers agree with the value within 0.5 %. A crop that is not on this
  machine cannot be hashed, so the figure half is at best `weak`. Nothing
  ties the crop to a region of the cited page; the reader of the crop does
  that;
- a mixed field (quote and figure) takes the stronger of the two verdicts, so
  a quote that names a parameter and a figure that gives its number can be
  `visual`. Two exceptions: an invalid figure citation makes the field
  `invalid`, and a quote that is not in the document keeps it `ungrounded`
  whatever the figure says.

It writes `protoboard.quote-check/v0` with a verdict and notes per field and a
summary. It is page-level only: it cannot tell which table cell or column a
number sat in.

The approach (a value proved by a verbatim quote that ordinary code finds in
the document, with figures handled by independent readings) follows a
datasheet pipeline adopted after a 24-document trial on 2026-09-22: grounding
recall 458 of 469 stated values against a structure-aware parse, and every
seeded transposed digit and wrong-page citation caught (provenance in the
package README). That trial measured the original, fuller checker; this one is
a smaller re-implementation against the `pdftotext` text layer and has not been
scored on that corpus.
