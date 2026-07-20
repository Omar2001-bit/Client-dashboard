import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./IconButton";

interface Props {
  page: number; // 1-indexed
  pageCount: number;
  onPageChange: (page: number) => void;
  total?: number;
  pageSize?: number;
  className?: string;
}

/** Prev/next pager with a range summary. Extracted from the audit-findings list footer. */
export function Pagination({ page, pageCount, onPageChange, total, pageSize, className }: Props) {
  const hasRange = total != null && pageSize != null;
  const from = hasRange ? (page - 1) * pageSize! + 1 : null;
  const to = hasRange ? Math.min(page * pageSize!, total!) : null;

  return (
    <div className={cn("flex items-center justify-between gap-3 text-xs text-ink/50", className)}>
      <span>
        {hasRange ? `${from}–${to} of ${total}` : `Page ${page} of ${pageCount}`}
      </span>
      <div className="flex items-center gap-1.5">
        <IconButton
          size="sm"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
        <span className="tabular-nums text-ink/70">
          {page} / {pageCount}
        </span>
        <IconButton
          size="sm"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}
