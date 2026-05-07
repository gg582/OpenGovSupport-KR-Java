import type { Edge, Node, ReactFlowInstance } from "reactflow";

/** React Flow 내부의 노드/엣지 선택 플래그를 전체 해제. */
export function clearReactFlowSelection(rf: ReactFlowInstance<Node, Edge>) {
  rf.setNodes((nds) => {
    let changed = false;
    const next = nds.map((n) => {
      if (!n.selected) return n;
      changed = true;
      return { ...n, selected: false };
    });
    return changed ? next : nds;
  });
  rf.setEdges((eds) => {
    let changed = false;
    const next = eds.map((e) => {
      if (!e.selected) return e;
      changed = true;
      return { ...e, selected: false };
    });
    return changed ? next : eds;
  });
}
