import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ReactNode } from "react";

// Ported from VC3/GA4-simply-layer's src/components/SortableSection.tsx, re-skinned to
// this app's light theme — logic unchanged.
interface Props {
  id: string; // block key ("section:numbers", "float-2", …) — see blockKey() in lib/ga4Reports/types
  draggable: boolean; // false in client-share / lockView mode
  className?: string;
  children: ReactNode;
}

/** Drag-to-reorder wrapper for a top-level block (a named section or a floating card
 *  group). Adds a grip handle in the corner, and while another block hovers over this
 *  one, a brand-green ring marks it as the swap target — "this is where it lands if released". */
export default function SortableSection({ id, draggable, className, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver, active } = useSortable({
    id,
    disabled: !draggable,
    data: { type: "section" },
  });

  const isDropTarget = isOver && !isDragging && active?.data.current?.type === "section";

  return (
    <section
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={`animate-rise-in relative rounded-2xl border p-4 ${
        isDropTarget ? "border-brand-500 ring-2 ring-brand-500/50" : "border-ink/10"
      } ${className ?? ""}`}
    >
      {draggable && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder section"
          className="focus-ring touch-none absolute right-3 top-3 z-10 flex h-6 w-6 cursor-grab items-center justify-center rounded-md text-ink/50 transition-colors duration-150 hover:bg-ink/5 hover:text-ink active:cursor-grabbing"
        >
          <GripVertical size={15} />
        </button>
      )}
      {children}
    </section>
  );
}
