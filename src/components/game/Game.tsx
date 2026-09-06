"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DISTRICTS, INITIAL_STATS, VEHICLES, WEAPONS, type GameCommand, type GameController } from "@/game/config";

type IconName = "compass" | "map" | "car" | "target" | "help" | "reset" | "sun" | "arrow" | "close" | "pause" | "play" | "camera";
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
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function CarArt({ color, shape, large = false }: { color: string; shape: string; large?: boolean }) {
  const tall = shape === "offroad";
  return <svg className={large ? "car-art large" : "car-art"} viewBox="0 0 300 130" aria-hidden="true">
    <ellipse cx="151" cy="105" rx="119" ry="10" fill="#000" opacity=".12" />
    <path d={tall ? "M34 56 62 48 78 20h119l28 33 41 10 7 31H25Z" : "M29 72 70 61 107 32h77l44 32 42 12 4 21H24Z"} fill={color} />
    <path d={tall ? "m86 27-14 27h58V27Zm53 0v27h71l-21-27Z" : "m110 39-29 24h53V39Zm34 0v24h67l-30-24Z"} fill="#23484b" />
    <path d="M34 80h29m170 0h29" stroke="#f8efd6" strokeWidth="7" />
    <path d="M95 74h17m41 0h17M84 94h132" stroke="#182d2f" strokeOpacity=".35" strokeWidth="3" />
    <path d="M28 95h244" stroke="#223535" strokeWidth="6" />
    {[73, 225].map(x => <g key={x}><circle cx={x} cy="96" r="21" fill="#223034" /><circle cx={x} cy="96" r="12" fill="#adc0c1" /><circle cx={x} cy="96" r="6" fill="#455b5b" /></g>)}
  </svg>;
}

type Panel = "map" | "garage" | "armory" | "help" | "pause" | null;

export default function Game() {
  const mount = useRef<HTMLDivElement>(null);
  const controller = useRef<GameController | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [started, setStarted] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [stats, setStats] = useState(INITIAL_STATS);
  const [vehicle, setVehicle] = useState(0);
  const [weapon, setWeapon] = useState(0);
  const [notice, setNotice] = useState("");
  const [session, setSession] = useState(0);
  const currentCar = VEHICLES[vehicle];
  const currentDistrict = DISTRICTS[stats.district];

  useEffect(() => {
    let cancelled = false;
    let instance: GameController | undefined;
    import("@/game/engine").then(({ createGame }) => {
      if (cancelled || !mount.current) return;
      instance = createGame(mount.current, setStats, () => setReady(true));
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
      if (started && !panel && ["Digit1", "Digit2", "Digit3"].includes(event.code)) setWeapon(Number(event.code.slice(-1)) - 1);
      if (event.code === "Tab" && dialog.current) {
        const controls = dialog.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
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
  function touchButton(key: string, label: string, text: string) {
    return <button aria-label={label} onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); command({ type: "input", key, pressed: true }); }} onPointerUp={() => command({ type: "input", key, pressed: false })} onPointerCancel={() => command({ type: "input", key, pressed: false })} onLostPointerCapture={() => command({ type: "input", key, pressed: false })}>{text}</button>;
  }

  return <main className="game-shell">
    <aside className="rail" aria-label="Game navigation">
      <Link href="/" className="brand-mark" aria-label="Kerala Free Roam home">k<span>.</span></Link>
      <div className="rail-nav">
        <button className={!panel ? "rail-button active" : "rail-button"} title="Explore" aria-label="Explore" onClick={() => setPanel(null)}><Icon name="compass" /><span>Explore</span></button>
        <button className={panel === "map" ? "rail-button active" : "rail-button"} title="World map" onClick={() => openPanel("map")}><Icon name="map" /><span>Map</span></button>
        <button className={panel === "garage" ? "rail-button active" : "rail-button"} title="Garage" onClick={() => openPanel("garage")}><Icon name="car" /><span>Garage</span></button>
        <button className={panel === "armory" ? "rail-button active" : "rail-button"} title="Loadout" onClick={() => openPanel("armory")}><Icon name="target" /><span>Loadout</span></button>
      </div>
      <button className="rail-button rail-help" title="How to play" onClick={() => openPanel("help")}><Icon name="help" /><span>Help</span></button>
      <div className="rail-version">V.01</div>
    </aside>

    <div className="main-area">
      <header className="topbar">
        <div className="wordmark">KERALA <span>FREE ROAM</span><small>AN OPEN-WORLD ESCAPE</small></div>
        <div className="topbar-right"><span className="prototype"><i /> LIVE PROTOTYPE</span><span className="top-divider" /><button className="text-button" onClick={() => openPanel("help")}>How to play <Icon name="help" size={17} /></button></div>
      </header>

      <section className="world" aria-label="Game world">
        <div className="canvas-mount" ref={mount} />
        <div className="world-vignette" />
        <div className="world-top">
          <div className="location-tag"><span className="location-icon"><Icon name="compass" size={24} /></span><div><span className="eyebrow">YOU ARE EXPLORING</span><h2>{currentDistrict.name === "Ernakulam" ? "Kochi, Ernakulam" : currentDistrict.name}</h2><p>{currentDistrict.label} <span>/</span> Kerala, India</p></div></div>
          <div className="weather"><Icon name="sun" size={25} /><div>Golden days<small>DAYLIGHT / FREE ROAM</small></div>{started && <button aria-label="Pause game" className="glass-icon" onClick={() => openPanel("pause")}><Icon name="pause" size={18} /></button>}</div>
        </div>

        {!started && !panel && <section className="welcome">
          <div className="welcome-kicker"><span /> GOD&apos;S OWN COUNTRY. YOUR OWN WAY.</div>
          <h1>Take the<br /><em>scenic route.</em></h1>
          <p>From the Malabar coast to the Western Ghats.<br />Pick your ride. Find your road. Roam free.</p>
          <button className="primary start-button" disabled={!ready || !!error} onClick={() => setStarted(true)}>{error ? "3D renderer unavailable" : ready ? "Let's drive" : "Building your world..."}<Icon name="arrow" /></button>
          {error ? <div className="error-message" role="alert">Your browser needs WebGL to play. Enable hardware acceleration or try a recent Chrome, Safari, or Firefox.<details><summary>Technical details</summary>{error}</details><button onClick={() => { setError(""); setReady(false); setSession(s => s + 1); }}>Try again</button></div> : <div className="welcome-meta"><span>14 DISTRICTS</span><b> / </b><span>5 RIDES</span><b> / </b><span>NO WRONG TURNS</span></div>}
        </section>}

        {started && !panel && <>
          <div className="explore-note"><span className="small-dot" /><div><strong>The road is yours.</strong><p>{stats.driving ? "Follow the coast or take the road less travelled." : "Find the orange targets. Turn to aim, F to fire."}</p></div></div>
          {!stats.driving && <div className="crosshair" aria-hidden="true">+</div>}
          <div className="world-actions"><button title="Change camera (C)" aria-label="Change camera" onClick={() => command({ type: "camera" })}><Icon name="camera" /></button><button title="Reset ride" aria-label="Reset ride" onClick={reset}><Icon name="reset" /></button>{!stats.driving && <button title="Reload (R)" aria-label="Reload weapon" onClick={() => command({ type: "reload" })}>R</button>}</div>
          <div className="touch-controls"><div className="touch-steer">{touchButton("KeyA", "Steer left", "L")}{touchButton("KeyD", "Steer right", "R")}</div><div className="touch-pedals">{touchButton("KeyS", "Reverse or walk backward", "REV")}{touchButton("KeyW", "Accelerate or walk forward", "GO")}{!stats.driving && <button onClick={() => command({ type: "fire" })}>FIRE</button>}</div></div>
        </>}

        <div className="world-bottom">
          <button className="minimap" onClick={() => openPanel("map")} aria-label="Open world map">
            <svg viewBox={`${stats.x - 130} ${stats.z - 100} 260 200`} aria-hidden="true"><rect x="-1500" y="-1500" width="3000" height="3000" fill="#bed0b3" /><rect x="-1500" y="-1500" width="1360" height="3000" fill="#81b9b8" /><path d="M-101-1000V1000M0-1000V1000M246-1000V1000" stroke="#e9e5cf" strokeWidth="9" />{DISTRICTS.map(d => <path key={d.name} d={`M-101 ${d.z}H246`} stroke="#e9e5cf" strokeWidth="9" />)}<circle cx={stats.x} cy={stats.z} r="16" fill="#ee7d4b" opacity=".25" /><circle cx={stats.x} cy={stats.z} r="6" fill="#e76e37" stroke="#fff" strokeWidth="3" /></svg>
            <span className="map-north">N</span><span className="map-caption">EXPLORE KERALA <Icon name="arrow" size={14} /></span>
          </button>
          <div className="scene-caption"><span>01 / THE COASTAL EDIT</span><strong>A little farther. A little freer.</strong><small>Stylized world. Real sense of adventure.</small></div>
          <div className="drive-hud"><div className="speed"><strong data-testid="speed">{String(stats.speed).padStart(3, "0")}</strong><span>{stats.driving ? "KM/H" : "ON FOOT"}</span></div><div className="speed-line"><span style={{ width: `${Math.min(100, stats.speed / currentCar.speed * 100)}%` }} /></div><div className="drive-details"><span>{stats.driving ? "AUTO" : WEAPONS[weapon].name.toUpperCase()}</span><b>{stats.driving ? (stats.speed > 0 ? "D" : "N") : `${stats.ammo} / ${WEAPONS[weapon].capacity}`}</b><span>{stats.driving ? "FREE ROAM" : `${stats.hits} HITS`}</span></div></div>
        </div>
        {notice && <div className="toast" role="status">{notice}</div>}

        {panel && <div className="modal-backdrop"><section className={`panel panel-${panel}`} role="dialog" aria-modal="true" aria-labelledby="panel-title" ref={dialog}>
          <div className="panel-heading"><div><span className="eyebrow">KERALA FREE ROAM / {panel === "pause" ? "TAKE A BREATHER" : "MAKE IT YOURS"}</span><h2 id="panel-title">{({ map: "A whole state of possibility.", garage: "Find your kind of freedom.", armory: "Your next target awaits.", help: "A few keys. Endless roads.", pause: "Enjoy the view." })[panel]}</h2></div><button className="close-button" aria-label="Close panel" onClick={() => setPanel(null)}><Icon name="close" /></button></div>
          {panel === "garage" && <><p className="panel-intro">Five original rides. Every road is a different story. Choose a car to take it out.</p><div className="garage-grid">{VEHICLES.map((car, index) => <button key={car.id} className={`vehicle-card ${vehicle === index ? "selected" : ""}`} onClick={() => { setVehicle(index); command({ type: "vehicle", index }); setNotice(`${car.name} is ready to roam.`); }}><div className="vehicle-card-top"><span>{car.type}</span><i style={{ background: car.color }} />{vehicle === index && <b>SELECTED</b>}</div><CarArt color={car.color} shape={car.shape} /><h3>{car.name}</h3><p>{car.inspiration}</p><div className="vehicle-specs"><span><strong>{car.speed}</strong> KM/H</span><span><strong>{car.handling}</strong> HANDLING</span></div></button>)}</div><div className="panel-footer"><small>Original procedural models. No brand affiliation or licensed replicas.</small><button className="primary" onClick={() => { setPanel(null); if (ready) setStarted(true); }} disabled={!ready}>Take it for a drive <Icon name="arrow" size={18} /></button></div></>}
          {panel === "map" && <><p className="panel-intro">Fourteen district destinations, one connected playground. Select a destination to fast travel.</p><div className="map-layout"><div className="state-map"><span className="map-sea">ARABIAN<br />SEA</span><svg viewBox="0 0 300 520" aria-label="Stylized Kerala district overview"><path d="m52 13 42 14 20 31 22 11 12 46 41 42-6 43 42 60-8 27 38 44-4 39 27 34-7 63-25 31-28-45-10-50-27-44-17-52-19-37-14-53-31-34-2-44-25-37Z" fill="#b9c9a5" stroke="#839d79" strokeWidth="2" /><path d={DISTRICTS.map((d, i) => `${i ? "L" : "M"}${75 + (d.z + 850) * .065 + d.x * .4},${40 + (d.z + 850) * .26}`).join(" ")} fill="none" stroke="#fff8df" strokeWidth="4" />{DISTRICTS.map((d, i) => <g key={d.name}><circle cx={75 + (d.z + 850) * .065 + d.x * .4} cy={40 + (d.z + 850) * .26} r={stats.district === i ? 8 : 4} fill={stats.district === i ? "#e67543" : "#3d6859"} stroke="#fff8ed" strokeWidth="2" /></g>)}</svg><small>STYLIZED / NOT TO SCALE</small></div><div className="district-list">{DISTRICTS.map((d, index) => <button key={d.name} onClick={() => { command({ type: "travel", index }); setPanel(null); setStarted(true); setNotice(`Welcome to ${d.name}.`); }} disabled={!ready}><span className="district-number">{String(index + 1).padStart(2, "0")}</span><span><strong>{d.name}</strong><small>{d.label}</small></span>{stats.district === index ? <span className="here-tag">YOU ARE HERE</span> : <Icon name="arrow" size={16} />}</button>)}</div></div></>}
          {panel === "armory" && <><p className="panel-intro">A non-graphic target range is waiting at each district. Exit your car, face an orange target, and take your shot.</p><div className="weapon-grid">{WEAPONS.map((item, index) => <button className={`weapon-card ${weapon === index ? "selected" : ""}`} key={item.name} onClick={() => { setWeapon(index); command({ type: "weapon", index }); }}><span className="eyebrow">SLOT 0{index + 1}</span><Icon name="target" size={52} /><h3>{item.name}</h3><p>{item.capacity} rounds / {index === 0 ? "Balanced precision" : index === 1 ? "Rapid fire" : "Wide spread"}</p><strong>{weapon === index ? "EQUIPPED" : "EQUIP WEAPON"}</strong></button>)}</div><div className="range-tip"><Icon name="help" /><p>On foot: <kbd>A</kbd> <kbd>D</kbd> turn to aim, or drag the scene. <kbd>F</kbd> or click the scene to fire. <kbd>R</kbd> reloads. Targets reset after a hit.</p></div><div className="panel-footer"><small>Fictional gameplay only. No graphic violence.</small><button className="primary" disabled={!ready} onClick={() => { if (stats.driving) command({ type: "toggle-drive" }); setStarted(true); setPanel(null); }}>Head out on foot <Icon name="arrow" size={18} /></button></div></>}
          {panel === "help" && <><p className="panel-intro">No missions to rush. No finish line to chase. Just explore.</p><div className="controls-grid">{[["W A S D", "Drive / walk", "Arrow keys work too"], ["SPACE", "Brake", "Hold SHIFT for a boost"], ["E", "Enter / exit car", "Switch between driving and walking"], ["F / CLICK", "Fire", "On foot, face a target or drag to aim"], ["1 2 3 / R", "Loadout / reload", "Switch weapons or refill your magazine"], ["C / ESC", "Camera / pause", "Change perspective or take a break"]].map(([key, title, subtitle]) => <div key={key}><kbd>{key}</kbd><strong>{title}</strong><p>{subtitle}</p></div>)}</div><div className="range-tip"><Icon name="reset" /><p>Stuck? Use <strong>Reset Ride</strong> to return to the nearest district road at any time. On mobile, hold the on-screen steering and pedal buttons.</p></div><p className="fine-print">Prototype scope: compressed, procedural geography with all 14 district destinations. Not a street-accurate Kerala map. No traffic, police, multiplayer, or saved progress yet.</p></>}
          {panel === "pause" && <><p className="panel-intro">Your adventure will be right here. The simulation is paused.</p><div className="pause-actions"><button className="primary" onClick={() => setPanel(null)}><Icon name="play" size={18} /> Back to the road</button><button className="secondary" onClick={reset}><Icon name="reset" size={18} /> Reset ride</button><button className="secondary" onClick={() => setPanel("map")}><Icon name="map" size={18} /> Explore the map</button></div></>}
        </section></div>}
      </section>

      <footer className="bottom-bar"><button className="current-vehicle" onClick={() => openPanel("garage")}><span className="vehicle-icon"><Icon name="car" /></span><div><small>YOUR RIDE</small><strong>{currentCar.name}</strong></div><span className="change-label">CHANGE <Icon name="arrow" size={14} /></span></button><div className="keyboard-hints"><span><kbd>W A S D</kbd> Move</span><span><kbd>SPACE</kbd> Brake</span><span><kbd>E</kbd> Enter / exit</span></div><button className="exit-button" disabled={!ready || !started || !!panel} onClick={() => command({ type: "toggle-drive" })}><Icon name={stats.driving ? "compass" : "car"} size={18} />{stats.driving ? "Explore on foot" : "Return to car"}</button></footer>
    </div>
  </main>;
}
