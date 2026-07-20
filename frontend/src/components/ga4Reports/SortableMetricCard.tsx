import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";

// Ported from VC3/GA4-simply-layer's src/components/SortableMetricCard.tsx, re-skinned
// to this app's light theme — logic unchanged.
interface Props {
  id: string; // globally unique sortable id — see entryKey() in lib/ga4Reports/types
  data: Record<string, unknown>; // opaque passthrough, read back in onDragEnd via active.data.current
  draggable: boolean; // false in client-share / lockView mode
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

/** Wrapper for a single entry card/row, used across every card container (entry
 *  sections and floating groups). The card body is a click target (jumps the graph to
 *  its metric) with a green hover outline; dragging happens from the grip icon that
 *  fades in on hover, so click and drag never fight over the same gesture. While
 *  another card hovers over this one mid-drag, a solid green ring marks it as the swap target. */
export default function SortableMetricCard({ id, data, draggable, onClick, className, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver, active } = useSortable({
    id,
    disabled: !draggable,
    data,
  });

  const isDropTarget = isOver && !isDragging && active?.data.current?.type === "card";

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      onClick={onClick}
      className={`group relative rounded-xl transition-shadow duration-100 ${
        isDropTarget ? "ring-2 ring-brand-500" : "hover:ring-1 hover:ring-brand-500/60"
      } ${className ?? ""} ${onClick ? "cursor-pointer" : ""}`}
    >
      {draggable && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          aria-label="Drag to move card"
          className="focus-ring touch-none absolute right-1 top-1 z-10 flex h-5 w-5 cursor-grab items-center justify-center rounded bg-white/90 text-ink/50 opacity-0 shadow-sm transition-opacity duration-100 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
        >
          <GripVertical size={12} />
        </button>
      )}
      {children}
    </div>
  );
}
