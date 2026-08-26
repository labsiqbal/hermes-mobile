import type { ReactNode } from "react";
import { ClockIcon } from "../components/icons";

/** Placeholder screen for sections that are designed but not wired yet:
 *  big tonal icon tile + warm "soon" chip + title + note, all centered. */
export default function Soon({
  title,
  note,
  icon,
}: {
  title: string;
  note: string;
  icon?: ReactNode;
}) {
  return (
    <div className="body" style={{ alignItems: "center", justifyContent: "center" }}>
      <span className="soon-icon">{icon ?? <ClockIcon size={26} />}</span>
      <span className="chip chip-warm">soon</span>
      <div className="appbar-title" style={{ fontSize: 15 }}>{title}</div>
      <div className="hint" style={{ textAlign: "center", maxWidth: 260 }}>{note}</div>
    </div>
  );
}
