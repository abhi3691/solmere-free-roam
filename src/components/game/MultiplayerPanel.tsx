"use client";
import { useState } from "react";
import type { RoomSnapshot } from "@/game/multiplayer-types";
export default function MultiplayerPanel({ room, error, busy, connect, leave, action, play }: { room: RoomSnapshot | null; error: string; busy: boolean; connect: (name: string, code?: string) => Promise<void>; leave: () => Promise<void>; action: (action: string) => Promise<unknown>; play: () => void }) {
  const [name, setName] = useState("Explorer");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  return <div className="multiplayer-panel">
    <p className="panel-intro">Coastline Royale · 2–8 players · 4-minute rounds. Find supplies, stay inside the blue boundary, and be the last explorer standing.</p>
    {error && <p role="alert" className="room-error">{error}</p>}
    {!room ? <><label>Player name<input maxLength={24} value={name} onChange={e => setName(e.target.value)} autoComplete="nickname" /></label><div className="room-entry"><div><h3>Gather your squad</h3><p>Create a private room and share its invite code.</p><button className="primary" disabled={busy} onClick={() => void connect(name)}>Create room</button></div><div><h3>Have an invite?</h3><label>Room code<input maxLength={8} value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="8-character code" autoCapitalize="characters" spellCheck={false} /></label><button className="secondary" disabled={busy || !/^[A-F0-9]{8}$/.test(code)} onClick={() => void connect(name, code)}>Join room</button></div></div><p className="fine-print">Invite codes connect players using this same game address. Internet play requires this game to be hosted on a persistent server. Rooms expire when the server restarts.</p></> : <>
      <div className="invite-code"><span>INVITE CODE</span><strong>{room.code}</strong><button className="secondary" onClick={async () => { try { await navigator.clipboard.writeText(room.code); setCopied(true); } catch { setCopied(false); } }}>{copied ? "Copied" : "Copy code"}</button></div>
      <div className="room-roster">{room.players.map(p => <div key={p.id}><strong>{p.name}{p.id === room.selfId ? " (you)" : ""}</strong><span>{p.id === room.hostId ? "HOST · " : ""}{room.phase === "lobby" ? "READY" : p.health > 0 ? `${Math.ceil(p.health)} HP · ${p.kills} eliminations` : "ELIMINATED"}</span></div>)}</div>
      <div className="room-actions">{room.phase === "lobby" && room.hostId === room.selfId && <button className="primary" disabled={room.players.length < 2} onClick={() => void action("start").then(play)}>Start battle royale</button>}<button className="secondary" onClick={play}>{room.phase === "lobby" ? "Explore lobby" : "Return to match"}</button><button className="secondary" onClick={() => void leave()}>Leave room</button></div>
      {room.phase === "lobby" && <p className="fine-print">{room.players.length}/8 connected. The host starts once at least two players join. Online matches are on foot; menus do not pause the safe zone.</p>}
    </>}
  </div>;
}
