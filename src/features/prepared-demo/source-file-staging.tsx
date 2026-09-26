"use client";

import { useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import styles from "./source-file-staging.module.css";

type StagedFile = {
  id: string;
  name: string;
  size: number;
  kind: "Drawing PDF" | "STEP CAD file" | "STL visual reference";
};

function fileKind(filename: string): StagedFile["kind"] | null {
  const extension = filename.toLowerCase().slice(filename.lastIndexOf("."));

  if (extension === ".pdf") return "Drawing PDF";
  if (extension === ".step" || extension === ".stp") return "STEP CAD file";
  if (extension === ".stl") return "STL visual reference";
  return null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SourceFileStaging() {
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = useId();
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [notice, setNotice] = useState("");

  function stageFiles(selectedFiles: File[]) {
    const accepted: StagedFile[] = [];
    const rejected: string[] = [];

    for (const file of selectedFiles) {
      const kind = fileKind(file.name);
      if (!kind) {
        rejected.push(file.name);
        continue;
      }

      accepted.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        name: file.name,
        size: file.size,
        kind,
      });
    }

    if (accepted.length) {
      setFiles((current) => {
        const known = new Set(current.map((file) => file.id));
        return [...current, ...accepted.filter((file) => !known.has(file.id))];
      });
    }

    if (rejected.length) {
      setNotice(`${rejected.join(", ")} ${rejected.length === 1 ? "is" : "are"} not staged. Choose a PDF, STEP, STP, or STL file.`);
    } else if (accepted.length) {
      setNotice(`${accepted.length} ${accepted.length === 1 ? "file is" : "files are"} staged locally in this browser.`);
    }
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    stageFiles(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = "";
  }

  function dragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(true);
  }

  function dropFiles(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    stageFiles(Array.from(event.dataTransfer.files));
  }

  function removeFile(id: string) {
    setFiles((current) => current.filter((file) => file.id !== id));
    setNotice("File removed from local staging.");
  }

  return <section className={styles.staging} aria-labelledby="source-staging-title">
    <div className={styles.heading}>
      <div>
        <p className={styles.eyebrow}>New source packet</p>
        <h2 id="source-staging-title">Stage drawing and CAD files</h2>
      </div>
      <span className={styles.count}>{String(files.length).padStart(2, "0")} staged locally</span>
    </div>
    <p className={styles.intro}>Drop a technical drawing or CAD reference here to show where a new engineering handoff begins. This public demo keeps selections in this browser only; it does not upload, save, or attach files to Steel Bracket.</p>
    <div
      className={`${styles.dropzone} ${isDragging ? styles.dragging : ""}`}
      onDragOver={dragOver}
      onDragLeave={() => setIsDragging(false)}
      onDrop={dropFiles}
    >
      <div className={styles.dropMark} aria-hidden="true">+</div>
      <div className={styles.dropCopy}>
        <strong>Drop source files here</strong>
        <span id={hintId}>Accepted: PDF drawings, STEP or STP CAD files, and STL visual references.</span>
      </div>
      <button type="button" className={styles.chooseButton} onClick={() => input.current?.click()}>Choose files</button>
      <input
        ref={input}
        id={inputId}
        className={styles.fileInput}
        type="file"
        multiple
        accept=".pdf,.step,.stp,.stl,application/pdf,model/stl"
        aria-label="Select files for local source staging"
        aria-describedby={hintId}
        onChange={selectFiles}
      />
    </div>
    <p className={styles.localNote}><span aria-hidden="true">●</span> Demo staging only · files remain on this device until this page is closed or refreshed.</p>
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {files.length ? <ul className={styles.fileList} aria-label="Locally staged source files">
      {files.map((file) => <li key={file.id}>
        <div>
          <strong>{file.name}</strong>
          <span>{file.kind} · {formatFileSize(file.size)} · staged locally</span>
        </div>
        <button type="button" onClick={() => removeFile(file.id)} aria-label={`Remove ${file.name} from local staging`}>Remove</button>
      </li>)}
    </ul> : null}
  </section>;
}
