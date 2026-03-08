"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Template = {
  id: string;
  name: string;
  subject: string;
  body: string;
};

export function TemplateManager({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Template[]>(templates ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setItems(templates ?? []);
  }, [templates]);

  useEffect(() => {
    const current = items.find((item) => item.id === selectedId) ?? null;
    setName(current?.name ?? "");
    setSubject(current?.subject ?? "");
    setBody(current?.body ?? "");
  }, [items, selectedId]);

  const handleNew = () => {
    setSelectedId(null);
    setName("");
    setSubject("");
    setBody("");
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    const payload = { name, subject, body };

    const response = await fetch("/api/templates", {
      method: selectedId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(selectedId ? { id: selectedId, ...payload } : payload)
    });

    if (!response.ok) {
      const data = await response.json();
      setStatus(data.error ?? "Failed to save.");
      setSaving(false);
      return;
    }

    setStatus("Template saved.");
    router.refresh();
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    setSaving(true);
    setStatus(null);
    const response = await fetch("/api/templates", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selectedId })
    });
    if (!response.ok) {
      const data = await response.json();
      setStatus(data.error ?? "Failed to delete.");
      setSaving(false);
      return;
    }
    setStatus("Template deleted.");
    router.refresh();
    setSaving(false);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div className="rounded-3xl border border-white/80 bg-white/80 p-4 shadow-soft">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate">Templates</p>
          <Button size="sm" variant="outline" onClick={handleNew}>
            New
          </Button>
        </div>
        <div className="mt-4 space-y-2">
          {items.map((template) => (
            <button
              key={template.id}
              onClick={() => setSelectedId(template.id)}
              className={`w-full rounded-2xl border px-3 py-2 text-left text-sm transition ${
                selectedId === template.id
                  ? "border-slate bg-slate text-white"
                  : "border-slate/10 bg-white hover:border-slate/40"
              }`}
            >
              <p className="font-semibold">{template.name}</p>
              <p className="text-xs opacity-70">{template.subject}</p>
            </button>
          ))}
          {items.length === 0 ? (
            <p className="text-sm text-ink/60">No templates yet.</p>
          ) : null}
        </div>
      </div>

      <div className="rounded-3xl border border-white/80 bg-white/90 p-6 shadow-soft">
        <div className="space-y-3">
          <Input
            placeholder="Template name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            placeholder="Email subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
          />
          <Textarea
            placeholder="Email body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="pine" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save template"}
          </Button>
          {selectedId ? (
            <Button variant="outline" onClick={handleDelete} disabled={saving}>
              Delete
            </Button>
          ) : null}
          {status ? <span className="text-sm text-ink/60">{status}</span> : null}
        </div>
      </div>
    </div>
  );
}
