// Per-sheet undo/redo command stack for Plan Room takeoff operations.
// Pure data structures so the smoke tests can drive inverse-op logic without
// a browser. The workspace executes the inverse ops against the server and
// only commits a stack move after the server confirms — the stacks never
// disagree with persisted state.
//
// Undoable: add/delete measurement, vertex edits, label/waste/color/notes
// edits, link/unlink. Scale changes and estimate-row creation are excluded —
// they are server-side, multi-user operations recorded outside this stack.

export const TAKEOFF_UNDO_DEPTH = 50;

// Everything needed to recreate a deleted measurement from scratch.
export type TakeoffSnapshot = {
  estimate_id: string;
  plan_sheet_id: string;
  estimate_line_item_id: string | null;
  library_item_id: string | null;
  tool_type: "linear" | "area" | "count";
  label: string;
  unit: string;
  quantity: number;
  waste_pct: number;
  color: string;
  geometry: unknown;
  notes: string;
};

export type TakeoffUpdatePatch = Partial<
  Pick<
    TakeoffSnapshot,
    | "estimate_line_item_id"
    | "library_item_id"
    | "label"
    | "unit"
    | "quantity"
    | "waste_pct"
    | "color"
    | "geometry"
    | "notes"
  >
>;

export type TakeoffCommand =
  | { kind: "create"; measurementId: string; snapshot: TakeoffSnapshot }
  | { kind: "delete"; measurementId: string; snapshot: TakeoffSnapshot }
  | {
      kind: "update";
      measurementId: string;
      before: TakeoffUpdatePatch;
      after: TakeoffUpdatePatch;
    };

// The server operation that reverses (or replays) a command. "create" returns
// a fresh id; the caller must remap the stacks with remapTakeoffMeasurementId
// so later entries keep pointing at the live row.
export type TakeoffInverseOp =
  | { type: "delete"; measurementId: string }
  | { type: "create"; snapshot: TakeoffSnapshot; replacesId: string }
  | { type: "update"; measurementId: string; patch: TakeoffUpdatePatch };

export type TakeoffUndoStack = {
  undo: TakeoffCommand[];
  redo: TakeoffCommand[];
};

export const emptyTakeoffUndoStack = (): TakeoffUndoStack => ({ undo: [], redo: [] });

// A new user action invalidates the redo branch and trims the oldest entries
// past the depth limit.
export function pushTakeoffCommand(
  stack: TakeoffUndoStack,
  command: TakeoffCommand,
  depth = TAKEOFF_UNDO_DEPTH,
): TakeoffUndoStack {
  return {
    undo: [...stack.undo, command].slice(-depth),
    redo: [],
  };
}

export const peekUndoCommand = (stack: TakeoffUndoStack): TakeoffCommand | null =>
  stack.undo[stack.undo.length - 1] ?? null;

export const peekRedoCommand = (stack: TakeoffUndoStack): TakeoffCommand | null =>
  stack.redo[stack.redo.length - 1] ?? null;

// The server op that undoes a command.
export function undoOperationFor(command: TakeoffCommand): TakeoffInverseOp {
  if (command.kind === "create") {
    return { type: "delete", measurementId: command.measurementId };
  }
  if (command.kind === "delete") {
    return { type: "create", snapshot: command.snapshot, replacesId: command.measurementId };
  }
  return { type: "update", measurementId: command.measurementId, patch: command.before };
}

// The server op that replays a command after it was undone.
export function redoOperationFor(command: TakeoffCommand): TakeoffInverseOp {
  if (command.kind === "create") {
    return { type: "create", snapshot: command.snapshot, replacesId: command.measurementId };
  }
  if (command.kind === "delete") {
    return { type: "delete", measurementId: command.measurementId };
  }
  return { type: "update", measurementId: command.measurementId, patch: command.after };
}

// Server confirmed the undo: move the entry onto the redo branch.
export function commitUndo(stack: TakeoffUndoStack): TakeoffUndoStack {
  const command = peekUndoCommand(stack);
  if (!command) return stack;
  return { undo: stack.undo.slice(0, -1), redo: [...stack.redo, command] };
}

// Server confirmed the redo: move the entry back onto the undo branch.
export function commitRedo(stack: TakeoffUndoStack): TakeoffUndoStack {
  const command = peekRedoCommand(stack);
  if (!command) return stack;
  return { undo: [...stack.undo, command], redo: stack.redo.slice(0, -1) };
}

// The inverse mutation failed (the change already synced, permissions, etc.):
// drop the entry so the stack never disagrees with the server.
export function dropUndo(stack: TakeoffUndoStack): TakeoffUndoStack {
  return { undo: stack.undo.slice(0, -1), redo: stack.redo };
}

export function dropRedo(stack: TakeoffUndoStack): TakeoffUndoStack {
  return { undo: stack.undo, redo: stack.redo.slice(0, -1) };
}

// Recreating a measurement server-side mints a new id. Every remaining stack
// entry that referenced the old id must follow it.
export function remapTakeoffMeasurementId(
  stack: TakeoffUndoStack,
  oldId: string,
  newId: string,
): TakeoffUndoStack {
  const remap = (command: TakeoffCommand): TakeoffCommand =>
    command.measurementId === oldId ? { ...command, measurementId: newId } : command;
  return { undo: stack.undo.map(remap), redo: stack.redo.map(remap) };
}
