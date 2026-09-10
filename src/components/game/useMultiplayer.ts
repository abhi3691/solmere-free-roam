"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameController, GameStats } from "@/game/config";
import type { CombatEvent, RoomSnapshot } from "@/game/multiplayer-types";

type Session = { code: string; token: string };
export function useMultiplayer(controller: React.RefObject<GameController | null>, stats: GameStats) {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const session = useRef<Session | null>(null);
  const latest = useRef(stats);
  const revision = useRef(0);
  const mounted = useRef(true);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => { latest.current = stats; }, [stats]);
  const request = useCallback(async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(7000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Room connection failed.");
    if (!mounted.current) return result;
    if (result.token) { session.current = { code: result.snapshot.code, token: result.token }; revision.current = 0; }
    if (result.snapshot && session.current?.code === result.snapshot.code && result.snapshot.revision > revision.current) {
      revision.current = result.snapshot.revision;
      setRoom(result.snapshot); controller.current?.command({ type: "room", snapshot: result.snapshot });
    }
    return result;
  }, [controller]);
  const action = useCallback((action: string, extra: Record<string, unknown> = {}) => {
    const credentials = session.current;
    if (!credentials) return Promise.resolve();
    // Preserve shot/reload order and avoid overlapping state updates.
    const pending = queue.current.then(() => request({ action, ...credentials, ...extra })).catch(reason => { if (mounted.current) setError(reason instanceof Error ? reason.message : "Connection lost."); });
    queue.current = pending;
    return pending;
  }, [request]);
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let syncing = false;
    const timer = setInterval(() => {
      if (stopped || syncing || !session.current) return;
      const pose = latest.current;
      syncing = true;
      void action("sync", { x: pose.x, z: pose.z, heading: pose.heading, driving: false }).finally(() => { syncing = false; });
    }, 150);
    return () => {
      stopped = true; mounted.current = false; clearInterval(timer);
      if (session.current) void fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "leave", ...session.current }), keepalive: true }).catch(() => {});
      session.current = null;
    };
  }, [action]);
  const connect = async (name: string, code?: string) => {
    setBusy(true); setError("");
    try { await request({ action: code ? "join" : "create", name: name.trim() || "Explorer", ...(code ? { code: code.trim().toUpperCase() } : {}) }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to connect."); }
    finally { if (mounted.current) setBusy(false); }
  };
  const leave = async () => {
    const credentials = session.current; session.current = null; setRoom(null); setError("");
    controller.current?.command({ type: "room", snapshot: null });
    if (credentials) try { await request({ action: "leave", ...credentials }); } catch { /* Local play remains available after disconnection. */ }
  };
  const combat = useCallback((event: CombatEvent) => { if (session.current) void action(event.type, { weapon: event.weapon, heading: event.heading, pitch: event.pitch, range: event.range }); }, [action]);
  return { room, error, busy, connect, leave, action, combat };
}
