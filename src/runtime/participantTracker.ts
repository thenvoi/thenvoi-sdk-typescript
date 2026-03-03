export class ParticipantTracker {
  private participantsList: Array<Record<string, unknown>> = [];
  private lastSent: Array<Record<string, unknown>> | null = null;
  private loaded = false;

  public constructor(_roomId = "") {}

  public get participants(): Array<Record<string, unknown>> {
    return [...this.participantsList];
  }

  public get isLoaded(): boolean {
    return this.loaded;
  }

  public setLoaded(participants: Array<Record<string, unknown>>): void {
    this.participantsList = participants.map((participant) => ({ ...participant }));
    this.loaded = true;
  }

  public add(participant: Record<string, unknown>): boolean {
    if (this.participantsList.some((entry) => entry.id === participant.id)) {
      return false;
    }

    this.participantsList.push({
      id: participant.id,
      name: participant.name,
      type: participant.type,
      handle: participant.handle,
    });
    return true;
  }

  public remove(participantId: string): boolean {
    const before = this.participantsList.length;
    this.participantsList = this.participantsList.filter(
      (participant) => participant.id !== participantId,
    );
    return this.participantsList.length < before;
  }

  public changed(): boolean {
    if (!this.lastSent) {
      return true;
    }

    const oldIds = new Set(this.lastSent.map((participant) => participant.id));
    const newIds = new Set(this.participantsList.map((participant) => participant.id));

    if (oldIds.size !== newIds.size) {
      return true;
    }

    for (const id of oldIds) {
      if (!newIds.has(id)) {
        return true;
      }
    }

    return false;
  }

  public markSent(): void {
    this.lastSent = this.participantsList.map((participant) => ({ ...participant }));
  }
}
