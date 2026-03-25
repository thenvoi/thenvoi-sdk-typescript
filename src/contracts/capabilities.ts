import { UnsupportedFeatureError } from "../core/errors";
import type { AgentToolsCapabilities } from "./protocols";

type CapabilityName = keyof AgentToolsCapabilities;

const CAPABILITY_LABELS: Record<CapabilityName, string> = {
  peers: "Peer lookup",
  contacts: "Contacts",
  memory: "Memory",
};

export function assertCapability(
  capabilities: AgentToolsCapabilities,
  capability: CapabilityName,
  label = CAPABILITY_LABELS[capability],
): void {
  if (!capabilities[capability]) {
    throw new UnsupportedFeatureError(`${label} is disabled by runtime capabilities`);
  }
}
