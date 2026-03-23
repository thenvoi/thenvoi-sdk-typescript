import type { PlatformMessage } from "../../runtime/types";
import { EventConverter } from "./eventConverter";
import type { ThenvoiACPServerAdapter } from "./ThenvoiACPServerAdapter";

export class ACPPushHandler {
  private readonly adapter: ThenvoiACPServerAdapter

  public constructor(adapter: ThenvoiACPServerAdapter) {
    this.adapter = adapter
  }

  public async handlePushEvent(
    message: PlatformMessage,
    roomId: string,
  ): Promise<void> {
    const sessionId = this.adapter.getSessionForRoom(roomId)
    const connection = this.adapter.getConnection()
    if (!sessionId || !connection) {
      return
    }

    const update = EventConverter.convert(message)
    if (!update) {
      return
    }

    await connection.sessionUpdate({
      sessionId,
      update,
    })
  }
}
