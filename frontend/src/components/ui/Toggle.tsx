import { cn } from "@/lib/cn";

interface Props {
  checked: boolean;
  onChange: (value: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}

/** Accessible switch (role="switch"). Brand green when on. */
export function Toggle({ checked, onChange, label, disabled, id }: Props) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 text-sm text-ink/80 select-none",
        disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        id={id}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2",
          checked ? "bg-brand-500" : "bg-ink/15"
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}
