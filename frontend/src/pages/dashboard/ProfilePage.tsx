import { useState } from "react";
import { track } from "@/lib/activityTracker";
import { updatePassword } from "firebase/auth";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";
import { auth } from "@/lib/firebase";
import { useAuthStore } from "@/store/authStore";

export function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage("");
    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setMessage("Passwords do not match.");
      return;
    }
    if (!auth.currentUser) {
      setMessage("Sign in again before changing your password.");
      return;
    }
    setSaving(true);
    try {
      await updatePassword(auth.currentUser, password);
      track({ type: "password_changed", metadata: { success: true } });
      setPassword("");
      setConfirm("");
      setMessage("Password updated.");
    } catch {
      setMessage("Could not update password. Sign out and sign in again, then retry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink">Profile</h1>
        <p className="mt-1 text-sm text-ink/50">{user?.email}</p>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-ink">Change Password</h2>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="New password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <Input
              label="Confirm password"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
            {message && <Alert tone="info">{message}</Alert>}
            <Button type="submit" loading={saving}>Update Password</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
