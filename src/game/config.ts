import type { RoomSnapshot } from "./multiplayer-types";
export const VEHICLES = [
  { id: "sport", name: "Bavarian GT", inspiration: "BMW-inspired sports coupe", type: "SPORT COUPE", color: "#ef783f", speed: 210, handling: 88, shape: "sport" },
  { id: "sedan", name: "Autobahn RS", inspiration: "Audi-inspired performance sedan", type: "SPORT SEDAN", color: "#cbd8de", speed: 230, handling: 84, shape: "sedan" },
  { id: "jeep", name: "Trailhawk", inspiration: "Jeep-inspired off-roader", type: "OFF-ROAD", color: "#d5b967", speed: 150, handling: 75, shape: "offroad" },
  { id: "luxury", name: "Royal Regent", inspiration: "Rolls-Royce-inspired luxury car", type: "LUXURY", color: "#393d50", speed: 190, handling: 68, shape: "luxury" },
  { id: "defender", name: "Highland 110", inspiration: "Defender-inspired adventure SUV", type: "ADVENTURE SUV", color: "#91a58a", speed: 170, handling: 80, shape: "offroad" },
] as const;

// Fictional province destinations for a fictional coastal state. Not modeled on any real place.
export const DISTRICTS = [
  { name: "Verath", x: -90, z: -850, label: "Northern coast", hq: "Verath", area: 1980, about: "An old sea fort watches over a coast of mixed tongues" },
  { name: "Thalore", x: -60, z: -710, label: "Palm coast", hq: "Thalore", area: 2950, about: "Masked ritual dances and centuries-old hand looms" },
  { name: "Mistvale", x: 95, z: -620, label: "Highland escape", hq: "Cloudspire", area: 2140, about: "Misty ridgelines and wild coffee and pepper groves" },
  { name: "Calmora", x: -35, z: -540, label: "Sundered coast", hq: "Calmora", area: 2330, about: "A once-great spice port that still smells of cardamom" },
  { name: "Greenmere", x: 20, z: -390, label: "Green country", hq: "Greenmere", area: 3520, about: "The most crowded of the fourteen provinces" },
  { name: "Windgate", x: 160, z: -260, label: "Gateway to the hills", hq: "Windgate", area: 4460, about: "Largest of the provinces, guarding the mountain pass" },
  { name: "Revelrun", x: 35, z: -150, label: "Cultural heartland", hq: "Revelrun", area: 3010, about: "Home of the grand lantern-and-drum festival" },
  { name: "Kessel", x: 0, z: 0, label: "Harborside drive", hq: "Kessel Crest", area: 2390, about: "Kessel Harbor is the busiest trading exchange on the coast" },
  { name: "Stonereach", x: 200, z: 80, label: "The high range", hq: "Stonereach", area: 4340, about: "Terraced plantations ring the great arch dam" },
  { name: "Reedmere", x: 95, z: 200, label: "Lakeside country", hq: "Reedmere", area: 2190, about: "First province where every soul learned to read" },
  { name: "Driftwater", x: 5, z: 320, label: "Backwater trails", hq: "Driftwater", area: 1400, about: "Houseboats drift the coast's own \"floating city\"" },
  { name: "Ashwood", x: 155, z: 430, label: "Forest country", hq: "Ashwood", area: 2630, about: "The forest path up to the Mount Ashen shrine" },
  { name: "Saltmere", x: 50, z: 590, label: "Southern backwaters", hq: "Saltmere", area: 2470, about: "Cashew traders and the wide Tidewater Lake" },
  { name: "Sunhaven", x: 95, z: 780, label: "The southern capital", hq: "Sunhaven", area: 2180, about: "Capital province, home to the Sunken Court shrine" },
  { name: "Wastelands Edge", x: 230, z: 940, label: "The scorched frontier", hq: "Outlander Camp", area: 860, about: "Where the coast road cracks into dry earth, rusted rigs, and a wind-scoured ruin" },
  { name: "Copper Bay", x: 40, z: 1100, label: "Trading port", hq: "Copper Quay", area: 970, about: "Warehouses and sheltered roads along the southern trading coast" },
  { name: "Cedar Reach", x: 180, z: 1290, label: "Forest foothills", hq: "Cedar Junction", area: 1230, about: "Quiet guesthouses and long drives beneath the highland ridges" },
  { name: "Lastlight", x: 30, z: 1460, label: "Southern frontier", hq: "Lastlight Point", area: 890, about: "The final stretch of coastal highway, beyond the old frontier" },
] as const;

export const WEAPONS = [
  { name: "Sidearm", capacity: 12, cooldown: 0.3, range: 105, spread: 0.008, pellets: 1, reload: 1.1, automatic: false, description: "Balanced semi-automatic sidearm" },
  { name: "Carbine", capacity: 30, cooldown: 0.12, range: 150, spread: 0.015, pellets: 1, reload: 1.7, automatic: true, description: "Automatic rifle with moderate recoil" },
  { name: "Scattergun", capacity: 6, cooldown: 0.7, range: 62, spread: 0.085, pellets: 7, reload: 2.3, automatic: false, description: "Seven-pellet close-range spread" },
  { name: "Compact SMG", capacity: 32, cooldown: 0.075, range: 85, spread: 0.025, pellets: 1, reload: 1.5, automatic: true, description: "Fast fire with a wider spread" },
  { name: "Marksman", capacity: 8, cooldown: 0.85, range: 250, spread: 0.003, pellets: 1, reload: 2, automatic: false, description: "Precise long-range single shots" },
  { name: "Revolver", capacity: 6, cooldown: 0.48, range: 115, spread: 0.007, pellets: 1, reload: 2.1, automatic: false, description: "Deliberate shots and stronger recoil" },
] as const;

export const FUEL_PRICE = 2;
export const FUEL_STATIONS = DISTRICTS.map((district, index) => ({
  name: `${district.name} Petrol`, district: index, x: 17, z: district.z + 65,
}));

export type TransportMode = "car" | "foot" | "boat" | "helicopter" | "drone";
export const TRANSPORTS = [
  { id: "car", name: "Road collection", type: "LAND", description: "Five detailed cars for coastal roads and country lanes.", speed: 210 },
  { id: "boat", name: "Tideway Runner", type: "SEA", description: "A motorboat with a working propeller and a rolling wake.", speed: 85 },
  { id: "helicopter", name: "Coastline Heli", type: "AIR", description: "Lift off, explore from above, and land at your own pace.", speed: 160 },
  { id: "drone", name: "Survey Quad", type: "DRONE", description: "A nimble quadcopter for aerial exploration and surveys.", speed: 65 },
] as const;

// Each home is reserved before procedural scenery is placed.
export const HOMES = DISTRICTS.map((district, index) => ({
  district: index, name: `${district.name} guesthouse`, x: district.x + 32, z: district.z + 30,
}));

export const MISSIONS = [
  { name: "A place to call home", type: "EXPLORATION", description: "Step inside the Kessel guesthouse and explore your new base.", objective: "Walk to the marked door and enter the guesthouse.", mode: "foot", x: 32, z: 38, altitude: 0, reward: 100 },
  { name: "The coastal delivery", type: "DRIVING", description: "Take a local delivery north along the Kessel road.", objective: "Drive to the gold marker and stop inside it.", mode: "car", x: 0, z: -100, altitude: 0, reward: 200 },
  { name: "A harbor boat run", type: "BOATING", description: "Carry harbour supplies to the offshore meeting point.", objective: "Pilot the boat north to the gold marker and slow down.", mode: "boat", x: -190, z: -140, altitude: 0, reward: 250 },
  { name: "A different perspective", type: "DRONE SURVEY", description: "Survey the coast from your quadcopter.", objective: "Reach the marker above 25 m and hover for 3 seconds.", mode: "drone", x: 0, z: -90, altitude: 25, reward: 300 },
  { name: "A soft landing", type: "HELICOPTER", description: "Make a short helicopter transfer to the northern landing zone.", objective: "Fly to the marked pad, descend below 4 m, and stop.", mode: "helicopter", x: 0, z: -120, altitude: 0, reward: 400 },
] as const;

export type GameStats = {
  view: "first" | "third" | "overhead";
  heading: number;
  speed: number;
  district: number;
  driving: boolean;
  ammo: number;
  weaponAmmo: readonly number[];
  hits: number;
  x: number;
  z: number;
  mode: TransportMode;
  altitude: number;
  nearbyHome: number | null;
  insideHome: number | null;
  missionIndex: number;
  missionsCompleted: number;
  missionProgress: number;
  missionDistance: number;
  credits: number;
  health: number;
  stamina: number;
  fuel: number;
  clock: string;
  nearbyStation: number | null;
  canEnterCar: boolean;
  weaponIndex: number;
  reloading: boolean;
  message: string;
};
export const INITIAL_STATS: GameStats = { view: "third", heading: 0, speed: 0, district: 7, driving: true, ammo: 12, weaponAmmo: WEAPONS.map((weapon) => weapon.capacity), hits: 0, x: 0, z: 0, mode: "car", altitude: 0, nearbyHome: null, insideHome: null, missionIndex: -1, missionsCompleted: 0, missionProgress: 0, missionDistance: 0, credits: 100, health: 100, stamina: 100, fuel: 65, clock: "06:00", nearbyStation: null, canEnterCar: false, weaponIndex: 0, reloading: false, message: "" };
export type GameCommand =
  | { type: "room"; snapshot: RoomSnapshot | null }
  | { type: "vehicle"; index: number }
  | { type: "travel"; index: number }
  | { type: "weapon"; index: number }
  | { type: "reset" }
  | { type: "toggle-drive" }
  | { type: "reload" }
  | { type: "fire" }
  | { type: "camera" }
  | { type: "view"; mode: "first" | "third" }
  | { type: "refuel" }
  | { type: "station-travel"; index: number }
  | { type: "respawn" }
  | { type: "transport"; mode: Exclude<TransportMode, "foot"> }
  | { type: "home-travel"; index: number }
  | { type: "interact" }
  | { type: "mission-start"; index: number }
  | { type: "mission-abandon" }
  | { type: "pause"; value: boolean }
  | { type: "mute"; value: boolean }
  | { type: "input"; key: string; pressed: boolean };
export type GameController = { command: (command: GameCommand) => void; dispose: () => void; getVehiclePreview: (index: number) => string; getWeaponPreview: (index: number) => string };
