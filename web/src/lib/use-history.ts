"use client";

import { useCallback, useEffect, useState } from "react";

/** A value with undo/redo. `set` changes without a step (e.g. during a drag); call `remember` once before such a change. */
export function useHistory<T>(initial: T) {
  const [state, setState] = useState({ past: [] as T[], value: initial, future: [] as T[] });
  const set = useCallback((update: (value: T) => T) => setState(s => ({ ...s, value: update(s.value) })), []);
  const remember = useCallback(() => setState(s => ({ past: [...s.past.slice(-99), s.value], value: s.value, future: [] })), []);
  const change = useCallback((update: (value: T) => T) => setState(s => ({ past: [...s.past.slice(-99), s.value], value: update(s.value), future: [] })), []);
  const undo = useCallback(() => setState(s => s.past.length ? { past: s.past.slice(0, -1), value: s.past.at(-1)!, future: [s.value, ...s.future] } : s), []);
  const redo = useCallback(() => setState(s => s.future.length ? { past: [...s.past, s.value], value: s.future[0], future: s.future.slice(1) } : s), []);
  const reset = useCallback((value: T) => setState({ past: [], value, future: [] }), []);
  return { value: state.value, set, remember, change, undo, redo, reset, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}
export type History<T> = ReturnType<typeof useHistory<T>>;

/** Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo, except while typing in a text box (which keeps its own undo). */
export function useUndoKeys(undo: () => void, redo: () => void) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName)) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if (key === "y") { event.preventDefault(); redo(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);
}
