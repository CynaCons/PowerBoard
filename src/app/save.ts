/**
 * Saving and opening the standalone file.
 *
 * Save: the File System Access API (`showSaveFilePicker` the first time, then
 * the kept handle), falling back to a plain download in browsers without it —
 * the opened file is one self-contained `PowerBoard.html` (REQ-PB-113).
 *
 * Open: pick a `.html` file, read its embedded data script and load it
 * (REQ-PB-114). Autosave runs 2 s after the last change once a file is bound.
 */

import type { PowerBoardFile } from '../contract';
import { buildHtml, readEmbeddedHtml } from './fileFormat';
import { useAppStore } from './store';

const AUTOSAVE_DEBOUNCE_MS = 2000;

interface PickerWindow {
  showSaveFilePicker?(options?: unknown): Promise<FileSystemFileHandle>;
  showOpenFilePicker?(options?: unknown): Promise<FileSystemFileHandle[]>;
}

function pickers(): PickerWindow {
  return window as unknown as PickerWindow;
}

/** Whether the File System Access API is available in this browser. */
export function isFSASupported(): boolean {
  return typeof window !== 'undefined'
    && typeof pickers().showSaveFilePicker === 'function'
    && typeof pickers().showOpenFilePicker === 'function';
}

/** The handle of the file being edited; kept for this session only. */
let currentHandle: FileSystemFileHandle | null = null;

const HTML_PICKER_TYPES = [
  { description: 'PowerBoard file', accept: { 'text/html': ['.html'] } },
];

function suggestFileName(file: PowerBoardFile, fileName?: string): string {
  if (fileName) return fileName.toLowerCase().endsWith('.html') ? fileName : `${fileName}.html`;
  const base = (file.title || 'PowerBoard').replace(/[^a-zA-Z0-9_\- ]/g, '_').trim();
  return `${base || 'PowerBoard'}.html`;
}

/**
 * The HTML the saved file is built from. In production the running document
 * already holds the inlined app (REQ-PB-110); in Vite dev the single-file
 * template is fetched from the build output.
 */
async function templateHtml(): Promise<string> {
  const env = (import.meta as { env?: { DEV?: boolean } }).env;
  if (env?.DEV) {
    try {
      const response = await fetch('/dist-app/PowerBoard.html');
      if (response.ok) return await response.text();
    } catch {
      // fall through to the live document
    }
  }
  return document.documentElement.outerHTML;
}

interface PermissionHandle extends FileSystemFileHandle {
  queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

async function verifyPermission(handle: FileSystemFileHandle): Promise<boolean> {
  const target = handle as PermissionHandle;
  try {
    if (target.queryPermission) {
      const state = await target.queryPermission({ mode: 'readwrite' });
      if (state === 'granted') return true;
      if (!target.requestPermission) return false;
    }
    if (target.requestPermission) {
      return (await target.requestPermission({ mode: 'readwrite' })) === 'granted';
    }
    return true;
  } catch {
    return false;
  }
}

async function writeToHandle(handle: FileSystemFileHandle, html: string): Promise<boolean> {
  try {
    if (!(await verifyPermission(handle))) return false;
    const writable = await handle.createWritable();
    await writable.write(html);
    await writable.close();
    return true;
  } catch (error) {
    console.warn('[PowerBoard] could not write the file:', error);
    return false;
  }
}

function downloadFile(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function pickAndWrite(html: string, suggestedName: string): Promise<FileSystemFileHandle | null> {
  const showSaveFilePicker = pickers().showSaveFilePicker;
  if (!showSaveFilePicker) return null;
  try {
    const handle = await showSaveFilePicker({
      suggestedName,
      types: HTML_PICKER_TYPES,
    });
    return (await writeToHandle(handle, html)) ? handle : null;
  } catch (error) {
    if ((error as { name?: string } | null)?.name !== 'AbortError') {
      console.warn('[PowerBoard] save picker failed:', error);
    }
    return null;
  }
}

/**
 * Save the whole app and its data into the opened file. First save (or an
 * explicit Save As) asks for a location; later saves overwrite it. Without the
 * File System Access API the file is downloaded instead.
 */
export async function saveNow(forceSaveAs = false): Promise<boolean> {
  const { file, fileName } = useAppStore.getState();
  const html = buildHtml(await templateHtml(), file);
  const suggestedName = suggestFileName(file, fileName);

  if (!isFSASupported()) {
    downloadFile(html, suggestedName);
    useAppStore.getState().markSaved(suggestedName);
    return true;
  }

  let handle = forceSaveAs ? null : currentHandle;
  if (handle && !(await writeToHandle(handle, html))) handle = null;
  if (!handle) {
    handle = await pickAndWrite(html, suggestedName);
    if (!handle) return false; // cancelled
  }

  currentHandle = handle;
  useAppStore.getState().markSaved(handle.name);
  return true;
}

async function pickFileWithInput(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,text/html';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      const picked = input.files?.[0];
      input.remove();
      if (!picked) {
        resolve(null);
        return;
      }
      picked
        .text()
        .then((text) => resolve({ name: picked.name, text }))
        .catch(() => resolve(null));
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}

/**
 * Open a PowerBoard.html written by this app (or an older version) and load
 * its boards unchanged (REQ-PB-114).
 */
export async function openNow(): Promise<boolean> {
  let picked: { name: string; text: string } | null = null;

  if (isFSASupported()) {
    const showOpenFilePicker = pickers().showOpenFilePicker;
    try {
      const [handle] = (await showOpenFilePicker!({ types: HTML_PICKER_TYPES, multiple: false })) ?? [];
      if (!handle) return false;
      picked = { name: handle.name, text: await (await handle.getFile()).text() };
      currentHandle = handle;
    } catch (error) {
      if ((error as { name?: string } | null)?.name !== 'AbortError') {
        console.warn('[PowerBoard] open picker failed:', error);
      }
      return false;
    }
  } else {
    picked = await pickFileWithInput();
  }

  if (!picked) return false;
  const file = readEmbeddedHtml(picked.text);
  if (!file) {
    console.warn('[PowerBoard] that file has no PowerBoard data');
    return false;
  }

  useAppStore.getState().setFile(file);
  useAppStore.getState().markSaved(picked.name);
  return true;
}

/**
 * Autosave 2 s after the last change, once a file is bound to this session
 * (after the first save or after opening a file). Returns a cleanup function.
 */
export function startAutoSave(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (state.file === previous.file) return;
    if (!state.dirty || !currentHandle) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void saveNow();
    }, AUTOSAVE_DEBOUNCE_MS);
  });

  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}
