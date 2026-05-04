import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { role } = useAuthStore();

  // Redirect if already logged in
  if (role === "admin" || role === "executiveAdmin") { navigate("/admin", { replace: true }); return null; }
  if (role === "client") { navigate("/dashboard", { replace: true }); return null; }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // onAuthStateChanged will update the store; role redirect happens above on re-render
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "auth/invalid-credential" || code === "auth/wrong-password") {
        setError("Incorrect email or password.");
      } else if (code === "auth/user-not-found") {
        setError("No account found with that email.");
      } else {
        setError("Sign-in failed. Please try again.");
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
          <h1 className="text-2xl font-bold text-ink tracking-tight">Optimizers</h1>
          <p className="text-ink/50 text-sm mt-1">Sign in to your dashboard</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-brand border border-ink/10 shadow-[0_1px_3px_rgba(14,28,38,0.04)] p-6 space-y-4">
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}
          <Button type="submit" className="w-full" size="lg" loading={loading}>
            Sign in
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-ink/50">
          <Link to="/forgot-password" className="text-ink hover:text-brand-700 font-medium underline-offset-4 hover:underline">
            Forgot your password?
          </Link>
        </p>
      </div>
    </div>
  );
}
