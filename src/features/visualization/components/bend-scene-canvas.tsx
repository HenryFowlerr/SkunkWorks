'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { Button } from '@/components/ui';
import type { Bend, Hinge, Panel } from '@/contracts';
import { evaluatePose } from '../geometry/pose';
import type { BendSceneProps } from './signatures';
import styles from '../visualization.module.css';

function panelShape(panel: Panel, thicknessMm: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const [first, ...rest] = panel.polygonMm;
  shape.moveTo(first[0], first[1]);
  for (const point of rest) shape.lineTo(point[0], point[1]);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thicknessMm, bevelEnabled: false, curveSegments: 1 });
  geometry.translate(0, 0, -thicknessMm / 2);
  return geometry;
}

function colorToken(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function BendSceneCanvas({
  data,
  completedStepCount,
  activeStepProgress,
  selectedBendId,
  interactive,
  reducedMotion = false,
  onBendSelect,
}: BendSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const onBendSelectRef = useRef(onBendSelect);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onBendSelectRef.current = onBendSelect;
  }, [onBendSelect]);

  useEffect(() => {
    const host = hostRef.current;
    const canvasHost = canvasHostRef.current;
    if (!host || !canvasHost) return undefined;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      const frame = window.requestAnimationFrame(() => {
        setError('WebGL is unavailable in this browser. Use the supplied drawing while the interactive diagram is unavailable.');
        setReady(false);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    let controls: OrbitControls | null = null;
    let observer: ResizeObserver | null = null;
    let frameCancel: (() => void) | null = null;
    let readyFrame = 0;
    const colors = {
      canvas: colorToken('--ch-canvas-subtle', '#EEF0EB'),
      schematicFill: colorToken('--ch-schematic-fill', '#E6ECE7'),
      schematicLine: colorToken('--ch-schematic-line', '#8B9B91'),
      metalMid: colorToken('--ch-metal-mid', '#A7B5AC'),
      metalDark: colorToken('--ch-metal-dark', '#68776E'),
      action: colorToken('--ch-action', '#155E75'),
    };
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(colors.canvas);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 10000);
    const shapeGroup = new THREE.Group();
    const panelMeshes: THREE.Mesh[] = [];
    const materials: THREE.Material[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    const bendByChildPanel = new Map<string, string>();
    const bendById = new Map<string, Bend>(data.bends.map((bend) => [bend.bendId, bend]));
    const hingeByBendId = new Map<string, Hinge>();
    const childPanelByHinge = new Map(data.panelModel.hinges.map((hinge) => [hinge.id, hinge.childPanelId]));
    const disposeArrowHelpers = () => {
      shapeGroup.traverse((object) => {
        if (!(object instanceof THREE.ArrowHelper)) return;
        object.line.geometry.dispose();
        (object.line.material as THREE.Material).dispose();
        object.cone.geometry.dispose();
        (object.cone.material as THREE.Material).dispose();
      });
    };
    const activeBendIds = new Set(
      data.steps.slice(0, completedStepCount).map((step) => step.bendId),
    );

    try {
      const poses = evaluatePose(data, completedStepCount, activeStepProgress);
      const selectedBend = selectedBendId ? bendById.get(selectedBendId) ?? null : null;
      const selectedHingeId = selectedBend?.hingeId ?? null;
      for (const bend of data.bends) {
        const hinge = data.panelModel.hinges.find((item) => item.id === bend.hingeId);
        if (hinge) {
          hingeByBendId.set(bend.bendId, hinge);
          bendByChildPanel.set(hinge.childPanelId, bend.bendId);
        }
      }

      scene.add(new THREE.HemisphereLight(0xffffff, 0x99958a, 2.1));
      const key = new THREE.DirectionalLight(0xffffff, 2.4);
      key.position.set(180, 260, 360);
      scene.add(key);
      const fill = new THREE.DirectionalLight(colors.schematicFill, 0.8);
      fill.position.set(-260, -120, 180);
      scene.add(fill);

      for (const panel of data.panelModel.panels) {
        const bendId = bendByChildPanel.get(panel.id);
        const isSelected = selectedBend?.hingeId !== null && selectedBend?.hingeId !== undefined
          && childPanelByHinge.get(selectedBend.hingeId) === panel.id;
        const isCompleted = bendId ? activeBendIds.has(bendId) : false;
        const material = new THREE.MeshStandardMaterial({
          color: isSelected ? colors.action : isCompleted ? colors.metalMid : colors.schematicFill,
          metalness: 0.19,
          roughness: 0.52,
          side: THREE.DoubleSide,
        });
        const geometry = panelShape(panel, data.panelModel.thicknessMm);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.fromArray(poses[panel.id]);
        mesh.userData.panelId = panel.id;
        shapeGroup.add(mesh);
        panelMeshes.push(mesh);
        materials.push(material);
        geometries.push(geometry);
      }

      for (const hinge of data.panelModel.hinges) {
        const bendId = data.bends.find((bend) => bend.hingeId === hinge.id)?.bendId;
        const pose = poses[hinge.parentPanelId];
        if (!pose) continue;
        const isSelected = hinge.id === selectedHingeId;
        const isCompleted = bendId ? activeBendIds.has(bendId) : false;
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(hinge.axisStartMm[0], hinge.axisStartMm[1], data.panelModel.thicknessMm / 2 + 0.15),
            new THREE.Vector3(hinge.axisEndMm[0], hinge.axisEndMm[1], data.panelModel.thicknessMm / 2 + 0.15),
          ]),
          new THREE.LineBasicMaterial({ color: isSelected ? colors.action : isCompleted ? colors.metalDark : colors.schematicLine }),
        );
        line.matrixAutoUpdate = false;
        line.matrix.fromArray(pose);
        shapeGroup.add(line);
        geometries.push(line.geometry);
        materials.push(line.material);
      }

      const root = data.panelModel.panels.find((panel) => panel.id === data.panelModel.rootPanelId);
      if (root) {
        const centroid = root.polygonMm.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0] as [number, number])
          .map((value) => value / root.polygonMm.length) as [number, number];
        const arrowLength = Math.max(10, Math.min(24, Math.max(...root.polygonMm.flatMap((point) => point.map(Math.abs))) * 0.12));
        shapeGroup.add(new THREE.ArrowHelper(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(centroid[0], centroid[1], data.panelModel.thicknessMm / 2 + 0.4),
          arrowLength,
          colors.action,
          arrowLength * 0.28,
          arrowLength * 0.16,
        ));
      }

      scene.add(shapeGroup);
      shapeGroup.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(shapeGroup);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      shapeGroup.position.sub(center);
      const radius = Math.max(size.x, size.y, size.z, 40);
      camera.position.set(radius * 1.55, -radius * 1.65, radius * 1.9);
      camera.lookAt(0, 0, 0);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableRotate = interactive;
      controls.enableZoom = interactive;
      controls.enablePan = interactive;
      controls.enableDamping = interactive && !reducedMotion;
      controls.dampingFactor = 0.08;
      controls.screenSpacePanning = true;
      controls.minDistance = radius * 0.9;
      controls.maxDistance = radius * 8;
      controls.target.set(0, 0, 0);
      controls.update();
      controlsRef.current = controls;

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.domElement.className = styles.canvas;
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute('aria-label', 'Interactive rigid-panel bend diagram. Drag to orbit; use the camera buttons to change view.');
      canvasHost.replaceChildren(renderer.domElement);

      const render = () => {
        controls?.update();
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
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(resize);
        observer.observe(host);
      } else {
        window.addEventListener('resize', resize);
        frameCancel = () => window.removeEventListener('resize', resize);
      }

      if (interactive) renderer.setAnimationLoop(render);
      const raycaster = new THREE.Raycaster();
      const pointer = new THREE.Vector2();
      let downAt: [number, number] | null = null;
      const pointerDown = (event: PointerEvent) => { downAt = [event.clientX, event.clientY]; };
      const pointerUp = (event: PointerEvent) => {
        if (!interactive || !downAt || Math.hypot(event.clientX - downAt[0], event.clientY - downAt[1]) > 5) return;
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(panelMeshes, false)[0];
        const panelId = hit?.object.userData.panelId as string | undefined;
        const bendId = panelId ? bendByChildPanel.get(panelId) : undefined;
        if (bendId) onBendSelectRef.current?.(bendId);
        downAt = null;
      };
      renderer.domElement.addEventListener('pointerdown', pointerDown);
      renderer.domElement.addEventListener('pointerup', pointerUp);
      readyFrame = window.requestAnimationFrame(() => {
        setError(null);
        setReady(true);
      });

      return () => {
        renderer.domElement.removeEventListener('pointerdown', pointerDown);
        renderer.domElement.removeEventListener('pointerup', pointerUp);
        observer?.disconnect();
        frameCancel?.();
        window.cancelAnimationFrame(readyFrame);
        renderer.setAnimationLoop(null);
        controls?.dispose();
        controlsRef.current = null;
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
        disposeArrowHelpers();
        renderer.dispose();
        canvasHost.replaceChildren();
      };
    } catch (caught) {
      controls?.dispose();
      controlsRef.current = null;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      disposeArrowHelpers();
      renderer.dispose();
      const message = caught instanceof Error ? caught.message : 'The bend diagram could not be drawn.';
      const frame = window.requestAnimationFrame(() => {
        setError(message);
        setReady(false);
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [data, completedStepCount, activeStepProgress, selectedBendId, interactive, reducedMotion]);

  const selected = selectedBendId ? data.bends.find((bend) => bend.bendId === selectedBendId) : null;
  const selectedAngle = selected?.finishedAngle.value;
  const selectedTarget = selectedAngle !== null && selectedAngle !== undefined
    ? String(selectedAngle.degrees) + '° ' + selectedAngle.convention.replace('_', ' ')
    : selected ? 'Target angle not established' : 'Select a bend to inspect';
  const activeIndex = Math.min(completedStepCount + (completedStepCount < data.steps.length ? 1 : 0), data.steps.length);

  const rotate = (horizontal: number, vertical: number) => {
    if (!controlsRef.current) return;
    controlsRef.current.rotateLeft(horizontal);
    controlsRef.current.rotateUp(vertical);
    controlsRef.current.update();
  };

  return (
    <section className={styles.scene} aria-label="Bend diagram preview">
      <div className={styles.sceneToolbar}>
        <div>
          <p className={styles.sceneEyebrow}>Rigid-panel bend diagram</p>
          <p className={styles.sceneReadout}>
            {activeIndex === 0 ? 'Before first bend' : activeIndex >= data.steps.length ? 'After final bend' : 'Step ' + activeIndex + ' of ' + data.steps.length}
            {selectedBendId ? ' · Bend ' + selectedBendId : ''}
          </p>
        </div>
        <div className={styles.sceneControls} aria-label="Diagram camera controls">
          <Button tone="quiet" small type="button" disabled={!ready || !interactive} onClick={() => rotate(Math.PI / 12, 0)} aria-label="Rotate diagram left">←</Button>
          <Button tone="quiet" small type="button" disabled={!ready || !interactive} onClick={() => rotate(-Math.PI / 12, 0)} aria-label="Rotate diagram right">→</Button>
        </div>
      </div>
      <div className={styles.sceneViewport} ref={hostRef}>
        <div className={styles.sceneCanvasHost} ref={canvasHostRef} />
        {!ready && !error ? <div className={styles.scenePlaceholder} role="status">Preparing authored panel geometry…</div> : null}
        {error ? <div className={styles.sceneError} role="alert">{error}</div> : null}
      </div>
      <div className={styles.sceneCaption}>
        <span className={styles.referenceMarker}><span aria-hidden="true">↑</span> Reference face (+Z): {data.panelModel.referenceFaceLabel}</span>
        <span>{selectedTarget}</span>
        {!data.panelModel.reviewed ? <span className={styles.reviewNotice}>Unreviewed mapping</span> : null}
      </div>
      <p className={styles.sceneLimit}>Schematic only: rigid panels; no bend radius, springback, tool collision or press motion.</p>
    </section>
  );
}
