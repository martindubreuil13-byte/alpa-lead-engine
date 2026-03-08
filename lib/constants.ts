export const LEAD_STATUSES = [
  "new",
  "first_contact_sent",
  "followup_due",
  "in_discussion",
  "not_interested",
  "archived"
] as const;

export const STATUS_LABELS: Record<(typeof LEAD_STATUSES)[number], string> = {
  new: "New",
  first_contact_sent: "First contact sent",
  followup_due: "Follow-up due",
  in_discussion: "In discussion",
  not_interested: "Not interested",
  archived: "Archived"
};

export const STATUS_COLORS: Record<(typeof LEAD_STATUSES)[number], string> = {
  new: "neutral",
  first_contact_sent: "pine",
  followup_due: "maple",
  in_discussion: "pine",
  not_interested: "outline",
  archived: "outline"
};
