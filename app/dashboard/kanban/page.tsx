export default function Page() {
  const columns = [
    { title: "New", count: 12 },
    { title: "First Contact", count: 8 },
    { title: "Follow-up Due", count: 5 },
    { title: "In Discussion", count: 4 },
    { title: "Not Interested", count: 2 },
  ]

  return (
    <div className="space-y-10">
      
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold tracking-tight text-white">
          Pipeline
        </h1>
        <p className="text-slate-400 mt-2">
          Track outreach progress across stages
        </p>
      </div>

      {/* Board */}
      <div className="grid gap-6 xl:grid-cols-5">
        {columns.map((col) => (
          <div key={col.title} className="glass p-5 space-y-4">
            
            {/* Column Header */}
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-white">
                {col.title}
              </h2>
              <span className="text-xs px-2 py-1 rounded-full bg-white/10 text-slate-300">
                {col.count}
              </span>
            </div>

            {/* Cards */}
            <div className="space-y-4">
              <KanbanCard />
              <KanbanCard />
            </div>

          </div>
        ))}
      </div>
    </div>
  )
}

function KanbanCard() {
  return (
    <div className="glass p-4 hover:scale-[1.02] transition cursor-pointer">
      <div className="font-semibold text-white text-sm">
        Bistro du Plateau
      </div>
      <div className="text-xs text-slate-400 mt-1">
        Restaurant • Montreal
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-slate-500">
          Added 2d ago
        </span>
        <span className="text-[11px] px-2 py-1 rounded bg-emerald-400/10 text-emerald-300">
          Warm
        </span>
      </div>
    </div>
  )
}