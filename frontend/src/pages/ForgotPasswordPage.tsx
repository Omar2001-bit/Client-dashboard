import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { AuthShell } from "@/components/auth/AuthShell";
import { ArrowLeft, CheckCircle } from "lucide-react";
import { API_BASE } from "@/lib/apiClient";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/send-password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Server error");
      }
      setSent(true);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("USER_NOT_FOUND") || msg.includes("user-not-found")) {
        setError("No account found with that email address.");
      } else {
        setError("Could not send reset email. Check the address and try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Reset password"
      footer={
        <Link
          to="/"
          className="mt-4 flex items-center justify-center gap-1 text-sm text-ink/50 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="text-center space-y-3">
          <CheckCircle className="h-10 w-10 text-brand-600 mx-auto" />
          <p className="font-medium text-ink">Check your inbox</p>
          <p className="text-sm text-ink/50">
            A password reset link was sent to <strong>{email}</strong>. It expires in 1 hour.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email address"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" className="w-full" loading={loading}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
