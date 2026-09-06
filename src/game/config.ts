export const VEHICLES = [
  { id: "sport", name: "Bavarian GT", inspiration: "BMW-inspired sports coupe", type: "SPORT COUPE", color: "#ef783f", speed: 210, handling: 88, shape: "sport" },
  { id: "sedan", name: "Autobahn RS", inspiration: "Audi-inspired performance sedan", type: "SPORT SEDAN", color: "#cbd8de", speed: 230, handling: 84, shape: "sedan" },
  { id: "jeep", name: "Trailhawk", inspiration: "Jeep-inspired off-roader", type: "OFF-ROAD", color: "#d5b967", speed: 150, handling: 75, shape: "offroad" },
  { id: "luxury", name: "Royal Regent", inspiration: "Rolls-Royce-inspired luxury car", type: "LUXURY", color: "#393d50", speed: 190, handling: 68, shape: "luxury" },
  { id: "defender", name: "Highland 110", inspiration: "Defender-inspired adventure SUV", type: "ADVENTURE SUV", color: "#91a58a", speed: 170, handling: 80, shape: "offroad" },
] as const;

// Compressed district destinations, not surveyed coordinates or district boundaries.
export const DISTRICTS = [
  { name: "Kasaragod", x: -90, z: -850, label: "Northern coast" },
  { name: "Kannur", x: -60, z: -710, label: "Palm coast" },
  { name: "Wayanad", x: 95, z: -620, label: "Highland escape" },
  { name: "Kozhikode", x: -35, z: -540, label: "Malabar coast" },
  { name: "Malappuram", x: 20, z: -390, label: "Green country" },
  { name: "Palakkad", x: 160, z: -260, label: "Gateway to the hills" },
  { name: "Thrissur", x: 35, z: -150, label: "Cultural heartland" },
  { name: "Ernakulam", x: 0, z: 0, label: "Kochi coastal drive" },
  { name: "Idukki", x: 200, z: 80, label: "Western Ghats" },
  { name: "Kottayam", x: 95, z: 200, label: "Lakeside country" },
  { name: "Alappuzha", x: 5, z: 320, label: "Backwater trails" },
  { name: "Pathanamthitta", x: 155, z: 430, label: "Forest country" },
  { name: "Kollam", x: 50, z: 590, label: "Southern backwaters" },
  { name: "Thiruvananthapuram", x: 95, z: 780, label: "The southern capital" },
] as const;

export const WEAPONS = [
  { name: "Sidearm", capacity: 12, cooldown: 0.3 },
  { name: "Carbine", capacity: 30, cooldown: 0.12 },
  { name: "Scattergun", capacity: 6, cooldown: 0.7 },
] as const;

export type TransportMode = "car" | "foot" | "boat" | "helicopter" | "drone";
export const TRANSPORTS = [
  { id: "car", name: "Road collection", type: "LAND", description: "Five detailed cars for coastal roads and country lanes.", speed: 210 },
  { id: "boat", name: "Malabar Runner", type: "SEA", description: "A motorboat with a working propeller and a rolling wake.", speed: 85 },
  { id: "helicopter", name: "Coastline Heli", type: "AIR", description: "Lift off, explore from above, and land at your own pace.", speed: 160 },
  { id: "drone", name: "Survey Quad", type: "DRONE", description: "A nimble quadcopter for aerial exploration and surveys.", speed: 65 },
] as const;

// Each home is reserved before procedural scenery is placed.
export const HOMES = DISTRICTS.map((district, index) => ({
  district: index, name: `${district.name} guesthouse`, x: district.x + 32, z: district.z + 30,
}));

export const MISSIONS = [
  { name: "A place to call home", type: "EXPLORATION", description: "Step inside the Kochi guesthouse and explore your new base.", objective: "Walk to the marked door and enter the guesthouse.", mode: "foot", x: 32, z: 38, altitude: 0, reward: 100 },
  { name: "The coastal delivery", type: "DRIVING", description: "Take a local delivery north along the Kochi road.", objective: "Drive to the gold marker and stop inside it.", mode: "car", x: 0, z: -100, altitude: 0, reward: 200 },
  { name: "A Malabar boat run", type: "BOATING", description: "Carry harbour supplies to the offshore meeting point.", objective: "Pilot the boat north to the gold marker and slow down.", mode: "boat", x: -190, z: -140, altitude: 0, reward: 250 },
  { name: "A different perspective", type: "DRONE SURVEY", description: "Survey the coast from your quadcopter.", objective: "Reach the marker above 25 m and hover for 3 seconds.", mode: "drone", x: 0, z: -90, altitude: 25, reward: 300 },
  { name: "A soft landing", type: "HELICOPTER", description: "Make a short helicopter transfer to the northern landing zone.", objective: "Fly to the marked pad, descend below 4 m, and stop.", mode: "helicopter", x: 0, z: -120, altitude: 0, reward: 400 },
] as const;

export type GameStats = {
  speed: number;
  district: number;
  driving: boolean;
  ammo: number;
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
};
export const INITIAL_STATS: GameStats = { speed: 0, district: 7, driving: true, ammo: 12, hits: 0, x: 0, z: 0, mode: "car", altitude: 0, nearbyHome: null, insideHome: null, missionIndex: -1, missionsCompleted: 0, missionProgress: 0, missionDistance: 0, credits: 0 };
export type GameCommand =
  | { type: "vehicle"; index: number }
  | { type: "travel"; index: number }
  | { type: "weapon"; index: number }
  | { type: "reset" }
  | { type: "toggle-drive" }
  | { type: "reload" }
  | { type: "fire" }
  | { type: "camera" }
  | { type: "transport"; mode: Exclude<TransportMode, "foot"> }
  | { type: "home-travel"; index: number }
  | { type: "interact" }
  | { type: "mission-start"; index: number }
  | { type: "mission-abandon" }
  | { type: "pause"; value: boolean }
  | { type: "input"; key: string; pressed: boolean };
export type GameController = { command: (command: GameCommand) => void; dispose: () => void };
