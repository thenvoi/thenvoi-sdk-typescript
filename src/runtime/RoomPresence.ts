import type { MetadataMap } from "../contracts/dtos";
import type { ThenvoiLink } from "../platform/ThenvoiLink";
import type { ContactEvent, PlatformEvent } from "../platform/events";
import { DEFAULT_REQUEST_OPTIONS } from "../client/rest/requestOptions";
import { UnsupportedFeatureError } from "../core/errors";
import type { Logger } from "../core/logger";
import { NoopLogger } from "../core/logger";

interface RoomPresenceOptions {
  link: ThenvoiLink;
  roomFilter?: (room: MetadataMap) => boolean;
  autoSubscribeExistingRooms?: boolean;
  logger?: Logger;
}

type RoomPresenceJoinHandler = (roomId: string, payload: MetadataMap) => Promise<void>;
type RoomPresenceLeaveHandler = (roomId: string) => Promise<void>;
type RoomPresenceEventHandler = (roomId: string, event: PlatformEvent) => Promise<void>;
type RoomPresenceContactHandler = (event: ContactEvent) => Promise<void>;

export class RoomPresence {
  public readonly rooms = new Set<string>();
  public onRoomJoined: RoomPresenceJoinHandler | null = null;
  public onRoomLeft: RoomPresenceLeaveHandler | null = null;
  public onRoomEvent: RoomPresenceEventHandler | null = null;
  public onContactEvent: RoomPresenceContactHandler | null = null;

  private readonly link: ThenvoiLink;
  private readonly roomFilter?: (room: MetadataMap) => boolean;
  private readonly autoSubscribeExistingRooms: boolean;
  private readonly logger: Logger;
  private eventController: AbortController | null = null;
  private eventTask: Promise<void> | null = null;
  private contactsSubscribed = false;

  public constructor(options: RoomPresenceOptions) {
    this.link = options.link;
    this.roomFilter = options.roomFilter;
    this.autoSubscribeExistingRooms = options.autoSubscribeExistingRooms ?? true;
    this.logger = options.logger ?? new NoopLogger();
  }

  public async start(): Promise<void> {
    if (this.eventTask) {
      return;
    }

    if (!this.link.isConnected()) {
      await this.link.connect();
    }

    await this.link.subscribeAgentRooms();
    if (this.autoSubscribeExistingRooms) {
      await this.subscribeExistingRooms();
    }

    if (this.link.capabilities.contacts) {
      await this.link.subscribeAgentContacts();
      this.contactsSubscribed = true;
    }

    this.eventController = new AbortController();
    this.eventTask = this.consumeEvents(this.eventController.signal);
  }

  public async stop(): Promise<void> {
    this.eventController?.abort();
    await this.eventTask;
    this.eventTask = null;
    this.eventController = null;

    if (this.contactsSubscribed) {
      await this.link.unsubscribeAgentContacts();
      this.contactsSubscribed = false;
    }

    for (const roomId of [...this.rooms]) {
      await this.link.unsubscribeRoom(roomId);
      await this.onRoomLeft?.(roomId);
      this.rooms.delete(roomId);
    }
  }

  private async consumeEvents(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      const event = await this.link.nextEvent(signal);
      if (!event) {
        return;
      }

      switch (event.type) {
        case "room_added":
          await this.handleRoomAdded(event.roomId, event.payload as MetadataMap);
          break;
        case "room_removed":
        case "room_deleted":
          await this.handleRoomRemoved(event.roomId);
          break;
        case "contact_request_received":
        case "contact_request_updated":
        case "contact_added":
        case "contact_removed":
          await this.onContactEvent?.(event);
          break;
        default:
          if (event.roomId && this.rooms.has(event.roomId)) {
            await this.onRoomEvent?.(event.roomId, event);
          }
          break;
      }
    }
  }

  private async handleRoomAdded(roomId: string | null, payload: MetadataMap): Promise<void> {
    if (!roomId) {
      return;
    }

    if (this.roomFilter && !this.roomFilter(payload)) {
      return;
    }

    if (this.rooms.has(roomId)) {
      return;
    }

    await this.link.subscribeRoom(roomId);
    this.rooms.add(roomId);
    await this.onRoomJoined?.(roomId, payload);
  }

  private async handleRoomRemoved(roomId: string | null): Promise<void> {
    if (!roomId || !this.rooms.has(roomId)) {
      return;
    }

    await this.link.unsubscribeRoom(roomId);
    this.rooms.delete(roomId);
    await this.onRoomLeft?.(roomId);
  }

  private async subscribeExistingRooms(): Promise<void> {
    try {
      const rooms = await this.link.listAllChats(
        { pageSize: 100, maxPages: 100 },
        DEFAULT_REQUEST_OPTIONS,
      );

      for (const room of rooms) {
        const roomId = typeof room.id === "string" ? room.id : "";
        if (!roomId) {
          continue;
        }

        if (this.roomFilter && !this.roomFilter(room)) {
          continue;
        }

        await this.link.subscribeRoom(roomId);
        this.rooms.add(roomId);
        await this.onRoomJoined?.(roomId, room);
      }
    } catch (error) {
      if (error instanceof UnsupportedFeatureError) {
        return;
      }

      this.logger.warn("RoomPresence failed to subscribe existing rooms", {
        error,
      });
      return;
    }
  }
}
