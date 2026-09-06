import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { DISTRICTS, VEHICLES, WEAPONS, type GameCommand, type GameController, type GameStats } from "./config";

type Road = { ax: number; az: number; bx: number; bz: number; width: number };
type Collider = { minX: number; maxX: number; minZ: number; maxZ: number; height: number };
type Target = { mesh: THREE.Mesh; ring: THREE.Mesh; position: THREE.Vector3; cooldown: number };

export function createGame(
  container: HTMLElement,
  onStats: (stats: GameStats) => void,
  onReady: () => void,
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
  canvas.setAttribute("aria-label", "Kerala driving sandbox. WASD to move, E to exit, F to fire. Drag to aim on foot.");
  container.appendChild(canvas);

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
        const shade = (kind === "road" ? 165 : 205) + noise * (kind === "plaster" ? 30 : 48);
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
  function batch(shape: THREE.BufferGeometry, surface: THREE.Material, transforms: THREE.Matrix4[]) {
    const object = new THREE.InstancedMesh(shape, surface, transforms.length);
    transforms.forEach((matrix, index) => object.setMatrixAt(index, matrix));
    object.instanceMatrix.needsUpdate = true;
    object.computeBoundingSphere();
    instances.push(object);
    scene.add(object);
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

  const ground = mesh(plane, grass, 130, 0, -25, 540, 1950);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  const beach = mesh(plane, sand, -129, 0.012, -25, 22, 1950);
  beach.rotation.x = -Math.PI / 2;
  const oceanTime = { value: 0 };
  const oceanMat = paint("#3caeb1", 0.28, 0.18);
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
  for (let z = -980; z < 940; z += 17) {
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
  road(0, -960, 0, 890, 15);
  road(-101, -920, -101, 870, 11);
  road(246, -890, 246, 850, 12);
  for (const district of DISTRICTS) {
    road(-101, district.z, 246, district.z, 12);
    if (district.x !== 0) road(district.x, district.z - 54, district.x, district.z + 54, 14);
  }
  road(-101, -920, 246, -920, 12);
  road(-101, 870, 246, 870, 12);

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

  const colliders: Collider[] = [];
  const buildingMatrices: THREE.Matrix4[][] = [[], [], [], [], []];
  const roofMatrices: THREE.Matrix4[] = [];
  const windowMatrices: THREE.Matrix4[] = [];
  const trimMatrices: THREE.Matrix4[] = [];
  const frameMatrices: THREE.Matrix4[] = [];
  const doorMatrices: THREE.Matrix4[] = [];
  const roofDetails: THREE.Matrix4[] = [];
  const buildingColors = ["#eee5cd", "#bcd2c6", "#e6b99f", "#f3d28b", "#a9c4cb"];
  for (const district of DISTRICTS) {
    for (let i = 0; i < 22; i++) {
      const x = district.x + (random() - 0.5) * 180;
      const z = district.z + (random() - 0.5) * 108;
      const w = 6 + random() * 9;
      const depth = 6 + random() * 8;
      const height = 4 + Math.floor(random() * 3) * 3.2;
      if (x < -113 || x > 280 || nearRoad(x, z, Math.max(w, depth) * 0.72 + 4)) continue;
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
  const palmTrunk = geometry(new THREE.CylinderGeometry(0.16, 0.29, 1, 9, 12));
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
    if (nearRoad(x, z, 3) || colliders.some((c) => x > c.minX - 5 && x < c.maxX + 5 && z > c.minZ - 5 && z < c.maxZ + 5)) continue;
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
  batch(palmTrunk, wood, trunks);
  batch(leafGeometry, leaves, fronds);
  batch(sphere, green, coconuts);
  batch(circle, shadowMat, shadows);

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
    if (nearRoad(x, z, 10)) continue;
    shrubs.push(matrix(x, 0.8, z, 1.5 + random() * 2, 1 + random(), 1.5 + random() * 2));
  }
  batch(geometry(new THREE.IcosahedronGeometry(1, 0)), paint("#6b9f68"), shrubs);
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
    context.fillText("KERALA / FREE ROAM", 36, 54);
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

  const car = new THREE.Group();
  scene.add(car);
  const wheelGeometry = geometry(new THREE.CylinderGeometry(0.43, 0.43, 0.3, 18));
  wheelGeometry.rotateZ(Math.PI / 2); // Axle is local X; the vehicle points down local -Z.
  const rimGeometry = geometry(new THREE.CylinderGeometry(0.25, 0.25, 0.315, 10));
  rimGeometry.rotateZ(Math.PI / 2);
  const bodyPaint = VEHICLES.map((vehicle) => paint(vehicle.color, 0.3, 0.38));
  const wheelPivots: THREE.Group[] = [];
  const wheelRolls: THREE.Group[] = [];
  let vehicleIndex = 0;
  function buildCar(index: number) {
    car.clear();
    wheelPivots.length = 0;
    wheelRolls.length = 0;
    const spec = VEHICLES[index];
    const offroad = spec.shape === "offroad";
    const defender = spec.id === "defender";
    const luxury = spec.shape === "luxury";
    const sport = spec.shape === "sport";
    const length = luxury ? 5.4 : defender ? 5.3 : sport ? 4.5 : offroad ? 4.3 : 4.9;
    const width = offroad ? 2.15 : 2;
    const lift = offroad ? 0.3 : 0;
    const color = bodyPaint[index];
    mesh(box, dark, 0, 0.48 + lift, 0, width * 0.9, 0.24, length * 0.89, car);
    mesh(box, color, 0, 0.84 + lift, 0, width, 0.62, length, car);
    mesh(box, color, 0, 1.1 + lift, -length * 0.3, width * 0.97, 0.18, length * 0.36, car);
    const cabinHeight = defender ? 1.2 : offroad ? 1.03 : sport ? 0.64 : 0.82;
    const cabinLength = defender ? 3.35 : offroad ? 2.45 : sport ? 2.05 : 2.6;
    mesh(box, glass, 0, 1.16 + lift + cabinHeight / 2, 0.15, width * 0.86, cabinHeight, cabinLength, car);
    mesh(box, color, 0, 1.19 + lift + cabinHeight, 0.15, width * 0.9, 0.12, cabinLength + 0.04, car);
    for (const side of [-1, 1]) {
      mesh(box, color, side * width * 0.438, 1.2 + lift + cabinHeight / 2, 0.3, 0.055, cabinHeight, 0.14, car);
      mesh(box, color, side * (width / 2 + 0.12), 1.32 + lift, -0.75, 0.3, 0.17, 0.32, car);
      mesh(box, chrome, side * (width / 2 + 0.015), 1.03 + lift, 0.45, 0.035, 0.06, 0.25, car);
      mesh(box, headlight, side * width * 0.33, 0.94 + lift, -length / 2 - 0.025, 0.5, luxury ? 0.3 : 0.16, 0.055, car);
      mesh(box, red, side * width * 0.32, 0.95 + lift, length / 2 + 0.025, 0.52, 0.18, 0.055, car);
    }
    mesh(box, luxury ? chrome : dark, 0, 0.83 + lift, -length / 2 - 0.04, luxury ? 0.72 : 0.8, luxury ? 0.49 : 0.24, 0.07, car);
    mesh(box, chrome, 0, 0.62 + lift, length / 2 + 0.035, width * 0.88, 0.08, 0.1, car);
    if (sport) {
      mesh(box, dark, 0, 1.32, length * 0.42, width * 1.02, 0.1, 0.34, car);
      for (const side of [-1, 1]) mesh(box, dark, side * 0.65, 1.17, length * 0.42, 0.1, 0.3, 0.13, car);
    }
    if (luxury) {
      for (let i = -3; i <= 3; i++) mesh(box, dark, i * 0.085, 1.1, -length / 2 - 0.082, 0.024, 0.4, 0.01, car);
      mesh(sphere, chrome, 0, 1.35, -length * 0.41, 0.055, 0.13, 0.055, car);
    }
    if (offroad) {
      for (const side of [-1, 1]) {
        mesh(box, dark, side * 0.8, 1.42 + lift + cabinHeight, 0.2, 0.09, 0.13, cabinLength, car);
        for (const z of [-length * 0.31, length * 0.31]) {
          mesh(box, dark, side * width / 2, 1.04, z, 0.3, 0.18, 1.35, car);
        }
        if (defender) mesh(box, color, side * width * 0.438, 1.8, 1.05, 0.06, cabinHeight, 0.16, car);
      }
      if (defender) {
        for (const z of [-1, 0, 1]) mesh(box, dark, 0, 2.96, z, 1.7, 0.1, 0.12, car);
        mesh(box, sand, 0, 3.12, 0.65, 1.35, 0.3, 1.35, car);
      } else {
        for (const side of [-1, 1]) {
          mesh(sphere, headlight, side * 0.68, 1.25, -length / 2 - 0.06, 0.22, 0.22, 0.08, car);
        }
      }
      mesh(wheelGeometry, tire, 0, 1.25, length / 2 + 0.2, 1.15, 1.15, 1.15, car).rotation.y = Math.PI / 2;
      mesh(box, dark, 0, 0.77, -length / 2 - 0.2, width * 1.05, 0.25, 0.25, car);
    }
    const wheelScale = offroad ? 1.22 : 1;
    for (const z of [-length * 0.31, length * 0.31]) {
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * width / 2, 0.43 * wheelScale + 0.025, z);
        car.add(pivot);
        const roll = new THREE.Group();
        roll.scale.setScalar(wheelScale);
        pivot.add(roll);
        mesh(wheelGeometry, tire, 0, 0, 0, 1, 1, 1, roll);
        mesh(rimGeometry, chrome, 0, 0, 0, 1, 1, 1, roll);
        mesh(box, dark, side * 0.163, 0, 0, 0.015, 0.37, 0.06, roll);
        wheelPivots.push(pivot);
        wheelRolls.push(roll);
      }
    }
    car.traverse((child) => { if (child instanceof THREE.Mesh) { child.castShadow = true; child.receiveShadow = true; } });
  }
  buildCar(0);

  const avatar = new THREE.Group();
  scene.add(avatar);
  const skin = paint("#b8805c");
  const shirt = paint("#f0dfba");
  const trousers = paint("#284b55");
  mesh(box, shirt, 0, 1.22, 0, 0.62, 0.7, 0.35, avatar);
  mesh(sphere, skin, 0, 1.84, -0.025, 0.24, 0.28, 0.23, avatar);
  mesh(sphere, dark, 0, 2.02, 0.015, 0.245, 0.13, 0.23, avatar);
  const limbs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.18, 0.91, 0);
    avatar.add(leg);
    mesh(box, trousers, 0, -0.37, 0, 0.23, 0.73, 0.26, leg);
    mesh(box, dark, 0, -0.79, -0.08, 0.25, 0.16, 0.4, leg);
    limbs.push(leg);
    mesh(box, skin, side * 0.42, 1.18, -0.16, 0.2, 0.59, 0.23, avatar).rotation.x = -0.3;
  }
  mesh(box, dark, 0.42, 1.08, -0.52, 0.12, 0.15, 0.54, avatar);
  avatar.visible = false;
  avatar.traverse((child) => { if (child instanceof THREE.Mesh) child.castShadow = true; });

  const muzzleMaterial = material(new THREE.MeshBasicMaterial({ color: "#fff0aa", transparent: true, opacity: 0 }));
  const muzzle = mesh(sphere, muzzleMaterial, 0, 0, 0, 0.3, 0.3, 0.3);
  muzzle.visible = false;
  const projectileGeometry = geometry(new THREE.BufferGeometry());
  const projectilePositions = new Float32Array(6);
  projectileGeometry.setAttribute("position", new THREE.BufferAttribute(projectilePositions, 3));
  const projectileMaterial = material(new THREE.LineBasicMaterial({ color: "#fff0a4", transparent: true, opacity: 0.95, depthTest: true }));
  const projectile = new THREE.Line(projectileGeometry, projectileMaterial);
  projectile.frustumCulled = false;
  projectile.visible = false;
  scene.add(projectile);
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  const endpoint = new THREE.Vector3();
  const collisionBox = new THREE.Box3();
  const collisionPoint = new THREE.Vector3();

  let driving = true;
  let heading = 0;
  let speed = 0;
  let steering = 0;
  let cameraMode = 0;
  let weaponIndex = 0;
  const ammo: number[] = WEAPONS.map((weapon) => weapon.capacity);
  let hits = 0;
  let fireCooldown = 0;
  let reloadRemaining = 0;
  let flashRemaining = 0;
  let paused = false;
  let disposed = false;
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
  function emitStats() {
    const position = player();
    onStats({ speed: driving ? Math.round(Math.abs(speed) * 3.6) : 0, district: nearestDistrict(), driving, ammo: ammo[weaponIndex], hits, x: position.x, z: position.z });
  }
  function blocked(x: number, z: number, radius: number) {
    if (x < -136 + radius || x > 390 - radius || z < -985 + radius || z > 935 - radius) return true;
    return colliders.some((c) => {
      const closestX = THREE.MathUtils.clamp(x, c.minX, c.maxX);
      const closestZ = THREE.MathUtils.clamp(z, c.minZ, c.maxZ);
      return (x - closestX) ** 2 + (z - closestZ) ** 2 < radius * radius;
    });
  }

  const desiredCamera = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const smoothedLookAt = new THREE.Vector3(0, 1, -6);
  function updateCamera(dt: number, snap = false) {
    const position = player();
    const forwardX = -Math.sin(heading);
    const forwardZ = -Math.cos(heading);
    if (cameraMode === 2) {
      desiredCamera.set(position.x - forwardX * 5, 49, position.z - forwardZ * 12);
      lookAt.set(position.x + forwardX * 7, 0, position.z + forwardZ * 7);
    } else {
      const distance = driving ? (cameraMode === 1 ? 7 : 12.5) : (cameraMode === 1 ? 3.5 : 5.8);
      const height = driving ? (cameraMode === 1 ? 3.1 : 5.8) : 3;
      desiredCamera.set(position.x - forwardX * distance, height, position.z - forwardZ * distance);
      lookAt.set(position.x + forwardX * (driving ? 7 : 9), driving ? 1 : 1.6, position.z + forwardZ * (driving ? 7 : 9));
    }
    const factor = snap ? 1 : 1 - Math.exp(-dt * 6);
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
    car.position.set(x, 0, z);
    avatar.position.copy(car.position);
    if (!driving) {
      const nx = x + Math.cos(angle) * 3.2;
      const nz = z - Math.sin(angle) * 3.2;
      if (!blocked(nx, nz, 0.5)) avatar.position.set(nx, 0, nz);
    }
    car.rotation.set(0, angle, 0);
    avatar.rotation.set(0, angle, 0);
    heading = angle;
    speed = 0;
    clearInput();
    flashRemaining = 0;
    muzzle.visible = projectile.visible = false;
    updateCamera(0, true);
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
      if (distance >= nearestDistance || blocked(x, z, 2.35)) continue;
      nearestDistance = distance;
      nearestX = x;
      nearestZ = z;
      const angle = Math.atan2(-dx, -dz);
      nearestHeading = Math.cos(heading - angle) >= 0 ? angle : angle + Math.PI;
    }
    placePlayer(nearestX, nearestZ, nearestHeading);
  }
  function toggleDrive() {
    clearInput();
    speed = 0;
    if (driving) {
      avatar.position.copy(car.position);
      const offsets = [[3.2, 0], [-3.2, 0], [0, 4], [0, -4]];
      for (const [x, z] of offsets) {
        const nx = car.position.x + x * Math.cos(heading) + z * Math.sin(heading);
        const nz = car.position.z - x * Math.sin(heading) + z * Math.cos(heading);
        if (!blocked(nx, nz, 0.5)) { avatar.position.set(nx, 0, nz); break; }
      }
      avatar.rotation.y = heading;
    } else {
      heading = car.rotation.y;
    }
    driving = !driving;
    avatar.visible = !driving;
    updateCamera(0, true);
  }
  function fire() {
    if (paused || fireCooldown > 0 || reloadRemaining > 0 || ammo[weaponIndex] <= 0) return;
    ammo[weaponIndex]--;
    fireCooldown = WEAPONS[weaponIndex].cooldown;
    const position = player();
    direction.set(-Math.sin(heading), 0, -Math.cos(heading));
    origin.set(position.x, 2, position.z).addScaledVector(direction, driving ? 2.8 : 0.7);
    const range = weaponIndex === 2 ? 62 : weaponIndex === 1 ? 150 : 105;
    let best: Target | undefined;
    let bestScore = Math.cos(THREE.MathUtils.degToRad(15));
    for (const target of targets) {
      if (target.cooldown > 0) continue;
      scratch.copy(target.position).sub(origin);
      const distance = scratch.length();
      const alignment = scratch.normalize().dot(direction);
      if (distance < range && alignment > bestScore) { best = target; bestScore = alignment; }
    }
    if (best) direction.copy(best.position).sub(origin).normalize();
    raycaster.set(origin, direction);
    raycaster.far = range;
    let obstruction = range;
    for (const collider of colliders) {
      collisionBox.min.set(collider.minX, 0, collider.minZ);
      collisionBox.max.set(collider.maxX, collider.height, collider.maxZ);
      if (raycaster.ray.intersectBox(collisionBox, collisionPoint)) obstruction = Math.min(obstruction, origin.distanceTo(collisionPoint));
    }
    scene.updateMatrixWorld(true);
    const intersection = raycaster.intersectObjects(targetMeshes, false).find((hit) => {
      const target = targets.find((candidate) => candidate.mesh === hit.object);
      return target && target.cooldown <= 0;
    });
    endpoint.copy(origin).addScaledVector(direction, obstruction);
    if (intersection && intersection.distance < obstruction) {
      const target = targets.find((candidate) => candidate.mesh === intersection.object)!;
      hits++;
      target.cooldown = 1.7;
      target.mesh.scale.setScalar(0.7);
      target.ring.material = gold;
      endpoint.copy(intersection.point);
    }
    projectilePositions.set([origin.x, origin.y, origin.z, endpoint.x, endpoint.y, endpoint.z]);
    projectileGeometry.getAttribute("position").needsUpdate = true;
    muzzle.position.copy(origin);
    flashRemaining = 0.09;
    projectile.visible = true;
    muzzle.visible = true;
  }

  function normalizeKey(key: string) {
    const lower = key.toLowerCase();
    const aliases: Record<string, string> = {
      keyw: "w", keya: "a", keys: "s", keyd: "d", keye: "e", keyr: "r", keyf: "f", keyc: "c",
      arrowup: "w", arrowdown: "s", arrowleft: "a", arrowright: "d", up: "w", down: "s", left: "a", right: "d",
      " ": "space", spacebar: "space", shiftleft: "shift", shiftright: "shift", digit1: "1", digit2: "2", digit3: "3",
    };
    return aliases[lower] ?? lower;
  }
  const validIndex = (index: number, length: number) => Number.isInteger(index) && index >= 0 && index < length;
  function command(action: GameCommand) {
    if (disposed) return;
    if (action.type === "pause") {
      paused = action.value;
      clearInput();
      lastTime = performance.now();
      return;
    }
    if (action.type === "input") {
      const key = normalizeKey(action.key);
      if (!action.pressed) { keys.delete(key); return; }
      if (paused || keys.has(key)) return;
      keys.add(key);
      if (key === "e") command({ type: "toggle-drive" });
      else if (key === "r") command({ type: "reload" });
      else if (key === "f") fire();
      else if (key === "c") command({ type: "camera" });
      else if (["1", "2", "3"].includes(key)) command({ type: "weapon", index: Number(key) - 1 });
      return;
    }
    switch (action.type) {
      case "vehicle":
        if (validIndex(action.index, VEHICLES.length)) { vehicleIndex = action.index; buildCar(vehicleIndex); speed = 0; }
        break;
      case "travel":
        if (validIndex(action.index, DISTRICTS.length)) {
          const district = DISTRICTS[action.index];
          placePlayer(district.x, district.z);
        }
        break;
      case "weapon":
        if (validIndex(action.index, WEAPONS.length)) { weaponIndex = action.index; reloadRemaining = 0; }
        break;
      case "reset": resetToRoad(); break;
      case "toggle-drive": toggleDrive(); break;
      case "reload":
        if (!paused && reloadRemaining <= 0 && ammo[weaponIndex] < WEAPONS[weaponIndex].capacity) reloadRemaining = weaponIndex === 2 ? 1.25 : 0.9;
        break;
      case "fire": fire(); break;
      case "camera": cameraMode = (cameraMode + 1) % 3; updateCamera(0, true); break;
    }
  }

  let pointerId: number | null = null;
  let pointerX = 0;
  let pointerStartX = 0;
  let pointerStartY = 0;
  let pointerDragged = false;
  function pointerDown(event: PointerEvent) {
    if (paused || event.button !== 0 || pointerId !== null) return;
    canvas.focus({ preventScroll: true });
    pointerId = event.pointerId;
    pointerX = pointerStartX = event.clientX;
    pointerStartY = event.clientY;
    pointerDragged = false;
    canvas.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent) {
    if (paused || event.pointerId !== pointerId) return;
    if (Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY) > 5) pointerDragged = true;
    if (!driving && pointerDragged) {
      heading -= (event.clientX - pointerX) * 0.006;
      avatar.rotation.y = heading;
    }
    pointerX = event.clientX;
  }
  function pointerUp(event: PointerEvent) {
    if (event.pointerId !== pointerId) return;
    // Captured pointers can end over an overlay or outside the game canvas.
    const shouldFire = !pointerDragged && !paused && document.elementFromPoint(event.clientX, event.clientY) === canvas;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    pointerId = null;
    if (shouldFire) fire();
  }
  function pointerCancel() { pointerId = null; }
  const handledKeys = new Set(["w", "a", "s", "d", "space", "shift", "e", "r", "f", "c", "1", "2", "3"]);
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
    oceanTime.value = elapsed;
    foam.position.y = Math.sin(elapsed * 0.8) * 0.035;
    fireCooldown = Math.max(0, fireCooldown - dt);
    if (reloadRemaining > 0) {
      reloadRemaining -= dt;
      if (reloadRemaining <= 0) ammo[weaponIndex] = WEAPONS[weaponIndex].capacity;
    }
    if (keys.has("f")) fire();
    flashRemaining = Math.max(0, flashRemaining - dt);
    muzzle.visible = projectile.visible = flashRemaining > 0;
    muzzleMaterial.opacity = flashRemaining / 0.09;
    projectileMaterial.opacity = flashRemaining / 0.09;
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
      const spec = VEHICLES[vehicleIndex];
      const onRoad = nearRoad(position.x, position.z, 0);
      const offroad = spec.shape === "offroad";
      const boost = keys.has("shift") && forward > 0;
      const maxSpeed = spec.speed / 3.6 * (onRoad ? 1 : offroad ? 0.82 : 0.56);
      if (forward) speed += forward * (boost ? 19 : 12) * dt;
      else speed = THREE.MathUtils.damp(speed, 0, 0.65, dt);
      if (keys.has("space")) speed = THREE.MathUtils.damp(speed, 0, 7, dt);
      speed = THREE.MathUtils.clamp(speed, -12, maxSpeed * (boost ? 1.14 : 1));
      if (Math.abs(speed) < 0.03) speed = 0;
      steering = THREE.MathUtils.damp(steering, turn, 8, dt);
      heading += steering * Math.min(Math.abs(speed) / 7, 1) * (1.65 - Math.min(Math.abs(speed) / 75, 0.8)) * (spec.handling / 88) * Math.sign(speed) * dt;
      const distance = speed * dt;
      // Substeps keep a boosted car from tunneling through narrow building corners.
      const steps = Math.max(1, Math.ceil(Math.abs(distance) / 0.65));
      for (let i = 0; i < steps; i++) {
        const x = position.x - Math.sin(heading) * distance / steps;
        const z = position.z - Math.cos(heading) * distance / steps;
        if (blocked(x, z, 2.35)) { speed = 0; break; }
        position.set(x, 0, z);
      }
      car.rotation.y = heading;
      car.rotation.z = THREE.MathUtils.damp(car.rotation.z, -steering * Math.min(Math.abs(speed) / 45, 1) * 0.035, 5, dt);
      wheelPivots.forEach((wheel, index) => { wheel.rotation.y = index < 2 ? steering * 0.35 : 0; });
      wheelRolls.forEach((wheel) => { wheel.rotation.x -= speed * dt / (offroad ? 0.525 : 0.43); });
    } else {
      heading += turn * 2.3 * dt;
      const velocity = forward * (keys.has("shift") ? 9 : 5);
      const x = position.x - Math.sin(heading) * velocity * dt;
      const z = position.z - Math.cos(heading) * velocity * dt;
      if (!blocked(x, position.z, 0.45)) position.x = x;
      if (!blocked(position.x, z, 0.45)) position.z = z;
      avatar.rotation.y = heading;
      limbs.forEach((limb, index) => { limb.rotation.x = forward ? Math.sin(elapsed * (keys.has("shift") ? 14 : 9) + index * Math.PI) * 0.55 : 0; });
      car.rotation.z = THREE.MathUtils.damp(car.rotation.z, 0, 5, dt);
    }
    sun.position.set(position.x - 100, 170, position.z - 90);
    sun.target.position.set(position.x, 0, position.z);
    updateCamera(dt);
  }
  function frame(now: number) {
    if (disposed) return;
    const wallDelta = Math.max((now - lastTime) / 1000, 0);
    const dt = Math.min(wallDelta, 0.05);
    lastTime = now;
    if (!paused && !document.hidden) simulate(dt);
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

  return {
    command,
    dispose() {
      if (disposed) return;
      disposed = true;
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
      sun.shadow.dispose();
      scene.clear();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
