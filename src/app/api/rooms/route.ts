import { z } from "zod";
import { roomAction, RoomError } from "@/game/rooms";
export const runtime = "nodejs";
const schema = z.object({ action: z.enum(["create", "join", "sync", "start", "leave", "fire", "reload", "pickup", "heal"]), code: z.string().regex(/^[A-F0-9]{8}$/).optional(), token: z.string().length(48).optional(), name: z.string().max(24).optional(), x: z.number().finite().min(-2000).max(2000).optional(), z: z.number().finite().min(-2000).max(2000).optional(), heading: z.number().finite().min(-100000).max(100000).optional(), driving: z.boolean().optional(), weapon: z.number().int().min(0).max(5).optional(), pitch: z.number().finite().min(-1.5).max(1.5).optional(), range: z.number().finite().min(0).max(300).optional() });
export async function POST(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Use the game’s own room controls." }, { status: 403 });
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 2048) return Response.json({ error: "Request too large." }, { status: 413 });
    const text = await request.text();
    if (text.length > 2048) return Response.json({ error: "Request too large." }, { status: 413 });
    const input = schema.parse(JSON.parse(text));
    return Response.json(roomAction(input), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof RoomError ? error.message : "Invalid room request." }, { status: error instanceof RoomError ? error.status : 400 });
  }
}
