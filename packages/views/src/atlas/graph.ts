/**
 * What the Atlas renderer draws (sim.ts, draw.ts, the engine): a graph of
 * nodes and links, whatever it indexes. The Atlas gives it the project index
 * (`AtlasGraph`, whose nodes are `MapNode`s as they are); the System Map
 * gives it the stack's items (sysmap/model.ts). A `MapSpec` says what the
 * renderer cannot read from a node: a kind's name, a group's title.
 *
 * Pure, no DOM.
 */
import { ATLAS_KINDS } from "@protoboardai/core/atlas";

/** How a node is drawn: filled; hollow with a dashed outline; hollow with a solid one. */
export type NodeLook = "fill" | "dashed" | "hollow";

export interface MapNode {
  id: string;
  /** Its kind or type: what its color and shape are chosen by (Appearance). */
  kind: string;
  label: string;
  /** A path the search matches (a project file, a stack file). */
  path?: string;
  /** The group "Pull together by folder" pulls it into (the Atlas: its folder; the System Map: its island). */
  folder: string;
  /** A hub: its label in capitals, a step stronger with "Color by type" off. The Atlas's modules are hubs without it. */
  hub?: boolean;
  /** How it is drawn; absent: the Atlas's rule (an unlinked file dashed, everything else filled). */
  look?: NodeLook;
  /** The chip after its name (labels.ts `chipText`): a version, else a file's extension. */
  version?: string;
  file?: { ext: string };
  /** The project's root system (drawn at least `ROOT_MIN_R`). */
  definition?: { root?: true };
}

export interface MapEdge {
  from: string;
  to: string;
  type: string;
}

export interface MapGraph<N extends MapNode = MapNode> {
  nodes: N[];
  edges: MapEdge[];
}

/** What the renderer asks of a graph's own vocabulary. */
export interface MapSpec {
  /** A kind's plural label and singular noun (the search, a kind group's title). */
  kind(kind: string): { label: string; one: string } | undefined;
  /** A group's title for a key "<pullBy>:<value>" (the folder's path in the Atlas, an island's name in the System Map). */
  groupName(key: string): string;
  /** Folder groups titled by their path's last segment (the Atlas), or by `groupName` (the System Map). */
  folderTitles: "paths" | "names";
  /** Title every group, however small on screen (the System Map's islands are few and each is named); else only those large enough. */
  titleAll?: boolean;
  /** More text a search matches (a purpose), lowercased by the caller. */
  searchText?(node: MapNode): string;
}

/** The Atlas's vocabulary: its kinds, its folders. */
export const ATLAS_SPEC: MapSpec = {
  kind: (k) => ATLAS_KINDS[k as keyof typeof ATLAS_KINDS],
  groupName(key) {
    if (key === "unlinked") return "Unlinked files";
    const at = key.indexOf(":");
    const type = key.slice(0, at);
    const value = key.slice(at + 1);
    if (type === "kind") return ATLAS_KINDS[value as keyof typeof ATLAS_KINDS]?.label ?? value;
    return value || "(project folder)";
  },
  folderTitles: "paths",
};
