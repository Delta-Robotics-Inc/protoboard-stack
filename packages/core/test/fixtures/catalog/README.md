# Test copy of a catalog part

`yageo-rc0402.json` is the Yageo RC0402 chip resistor (a parametric series
part: resistance and tolerance are set per placement in
`ChildModuleRef.overrides`), exactly as `protoboard parts add yageo-rc0402`
vendored it from the dev catalog (Protoboard Cloud `protoboard` library,
revision 2, digest
`sha256:d70ebaa9c304ce5ea1aa3a81714ef9116605f15c7e59a89f4f704db44eabaec8`)
on 2026-10-03. Its artifacts (body GLB/STEP, generator) are not copied: the
tests that use it read the definition only.

`vendorCatalogPart` in `../catalog.ts` writes it into a scratch project's
`parts/catalog/` with an origins entry, the way `parts add` does.

This is a fixture, not a parts source: update the part in the catalog and
copy it again.
