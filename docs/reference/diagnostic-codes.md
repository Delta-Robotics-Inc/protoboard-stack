# Diagnostic codes in plain words

The plain words every finding carries for people, next to its raw `message` (wave R2, D3 and D7 of the
2026-11-01 walkthrough). Kevin: "the DRC can flag something with a lot of technical information, but the agent
interprets that; a title and a small description".

- `title`: what is wrong, at most 60 characters (DEFAULT), e.g. "I2C line has no pull-up".
- `summary`: one sentence of at most 160 characters (DEFAULT) that a mechanical engineer understands, with the human
  names of the parts, links and nets.
- `message`: the raw text the validator wrote, unchanged, for the Inspector's detail and for agents.

`protoboard check --format json`, the build's bundle (`.protoboard/build/uhd-bundle.json`, read by the 3D view's
callouts) and the `project_check` MCP tool carry all three. `summary` is for people: an agent reads `message` and
`code`, and may rewrite `summary` for the person it talks to.

What a code means and what to do about it stays in ext-hardware's reference
(`packages/ext-hardware/skills/system-compose/references/diagnostic-codes.md`); this page holds only the plain words.

## How the rows are used

- One row per code, or per variant of a code: `` `UHD_LINK_STATE` incompatible `` is used when the message says the
  link is incompatible, the code's own row otherwise. The variants are named by the code's extractor in
  `packages/core/src/findings-text.ts`.
- `{name}` is filled from the finding. `[[...]]` is optional: it is dropped when a placeholder inside it has no value.
  When a placeholder outside `[[...]]` has no value, the finding falls back to the code's own row, then to a title
  made from the code name and the message's first sentence.
- A code with no row gets a title from its code name (`UHD_SUPPLY_BUDGET` reads "Supply budget") and its message's
  first sentence. `packages/core/test/findings-text.test.ts` lists every emitted code without a row.
- The rows are copied into `packages/core/src/findings-text-table.ts`; the same test fails when the copy and this
  page differ. After editing this page, run
  `UPDATE_FINDINGS_TEXT=1 npx vitest run packages/core/test/findings-text.test.ts` to rewrite the copy.

## Placeholders

| Placeholder | Filled with |
| --- | --- |
| `{subject}` | What the finding names, as a person reads it: a part or module by its name ("12 V 3 A wall adapter"), a link by its ends ("12 V barrel plug (12 V 3 A wall adapter) to 12 V DC jack (Mainboard B1_4)"), an interface as "(interface) on (part)", a definition by its name. |
| `{link}` | The link a finding is on, named the same way (a harness run: "(cable): (one end) to (other end)"). |
| `{a}`, `{b}` | The two ends a link finding names, by their interface names. |
| `{board}` | The board module a board finding is on, by its name. |
| `{net}`, `{line}` | A board net by its name, and for I2C "clock line" (SCL) or "data line" (SDA). |
| `{iface}`, `{source}`, `{parent}`, `{pin}`, `{what}` | An interface as "(interface) on (part)". |
| `{part}`, `{device}`, `{stack}` | A part, a bus device, a fastener stack, by name. |
| other | Numbers and words read from the message: `{count}`, `{limit}`, `{need}`, `{cap}`, `{pct}`, `{peak}`, `{cont}`, `{burst}`, `{ratio}`, `{far}`, `{face}`, `{share}`, ... |

## Framework: loading and resolution (`protoboard/*`)

| Code | Title | In one sentence |
| --- | --- | --- |
| `PB_SOURCE_LOAD_FAILED` | A source file does not load | {subject} stopped with an error when it was read, so nothing in it is used until the error is fixed. |
| `PB_DEFINITION_INVALID` | Part has a malformed interface list | {subject} has an entry in its interface list that is not a single interface, so the part is left out until that entry is fixed. |
| `PB_SOURCES_IN_CATALOG` | Project file list reaches downloaded parts | The project settings file points at the downloaded parts folder; those files are not loaded as project code, so narrow the file list. |
| `PB_STACK_REPLACE_REFUSED` | Installed Protoboard copy not replaced | Another build of the same Protoboard version is already installed; replace it only if you trust where the new file came from. |
| `PB_ROOT_NOT_FOUND` | Top-level assembly not found | The project settings file names a top-level assembly that does not exist, so fix the name it points to. |
| `PB_DUPLICATE_DEFINITION` | Two parts share the same ID | {subject} uses an ID that another part already has, such as a downloaded part and a local edit of it; give the edit its own ID. |
| `PB_UNRESOLVED_DEFINITION` | Part used but defined nowhere | {subject} refers to a part that is defined nowhere; add the part, create it locally or fix the ID, as system checks wait on it. |
| `PB_CONTAINMENT_CYCLE` | Module contains itself | {subject} contains itself through its own sub-assemblies; break the loop, since the system checks cannot run until then. |
| `PB_INVALID_ENDPOINT` | Connection end points at nothing | One end of {subject} names a part or interface that does not exist or is not shared by its sub-assembly; system checks wait on it. |
| `PB_UNKNOWN_HARNESS` | Connection names a cable that is not there | {subject} names a cable that is not part of the same assembly, so add the cable or fix its name. |
| `PB_MISSING_ARTIFACT` | Local design file is missing | A local file of {subject}, such as its CAD or generated body, is missing; regenerate it or fix where the file is expected. |
| `PB_ARTIFACT_PATH_UNSAFE` | Part file location unsafe or oddly written | {subject} names a file outside its own folder or writes the location oddly; the file is ignored, and an unsafe one means restore the part. |
| `PB_ARTIFACT_UNAVAILABLE` | Optional file not on this computer | An optional file of {subject} is not stored on this computer; that is fine for now, but fetch it before a release that needs it. |
| `PB_MODEL_MISSING` | Part has no 3D model | {subject} has no 3D model, so the viewer draws an amber box[[ of {size}]] in its place until one is found. |
| `PB_MODEL_PLACEHOLDER` | Drawn as a stand-in | {subject} is a declared stand-in: it is drawn and counted as a placeholder until the real part's model is known. |
| `PB_MODEL_SIZE_MISMATCH` | 3D model size looks wrong | The 3D model of {subject} does not match the size its package states; check the model's units and scale. |
| `PB_MODEL_SIZE_MISMATCH` scale | 3D model is the wrong scale | The 3D model of {subject} is {ratio} times the size its package states[[ ({pkg})]]; its scale or units are probably wrong. |
| `PB_MODEL_SIZE_MISMATCH` side | 3D model does not match the package | The 3D model of {subject} measures {model} on its {side} where the package states {pkg}. |
| `PB_MODEL_ORIENTATION` | Model may be upside down | The 3D model of {subject} does not sit on its board the way a mounted part does; check its rotation in the board's 3D export. |
| `PB_MODEL_ORIENTATION` through | Model may be upside down | The 3D model of {subject} passes {far} through the board's {face} face; it may be upside down or mirrored. |
| `PB_MODEL_ORIENTATION` sunk | Model may be upside down | The 3D model of {subject} sits mostly inside the board ({share} of its height); it may be upside down or placed too low. |
| `PB_PART_FILE_NOT_CACHED` | Part file not downloaded on this computer | A recorded maker file of {subject} is not on this computer, as on a fresh copy of the project; fetch the part files to restore it. |
| `PB_PART_FILE_MISMATCH` | Part file changed since download | A recorded maker or imported file of {subject} no longer matches its saved fingerprint; fetch it again or record the new file on purpose. |
| `PB_PART_SOURCES_INVALID` | Part file record is unreadable | The record of part files cannot be read, is too large, or refers to an entry it does not list, so fix the record. |
| `PB_PACKAGE_SCOPE_RENAMED` | Project uses the old package name | The project still uses the old package name @protoboard/, which no longer belongs to Protoboard; change it to @protoboardai/ everywhere. |
| `PB_BOM_SETTINGS_INVALID` | Bill of materials settings unreadable | The bill of materials settings, with the build quantity and chosen offers, cannot be read; fix them, or delete the file and set them anew. |
| `PB_FX_RATES_INVALID` | Currency rate table unreadable | The project's own currency rate table cannot be read; fix it, or delete it so the bill of materials uses the built-in dated rates. |
| `PB_EXTENSION_NOT_INSTALLED` | Add-on listed but not installed | The project settings file lists {subject}, an add-on that is not installed; check the name before installing anything. |
| `PB_EXTENSION_NO_MANIFEST` | Package is not a Protoboard add-on | {subject} has no Protoboard add-on description, so it is not a Protoboard add-on; remove it from the project's add-on list. |
| `PB_EXTENSION_MANIFEST_INVALID` | Add-on description is broken | {subject} has a broken add-on description, such as a missing field or a duplicate ID; fix it or report it to the add-on's author. |
| `PB_EXTENSION_INCOMPATIBLE` | Add-on needs another Protoboard version | {subject} needs a different version of Protoboard or its hardware description library; install versions that match. |
| `PB_EXTENSION_VIEW_DUPLICATE` | Two add-ons add the same viewer tab | Two add-ons add a viewer tab with the same name, so the second one is ignored; rename one tab or drop one of the add-ons. |
| `PB_EXTENSION_SKILL_DUPLICATE` | Two add-ons add the same agent skill | Two add-ons add an agent skill with the same name, so the agent cannot read or use either one; remove one of the add-ons. |

## Framework: parts and the cloud catalog (`protoboard/catalog`)

| Code | Title | In one sentence |
| --- | --- | --- |
| `PB_ORIGIN_MISSING` | Downloaded part has no origin record | {subject} sits among the downloaded parts with no record of where it came from; add it through Protoboard rather than copying files in. |
| `PB_DIGEST_MISMATCH` | Downloaded part changed since download | {subject} no longer matches the copy that was downloaded; download it again, or make a local variant to change the part. |
| `PB_CATALOG_PARSE` | Downloaded part file is broken | The downloaded file of {subject} is broken and cannot be read; download that part revision again. |
| `PB_CATALOG_FILE_MISSING` | Downloaded part file is missing | The downloaded file of {subject} is missing; download that part revision again. |
| `PB_VENDORED_FILE_MISMATCH` | File that came with a part was changed | A file that came with {subject}, such as its CAD or evidence, no longer matches its fingerprint; restore the part or make a local variant. |
| `PB_VENDORED_FILE_MISSING` | File that came with a part was deleted | A file that came with {subject} has been deleted; adding the same part revision again restores it. |
| `PB_CATALOG_LAYOUT_EARLIER` | Downloaded parts use the old folder layout | Downloaded parts use the folder layout of Protoboard 0.1.6 or earlier, too long for Windows in nested projects; they load, but migrate them. |
| `PB_SOURCE_DRIFT` | Downloaded part's source was edited | The source of {subject} no longer gives the part that was downloaded, so the saved copy is built; restore it or copy it as a new part. |
| `PB_SOURCE_EDITED` | Downloaded part's source has cosmetic edits | The source of {subject} differs from the download only in comments or formatting and still gives the same part; nothing is wrong. |
| `PB_SOURCE_LOAD_FAILED` | Downloaded part's source does not load | The source of {subject} fails to run, so the saved copy of the part is used; restore it by adding the same revision again. |
| `PB_SOURCE_LINT` | Downloaded part's source uses forbidden code | The source of {subject} uses something not allowed, such as outside access, so it is not run and the saved copy is used; restore it. |
| `PB_SOURCE_FILE_MISSING` | Downloaded part's source file deleted | A source file of {subject} was deleted, so the saved copy of the part is used; adding the same revision again restores it. |
| `PB_SOURCE_UHD_RANGE` | Part needs another hardware library version | {subject} is written for a hardware description library version outside the project's; pin a matching version or update the part. |
| `PB_SOURCE_UHD_UNKNOWN` | Project sets no hardware library version | {subject} needs a given range of the hardware description library, but the project has none; pin a version in that range. |
| `PB_SOURCE_TS_RANGE` | Part written for another TypeScript version | The project's TypeScript version is outside the range {subject} is written for; pin a matching TypeScript version in the project. |
| `PB_SOURCE_TS_UNPINNED` | Project does not pin a TypeScript version | The project does not fix a TypeScript version to check {subject} against; pin one in the project's package file. |
| `PB_UHD_PIN` | Installed hardware library differs from pin | The project pins one hardware description library version but another is installed and was used; reinstall, or move the pin. |

## Framework: capabilities and standard outputs (`protoboard/capabilities`, `protoboard/standard-outputs`)

| Code | Title | In one sentence |
| --- | --- | --- |
| `PB_CAPABILITY_CONFIG_INVALID` | Board or CAD settings file is broken | The board or CAD settings file of {subject} does not run, names no design tool, or sets an invalid process; fix the file. |
| `PB_CAPABILITY_CONFIG_UNKNOWN_KEY` | Unknown entry in a board or CAD settings file | The board or CAD settings file of {subject} has a top-level entry it does not know; tool-specific settings go in the constraints section. |
| `PB_CAPABILITY_MODULE_NOT_FOUND` | Settings file finds no module | A board or CAD settings file has no module in its folder or names an unknown one; put the module in that folder or name it. |
| `PB_CAPABILITY_MODULE_AMBIGUOUS` | Settings file folder holds several modules | The folder of a board or CAD settings file holds several modules, so name the one this file designs. |
| `PB_CAPABILITY_DUPLICATE` | Two settings files for the same job | {subject} has two settings files for the same kind of design work; keep one. |
| `PB_CAPABILITY_CONSTRAINT_UNKNOWN` | Setting the design tool does not know | The settings file of {subject} has a setting its design tool does not know; check the spelling in the tool's guide, or remove it. |
| `PB_CAPABILITY_CONSTRAINT_MISSING` | Required design tool setting missing | The settings file of {subject} lacks a setting its design tool requires; add the setting the message names. |
| `PB_PROVIDER_NOT_INSTALLED` | Design tool not installed | The settings file of {subject} names a design tool package that is not installed; check the name before installing anything. |
| `PB_PROVIDER_UNAVAILABLE` | Design tool installed but did not load | The design tool named for {subject} is installed, but its description did not load; see the add-on problem reported with it. |
| `PB_PROVIDER_LACKS_CAPABILITY` | Design tool cannot do this job | The design tool named for {subject} does not do this kind of design work; name a tool that does. |
| `PB_OUTPUT_NOT_EXPORTED` | Output files not exported yet | {subject} has settings for this design work but no exported files yet; generate them, then export. |
| `PB_OUTPUT_STALE` | Exported files changed since export | An exported file of {subject} was edited, added or removed since the last export, so a release refuses it; export again. |
| `PB_OUTPUT_MISSING` | Required output file missing | A required output of {subject} is missing, such as an STL for printing or a DXF for cutting; export again, or change the process or tool. |
| `PB_OUTPUT_MALFORMED` | Exported file is damaged | An exported file of {subject} fails its format check, such as a cut-off Gerber file; export again and never edit outputs by hand. |
| `PB_OUTPUT_UNKNOWN_INSTANCE` | Output lists a part the design lacks | A bill of materials, placement or wiring list row of {subject} names a part it no longer has; regenerate and export again. |
| `PB_OUTPUT_INCOMPLETE` | Component missing from exported files | A component of {subject} is missing from the exported bill of materials or file list; regenerate and export again. |
| `PB_EXTRACT_INVALID` | Facts read back from the design do not fit | Facts the design tool read back from {subject} do not fit the module; read them back again after generating. |
| `PB_VIEW_UNREACHABLE` | Output files have no viewer tab | {subject} has output files on disk, such as a schematic or 3D model, that no viewer tab shows; let the design tool attach them or list them. |

## Framework: the local viewer (`protoboard dev`)

| Code | Title | In one sentence |
| --- | --- | --- |
| `PB_DEV_BUILD_FAILED` | Viewer rebuild failed | The last rebuild after a change failed, so the viewer shows the last good version; fix the error in the message and save. |
| `PB_DEV_DISPLAY_INVALID` | Viewer layout file is broken | The viewer's layout file is not valid, so the last valid layout is kept; fix the file or restore it from version control. |
| `PB_DEV_LAYOUT_NOT_SAVED` | Viewer layout change not saved | A layout change made in the viewer could not be saved, so it lasts only while the page stays open; read the reason given. |

## Framework: the diagram's layout (`protoboard/layout`)

| Code | Title | In one sentence |
| --- | --- | --- |
| `PB_DIAGRAM_LAYOUT` | Diagram is hard to read | A level of the diagram for {subject} is hard to read, with cards in a long strip, overlapping, or many crossing lines; tidy the layout. |

## UHD system rules (`uhd/checkSystem`, code = `UHD_` + rule)

| Code | Title | In one sentence |
| --- | --- | --- |
| `UHD_LINK_STATE` | Link ends do not agree | [[{link}: ]]the two ends of this connection do not agree on what they carry; the detail says which. |
| `UHD_LINK_STATE` incompatible | Link protocols do not match | {a} and {b} share no protocol, so they cannot connect as modelled[[: {link}]]. |
| `UHD_LINK_STATE` partial | Link only partly matches | {a} and {b} match on some lines but not on all of them[[: {link}]]. |
| `UHD_LINK_STATE` unconfigured | Link not set up yet | {a} and {b} are joined, but how they connect is not stated yet[[: {link}]]. |
| `UHD_SUPPLY_BUDGET` | Power budget | [[{subject}: ]]the loads on this supply were added up against what it can deliver. |
| `UHD_SUPPLY_BUDGET` budget | Power budget checked | {source} supplies {need} of the {cap} it can give ({pct})[[; {nodraw} state no draw]]. |
| `UHD_SUPPLY_BUDGET` over | Supply is overloaded | {source} must supply {need} of the {cap} it can give ({pct})[[; {nodraw} state no draw]]. |
| `UHD_SUPPLY_BUDGET` branch | Supply fed from another supply | {source} is fed from {parent}[[ through a {via}]]; its loads are counted there. |
| `UHD_SUPPLY_BUDGET` no-rating | Supply has no current rating | {source} states no current rating, so its {count} cannot be checked against it. |
| `UHD_PROPULSION_CURRENT` | Motor current against ratings | The motors' peak current was compared with the ESC and battery ratings; the detail gives the numbers. |
| `UHD_PROPULSION_CURRENT` pack-continuous | Motors can exceed the battery rating | {motors} motors can draw {peak} together, above the battery's continuous {cont}[[ but within its {burst} burst]]. |
| `UHD_PROPULSION_CURRENT` pack-burst | Motors exceed the battery burst rating | {motors} motors can draw {peak} together, above the battery's {burst} burst rating. |
| `UHD_PROPULSION_CURRENT` pack-ok | Battery covers the motors | {motors} motors draw at most {peak} together, within the battery's continuous rating[[ of {cont}]]. |
| `UHD_PROPULSION_CURRENT` esc | Motor peak above the ESC rating | A motor can peak at {peak}, above its ESC channel's {kind} rating of {rating}. |
| `UHD_BUS_ADDRESS` | Two I2C devices share an address | Two or more devices on the I2C bus of {subject} answer at the same address, so they cannot be told apart. |
| `UHD_BUS_PULLUP` | I2C line has no pull-up | The I2C {line} {net}[[ on {board}]] needs a pull-up resistor to its supply; none is connected. |
| `UHD_NET` | Wiring problem on a net | [[On {board}, ]]a net joins pins in a way that cannot work; the detail says which pins. |
| `UHD_NET` single | Net goes to only one pin | Net {net}[[ on {board}]] reaches only {pin}; nothing else is connected to it. |
| `UHD_NET` fight | Two supplies drive one net | Net {net}[[ on {board}]] is driven by {count} supplies at once; their outputs fight each other. |
| `UHD_NET` short | Ground shorted to a supply | Net {net}[[ on {board}]] joins ground to supply pins: that is a short circuit. |
| `UHD_NET` joined | Two nets joined into one | {what} sits on nets {nets}, which joins them into one conductor. |
| `UHD_NET` shorted-part | Part shorted by its own net | Every terminal of {part} is on net {net}, so it is shorted and does nothing. |
| `UHD_NET` loop | Output wired back to its input | Net {net} ties an output of {part} back to its own input, which shorts the output to the input. |
| `UHD_NET` strap | Setup pin follows a signal | A setup pin ({fn}) shares net {net} with a signal, so its level is not fixed; tie it to a supply or ground. |
| `UHD_NET` overdrive | Signal too high for a pin | Net {net} rises to {level}, but {part} is rated to {rated}; divide, clamp or use an open-drain output. |
| `UHD_NET` range | Net voltage does not match a pin | Net {net} is {design}, but {what} is {other}. |
| `UHD_DESIGN_ENVELOPE` | Larger than the design envelope | {subject} is bigger than its design envelope allows on one axis. |
| `UHD_PASSIVE_OVERRIDE` | Component value not allowed | A value set on {subject} (a resistor, capacitor or similar) is not one the part is made in. |
| `UHD_INTERFACE_REUSE` | Connection point used too many times | {iface} is wired {count}, but it can take only {limit}. |
| `UHD_UNPOWERED` | Input has no power source | {subject} has no power source connected. |
| `UHD_UNPOWERED` rail | Power rail has no supply | Nothing supplies the {net} rail[[ on {board}]], which feeds {loads}. |
| `UHD_UNPOWERED` on-purpose | Left unconnected on purpose | {subject} is left unconnected on purpose: {reason}. |
| `UHD_UNCONNECTED` | Unconnected mark is wrong | {subject} is marked as unconnected, but a link connects it or the part has no such interface. |
| `UHD_HARNESS_CONNECTOR` | Cable does not fit its connection | {subject} uses a cable that is missing or whose connector does not match the end it plugs into. |
| `UHD_FASTENER_TORQUE` | Fastener torque | Tightening torques were checked for the fastener stacks. |
| `UHD_FASTENER_TORQUE` summary | Fastener torques listed | {count} fastener joints have a tightening torque[[; {assumed} are assumed, not stated by a maker]]. |
| `UHD_FASTENER_TORQUE` none | Fastener has no torque | {stack} has no tightening torque on any of its parts. |
| `UHD_FASTENER_TORQUE` uncited | Fastener torque has no source | A torque in {stack} cites no source and states no assumption. |
| `UHD_PROP_HANDEDNESS` | Prop spin direction | Props were checked against the spin direction of their motors. |
| `UHD_PROP_HANDEDNESS` ok | Props match their motors | All {count} props match their motor's spin direction. |
| `UHD_PROP_HANDEDNESS` unknown | Prop spin not set | A prop or its motor has no spin direction set, so the pair cannot be checked. |
| `UHD_PROP_HANDEDNESS` wrong | Prop spins the wrong way | A {prop} prop is on a motor spinning {motor}, so it would push air the wrong way. |
| `UHD_UNKNOWN_CATEGORY` | Unknown part category | {subject} names a part category the catalogue does not know. |

## UHD assembly (`uhd/assemble`)

| Code | Title | In one sentence |
| --- | --- | --- |
| `UHD_ASSEMBLY` | Part does not fit as mated | {subject} does not fit together as its mounting points say: holes, gaps, rotation or hardware length disagree. |
| `UHD_UNPLACED` | Not placed in 3D | {subject} has no mounting point, so it is not placed in the 3D assembly (strapped, glued or loose). |

## Geometry bindings (`uhd/geometryBindings`)

| Code | Title | In one sentence |
| --- | --- | --- |
| `UHD_GEOMETRY_BINDING` | Mounting point lost in the CAD | A mounting or connection point of {subject} no longer matches its CAD: renamed, removed or changed since it was bound. |

## ext-hardware (`ext:@protoboardai/ext-hardware/evidence`)

| Code | Title | In one sentence |
| --- | --- | --- |
| `HW_NO_SOURCES` | Bought part cites no sources | {subject} is a bought part that cites no sources, such as a datasheet or supplier listing; research it and add them. |
| `HW_NOT_VERIFIED` | Part facts not checked yet | {subject} cites sources, but no check of its facts against them is recorded yet; run a verification. |
| `HW_VERIFICATION_WRONG` | Part check found wrong facts | A check of {subject} found wrong facts and no repair is recorded; correct the part and verify it again. |
| `HW_VERIFICATION_REPAIRED` | Wrong facts found and corrected | Wrong facts were found in {subject} and corrected; nothing to do, this is kept as a record. |
| `HW_VERIFICATION_SELF_AUDIT` | Part checked only by its author | {subject} was checked only by the same agent that wrote it; run an independent check and record it as independent. |

## ext-sourcing (`ext:@protoboardai/ext-sourcing/sourcing`)

| Code | Title | In one sentence |
| --- | --- | --- |
| `SRC_RECORD_INVALID` | Supplier record is malformed | The supplier record of {subject} is malformed and cannot be used; fix the record. |
| `SRC_OFFER_INCOMPLETE` | Supplier offer is missing details | A supplier offer for {subject} lacks a supplier, part number, link, date or method; fill in what is missing. |
| `SRC_FORBIDDEN_FIELD` | Supplier record holds order or login data | The supplier record of {subject} holds an order, cart or login field; remove it and keep only the public product link. |
| `SRC_CREDENTIAL_IN_URL` | Product link contains a secret key | A product link for {subject} contains a key; remove it, store the public product link, and never save a login in the project. |
| `SRC_SINGLE_SOURCE` | Part has only one supplier | {subject} has only one supplier and nobody accepted that risk; name an alternate part, or have a named person accept it. |
| `SRC_LOW_STOCK` | Supplier stock is low | {subject} has low supplier stock and nobody accepted that risk; name an alternate part, or have a named person accept it. |
| `SRC_LIFECYCLE` | Part is no longer in active production | {subject} is not in active production, such as end of life, and nobody accepted that; name an alternate, or have a named person accept it. |
| `SRC_NO_OFFER` | No supplier has stock | No supplier offer for {subject} shows stock; check more suppliers, or record a sibling part number as an alternate. |
| `SRC_OFFER_MPN_MISMATCH` | Offer is for a different part number | A supplier offer for {subject} is for another ordering code; check more suppliers, or record that code as an alternate. |
| `SRC_OFFER_MPN_FORMAT` | Offer part number spelled differently | A supplier offer for {subject} differs from the record only in punctuation or a leading zero; it counts once a person confirms it. |
| `SRC_PART_MISMATCH` | Supplier record in the wrong folder | The supplier record of {subject} sits in the wrong folder; move or rename the record. |
| `SRC_UNKNOWN_PART` | Supplier record for an unknown part | A supplier record names a part the project does not define; move or rename the record. |
| `SRC_RISK_ACCEPTED` | Supply risk accepted | A named person accepted a supply risk for {subject}; nothing to do, this is kept as a record. |
| `SRC_STALE` | Supplier offers are old | The newest supplier offer for {subject} is more than 90 days old; check offers again before quoting anything. |
| `SRC_UNVERIFIED` | Supplier search incomplete | Suppliers for {subject} were searched without some sources; close the gap, or say in the record why it stays open. |
| `SRC_NO_CAPABILITY` | Searched suppliers not recorded | The supplier record of {subject} does not say which sources were available; fill that in, or say why it stays open. |
| `SRC_LIFECYCLE_UNKNOWN` | Production status unknown | Whether {subject} is still in active production is not established yet; check the maker's page, or say in the record why not. |
| `SRC_STOCK_UNKNOWN` | Supplier stock unknown | The supplier stock of {subject} is not established yet; find it, or say in the record why it stays open. |

## ext-frame-cad (`ext:@protoboardai/ext-frame-cad/cad:check`, one run per plate; `…/frames`, `…/hardware`)

| Code | Title | In one sentence |
| --- | --- | --- |
| `FRAME_CAD_NOT_CONFIGURED` | Plate has no CAD settings | {subject} is a plate with no CAD settings file; add one that uses the plate generator. |
| `FRAME_CAD_NOT_A_PLATE` | Plate generator set on a non-plate | The plate generator is set up for {subject}, which is not a plate as it states no plate thickness; add it, or use another CAD tool. |
| `FRAME_CAD_NOT_GENERATED` | Plate CAD not generated yet | {subject} is a plate with no generated CAD yet; generate it, then export. |
| `FRAME_CAD_STALE` | Plate CAD out of date | The interfaces or design values of {subject} changed since its CAD was generated; regenerate, then review the mounting points to update. |
| `FRAME_CAD_EXPORT_STALE` | Plate export out of date | The exported files of {subject} were made from other values than its current design; export again. |
| `FRAME_CAD_FRAME_MISMATCH` | Plate mounting point moved | A mounting point of {subject} differs from the generated plate's; if the new plate is right, update the points and check stack-ups. |
| `FRAME_CAD_UNKNOWN_INTERFACE` | Plate CAD names a removed interface | The generated plate of {subject} names an interface it no longer has; regenerate after renaming or removing interfaces. |
| `FRAME_CAD_FRAME_MISSING` | Plate feature has no mounting point | The plate of {subject} has generated geometry for an interface with no mounting point in the model; add the point. |
| `HARDWARE_CAD_PARAMS` | Fastener size missing | {subject} is a fastener missing a size the generator needs, such as diameter, length or head size; add it from the supplier listing. |
| `HARDWARE_CAD_STALE` | Fastener body out of date | The sizes of {subject} changed since its body was generated; generate and export it again. |
| `HARDWARE_CAD_EXPORT_STALE` | Fastener export out of date | The exported files of {subject} were made from other sizes than its current settings; export again. |
| `HARDWARE_CAD_NOT_GENERATED` | Fastener body not generated yet | {subject} is a fastener set up for generation that has no generated sizes yet; generate it. |
| `HARDWARE_CAD_NOT_CONFIGURED` | Fastener has no body or CAD settings | {subject} is a local fastener with no body and no CAD settings file; add a settings file that uses the plate and fastener generator. |
| `PART_CAD_STALE` | Part body script changed | The body script of {subject} changed since it was generated; generate and export it again. |
| `PART_CAD_EXPORT_STALE` | Part body export out of date | The exported files of {subject} come from an earlier generation; generate and export it again. |
| `PART_CAD_CONFIG` | Part CAD settings name no script | The CAD settings file of {subject} names no body script; fix the generator setting, then generate and export. |
| `PART_CAD_NOT_GENERATED` | Part body not generated yet | {subject} has a body script that was never generated; generate and export it. |

## ext-harness-cad (`ext:@protoboardai/ext-harness-cad/cad:check`, one run per cable; `…/routes`)

| Code | Title | In one sentence |
| --- | --- | --- |
| `HARNESS_NOT_CONFIGURED` | Cable has no CAD settings | {subject} is a wire harness with no CAD settings file; add one that uses the cable routing tool. |
| `HARNESS_NOT_ROUTED` | Cable not routed yet | {subject} has no cable route yet; generate it, then export. |
| `HARNESS_ROUTE_STALE` | Cable route out of date | {subject} was routed for other ends, wires, length or build, or an end no longer meets its part; reroute it and the cables after it. |
| `HARNESS_EXPORT_STALE` | Cable export out of date | The exported files of {subject} come from an earlier route; export again. |
| `HARNESS_ROUTE_LENGTH` | Cable length differs from its route | The modelled length of {subject} differs from its routed length; regenerate, or fix the length. |
| `HARNESS_ROUTE_WARNING` | Cable routing problem | The router flagged {subject}, for example for clearance, bend radius or slack; fix the model rather than the drawn route. |
| `HARNESS_NOT_ROUTABLE` | Item cannot be routed as a cable | The cable settings point at {subject}, which this tool cannot route; point them at a wire harness with a cable build defined. |

## ext-enclosure-cad (`ext:@protoboardai/ext-enclosure-cad/cad:check`, one run per enclosure)

| Code | Title | In one sentence |
| --- | --- | --- |
| `ENCLOSURE_NOT_GENERATED` | Enclosure not generated yet | {subject} has no generated enclosure design yet; generate it, then export. |
| `ENCLOSURE_FEATURE_INVALID` | Enclosure feature cannot be read | A feature of {subject} cannot be read by the enclosure generator; build it with the add-on's own feature types, such as openings. |
| `ENCLOSURE_INPUT` | Enclosure model lacks information | The model does not say enough to build {subject}, such as a part with no mounting point or an unplaced enclosure; add what is named. |
| `ENCLOSURE_STALE` | Enclosure design out of date | The contents, features or design values of {subject} changed since it was generated; review the changes, then regenerate. |
| `ENCLOSURE_NATIVE_EDITED` | Enclosure design edited after its build | The design of {subject} was edited after its last build; exporting rebuilds from the edit, generating replaces it from the model. |
| `ENCLOSURE_GENERATOR_STALE` | Enclosure built by another generator version | {subject} was built by another version of the enclosure generator, so a release refuses it; generate, export and review the changes. |
| `ENCLOSURE_FEATURE_MISSING` | Enclosure feature missing | An interface of {subject} has no generated feature, or a feature has no interface; regenerate the enclosure. |
| `ENCLOSURE_FRAME_MISMATCH` | Enclosure mounting point differs | A declared mounting point of {subject} differs from the generated one; regenerate and take the points from the generated design. |
| `ENCLOSURE_GENERATOR` | Enclosure generator reported a problem | The enclosure generator hit a problem with {subject}, such as no room for a plunger flange; move the part or change the feature. |
| `ENCLOSURE_COLLISION` | Part collides with the enclosure | {subject} intersects a wall, boss or column, or a plunger hits a wall or part; regenerate, then move the part or add room. |
| `ENCLOSURE_NOT_CONTAINED` | Part sticks out of the enclosure | {subject} reaches outside the enclosure's inner cavity; regenerate, then move the part or add room, as for a collision. |
| `ENCLOSURE_CLEARANCE` | Part too close to an enclosure wall | {subject} is closer to a wall than the design clearance; raise the clearance, or accept the contact and record it. |
| `ENCLOSURE_FIT_UNCHECKED` | Enclosure fit not rechecked | The contents of {subject} changed but Python is not available to recheck the fit; install the CAD tools, then check again. |
| `ENCLOSURE_THIN_WALL` | Enclosure wall too thin | A wall of {subject} is below the minimum thickness; thicken the wall or lid, make the cut smaller, or move the feature. |
| `ENCLOSURE_MISALIGNED` | Opening not lined up with its part | An opening, window, light pipe or plunger of {subject} is off the axis of the part it serves; that part moved, so regenerate. |
| `ENCLOSURE_RECESS` | Part sits too deep behind its opening | {subject} sits deeper behind its opening than allowed; move it to the wall, or size the opening for the plug's overmold. |
| `ENCLOSURE_PLUNGER` | Button plunger does not work | A plunger of {subject} presses its switch at rest, cannot reach it, or its flange no longer holds; change its gap or travel, or move it. |
| `ENCLOSURE_PLUG_FIT` | Plug does not fit its opening | The plug for {subject} does not pass its opening, or its overmold has no flat seat; resize or move the opening. |
| `ENCLOSURE_SEAL_SQUEEZE` | O-ring squeeze out of range | The O-ring squeeze of {subject} is outside the chart row for its cross-section; choose the AS568 size that fits the groove. |
| `ENCLOSURE_SEAL_FIT` | O-ring overstretched or groove mis-sized | The O-ring of {subject} stretches over 5 % or its face groove is not sized to it; choose another AS568 size. |
| `ENCLOSURE_ENVELOPE` | Enclosure larger than allowed | {subject} is bigger than its allowed size envelope; use thinner walls or a tighter cavity, or revisit the limit with its owner. |

## ext-tscircuit (`ext:@protoboardai/ext-tscircuit/circuit:check`, one run per board)

| Code | Title | In one sentence |
| --- | --- | --- |
| `CIRCUIT_BOARD_UNREADABLE` | Board cannot be turned into a wiring list | {subject} cannot be read as a wiring list, for example a part is undefined or a pin has no designator; fix the board or the part. |
| `CIRCUIT_BOARD_GROUPING` | Board sub-section unused or empty | A sub-section of {subject} offers a connection the board never uses, or adds no parts; connect it, or mark it unconnected with a reason. |
| `CIRCUIT_NOT_BUILT` | Board not generated yet | {subject} has no generated board yet; generate it. |
| `CIRCUIT_STALE` | Board out of date | The design, layout or settings of {subject} changed since the board was generated or exported; generate and export it again. |
| `CIRCUIT_DRC` | Board fails its design rule check | The board design rule check of {subject} found an error; move parts, widen the board or change the rules, then regenerate. |
| `CIRCUIT_NET_OPEN` | Board connection open in the copper | A connection the design calls for is open in the copper of {subject}; regenerate, and never change the design to match the copper. |
| `CIRCUIT_NET_SHORT` | Board connections shorted in the copper | The copper of {subject} joins connections the design keeps apart; regenerate, and never change the design to match the copper. |
| `CIRCUIT_NET_EXTRA` | Extra connection in the board copper | The copper of {subject} has a connection the design does not; regenerate, and never change the design to match the copper. |
| `CIRCUIT_UNROUTED` | Board traces not fully routed | Some connections of {subject} were not routed; regenerate, giving parts room with a larger outline or 4 layers if needed. |
| `CIRCUIT_PIN_MISSING` | Pin missing from the board copper | A pin the design connects is missing from the copper of {subject}; regenerate, and never change the design to match the copper. |
| `CIRCUIT_PAD_UNNETTED` | Extra pads of a pin not connected | A pin of {subject} with several pads, such as exposed ground pads, has pads the copper leaves unjoined; generate and export again. |
| `CIRCUIT_FINGERPRINT_FORMAT` | Board export record in an older format | The export record of {subject} uses an older fingerprint format, so it is not compared for changes; export the board once. |
| `CIRCUIT_FOOTPRINT_FAMILY` | Footprint chosen by package family | The footprint of {subject} was chosen by its package family, with pin count, pitch and size agreeing; confirm it if the part is unusual. |
| `CIRCUIT_FOOTPRINT_MISMATCH` | No footprint fits the part | Footprints for the package of {subject} exist but none fits its pin count, pitch or body size; correct the package facts or add one. |
| `CIRCUIT_VIA_TOUCHING_PAD` | Via touches a pad | A via on {subject} touches a surface-mount pad it does not sit in; move parts a little and regenerate. |
| `CIRCUIT_VIA_UNDER_BODY` | Via under a component | A via on {subject} lies inside a component's keep-clear outline; give the parts room and regenerate. |
| `CIRCUIT_HOLE_CLEARANCE` | Copper too close to a hole | Copper on {subject} is closer to an unplated hole's wall than the clearance rule allows, or inside it; move the copper or the hole. |
| `CIRCUIT_TRACE_WIDTH` | Trace narrower than requested | A connection on {subject} is routed narrower than its requested trace width; give it room, or accept the narrowing. |
| `CIRCUIT_COMPONENT_MISSING` | Component missing from the board | A component in the design of {subject} is not on the board; regenerate the board. |
| `CIRCUIT_COMPONENT_EXTRA` | Extra component on the board | {subject} has a component the design lacks; regenerate, and remove parts added by hand to the board file. |
| `CIRCUIT_OUTSIDE_OUTLINE` | Part off the board edge | A pad of {subject} is off the board or its body overhangs the edge; move the part or enlarge the board outline. |
| `CIRCUIT_KEEPOUT` | Copper in a keep-out area | Copper sits inside a keep-out on {subject}, or a keep-out misses the board; move the part or trace, or fix the keep-out. |
| `CIRCUIT_PLACEMENT_MOVED` | Fixed part has been moved | A part the settings fix in place on {subject} is somewhere else; remove the hand override and regenerate. |
| `CIRCUIT_FOOTPRINT_UNVERIFIED` | Footprint not checked against maker drawing | A footprint on {subject} is not checked against its maker's recommended pattern, or differs from it; the board order waits on it. |
| `CIRCUIT_VIA_IN_PAD` | Via inside a pad | A via on {subject} sits inside a surface-mount pad; move parts and regenerate, or allow it with a fill-and-cap note for the fab. |
| `CIRCUIT_CONFIG_INVALID` | Board setting has a wrong value | A board setting of {subject} has the wrong type or value, such as copper weight; fix the value named, then regenerate. |
| `CIRCUIT_LOCKED` | Board handed off to KiCad | {subject} is locked and KiCad now holds its layout, so the generated board is not checked; review and finish it in KiCad. |
| `CIRCUIT_KICAD_STALE` | KiCad board missing a design change | Since the lock, {subject} changed, such as a part or outline change, and the KiCad board lacks it; make the change in KiCad. |
| `CIRCUIT_KICAD_MODEL_CHANGED` | Connections changed since KiCad handoff | Connections between existing parts of {subject} changed since the lock; make the same change in the KiCad schematic and board. |
| `CIRCUIT_KICAD_FIELDS` | Part details changed since KiCad handoff | A part number, maker, value or LCSC number on {subject} changed since the lock; make the same change in KiCad. |
| `CIRCUIT_KICAD_APPLIED` | Design change already made in KiCad | A design change to {subject} since the lock is in KiCad too; ask, then refresh the lock to record it. |
| `CIRCUIT_KICAD_PART_MISSING` | Part deleted in KiCad only | A part of {subject} was deleted in KiCad but not in the design; undo it in KiCad, or make the change in the design first. |
| `CIRCUIT_KICAD_NET_CHANGED` | Pin moved to another connection in KiCad | A pin of {subject} was moved to another connection in KiCad only; undo it in KiCad, or make the change in the design first. |
| `CIRCUIT_KICAD_PART_EXTRA` | Extra part in KiCad | KiCad has a part on {subject} that the design lacks; add it to the design or remove it in KiCad. |
| `CIRCUIT_KICAD_FOOTPRINT_CHANGED` | Footprint swapped in KiCad | A footprint on {subject} was swapped in KiCad; restore the original footprint. |
| `CIRCUIT_KICAD_NET_RENAMED` | Connection renamed in KiCad | A connection on {subject} was renamed in KiCad; restore its name. |
| `CIRCUIT_KICAD_PARITY` | KiCad schematic and board disagree | The KiCad schematic and board of {subject} disagree; run Update PCB from Schematic in KiCad. |
| `CIRCUIT_KICAD_DRC` | KiCad design rule check failed | KiCad's design rule check of {subject} found errors, unconnected items or warnings; fix the layout in KiCad. |
| `CIRCUIT_VIA_RULES` | Via smaller than the rules | A hand-placed via on {subject} is smaller than the via rules; make it to the rules, or change the rules if the fab can make it. |
| `CIRCUIT_HAND_PAD_JOIN` | Hand-drawn trace joins pads of one pin | A hand-drawn trace on {subject} joins pads of one pin, which generation now does itself; remove the trace, then generate. |
| `CIRCUIT_KICAD_UNREADABLE` | KiCad board file missing or unreadable | The KiCad file of locked board {subject} is missing or cannot be read; restore it from version control or re-save it from KiCad 10. |

## Codes from firmware providers, releases and sections

| Code | Title | In one sentence |
| --- | --- | --- |
| `DRONE_CLI_MISSING` | Flight controller settings file missing | The flight controller's Betaflight settings file is missing for the release; generate it, review the changes, commit, and release again. |
| `DRONE_CLI_STALE` | Flight controller settings out of date | The Betaflight settings file no longer matches the model; generate it again, review the changes, commit, and release again. |
