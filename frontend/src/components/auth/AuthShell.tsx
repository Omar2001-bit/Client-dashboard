import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Logo } from "@/components/ui/Logo";

interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-ink rounded-2xl mb-4 text-brand-500">
            <Logo variant="mark" className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">{title}</h1>
          {subtitle && <p className="text-ink/50 text-sm mt-1">{subtitle}</p>}
        </div>

        <Card className="p-6">{children}</Card>

        {footer}
      </div>
    </div>
  );
}
