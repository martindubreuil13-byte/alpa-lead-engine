"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/lead/status-badge";
import { STATUS_LABELS, LEAD_STATUSES } from "@/lib/constants";

type Lead = {
  id: string;
  company_name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  industry: string | null;
  city: string | null;
  notes: string | null;
  status: keyof typeof STATUS_LABELS;
  date_added: string;
  first_contact_at: string | null;
  followup_due_at: string | null;
  archived_reason?: string | null;
};

type Template = {
  id: string;
  name: string;
  subject: string;
  body: string;
};

export function LeadDrawer({
  open,
  onOpenChange,
  lead,
  templates
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  templates: Template[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string>(lead?.status ?? "new");
  const [notes, setNotes] = useState(lead?.notes ?? "");
  const [archivedReason, setArchivedReason] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!lead) return;
    setStatus(lead.status);
    setNotes(lead.notes ?? "");
    setArchivedReason(lead.archived_reason ?? "");
    setSubject("");
    setBody("");
    setSelectedTemplate("");
    setMessage(null);
  }, [lead]);

  if (!lead) return null;

  const handleApplyTemplate = () => {
    const template = templates.find((item) => item.id === selectedTemplate);
    if (!template) return;
    setSubject(template.subject);
    setBody(template.body);
  };

  const handleSaveLead = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          status,
          notes,
          archivedReason: status === "archived" ? archivedReason : null
        })
      });
      setMessage("Lead updated.");
      startTransition(() => router.refresh());
    } catch (error) {
      setMessage("Failed to update lead.");
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (!subject || !body) {
      setMessage("Subject and body are required.");
      return;
    }
    setSending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, subject, body })
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Failed to send.");
        setSending(false);
        return;
      }
      setMessage("Email sent. Follow-up scheduled in 7 days.");
      startTransition(() => router.refresh());
    } catch (error) {
      setMessage("Failed to send.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{lead.company_name}</DialogTitle>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink/70">
            <StatusBadge status={lead.status} />
            <span>{lead.city ?? "City unknown"}</span>
            <span>Added {format(new Date(lead.date_added), "MMM d, yyyy")}</span>
          </div>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_1.4fr]">
          <div className="space-y-4 rounded-2xl border border-slate/10 bg-slate/5 p-4">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.2em] text-slate/60">Contact</p>
              <p className="text-sm text-slate">{lead.contact_name ?? "No contact name"}</p>
              <p className="text-sm text-slate">{lead.email ?? "No email"}</p>
              <p className="text-sm text-slate">{lead.phone ?? "No phone"}</p>
              <p className="text-sm text-slate">{lead.website ?? "No website"}</p>
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-slate/60">Status</p>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STATUSES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {STATUS_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.2em] text-slate/60">Notes</p>
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
            {status === "archived" ? (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-slate/60">Archived reason</p>
                <Input
                  placeholder="Reason for archiving"
                  value={archivedReason}
                  onChange={(event) => setArchivedReason(event.target.value)}
                />
              </div>
            ) : null}
            <Button variant="pine" onClick={handleSaveLead} disabled={saving}>
              {saving ? "Saving..." : "Save lead"}
            </Button>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate/10 bg-white p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate/60">Template</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={handleApplyTemplate}>
                  Apply template
                </Button>
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-slate/10 bg-white p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-slate/60">Manual email</p>
              <Input
                placeholder="Subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
              <Textarea
                placeholder="Write your outreach email here. You will review and send manually."
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
              <Button variant="maple" onClick={handleSend} disabled={sending}>
                {sending ? "Sending..." : "Send manual email"}
              </Button>
            </div>

            {message ? <p className="text-sm text-ink/70">{message}</p> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
