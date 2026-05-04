import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  isSignInWithEmailLink,
  signInWithEmailLink,
  updatePassword,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";
import { CheckCircle } from "lucide-react";

export function SetPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState(window.localStorage.getItem("emailForSignIn") ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const isValidLink = isSignInWithEmailLink(auth, window.location.href);

  useEffect(() => {
    if (!isValidLink) navigate("/");
  }, [isValidLink, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setError("");
    setLoading(true);
    try {
      const result = await signInWithEmailLink(auth, email, window.location.href);
      await updatePassword(result.user, password);
      window.localStorage.removeItem("emailForSignIn");
      setDone(true);
      setTimeout(() => navigate("/dashboard"), 2000);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "auth/invalid-action-code") {
        setError("This link has expired. Contact your account manager for a new one.");
      } else {
        setError("Failed to set password. Please try again.");
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
          <h1 className="text-2xl font-bold text-ink tracking-tight">Set your password</h1>
          <p className="text-ink/50 text-sm mt-1">Welcome! Choose a password to access your dashboard.</p>
        </div>

        <div className="bg-white rounded-brand border border-ink/10 shadow-[0_1px_3px_rgba(14,28,38,0.04)] p-6">
          {done ? (
            <div className="text-center space-y-3">
              <CheckCircle className="h-10 w-10 text-green-500 mx-auto" />
              <p className="font-medium text-gray-900">All set!</p>
              <p className="text-sm text-gray-500">Redirecting to your dashboard...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                hint="Enter the email you received the invite on"
              />
              <Input
                label="New password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                hint="Minimum 8 characters"
              />
              <Input
                label="Confirm password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              {error && <p className="text-sm text-red-600 bg-red-50 rounded px-3 py-2">{error}</p>}
              <Button type="submit" className="w-full" size="lg" loading={loading}>
                Set password &amp; sign in
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
