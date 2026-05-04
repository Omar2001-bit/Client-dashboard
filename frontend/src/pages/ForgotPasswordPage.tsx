import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";
import { ArrowLeft, CheckCircle } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

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
      const res = await fetch(`${API_URL}/api/send-password-reset`, {
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
    <div className="min-h-screen bg-[#f7fafb] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="p-3 bg-ink rounded-2xl mb-4 text-brand-500">
            <Logo variant="mark" className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">Reset password</h1>
        </div>

        <div className="bg-white rounded-brand border border-ink/10 shadow-[0_1px_3px_rgba(14,28,38,0.04)] p-6">
          {sent ? (
            <div className="text-center space-y-3">
              <CheckCircle className="h-10 w-10 text-green-500 mx-auto" />
              <p className="font-medium text-gray-900">Check your inbox</p>
              <p className="text-sm text-gray-500">
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
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full" loading={loading}>
                Send reset link
              </Button>
            </form>
          )}
        </div>

        <Link
          to="/"
          className="mt-4 flex items-center justify-center gap-1 text-sm text-ink/50 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
