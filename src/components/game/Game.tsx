"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import MultiplayerPanel from "./MultiplayerPanel";
import { useMultiplayer } from "./useMultiplayer";
import type { CombatEvent } from "@/game/multiplayer-types";
import { DISTRICTS, FUEL_PRICE, FUEL_STATIONS, INITIAL_STATS, MISSIONS, VEHICLES, WEAPONS, type GameCommand, type GameController } from "@/game/config";

type IconName = "compass" | "map" | "car" | "target" | "help" | "reset" | "sun" | "arrow" | "close" | "pause" | "play" | "camera" | "flag" | "volume" | "mute";
function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    compass: <><circle cx="12" cy="12" r="9" /><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z" /></>,
    map: <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z" /><path d="M9 3v16M15 5v16" /></>,
    car: <><path d="m4 10 2-6h12l2 6M3 10h18v8H3zM6 18v2m12-2v2M6 14h2m8 0h2" /></>,
    target: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 1v5m0 12v5M1 12h5m12 0h5" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v1" /></>,
    reset: <><path d="M4 9a8 8 0 1 1 0 6M4 3v6h6" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    pause: <path d="M8 5v14M16 5v14" />,
    play: <path d="m8 4 12 8-12 8Z" />,
    camera: <><path d="M3 7h4l2-3h6l2 3h4v13H3z" /><circle cx="12" cy="13" r="4" /></>,
    flag: <><path d="M6 21V4" /><path d="M6 4h12l-3 4 3 4H6" /></>,
    volume: <><path d="M4 9v6h4l5 4V5L8 9Z" /><path d="M17 8a5 5 0 0 1 0 8m2.5-11a9 9 0 0 1 0 14" /></>,
    mute: <><path d="M4 9v6h4l5 4V5L8 9Z" /><path d="m16.5 9.5 5 5m0-5-5 5" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
function formatDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}


const DISTRICT_COLORS = ["#b7c9a0", "#e4c17e", "#c9a2bb", "#93bdb8"];

function DistrictMap({ active, ready, onSelect }: { active: number; ready: boolean; onSelect: (index: number) => void }) {
  const skeletonX = (z: number) => 75 + (z + 850) * .042;
  const skeletonY = (z: number) => 40 + (z + 850) * .19;
  const boundaries = [-900, ...DISTRICTS.slice(0, -1).map((d, i) => (d.z + DISTRICTS[i + 1].z) / 2), 1550];
  return <svg viewBox="0 0 300 520" aria-label="Fictional map of the eighteen provinces">
    {DISTRICTS.map((d, i) => {
      const xTop = skeletonX(boundaries[i]), yTop = skeletonY(boundaries[i]);
      const xBottom = skeletonX(boundaries[i + 1]), yBottom = skeletonY(boundaries[i + 1]);
      const left = 24 + Math.max(0, -d.x) * .15;
      const right = 40 + Math.max(0, d.x) * .55;
      const points = `${xTop - left},${yTop} ${xTop + right},${yTop} ${xBottom + right},${yBottom} ${xBottom - left},${yBottom}`;
      const midX = (xTop + xBottom) / 2 + (right - left) / 2, midY = (yTop + yBottom) / 2;
      const isHere = active === i;
      return <g key={d.name} className="district-region" role="button" tabIndex={ready ? 0 : -1} aria-disabled={!ready}
        aria-label={`Fast travel to ${d.name}`}
        onClick={() => ready && onSelect(i)}
        onKeyDown={e => { if (ready && (e.key === "Enter" || e.key === " ")) onSelect(i); }}>
        <polygon points={points} fill={DISTRICT_COLORS[i % DISTRICT_COLORS.length]} stroke={isHere ? "#e77948" : "#fbf8ec"} strokeWidth={isHere ? 3 : 1.3} />
        <text x={midX} y={midY} textAnchor="middle" dominantBaseline="middle" fontSize="7.2" fontWeight={isHere ? 700 : 400} letterSpacing=".2"
          fill="#203c39" stroke="#fbf8ec" strokeWidth="3" paintOrder="stroke">{d.name}</text>
      </g>;
    })}
  </svg>;
}

function TouchButton({ keyName, label, text, send }: { keyName: string; label: string; text: string; send: (value: GameCommand) => void }) {
  return <button aria-label={label} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); send({ type: "input", key: keyName, pressed: true }); }} onPointerUp={() => send({ type: "input", key: keyName, pressed: false })} onPointerCancel={() => send({ type: "input", key: keyName, pressed: false })} onLostPointerCapture={() => send({ type: "input", key: keyName, pressed: false })}>{text}</button>;
}

type Panel = "map" | "garage" | "armory" | "missions" | "help" | "pause" | "services" | "multiplayer" | null;

export default function Game() {
  const mount = useRef<HTMLDivElement>(null);
  const controller = useRef<GameController | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [stats, setStats] = useState(INITIAL_STATS);
  const multiplayer = useMultiplayer(controller, stats);
  const combat = useRef<(event: CombatEvent) => void>(() => {});
  const [previews, setPreviews] = useState<string[]>([]);
  const [weaponPreviews, setWeaponPreviews] = useState<string[]>([]);
  useEffect(() => {
    if (panel !== "armory" || !ready || weaponPreviews.length) return;
    const timer = setTimeout(() => setWeaponPreviews(WEAPONS.map((_, index) => controller.current?.getWeaponPreview(index) ?? "")), 50);
    return () => clearTimeout(timer);
  }, [panel, ready, weaponPreviews.length]);
  useEffect(() => { combat.current = multiplayer.combat; }, [multiplayer.combat]);
  useEffect(() => {
    if (panel !== "garage" || !ready || previews.length) return;
    const timer = setTimeout(() => setPreviews(VEHICLES.map((_, index) => controller.current?.getVehiclePreview(index) ?? "")), 50);
    return () => clearTimeout(timer);
  }, [panel, ready, previews.length]);
  const [vehicle, setVehicle] = useState(0);
  const weapon = stats.weaponIndex;
  const selfOnline = multiplayer.room?.players.find(p => p.id === multiplayer.room?.selfId);
  const nearbyLoot = multiplayer.room?.loot.find(item => !item.taken && Math.hypot(item.x-stats.x,item.z-stats.z) < 3);
  const [portraitAllowed, setPortraitAllowed] = useState(false);
  async function requestLandscape() {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      const orientation = screen.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void> };
      await orientation?.lock?.("landscape");
    } catch { /* Rotation prompt remains available when the browser denies orientation locking. */ }
  }
  const [notice, setNotice] = useState("");
  const [session, setSession] = useState(0);
  const [muted, setMuted] = useState(false);
  const currentCar = VEHICLES[vehicle];
  const currentDistrict = DISTRICTS[stats.district];

  useEffect(() => {
    let cancelled = false;
    let instance: GameController | undefined;
    import("@/game/engine").then(({ createGame }) => {
      if (cancelled || !mount.current) return;
      instance = createGame(mount.current, setStats, () => setReady(true), event => combat.current(event));
      controller.current = instance;
      instance.command({ type: "pause", value: true });
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to start the 3D renderer.");
    });
    return () => { cancelled = true; instance?.dispose(); controller.current = null; };
  }, [session]);

  useEffect(() => {
    controller.current?.command({ type: "pause", value: !started || panel !== null });
    if (started && !panel) mount.current?.querySelector("canvas")?.focus({ preventScroll: true });
  }, [started, panel, ready]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.code === "Escape" && started) setPanel(p => p ? null : "pause");
      if (event.code === "Tab" && dialog.current) {
        const controls = dialog.current.querySelectorAll<HTMLElement>("button:not(:disabled), input, select, [tabindex=\"0\"]");
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", handleKey);
    if (panel) dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => window.removeEventListener("keydown", handleKey);
  }, [panel, started]);

  function command(value: GameCommand) {
    controller.current?.command(value);
    if (started && !panel && value.type !== "input") mount.current?.querySelector("canvas")?.focus({ preventScroll: true });
  }
  function openPanel(value: Panel) { setPanel(value); }
  function reset() { command({ type: "reset" }); setPanel(null); setNotice("Back on the road. Your next adventure awaits."); }


  return <main className="game-shell">
    {started && !portraitAllowed && <div className="rotate-prompt"><span aria-hidden="true">↻</span><h2>Turn your phone sideways</h2><p>A wider view gives you room to aim, drive, and explore.</p><button className="primary" onClick={() => void requestLandscape()}>Enable landscape</button><button className="secondary" onClick={() => setPortraitAllowed(true)}>Continue in portrait</button></div>}
    <aside className="rail" aria-label="Game navigation">
      <Link href="/" className="brand-mark" aria-label="Solmere Free Roam home">s<span>.</span></Link>
      <div className="rail-nav">
        <button className={!panel ? "rail-button active" : "rail-button"} title="Explore" aria-label="Explore" onClick={() => setPanel(null)}><Icon name="compass" /><span>Explore</span></button>
        <button className={panel === "map" ? "rail-button active" : "rail-button"} title="World map" onClick={() => openPanel("map")}><Icon name="map" /><span>Map</span></button>
        <button className={panel === "garage" ? "rail-button active" : "rail-button"} title="Garage" onClick={() => openPanel("garage")}><Icon name="car" /><span>Garage</span></button>
        <button className={panel === "armory" ? "rail-button active" : "rail-button"} title="Loadout" onClick={() => openPanel("armory")}><Icon name="target" /><span>Loadout</span></button>
        <button className={panel === "missions" ? "rail-button active" : "rail-button"} title="Missions" onClick={() => openPanel("missions")}><Icon name="flag" /><span>Missions</span></button>
        <button className={panel === "services" ? "rail-button active" : "rail-button"} title="Petrol and rewards" onClick={() => openPanel("services")}><Icon name="reset" /><span>Petrol</span></button>
      </div>
      <button className={panel === "multiplayer" ? "rail-button active" : "rail-button"} title="Multiplayer" onClick={() => openPanel("multiplayer")}><Icon name="target" /><span>Online</span></button>
      <button className="rail-button rail-help" title="How to play" onClick={() => openPanel("help")}><Icon name="help" /><span>Help</span></button>
      <div className="rail-version">V.01</div>
    </aside>

    <div className="main-area">
      <header className="topbar">
        <div className="wordmark">SOLMERE <span>FREE ROAM</span><small>AN OPEN-WORLD ESCAPE</small></div>
        <div className="topbar-right"><span className="prototype"><i /> LIVE PROTOTYPE</span><span className="top-divider" /><button className="text-button" onClick={() => openPanel("help")}>How to play <Icon name="help" size={17} /></button></div>
      </header>

      <section className={`world ${!started ? "world-welcome" : ""}`} aria-label="Game world">
        <div className="canvas-mount" ref={mount} />
        <div className="world-vignette" />
        <div className="world-top">
          <div className="location-tag"><span className="location-icon"><Icon name="compass" size={24} /></span><div><span className="eyebrow">YOU ARE EXPLORING</span><h2>{currentDistrict.name === "Kessel" ? "Kessel Harbor, Kessel" : currentDistrict.name}</h2><p>{currentDistrict.label} <span>/</span> Solmere Coast</p></div></div>
          <div className="weather"><Icon name="sun" size={25} /><div>{stats.clock}<small>{currentDistrict.hq.toUpperCase()} REGION</small></div>{started && <button aria-label="Pause game" className="glass-icon" onClick={() => openPanel("pause")}><Icon name="pause" size={18} /></button>}</div>
        </div>

        {!started && !panel && <section className="welcome">
          <div className="welcome-kicker"><span /> ONE COAST. ENDLESS WAYS TO ROAM.</div>
          <h1>Take the<br /><em>scenic route.</em></h1>
          <p>From the Sundered Coast to the Stonereach highlands.<br />Pick your ride. Find your road. Roam free.</p>
          <button className="primary start-button" disabled={!ready || !!error} onClick={() => { setStarted(true); void requestLandscape(); }}>{error ? "3D renderer unavailable" : ready ? "Let's drive" : "Building your world..."}<Icon name="arrow" /></button>
          {error ? <div className="error-message" role="alert">Your browser needs WebGL to play. Enable hardware acceleration or try a recent Chrome, Safari, or Firefox.<details><summary>Technical details</summary>{error}</details><button onClick={() => { setError(""); setReady(false); setSession(s => s + 1); }}>Try again</button></div> : <div className="welcome-meta"><span>15 DISTRICTS</span><b> / </b><span>5 RIDES</span><b> / </b><span>NO WRONG TURNS</span></div>}
        </section>}

        {started && !panel && <>
          <div className="vitals" aria-label="Player status"><span>HEALTH <strong data-testid="health">{Math.ceil(stats.health)}</strong><meter min="0" max="100" value={stats.health} aria-label="Health" /></span><span>STAMINA <strong data-testid="stamina">{Math.ceil(stats.stamina)}</strong><meter min="0" max="100" value={stats.stamina} aria-label="Stamina" /></span><span>FUEL <strong data-testid="fuel">{stats.fuel.toFixed(1)} L</strong><meter min="0" max="100" value={stats.fuel} aria-label="Fuel" /></span><button onClick={() => openPanel("services")}>WALLET <strong data-testid="credits">{stats.credits.toFixed(0)} cr</strong></button></div>
          <div className="explore-note"><span className="small-dot" />{stats.missionIndex !== -1 ? <div><span className="eyebrow">{MISSIONS[stats.missionIndex].type}</span><strong>{MISSIONS[stats.missionIndex].name}</strong><p>{formatDistance(stats.missionDistance)} away{stats.missionDistance < 6 ? ", nearly there" : ""}</p><div className="quest-progress"><span style={{ width: `${stats.missionProgress * 100}%` }} /></div></div> : <div><strong>The road is yours.</strong><p>{stats.driving ? "Follow the coast or take the road less travelled." : "Find the orange targets. Turn to aim, F to fire."}</p></div>}</div>
          {stats.nearbyStation !== null && stats.health > 0 && <button className="refuel-prompt primary" disabled={stats.speed > 0 || stats.fuel >= 100 || stats.credits < FUEL_PRICE} onClick={() => command({ type: "refuel" })}>Refuel up to 10 L / {FUEL_PRICE} cr per L</button>}
          {!stats.driving && <div className="crosshair" aria-hidden="true">+</div>}
          <div className="world-actions"><button aria-label={stats.view === "first" ? "Switch to third person" : "Switch to first person"} title="First / third person" onClick={() => command({ type: "view", mode: stats.view === "first" ? "third" : "first" })}>{stats.view === "first" ? "TPV" : "FPV"}</button><button title="Change camera (C)" aria-label="Change camera" onClick={() => command({ type: "camera" })}><Icon name="camera" /></button><button title="Reset ride" aria-label="Reset ride" onClick={reset}><Icon name="reset" /></button>{!stats.driving && <button title="Reload (R)" aria-label="Reload weapon" onClick={() => command({ type: "reload" })}>R</button>}</div>
          <div className="touch-controls"><div className="touch-steer">{<TouchButton keyName="KeyA" label="Steer left" text="L" send={command} />}{<TouchButton keyName="KeyD" label="Steer right" text="R" send={command} />}</div><div className="touch-pedals">{<TouchButton keyName="KeyS" label="Reverse or walk backward" text="REV" send={command} />}{<TouchButton keyName="KeyW" label="Accelerate or walk forward" text="GO" send={command} />}{!stats.driving && <>{<TouchButton keyName="KeyF" label="FIRE" text="FIRE" send={command} />}<button onClick={() => command({ type: "reload" })}>RELOAD</button>{!multiplayer.room && <TouchButton keyName="Space" label="Jump" text="JUMP" send={command} />}</>}</div></div>
        </>}

        {multiplayer.room && started && <div className="battle-hud" aria-live="polite">
          <span>COASTLINE ROYALE · {multiplayer.room.code}</span>
          <strong>{multiplayer.room.phase === "lobby" ? "Waiting for the host" : multiplayer.room.phase === "finished" ? multiplayer.room.winner === multiplayer.room.selfId ? "Victory — last explorer standing" : "Round complete" : `${multiplayer.room.players.filter(p => p.health > 0).length} alive · Zone ${Math.round(multiplayer.room.zone.radius)} m · ${multiplayer.room.zone.remaining}s`}</strong>
          {stats.health <= 0 && <span>You were eliminated. Open Online to leave or view results.</span>}
          {multiplayer.room.phase === "active" && stats.health > 0 && <div className="battle-backpack"><span>Armor {Math.ceil(selfOnline?.armor ?? 0)} · Medkits {selfOnline?.medkits ?? 0} · Reserve {selfOnline?.reserve[weapon] ?? 0}</span><button className="secondary" disabled={!nearbyLoot} onClick={() => void multiplayer.action("pickup")}>{nearbyLoot ? `Collect ${nearbyLoot.kind === "weapon" ? WEAPONS[nearbyLoot.weapon ?? 1].name : nearbyLoot.kind}` : "Move near a supply crate"}</button><button className="secondary" disabled={!selfOnline?.medkits || stats.health >= 100 || selfOnline?.healing} onClick={() => void multiplayer.action("heal")}>{selfOnline?.healing ? "Healing…" : "Use medkit (3s)"}</button></div>}
          {multiplayer.error && <span role="alert">{multiplayer.error}</span>}
        </div>}
        <div className="world-bottom">
          <button className="minimap" onClick={() => openPanel("map")} aria-label="Open world map">
            <div className="minimap-body">
              <div className="compass-ring">
                <svg viewBox={`${stats.x - 115} ${stats.z - 115} 230 230`} aria-hidden="true">
                  <rect x="-1500" y="-1500" width="3000" height="3000" fill="#bed0b3" /><rect x="-1500" y="-1500" width="1360" height="3000" fill="#81b9b8" /><path d="M-101-1000V1600M0-1000V1600M246-1000V1600" stroke="#e9e5cf" strokeWidth="9" />{DISTRICTS.map(d => <path key={d.name} d={`M-101 ${d.z}H246`} stroke="#e9e5cf" strokeWidth="9" />)}
                  {stats.missionIndex !== -1 && <circle cx={MISSIONS[stats.missionIndex].x} cy={MISSIONS[stats.missionIndex].z} r="11" fill="none" stroke="#e77948" strokeWidth="4" />}
                  {stats.nearbyStation !== null && <circle cx={FUEL_STATIONS[stats.nearbyStation].x} cy={FUEL_STATIONS[stats.nearbyStation].z} r="7" fill="#3f8c63" />}
                  {multiplayer.room?.phase === "active" && <circle cx={multiplayer.room.zone.x} cy={multiplayer.room.zone.z} r={multiplayer.room.zone.radius} fill="none" stroke="#497eff" strokeWidth="4" />}
                  {multiplayer.room?.loot.filter(item => !item.taken).map(item => <rect key={item.id} x={item.x-3} y={item.z-3} width="6" height="6" fill={item.kind === "medkit" ? "#ee7259" : "#c29b38"} />)}
                  <circle cx={stats.x} cy={stats.z} r="16" fill="#ee7d4b" opacity=".25" /><circle cx={stats.x} cy={stats.z} r="6" fill="#e76e37" stroke="#fff" strokeWidth="3" />
                </svg>
                <span className="compass-point compass-n">N</span><span className="compass-point compass-e">E</span><span className="compass-point compass-s">S</span><span className="compass-point compass-w">W</span>
              </div>
              <div className="map-legend">
                <span><i className="legend-dot legend-you" />You</span>
                {stats.missionIndex !== -1 && <span><i className="legend-dot legend-mission" />Objective</span>}
                {stats.nearbyStation !== null && <span><i className="legend-dot legend-fuel" />Fuel</span>}
              </div>
            </div>
            <span className="map-caption">EXPLORE SOLMERE <Icon name="arrow" size={14} /></span>
          </button>
          <div className="scene-caption"><span>01 / THE COASTAL EDIT</span><strong>A little farther. A little freer.</strong><small>Stylized world. Real sense of adventure.</small></div>
          <div className="drive-hud">
            {!stats.driving && <div className="ammo-list">{WEAPONS.map((item, index) => <div key={item.name} className={index === weapon ? "ammo-row active" : "ammo-row"}><span>{item.name.toUpperCase()}</span><b>{stats.weaponAmmo[index]}/{item.capacity}</b></div>)}</div>}
            <div className="speed"><strong data-testid="speed">{String(stats.speed).padStart(3, "0")}</strong><span>{stats.driving ? "KM/H" : "ON FOOT"}</span></div><div className="speed-line"><span style={{ width: `${Math.min(100, stats.speed / currentCar.speed * 100)}%` }} /></div><div className="drive-details"><span>{stats.driving ? "AUTO" : WEAPONS[weapon].name.toUpperCase()}</span><b>{stats.driving ? (stats.speed > 0 ? "D" : "N") : stats.reloading ? "RELOADING" : `${stats.ammo} / ${WEAPONS[weapon].capacity}`}</b><span>{stats.driving ? "FREE ROAM" : `${stats.hits} HITS`}</span></div></div>
        </div>
        {notice && <div className="toast" role="status">{notice}</div>}
        {started && stats.message && !notice && <div className="engine-message" role="status">{stats.message}</div>}
        {started && stats.health <= 0 && !panel && !multiplayer.room && <div className="modal-backdrop"><section className="panel panel-pause" role="dialog" aria-modal="true" aria-labelledby="recovery-title"><h2 id="recovery-title">Time to recover.</h2><p className="panel-intro">Your health reached zero. Recover at a safe road with full health. Your wallet and fuel are retained.</p><button className="primary" onClick={() => command({ type: "respawn" })}>Recover at the road</button></section></div>}

        {panel && <div className="modal-backdrop"><section className={`panel panel-${panel}`} role="dialog" aria-modal="true" aria-labelledby="panel-title" ref={dialog}>
          <div className="panel-heading"><div><span className="eyebrow">SOLMERE FREE ROAM / {panel === "pause" ? "TAKE A BREATHER" : "MAKE IT YOURS"}</span><h2 id="panel-title">{({ map: "A whole state of possibility.", garage: "Your next getaway.", armory: "Your next target awaits.", missions: "Your next objective awaits.", help: "A few keys. Endless roads.", pause: "Enjoy the view.", services: "Fuel your next adventure.", multiplayer: "Coastline Royale." })[panel]}</h2></div><button className="close-button" aria-label="Close panel" onClick={() => setPanel(null)}><Icon name="close" /></button></div>
          {panel === "multiplayer" && <MultiplayerPanel {...multiplayer} play={() => { setStarted(true); setPanel(null); }} />}
          {panel === "garage" && <><p className="panel-intro">Five distinct rides. Compare performance, choose your terrain, and take the coast your way.</p><div className="garage-grid">{VEHICLES.map((car, index) => <button key={car.id} className={`vehicle-card ${vehicle === index ? "selected" : ""}`} onClick={() => { setVehicle(index); command({ type: "vehicle", index }); setNotice(`${car.name} is ready to roam.`); }}><div className="vehicle-card-top"><span>{car.type}</span><i style={{ background: car.color }} />{vehicle === index && <b>SELECTED</b>}</div><div className="vehicle-render">{previews[index] ? <Image src={previews[index]} width={640} height={360} unoptimized alt={`${car.name}, front three-quarter view`} /> : <span>Preparing vehicle preview…</span>}</div><h3>{car.name}</h3><p>{car.inspiration}</p><div className="vehicle-specs"><span><strong>{car.speed}</strong> KM/H</span><span><strong>{car.handling}</strong> HANDLING</span></div></button>)}</div><div className="panel-footer"><small>Rendered game vehicles · Blender-crafted wheels · Original designs</small><button className="primary" onClick={() => { setPanel(null); if (ready) setStarted(true); }} disabled={!ready}>Take it for a drive <Icon name="arrow" size={18} /></button></div></>}
          {panel === "map" && <><p className="panel-intro">Eighteen province destinations, one connected playground. Select a destination to fast travel.</p><div className="map-layout"><div className="state-map"><span className="map-sea">THE<br />OPEN SEA</span><DistrictMap active={stats.district} ready={ready} onSelect={index => { command({ type: "travel", index }); setPanel(null); setStarted(true); setNotice(`Welcome to ${DISTRICTS[index].name}.`); }} /><small>STYLIZED / NOT TO SCALE / FICTIONAL PLACE</small></div><div className="district-list">{DISTRICTS.map((d, index) => <button key={d.name} onClick={() => { command({ type: "travel", index }); setPanel(null); setStarted(true); setNotice(`Welcome to ${d.name}.`); }} disabled={!ready}><span className="district-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{d.name}</strong><small>{d.label} <span>/</span> HQ {d.hq} <span>/</span> {d.area.toLocaleString()} km²</small><small className="district-about">{d.about}</small></span>{stats.district === index ? <span className="here-tag">YOU ARE HERE</span> : <Icon name="arrow" size={16} />}</button>)}</div></div></>}
          {panel === "armory" && <><p className="panel-intro">Choose from six fictional weapons. Shoot orange targets on foot to earn 10 credits per hit and a 50-credit bonus every five hits.</p><div className="weapon-grid">{WEAPONS.map((item, index) => <button className={`weapon-card ${weapon === index ? "selected" : ""}`} key={item.name} disabled={!!selfOnline && !selfOnline.weapons[index]} onClick={() => command({ type: "weapon", index })}><span className="eyebrow">SLOT 0{index + 1}</span><div className="weapon-render">{weaponPreviews[index] ? <Image src={weaponPreviews[index]} width={640} height={360} unoptimized alt={`${item.name} in-game weapon`} /> : <span>Preparing weapon preview…</span>}</div><h3>{item.name}</h3><p>{item.capacity} rounds / {item.description}</p><strong>{selfOnline && !selfOnline.weapons[index] ? "FIND IN WORLD" : weapon === index ? "EQUIPPED" : "EQUIP WEAPON"}</strong></button>)}</div><div className="range-tip"><Icon name="help" /><p>On foot: <kbd>A</kbd> <kbd>D</kbd> turn to aim, or drag the scene. <kbd>F</kbd> or click to fire; hold F for automatic weapons. <kbd>1-6</kbd> select weapons. <kbd>R</kbd> reloads. Bullets are blocked by buildings and your car.</p></div><div className="panel-footer"><small>Fictional gameplay only. No graphic violence.</small><button className="primary" disabled={!ready || stats.health <= 0 || (stats.driving && stats.speed > 5)} onClick={() => { if (stats.driving) command({ type: "toggle-drive" }); setStarted(true); setPanel(null); }}>Head out on foot <Icon name="arrow" size={18} /></button></div></>}
          {panel === "missions" && <><p className="panel-intro">Five original objectives across Solmere. An on-foot errand and a driving delivery are ready to run; the rest need vehicle modes still in testing. Only one objective is active at a time, and each pays out on completion.</p><div className="mission-list">{MISSIONS.map((item, index) => { const locked = item.mode !== "car" && item.mode !== "foot"; const active = stats.missionIndex === index; return <div key={item.name} className={`mission-card ${active ? "selected" : ""} ${locked ? "locked" : ""}`}><span className="eyebrow">{item.type}</span><h3>{item.name}</h3><p>{item.description}</p><small>{item.objective} <span>/</span> {item.reward} credits</small>{locked ? <strong>Needs a vehicle mode not yet available</strong> : active ? <button className="secondary" onClick={() => command({ type: "mission-abandon" })}>Abandon objective</button> : <button className="primary" disabled={!ready || stats.health <= 0} onClick={() => { command({ type: "mission-start", index }); setPanel(null); setStarted(true); }}>Start objective <Icon name="arrow" size={16} /></button>}</div>; })}</div><div className="range-tip"><Icon name="help" /><p>Objectives completed this session: <strong>{stats.missionsCompleted}</strong>. Walk or drive to the glowing waypoint marker and the objective completes automatically.</p></div></>}
          {panel === "services" && <><p className="panel-intro">Wallet: <strong>{stats.credits.toFixed(0)} credits</strong> / Fuel: <strong>{stats.fuel.toFixed(1)} of 100 L</strong>. Petrol costs {FUEL_PRICE} credits per litre. Stop beside a pump to buy up to 10 L at a time.</p><div className="range-tip"><Icon name="target" /><p><strong>Earn your fuel:</strong> Each orange target hit pays 10 credits. Every five hits earns another 50 credits. Targets reset after a short cooldown. Money and fuel last for this session; refreshing starts over.</p></div><p className="panel-intro">Out of petrol? Free recovery takes you and your car to a station, but does not refill the tank or restore health.</p><div className="station-list">{FUEL_STATIONS.map((station, index) => <button className="secondary" key={station.name} disabled={!ready || stats.health <= 0} onClick={() => { command({ type: "station-travel", index }); setPanel(null); setStarted(true); }}><span>{station.name}</span><span>Tow to station <Icon name="arrow" size={15} /></span></button>)}</div></>}
          {panel === "help" && <><p className="panel-intro">No finish line to chase, but a few optional objectives if you want one. Open Missions any time to pick a job.</p><div className="controls-grid">{[["W A S D", "Drive / walk", "Arrow keys work too. Hold SHIFT to run or boost, but running drains stamina"], ["SPACE", "Brake / jump", "Brake in a car; jump on foot in free roam"], ["E", "Enter / exit car or home", "Also steps inside a nearby guesthouse door"], ["F / CLICK", "Fire", "On foot, face a target or drag to aim"], ["1 2 3 / R", "Loadout / reload", "Switch weapons or refill your magazine"], ["C / ESC", "Camera / pause", "Change perspective or take a break"]].map(([key, title, subtitle]) => <div key={key}><kbd>{key}</kbd><strong>{title}</strong><p>{subtitle}</p></div>)}</div><div className="range-tip"><Icon name="reset" /><p>Stuck? Use <strong>Reset Ride</strong> to return to the nearest district road at any time. On mobile, hold the on-screen steering and pedal buttons.</p></div><p className="fine-print">Prototype scope: a fictional, compressed, procedural geography with all 18 district destinations. Not modeled on any real place. Boat, helicopter and drone travel are modeled but not yet drivable, so their objectives stay locked. Private online battle-royale rooms are available under Online. Traffic and police are not implemented, and progress does not persist across a refresh.</p></>}
          {panel === "pause" && <><p className="panel-intro">Your adventure will be right here. The simulation is paused.</p><div className="pause-actions"><button className="primary" onClick={() => setPanel(null)}><Icon name="play" size={18} /> Back to the road</button><button className="secondary" onClick={reset}><Icon name="reset" size={18} /> Reset ride</button><button className="secondary" onClick={() => setPanel("map")}><Icon name="map" size={18} /> Explore the map</button><button className="secondary" onClick={() => { const next = !muted; setMuted(next); command({ type: "mute", value: next }); }}><Icon name={muted ? "mute" : "volume"} size={18} /> {muted ? "Unmute sound" : "Mute sound"}</button></div></>}
        </section></div>}
      </section>

      <footer className="bottom-bar"><button className="current-vehicle" onClick={() => openPanel("garage")}><span className="vehicle-icon"><Icon name="car" /></span><div><small>YOUR RIDE</small><strong>{currentCar.name}</strong></div><span className="change-label">CHANGE <Icon name="arrow" size={14} /></span></button><div className="keyboard-hints"><span><kbd>W A S D</kbd> Move</span><span><kbd>SPACE</kbd> Brake</span><span><kbd>E</kbd> Enter / exit</span></div><button className="exit-button" title={!stats.driving && !stats.canEnterCar ? "Walk to the side of your parked car to enter" : "Stop before exiting; stand beside the car to enter"} disabled={!ready || !started || !!panel || stats.health <= 0 || (stats.driving ? stats.speed > 5 : !stats.canEnterCar)} onClick={() => command({ type: "toggle-drive" })}><Icon name={stats.driving ? "compass" : "car"} size={18} />{stats.driving ? "Explore on foot" : stats.canEnterCar ? "Return to car" : "Walk to your car"}</button></footer>
    </div>
  </main>;
}
