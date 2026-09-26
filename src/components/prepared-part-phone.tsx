"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import type { PreparedPart } from "@/features/prepared-demo/public-data";
import styles from "./prepared-part-phone.module.css";

type Reply = { question: string; answer: string };

const quickQuestions = [
  { label: "Dimensions", question: "What are the main dimensions?" },
  { label: "Where to drill", question: "Where should I drill the holes?" },
];

function localReply(question: string, part: PreparedPart): string {
  const q = question.toLowerCase();

  if (/(?:drill|hole|r3|r6)|(?:where.*(?:drill|hole))/.test(q)) return part.chatFacts.drilling;
  if (/dimension|size|length|height|width|thick|measure/.test(q)) return part.chatFacts.dimensions;
  if (/guide|step|operation|sequence|first|next|order|manufactur|make/.test(q)) return part.chatFacts.guide;
  if (/stl|model|geometry|unit|3d/.test(q)) return part.chatFacts.model;
  if (/revision|drawing id|part number|number|\brev\b/.test(q)) return `${part.drawingId}. ${part.revisionNote}`;
  if (/drawing|pdf|millimetre|millimeter|gd\s*&\s*t|tolerance/.test(q)) return `${part.sourceFacts[0]} ${part.sourceFacts[1]}`;
  if (/machine|facility|mill|lathe|waterjet|shop|manufacturer/.test(q)) return `${part.facility}. ${part.machine}.`;
  if (/material|stock|finish|edge|process|tool/.test(q)) return "The supplied source packet does not confirm material, finish, tooling, or process. Escalate to an engineer for confirmation.";

  return "I can answer basic questions about the Steel Bracket drawing, including its dimensions, circular features, and the demo manufacturing guide. For a real production decision, escalate to engineering.";
}

function createSourceMesh(stl: ArrayBuffer, groundY: number): THREE.Mesh {
  const geometry = new STLLoader().parse(stl);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();

  const bounds = geometry.boundingBox;
  if (!bounds) {
    geometry.dispose();
    throw new Error("The STL did not contain a visible bounding box.");
  }

  const size = bounds.getSize(new THREE.Vector3());
  const largestDimension = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(largestDimension) || largestDimension <= 0) {
    geometry.dispose();
    throw new Error("The STL did not contain visible geometry.");
  }

  geometry.center();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xb8c0c4, metalness: 0.78, roughness: 0.27, side: THREE.DoubleSide }),
  );
  const scale = 3.2 / largestDimension;
  mesh.scale.setScalar(scale);
  mesh.position.y = groundY + (size.y * scale) / 2;
  mesh.rotation.set(-0.22, -0.34, 0.04);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function PreparedPartPhone({ part }: { part: PreparedPart }) {
  const mount = useRef<HTMLDivElement>(null);
  const fallbackNotice = useRef<HTMLParagraphElement>(null);
  const guideDialog = useRef<HTMLDialogElement>(null);
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<Reply | null>(null);
  const [notice, setNotice] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    const element = mount.current;
    if (!element) return;

    const showFallback = (message: string) => {
      if (!fallbackNotice.current) return;
      fallbackNotice.current.textContent = message;
      fallbackNotice.current.hidden = false;
    };

    if (fallbackNotice.current) {
      fallbackNotice.current.textContent = "";
      fallbackNotice.current.hidden = true;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      showFallback("3D preview is unavailable on this device. The source PDF remains available in the engineering workspace.");
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    element.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(7.2, 5.1, 11.2);
    scene.add(new THREE.HemisphereLight(0xf8f4ef, 0x78818a, 2.15));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9db7e7, 2.3);
    rim.position.set(-5, 3, -4);
    scene.add(rim);

    const groundY = -1.02;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(3.9, 64), new THREE.ShadowMaterial({ opacity: 0.14 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = groundY;
    ground.receiveShadow = true;
    scene.add(ground);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.52, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.minDistance = 6;
    controls.maxDistance = 18;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = Math.PI * 0.48;

    const controller = new AbortController();
    let active = true;
    void fetch(part.modelStl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load STL (${response.status}).`);
        return response.arrayBuffer();
      })
      .then((stl) => {
        if (!active) return;
        try {
          scene.add(createSourceMesh(stl, groundY));
        } catch {
          showFallback("The supplied STL could not be displayed. Review the source PDF in the engineering workspace.");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) showFallback("The supplied STL could not be loaded. Review the source PDF in the engineering workspace.");
      });

    const resize = () => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      controls.update();
      renderer.render(scene, camera);
    };
    draw();

    return () => {
      active = false;
      controller.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === element) element.removeChild(renderer.domElement);
    };
  }, [part.modelStl]);

  function ask(text: string) {
    const normalized = text.trim();
    if (!normalized) return;
    setReply({ question: normalized, answer: localReply(normalized, part) });
    setQuestion("");
    setNotice("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    ask(question);
  }

  function openGuide() {
    const dialog = guideDialog.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    setGuideOpen(true);
  }

  function closeGuide() {
    guideDialog.current?.close();
  }

  return <main className={styles.screen}>
    <header className={styles.header}>
      <div className={styles.headCopy}><span className={styles.kicker}>Steel Bracket shop view</span><h1>{part.name}</h1></div>
      <div className={styles.headerActions}>
        <button type="button" className={styles.guideTrigger} aria-expanded={guideOpen} aria-controls="manufacturing-guide" onClick={openGuide}>Guide</button>
        <div className={styles.partId}><strong>{part.drawingId}</strong><span>REV {part.revision}</span></div>
      </div>
    </header>
    <div className={styles.modelStage} ref={mount} role="group" aria-label={`Interactive user-provided STL visual reference for ${part.name}. Drag to orbit and use the wheel or pinch to zoom.`}>
      <div className={styles.modelHint} aria-hidden="true"><span>DRAG TO ORBIT</span><i /> <span>PINCH TO ZOOM</span></div>
      <p className={styles.modelLabel}>{part.modelFileName} · USER-PROVIDED STL VISUAL REFERENCE · NOT A CONTROLLED MODEL</p>
      <p ref={fallbackNotice} className={styles.notice} role="status" hidden />
      {notice && <p className={styles.notice} role="status">{notice}</p>}
    </div>
    {reply && <section className={styles.reply} aria-live="polite" aria-label="Local source reply">
      <div className={styles.replyTitle}><span>LOCAL SOURCE REPLY · NOT SAVED</span><button type="button" onClick={() => setReply(null)} aria-label="Dismiss reply">×</button></div>
      <p className={styles.replyQuestion}>{reply.question}</p><p>{reply.answer}</p>
    </section>}
    <dialog id="manufacturing-guide" ref={guideDialog} className={styles.guideDialog} aria-labelledby="manufacturing-guide-title" aria-describedby="manufacturing-guide-summary" onClose={() => setGuideOpen(false)}>
      <div className={styles.guideDialogBar}>
        <span>Drawing-based demo guide</span>
        <button type="button" onClick={closeGuide}>Close <span aria-hidden="true">×</span></button>
      </div>
      <div className={styles.guideDialogContent}>
        <p className={styles.guideEyebrow}>Steel Bracket · local demo</p>
        <h2 id="manufacturing-guide-title">Review the source before each manufacturing decision.</h2>
        <p id="manufacturing-guide-summary" className={styles.guideSummary}>This source-grounded guide supports a manufacturing conversation. It does not approve a material, tool, setup, or process.</p>
        <ol className={styles.guideSteps}>{part.guideSteps.map((step) => <li key={step.number}>
          <span className={styles.guideNumber}>{step.number}</span>
          <div><h3>{step.title}</h3><p>{step.description}</p><small>{step.drawingReference}</small></div>
        </li>)}</ol>
      </div>
    </dialog>
    <div className={styles.composerArea}>
      <div className={styles.quickQuestions} aria-label="Steel Bracket demo questions">
        {quickQuestions.map((item) => <button key={item.label} type="button" onClick={() => ask(item.question)}>{item.label}</button>)}
      </div>
      <p className={styles.composerHint}>Ask about the drawing or model · replies use local drawing facts only</p>
      <form className={styles.composer} onSubmit={submit}>
        <button type="button" className={styles.mic} aria-label="Voice input unavailable" onClick={() => setNotice("Voice input is not connected in this demo.")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3m-4 0h8" /></svg>
        </button>
        <input value={question} onChange={(event) => setQuestion(event.target.value)} aria-label="Ask a question about the Steel Bracket drawing" placeholder="Ask about dimensions or drilling…" maxLength={240} />
        <button type="submit" className={styles.send} aria-label="Send question" disabled={!question.trim()}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 11 16-7-6 16-3-7-7-2Z" /><path d="m11 13 5-5" /></svg>
        </button>
      </form>
      <div className={styles.escalation}><span>LOCAL DEMO · NO HISTORY SAVED</span><button type="button" onClick={() => setNotice("Engineer has been notified. Please halt operations.")}>Escalate to engineer <span aria-hidden="true">↗</span></button></div>
    </div>
  </main>;
}
