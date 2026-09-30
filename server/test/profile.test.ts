import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { WebSocket } from "ws";
import type { ClientMessage, ServerMessage, Wire } from "../src/protocol.ts";
import type { ProfileCards, ProfileField } from "../src/profile.ts";
import { startServer } from "../src/server.ts";
import { fakeAccounts } from "./fakes.ts";

type Received = Wire<ServerMessage>;

// Token = user id. Every user owns card 100 only; `cards` is what the store keeps of each one.
async function setup(cards = new Map<string, ProfileCards>()) {
  const accounts = fakeAccounts({
    profileCards: async (userId) => cards.get(userId) ?? { avatar: null, favorite: null },
    setProfileCard: async (userId, field: ProfileField, code) => {
      if (code !== 100) return false;
      cards.set(userId, { avatar: null, favorite: null, ...cards.get(userId), [field]: code });
      return true;
    },
  });
  const wss = startServer(0, accounts, () => [1n, 2n, 3n, 4n], 0);
  onTestFinished(() => wss.close());
  await once(wss, "listening");
  const url = `ws://localhost:${(wss.address() as AddressInfo).port}`;

  async function connect(user: string) {
    const socket = new WebSocket(url);
    const received: Received[] = [];
    socket.on("message", (data) => received.push(JSON.parse(String(data))));
    await once(socket, "open");
    const send = (msg: ClientMessage) => socket.send(JSON.stringify(msg));
    send({ type: "auth", token: user });
    return { received, send, close: () => socket.close() };
  }
  return { connect };
}

describe("avatar et carte favorite", () => {
  it("répond player_profile, garde la carte choisie et refuse une carte non possédée", async () => {
    const { connect } = await setup();
    const a = await connect("pr-a");
    a.send({ type: "player_profile" });
    await vi.waitFor(() => expect(a.received).toContainEqual({ type: "player_profile", avatar: null, favorite: null }));
    a.send({ type: "set_avatar", code: 100 });
    await vi.waitFor(() => expect(a.received).toContainEqual({ type: "player_profile", avatar: 100, favorite: null }));
    a.send({ type: "set_favorite", code: 100 });
    await vi.waitFor(() => expect(a.received).toContainEqual({ type: "player_profile", avatar: 100, favorite: 100 }));
    a.send({ type: "set_favorite", code: 200 });
    await vi.waitFor(() => expect(a.received).toContainEqual({ type: "error", error: "carte non possédée" }));
    a.send({ type: "set_avatar", code: "100" } as unknown as ClientMessage);
    await vi.waitFor(() => expect(a.received).toContainEqual({ type: "error", error: "message invalide" }));
  });

  it("envoie à l'adversaire humain l'avatar choisi, seulement s'il en a un", { timeout: 30_000 }, async () => {
    const { connect } = await setup(new Map([["pr-host", { avatar: 100, favorite: null }]]));
    const host = await connect("pr-host");
    host.send({ type: "create" });
    const joined = (client: typeof host) => client.received.filter((msg) => msg.type === "joined");
    await vi.waitFor(() => expect(joined(host)).toHaveLength(1));
    const room = (joined(host)[0] as { room: string }).room;
    const guest = await connect("pr-guest");
    guest.send({ type: "join", room });
    await vi.waitFor(() => expect(joined(guest)).toHaveLength(1));
    expect(joined(guest)[0]).toMatchObject({ opponent: "pr-host", opponentAvatar: 100 });
    // The host's first `joined` had no opponent, the second one names the guest, who has no avatar.
    await vi.waitFor(() => expect(joined(host)).toHaveLength(2));
    expect(joined(host)[1]).toMatchObject({ opponent: "pr-guest" });
    expect(joined(host)[1]).not.toHaveProperty("opponentAvatar");
    host.close();
    guest.close();
  });
});
