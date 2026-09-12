import { Badge as ShadcnBadge } from "./ui/badge";
import { Telescope } from "lucide-react";
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <ShadcnBadge
      variant="outline"
      className={
        tone === "green"
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : tone === "amber" || tone === "orange"
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "text-muted-foreground"
      }
    >
      {children}
    </ShadcnBadge>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Telescope size={26} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
