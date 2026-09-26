'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { Button } from '@/components/ui';
import type { ModelViewerProps } from './signatures';
import styles from '../visualization.module.css';

const MAX_MODEL_BYTES = 100 * 1024 * 1024;

function disposeModel(root: THREE.Object3D): void {
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

/** Reject linked resources so a signed asset fetch cannot make GLTFLoader fetch arbitrary sidecars. */
function validateSelfContainedGlb(buffer: ArrayBuffer): void {
  if (buffer.byteLength < 20 || buffer.byteLength > MAX_MODEL_BYTES) {
    throw new Error('The supplied model has an unsupported file size.');
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) {
    throw new Error('The supplied model is not a valid binary glTF 2 file.');
  }

  let offset = 12;
  let document: Record<string, unknown> | null = null;
  while (offset + 8 <= buffer.byteLength) {
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
    if (chunkEnd > buffer.byteLength) throw new Error('The supplied model contains a truncated chunk.');
    if (chunkType === 0x4e4f534a) {
      try {
        document = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, chunkStart, chunkLength))) as Record<string, unknown>;
      } catch {
        throw new Error('The supplied model contains invalid glTF metadata.');
      }
      break;
    }
    offset = chunkEnd;
  }
  if (!document || typeof document.asset !== 'object' || document.asset === null
    || (document.asset as { version?: unknown }).version !== '2.0') {
    throw new Error('The supplied model is missing glTF 2 metadata.');
  }

  const linkedResources = [
    ...(Array.isArray(document.buffers) ? document.buffers : []),
    ...(Array.isArray(document.images) ? document.images : []),
  ];
  for (const resource of linkedResources) {
    if (typeof resource !== 'object' || resource === null || !('uri' in resource)) continue;
    const uri = (resource as { uri?: unknown }).uri;
    if (typeof uri !== 'string' || !uri.startsWith('data:')) {
      throw new Error('The supplied model links to a sidecar file. Only self-contained models are supported.');
    }
  }
}

function validateStl(buffer: ArrayBuffer): void {
  if (buffer.byteLength < 84 || buffer.byteLength > MAX_MODEL_BYTES) {
    throw new Error('The supplied STL has an unsupported file size.');
  }
  const bytes = new Uint8Array(buffer);
  const binaryView = new DataView(buffer);
  const triangleCount = binaryView.getUint32(80, true);
  const binarySize = 84 + triangleCount * 50;
  if (Number.isSafeInteger(binarySize) && binarySize === buffer.byteLength) return;
  const firstNonWhitespace = bytes.findIndex((byte) => ![9, 10, 13, 32].includes(byte));
  const asciiPrefix = new TextDecoder().decode(bytes.slice(firstNonWhitespace, firstNonWhitespace + 5)).toLowerCase();
  if (asciiPrefix !== 'solid') throw new Error('The supplied model is not a valid STL file.');
}

export function ModelViewerCanvas({ assetId, format, resolveAssetUrl, onError, variant = 'default' }: ModelViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const resolveAssetUrlRef = useRef(resolveAssetUrl);
  const onErrorRef = useRef(onError);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { resolveAssetUrlRef.current = resolveAssetUrl; }, [resolveAssetUrl]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      const message = 'WebGL is unavailable in this browser. The supplied model cannot be displayed here.';
      const frame = window.requestAnimationFrame(() => {
        setError(message);
        setStatus('error');
        onErrorRef.current?.(message);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    let disposed = false;
    let root: THREE.Object3D | null = null;
    let observer: ResizeObserver | null = null;
    const controller = new AbortController();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#f6f5f0');
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10000);
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x89857c, 2.2);
    scene.add(hemisphere);
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(1.5, 2.2, 3.4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc4dbee, 0.8);
    fill.position.set(-2.5, -1.2, 1.5);
    scene.add(fill);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.className = styles.canvas;
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('aria-label', `Interactive supplied ${format === 'stl' ? 'STL visual reference' : 'visual model'}. Drag to orbit; use the camera buttons to change view.`);
    host.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controlsRef.current = controls;

    const render = () => {
      controls.update();
      renderer.render(scene, camera);
    };
    const resize = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      renderer.setSize(host.clientWidth, host.clientHeight, false);
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      render();
    };
    resize();
    observer = new ResizeObserver(resize);
    observer.observe(host);
    renderer.setAnimationLoop(render);

    const contextLost = (event: Event) => {
      event.preventDefault();
      const message = 'The graphics context was interrupted. Reload the model view to try again.';
      setError(message);
      setStatus('error');
      onErrorRef.current?.(message);
    };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);

    const fail = (caught: unknown) => {
      if (disposed) return;
      const message = caught instanceof Error ? caught.message : 'The supplied model could not be loaded.';
      setError(message);
      setStatus('error');
      onErrorRef.current?.(message);
    };

    const load = async () => {
      try {
        setStatus('loading');
        setError(null);
        const url = await resolveAssetUrlRef.current(assetId);
        if (disposed) return;
        const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
        if (!response.ok) throw new Error('The model asset could not be retrieved. Request a fresh authorised model link.');
        const buffer = await response.arrayBuffer();
        let loadedRoot: THREE.Object3D;
        if (format === 'glb') {
          validateSelfContainedGlb(buffer);
          const loader = new GLTFLoader();
          const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
            loader.parse(buffer, '', (loaded) => resolve(loaded), reject);
          });
          loadedRoot = gltf.scene;
        } else {
          validateStl(buffer);
          const geometry = new STLLoader().parse(buffer);
          const positions = geometry.getAttribute('position');
          if (!positions || positions.count < 3) {
            geometry.dispose();
            throw new Error('The supplied STL has no visible geometry.');
          }
          geometry.computeVertexNormals();
          const material = new THREE.MeshStandardMaterial({ color: 0x8ba2b8, metalness: 0.48, roughness: 0.42 });
          const mesh = new THREE.Mesh(geometry, material);
          const group = new THREE.Group();
          group.add(mesh);
          loadedRoot = group;
        }
        if (disposed) {
          disposeModel(loadedRoot);
          return;
        }

        root = loadedRoot;
        const bounds = new THREE.Box3().setFromObject(root);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const longestSide = Math.max(size.x, size.y, size.z);
        if (!Number.isFinite(longestSide) || longestSide <= 1e-9) throw new Error('The supplied model has no visible geometry.');
        const scale = 120 / longestSide;
        root.scale.setScalar(scale);
        root.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        scene.add(root);
        const radius = Math.max(...size.toArray()) * scale / 2;
        camera.position.set(radius * 1.7, -radius * 1.8, radius * 2.1);
        camera.near = Math.max(radius / 500, 0.01);
        camera.far = radius * 50;
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.minDistance = Math.max(radius * 0.75, 0.05);
        controls.maxDistance = radius * 8;
        controls.update();
        resize();
        setStatus('ready');
      } catch (caught) {
        if (!controller.signal.aborted) fail(caught);
      }
    };
    void load();

    return () => {
      disposed = true;
      controller.abort();
      observer?.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.setAnimationLoop(null);
      controls.dispose();
      controlsRef.current = null;
      if (root) disposeModel(root);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [assetId, format]);

  const rotate = (horizontal: number, vertical: number) => {
    controlsRef.current?.rotateLeft(horizontal);
    controlsRef.current?.rotateUp(vertical);
    controlsRef.current?.update();
  };

  return (
    <section className={variant === 'immersive' ? `${styles.modelViewer} ${styles.modelViewerImmersive}` : styles.modelViewer} aria-label="Supplied visual model">
      <div className={styles.modelToolbar}>
        <span className={styles.sceneEyebrow}>Supplied {format === 'stl' ? 'STL visual reference' : 'visual model'} · original units preserved for display</span>
        <div className={styles.modelControls} aria-label="Model camera controls">
          <Button tone="quiet" small type="button" disabled={status !== 'ready'} onClick={() => rotate(Math.PI / 12, 0)} aria-label="Rotate model left">←</Button>
          <Button tone="quiet" small type="button" disabled={status !== 'ready'} onClick={() => rotate(-Math.PI / 12, 0)} aria-label="Rotate model right">→</Button>
        </div>
      </div>
      <div className={styles.modelViewport}>
        <div className={styles.modelCanvasHost} ref={hostRef} />
        {status === 'loading' ? <div className={styles.modelOverlay} role="status">Retrieving the authorised model…</div> : null}
        {status === 'error' ? <div className={styles.modelOverlay + ' ' + styles.modelError} role="alert">{error}</div> : null}
      </div>
      <p className={styles.modelNote}>This supplied {format === 'stl' ? 'STL' : 'visual'} model is for visual reference only. Use the released drawing and guide as the controlled work instructions.</p>
    </section>
  );
}
