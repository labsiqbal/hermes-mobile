// INTEGRATION-STUB — fallback for the Bots screen while src/screens/Bots.tsx
// (owned by another agent) does not exist or does not export `BotsScreen` yet.
// App.tsx prefers the real module via import.meta.glob and only renders this
// stub as a fallback. Delete this file once Bots.tsx is stable.
import Soon from "../screens/Soon";
import { BotIcon } from "./icons";
import type { HermesConnection, SavedConnection } from "../lib/hermes-client";

export interface BotsScreenProps {
  onOpenChat: (sessionId: string, profile: string, unpersisted?: boolean) => void;
  client?: HermesConnection;
  conn?: SavedConnection;
}

export default function BotsStub(_props: BotsScreenProps) {
  return (
    <Soon
      title="Bot Mode"
      note="Agent-to-agent delegation lands here next. The relay daemon in this repo already keeps envelopes moving without a Desktop."
      icon={<BotIcon size={26} />}
    />
  );
}
