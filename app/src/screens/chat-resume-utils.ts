import type { GatewayEvent } from "../lib/hermes-client";

/** History already owns settled turns; only replay events after latest terminal
 * event represent current live state when reopening a session. */
export function liveTurnEvents(events: GatewayEvent[]): GatewayEvent[] {
  let terminal = -1;
  events.forEach((event, index) => {
    if (event.type === "message.complete" || event.type === "error") terminal = index;
  });
  return terminal >= 0 ? events.slice(terminal + 1) : events;
}
