import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  action,
  className
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-8 flex flex-wrap items-center justify-between gap-4", className)}>
      <div>
        <h2 className="text-2xl font-semibold text-slate">{title}</h2>
        {description ? <p className="mt-2 text-sm text-ink/70">{description}</p> : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
