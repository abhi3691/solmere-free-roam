export type RoomPlayer = { id: string; name: string; x: number; z: number; heading: number; health: number; kills: number; ammo: number[]; reserve: number[]; weapons: boolean[]; armor: number; medkits: number; healing: boolean; driving: boolean; connected: boolean };
export type Loot = { id: string; x: number; z: number; kind: "ammo" | "medkit" | "armor" | "weapon"; weapon?: number; taken: boolean };
export type RoomSnapshot = { code: string; selfId: string; hostId: string; phase: "lobby" | "active" | "finished"; players: RoomPlayer[]; loot: Loot[]; zone: { x: number; z: number; radius: number; remaining: number }; winner: string | null; revision: number };
export type CombatEvent = { type: "fire" | "reload"; weapon: number; heading: number; pitch: number; range?: number };
