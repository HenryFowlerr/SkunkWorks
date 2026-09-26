import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

function token(name, fallback) {
  return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function disposeModel(root) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

function showFallback(host, message, drawingHref) {
  host.replaceChildren();
  const fallback = document.createElement('div');
  fallback.className = 'qr-floor-model-fallback';
  const detail = document.createElement('p');
  detail.textContent = message;
  fallback.append(detail);
  if (drawingHref) {
    const drawing = document.createElement('a');
    drawing.href = drawingHref;
    drawing.textContent = 'Open released drawing';
    drawing.target = '_blank';
    drawing.rel = 'noopener';
    fallback.append(drawing);
  }
  host.append(fallback);
}

function isValidGlb(buffer) {
  if (buffer.byteLength < 20 || buffer.byteLength > 100 * 1024 * 1024) return false;
  const view = new DataView(buffer);
  return view.getUint32(0, true) === 0x46546c67 && view.getUint32(4, true) === 2 && view.getUint32(8, true) === buffer.byteLength;
}

function mount(host, { source, drawingHref = '' } = {}) {
  if (!host || !source) return { destroy() {}, reset() {} };

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    showFallback(host, '3D view is unavailable in this browser. Use the released drawing for this operation.', drawingHref);
    return { destroy() {}, reset() {} };
  }

  let disposed = false;
  let root = null;
  let observer = null;
  const controller = new AbortController();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(token('--ch-canvas-subtle', '#EEF0EB'));
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10000);
  const canvas = renderer.domElement;
  const status = document.createElement('p');
  const canvasHost = document.createElement('div');

  canvas.className = 'qr-floor-model-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Interactive product model. Drag with one finger to orbit. Pinch to zoom.');
  canvas.style.touchAction = 'none';
  canvasHost.className = 'qr-floor-model-canvas-host';
  canvasHost.append(canvas);
  status.className = 'qr-floor-model-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Loading released model…';
  host.replaceChildren(canvasHost, status);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0x767d77, 2.25);
  const key = new THREE.DirectionalLight(0xffffff, 2.55);
  const fill = new THREE.DirectionalLight(token('--ch-action-tint', '#E5F1F3'), 0.72);
  key.position.set(180, 220, 300);
  fill.position.set(-190, -110, 160);
  scene.add(hemisphere, key, fill);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.screenSpacePanning = true;

  const render = () => renderer.render(scene, camera);
  const resize = () => {
    if (!host.clientWidth || !host.clientHeight) return;
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
    render();
  };
  controls.addEventListener('change', render);
  observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const initial = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  const reset = () => {
    if (!root) return;
    camera.position.copy(initial.position);
    controls.target.copy(initial.target);
    controls.update();
    render();
  };

  const contextLost = (event) => {
    event.preventDefault();
    status.textContent = 'The graphics view was interrupted. Reload the page or use the released drawing.';
    status.classList.add('is-error');
  };
  canvas.addEventListener('webglcontextlost', contextLost);

  const load = async () => {
    try {
      const response = await fetch(source, { signal: controller.signal, credentials: 'omit', cache: 'force-cache' });
      if (!response.ok) throw new Error('The released model could not be retrieved.');
      const buffer = await response.arrayBuffer();
      if (!isValidGlb(buffer)) throw new Error('The released model is not a supported self-contained GLB.');
      const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
      if (disposed) {
        disposeModel(gltf.scene);
        return;
      }

      root = gltf.scene;
      const material = new THREE.MeshStandardMaterial({
        color: token('--ch-metal-mid', '#A7B5AC'),
        metalness: 0.18,
        roughness: 0.52,
      });
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) object.material = material.clone();
      });
      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const longestSide = Math.max(size.x, size.y, size.z);
      if (!Number.isFinite(longestSide) || longestSide <= 1e-9) throw new Error('The released model has no visible geometry.');
      const scale = 120 / longestSide;
      root.scale.setScalar(scale);
      root.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
      scene.add(root);
      const radius = size.length() * scale / 2;
      const fitDistance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.22;
      const defaultDirection = new THREE.Vector3(1.15, -1.2, 1.45).normalize();
      camera.position.copy(defaultDirection.multiplyScalar(fitDistance));
      camera.near = Math.max(radius / 500, 0.01);
      camera.far = radius * 50;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.minDistance = Math.max(radius * 0.95, 0.05);
      controls.maxDistance = radius * 7.5;
      controls.update();
      initial.position.copy(camera.position);
      initial.target.copy(controls.target);
      status.textContent = 'Drag to orbit · pinch to zoom';
      status.classList.add('is-ready');
      resize();
    } catch (error) {
      if (controller.signal.aborted || disposed) return;
      const message = error instanceof Error ? error.message : 'The released model could not be shown.';
      showFallback(host, `${message} Use the released drawing for this operation.`, drawingHref);
    }
  };
  void load();

  return {
    reset,
    destroy() {
      disposed = true;
      controller.abort();
      observer?.disconnect();
      controls.removeEventListener('change', render);
      controls.dispose();
      canvas.removeEventListener('webglcontextlost', contextLost);
      if (root) disposeModel(root);
      renderer.dispose();
      host.replaceChildren();
    },
  };
}

window.ChappeFloorModel = { mount };
window.dispatchEvent(new Event('chappe-floor-model-ready'));
