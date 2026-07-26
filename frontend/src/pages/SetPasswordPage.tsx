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
import { Alert } from "@/components/ui/Alert";
import { AuthShell } from "@/components/auth/AuthShell";
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
    <AuthShell title="Set your password" subtitle="Welcome! Choose a password to access your dashboard.">
      {done ? (
        <div className="text-center space-y-3">
          <CheckCircle className="h-10 w-10 text-brand-600 mx-auto" />
          <p className="font-medium text-ink">All set!</p>
          <p className="text-sm text-ink/50">Redirecting to your dashboard...</p>
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
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" className="w-full" size="lg" loading={loading}>
            Set password &amp; sign in
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
