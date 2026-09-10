import type { CombatEvent, RoomSnapshot } from "./multiplayer-types";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createGameAudio } from "./audio";
import { DISTRICTS, FUEL_PRICE, FUEL_STATIONS, HOMES, MISSIONS, VEHICLES, WEAPONS, type GameCommand, type GameController, type GameStats, type TransportMode } from "./config";

type Road = { ax: number; az: number; bx: number; bz: number; width: number };
type Collider = { minX: number; maxX: number; minZ: number; maxZ: number; height: number; minY?: number };
type Target = { mesh: THREE.Mesh; ring: THREE.Mesh; position: THREE.Vector3; cooldown: number };

export function createGame(
  container: HTMLElement,
  onStats: (stats: GameStats) => void,
  onReady: () => void,
  onCombat?: (event: CombatEvent) => void,
): GameController {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#c6e0e6");
  scene.fog = new THREE.Fog("#c6e0e6", 150, 720);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1700);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = "display:block;width:100%;height:100%;position:absolute;inset:0;touch-action:none;outline:none;";
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Solmere free roam. WASD to move and steer, Space brake, Shift run or boost, E enter/exit nearby stopped car or guesthouse, F fire on foot, R reload, 1 through 6 select gun. Drag to aim on foot.");
  container.appendChild(canvas);
  const audio = createGameAudio();

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const instances: THREE.InstancedMesh[] = [];
  const geometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.add(value); return value; };
  const material = <T extends THREE.Material>(value: T): T => { materials.add(value); return value; };
  const paint = (color: THREE.ColorRepresentation, roughness = 0.85, metalness = 0) =>
    material(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const environmentScene = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(environmentScene, 0.04, 0.1, 100, { size: 128 });
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.48;
  environmentScene.traverse((object) => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
  environmentScene.dispose();
  pmrem.dispose();

  // Texture noise has its own seed: decoration must never advance the world-layout RNG.
  const surfaceMaps = new Map<string, { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture }>();
  function textured(color: string, kind: "road" | "earth" | "plaster" | "tile", worldUV = false) {
    let maps = surfaceMaps.get(kind);
    if (!maps) {
      const image = document.createElement("canvas");
      image.width = image.height = 256;
      const context = image.getContext("2d")!;
      const pixels = context.createImageData(256, 256);
      let textureSeed = 1709 + kind.length * 97;
      for (let i = 0; i < pixels.data.length; i += 4) {
        textureSeed = (Math.imul(textureSeed, 1664525) + 1013904223) >>> 0;
        const noise = textureSeed / 4294967296;
        const x = (i / 4) % 256, y = Math.floor(i / 1024);
        const mottling = Math.sin(x * 0.049 + Math.sin(y * 0.031) * 2) * Math.cos(y * 0.073);
        const grain = kind === "road" ? (noise > 0.94 ? 65 : noise * 36) : noise * 38;
        const shade = (kind === "road" ? 142 : 184) + grain + mottling * (kind === "earth" ? 4 : 6);
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = shade;
        pixels.data[i + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      if (kind === "tile") {
        for (let y = 0; y < 256; y += 32) {
          context.fillStyle = "#787878";
          context.fillRect(0, y, 256, 3);
          for (let x = 0; x < 256; x += 16) {
            context.fillStyle = "#aaaaaa";
            context.fillRect(x, y + 3, 3, 29);
            context.fillStyle = "#f3f3f3";
            context.fillRect(x + 5, y + 3, 2, 29);
          }
        }
      }
      const map = new THREE.CanvasTexture(image);
      const bumpMap = new THREE.CanvasTexture(image);
      map.colorSpace = THREE.SRGBColorSpace;
      for (const texture of [map, bumpMap]) {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        if (!worldUV) texture.repeat.set(2, 2);
        textures.add(texture);
      }
      maps = { map, bumpMap };
      surfaceMaps.set(kind, maps);
    }
    const surface = material(new THREE.MeshStandardMaterial({
      color, ...maps, roughness: kind === "tile" ? 0.82 : 0.96,
      bumpScale: kind === "earth" ? 0.065 : kind === "tile" ? 0.045 : 0.025,
    }));
    if (worldUV) {
      surface.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader.replace("#include <worldpos_vertex>", `
          #include <worldpos_vertex>
          vec2 surfaceUv = (modelMatrix * vec4(transformed, 1.0)).xz * 0.4;
          vMapUv = surfaceUv;
          vBumpMapUv = surfaceUv;
        `);
      };
      surface.customProgramCacheKey = () => "world-ground-uv";
    }
    return surface;
  }
  const box = geometry(new THREE.BoxGeometry(1, 1, 1));
  const roundedBox = geometry(new RoundedBoxGeometry(1, 1, 1, 2, 0.12));
  const plane = geometry(new THREE.PlaneGeometry(1, 1));
  const cylinder = geometry(new THREE.CylinderGeometry(1, 1, 1, 10));
  const sphere = geometry(new THREE.SphereGeometry(1, 20, 12));
  const circle = geometry(new THREE.CircleGeometry(1, 24));
  const asphalt = textured("#434748", "road", true);
  const sand = textured("#d6c392", "earth", true);
  const grass = textured("#708751", "earth", true);
  const white = paint("#f6eddb");
  const dark = paint("#253b40");
  const wood = paint("#897151");
  const chrome = paint("#c1cbd0", 0.22, 0.9);
  const glass = material(new THREE.MeshPhysicalMaterial({ color: "#243940", roughness: 0.12, metalness: 0.3, clearcoat: 1, side: THREE.DoubleSide }));
  const tire = paint("#16191a", 0.94);
  const terracotta = textured("#a65b3d", "tile");
  const green = paint("#438c68");
  const gold = paint("#f7c56b", 0.5, 0.15);
  const red = material(new THREE.MeshStandardMaterial({ color: "#ed6451", emissive: "#96281b", emissiveIntensity: 0.5 }));
  const headlight = material(new THREE.MeshStandardMaterial({ color: "#fff6cc", emissive: "#fff0ab", emissiveIntensity: 0.8 }));
  const shadowMat = material(new THREE.MeshBasicMaterial({ color: "#345a50", transparent: true, opacity: 0.16, depthWrite: false }));

  function mesh(
    shape: THREE.BufferGeometry, surface: THREE.Material, x: number, y: number, z: number,
    sx = 1, sy = 1, sz = 1, parent: THREE.Object3D = scene,
  ) {
    const object = new THREE.Mesh(shape, surface);
    object.position.set(x, y, z);
    object.scale.set(sx, sy, sz);
    parent.add(object);
    return object;
  }

  function link(parent: THREE.Object3D, surface: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, radius: number) {
    const object = mesh(cylinder, surface, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, radius, a.distanceTo(b), radius, parent);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return object;
  }

  const dummy = new THREE.Object3D();
  function batch(shape: THREE.BufferGeometry, surface: THREE.Material, transforms: THREE.Matrix4[], parent: THREE.Object3D = scene) {
    const object = new THREE.InstancedMesh(shape, surface, transforms.length);
    transforms.forEach((matrix, index) => object.setMatrixAt(index, matrix));
    object.instanceMatrix.needsUpdate = true;
    object.computeBoundingSphere();
    instances.push(object);
    parent.add(object);
    return object;
  }
  function matrix(x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) {
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(rx, ry, rz);
    dummy.updateMatrix();
    return dummy.matrix.clone();
  }
  let seed = 41723;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  scene.add(new THREE.HemisphereLight("#dceafa", "#78725b", 1.15));
  const sun = new THREE.DirectionalLight("#fff0d6", 2.3);
  sun.position.set(-100, 170, -90);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -65;
  sun.shadow.camera.right = 65;
  sun.shadow.camera.top = 65;
  sun.shadow.camera.bottom = -65;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 400;
  sun.shadow.normalBias = 0.04;
  sun.shadow.bias = -0.0002;
  scene.add(sun, sun.target);
  mesh(sphere, material(new THREE.MeshBasicMaterial({ color: "#fff2cc", fog: false })), -540, 420, -700, 30, 30, 30);

  const ground = mesh(plane, grass, 130, 0, 280, 540, 2800);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  const beach = mesh(plane, sand, -129, 0.012, 280, 22, 2800);
  beach.rotation.x = -Math.PI / 2;
  const oceanTime = { value: 0 };
  const oceanMat = paint("#267b83", 0.22, 0.22);
  oceanMat.onBeforeCompile = (shader) => {
    shader.uniforms.uOceanTime = oceanTime;
    shader.vertexShader = "uniform float uOceanTime; varying vec3 vWaterPosition;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      transformed.y += sin(position.x * 0.045 + uOceanTime * 0.65) * 0.18
        + sin(position.z * 0.09 + uOceanTime * 0.8) * 0.10;
      vWaterPosition = transformed;
    `);
    shader.fragmentShader = "uniform float uOceanTime; varying vec3 vWaterPosition;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `
      #include <normal_fragment_maps>
      vec3 waterNormal = normalize(vec3(
        -cos(vWaterPosition.x * 0.045 + uOceanTime * 0.65) * 0.08,
        1.0, -cos(vWaterPosition.z * 0.09 + uOceanTime * 0.8) * 0.12));
      normal = normalize(mat3(viewMatrix) * waterNormal);
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `
      #include <color_fragment>
      float wave = sin(vWaterPosition.z * 0.34 + sin(vWaterPosition.x * 0.07) * 2.0 + uOceanTime);
      float glint = pow(max(wave, 0.0), 20.0) * 0.22;
      diffuseColor.rgb += vec3(glint * 0.65, glint, glint);
    `);
  };
  const oceanGeometry = geometry(new THREE.PlaneGeometry(2000, 3400, 70, 110));
  oceanGeometry.rotateX(-Math.PI / 2);
  mesh(oceanGeometry, oceanMat, -1140, -0.48, -25);
  const foamMatrices: THREE.Matrix4[] = [];
  for (let z = -980; z < 1560; z += 17) {
    foamMatrices.push(matrix(-141.5 - random() * 2, -0.08, z, 0.65, 1, 9 + random() * 6));
  }
  const foam = batch(box, material(new THREE.MeshBasicMaterial({ color: "#d2f2df", transparent: true, opacity: 0.48 })), foamMatrices);

  const roads: Road[] = [];
  const dashes: THREE.Matrix4[] = [];
  function road(ax: number, az: number, bx: number, bz: number, width = 14) {
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 0.1) return;
    roads.push({ ax, az, bx, bz, width });
    const angle = Math.atan2(bx - ax, bz - az);
    const surface = mesh(plane, asphalt, (ax + bx) / 2, 0.02, (az + bz) / 2, width, length);
    surface.rotation.set(-Math.PI / 2, 0, -angle);
    surface.receiveShadow = true;
  }
  road(0, -960, 0, 1570, 15);
  road(-101, -920, -101, 1570, 11);
  road(246, -890, 246, 1570, 12);
  for (const district of DISTRICTS) {
    road(-101, district.z, 246, district.z, 12);
    if (district.x !== 0) road(district.x, district.z - 54, district.x, district.z + 54, 14);
  }
  road(-101, -920, 246, -920, 12);
  road(-101, 1030, 246, 1570, 12);

  function roadDistance(x: number, z: number, r: Road) {
    const dx = r.bx - r.ax;
    const dz = r.bz - r.az;
    const t = THREE.MathUtils.clamp(((x - r.ax) * dx + (z - r.az) * dz) / (dx * dx + dz * dz), 0, 1);
    return Math.hypot(x - r.ax - dx * t, z - r.az - dz * t);
  }
  function nearRoad(x: number, z: number, margin: number) {
    return roads.some((r) => roadDistance(x, z, r) < r.width / 2 + margin);
  }
  for (const r of roads) {
    const length = Math.hypot(r.bx - r.ax, r.bz - r.az);
    const dx = (r.bx - r.ax) / length;
    const dz = (r.bz - r.az) / length;
    const angle = Math.atan2(dx, dz);
    for (let t = 6; t < length - 3; t += 11) {
      const x = r.ax + dx * t;
      const z = r.az + dz * t;
      if (roads.some((other) => other !== r && roadDistance(x, z, other) < other.width / 2 + 2)) continue;
      dashes.push(matrix(x, 0.034, z, 0.16, 0.009, 4.5, 0, angle));
      for (const side of [-1, 1]) {
        dashes.push(matrix(x + dz * side * (r.width / 2 - 0.7), 0.033, z - dx * side * (r.width / 2 - 0.7), 0.12, 0.009, 10.7, 0, angle));
      }
    }
  }
  batch(box, white, dashes);

  // Reserve every home, including its veranda and approach, before placing scenery.
  const homeColliders: Collider[] = HOMES.map((home) => ({ minX: home.x - 6, maxX: home.x + 6, minZ: home.z - 7, maxZ: home.z + 7, height: 7.6 }));
  const colliders: Collider[] = [...homeColliders];
  const nearHome = (x: number, z: number, margin = 0) => HOMES.some((home) => Math.abs(x - home.x) < 9 + margin && Math.abs(z - home.z) < 12 + margin);
  const nearStation = (x: number, z: number, margin = 0) => FUEL_STATIONS.some((station) => Math.abs(x - station.x) < 12 + margin && Math.abs(z - station.z) < 13 + margin);
  // The imported Wastelands Edge diorama brings its own ruins and scatter; keep procedural scenery out of its footprint.
  const WASTELANDS = DISTRICTS[14];
  const nearWastelands = (x: number, z: number, margin = 0) => Math.hypot(x - WASTELANDS.x, z - WASTELANDS.z) < 46 + margin;
  // Reserve the entire forecourt, including its road approach, before random scenery.
  for (const station of FUEL_STATIONS) {
    const { x, z } = station;
    mesh(box, asphalt, x - 4, 0.025, z, 25, 0.04, 23).receiveShadow = true;
    mesh(roundedBox, white, x + 5, 0.14, z, 2.6, 0.25, 5.4);
    for (const dz of [-4.8, 4.8]) {
      mesh(cylinder, chrome, x + 7, 2.65, z + dz, 0.14, 5.3, 0.14);
      colliders.push({ minX: x + 6.8, maxX: x + 7.2, minZ: z + dz - 0.2, maxZ: z + dz + 0.2, height: 5.3 });
    }
    mesh(roundedBox, green, x + 2, 5.4, z, 13, 0.42, 13).castShadow = true;
    mesh(box, white, x + 2, 5.14, z, 12.5, 0.08, 12.5);
    for (const dz of [-1.5, 1.5]) {
      mesh(roundedBox, green, x + 5, 0.75, z + dz, 1.3, 1.3, 0.85);
      mesh(roundedBox, white, x + 5, 1.7, z + dz, 1.4, 0.8, 0.9);
      mesh(roundedBox, glass, x + 4.28, 1.83, z + dz, 0.025, 0.26, 0.58);
      for (let i = 0; i < 3; i++) mesh(sphere, gold, x + 4.26, 1.55, z + dz - 0.18 + i * 0.18, 0.025, 0.035, 0.035);
      const hosePoints = [new THREE.Vector3(x + 5, 1.9, z + dz + 0.5), new THREE.Vector3(x + 4.1, 0.4, z + dz + 0.7), new THREE.Vector3(x + 3.95, 0.5, z + dz), new THREE.Vector3(x + 4.2, 1.35, z + dz)];
      mesh(geometry(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hosePoints), 20, 0.035, 6, false)), tire, 0, 0, 0);
      mesh(roundedBox, dark, x + 4.2, 1.4, z + dz, 0.12, 0.3, 0.15).rotation.z = -0.3;
    }
    colliders.push({ minX: x + 3.8, maxX: x + 6.3, minZ: z - 2.7, maxZ: z + 2.7, height: 2.15 });
    colliders.push({ minX: x - 4.5, maxX: x + 8.5, minZ: z - 6.5, maxZ: z + 6.5, height: 5.61, minY: 5.14 });
    for (const side of [-1, 1]) mesh(box, white, x + side * 1.7, 0.055, z + 3, 0.1, 0.015, 8);
    sign(station.name, `PETROL / ${FUEL_PRICE} CREDITS PER LITRE / TOW PAD`, x + 3, z - 9);
  }
  const buildingMatrices: THREE.Matrix4[][] = [[], [], [], [], []];
  const roofMatrices: THREE.Matrix4[] = [];
  const windowMatrices: THREE.Matrix4[] = [];
  const trimMatrices: THREE.Matrix4[] = [];
  const frameMatrices: THREE.Matrix4[] = [];
  const doorMatrices: THREE.Matrix4[] = [];
  const roofDetails: THREE.Matrix4[] = [];
  const buildingColors = ["#eee5cd", "#bcd2c6", "#e6b99f", "#f3d28b", "#a9c4cb"];
  for (const district of DISTRICTS) {
    if (district.name === "Wastelands Edge") continue;
    for (let i = 0; i < 22; i++) {
      const x = district.x + (random() - 0.5) * 180;
      const z = district.z + (random() - 0.5) * 108;
      const w = 6 + random() * 9;
      const depth = 6 + random() * 8;
      const height = 4 + Math.floor(random() * 3) * 3.2;
      if (x < -113 || x > 280 || nearRoad(x, z, Math.max(w, depth) * 0.72 + 4) || nearHome(x, z, Math.max(w, depth) / 2) || nearStation(x, z, Math.max(w, depth) / 2) || nearWastelands(x, z, Math.max(w, depth))) continue;
      if (Math.hypot(x - district.x - 13, z - district.z + 43) < 23) continue;
      if (colliders.some((c) => x > c.minX - w && x < c.maxX + w && z > c.minZ - depth && z < c.maxZ + depth)) continue;
      colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - depth / 2, maxZ: z + depth / 2, height: height + 2.7 });
      buildingMatrices[i % 5].push(matrix(x, height / 2, z, w, height, depth));
      trimMatrices.push(matrix(x, height + 0.12, z, w + 0.4, 0.25, depth + 0.4));
      if (i % 3 !== 0) {
        roofMatrices.push(matrix(x, height + 1.4, z, w * 0.8, 2.6, depth * 0.8, 0, Math.PI / 4));
        roofDetails.push(matrix(x, height + 2.76, z, 0.4, 0.2, 0.4));
      } else {
        for (const side of [-1, 1]) {
          trimMatrices.push(matrix(x + side * w / 2, height + 0.48, z, 0.22, 0.75, depth));
          trimMatrices.push(matrix(x, height + 0.48, z + side * depth / 2, w, 0.75, 0.22));
        }
        roofDetails.push(matrix(x + w * 0.2, height + 0.7, z, 1.6, 1.2, 1.6));
      }
      const doorX = x - w / 2 + 1.8;
      doorMatrices.push(matrix(doorX, 1.22, z - depth / 2 - 0.035, 1.35, 2.44, 0.08));
      trimMatrices.push(matrix(doorX, 0.13, z - depth / 2 - 0.5, 2, 0.26, 1));
      trimMatrices.push(matrix(doorX, 2.7, z - depth / 2 - 0.45, 2.1, 0.16, 1.2));
      frameMatrices.push(matrix(doorX + 0.42, 1.2, z - depth / 2 - 0.09, 0.06, 0.23, 0.05));
      for (let floor = 0; floor < height - 1; floor += 3.2) {
        for (let wx = -w / 2 + 1.8; wx < w / 2 - 0.8; wx += 2.8) {
          for (const side of [-1, 1]) {
            if (floor === 0 && side === -1 && Math.abs(x + wx - doorX) < 0.1) continue;
            const wz = z + side * (depth / 2 + 0.06);
            windowMatrices.push(matrix(x + wx, floor + 2, wz, 1.2, 1.5, 0.04));
            for (const edge of [-1, 1]) {
              frameMatrices.push(matrix(x + wx + edge * 0.65, floor + 2, wz, 0.1, 1.7, 0.14));
              frameMatrices.push(matrix(x + wx, floor + 2 + edge * 0.8, wz, 1.4, 0.1, 0.14));
            }
            frameMatrices.push(matrix(x + wx, floor + 2, wz + side * 0.04, 0.05, 1.5, 0.05));
            trimMatrices.push(matrix(x + wx, floor + 1.17, wz, 1.6, 0.12, 0.4));
          }
        }
        for (const side of [-1, 1]) {
          const wallX = x + side * (w / 2 + 0.06);
          windowMatrices.push(matrix(wallX, floor + 2, z, 0.04, 1.5, 2));
          for (const edge of [-1, 1]) {
            frameMatrices.push(matrix(wallX, floor + 2, z + edge * 1.05, 0.14, 1.7, 0.1));
            frameMatrices.push(matrix(wallX, floor + 2 + edge * 0.8, z, 0.14, 0.1, 2.2));
          }
          frameMatrices.push(matrix(wallX + side * 0.04, floor + 2, z, 0.05, 1.5, 0.06));
        }
      }
    }
  }
  buildingMatrices.forEach((transforms, i) => { const object = batch(box, textured(buildingColors[i], "plaster"), transforms); object.castShadow = true; object.receiveShadow = true; });
  batch(geometry(new THREE.ConeGeometry(1, 1, 4)), terracotta, roofMatrices).castShadow = true;
  batch(box, glass, windowMatrices);
  batch(box, white, trimMatrices);
  batch(box, wood, frameMatrices);
  batch(box, wood, doorMatrices);
  batch(roundedBox, terracotta, roofDetails).castShadow = true;

  const homePlaster = textured("#f0debd", "plaster");
  HOMES.forEach((home) => {
    const house = new THREE.Group();
    house.position.set(home.x, 0, home.z);
    scene.add(house);
    mesh(roundedBox, sand, 0, 0.12, 0.5, 12.6, 0.24, 15.6, house);
    mesh(box, homePlaster, 0, 2.2, 0, 12, 4.2, 14, house);
    mesh(box, wood, 0, 0.45, 0, 12.1, 0.32, 14.1, house);
    // Pitched tiled roof, ridge caps and a shaded timber veranda, all within the plot.
    for (const side of [-1, 1]) {
      mesh(box, terracotta, side * 3.25, 5.7, 0, 7.5, 0.23, 15.4, house).rotation.z = -side * 0.43;
      mesh(box, wood, side * 3.3, 5.55, 7.55, 7.6, 0.16, 0.18, house).rotation.z = -side * 0.43;
      for (const z of [-4.2, 1.5]) {
        mesh(roundedBox, wood, side * 6.04, 2.5, z, 0.13, 2.1, 2.5, house);
        mesh(box, glass, side * 6.12, 2.5, z, 0.03, 1.7, 2.1, house);
        for (let bar = -2; bar <= 2; bar++) mesh(box, wood, side * 6.15, 2.5, z + bar * 0.37, 0.055, 1.75, 0.045, house);
      }
      mesh(roundedBox, wood, side * 3.4, 2.5, 7.05, 2, 1.9, 0.14, house);
      mesh(box, glass, side * 3.4, 2.5, 7.13, 1.65, 1.55, 0.03, house);
      for (let bar = -2; bar <= 2; bar++) mesh(box, wood, side * 3.4 + bar * 0.3, 2.5, 7.16, 0.045, 1.6, 0.04, house);
      mesh(cylinder, wood, side * 5.35, 1.9, 8.05, 0.13, 3.6, 0.13, house);
      mesh(roundedBox, sand, side * 5.35, 0.42, 8.05, 0.55, 0.6, 0.55, house);
      mesh(sphere, headlight, side * 1.65, 2.75, 7.2, 0.13, 0.22, 0.13, house);
      mesh(cylinder, terracotta, side * 3, 0.5, 8.6, 0.35, 0.65, 0.35, house);
      mesh(sphere, green, side * 3, 1.05, 8.6, 0.6, 0.65, 0.6, house);
    }
    for (let z = -7.4; z < 7.5; z += 0.6) mesh(roundedBox, terracotta, 0, 7.27, z, 0.45, 0.24, 0.64, house);
    mesh(box, terracotta, 0, 3.9, 7.65, 12.8, 0.18, 2.1, house).rotation.x = 0.13;
    mesh(box, wood, 0, 3.55, 8.5, 11, 0.22, 0.2, house);
    mesh(roundedBox, wood, 0, 1.55, 7.9, 1.9, 2.9, 0.2, house);
    for (const x of [-0.45, 0.45]) for (const y of [0.85, 2.1]) mesh(roundedBox, dark, x, y, 8.01, 0.68, 0.85, 0.025, house);
    mesh(sphere, gold, 0.6, 1.5, 8.04, 0.065, 0.065, 0.065, house);
    house.traverse((child) => { if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; } });
  });

  // One reusable roof-cutaway room stays at the entered home's real map coordinates.
  const interior = new THREE.Group();
  interior.visible = false;
  scene.add(interior);
  const indoorColliders: Collider[] = [];
  function furnishing(surface: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, solid = true) {
    const object = mesh(roundedBox, surface, x, y, z, w, h, d, interior);
    object.castShadow = object.receiveShadow = true;
    if (solid) indoorColliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, height: y + h / 2 });
    return object;
  }
  furnishing(sand, 0, 0.04, 0, 12, 0.08, 14, false);
  furnishing(homePlaster, 0, 1.6, -7, 12, 3.2, 0.25);
  for (const side of [-1, 1]) {
    furnishing(homePlaster, side * 6, 0.65, 0, 0.25, 1.3, 14);
    furnishing(wood, side * 6, 1.32, 0, 0.3, 0.1, 14, false);
    furnishing(homePlaster, side * 3.7, 0.65, 7, 4.6, 1.3, 0.25);
    furnishing(wood, side * 1.32, 1.45, 7, 0.14, 2.9, 0.2, false);
  }
  const fabric = paint("#50766c");
  const linen = paint("#e2d4b6");
  furnishing(fabric, -4.45, 0.58, 2, 1.65, 0.85, 3.7);
  furnishing(fabric, -5.1, 1.05, 2, 0.35, 1.05, 3.7, false);
  for (const z of [0.4, 3.6]) furnishing(wood, -4.45, 0.85, z, 1.75, 0.16, 0.2, false);
  furnishing(wood, -1.8, 0.55, 2, 1.65, 0.16, 2.3);
  for (const x of [-2.4, -1.2]) for (const z of [1.2, 2.8]) furnishing(wood, x, 0.28, z, 0.12, 0.56, 0.12, false);
  furnishing(gold, -1.8, 0.69, 2, 0.45, 0.08, 0.6, false);
  furnishing(linen, 3.85, 0.52, -4.65, 2.8, 0.7, 3.5);
  furnishing(wood, 3.85, 0.9, -6.4, 3, 1.4, 0.2, false);
  for (const x of [3.2, 4.45]) furnishing(white, x, 0.96, -5.75, 1, 0.22, 0.65, false);
  furnishing(fabric, 3.85, 0.89, -3.8, 2.85, 0.08, 1.6, false);
  furnishing(wood, -3.7, 0.72, -5.9, 3.8, 1.4, 1.4);
  furnishing(white, -3.7, 1.45, -5.9, 4, 0.14, 1.55, false);
  furnishing(chrome, -4.5, 1.54, -5.9, 0.95, 0.04, 0.8, false);
  furnishing(wood, 5, 1.1, -0.5, 1.1, 2.2, 2);
  for (const y of [0.6, 1.2, 1.8]) {
    furnishing(linen, 4.37, y, -0.5, 0.06, 0.06, 1.7, false);
    for (let i = 0; i < 5; i++) furnishing(i % 2 ? fabric : terracotta, 4.48, y + 0.22, -1.1 + i * 0.27, 0.3, 0.38, 0.16, false);
  }
  furnishing(terracotta, 0.1, 0.1, 4.2, 2, 0.04, 1.2, false);
  mesh(plane, fabric, 0, 2, -6.85, 1.6, 1, 1, interior);
  const roomLight = new THREE.PointLight("#ffe5b6", 24, 18, 1.2);
  roomLight.position.set(0, 3.4, 0);
  interior.add(roomLight);

  // One instanced draw per palm component, rather than hundreds of individual trees.
  const trunks: THREE.Matrix4[] = [];
  const fronds: THREE.Matrix4[] = [];
  const coconuts: THREE.Matrix4[] = [];
  const shadows: THREE.Matrix4[] = [];
  // A single feathered frond mesh is instanced; gaps between leaflets remain real geometry.
  const leafVertices: number[] = [];
  const frondY = (t: number) => Math.sin(t * Math.PI) * 1.05 - t * t * 1.6;
  for (let i = 0; i < 24; i++) {
    const t = i / 24;
    const next = (i + 1) / 24;
    const y = frondY(t);
    const ny = frondY(next);
    leafVertices.push(-0.025, y, -t * 6, 0.025, y, -t * 6, 0.02, ny, -next * 6,
      -0.025, y, -t * 6, 0.02, ny, -next * 6, -0.02, ny, -next * 6);
    if (i < 2) continue;
    const reach = Math.sin(t * Math.PI) * 0.88 + 0.08;
    for (const side of [-1, 1]) {
      const tipZ = -t * 6 - 0.5 * (1 - t);
      leafVertices.push(0, y, -t * 6, side * reach * 0.5, y - 0.05, -t * 6 - 0.05,
        side * reach, y - 0.28, tipZ,
        0, y, -t * 6, side * reach, y - 0.28, tipZ,
        side * reach * 0.4, y - 0.08, -t * 6 - 0.17);
    }
  }
  const leafGeometry = geometry(new THREE.BufferGeometry());
  leafGeometry.setAttribute("position", new THREE.Float32BufferAttribute(leafVertices, 3));
  leafGeometry.computeVertexNormals();
  const leaves = paint("#387147");
  leaves.side = THREE.DoubleSide;
  const palmTrunk = geometry(new THREE.CylinderGeometry(0.16, 0.29, 1, 9, 24));
  const trunkPositions = palmTrunk.getAttribute("position");
  for (let i = 0; i < trunkPositions.count; i++) {
    const y = trunkPositions.getY(i);
    const ring = 1 + Math.cos((y + 0.5) * Math.PI * 24) * 0.055;
    trunkPositions.setX(i, trunkPositions.getX(i) * ring + (y * y - 0.25) * 0.45);
    trunkPositions.setZ(i, trunkPositions.getZ(i) * ring);
  }
  palmTrunk.computeVertexNormals();
  for (let i = 0; i < 1000; i++) {
    const x = i < 140 ? -116 + random() * 6 : -110 + random() * 460;
    const z = -955 + random() * 1850;
    if (nearRoad(x, z, 3) || nearHome(x, z, 5) || nearStation(x, z, 5) || nearWastelands(x, z, 6) || colliders.some((c) => x > c.minX - 5 && x < c.maxX + 5 && z > c.minZ - 5 && z < c.maxZ + 5)) continue;
    if (DISTRICTS.some((d) => Math.hypot(x - d.x, z - (d.z - 40)) < 15)) continue;
    const height = 7 + random() * 5;
    const angle = random() * Math.PI * 2;
    const lean = (random() - 0.5) * 0.14;
    trunks.push(matrix(x, height / 2, z, 1, height, 1, 0, angle, lean));
    const topX = x - Math.sin(lean) * height / 2;
    for (let j = 0; j < 7; j++) fronds.push(matrix(topX, height - 0.1, z, 0.8, 0.9, 0.8 + random() * 0.3, 0, angle + j * Math.PI * 2 / 7));
    coconuts.push(matrix(topX, height - 0.3, z, 0.55, 0.4, 0.55));
    shadows.push(matrix(x + 1, 0.016, z + 1, 3.5, 2.4, 1, -Math.PI / 2));
  }
  for (let i = 0; i < 180; i++) {
    const x = -115 + (i * 73.13) % 455, z = 1020 + (i * 37.7) % 520;
    if (nearRoad(x, z, 4) || nearHome(x, z, 6) || nearStation(x, z, 6) || colliders.some(c => x > c.minX - 4 && x < c.maxX + 4 && z > c.minZ - 4 && z < c.maxZ + 4)) continue;
    const height = 8 + i % 4;
    trunks.push(matrix(x, height / 2, z, 1, height, 1));
    for (let j = 0; j < 7; j++) fronds.push(matrix(x, height, z, .9, .9, .9, 0, j * Math.PI * 2 / 7));
  }
  batch(palmTrunk, wood, trunks).castShadow = true;
  const palmLeaves = batch(leafGeometry, leaves, fronds);
  palmLeaves.castShadow = true;
  batch(sphere, green, coconuts);
  batch(circle, shadowMat, shadows);

  for (const transform of trunks) {
    const trunk = new THREE.Vector3().setFromMatrixPosition(transform);
    colliders.push({ minX: trunk.x - .23, maxX: trunk.x + .23, minZ: trunk.z - .23, maxZ: trunk.z + .23, height: trunk.y * 2 });
  }
  const mountains: THREE.Matrix4[][] = [[], [], []];
  for (let i = 0; i < 85; i++) {
    const layer = i % 3;
    const h = 55 + random() * 140;
    mountains[layer].push(matrix(450 + layer * 80 + random() * 85, h / 2 - 6, -1120 + random() * 2260, 65 + random() * 70, h, 80 + random() * 100, 0, random() * 6));
  }
  const hill = geometry(new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2));
  hill.translate(0, -0.5, 0);
  ["#607d65", "#7d9986", "#9ab2a4"].forEach((color, i) => batch(hill, paint(color), mountains[i]));
  const shrubs: THREE.Matrix4[] = [];
  for (let i = 0; i < 450; i++) {
    const x = -110 + random() * 460;
    const z = -970 + random() * 1890;
    if (nearRoad(x, z, 10) || nearHome(x, z, 4) || nearStation(x, z, 4) || nearWastelands(x, z, 5)) continue;
    shrubs.push(matrix(x, 0.8, z, 1.5 + random() * 2, 1 + random(), 1.5 + random() * 2));
  }
  batch(geometry(new THREE.IcosahedronGeometry(1, 2)), paint("#5e824d"), shrubs);
  const clouds: THREE.Matrix4[] = [];
  for (let i = 0; i < 65; i++) {
    const x = -550 + random() * 1150;
    const z = -1200 + random() * 2400;
    const y = 155 + random() * 70;
    for (let j = 0; j < 3; j++) clouds.push(matrix(x + j * 18, y + random() * 5, z, 24, 7 + random() * 5, 13));
  }
  batch(sphere, material(new THREE.MeshBasicMaterial({ color: "#eef4ed" })), clouds);

  function sign(text: string, subtitle: string, x: number, z: number) {
    const label = document.createElement("canvas");
    label.width = 768;
    label.height = 256;
    const context = label.getContext("2d");
    if (!context) return;
    context.fillStyle = "#164c4c";
    context.fillRect(0, 0, 768, 256);
    context.strokeStyle = "#b9d5be";
    context.lineWidth = 5;
    context.strokeRect(12, 12, 744, 232);
    context.fillStyle = "#e8bb70";
    context.font = "600 23px sans-serif";
    context.fillText("SOLMERE / FREE ROAM", 36, 54);
    context.fillStyle = "#fff6df";
    context.font = `600 ${text.length > 15 ? 44 : 58}px sans-serif`;
    context.fillText(text.toUpperCase(), 34, 135, 698);
    context.fillStyle = "#c0dbd3";
    context.font = "27px sans-serif";
    context.fillText(subtitle.toUpperCase(), 36, 205, 690);
    const texture = new THREE.CanvasTexture(label);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.add(texture);
    const surface = material(new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    mesh(plane, surface, x, 4.2, z, 10.5, 3.5);
    for (const side of [-1, 1]) mesh(cylinder, chrome, x + side * 4.2, 1.6, z, 0.1, 3.2, 0.1);
  }

  const targets: Target[] = [];
  const targetMeshes: THREE.Mesh[] = [];
  const targetShape = geometry(new THREE.CylinderGeometry(1.25, 1.25, 0.22, 24));
  targetShape.rotateX(Math.PI / 2);
  const ringShape = geometry(new THREE.TorusGeometry(0.82, 0.065, 6, 32));
  const targetColor = paint("#ed8e50");
  const ringColor = material(new THREE.MeshBasicMaterial({ color: "#fff0c5" }));
  for (const [index, district] of DISTRICTS.entries()) {
    sign(district.name, district.label, district.x + 19, district.z - 12);
    // The Wastelands Edge diorama supplies its own ruin, wreck and marker; skip the coastal-village kit for it.
    if (district.name === "Wastelands Edge") continue;
    for (let j = 0; j < 3; j++) {
      const x = district.x + 9 + j * 3.7;
      const z = district.z - 40 - j * 3;
      mesh(cylinder, dark, x, 0.8, z, 0.11, 1.6, 0.11);
      mesh(box, sand, x, 0.11, z, 2.8, 0.2, 1.7);
      const object = mesh(targetShape, targetColor, x, 2, z);
      const ring = mesh(ringShape, ringColor, 0, 0, 0.13, 1, 1, 1, object);
      mesh(circle, white, 0, 0, 0.14, 0.26, 0.26, 1, object);
      targets.push({ mesh: object, ring, position: new THREE.Vector3(x, 2, z), cooldown: 0 });
      targetMeshes.push(object);
    }
    // Small roadside shelters and warm lamps give destinations a recognizable center.
    const sx = district.x - 14;
    mesh(box, terracotta, sx, 3.7, district.z + 16, 7, 0.35, 4.5);
    for (const side of [-1, 1]) mesh(cylinder, white, sx + side * 2.8, 1.8, district.z + 16, 0.12, 3.6, 0.12);
    mesh(box, wood, sx, 0.85, district.z + 17, 5, 0.2, 0.8);
    for (const side of [-1, 1]) {
      mesh(cylinder, dark, district.x + side * 9, 3, district.z + 30, 0.1, 6, 0.1);
      mesh(sphere, headlight, district.x + side * 9, 6.1, district.z + 30, 0.36, 0.36, 0.36);
    }
    if (index % 2 === 0) {
      const boat = new THREE.Group();
      boat.position.set(-165 - random() * 30, -0.15, district.z);
      boat.rotation.y = 0.25 + random();
      scene.add(boat);
      const hull = mesh(sphere, wood, 0, 0, 0, 2.6, 0.65, 8, boat);
      hull.castShadow = false;
      mesh(box, sand, 0, 0.45, 0, 3.4, 0.2, 9, boat);
      mesh(box, white, 0, 1.5, 0.5, 2.6, 1.9, 5.5, boat);
      mesh(box, terracotta, 0, 2.55, 0.5, 3.5, 0.25, 6.6, boat);
      for (const side of [-1, 1]) mesh(box, glass, side * 1.31, 1.8, 0.5, 0.03, 0.8, 4.3, boat);
    }
  }

  // A pre-baked diorama (terrain, ruins, a wrecked 4x4 and an operator figure) dropped in as its own district.
  const wastelands = new THREE.Group();
  wastelands.position.set(WASTELANDS.x, 0, WASTELANDS.z);
  scene.add(wastelands);
  new GLTFLoader().load(
    "/models/wastelands-edge.glb",
    (gltf) => {
      const model = gltf.scene;
      model.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        child.castShadow = true;
        child.receiveShadow = true;
        geometries.add(child.geometry);
        for (const childMaterial of Array.isArray(child.material) ? child.material : [child.material]) {
          materials.add(childMaterial);
          for (const slot of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"] as const) {
            const slotTexture = (childMaterial as THREE.MeshStandardMaterial)[slot];
            if (slotTexture) textures.add(slotTexture);
          }
        }
      });
      if (disposed) {
        model.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          child.geometry.dispose();
          for (const childMaterial of Array.isArray(child.material) ? child.material : [child.material]) childMaterial.dispose();
        });
        return;
      }
      wastelands.add(model);
    },
    undefined,
    (loadError) => console.error("Wastelands Edge model failed to load", loadError),
  );

  const car = new THREE.Group();
  car.name = "PlayerCar";
  scene.add(car);
  const wheelGeometry = geometry(new THREE.TorusGeometry(0.325, 0.105, 10, 32));
  wheelGeometry.rotateY(Math.PI / 2); // Axle is local X; the vehicle points down local -Z.
  const rimGeometry = geometry(new THREE.CylinderGeometry(0.245, 0.245, 0.16, 24));
  rimGeometry.rotateZ(Math.PI / 2);
  const rimLip = geometry(new THREE.TorusGeometry(0.255, 0.018, 6, 28));
  rimLip.rotateY(Math.PI / 2);
  const brake = paint("#747b7e", 0.45, 0.8);
  const caliper = paint("#ba4a34", 0.5, 0.35);
  const bodyPaint = VEHICLES.map((vehicle) => material(new THREE.MeshPhysicalMaterial({
    color: vehicle.color, roughness: 0.2, metalness: 0.68, clearcoat: 1, clearcoatRoughness: 0.14,
  })));
  const plateCanvas = document.createElement("canvas");
  plateCanvas.width = 256;
  plateCanvas.height = 64;
  const plateContext = plateCanvas.getContext("2d")!;
  plateContext.fillStyle = "#e1ddc9";
  plateContext.fillRect(0, 0, 256, 64);
  plateContext.fillStyle = "#25383a";
  plateContext.font = "bold 38px monospace";
  plateContext.textAlign = "center";
  plateContext.fillText("KL FR 417", 128, 45);
  const plateTexture = new THREE.CanvasTexture(plateCanvas);
  plateTexture.colorSpace = THREE.SRGBColorSpace;
  textures.add(plateTexture);
  const plateMaterial = material(new THREE.MeshStandardMaterial({ map: plateTexture, roughness: 0.6 }));
  const treadMatrices: THREE.Matrix4[] = [];
  const spokeMatrices: THREE.Matrix4[] = [];
  for (let i = 0; i < 32; i++) {
    const a = i * Math.PI * 2 / 32;
    for (const side of [-1, 1]) treadMatrices.push(matrix(side * 0.057, Math.cos(a) * 0.422, Math.sin(a) * 0.422, 0.092, 0.018, 0.042, a, side * 0.25));
  }
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    spokeMatrices.push(matrix(0, Math.cos(a) * 0.145, Math.sin(a) * 0.145, 0.034, 0.2, 0.045, a));
  }
  let touringWheel: THREE.Object3D | null = null;
  const wheelPivots: THREE.Group[] = [];
  const wheelRolls: THREE.Group[] = [];
  const carBounds = new THREE.Box3();
  const carModels = new Map<number, { model: THREE.Group; pivots: THREE.Group[]; rolls: THREE.Group[]; bounds: THREE.Box3 }>();
  let vehicleIndex = 0;
  function buildCar(index: number) {
    car.clear();
    wheelPivots.length = 0;
    wheelRolls.length = 0;
    const cached = carModels.get(index);
    if (cached) {
      car.add(cached.model);
      wheelPivots.push(...cached.pivots);
      wheelRolls.push(...cached.rolls);
      wheelPivots.forEach((pivot) => { pivot.rotation.y = 0; });
      carBounds.copy(cached.bounds);
      return;
    }
    // Lazily build each of the five models once; switches reuse all geometry and materials.
    const model = new THREE.Group();
    car.add(model);
    const spec = VEHICLES[index];
    const offroad = spec.shape === "offroad";
    const defender = spec.id === "defender";
    const luxury = spec.shape === "luxury";
    const sport = spec.shape === "sport";
    const length = luxury ? 5.4 : defender ? 5.1 : sport ? 4.5 : offroad ? 4.2 : 4.9;
    const width = offroad ? 1.98 : luxury ? 2 : 1.88;
    const wheelScale = offroad ? 1.22 : 1;
    const wheelY = 0.43 * wheelScale + 0.025;
    const axle = length * 0.31;
    const archRadius = 0.52 * wheelScale;
    const belt = offroad ? 1.3 : sport ? 1.08 : 1.16;
    const color = bodyPaint[index];
    const roofY = defender ? 2.2 : offroad ? 2.06 : sport ? 1.49 : luxury ? 1.73 : 1.62;
    const front = offroad ? -1.05 : sport ? -0.85 : -1.02;
    const rear = defender ? 2.02 : offroad ? 1.62 : sport ? 1.34 : 1.63;
    const roofFront = front + (offroad ? 0.22 : 0.51);
    const roofRear = rear - (offroad ? 0.12 : sport ? 0.7 : 0.48);
    const glassWidth = width * 0.45;
    const roofWidth = width * (offroad ? 0.43 : 0.37);

    const profile = new THREE.Shape();
    profile.moveTo(-length / 2, wheelY);
    for (const center of [-axle, axle]) {
      profile.lineTo(center - archRadius, wheelY);
      for (let step = 0; step <= 20; step++) {
        const a = Math.PI - step * Math.PI / 20;
        profile.lineTo(center + Math.cos(a) * archRadius, wheelY + Math.sin(a) * archRadius);
      }
    }
    profile.lineTo(length / 2, wheelY);
    profile.lineTo(length / 2, belt - 0.22);
    profile.quadraticCurveTo(length / 2 - 0.06, belt - 0.1, length / 2 - 0.3, belt - 0.07);
    profile.lineTo(length * 0.2, belt + 0.025);
    profile.lineTo(-length * 0.29, belt + 0.025);
    profile.quadraticCurveTo(-length / 2, belt, -length / 2, belt - 0.17);
    profile.closePath();
    const bodyGeometry = geometry(new THREE.ExtrudeGeometry(profile, { depth: width - 0.1, bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.045, bevelSegments: 3, steps: 1, curveSegments: 8 }));
    bodyGeometry.translate(0, 0, -(width - 0.1) / 2);
    bodyGeometry.rotateY(Math.PI / 2);
    const bodyPositions = bodyGeometry.getAttribute("position");
    for (let i = 0; i < bodyPositions.count; i++) {
      const end = Math.max(0, Math.abs(bodyPositions.getZ(i)) / length - 0.32) / 0.18;
      bodyPositions.setX(i, bodyPositions.getX(i) * (1 - end * end * (offroad ? 0.025 : 0.075)));
    }
    bodyGeometry.computeVertexNormals();
    mesh(bodyGeometry, color, 0, 0, 0, 1, 1, 1, model);
    mesh(roundedBox, dark, 0, wheelY - 0.08, 0, width * 0.78, 0.16, axle * 1.35, model);
    mesh(roundedBox, color, 0, belt + 0.025, (front - length / 2) / 2 + 0.1, width * 0.91, 0.09, front + length / 2 - 0.18, model).rotation.x = -0.035;
    mesh(roundedBox, color, 0, roofY, (roofFront + roofRear) / 2, roofWidth * 2 + 0.08, 0.1, roofRear - roofFront + 0.12, model);

    function panel(points: THREE.Vector3[]) {
      const shape = geometry(new THREE.BufferGeometry());
      shape.setAttribute("position", new THREE.Float32BufferAttribute(points.flatMap((p) => [p.x, p.y, p.z]), 3));
      shape.setIndex([0, 1, 2, 0, 2, 3]);
      shape.computeVertexNormals();
      mesh(shape, glass, 0, 0, 0, 1, 1, 1, model);
    }
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    panel([v(-glassWidth, belt, front), v(glassWidth, belt, front), v(roofWidth, roofY - 0.04, roofFront), v(-roofWidth, roofY - 0.04, roofFront)]);
    panel([v(glassWidth, belt, rear), v(-glassWidth, belt, rear), v(-roofWidth, roofY - 0.04, roofRear), v(roofWidth, roofY - 0.04, roofRear)]);
    const arch = geometry(new THREE.TorusGeometry(archRadius + 0.012, offroad ? 0.065 : 0.026, 6, 24, Math.PI));
    arch.rotateY(Math.PI / 2);
    for (const side of [-1, 1]) {
      const bottomFront = v(side * glassWidth, belt, front);
      const topFront = v(side * roofWidth, roofY - 0.035, roofFront);
      const bottomRear = v(side * glassWidth, belt, rear);
      const topRear = v(side * roofWidth, roofY - 0.035, roofRear);
      panel([bottomFront, bottomRear, topRear, topFront]);
      link(model, color, bottomFront, topFront, offroad ? 0.055 : 0.04);
      link(model, color, bottomRear, topRear, offroad ? 0.075 : 0.055);
      link(model, chrome, bottomFront, bottomRear, 0.019);
      const pillars = defender ? [0.1, 1.15] : [sport ? 0.4 : 0.18];
      for (const z of pillars) link(model, dark, v(side * glassWidth, belt, z), v(side * roofWidth, roofY - 0.035, z), 0.035);
      const seamX = side * (width / 2 - 0.002);
      for (const z of sport ? [0.55] : [0.18, 1.03]) {
        link(model, dark, v(seamX, belt - 0.03, z), v(seamX, wheelY + 0.08, z), 0.009);
        mesh(roundedBox, chrome, seamX + side * 0.018, belt - 0.11, z - 0.19, 0.045, 0.047, 0.23, model);
      }
      link(model, dark, v(seamX, wheelY + 0.08, -axle + archRadius), v(seamX, wheelY + 0.08, axle - archRadius), 0.014);
      link(model, dark, v(side * glassWidth, belt + 0.13, front + 0.18), v(side * (width / 2 + 0.16), belt + 0.16, front + 0.18), 0.035);
      mesh(roundedBox, color, side * (width / 2 + 0.19), belt + 0.17, front + 0.13, 0.24, 0.15, 0.28, model);
      mesh(roundedBox, chrome, side * (width / 2 + 0.19), belt + 0.17, front + 0.277, 0.19, 0.11, 0.015, model);
      for (const z of [-axle, axle]) {
        mesh(arch, offroad ? dark : color, side * width / 2, wheelY, z, 1, 1, 1, model);
      }
      mesh(roundedBox, dark, side * width * 0.33, belt - 0.2, -length / 2 - 0.04, 0.57, 0.23, 0.08, model);
      if (offroad && !defender) {
        mesh(sphere, headlight, side * width * 0.33, belt - 0.2, -length / 2 - 0.092, 0.18, 0.18, 0.045, model);
      } else {
        for (const lamp of [-1, 1]) mesh(roundedBox, headlight, side * width * 0.33 + lamp * 0.12, belt - 0.19, -length / 2 - 0.09, 0.18, luxury ? 0.13 : 0.065, 0.025, model);
      }
      mesh(roundedBox, dark, side * width * 0.33, belt - 0.16, length / 2 + 0.02, 0.55, offroad ? 0.26 : 0.19, 0.085, model);
      mesh(roundedBox, red, side * width * 0.33, belt - 0.13, length / 2 + 0.069, 0.47, offroad ? 0.19 : 0.065, 0.025, model);
      mesh(roundedBox, white, side * width * 0.33, belt - 0.22, length / 2 + 0.07, 0.19, 0.035, 0.025, model);
      const exhaust = mesh(cylinder, chrome, side * width * 0.33, wheelY - 0.02, length / 2, 0.085, 0.3, 0.085, model);
      exhaust.rotation.x = Math.PI / 2;
      mesh(circle, tire, side * width * 0.33, wheelY - 0.02, length / 2 + 0.153, 0.06, 0.06, 1, model);
      link(model, dark, v(side * 0.55, belt + 0.03, front - 0.005), v(side * 0.18, belt + 0.12, front + 0.1), 0.012);
    }
    mesh(roundedBox, dark, 0, belt - 0.22, -length / 2 - 0.06, luxury ? 0.77 : 0.69, luxury ? 0.49 : 0.28, 0.09, model);
    for (let i = -3; i <= 3; i++) mesh(roundedBox, luxury || offroad ? chrome : brake, i * 0.085, belt - 0.22, -length / 2 - 0.112, 0.025, luxury ? 0.42 : 0.2, 0.02, model);
    for (const end of [-1, 1]) {
      mesh(roundedBox, offroad ? dark : color, 0, wheelY + 0.06, end * (length / 2 - 0.03), width + 0.025, 0.2, 0.24, model);
      mesh(roundedBox, dark, 0, wheelY + 0.025, end * (length / 2 + 0.1), width * 0.8, 0.065, 0.04, model);
      const plate = mesh(plane, plateMaterial, 0, wheelY + (end === 1 ? 0.3 : 0.07), end * (length / 2 + 0.135), 0.48, 0.12, 1, model);
      if (end === -1) plate.rotation.y = Math.PI;
    }
    if (sport) {
      mesh(roundedBox, dark, 0, belt + 0.22, length * 0.42, width * 0.97, 0.07, 0.3, model);
      for (const side of [-1, 1]) mesh(roundedBox, dark, side * 0.65, belt + 0.11, length * 0.42, 0.07, 0.22, 0.1, model);
    }
    if (luxury) {
      mesh(sphere, chrome, 0, belt + 0.15, -length * 0.41, 0.035, 0.09, 0.035, model);
      mesh(roundedBox, chrome, 0, belt - 0.22, -length / 2 - 0.08, 0.85, 0.53, 0.025, model);
      // Dark inset sits ahead of the chrome surround, not behind an opaque grille plate.
      mesh(roundedBox, dark, 0, belt - 0.22, -length / 2 - 0.102, 0.73, 0.43, 0.012, model);
    }
    if (offroad) {
      for (const side of [-1, 1]) {
        mesh(roundedBox, dark, side * 0.73, roofY + 0.13, (roofFront + roofRear) / 2, 0.065, 0.08, roofRear - roofFront, model);
        mesh(roundedBox, dark, side * width / 2, wheelY - 0.08, 0, 0.2, 0.12, axle * 1.25, model);
      }
      if (defender) {
        for (const z of [-0.6, 0.4, 1.4]) mesh(roundedBox, dark, 0, roofY + 0.15, z, 1.55, 0.07, 0.065, model);
        mesh(roundedBox, wood, 0, roofY + 0.33, 0.65, 1.25, 0.3, 1.1, model);
        for (const x of [-0.43, 0.43]) mesh(roundedBox, dark, x, roofY + 0.49, 0.65, 0.045, 0.02, 1.1, model);
      }
      mesh(wheelGeometry, tire, 0, 1.24, length / 2 + 0.24, 1.22, 1.22, 1.22, model).rotation.y = Math.PI / 2;
      mesh(rimGeometry, brake, 0, 1.24, length / 2 + 0.25, 1.22, 1.22, 1.22, model).rotation.y = Math.PI / 2;
    }
    for (const z of [-axle, axle]) {
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * (width / 2 - 0.045), wheelY, z);
        model.add(pivot);
        const roll = new THREE.Group();
        roll.scale.setScalar(wheelScale);
        pivot.add(roll);
        mesh(wheelGeometry, tire, 0, 0, 0, 1, 1, 1, roll);
        mesh(rimGeometry, brake, 0, 0, 0, 0.65, 0.87, 0.87, roll);
        mesh(rimLip, chrome, side * 0.094, 0, 0, 1, 1, 1, roll);
        mesh(rimGeometry, chrome, side * 0.096, 0, 0, 0.28, 0.25, 0.25, roll);
        batch(box, tire, treadMatrices, roll);
        const spokes = batch(roundedBox, chrome, spokeMatrices, roll);
        spokes.position.x = side * 0.089;
        mesh(roundedBox, caliper, side * 0.048 * wheelScale, 0.06, 0.16, 0.065, 0.2, 0.08, pivot);
        wheelPivots.push(pivot);
        wheelRolls.push(roll);
      }
    }
    model.traverse((child) => { if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; } });
    if (touringWheel) for (const roll of wheelRolls) {
      roll.clear(); roll.add(touringWheel.clone(true));
    }
    // Measure the unrotated model, including mirrors, bumpers and the spare wheel.
    model.updateMatrixWorld(true);
    carBounds.makeEmpty();
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
      const localMatrix = new THREE.Matrix4().copy(model.matrixWorld).invert().multiply(child.matrixWorld);
      if (child instanceof THREE.InstancedMesh) {
        const instanceMatrix = new THREE.Matrix4();
        for (let i = 0; i < child.count; i++) {
          child.getMatrixAt(i, instanceMatrix);
          carBounds.union(child.geometry.boundingBox!.clone().applyMatrix4(localMatrix.clone().multiply(instanceMatrix)));
        }
      } else carBounds.union(child.geometry.boundingBox!.clone().applyMatrix4(localMatrix));
    });
    carModels.set(index, { model, pivots: [...wheelPivots], rolls: [...wheelRolls], bounds: carBounds.clone() });
  }
  buildCar(0);

  const motorboat = new THREE.Group();
  const helicopter = new THREE.Group();
  const drone = new THREE.Group();
  const rotors: { pivot: THREE.Group; axis: "y" | "x" | "z"; mode: TransportMode; direction: number }[] = [];
  const marinePaint = material(new THREE.MeshPhysicalMaterial({ color: "#e5e5d4", roughness: 0.3, metalness: 0.25, clearcoat: 1 }));
  const aircraftPaint = material(new THREE.MeshPhysicalMaterial({ color: "#c46d3c", roughness: 0.32, metalness: 0.45, clearcoat: 1 }));
  const navigationGreen = material(new THREE.MeshStandardMaterial({ color: "#57e6a0", emissive: "#26bd74", emissiveIntensity: 1.5 }));
  // An elliptical hull is reshaped to a pointed bow and a broad, rounded transom.
  const hullGeometry = geometry(new THREE.SphereGeometry(1, 36, 20));
  const hullPositions = hullGeometry.getAttribute("position");
  for (let i = 0; i < hullPositions.count; i++) {
    const z = hullPositions.getZ(i);
    hullPositions.setX(i, hullPositions.getX(i) * (z < 0 ? 1 + z * 0.45 : 1));
    hullPositions.setY(i, Math.min(hullPositions.getY(i), 0.45));
  }
  hullGeometry.computeVertexNormals();
  mesh(hullGeometry, marinePaint, 0, 0.1, 0, 1.7, 1.05, 4.5, motorboat);
  mesh(hullGeometry, dark, 0, 0.29, 0, 1.73, 0.65, 4.51, motorboat);
  mesh(roundedBox, wood, 0, 0.62, 0.25, 2.65, 0.14, 5.6, motorboat);
  mesh(sphere, marinePaint, 0, 0.56, -2.7, 1.12, 0.27, 1.6, motorboat);
  for (const side of [-1, 1]) {
    mesh(roundedBox, marinePaint, side * 1.37, 0.91, 0.2, 0.23, 0.65, 5.5, motorboat);
    link(motorboat, chrome, new THREE.Vector3(side * 1.12, 1.2, -2), new THREE.Vector3(side * 0.35, 1.2, -3.7), 0.035);
    for (const z of [-2, -0.5, 1.8]) link(motorboat, chrome, new THREE.Vector3(side * 1.15, 0.7, z), new THREE.Vector3(side * 1.15, 1.22, z), 0.027);
    mesh(roundedBox, linen, side * 0.62, 0.95, 0.9, 0.8, 0.22, 0.85, motorboat);
    mesh(roundedBox, linen, side * 0.62, 1.28, 1.25, 0.8, 0.65, 0.2, motorboat).rotation.x = -0.13;
    mesh(sphere, side === -1 ? red : navigationGreen, side * 1.3, 1.12, -1.9, 0.1, 0.08, 0.16, motorboat);
  }
  mesh(roundedBox, marinePaint, 0, 1.05, -0.9, 2.05, 0.8, 0.72, motorboat);
  mesh(roundedBox, glass, 0, 1.64, -1.14, 2.12, 0.65, 0.08, motorboat).rotation.x = -0.3;
  for (const side of [-1, 1]) link(motorboat, chrome, new THREE.Vector3(side * 1.06, 1.33, -1.25), new THREE.Vector3(side * 1.06, 1.94, -1.03), 0.035);
  const helm = mesh(ringShape, dark, 0.55, 1.46, -0.42, 0.28, 0.28, 0.28, motorboat);
  helm.rotation.x = -0.5;
  mesh(roundedBox, glass, -0.45, 1.48, -0.63, 0.48, 0.06, 0.25, motorboat).rotation.x = 0.4;
  mesh(roundedBox, dark, 0, 0.65, 3.2, 0.78, 1.35, 0.78, motorboat);
  mesh(roundedBox, chrome, 0, -0.12, 3.25, 0.16, 1.25, 0.24, motorboat);
  const screw = new THREE.Group();
  screw.position.set(0, -0.6, 3.48);
  motorboat.add(screw);
  for (let i = 0; i < 3; i++) mesh(roundedBox, chrome, 0, 0, 0, 0.17, 0.85, 0.06, screw).rotation.z = i * Math.PI / 3;
  rotors.push({ pivot: screw, axis: "z", mode: "boat", direction: 1 });

  mesh(sphere, aircraftPaint, 0, 1.1, 0, 1.28, 1.2, 2.5, helicopter);
  mesh(sphere, glass, 0, 1.38, -1.38, 1.14, 0.95, 1.26, helicopter);
  mesh(roundedBox, aircraftPaint, 0, 2.1, -0.55, 0.085, 0.14, 2.5, helicopter);
  link(helicopter, aircraftPaint, new THREE.Vector3(0, 0.7, -2.42), new THREE.Vector3(0, 2.22, -1.18), 0.047);
  const tailBoom = geometry(new THREE.CylinderGeometry(0.16, 0.53, 5.3, 16));
  mesh(tailBoom, aircraftPaint, 0, 1.35, 4, 1, 1, 1, helicopter).rotation.x = Math.PI / 2;
  mesh(roundedBox, aircraftPaint, 0, 2.05, 6.3, 0.17, 2, 0.9, helicopter).rotation.x = -0.2;
  mesh(roundedBox, aircraftPaint, 0, 1.3, 5.3, 2.5, 0.12, 0.65, helicopter);
  mesh(roundedBox, dark, 0, 2.18, 0.65, 1.05, 0.55, 1.65, helicopter);
  for (const side of [-1, 1]) {
    mesh(roundedBox, glass, side * 1.23, 1.35, -0.12, 0.045, 1, 1.15, helicopter);
    for (const z of [-0.74, 0.53]) link(helicopter, aircraftPaint, new THREE.Vector3(side * 1.25, 0.65, z), new THREE.Vector3(side * 1.12, 1.96, z), 0.038);
    mesh(roundedBox, chrome, side * 1.27, 0.95, 0.35, 0.04, 0.045, 0.22, helicopter);
    mesh(roundedBox, chrome, side * 1.48, -0.3, 0, 0.13, 0.15, 4.4, helicopter);
    link(helicopter, chrome, new THREE.Vector3(side * 1.48, -0.3, -2.13), new THREE.Vector3(side * 1.48, 0, -2.5), 0.068);
    for (const z of [-1.1, 1.1]) link(helicopter, chrome, new THREE.Vector3(side * 0.65, 0.55, z), new THREE.Vector3(side * 1.48, -0.3, z), 0.065);
    mesh(sphere, side === -1 ? red : navigationGreen, side * 1.3, 1.2, 0.6, 0.095, 0.095, 0.095, helicopter);
    mesh(cylinder, dark, side * 0.58, 2.1, 1.3, 0.18, 0.55, 0.18, helicopter).rotation.x = Math.PI / 2;
  }
  mesh(sphere, headlight, 0, 0.47, -2.1, 0.22, 0.14, 0.16, helicopter);
  mesh(cylinder, chrome, 0, 2.95, 0.1, 0.12, 1.15, 0.12, helicopter);
  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, 3.48, 0.1);
  helicopter.add(mainRotor);
  mesh(sphere, dark, 0, 0, 0, 0.33, 0.18, 0.33, mainRotor);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Group();
    blade.rotation.y = i * Math.PI / 2;
    mainRotor.add(blade);
    mesh(roundedBox, dark, 2.8, 0, 0, 5.1, 0.055, 0.3, blade).rotation.x = 0.06;
    mesh(roundedBox, gold, 5.12, 0.008, 0, 0.35, 0.06, 0.3, blade);
  }
  rotors.push({ pivot: mainRotor, axis: "y", mode: "helicopter", direction: 1 });
  const tailRotor = new THREE.Group();
  tailRotor.position.set(-0.3, 2.2, 6.25);
  helicopter.add(tailRotor);
  for (let i = 0; i < 2; i++) mesh(roundedBox, dark, 0, 0, 0, 0.06, 1.75, 0.16, tailRotor).rotation.x = i * Math.PI / 2;
  mesh(sphere, chrome, -0.04, 0, 0, 0.13, 0.13, 0.13, tailRotor);
  rotors.push({ pivot: tailRotor, axis: "x", mode: "helicopter", direction: -1 });

  mesh(roundedBox, marinePaint, 0, 0.35, 0, 0.85, 0.3, 1.15, drone);
  mesh(roundedBox, dark, 0, 0.52, 0.08, 0.55, 0.12, 0.72, drone);
  mesh(sphere, glass, 0, 0.09, -0.53, 0.2, 0.2, 0.18, drone);
  mesh(cylinder, chrome, 0, 0.14, -0.4, 0.06, 0.33, 0.06, drone);
  mesh(circle, dark, 0, 0.09, -0.715, 0.105, 0.105, 1, drone).rotation.y = Math.PI;
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    link(drone, dark, new THREE.Vector3(x * 0.3, 0.32, z * 0.35), new THREE.Vector3(x * 1.1, 0.38, z * 1.1), 0.065);
    mesh(cylinder, chrome, x * 1.1, 0.44, z * 1.1, 0.14, 0.24, 0.14, drone);
    link(drone, dark, new THREE.Vector3(x * 0.65, 0.3, z * 0.7), new THREE.Vector3(x * 0.8, -0.3, z * 0.85), 0.042);
    mesh(roundedBox, tire, x * 0.8, -0.32, z * 0.85, 0.2, 0.09, 0.35, drone);
    mesh(sphere, z === -1 ? red : navigationGreen, x * 1.1, 0.3, z * 1.1, 0.08, 0.055, 0.08, drone);
    const propeller = new THREE.Group();
    propeller.position.set(x * 1.1, 0.6, z * 1.1);
    drone.add(propeller);
    mesh(roundedBox, dark, 0, 0, 0, 1.18, 0.035, 0.12, propeller).rotation.z = 0.035;
    mesh(sphere, chrome, 0, 0.03, 0, 0.09, 0.065, 0.09, propeller);
    rotors.push({ pivot: propeller, axis: "y", mode: "drone", direction: x * z });
  }
  for (const model of [motorboat, helicopter, drone]) {
    scene.add(model);
    model.visible = false;
    model.traverse((child) => { if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; } });
  }
  const wake = new THREE.Group();
  scene.add(wake);
  const wakeMaterial = material(new THREE.MeshBasicMaterial({ color: "#e4fff0", transparent: true, opacity: 0.4, depthWrite: false }));
  Array.from({ length: 10 }, () => {
    const ring = mesh(ringShape, wakeMaterial, 0, -0.16, 0);
    ring.rotation.x = -Math.PI / 2;
    wake.add(ring);
    return ring;
  });
  wake.visible = false;
  const craftShadow = mesh(circle, shadowMat, 0, 0.045, 0, 4, 4, 1);
  craftShadow.rotation.x = -Math.PI / 2;
  craftShadow.visible = false;

  const missionMarker = new THREE.Group();
  missionMarker.visible = false;
  scene.add(missionMarker);
  const markerMaterial = material(new THREE.MeshBasicMaterial({ color: "#ffd078", transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
  const objectiveRing = mesh(ringShape, markerMaterial, 0, 0.15, 0, 6, 6, 6, missionMarker);
  objectiveRing.rotation.x = -Math.PI / 2;
  const beaconMaterial = material(new THREE.MeshBasicMaterial({ color: "#ffe2a1", transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  mesh(cylinder, beaconMaterial, 0, 6, 0, 0.45, 12, 0.45, missionMarker);
  const landingPad = new THREE.Group();
  scene.add(landingPad);
  landingPad.position.set(0, 0.06, -120);
  landingPad.visible = false;
  mesh(circle, dark, 0, 0, 0, 6, 6, 1, landingPad).rotation.x = -Math.PI / 2;
  for (const x of [-1.4, 1.4]) mesh(box, white, x, 0.02, 0, 0.35, 0.02, 3.6, landingPad);
  mesh(box, white, 0, 0.02, 0, 2.8, 0.02, 0.35, landingPad);
  for (const x of [-4, 4]) for (const z of [-4, 4]) mesh(sphere, headlight, x, 0.1, z, 0.12, 0.12, 0.12, landingPad);

  const avatar = new THREE.Group();
  avatar.name = "PlayerAvatar";
  scene.add(avatar);
  const skin = paint("#80502f", 0.65);
  const shirt = paint("#c6baa0");
  const trousers = paint("#284b55");
  const hair = paint("#25201c");
  const lips = paint("#80503e");
  const sole = paint("#454545");
  const stitching = paint("#9f927b");
  const iris = paint("#51402b");
  const body = new THREE.Group();
  body.position.y = 1.13;
  avatar.add(body);
  const torsoGeometry = geometry(new RoundedBoxGeometry(0.46, 0.46, 0.26, 3, 0.105));
  const torsoPositions = torsoGeometry.getAttribute("position");
  for (let i = 0; i < torsoPositions.count; i++) {
    const y = torsoPositions.getY(i);
    torsoPositions.setX(i, torsoPositions.getX(i) * (0.89 + (y + 0.23) * 0.25));
  }
  torsoGeometry.computeVertexNormals();
  mesh(torsoGeometry, shirt, 0, 0.115, 0, 1, 1, 1, body);
  mesh(roundedBox, trousers, 0, -0.18, 0, 0.38, 0.23, 0.25, body);
  mesh(roundedBox, wood, 0, -0.085, 0, 0.39, 0.045, 0.26, body);
  mesh(roundedBox, chrome, 0, -0.085, -0.139, 0.065, 0.048, 0.02, body);
  mesh(cylinder, skin, 0, 0.39, 0, 0.074, 0.14, 0.073, body);
  const head = new THREE.Group();
  head.position.set(0, 0.53, -0.008);
  body.add(head);
  mesh(sphere, skin, 0, 0, 0, 0.123, 0.163, 0.123, head);
  mesh(roundedBox, skin, 0, -0.073, -0.039, 0.17, 0.13, 0.15, head);
  mesh(sphere, hair, 0, 0.09, 0.015, 0.129, 0.09, 0.127, head);
  mesh(sphere, hair, 0, 0.025, 0.082, 0.117, 0.117, 0.056, head);
  mesh(sphere, skin, 0, -0.018, -0.129, 0.028, 0.044, 0.036, head);
  mesh(roundedBox, lips, 0, -0.081, -0.12, 0.058, 0.012, 0.015, head);
  for (const side of [-1, 1]) {
    mesh(sphere, skin, side * 0.126, -0.015, 0, 0.026, 0.048, 0.022, head);
    mesh(sphere, lips, side * 0.143, -0.015, -0.008, 0.008, 0.023, 0.012, head);
    mesh(sphere, white, side * 0.046, 0.025, -0.11, 0.027, 0.013, 0.012, head);
    mesh(sphere, hair, side * 0.046, 0.025, -0.121, 0.011, 0.011, 0.006, head);
    mesh(sphere, iris, side * 0.046, 0.025, -0.124, 0.009, 0.01, 0.004, head);
    mesh(sphere, hair, side * 0.046, 0.025, -0.128, 0.004, 0.006, 0.002, head);
    mesh(sphere, white, side * 0.046 - 0.003, 0.029, -0.13, 0.002, 0.002, 0.001, head);
    mesh(sphere, skin, side * 0.065, -0.027, -0.094, 0.042, 0.025, 0.026, head);
    mesh(sphere, lips, side * 0.014, -0.042, -0.151, 0.007, 0.004, 0.005, head);
    mesh(roundedBox, hair, side * 0.047, 0.047, -0.113, 0.061, 0.012, 0.012, head).rotation.z = side * 0.08;
    mesh(roundedBox, shirt, side * 0.062, 0.325, -0.08, 0.1, 0.055, 0.1, body).rotation.z = side * 0.4;
  }
  for (let i = 0; i < 4; i++) mesh(sphere, wood, 0, -0.015 + i * 0.08, -0.137, 0.009, 0.009, 0.005, body);
  mesh(roundedBox, shirt, -0.11, 0.2, -0.139, 0.1, 0.1, 0.018, body);
  mesh(roundedBox, stitching, 0.018, 0.1, -0.137, 0.004, 0.39, 0.005, body);
  mesh(roundedBox, stitching, -0.11, 0.25, -0.15, 0.095, 0.006, 0.005, body);
  for (const side of [-1, 1]) {
    link(body, stitching, new THREE.Vector3(side * 0.21, 0.23, -0.08), new THREE.Vector3(side * 0.18, -0.07, -0.07), 0.004);
    mesh(roundedBox, stitching, side * 0.12, -0.06, -0.131, 0.16, 0.005, 0.004, body);
  }
  const limbShape = geometry(new THREE.CapsuleGeometry(1, 1, 4, 10));
  const legs: { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group }[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.105, 0.91, 0);
    avatar.add(hip);
    mesh(limbShape, trousers, 0, -0.2, 0, 0.089, 0.14, 0.091, hip);
    const knee = new THREE.Group();
    knee.position.y = -0.4;
    hip.add(knee);
    mesh(sphere, trousers, 0, 0, 0, 0.079, 0.083, 0.083, knee);
    mesh(limbShape, trousers, 0, -0.18, 0.009, 0.068, 0.127, 0.074, knee);
    const ankle = new THREE.Group();
    ankle.position.y = -0.38;
    knee.add(ankle);
    mesh(roundedBox, hair, 0, -0.045, -0.052, 0.17, 0.14, 0.29, ankle);
    mesh(roundedBox, sole, 0, -0.103, -0.055, 0.18, 0.04, 0.3, ankle);
    mesh(roundedBox, sole, 0, -0.032, -0.172, 0.15, 0.06, 0.035, ankle);
    mesh(roundedBox, stitching, 0, 0.021, 0.04, 0.06, 0.018, 0.055, ankle);
    for (const edge of [-1, 1]) mesh(roundedBox, stitching, edge * 0.082, -0.076, -0.055, 0.004, 0.005, 0.24, ankle);
    for (let i = 0; i < 3; i++) mesh(roundedBox, white, 0, 0.026, -0.03 - i * 0.028, 0.085, 0.008, 0.009, ankle);
    legs.push({ hip, knee, ankle });
  }
  const arms: { shoulder: THREE.Group; elbow: THREE.Group; hand: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.235, 0.275, 0);
    body.add(shoulder);
    mesh(sphere, shirt, 0, -0.02, 0, 0.088, 0.09, 0.092, shoulder);
    mesh(limbShape, shirt, 0, -0.08, 0, 0.079, 0.072, 0.08, shoulder);
    mesh(limbShape, skin, 0, -0.207, 0, 0.054, 0.065, 0.058, shoulder);
    const elbow = new THREE.Group();
    elbow.position.y = -0.285;
    shoulder.add(elbow);
    mesh(sphere, skin, 0, 0, 0, 0.055, 0.056, 0.055, elbow);
    mesh(limbShape, skin, 0, -0.115, 0, 0.047, 0.086, 0.05, elbow);
    const hand = new THREE.Group();
    hand.position.y = -0.26;
    elbow.add(hand);
    mesh(roundedBox, skin, 0, 0, -0.015, 0.073, 0.09, 0.078, hand);
    mesh(sphere, skin, side * 0.034, 0.013, -0.038, 0.023, 0.039, 0.024, hand);
    for (let finger = 0; finger < 4; finger++) {
      const x = -0.027 + finger * 0.018;
      mesh(limbShape, skin, x, -0.045, -0.046, 0.008, 0.016, 0.009, hand).rotation.x = -0.65;
      mesh(sphere, skin, x, -0.062, -0.058, 0.008, 0.009, 0.012, hand);
      mesh(roundedBox, stitching, x, -0.04, -0.06, 0.011, 0.012, 0.002, hand);
    }
    mesh(roundedBox, stitching, 0, -0.153, 0, 0.15, 0.008, 0.15, shoulder);
    arms.push({ shoulder, elbow, hand, side });
  }
  const weapon = new THREE.Group();
  weapon.position.set(0.17, 0.055, -0.34);
  body.add(weapon);
  mesh(roundedBox, dark, 0, -0.012, 0, 0.065, 0.12, 0.085, weapon).rotation.x = -0.18;
  mesh(roundedBox, brake, 0, 0.072, -0.105, 0.105, 0.105, 0.34, weapon);
  mesh(roundedBox, gold, 0, 0.073, -0.04, 0.108, 0.025, 0.13, weapon);
  mesh(roundedBox, dark, 0, 0.14, -0.02, 0.025, 0.035, 0.055, weapon);
  const barrel = mesh(cylinder, dark, 0, 0.075, -0.3, 0.032, 0.16, 0.032, weapon);
  barrel.rotation.x = Math.PI / 2;
  const muzzleTip = new THREE.Object3D();
  muzzleTip.position.set(0, 0.075, -0.39);
  weapon.add(muzzleTip);
  const longWeapon = new THREE.Group();
  weapon.add(longWeapon);
  mesh(roundedBox, wood, 0, 0.06, -0.28, 0.105, 0.09, 0.22, longWeapon);
  mesh(roundedBox, dark, 0, 0.048, 0.18, 0.09, 0.135, 0.21, longWeapon);
  mesh(roundedBox, dark, 0, -0.075, -0.13, 0.065, 0.19, 0.1, longWeapon).rotation.x = -0.15;
  longWeapon.name = "long";
  barrel.name = "barrel";
  longWeapon.visible = false;
  const scope = new THREE.Group();
  weapon.add(scope);
  mesh(cylinder, dark, 0, 0.2, -0.12, 0.043, 0.26, 0.043, scope).rotation.x = Math.PI / 2;
  mesh(circle, glass, 0, 0.2, -0.255, 0.036, 0.036, 1, scope).rotation.y = Math.PI;
  scope.name = "scope";
  scope.visible = false;
  const revolverCylinder = mesh(cylinder, brake, 0, 0.055, -0.06, 0.066, 0.11, 0.066, weapon);
  revolverCylinder.rotation.x = Math.PI / 2;
  revolverCylinder.name = "revolver";
  revolverCylinder.visible = false;
  const armDown = new THREE.Vector3(0, -1, 0);
  const armTarget = new THREE.Vector3();
  const armDirection = new THREE.Vector3();
  const elbowPosition = new THREE.Vector3();
  const elbowBend = new THREE.Vector3();
  const forearmRotation = new THREE.Quaternion();
  function poseArms() {
    // Two-bone IK keeps both palms on the grip while the torso and weapon move together.
    for (const { shoulder, elbow, hand, side } of arms) {
      armTarget.set(side === 1 ? 0 : -0.065, 0, side === 1 ? 0 : -0.015);
      armTarget.applyEuler(weapon.rotation).add(weapon.position);
      armDirection.copy(armTarget).sub(shoulder.position);
      const distance = armDirection.length();
      armDirection.normalize();
      const along = (0.285 ** 2 - 0.26 ** 2 + distance ** 2) / (2 * distance);
      elbowBend.set(side * 0.35, -1, 0);
      elbowBend.addScaledVector(armDirection, -elbowBend.dot(armDirection)).normalize();
      elbowPosition.copy(shoulder.position).addScaledVector(armDirection, along)
        .addScaledVector(elbowBend, Math.sqrt(Math.max(0, 0.285 ** 2 - along ** 2)));
      armDirection.copy(elbowPosition).sub(shoulder.position).normalize();
      shoulder.quaternion.setFromUnitVectors(armDown, armDirection);
      armDirection.copy(armTarget).sub(elbowPosition).normalize();
      forearmRotation.setFromUnitVectors(armDown, armDirection);
      elbow.quaternion.copy(shoulder.quaternion).invert().multiply(forearmRotation);
      hand.quaternion.copy(forearmRotation).invert();
    }
  }
  poseArms();
  avatar.visible = false;
  avatar.traverse((child) => { if (child instanceof THREE.Mesh) child.castShadow = true; });

  const muzzleMaterial = material(new THREE.MeshBasicMaterial({ color: "#fff0aa", transparent: true, opacity: 0 }));
  const muzzle = mesh(sphere, muzzleMaterial, 0, 0, 0, 0.3, 0.3, 0.3);
  muzzle.visible = false;
  const projectileGeometry = geometry(new THREE.BufferGeometry());
  const trailCount = 128;
  const projectilePositions = new Float32Array(trailCount * 6);
  const trailRemaining = new Float32Array(trailCount);
  let trailCursor = 0;
  projectileGeometry.setAttribute("position", new THREE.BufferAttribute(projectilePositions, 3));
  const projectileMaterial = material(new THREE.LineBasicMaterial({ color: "#fff0a4", transparent: true, opacity: 0.95, depthTest: true }));
  const projectile = new THREE.LineSegments(projectileGeometry, projectileMaterial);
  projectile.frustumCulled = false;
  projectile.visible = false;
  scene.add(projectile);
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const endpoint = new THREE.Vector3();
  const aimDirection = new THREE.Vector3();
  const spreadRight = new THREE.Vector3();
  const spreadUp = new THREE.Vector3();
  const localRay = new THREE.Ray();
  const carInverse = new THREE.Matrix4();
  const carYaw = new THREE.Quaternion();
  const collisionBox = new THREE.Box3();
  const collisionPoint = new THREE.Vector3();

  let online: RoomSnapshot | null = null;
  let verticalVelocity = 0;
  const remoteActors = new Map<string, THREE.Group>();
  const supplyActors = new Map<string, THREE.Mesh>();
  const zoneWall = mesh(geometry(new THREE.CylinderGeometry(1, 1, 24, 96, 1, true)), material(new THREE.MeshBasicMaterial({ color: "#6ba5ff", transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false })), 0, 12, 0);
  zoneWall.visible = false;
  let driving = true;
  let heading = 0;
  let speed = 0;
  let steering = 0;
  let footSpeed = 0;
  let gait = 0;
  let lastFootStep = 0;
  let aimPitch = 0;
  let recoil = 0;
  let cameraMode = 0;
  let weaponIndex = 0;
  const ammo: number[] = WEAPONS.map((weapon) => weapon.capacity);
  let hits = 0;
  let credits = 100;
  let health = 100;
  let stamina = 100;
  let gameMinutes = 360;
  let insideHome: number | null = null;
  let missionIndex = -1;
  let missionsCompleted = 0;
  let missionStartDistance = 1;
  const fuel = VEHICLES.map(() => 65);
  const ROOM_HALF_X = 6.4;
  const ROOM_MIN_Z = -7.3;
  const ROOM_MAX_Z = 7.9;
  function formatClock(minutes: number) {
    const total = Math.floor(minutes) % 1440;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  let message = "";
  let messageRemaining = 0;
  let fireCooldown = 0;
  let reloadRemaining = 0;
  let flashRemaining = 0;
  let paused = false;
  let disposed = false;
  new GLTFLoader().load("/models/coastal-assets.glb", ({ scene: library }) => {
    const assetGeometries = new Set<THREE.BufferGeometry>();
    const assetMaterials = new Set<THREE.Material>();
    const assetTextures = new Set<THREE.Texture>();
    library.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.castShadow = child.receiveShadow = true;
      assetGeometries.add(child.geometry);
      for (const mat of Array.isArray(child.material) ? child.material : [child.material]) {
        assetMaterials.add(mat);
        for (const value of Object.values(mat)) if (value instanceof THREE.Texture) assetTextures.add(value);
      }
    });
    if (disposed) {
      assetGeometries.forEach(g => g.dispose()); assetMaterials.forEach(m => m.dispose()); assetTextures.forEach(t => t.dispose()); return;
    }
    assetGeometries.forEach(g => geometries.add(g)); assetMaterials.forEach(m => materials.add(m));
    assetTextures.forEach(t => { t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); textures.add(t); });
    touringWheel = library.getObjectByName("TouringWheel") ?? null;
    if (touringWheel) for (const cached of carModels.values()) for (const roll of cached.rolls) {
      roll.clear(); roll.add(touringWheel.clone(true));
    }
    const dress = (name: string, parent: THREE.Group, remove: (child: THREE.Object3D) => boolean) => {
      const part = library.getObjectByName(name);
      if (!part) return;
      for (const child of [...parent.children]) if (remove(child)) parent.remove(child);
      parent.add(part.clone(true));
    };
    // Preserve the weapon, head, pelvis and all animated joints.
    dress("SculptedHead", head, child => child instanceof THREE.Mesh);
    dress("TailoredTorso", body, child => child instanceof THREE.Mesh && child.position.y > -0.3 && child.position.y < 0.36);
    for (const { shoulder, elbow } of arms) {
      dress("TailoredUpperArm", shoulder, child => child instanceof THREE.Mesh);
      dress("NaturalForearm", elbow, child => child instanceof THREE.Mesh);
    }
    for (const { hip, knee } of legs) {
      dress("CanvasThigh", hip, child => child instanceof THREE.Mesh);
      dress("CanvasShin", knee, child => child instanceof THREE.Mesh);
    }
    const blade = library.getObjectByName("PalmFrond");
    blade?.updateMatrixWorld(true);
    blade?.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      palmLeaves.geometry = geometry(child.geometry.clone().applyMatrix4(child.matrixWorld));
      palmLeaves.material = child.material;
      for (const mat of Array.isArray(child.material) ? child.material : [child.material]) {
        mat.side = THREE.DoubleSide;
        mat.onBeforeCompile = (shader: Parameters<THREE.Material["onBeforeCompile"]>[0]) => {
          shader.uniforms.uWindTime = oceanTime;
          shader.vertexShader = "uniform float uWindTime;\n" + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
            #include <begin_vertex>
            float bend = clamp(-position.z / 6.0, 0.0, 1.0);
            transformed.x += sin(uWindTime * 1.25 + position.z * 0.7) * 0.13 * bend;
            transformed.y += cos(uWindTime * 0.9 + position.x) * 0.06 * bend;
          `);
        };
        mat.customProgramCacheKey = () => "coastal-wind";
      }
      palmLeaves.computeBoundingSphere();
    });
    const shutters = library.getObjectByName("WindowShutters");
    if (shutters) for (const home of HOMES) for (const side of [-1, 1]) {
      const detail = shutters.clone(true); detail.position.set(home.x + side * 3.4, 2.5, home.z + 7.2); scene.add(detail);
    }
    // Place scenery clear of roads, door approaches, and existing structures.
    for (let i = 0; i < 100; i++) {
      const x = -115 + ((i * 83.17) % 410), z = -880 + ((i * 137.31) % 1810);
      if (nearRoad(x, z, 5) || blocked(x, z, 2)) continue;
      const isRock = i % 3 === 0;
      const source = library.getObjectByName(isRock ? `CoastalRock${Math.floor(i / 3) % 3}` : "CoastalShrub");
      if (!source) continue;
      const prop = source.clone(true);
      prop.position.set(x, 0, z); prop.rotation.y = i * 2.4;
      const scale = isRock ? 0.8 + (i % 4) * 0.25 : 1.1;
      prop.scale.setScalar(scale); scene.add(prop);
      if (isRock) colliders.push({ minX: x - scale, maxX: x + scale, minZ: z - scale, maxZ: z + scale, height: scale });
    }
  }, undefined, () => console.warn("Coastal assets unavailable; using built-in models."));

  let elapsed = 0;
  let statsElapsed = 0;
  let ready = false;
  let frameId = 0;
  let lastTime = performance.now();
  const keys = new Set<string>();
  const player = () => driving ? car.position : avatar.position;

  function nearestDistrict() {
    const position = player();
    let nearest = 0;
    let distance = Infinity;
    DISTRICTS.forEach((district, index) => {
      const next = Math.hypot(position.x - district.x, position.z - district.z);
      if (next < distance) { distance = next; nearest = index; }
    });
    return nearest;
  }
  function nearbyHomeIndex() {
    const position = player();
    let nearest: number | null = null;
    let distance = 9;
    HOMES.forEach((home, index) => {
      const next = Math.hypot(position.x - home.x, position.z - home.z);
      if (next < distance) { distance = next; nearest = index; }
    });
    return nearest;
  }
  function emitStats() {
    const position = player();
    const district = nearestDistrict();
    audio.setAmbient(district === 14);
    const missionTarget = missionIndex !== -1 ? MISSIONS[missionIndex] : null;
    const missionDistance = missionTarget ? Math.hypot(position.x - missionTarget.x, position.z - missionTarget.z) : 0;
    const missionProgress = missionTarget ? THREE.MathUtils.clamp(1 - missionDistance / missionStartDistance, 0, 1) : 0;
    onStats({
      view: cameraMode === 3 ? "first" : cameraMode === 2 ? "overhead" : "third",
      heading,
      speed: Math.round(Math.abs(driving ? speed : footSpeed) * 3.6),
      district,
      driving,
      ammo: ammo[weaponIndex],
      weaponAmmo: [...ammo],
      hits,
      x: position.x,
      z: position.z,
      mode: driving ? "car" : "foot",
      altitude: position.y,
      nearbyHome: nearbyHomeIndex(),
      insideHome,
      missionIndex,
      missionsCompleted,
      missionProgress,
      missionDistance,
      credits,
      health,
      stamina,
      fuel: fuel[vehicleIndex],
      clock: formatClock(gameMinutes),
      nearbyStation: nearbyStationIndex(),
      canEnterCar: canEnterCar(),
      weaponIndex,
      reloading: reloadRemaining > 0,
      message,
    });
  }
  function notify(text: string) {
    message = text;
    messageRemaining = 4;
  }
  function nearbyStationIndex() {
    let nearest: number | null = null;
    let distance = 8.000001;
    FUEL_STATIONS.forEach((station, index) => {
      const next = Math.hypot(car.position.x - station.x, car.position.z - station.z);
      if (next <= 8 && next < distance && (driving || Math.hypot(avatar.position.x - station.x, avatar.position.z - station.z) <= 8)) {
        nearest = index;
        distance = next;
      }
    });
    return nearest;
  }
  function blocked(x: number, z: number, radius: number) {
    if (insideHome !== null) {
      const home = HOMES[insideHome];
      const lx = x - home.x;
      const lz = z - home.z;
      if (lx < -ROOM_HALF_X + radius || lx > ROOM_HALF_X - radius || lz < ROOM_MIN_Z + radius || lz > ROOM_MAX_Z - radius) return true;
      return indoorColliders.some((c) => {
        const closestX = THREE.MathUtils.clamp(lx, c.minX, c.maxX);
        const closestZ = THREE.MathUtils.clamp(lz, c.minZ, c.maxZ);
        return (lx - closestX) ** 2 + (lz - closestZ) ** 2 < radius * radius;
      });
    }
    if (x < -136 + radius || x > 390 - radius || z < -985 + radius || z > 1560 - radius) return true;
    return colliders.some((c) => {
      if ((c.minY ?? 0) > 2.5) return false;
      const closestX = THREE.MathUtils.clamp(x, c.minX, c.maxX);
      const closestZ = THREE.MathUtils.clamp(z, c.minZ, c.maxZ);
      return (x - closestX) ** 2 + (z - closestZ) ** 2 < radius * radius;
    });
  }
  function touchesCar(x: number, z: number, radius = 0.3, cx = car.position.x, cz = car.position.z, angle = car.rotation.y) {
    if (online) return false;
    const dx = x - cx;
    const dz = z - cz;
    const localX = dx * Math.cos(angle) - dz * Math.sin(angle);
    const localZ = dx * Math.sin(angle) + dz * Math.cos(angle);
    return (localX - THREE.MathUtils.clamp(localX, carBounds.min.x, carBounds.max.x)) ** 2
      + (localZ - THREE.MathUtils.clamp(localZ, carBounds.min.z, carBounds.max.z)) ** 2 < radius ** 2;
  }
  function carBlocked(x: number, z: number, angle: number) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hx = (carBounds.max.x - carBounds.min.x) / 2;
    const hz = (carBounds.max.z - carBounds.min.z) / 2;
    const midX = (carBounds.max.x + carBounds.min.x) / 2;
    const midZ = (carBounds.max.z + carBounds.min.z) / 2;
    const cx = x + midX * cos + midZ * sin;
    const cz = z - midX * sin + midZ * cos;
    const extentX = Math.abs(cos) * hx + Math.abs(sin) * hz;
    const extentZ = Math.abs(sin) * hx + Math.abs(cos) * hz;
    if (cx - extentX < -136 || cx + extentX > 390 || cz - extentZ < -985 || cz + extentZ > 1560) return true;
    // Separating axes for an oriented vehicle against each static world box.
    return colliders.some((c) => {
      if ((c.minY ?? 0) > carBounds.max.y) return false;
      const dx = (c.minX + c.maxX) / 2 - cx;
      const dz = (c.minZ + c.maxZ) / 2 - cz;
      const bx = (c.maxX - c.minX) / 2;
      const bz = (c.maxZ - c.minZ) / 2;
      return Math.abs(dx) < extentX + bx && Math.abs(dz) < extentZ + bz
        && Math.abs(dx * cos - dz * sin) < hx + bx * Math.abs(cos) + bz * Math.abs(sin)
        && Math.abs(dx * sin + dz * cos) < hz + bx * Math.abs(sin) + bz * Math.abs(cos);
    });
  }
  function clearFootPath(ax: number, az: number, bx: number, bz: number, cx = car.position.x, cz = car.position.z, angle = car.rotation.y) {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.1));
    for (let i = 0; i <= steps; i++) {
      const x = THREE.MathUtils.lerp(ax, bx, i / steps);
      const z = THREE.MathUtils.lerp(az, bz, i / steps);
      if (blocked(x, z, 0.3) || touchesCar(x, z, 0.3, cx, cz, angle)) return false;
    }
    return true;
  }
  function doorPosition(side: number, cx = car.position.x, cz = car.position.z, angle = car.rotation.y, offset = 0.36) {
    const x = side < 0 ? carBounds.min.x - offset : carBounds.max.x + offset;
    return new THREE.Vector3(cx + x * Math.cos(angle) - 0.1 * Math.sin(angle), 0, cz - x * Math.sin(angle) - 0.1 * Math.cos(angle));
  }
  function safeExit(cx = car.position.x, cz = car.position.z, angle = car.rotation.y) {
    for (const side of [1, -1]) {
      const door = doorPosition(side, cx, cz, angle);
      for (const offset of [0.7, 0.36, 1.2]) {
        const candidate = doorPosition(side, cx, cz, angle, offset);
        if (clearFootPath(door.x, door.z, candidate.x, candidate.z, cx, cz, angle)) return candidate;
      }
    }
    return null;
  }
  function canEnterCar() {
    if (driving || health <= 0 || Math.abs(speed) >= 2 || avatar.position.distanceTo(car.position) > 3.8) return false;
    return [-1, 1].some((side) => {
      const door = doorPosition(side);
      return clearFootPath(avatar.position.x, avatar.position.z, door.x, door.z);
    });
  }

  const desiredCamera = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const smoothedLookAt = new THREE.Vector3(0, 1, -6);
  function updateCamera(dt: number, snap = false) {
    const position = player();
    const forwardX = -Math.sin(heading);
    const forwardZ = -Math.cos(heading);
    head.visible = cameraMode !== 3;
    car.visible = !online && !(driving && cameraMode === 3);
    weapon.position.y = cameraMode === 3 ? .29 : .055;
    if (cameraMode === 3) {
      desiredCamera.set(position.x + forwardX * .04, driving ? 1.5 : 1.65, position.z + forwardZ * .04);
      lookAt.set(position.x + forwardX * 10, (driving ? 1.5 : 1.65) + Math.tan(aimPitch + recoil) * 10, position.z + forwardZ * 10);
    } else if (cameraMode === 2) {
      desiredCamera.set(position.x - forwardX * 5, 49, position.z - forwardZ * 12);
      lookAt.set(position.x + forwardX * 7, 0, position.z + forwardZ * 7);
    } else {
      const distance = driving ? (cameraMode === 1 ? 7 : 12.5) : (cameraMode === 1 ? 3.5 : 5.8);
      const height = driving ? (cameraMode === 1 ? 3.1 : 5.8) : 3;
      desiredCamera.set(position.x - forwardX * distance, height, position.z - forwardZ * distance);
      lookAt.set(position.x + forwardX * (driving ? 7 : 9), driving ? 1 : 1.6 + Math.tan(aimPitch + recoil) * 9, position.z + forwardZ * (driving ? 7 : 9));
    }
    desiredCamera.y += position.y;
    lookAt.y += position.y;
    const factor = snap || cameraMode === 3 ? 1 : 1 - Math.exp(-dt * 6);
    camera.position.lerp(desiredCamera, factor);
    smoothedLookAt.lerp(lookAt, factor);
    camera.lookAt(smoothedLookAt);
    const nextFov = driving && keys.has("shift") && Math.abs(speed) > 15 ? 66 : 58;
    camera.fov = THREE.MathUtils.lerp(camera.fov, nextFov, factor);
    camera.updateProjectionMatrix();
  }
  function clearInput() {
    keys.clear();
    steering = 0;
    if (pointerId !== null && canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    pointerId = null;
  }
  function placePlayer(x: number, z: number, angle = 0) {
    if (carBlocked(x, z, angle)) { notify("No safe parking space at that destination."); return false; }
    const exit = driving ? null : safeExit(x, z, angle);
    if (!driving && !exit) { notify("No safe place to stand beside the car."); return false; }
    if (insideHome !== null) { interior.visible = false; insideHome = null; }
    stamina = 100;
    car.position.set(x, 0, z);
    avatar.position.copy(exit ?? car.position);
    car.rotation.set(0, angle, 0);
    avatar.rotation.set(0, angle, 0);
    heading = angle;
    speed = 0;
    footSpeed = 0;
    recoil = aimPitch = 0;
    clearInput();
    flashRemaining = 0;
    trailRemaining.fill(0);
    projectilePositions.fill(0);
    projectileGeometry.getAttribute("position").needsUpdate = true;
    muzzle.visible = projectile.visible = false;
    updateCamera(0, true);
    return true;
  }
  function resetToRoad() {
    const position = player();
    let nearestDistance = Infinity;
    let nearestX = 0;
    let nearestZ = 0;
    let nearestHeading = 0;
    for (const road of roads) {
      const dx = road.bx - road.ax;
      const dz = road.bz - road.az;
      const t = THREE.MathUtils.clamp(((position.x - road.ax) * dx + (position.z - road.az) * dz) / (dx * dx + dz * dz), 0, 1);
      const x = road.ax + dx * t;
      const z = road.az + dz * t;
      const distance = Math.hypot(position.x - x, position.z - z);
      const angle = Math.atan2(-dx, -dz);
      const spawnHeading = Math.cos(heading - angle) >= 0 ? angle : angle + Math.PI;
      if (distance >= nearestDistance || carBlocked(x, z, spawnHeading) || (!driving && !safeExit(x, z, spawnHeading))) continue;
      nearestDistance = distance;
      nearestX = x;
      nearestZ = z;
      nearestHeading = spawnHeading;
    }
    if (!Number.isFinite(nearestDistance)) { notify("No safe road recovery position found."); return false; }
    return placePlayer(nearestX, nearestZ, nearestHeading);
  }
  function toggleDrive() {
    // The loadout panel issues this explicit command before it unpauses the game.
    if (health <= 0) return;
    if (driving) {
      if (Math.abs(speed) >= 2) { notify("Slow below 2 m/s before leaving the car."); return; }
      const exit = safeExit();
      if (!exit) { notify("Both doors are blocked. Park somewhere with a safe exit."); return; }
      avatar.position.copy(exit);
      avatar.rotation.y = heading;
    } else {
      if (!canEnterCar()) { notify("Walk within 3.8 m of the car with a clear path to a door."); return; }
      heading = car.rotation.y;
    }
    clearInput();
    speed = footSpeed = 0;
    reloadRemaining = 0;
    recoil = aimPitch = 0;
    driving = !driving;
    avatar.visible = !driving;
    updateCamera(0, true);
  }
  function obstructionDistance(ray: THREE.Ray, range: number) {
    let distance = range;
    for (const collider of colliders) {
      collisionBox.min.set(collider.minX, collider.minY ?? 0, collider.minZ);
      collisionBox.max.set(collider.maxX, collider.height, collider.maxZ);
      if (collisionBox.containsPoint(ray.origin)) return 0;
      if (ray.intersectBox(collisionBox, collisionPoint)) distance = Math.min(distance, ray.origin.distanceTo(collisionPoint));
    }
    if (online) return distance;
    carYaw.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, car.rotation.y);
    carInverse.makeRotationFromQuaternion(carYaw).setPosition(car.position).invert();
    localRay.copy(ray).applyMatrix4(carInverse);
    if (carBounds.containsPoint(localRay.origin)) return 0;
    if (localRay.intersectBox(carBounds, collisionPoint)) distance = Math.min(distance, localRay.origin.distanceTo(collisionPoint));
    if (ray.direction.y < 0) distance = Math.min(distance, Math.max(0, -ray.origin.y / ray.direction.y));
    return distance;
  }
  function fire() {
    if (paused || driving || health <= 0 || fireCooldown > 0 || reloadRemaining > 0) return;
    if (ammo[weaponIndex] <= 0) { notify("Magazine empty. Press R to reload."); return; }
    const spec = WEAPONS[weaponIndex];
    weapon.rotation.x = aimPitch + recoil;
    avatar.updateMatrixWorld(true);
    muzzleTip.getWorldPosition(origin);
    weapon.getWorldDirection(aimDirection).negate();
    // A barrel pushed through cover must not let its muzzle fire from the other side.
    scratch.set(avatar.position.x, origin.y, avatar.position.z);
    direction.copy(origin).sub(scratch).normalize();
    raycaster.set(scratch, direction);
    if (obstructionDistance(raycaster.ray, scratch.distanceTo(origin)) < scratch.distanceTo(origin) - 0.001) {
      notify("Barrel obstructed. Step back from cover.");
      return;
    }
    if (online && online.phase !== "active") return;
    raycaster.set(origin, aimDirection);
    onCombat?.({ type: "fire", weapon: weaponIndex, heading, pitch: aimPitch, range: obstructionDistance(raycaster.ray, spec.range) });
    ammo[weaponIndex]--;
    fireCooldown = spec.cooldown;
    audio.fire(spec.pellets, spec.automatic);
    let best: Target | undefined;
    let bestScore = Math.cos(THREE.MathUtils.degToRad(10));
    for (const target of targets) {
      if (target.cooldown > 0) continue;
      scratch.copy(target.position).sub(origin);
      const distance = scratch.length();
      const alignment = scratch.normalize().dot(aimDirection);
      if (distance > spec.range || alignment <= bestScore) continue;
      raycaster.set(origin, scratch);
      if (obstructionDistance(raycaster.ray, distance) < distance - 0.15) continue;
      best = target;
      bestScore = alignment;
    }
    if (best) aimDirection.copy(best.position).sub(origin).normalize();
    spreadRight.crossVectors(aimDirection, THREE.Object3D.DEFAULT_UP).normalize();
    spreadUp.crossVectors(spreadRight, aimDirection).normalize();
    scene.updateMatrixWorld(true);
    raycaster.far = spec.range;
    for (let pellet = 0; pellet < spec.pellets; pellet++) {
      const scatter = Math.sqrt(Math.random()) * Math.tan(spec.spread);
      const angle = Math.random() * Math.PI * 2;
      direction.copy(aimDirection).addScaledVector(spreadRight, Math.cos(angle) * scatter)
        .addScaledVector(spreadUp, Math.sin(angle) * scatter).normalize();
      raycaster.set(origin, direction);
      const obstruction = obstructionDistance(raycaster.ray, spec.range);
      const intersection = raycaster.intersectObjects(targetMeshes, false)[0];
      endpoint.copy(origin).addScaledVector(direction, obstruction);
      if (intersection && intersection.distance < obstruction) {
        endpoint.copy(intersection.point);
        const target = targets.find((candidate) => candidate.mesh === intersection.object)!;
        if (target.cooldown <= 0) {
          hits++;
          credits += 10;
          target.cooldown = 1.7;
          target.mesh.scale.setScalar(0.7);
          target.ring.material = gold;
          audio.hit(hits % 5 === 0);
          if (hits % 5 === 0) { credits += 50; notify("Target hit +10 credits. Five-hit bonus +50 credits!"); }
          else notify("Target hit +10 credits.");
        }
      }
      projectilePositions.set([origin.x, origin.y, origin.z, endpoint.x, endpoint.y, endpoint.z], trailCursor * 6);
      trailRemaining[trailCursor] = 0.12;
      trailCursor = (trailCursor + 1) % trailCount;
    }
    projectileGeometry.getAttribute("position").needsUpdate = true;
    muzzle.position.copy(origin);
    recoil = Math.min(0.18, recoil + (spec.pellets > 1 || weaponIndex >= 4 ? 0.065 : 0.028));
    flashRemaining = 0.09;
    projectile.visible = muzzle.visible = true;
    emitStats();
  }

  function normalizeKey(key: string) {
    const lower = key.toLowerCase();
    const aliases: Record<string, string> = {
      keyw: "w", keya: "a", keys: "s", keyd: "d", keye: "e", keyr: "r", keyf: "f", keyc: "c",
      arrowup: "w", arrowdown: "s", arrowleft: "a", arrowright: "d", up: "w", down: "s", left: "a", right: "d",
      " ": "space", spacebar: "space", shiftleft: "shift", shiftright: "shift", digit1: "1", digit2: "2", digit3: "3",
      digit4: "4", digit5: "5", digit6: "6",
    };
    return aliases[lower] ?? lower;
  }
  const validIndex = (index: number, length: number) => Number.isInteger(index) && index >= 0 && index < length;
  function command(action: GameCommand) {
    if (disposed) return;
    if (action.type === "room") {
      const previous = online;
      online = action.snapshot;
      car.visible = !online;
      zoneWall.visible = online?.phase === "active";
      if (!online) {
        remoteActors.forEach(actor => scene.remove(actor)); remoteActors.clear();
        supplyActors.forEach(actor => scene.remove(actor)); supplyActors.clear();
        health = 100; clearInput(); resetToRoad(); emitStats(); return;
      }
      const self = online.players.find(p => p.id === online!.selfId);
      if (!self) return;
      driving = false; avatar.visible = self.health > 0; speed = 0;
      health = self.health;
      const starting = !previous || previous.phase !== online.phase;
      if (starting || Math.hypot(avatar.position.x - self.x, avatar.position.z - self.z) > 1.5) avatar.position.set(self.x, 0, self.z);
      if (starting) { clearInput(); footSpeed = 0; reloadRemaining = 0; insideHome = null; interior.visible = false; missionIndex = -1; missionMarker.visible = false; }
      self.ammo.forEach((count, i) => { ammo[i] = count; });
      zoneWall.scale.set(online.zone.radius, 1, online.zone.radius);
      zoneWall.position.set(online.zone.x, 12, online.zone.z);
      const ids = new Set(online.players.filter(p => p.id !== online!.selfId).map(p => p.id));
      for (const [id, actor] of remoteActors) if (!ids.has(id)) { scene.remove(actor); remoteActors.delete(id); }
      for (const remote of online.players) {
        if (remote.id === online.selfId) continue;
        let actor = remoteActors.get(remote.id);
        if (!actor) { actor = avatar.clone(true); actor.name = "RemotePlayer"; scene.add(actor); remoteActors.set(remote.id, actor); actor.position.set(remote.x, 0, remote.z); }
        actor.visible = remote.health > 0;
        actor.userData.destination = new THREE.Vector3(remote.x, 0, remote.z);
        actor.userData.heading = remote.heading;
      }
      for (const item of online.loot) {
        let actor = supplyActors.get(item.id);
        if (!actor) { actor = mesh(roundedBox, item.kind === "medkit" ? red : item.kind === "armor" ? chrome : item.kind === "weapon" ? gold : green, item.x, .35, item.z, .65, .55, .65); supplyActors.set(item.id, actor); }
        actor.visible = !item.taken && online.phase === "active";
      }
      emitStats(); return;
    }
    if (online && ["vehicle", "travel", "reset", "respawn", "station-travel", "home-travel", "toggle-drive", "interact", "mission-start"].includes(action.type)) { notify("Online battle royale is on foot. Leave the room to free roam."); return; }
    if (action.type === "pause") {
      paused = action.value;
      clearInput();
      lastTime = performance.now();
      audio.setActive(!paused);
      emitStats();
      return;
    }
    if (action.type === "mute") {
      audio.setMuted(action.value);
      return;
    }
    if (action.type === "input") {
      const key = normalizeKey(action.key);
      if (!action.pressed) { keys.delete(key); return; }
      if (paused || health <= 0 || keys.has(key)) return;
      keys.add(key);
      if (key === "space" && !driving && !online && avatar.position.y <= 0.001) verticalVelocity = 5.2;
      if (key === "e") {
        if (driving || (insideHome === null && canEnterCar())) command({ type: "toggle-drive" });
        else command({ type: "interact" });
      }
      else if (key === "r") command({ type: "reload" });
      else if (key === "f") command({ type: "fire" });
      else if (key === "c") command({ type: "camera" });
      else if (["1", "2", "3", "4", "5", "6"].includes(key)) command({ type: "weapon", index: Number(key) - 1 });
      return;
    }
    if (health <= 0 && action.type !== "respawn" && action.type !== "camera") {
      notify("Health depleted. Use Respawn to recover; Reset Ride does not heal.");
      emitStats();
      return;
    }
    switch (action.type) {
      case "vehicle":
        if (validIndex(action.index, VEHICLES.length)) {
          if (Math.abs(speed) >= 2) { notify("Stop before changing cars."); break; }
          const previous = vehicleIndex;
          buildCar(action.index);
          if (carBlocked(car.position.x, car.position.z, car.rotation.y) || (!driving && touchesCar(avatar.position.x, avatar.position.z))) {
            buildCar(previous);
            notify("Not enough space for that car. Move to an open road.");
          } else { vehicleIndex = action.index; speed = 0; }
        }
        break;
      case "travel":
        if (validIndex(action.index, DISTRICTS.length)) {
          const district = DISTRICTS[action.index];
          placePlayer(district.x, district.z);
        }
        break;
      case "weapon":
        if (validIndex(action.index, WEAPONS.length)) {
          weaponIndex = action.index;
          reloadRemaining = 0;
          longWeapon.visible = weaponIndex > 0 && weaponIndex < 5;
          scope.visible = weaponIndex === 4;
          revolverCylinder.visible = weaponIndex === 5;
          barrel.scale.y = [0.16, 0.4, 0.34, 0.23, 0.6, 0.24][weaponIndex];
          barrel.scale.x = barrel.scale.z = weaponIndex === 2 ? 0.045 : 0.032;
          barrel.position.z = -0.22 - barrel.scale.y / 2;
          muzzleTip.position.z = barrel.position.z - barrel.scale.y / 2 - 0.01;
          weapon.rotation.set(aimPitch + recoil, 0, 0);
          notify(`${WEAPONS[weaponIndex].name} equipped.`);
        }
        break;
      case "reset": if (resetToRoad()) notify("Recovered to a safe road. Health, credits and fuel unchanged."); break;
      case "respawn":
        if (health <= 0 && resetToRoad()) {
          health = 100;
          reloadRemaining = 0;
          notify("Respawned with 100 health. Fuel and credits unchanged.");
        }
        break;
      case "station-travel":
        if (validIndex(action.index, FUEL_STATIONS.length)) {
          const station = FUEL_STATIONS[action.index];
          if (placePlayer(station.x, station.z + 4)) notify(`Towed to ${station.name}. Fuel sold separately.`);
        }
        break;
      case "refuel": {
        if (Math.abs(speed) >= 0.1 || Math.abs(footSpeed) >= 0.1) { notify("Stop before refuelling."); break; }
        if (nearbyStationIndex() === null) { notify("Bring the car within 8 m of a station and stay nearby."); break; }
        const litres = Math.max(0, Math.min(10, 100 - fuel[vehicleIndex], credits / FUEL_PRICE));
        if (litres <= 0) { notify(fuel[vehicleIndex] >= 100 ? "The tank is full." : "Not enough credits for petrol. Earn credits at the targets."); break; }
        fuel[vehicleIndex] = Math.min(100, fuel[vehicleIndex] + litres);
        credits = Math.max(0, credits - litres * FUEL_PRICE);
        notify(`Bought ${litres.toFixed(1)} L for ${(litres * FUEL_PRICE).toFixed(1)} credits.`);
        break;
      }
      case "toggle-drive": toggleDrive(); break;
      case "reload":
        if (!paused && !driving && reloadRemaining <= 0 && ammo[weaponIndex] < WEAPONS[weaponIndex].capacity && (!online || (online.players.find(p => p.id === online!.selfId)?.weapons[weaponIndex] && (online.players.find(p => p.id === online!.selfId)?.reserve[weaponIndex] ?? 0) > 0))) {
          onCombat?.({ type: "reload", weapon: weaponIndex, heading, pitch: aimPitch });
          reloadRemaining = WEAPONS[weaponIndex].reload;
          notify(`Reloading ${WEAPONS[weaponIndex].name}...`);
          audio.reloadStart();
        }
        break;
      case "fire": fire(); break;
      case "view": cameraMode = action.mode === "first" ? 3 : 0; updateCamera(0, true); break;
      case "camera": cameraMode = driving ? (cameraMode + 1) % 3 : cameraMode === 3 ? 0 : 3; updateCamera(0, true); break;
      case "mission-start":
        if (validIndex(action.index, MISSIONS.length) && missionIndex !== action.index) {
          const target = MISSIONS[action.index];
          if (target.mode !== "car" && target.mode !== "foot") { notify("That objective needs a vehicle mode still in testing."); break; }
          missionIndex = action.index;
          missionStartDistance = Math.max(1, Math.hypot(player().x - target.x, player().z - target.z));
          missionMarker.visible = true;
          missionMarker.position.set(target.x, 0.05, target.z);
          notify(`New objective: ${target.name}.`);
        }
        break;
      case "mission-abandon":
        if (missionIndex !== -1) {
          missionIndex = -1;
          missionMarker.visible = false;
          notify("Objective abandoned.");
        }
        break;
      case "home-travel":
        if (validIndex(action.index, HOMES.length)) {
          const home = HOMES[action.index];
          if (placePlayer(home.x, home.z + 9)) notify(`Fast-travelled to the ${home.name}.`);
        }
        break;
      case "interact":
        if (!driving && health > 0) {
          if (insideHome === null) {
            const nearby = nearbyHomeIndex();
            if (nearby === null) { notify("Move closer to a guesthouse door to go inside."); break; }
            const home = HOMES[nearby];
            insideHome = nearby;
            interior.position.set(home.x, 0, home.z);
            interior.visible = true;
            avatar.position.set(home.x, 0, home.z + 6.2);
            heading = Math.PI;
            avatar.rotation.y = heading;
            footSpeed = 0;
            notify(`Welcome to the ${home.name}.`);
          } else {
            const home = HOMES[insideHome];
            interior.visible = false;
            avatar.position.set(home.x, 0, home.z + 8.2);
            heading = 0;
            avatar.rotation.y = heading;
            footSpeed = 0;
            insideHome = null;
            notify("Back outside.");
          }
        }
        break;
    }
    emitStats();
  }

  let pointerId: number | null = null;
  let pointerX = 0;
  let pointerY = 0;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerDragged = false;
  function pointerDown(event: PointerEvent) {
    if (paused || health <= 0 || event.button !== 0 || pointerId !== null) return;
    canvas.focus({ preventScroll: true });
    pointerId = event.pointerId;
    pointerX = pointerStartX = event.clientX;
    pointerY = pointerStartY = event.clientY;
    pointerDragged = false;
    canvas.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent) {
    if (paused || health <= 0 || event.pointerId !== pointerId) return;
    if (Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY) > 5) pointerDragged = true;
    if (!driving && pointerDragged) {
      heading -= (event.clientX - pointerX) * 0.006;
      aimPitch = THREE.MathUtils.clamp(aimPitch - (event.clientY - pointerY) * 0.004, -0.55, 0.65);
      avatar.rotation.y = heading;
    }
    pointerX = event.clientX;
    pointerY = event.clientY;
  }
  function pointerUp(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    // Captured pointers can end over an overlay or outside the game canvas.
    const shouldFire = !pointerDragged && !paused && document.elementFromPoint(event.clientX, event.clientY) === canvas;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    pointerId = null;
    if (shouldFire) command({ type: "fire" });
  }
  function pointerCancel() { pointerId = null; }
  const handledKeys = new Set(["w", "a", "s", "d", "space", "shift", "e", "r", "f", "c", "1", "2", "3", "4", "5", "6"]);
  function keyboard(event: KeyboardEvent) {
    const key = normalizeKey(event.key);
    if (!handledKeys.has(key)) return;
    if (event.type === "keyup") { keys.delete(key); return; }
    if (paused || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && target !== canvas && target.closest("input,textarea,select,button,a,[contenteditable=true],[role=dialog]")) return;
    event.preventDefault();
    command({ type: "input", key, pressed: true });
  }
  function visibilityChange() { if (document.hidden) clearInput(); lastTime = performance.now(); }
  function resize() {
    if (disposed) return;
    const width = Math.max(1, container.clientWidth || window.innerWidth);
    const height = Math.max(1, container.clientHeight || window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  window.addEventListener("resize", resize);
  window.addEventListener("keydown", keyboard);
  window.addEventListener("keyup", keyboard);
  window.addEventListener("blur", clearInput);
  document.addEventListener("visibilitychange", visibilityChange);
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerCancel);
  canvas.addEventListener("lostpointercapture", pointerCancel);
  resize();
  updateCamera(0, true);

  function simulate(dt: number) {
    elapsed += dt;
    for (const actor of remoteActors.values()) {
      const target = actor.userData.destination as THREE.Vector3;
      const moving = actor.position.distanceToSquared(target) > .002;
      actor.position.lerp(target, 1 - Math.exp(-dt * 14));
      actor.rotation.y = actor.userData.heading;
      // Clone keeps the same hip/knee hierarchy; animate remote walking without sharing transforms.
      actor.children.slice(1, 3).forEach((hip, i) => { hip.rotation.x = moving ? Math.sin(elapsed * 10 + i * Math.PI) * .45 : .12; });
    }
    oceanTime.value = elapsed;
    foam.position.y = Math.sin(elapsed * 0.8) * 0.035;
    gameMinutes = (gameMinutes + dt * 3) % 1440;
    if (health <= 0) return;
    messageRemaining = Math.max(0, messageRemaining - dt);
    if (messageRemaining === 0) message = "";
    recoil = THREE.MathUtils.damp(recoil, 0, 8, dt);
    fireCooldown = Math.max(0, fireCooldown - dt);
    if (reloadRemaining > 0) {
      reloadRemaining = Math.max(0, reloadRemaining - dt);
      if (reloadRemaining === 0) {
        ammo[weaponIndex] = WEAPONS[weaponIndex].capacity;
        notify(`${WEAPONS[weaponIndex].name} reloaded.`);
        audio.reloadComplete();
        emitStats();
      }
    }
    flashRemaining = Math.max(0, flashRemaining - dt);
    muzzle.visible = flashRemaining > 0;
    muzzleMaterial.opacity = flashRemaining / 0.09;
    let activeTrails = false;
    for (let i = 0; i < trailCount; i++) {
      if (trailRemaining[i] <= 0) continue;
      trailRemaining[i] = Math.max(0, trailRemaining[i] - dt);
      if (trailRemaining[i] === 0) {
        projectilePositions.fill(0, i * 6, i * 6 + 6);
        projectileGeometry.getAttribute("position").needsUpdate = true;
      } else activeTrails = true;
    }
    projectile.visible = activeTrails;
    for (const target of targets) {
      if (target.cooldown > 0) {
        target.cooldown = Math.max(0, target.cooldown - dt);
        target.mesh.rotation.z = Math.sin((1.7 - target.cooldown) * 14) * target.cooldown * 0.12;
        if (target.cooldown === 0) { target.mesh.scale.setScalar(1); target.mesh.rotation.z = 0; target.ring.material = ringColor; }
      }
    }
    const forward = Number(keys.has("w")) - Number(keys.has("s"));
    const turn = Number(keys.has("a")) - Number(keys.has("d"));
    const position = player();
    if (driving) {
      stamina = Math.min(100, stamina + dt * 14);
      const spec = VEHICLES[vehicleIndex];
      const onRoad = nearRoad(position.x, position.z, 0);
      const offroad = spec.shape === "offroad";
      const boost = keys.has("shift") && forward > 0;
      const maxSpeed = spec.speed / 3.6 * (onRoad ? 1 : offroad ? 0.82 : 0.56);
      const previousSpeed = speed;
      const braking = keys.has("space") || forward * speed < -0.1;
      if (braking) {
        const brakingForce = (onRoad ? 12 : 7) * dt;
        speed = Math.sign(speed) * Math.max(0, Math.abs(speed) - brakingForce);
      } else if (forward && fuel[vehicleIndex] > 0) {
        const powerFalloff = 1 - 0.42 * Math.min(1, Math.abs(speed) / maxSpeed);
        speed += forward * (boost ? 19 : 12) * powerFalloff * dt;
      } else speed = THREE.MathUtils.damp(speed, 0, 0.22 + Math.abs(speed) * 0.009 + (onRoad ? 0 : 0.55), dt);
      speed = THREE.MathUtils.clamp(speed, -12, maxSpeed * (boost ? 1.14 : 1));
      if (Math.abs(speed) < 0.03) speed = 0;
      steering = THREE.MathUtils.damp(steering, turn, 8, dt);
      const wheelbase = offroad ? 2.9 : 2.75;
      const steerAngle = steering * (0.48 / (1 + Math.abs(speed) * 0.022));
      const requestedYaw = speed * Math.tan(steerAngle) / wheelbase;
      const grip = (onRoad ? 9.2 : offroad ? 6.3 : 4.2) * (spec.handling / 88);
      const yawRate = THREE.MathUtils.clamp(requestedYaw, -grip / Math.max(Math.abs(speed), 1), grip / Math.max(Math.abs(speed), 1));
      const turnAngle = yawRate * dt;
      const distance = speed * dt;
      // Substeps keep a boosted car from tunneling through narrow building corners.
      const steps = Math.max(1, Math.ceil(Math.abs(distance) / 0.65));
      let traveled = 0;
      for (let i = 0; i < steps; i++) {
        const nextHeading = heading + turnAngle / steps;
        const x = position.x - Math.sin(nextHeading) * distance / steps;
        const z = position.z - Math.cos(nextHeading) * distance / steps;
        if (carBlocked(x, z, nextHeading)) {
          const impact = Math.abs(speed);
          speed = 0;
          if (impact > 8) {
            const damage = Math.min(100, Math.ceil((impact - 8) * 2.5));
            audio.impact((impact - 8) / 20);
            health = Math.max(0, health - damage);
            notify(health > 0 ? `Collision: -${damage} health. Slow down near obstacles.` : "Health depleted. Use Respawn to recover.");
            if (health <= 0) {
              clearInput();
              footSpeed = reloadRemaining = flashRemaining = 0;
              muzzle.visible = projectile.visible = false;
            }
          }
          break;
        }
        heading = nextHeading;
        traveled += distance / steps;
        position.set(x, 0, z);
      }
      const previousFuel = fuel[vehicleIndex];
      fuel[vehicleIndex] = Math.max(0, previousFuel - Math.abs(traveled) * 0.015);
      if (previousFuel > 0 && fuel[vehicleIndex] === 0 && health > 0) notify("Tank empty. Coast to a stop or tow to a petrol station.");
      car.rotation.y = heading;
      const acceleration = THREE.MathUtils.clamp((speed - previousSpeed) / dt, -15, 15);
      // Load transfer and surface vibration: visual chassis motion never changes collision coordinates.
      const chassis = carModels.get(vehicleIndex)!.model;
      chassis.rotation.x = THREE.MathUtils.damp(chassis.rotation.x, -acceleration * 0.003, 7, dt);
      chassis.rotation.z = THREE.MathUtils.damp(chassis.rotation.z, -yawRate * speed * (offroad ? 0.009 : 0.005), 6, dt);
      chassis.position.y = THREE.MathUtils.damp(chassis.position.y, Math.sin(position.z * 2.7 + position.x) * (onRoad ? 0.006 : 0.035) * Math.min(Math.abs(speed) / 8, 1), 16, dt);
      wheelPivots.forEach((wheel, index) => {
        const radius = Math.abs(steerAngle) > 0.001 ? wheelbase / Math.tan(steerAngle) : 1e6;
        wheel.rotation.y = index < 2 ? Math.atan(wheelbase / (radius - wheel.position.x)) : 0;
      });
      wheelRolls.forEach((wheel) => { wheel.rotation.x -= traveled / (offroad ? 0.525 : 0.43); });
      audio.setEngine(true, Math.abs(speed) / maxSpeed);
    } else {
      audio.setEngine(false, 0);
      heading += turn * 2.3 * dt;
      const canSprint = keys.has("shift") && stamina > 0.5;
      footSpeed = THREE.MathUtils.damp(footSpeed, forward * (canSprint ? 5.5 : 2.5), forward ? 7 : 10, dt);
      if (Math.abs(footSpeed) < 0.015) footSpeed = 0;
      const startX = position.x;
      const startZ = position.z;
      const steps = Math.max(1, Math.ceil(Math.abs(footSpeed * dt) / 0.1));
      for (let i = 0; i < steps; i++) {
        const x = position.x - Math.sin(heading) * footSpeed * dt / steps;
        const z = position.z - Math.cos(heading) * footSpeed * dt / steps;
        if (!blocked(x, position.z, 0.3) && !touchesCar(x, position.z)) position.x = x;
        if (!blocked(position.x, z, 0.3) && !touchesCar(position.x, z)) position.z = z;
      }
      verticalVelocity -= 9.81 * dt;
      avatar.position.y = Math.max(0, avatar.position.y + verticalVelocity * dt);
      if (avatar.position.y === 0) verticalVelocity = 0;
      avatar.rotation.y = heading;
      const traveled = Math.hypot(position.x - startX, position.z - startZ);
      const motionSign = Math.sign(footSpeed);
      footSpeed = dt > 0 ? traveled / dt * motionSign : 0;
      const moving = traveled > 0.0001;
      const running = Math.abs(footSpeed) > 3.2;
      if (canSprint && running) stamina = Math.max(0, stamina - dt * 20);
      else stamina = Math.min(100, stamina + dt * (running ? 6 : 14));
      gait += traveled * (running ? 2.8 : 3.8);
      if (moving) {
        const step = Math.floor(gait / Math.PI);
        if (step !== lastFootStep) { lastFootStep = step; audio.footstep(running); }
      } else lastFootStep = Math.floor(gait / Math.PI);
      const stride = Math.min(1, Math.abs(footSpeed) / (running ? 5.5 : 2.5));
      legs.forEach(({ hip, knee, ankle }, index) => {
        const phase = gait + index * Math.PI;
        const cycle = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
        const stance = cycle < 0.62;
        const t = stance ? cycle / 0.62 : (cycle - 0.62) / 0.38;
        const strideLength = (running ? 0.8 : 0.48) * stride;
        const footZ = moving ? (stance ? -0.5 + t : 0.5 - t) * strideLength * motionSign : 0;
        const lift = moving && !stance ? Math.sin(t * Math.PI) * (running ? 0.24 : 0.11) * stride : 0;
        const down = 0.765 - lift;
        const reach = Math.min(0.779, Math.hypot(down, footZ));
        const kneeAngle = Math.PI - Math.acos(THREE.MathUtils.clamp((0.4 ** 2 + 0.38 ** 2 - reach ** 2) / (2 * 0.4 * 0.38), -1, 1));
        const hipAngle = Math.acos(THREE.MathUtils.clamp((0.4 ** 2 + reach ** 2 - 0.38 ** 2) / (2 * 0.4 * reach), -1, 1)) - Math.atan2(footZ, down);
        hip.rotation.x = THREE.MathUtils.damp(hip.rotation.x, hipAngle, 24, dt);
        knee.rotation.x = THREE.MathUtils.damp(knee.rotation.x, -kneeAngle, 24, dt);
        ankle.rotation.x = -(hip.rotation.x + knee.rotation.x);

      });
      body.position.y = THREE.MathUtils.damp(body.position.y, 1.13 + (moving ? Math.cos(gait * 2) * 0.025 : Math.sin(elapsed * 1.8) * 0.003), 16, dt);
      body.rotation.z = THREE.MathUtils.damp(body.rotation.z, moving ? Math.sin(gait) * 0.025 : 0, 12, dt);
      body.rotation.y = THREE.MathUtils.damp(body.rotation.y, moving ? Math.sin(gait) * 0.055 : 0, 12, dt);
      body.rotation.x = THREE.MathUtils.damp(body.rotation.x, moving && running ? -0.07 : 0, 16, dt);
      const reloadPose = reloadRemaining > 0 ? Math.sin(Math.PI * reloadRemaining / WEAPONS[weaponIndex].reload) : 0;
      weapon.rotation.set(aimPitch + recoil - reloadPose * 0.65, 0, reloadPose * -0.35);
      arms.forEach(({ shoulder, side }) => {
        shoulder.position.z = moving ? Math.sin(gait + side * Math.PI / 2) * 0.018 : 0;
      });
      head.rotation.y = -body.rotation.y * 0.7;
      poseArms();
      car.rotation.z = THREE.MathUtils.damp(car.rotation.z, 0, 5, dt);
    }
    if (keys.has("f") && WEAPONS[weaponIndex].automatic) fire();
    if (missionIndex !== -1) {
      const target = MISSIONS[missionIndex];
      const distance = Math.hypot(position.x - target.x, position.z - target.z);
      const modeOk = (target.mode === "car" && driving) || (target.mode === "foot" && !driving);
      if (modeOk && distance < 6) {
        credits += target.reward;
        missionsCompleted++;
        notify(`Objective complete: ${target.name}. +${target.reward} credits.`);
        missionIndex = -1;
        missionMarker.visible = false;
      }
    }
    sun.position.set(position.x - 100, 170, position.z - 90);
    sun.target.position.set(position.x, 0, position.z);
    updateCamera(dt);
  }
  function frame(now: number) {
    if (disposed) return;
    const wallDelta = Math.max((now - lastTime) / 1000, 0);
    const dt = Math.min(wallDelta, 0.25);
    lastTime = now;
    // Bounded substeps preserve collision stability without slowing timers at low frame rates.
    if (!paused && !document.hidden) {
      const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
      for (let step = 0; step < steps; step++) simulate(dt / steps);
    }
    renderer.render(scene, camera);
    statsElapsed += wallDelta;
    if (!ready || statsElapsed >= 0.1) {
      statsElapsed %= 0.1;
      emitStats();
      if (disposed) return;
    }
    if (!ready) { ready = true; onReady(); }
    if (!disposed) frameId = requestAnimationFrame(frame);
  }
  frameId = requestAnimationFrame(frame);

  function renderPreview(model: THREE.Object3D, eye: [number, number, number], center: [number, number, number]) {
      const preview = new THREE.Scene(); preview.background = new THREE.Color("#142b2c"); preview.environment = scene.environment;
      model.position.set(0, 0, 0); model.rotation.set(0, 0, 0); model.visible = true; preview.add(model);
      preview.add(new THREE.HemisphereLight("#ecf4ff", "#545040", 2.2));
      const light = new THREE.DirectionalLight("#fff2dc", 4); light.position.set(4, 6, 3); preview.add(light);
      const rim = new THREE.DirectionalLight("#b0d8ff", 3); rim.position.set(-4, 3, -3); preview.add(rim);
      const lens = new THREE.PerspectiveCamera(36, 16 / 9, .1, 40); lens.position.set(...eye); lens.lookAt(...center);
      const target = new THREE.WebGLRenderTarget(640, 360);
      target.texture.colorSpace = THREE.SRGBColorSpace;
      const previous = renderer.getRenderTarget();
      try {
        renderer.setRenderTarget(target); renderer.render(preview, lens);
        const pixels = new Uint8Array(640 * 360 * 4); renderer.readRenderTargetPixels(target, 0, 0, 640, 360, pixels);
        const output = document.createElement("canvas"); output.width = 640; output.height = 360;
        const context = output.getContext("2d")!, data = context.createImageData(640, 360);
        for (let y = 0; y < 360; y++) data.data.set(pixels.subarray((359-y)*640*4,(360-y)*640*4),y*640*4);
        context.putImageData(data,0,0); return output.toDataURL("image/png");
      } finally { renderer.setRenderTarget(previous); target.dispose(); model.traverse(o => { if (o instanceof THREE.InstancedMesh) o.dispose(); }); preview.clear(); }
  }

  return {
    command,
    getVehiclePreview(index: number) {
      if (!validIndex(index, VEHICLES.length) || disposed) return "";
      if (!carModels.has(index)) { buildCar(index); buildCar(vehicleIndex); }
      return renderPreview(carModels.get(index)!.model.clone(true), [6.4, 3.1, -7.6], [0, .8, 0]);
    },
    getWeaponPreview(index: number) {
      if (!validIndex(index, WEAPONS.length) || disposed) return "";
      const model = weapon.clone(true);
      model.getObjectByName("long")!.visible = index > 0 && index < 5;
      model.getObjectByName("scope")!.visible = index === 4;
      model.getObjectByName("revolver")!.visible = index === 5;
      const tube = model.getObjectByName("barrel")!;
      tube.scale.y = [.16,.4,.34,.23,.6,.24][index];
      tube.scale.x = tube.scale.z = index === 2 ? .045 : .032;
      tube.position.z = -.22 - tube.scale.y / 2;
      return renderPreview(model, [1.25, .55, .7], [0, .03, -.2]);

    },
    dispose() {
      if (disposed) return;
      disposed = true;
      audio.dispose();
      cancelAnimationFrame(frameId);
      clearInput();
      resizeObserver.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keyboard);
      window.removeEventListener("keyup", keyboard);
      window.removeEventListener("blur", clearInput);
      document.removeEventListener("visibilitychange", visibilityChange);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerCancel);
      canvas.removeEventListener("lostpointercapture", pointerCancel);
      instances.forEach((object) => object.dispose());
      geometries.forEach((object) => object.dispose());
      materials.forEach((object) => object.dispose());
      textures.forEach((object) => object.dispose());
      carModels.clear();
      scene.environment = null;
      environment.dispose();
      sun.shadow.dispose();
      scene.clear();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
