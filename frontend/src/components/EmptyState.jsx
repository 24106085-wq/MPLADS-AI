// src/components/EmptyState.jsx
import { Inbox } from "lucide-react";

export default function EmptyState({
  icon: Icon = Inbox,
  title = "Nothing to show",
  message = "There is no data matching your current filters.",
  action = null,
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        <Icon size={28} strokeWidth={1.75} />
      </div>
      <h3 className="empty-state__title">{title}</h3>
      <p className="empty-state__message">{message}</p>
      {action && <div className="empty-state__action">{action}</div>}
    </div>
  );
}
