export default function Page() {
  const templates = [
    {
      name: "First Contact — Intro",
      type: "First Contact",
      subject: "Quick question about your business visibility",
      updated: "2 days ago"
    },
    {
      name: "Follow-up — Gentle Reminder",
      type: "Follow-up",
      subject: "Following up on my previous message",
      updated: "5 days ago"
    },
    {
      name: "Reactivation — Past Leads",
      type: "Re-engagement",
      subject: "Still interested in growing your local visibility?",
      updated: "1 week ago"
    }
  ]

  return (
    <div className="space-y-10">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white">
            Email Templates
          </h1>
          <p className="text-slate-400 mt-2">
            Create reusable outreach emails and personalize before sending
          </p>
        </div>

        <button className="btn-primary">
          + New Template
        </button>
      </div>

      {/* Info Banner */}
      <div className="glass p-5 flex items-center justify-between">
        <div className="text-sm text-slate-300">
          Templates help you save time while keeping emails personalized and manual.
        </div>
        <div className="text-xs text-slate-500">
          Not mass email • Always manual review
        </div>
      </div>

      {/* Templates Grid */}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
        {templates.map((t, i) => (
          <div key={i} className="glass p-6 flex flex-col justify-between hover:scale-[1.02] transition">

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <TypeBadge type={t.type} />
                <span className="text-xs text-slate-500">
                  Updated {t.updated}
                </span>
              </div>

              <div>
                <div className="text-lg font-semibold text-white">
                  {t.name}
                </div>
                <div className="text-sm text-slate-400 mt-1 line-clamp-2">
                  Subject: {t.subject}
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-6">
              <button className="flex-1 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white transition">
                Edit
              </button>
              <button className="flex-1 px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white transition">
                Duplicate
              </button>
            </div>

          </div>
        ))}
      </div>

    </div>
  )
}

function TypeBadge({ type }: { type: string }) {
  const styles: any = {
    "First Contact": "bg-cyan-400/10 text-cyan-300",
    "Follow-up": "bg-amber-400/10 text-amber-300",
    "Re-engagement": "bg-emerald-400/10 text-emerald-300"
  }

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-medium ${styles[type]}`}>
      {type}
    </span>
  )
}