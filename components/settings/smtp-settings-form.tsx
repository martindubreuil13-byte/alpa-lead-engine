"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export function SmtpSettingsForm({
  settings
}: {
  settings: {
    smtp_host: string | null;
    smtp_port: number | null;
    smtp_user: string | null;
    smtp_pass: string | null;
    smtp_secure: boolean | null;
    from_name: string | null;
    from_email: string | null;
    signature: string | null;
  } | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    smtp_host: settings?.smtp_host ?? "",
    smtp_port: settings?.smtp_port?.toString() ?? "587",
    smtp_user: settings?.smtp_user ?? "",
    smtp_pass: settings?.smtp_pass ?? "",
    smtp_secure: settings?.smtp_secure ?? false,
    from_name: settings?.from_name ?? "",
    from_email: settings?.from_email ?? "",
    signature: settings?.signature ?? ""
  });
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleChange = (key: string, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        smtp_host: form.smtp_host || null,
        smtp_port: form.smtp_port ? Number(form.smtp_port) : null,
        smtp_user: form.smtp_user || null,
        smtp_pass: form.smtp_pass || null,
        smtp_secure: form.smtp_secure,
        from_name: form.from_name || null,
        from_email: form.from_email || null,
        signature: form.signature || null
      })
    });

    if (!response.ok) {
      const data = await response.json();
      setStatus(data.error ?? "Failed to save.");
      setSaving(false);
      return;
    }

    setStatus("Settings saved.");
    router.refresh();
    setSaving(false);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-3xl border border-white/80 bg-white/90 p-6 shadow-soft">
        <p className="text-xs uppercase tracking-[0.2em] text-slate/60">SMTP</p>
        <div className="mt-4 space-y-3">
          <div className="space-y-2">
            <Label>SMTP host</Label>
            <Input
              value={form.smtp_host}
              onChange={(event) => handleChange("smtp_host", event.target.value)}
              placeholder="smtp.mailprovider.com"
            />
          </div>
          <div className="space-y-2">
            <Label>SMTP port</Label>
            <Input
              value={form.smtp_port}
              onChange={(event) => handleChange("smtp_port", event.target.value)}
              placeholder="587"
            />
          </div>
          <div className="space-y-2">
            <Label>SMTP user</Label>
            <Input
              value={form.smtp_user}
              onChange={(event) => handleChange("smtp_user", event.target.value)}
              placeholder="user@domain.com"
            />
          </div>
          <div className="space-y-2">
            <Label>SMTP password</Label>
            <Input
              type="password"
              value={form.smtp_pass}
              onChange={(event) => handleChange("smtp_pass", event.target.value)}
              placeholder="Your SMTP password"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-ink/70">
            <input
              type="checkbox"
              checked={form.smtp_secure}
              onChange={(event) => handleChange("smtp_secure", event.target.checked)}
            />
            Use secure TLS
          </label>
        </div>
      </div>

      <div className="rounded-3xl border border-white/80 bg-white/90 p-6 shadow-soft">
        <p className="text-xs uppercase tracking-[0.2em] text-slate/60">From details</p>
        <div className="mt-4 space-y-3">
          <div className="space-y-2">
            <Label>From name</Label>
            <Input
              value={form.from_name}
              onChange={(event) => handleChange("from_name", event.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="space-y-2">
            <Label>From email</Label>
            <Input
              value={form.from_email}
              onChange={(event) => handleChange("from_email", event.target.value)}
              placeholder="you@agency.ca"
            />
          </div>
          <div className="space-y-2">
            <Label>Signature (optional)</Label>
            <Textarea
              value={form.signature}
              onChange={(event) => handleChange("signature", event.target.value)}
              placeholder="Best regards,\nYour Name"
            />
          </div>
        </div>
      </div>

      <div className="lg:col-span-2 flex flex-wrap items-center gap-3">
        <Button variant="pine" onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save settings"}
        </Button>
        {status ? <span className="text-sm text-ink/60">{status}</span> : null}
      </div>
    </div>
  );
}
