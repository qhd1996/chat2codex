export interface NoviceTransportReceipt { idempotencyKey: string; duplicate: boolean; }

export class NoviceMockTransport {
  private readonly accepted = new Set<string>();
  private online = true;

  setOnline(value: boolean): void { this.online = value; }

  async deliver(input: { idempotencyKey: string; kind: string; contentHash: string }): Promise<NoviceTransportReceipt> {
    if (!this.online) throw Object.assign(new Error("Mock transport is offline."), { code: "transport_offline" });
    if (!input.idempotencyKey || !input.kind || !/^[a-f0-9]{64}$/u.test(input.contentHash)) throw new Error("Mock transport envelope is invalid.");
    const duplicate = this.accepted.has(input.idempotencyKey);
    this.accepted.add(input.idempotencyKey);
    return { idempotencyKey: input.idempotencyKey, duplicate };
  }
}
