# CAD and UHD geometry integration

Status: product direction captured; prototype and detailed design pending.

## Goal

CAD integration is a central framework capability. The chosen CAD extension
should inject UHD module and interface context into the CAD experience and
display those entities in relation to actual geometry. The eventual 3D view is
a spatial visualization of the UHD graph: modules, interfaces, and harnesses.
Opening an attached STEP file is a useful first step, but does not fulfill this
integration goal by itself.

Zoo.dev is a candidate to investigate. Onshape integration and a standalone STEP
viewer are also possible prototype paths. No CAD provider is selected, and no
provider's support for embedding, semantic overlays, or stable geometry identity
is assumed. Evaluate those capabilities in a focused prototype before choosing
the full integration architecture.

## Viewer design prerequisite

Before implementing the UHD viewer, draw the proposed interactions and
architecture and settle the design decisions. This document records the
direction, not a completed viewer design. This prerequisite applies to the
viewer milestone, not to independent headless framework or catalog work.

Decide hierarchy navigation, selection, diagnostics, artifact navigation, and the
relationship between the system diagram, CAD environment, and eventual 3D graph.
Record which interactions the first prototype must prove and which belong to the
later integrated viewer. Do not treat the prototype as approval of a production
viewer architecture.

## Required geometry semantics

| UHD entity | Spatial representation |
| --- | --- |
| Module instance | Its body or assembly geometry placed in the assembly coordinate frame; repeated instances remain individually identifiable. |
| Interface with physical geometry | Associated faces, edges, points, bodies, or other provider-supported geometric selections, including placement/orientation where applicable. |
| Parent interface without its own geometry | Group the mapped geometries of descendant interfaces. Do not invent a physical surface for the parent. |
| Interface without any physical representation | Remains inspectable as a logical entity; no geometry is fabricated for display. |
| Harness | Associated connection geometry where available, with endpoints bound to UHD interfaces; representation is not restricted to electrical wires. |

For an I2C group whose parent has no geometry, selecting it highlights the mapped
individual child pins together. Recursive groups collect mapped descendants;
missing mappings remain explicit, and shared selections should not be duplicated.
If a parent also has geometry, the design must settle how direct and descendant
representations are shown and distinguished.

Future harness examples include routed wires/cables and a bolt connecting two
plate modules. Preserve UHD's connectivity semantics while associating physical
geometry, attachment locations, and routing where available. Do not assume every
harness is a curve or that every module/interface/harness has geometry.

## Proposed integration boundary

Keep geometry in the CAD system. Prototype a versioned binding document alongside
the CAD artifact, mapping stable UHD module instance paths, interface references,
and harness references to CAD document/revision/entity selections. Include the
artifact identity, units, coordinate frames, and assembly transforms needed to
interpret a selection. This is a proposal to validate, not an existing UHD API.

Provider adapters resolve those references and expose selection/highlighting.
Aim for selection in either the UHD view or CAD view to identify the same entity.
Propagate UHD labels, hierarchy, and interface context into the CAD experience;
CAD remains authoritative for shape and geometric operations. Editing geometry
must not silently rewrite logical interfaces or connectivity.

A geometry edit may invalidate a binding. Detect stale, missing, or ambiguous
references and request explicit remapping rather than attaching an interface to
the wrong face. Pin bindings to artifact revisions and preserve them in releases.
Determine through the prototype which concepts should eventually be shared UHD
extensions and which remain provider-specific mapping data. Avoid forcing a
provider's geometry identifiers into UHD core prematurely.

## Prototype and subsequent integration

After the viewer design prerequisite, build a narrow CAD/UHD prototype using one
chosen path. Demonstrate a module body, one directly mapped physical interface,
and an I2C-style parent highlighting its child pin geometries. Include an unmapped
logical interface and repeated module instances. Verify selection/context display
and stale-binding behavior against actual geometry.

Use the quadcopter frame and mounting interfaces for project relevance; a small
pin-group fixture can exercise recursive interfaces separately. Record where the
selected provider supports or prevents the desired interaction.

Use the prototype findings to design the full integrated CAD viewer. Later,
visualize assembly-wide module geometry and harness geometry, including both a
wire connection and the bolt-between-plates example. Geometric visualization is
not itself a claim of routing feasibility, mechanical fit, or manufacturability;
those require separately identified checks.

## Open design questions

- The desired diagrams for the system viewer and spatial viewer.
- Initial CAD provider and whether context is injected into its UI or composed
  alongside an embedded viewer.
- Entity naming, coordinate frames, and reference persistence after CAD edits.
- Selection behavior for parent geometry, child geometry, and overlapping groups.
- Harness geometry ownership, routing edits, endpoint attachments, and how a
  physical fastener representation relates to its UHD connection.
- Minimum prototype versus full 3D viewer scope and their acceptance examples.
