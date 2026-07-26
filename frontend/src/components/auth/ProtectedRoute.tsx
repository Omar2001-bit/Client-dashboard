import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";
import { Spinner } from "@/components/ui/Spinner";
import type { UserRole } from "@/types";

interface Props {
  allowedRole: UserRole;
  redirectTo?: string;
}

export function ProtectedRoute({ allowedRole, redirectTo = "/" }: Props) {
  const { user, role, loading } = useAuthStore();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner className="h-10 w-10 text-brand-600" />
      </div>
    );
  }

  const hasAccess =
    !!user &&
    (role === allowedRole || (allowedRole === "admin" && role === "executiveAdmin"));

  if (!hasAccess) {
    return <Navigate to={redirectTo} replace />;
  }

  return <Outlet />;
}
