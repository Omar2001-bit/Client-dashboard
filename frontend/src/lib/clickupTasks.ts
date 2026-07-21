import type { ClickUpList, ClickUpTask } from "@/types";

export interface ClickUpTaskNode extends ClickUpTask {
  children: ClickUpTaskNode[];
}

export interface ClickUpListGroup {
  id: string;
  name: string;
  tasks: ClickUpTaskNode[];
}

const UNASSIGNED_LIST_ID = "__unassigned__";

/** Nests same-list tasks into a parent/child tree via `parentId`. A task whose parentId
 *  points outside this array (parent closed/filtered/in another list) becomes a top-level
 *  node instead of being silently dropped. */
function buildTaskTree(tasks: ClickUpTask[]): ClickUpTaskNode[] {
  const nodes = new Map<string, ClickUpTaskNode>(tasks.map((t) => [t.id, { ...t, children: [] }]));
  const roots: ClickUpTaskNode[] = [];
  tasks.forEach((task) => {
    const node = nodes.get(task.id)!;
    const parent = task.parentId ? nodes.get(task.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });
  return roots;
}

export function countTaskNodes(nodes: ClickUpTaskNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countTaskNodes(node.children), 0);
}

/** Groups flat clickup.tasks into ClickUp's own List structure, in the folder's real
 *  list order (clickup.lists), including lists with zero tasks. Falls back gracefully
 *  for any task whose listId isn't in clickup.lists yet (data synced before this
 *  feature shipped). */
export function groupTasksByList(tasks: ClickUpTask[], lists: ClickUpList[]): ClickUpListGroup[] {
  const byListId = new Map<string, ClickUpTask[]>();
  tasks.forEach((task) => {
    const key = task.listId || UNASSIGNED_LIST_ID;
    if (!byListId.has(key)) byListId.set(key, []);
    byListId.get(key)!.push(task);
  });

  const knownIds = new Set(lists.map((l) => l.id));
  const groups: ClickUpListGroup[] = lists.map((list) => ({
    id: list.id,
    name: list.name,
    tasks: buildTaskTree(byListId.get(list.id) ?? []),
  }));

  const orphanIds = [...byListId.keys()].filter((id) => id !== UNASSIGNED_LIST_ID && !knownIds.has(id));
  orphanIds
    .sort((a, b) => (byListId.get(a)?.[0]?.listName ?? "").localeCompare(byListId.get(b)?.[0]?.listName ?? ""))
    .forEach((id) => {
      const listTasks = byListId.get(id) ?? [];
      groups.push({ id, name: listTasks[0]?.listName || "Other tasks", tasks: buildTaskTree(listTasks) });
    });

  const unassigned = byListId.get(UNASSIGNED_LIST_ID) ?? [];
  if (unassigned.length > 0) {
    groups.push({ id: UNASSIGNED_LIST_ID, name: "Unassigned", tasks: buildTaskTree(unassigned) });
  }

  return groups;
}
