"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

export function LoginForm() {
  const supabase = createBrowserSupabaseClient();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }
    router.push("/dashboard");
  };

  const handleSignUp = async () => {
    setLoading(true);
    setError(null);
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password
    });
    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }
    router.push("/dashboard");
  };

  return (
    <Card className="w-full max-w-lg space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-slate/60">Quebec Outreach Desk</p>
        <h1 className="text-2xl font-semibold text-slate">Welcome back</h1>
        <p className="mt-2 text-sm text-ink/70">
          Sign in to manage leads, run scrapes, and send manual outreach emails.
        </p>
      </div>
      <form className="space-y-4" onSubmit={handleSignIn}>
        <div className="space-y-2">
          <Label>Email</Label>
          <Input
            type="email"
            placeholder="you@agency.ca"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Password</Label>
          <Input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>
        {error ? <p className="text-sm text-maple">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </Button>
      </form>
      <div className="flex items-center justify-between gap-4 text-sm text-ink/70">
        <span>New here?</span>
        <Button variant="outline" onClick={handleSignUp} disabled={loading}>
          Create account
        </Button>
      </div>
    </Card>
  );
}
