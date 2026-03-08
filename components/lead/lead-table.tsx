"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/lead/status-badge";
import { LeadDrawer } from "@/components/lead/lead-drawer";
import { Badge } from "@/components/ui/badge";

const isFollowupDue = (lead: any) => {
  if (!lead.followup_due_at) return false;
  const due = new Date(lead.followup_due_at);
  const today = new Date();
  return due <= today && lead.status === "first_contact_sent";
};

export function LeadTable({
  leads,
  templates
}: {
  leads: any[];
  templates: any[];
}) {
  const [selectedLead, setSelectedLead] = useState<any | null>(null);
  const [open, setOpen] = useState(false);

  const rows = useMemo(() => leads ?? [], [leads]);

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Company</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Added</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((lead) => (
            <TableRow
              key={lead.id}
              className="cursor-pointer"
              onClick={() => {
                setSelectedLead(lead);
                setOpen(true);
              }}
            >
              <TableCell>
                <div className="space-y-1">
                  <p className="font-semibold text-slate">{lead.company_name}</p>
                  <p className="text-xs text-ink/60">{lead.city ?? "City unknown"}</p>
                </div>
              </TableCell>
              <TableCell>{lead.contact_name ?? "-"}</TableCell>
              <TableCell>{lead.email ?? "-"}</TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={lead.status} />
                  {isFollowupDue(lead) ? <Badge variant="maple">Follow-up due</Badge> : null}
                </div>
              </TableCell>
              <TableCell>{format(new Date(lead.date_added), "MMM d, yyyy")}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <LeadDrawer
        open={open}
        onOpenChange={setOpen}
        lead={selectedLead}
        templates={templates}
      />
    </>
  );
}
