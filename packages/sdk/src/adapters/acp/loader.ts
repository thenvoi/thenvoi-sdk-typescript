import type {
  AgentSideConnection,
  ClientSideConnection,
  Stream,
} from "@agentclientprotocol/sdk";

import { UnsupportedFeatureError } from "../../core/errors";
import { LazyAsyncValue } from "../shared/lazyAsyncValue";

const INSTALL_HINT =
  'ACP adapter requires "@agentclientprotocol/sdk". Install it with: pnpm add @agentclientprotocol/sdk';

export interface ACPModule {
  ClientSideConnection: new (
    clientFactory: () => import("@agentclientprotocol/sdk").Client,
    stream: Stream,
  ) => ClientSideConnection;

  AgentSideConnection: new (
    agentFactory: (connection: AgentSideConnection) => import("@agentclientprotocol/sdk").Agent,
    stream: Stream,
  ) => AgentSideConnection;

  PROTOCOL_VERSION: typeof import("@agentclientprotocol/sdk").PROTOCOL_VERSION;

  RequestError: typeof import("@agentclientprotocol/sdk").RequestError;

  ndJsonStream: typeof import("@agentclientprotocol/sdk").ndJsonStream;
}

export const acpModule = new LazyAsyncValue<ACPModule>({
  load: async () => {
    const mod = await import("@agentclientprotocol/sdk").catch(
      (error: unknown) => {
        throw new UnsupportedFeatureError(
          `${INSTALL_HINT} (${error instanceof Error ? error.message : String(error)})`,
        );
      },
    );

    return {
      ClientSideConnection: mod.ClientSideConnection,
      AgentSideConnection: mod.AgentSideConnection,
      PROTOCOL_VERSION: mod.PROTOCOL_VERSION,
      RequestError: mod.RequestError,
      ndJsonStream: mod.ndJsonStream,
    };
  },
});
