export { BendMapEditor } from './components/bend-map-editor';
export { BendScene } from './components/bend-scene';
export { ModelViewer } from './components/model-viewer';
export { GeometryError, HINGE_EDGE_TOLERANCE_MM, evaluatePose, transformPoint, validateSceneData } from './geometry/pose';
export type { BendMapEditorProps, BendSceneProps, ModelViewerProps, SceneData } from './components/signatures';
export type { Bend, Hinge, Id, Panel, PanelModel, Step, Vec2 } from '@/contracts';
