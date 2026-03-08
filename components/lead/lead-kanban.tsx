"use client";

import { useMemo, useState } from "react";

import { LeadDrawer } from "@/components/lead/lead-drawer";
import { STATUS_LABELS, LEAD_STATUSES } from "@/lib/constants";
import { StatusBadge } from "@/components/lead/status-badge";

export function LeadKanban({
  leads,
  templates
}: {
  leads: any[];
  templates: any[];
}) {
  const [selectedLead, setSelectedLead] = useState<any | null>(null);
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    LEAD_STATUSES.forEach((status) => map.set(status, []));
    (leads ?? []).forEach((lead) => {
      map.get(lead.status)?.push(lead);
    });
    return map;
  }, [leads]);

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        {LEAD_STATUSES.map((status) => (
          <div key={status} className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate">{STATUS_LABELS[status]}</h3>
              <span className="text-xs text-ink/60">{grouped.get(status)?.length ?? 0}</span>
            </div>
            <div className="space-y-3 rounded-3xl border border-white/80 bg-white/70 p-3 shadow-soft">
              {(grouped.get(status) ?? []).map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => {
                    setSelectedLead(lead);
                    setOpen(true);
                  }}
                  className="w-full rounded-2xl border border-slate/10 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate">{lead.company_name}</p>
                    <StatusBadge status={lead.status} />
                  </div>
                  <p className="mt-1 text-xs text-ink/60">{lead.city ?? "City unknown"}</p>
                  <p className="mt-2 text-sm text-ink/80">{lead.email ?? "No email"}</p>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <LeadDrawer
        open={open}
        onOpenChange={setOpen}
        lead={selectedLead}
        templates={templates}
      />
    </>
  );
}
