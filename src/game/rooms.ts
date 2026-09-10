import { randomBytes } from "node:crypto";
import { WEAPONS } from "./config";
import type { Loot, RoomPlayer, RoomSnapshot } from "./multiplayer-types";

type Player = RoomPlayer & { token: string; seen: number; moved: number; shot: number; reloadUntil: number; reloadWeapon: number };
type Room = { code: string; hostId: string; phase: RoomSnapshot["phase"]; players: Map<string, Player>; loot: Loot[]; started: number; updated: number; created: number; revision: number; winner: string | null };
const globals = globalThis as typeof globalThis & { solmereRooms?: Map<string, Room> };
const rooms = globals.solmereRooms ??= new Map();
const capacity = 8;
export class RoomError extends Error { constructor(message: string, public status = 400) { super(message); } }
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
function zone(room: Room, now: number) {
  const age = room.phase === "lobby" ? 0 : Math.max(0, (now - room.started) / 1000);
  return { x: 0, z: 0, radius: Math.max(0, 330 * (1 - Math.max(0, age - 30) / 210)), remaining: Math.max(0, Math.ceil(240 - age)) };
}
function tick(room: Room, now: number) {
  const dt = Math.max(0, (now - room.updated) / 1000);
  const area = zone(room, now);
  for (const p of room.players.values()) {
    p.connected = now - p.seen < 15000;
    if (!p.connected && room.phase === "active") p.health = 0;
    if (p.reloadUntil && now >= p.reloadUntil) { p.ammo[p.reloadWeapon] = WEAPONS[p.reloadWeapon].capacity; p.reloadUntil = 0; }
    if (room.phase === "active" && (Math.hypot(p.x - area.x, p.z - area.z) > area.radius || area.remaining === 0)) p.health = Math.max(0, p.health - dt * (area.radius < 80 ? 12 : 5));
  }
  if (room.phase === "lobby") {
    for (const [id, p] of room.players) if (!p.connected) room.players.delete(id);
    if (!room.players.has(room.hostId)) room.hostId = room.players.keys().next().value ?? "";
  }
  if (room.phase === "active") {
    const alive = [...room.players.values()].filter(p => p.health > 0);
    if (alive.length <= 1) { room.phase = "finished"; room.winner = alive[0]?.id ?? null; }
  }
  room.updated = now;
}
function snapshot(room: Room, id: string, now: number): RoomSnapshot {
  return { code: room.code, selfId: id, hostId: room.hostId, phase: room.phase, loot: room.loot, zone: zone(room, now), winner: room.winner, revision: ++room.revision,
    players: [...room.players.values()].map(({ id, name, x, z, heading, health, kills, ammo, driving, connected }) => ({ id, name, x, z, heading, health, kills, ammo: [...ammo], driving, connected })) };
}
function addPlayer(room: Room, name: string, now: number) {
  if (room.players.size >= capacity) throw new RoomError("This room is full (8 players).", 409);
  const id = randomBytes(8).toString("hex"), token = randomBytes(24).toString("hex");
  const p: Player = { id, token, name: name.trim().slice(0, 24) || "Explorer", x: 0, z: -room.players.size * 7, heading: 0, health: 100, kills: 0, ammo: WEAPONS.map(w => w.capacity), driving: false, connected: true, seen: now, moved: now, shot: 0, reloadUntil: 0, reloadWeapon: 0 };
  room.players.set(id, p); if (!room.hostId) room.hostId = id;
  return { token, snapshot: snapshot(room, id, now) };
}
export type RoomAction = { action: "create" | "join" | "sync" | "start" | "leave" | "fire" | "reload" | "pickup"; code?: string; token?: string; name?: string; x?: number; z?: number; heading?: number; driving?: boolean; weapon?: number; pitch?: number; range?: number };
export function roomAction(input: RoomAction, now = Date.now()) {
  for (const [code, room] of rooms) if (now - room.updated > 30 * 60_000 || now - room.created > 4 * 3600_000) rooms.delete(code);
  if (input.action === "create") {
    if (rooms.size >= 100) throw new RoomError("Server is full. Please try later.", 503);
    let code: string; do { code = randomBytes(4).toString("hex").toUpperCase(); } while (rooms.has(code));
    const room: Room = { code, hostId: "", phase: "lobby", players: new Map(), loot: [], started: 0, updated: now, created: now, revision: 0, winner: null };
    rooms.set(code, room); return addPlayer(room, input.name ?? "Explorer", now);
  }
  const room = rooms.get(input.code ?? "");
  if (!room) throw new RoomError("Room not found or expired. Check the invite code.", 404);
  tick(room, now);
  if (input.action === "join") {
    if (room.phase !== "lobby") throw new RoomError("This match has already started. Create a new room for the next round.", 409);
    return addPlayer(room, input.name ?? "Explorer", now);
  }
  const player = [...room.players.values()].find(p => p.token === input.token);
  if (!player) throw new RoomError("Session expired. Rejoin the room.", 401);
  player.seen = now; player.connected = true;
  if (input.action === "leave") {
    room.players.delete(player.id);
    if (!room.players.size) rooms.delete(room.code);
    else if (room.hostId === player.id) room.hostId = room.players.keys().next().value!;
    return { left: true };
  }
  if (input.action === "start") {
    if (room.hostId !== player.id) throw new RoomError("Only the host can start the match.", 403);
    if (room.phase !== "lobby" || room.players.size < 2) throw new RoomError("At least two players must join before starting.", 409);
    room.phase = "active"; room.started = now;
    let i = 0;
    for (const p of room.players.values()) { p.x = 0; p.z = -105 + i++ * 30; p.health = 100; p.kills = 0; p.driving = false; p.ammo = WEAPONS.map(w => w.capacity); p.moved = now; }
    room.loot = Array.from({ length: 24 }, (_, i) => ({ id: `supply-${i}`, x: i % 2 ? 4 : -4, z: -165 + i * 15, kind: i % 3 ? "ammo" : "medkit", taken: false }));
  }
  if (input.action === "sync" && player.health > 0 && room.phase !== "finished" && input.x !== undefined && input.z !== undefined) {
    const dt = clamp((now - player.moved) / 1000, 0, 1);
    const distance = Math.hypot(input.x - player.x, input.z - player.z);
    // Server bounds displacement; online battle royale is on foot in this first version.
    if (Number.isFinite(distance) && distance <= 7 * dt + .4) { player.x = clamp(input.x, -135, 389); player.z = clamp(input.z, -984, 1550); }
    player.heading = input.heading ?? player.heading; player.driving = false; player.moved = now;
  }
  if (room.phase === "active" && player.health > 0) {
    const weapon = input.weapon ?? 0, spec = WEAPONS[weapon];
    if (input.action === "reload" && !player.reloadUntil && player.ammo[weapon] < spec.capacity) { player.reloadWeapon = weapon; player.reloadUntil = now + spec.reload * 1000; }
    if (input.action === "fire" && !player.reloadUntil && player.ammo[weapon] > 0 && now - player.shot >= spec.cooldown * 1000 - 5) {
      player.shot = now; player.ammo[weapon]--;
      const heading = input.heading ?? player.heading, pitch = input.pitch ?? 0;
      const range = Math.min(spec.range, input.range ?? spec.range);
      const targets = [...room.players.values()].filter(p => p.id !== player.id && p.health > 0).map(p => {
        const dx = p.x - player.x, dz = p.z - player.z;
        const along = -Math.sin(heading) * dx - Math.cos(heading) * dz;
        const across = Math.abs(Math.cos(heading) * dx - Math.sin(heading) * dz);
        return { p, along, across };
      }).filter(t => t.along > 0 && t.along < range && t.across < .42 && Math.abs(Math.tan(pitch) * t.along) < .85).sort((a,b) => a.along-b.along);
      if (targets[0]) { const target = targets[0].p; target.health = Math.max(0, target.health - [25, 20, 55, 13, 75, 40][weapon]); if (!target.health) player.kills++; }
    }
    if (input.action === "pickup") {
      const item = room.loot.find(item => !item.taken && Math.hypot(item.x-player.x, item.z-player.z) < 3);
      if (!item) throw new RoomError("Move within 3 metres of a supply crate.", 409);
      if (item.kind === "medkit") player.health = Math.min(100, player.health + 45);
      else player.ammo = WEAPONS.map(w => w.capacity);
      item.taken = true;
    }
  }
  tick(room, now);
  return { snapshot: snapshot(room, player.id, now) };
}
