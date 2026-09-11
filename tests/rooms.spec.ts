import { expect, test } from "@playwright/test";
import { roomAction, RoomError } from "../src/game/rooms";
import type { RoomSnapshot } from "../src/game/multiplayer-types";
const snap = (result: ReturnType<typeof roomAction>) => (result as { snapshot: RoomSnapshot }).snapshot;
const credentials = (result: ReturnType<typeof roomAction>) => ({ code: snap(result).code, token: (result as { token: string }).token });

test("room auth, host controls, limited movement and one-time loot", () => {
  const now = Date.now();
  const host = roomAction({ action: "create", name: "Host" }, now);
  const h = credentials(host);
  expect(() => roomAction({ action: "start", ...h }, now)).toThrow(/two players/);
  const guest = roomAction({ action: "join", code: h.code, name: "Guest" }, now);
  const g = credentials(guest);
  expect(() => roomAction({ action: "start", ...g }, now)).toThrow(/Only the host/);
  expect(() => roomAction({ action: "sync", code: h.code, token: "wrong" }, now)).toThrow(RoomError);
  const start = snap(roomAction({ action: "start", ...h }, now));
  expect(start.phase).toBe("active"); expect(start.players).toHaveLength(2);
  expect(JSON.stringify(start)).not.toContain(h.token);
  const far = snap(roomAction({ action: "sync", ...h, x: 200, z: 800 }, now + 150));
  expect(far.players[0].x).toBe(0); expect(far.players[0].z).toBe(-105);
  expect(() => roomAction({ action: "join", code: h.code }, now + 150)).toThrow(/already started/);
  // Nearest crate lies at x=4, z=-105. Reach it at a legal speed.
  const moved = snap(roomAction({ action: "sync", ...h, x: 4, z: -105 }, now + 1150));
  const item = moved.loot.find(item => item.z === -105)!;
  expect(item.kind).toBe("ammo");
  const pickup = snap(roomAction({ action: "pickup", ...h }, now + 1151));
  expect(pickup.loot.find(i => i.id === item.id)?.taken).toBe(true);
  expect(pickup.players[0].reserve[0]).toBe(54);
  expect(() => roomAction({ action: "pickup", ...h }, now + 1152)).toThrow(/within 3/);
  roomAction({ action: "leave", ...h }, now + 1200); roomAction({ action: "leave", ...g }, now + 1200);
});

test("server enforces fire cooldown, cover range, reserve reload and victory", () => {
  const now = Date.now();
  const h = credentials(roomAction({ action: "create" }, now));
  const g = credentials(roomAction({ action: "join", code: h.code }, now));
  roomAction({ action: "start", ...h }, now);
  const fire = (time: number, range = 105) => snap(roomAction({ action: "fire", ...h, weapon: 0, heading: Math.PI, pitch: 0, range }, now + time));
  expect(fire(500, 10).players[1].health).toBe(100);
  expect(fire(900).players[1].health).toBe(75);
  expect(fire(901).players[1].health).toBe(75);
  const reloading = snap(roomAction({ action: "reload", ...h, weapon: 0 }, now + 1000));
  expect(reloading.players[0].ammo[0]).toBe(10);
  expect(fire(1300).players[1].health).toBe(75);
  const loaded = snap(roomAction({ action: "sync", ...h }, now + 2200));
  expect(loaded.players[0].ammo[0]).toBe(12); expect(loaded.players[0].reserve[0]).toBe(22);
  fire(2600); fire(3000);
  const won = fire(3400);
  expect(won.phase).toBe("finished"); expect(won.winner).toBe(won.players[0].id); expect(won.players[0].kills).toBe(1);
  roomAction({ action: "leave", ...h }, now+3500); roomAction({ action: "leave", ...g }, now+3500);
});

test("zone shrinks over server time and disconnected players are eliminated", () => {
  const now = Date.now();
  const h = credentials(roomAction({ action: "create" }, now));
  const g = credentials(roomAction({ action: "join", code: h.code }, now));
  roomAction({ action: "start", ...h }, now);
  let state: RoomSnapshot | undefined;
  for (let t = 10; t <= 120; t += 10) {
    roomAction({ action: "sync", ...g }, now+t*1000);
    state = snap(roomAction({ action: "sync", ...h }, now+t*1000));
  }
  expect(state!.zone.radius).toBeLessThan(200); expect(state!.phase).toBe("active");
  roomAction({ action: "sync", ...h }, now+130000);
  state = snap(roomAction({ action: "sync", ...h }, now+140000));
  expect(state.phase).toBe("finished"); expect(state.winner).toBe(state.players[0].id);
  roomAction({ action: "leave", ...h }, now+140001); roomAction({ action: "leave", ...g }, now+140001);
});

test("room endpoint validates input and connects separate clients", async ({ request }) => {
  const denied = await request.post("/api/rooms", { headers: { Origin: "https://unrelated.example" }, data: { action: "create" } });
  expect(denied.status()).toBe(403);
  const bad = await request.post("/api/rooms", { data: { action: "fire", weapon: 90 } }); expect(bad.status()).toBe(400);
  const host = await (await request.post("/api/rooms", { headers: { Origin: "http://127.0.0.1:3100" }, data: { action: "create", name: "Browser host" } })).json();
  const guest = await (await request.post("/api/rooms", { data: { action: "join", name: "Browser guest", code: host.snapshot.code } })).json();
  const started = await request.post("/api/rooms", { data: { action: "start", code: host.snapshot.code, token: host.token } });
  expect(started.ok()).toBe(true); expect((await started.json()).snapshot.players).toHaveLength(2);
  for (const user of [host, guest]) await request.post("/api/rooms", { data: { action: "leave", code: host.snapshot.code, token: user.token } });
});

test("armor absorbs damage, medkits take time, and looting unlocks weapons", () => {
  const now = Date.now();
  const h = credentials(roomAction({ action: "create" }, now));
  const g = credentials(roomAction({ action: "join", code: h.code }, now));
  roomAction({ action: "start", ...h }, now);
  roomAction({ action: "sync", ...g, x: 4, z: -75 }, now + 1000);
  for (let i = 1; i <= 4; i++) roomAction({ action: "sync", ...h, x: 4, z: -105 + i * 5 }, now+i*1000);
  const equipped = snap(roomAction({ action: "pickup", ...h }, now+4001));
  expect(equipped.players[0].armor).toBe(100);
  const shot = snap(roomAction({ action: "fire", ...g, weapon: 0, heading: 0, pitch: 0 }, now+4500));
  expect(shot.players[0].health).toBe(90); expect(shot.players[0].armor).toBe(85);
  const healing = snap(roomAction({ action: "heal", ...h }, now+4600));
  expect(healing.players[0]).toMatchObject({ medkits: 0, healing: true, health: 90 });
  expect(snap(roomAction({ action: "sync", ...h }, now+7000)).players[0].health).toBe(90);
  expect(snap(roomAction({ action: "sync", ...h }, now+7700)).players[0]).toMatchObject({ health: 100, healing: false });
  roomAction({ action: "sync", ...h, x: -1, z: -90 }, now+8700);
  roomAction({ action: "sync", ...h, x: -4, z: -95 }, now+9700);
  expect(snap(roomAction({ action: "pickup", ...h }, now+9701)).players[0].medkits).toBe(1);
  for (let i=1; i<=4; i++) roomAction({ action: "sync", ...h, x:-4,z:-95-i*5 },now+9700+i*1000);
  const looted = snap(roomAction({ action: "pickup", ...h },now+13701));
  expect(looted.players[0].weapons[3]).toBe(true); expect(looted.players[0].ammo[3]).toBe(32);
  roomAction({ action: "leave", ...h },now+13800); roomAction({ action: "leave", ...g },now+13800);
});
