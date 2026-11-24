// Exact world-lifetime identities: canonical decimal Core IDs and String(request.id).
// Each node has at most ten single-digit branches. Insertions copy only their
// path; duplicates return the same root without allocating or visiting history.
export interface ObservationNode {
  readonly present: boolean;
  readonly children: Readonly<Partial<Record<string, ObservationNode>>>;
}
export type ObservationIndex = ObservationNode | null;

export function emptyObservationIndex(): ObservationIndex { return null; }

export function hasObservation(root: ObservationIndex, identity: string): boolean {
  let node = root;
  for (let offset = 0; node !== null && offset < identity.length; offset++) {
    node = node.children[identity[offset]!] ?? null;
  }
  return node?.present === true;
}

export function addObservation(root: ObservationIndex, identity: string): ObservationIndex {
  return insert(root, identity, 0);
}

function insert(node: ObservationIndex, identity: string, offset: number): ObservationNode {
  if (offset === identity.length) {
    return node?.present ? node : { present: true, children: node?.children ?? {} };
  }
  const digit = identity[offset]!;
  const prior = node?.children[digit] ?? null;
  const child = insert(prior, identity, offset + 1);
  return child === prior ? node! : {
    present: node?.present ?? false,
    children: { ...node?.children, [digit]: child },
  };
}
