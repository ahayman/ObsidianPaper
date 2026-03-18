import type { Stroke } from "../types";

export type UndoActionType = "add-stroke" | "add-strokes" | "remove-stroke" | "remove-strokes" | "transform-strokes" | "modify-strokes";

export interface AddStrokeAction {
  type: "add-stroke";
  stroke: Stroke;
}

export interface AddStrokesAction {
  type: "add-strokes";
  strokes: Stroke[];
}

export interface RemoveStrokeAction {
  type: "remove-stroke";
  stroke: Stroke;
  index: number;
}

export interface RemoveStrokesAction {
  type: "remove-strokes";
  strokes: { stroke: Stroke; index: number }[];
}

export interface TransformStrokesAction {
  type: "transform-strokes";
  entries: { strokeId: string; before: Stroke; after: Stroke }[];
}

export interface ModifyStrokesAction {
  type: "modify-strokes";
  entries: { strokeId: string; before: Stroke; after: Stroke }[];
}

export type UndoAction =
  | AddStrokeAction
  | AddStrokesAction
  | RemoveStrokeAction
  | RemoveStrokesAction
  | TransformStrokesAction
  | ModifyStrokesAction;

export class UndoManager {
  private undoStack: UndoAction[] = [];
  private redoStack: UndoAction[] = [];

  /**
   * Record a stroke addition (for undo, we'd remove it).
   */
  pushAddStroke(stroke: Stroke): void {
    this.undoStack.push({ type: "add-stroke", stroke });
    this.redoStack = [];
  }

  /**
   * Record a batch stroke addition (for undo, we'd remove them all).
   */
  pushAddStrokes(strokes: Stroke[]): void {
    this.undoStack.push({ type: "add-strokes", strokes });
    this.redoStack = [];
  }

  /**
   * Record a stroke removal (for undo, we'd restore it at its original index).
   */
  pushRemoveStroke(stroke: Stroke, index: number): void {
    this.undoStack.push({ type: "remove-stroke", stroke, index });
    this.redoStack = [];
  }

  /**
   * Record removal of multiple strokes (batch erase).
   */
  pushRemoveStrokes(strokes: { stroke: Stroke; index: number }[]): void {
    this.undoStack.push({ type: "remove-strokes", strokes });
    this.redoStack = [];
  }

  /**
   * Record a spatial transform (move/resize) of strokes.
   * Stores full before/after data for precise undo.
   */
  pushTransformStrokes(entries: { strokeId: string; before: Stroke; after: Stroke }[]): void {
    this.undoStack.push({ type: "transform-strokes", entries });
    this.redoStack = [];
  }

  /**
   * Record a property modification (color/pen/width) of strokes.
   * Stores full before/after data for precise undo.
   */
  pushModifyStrokes(entries: { strokeId: string; before: Stroke; after: Stroke }[]): void {
    this.undoStack.push({ type: "modify-strokes", entries });
    this.redoStack = [];
  }

  /**
   * Undo the last action. Returns the action to reverse, or null if nothing to undo.
   * The caller is responsible for actually mutating the document.
   */
  undo(): UndoAction | null {
    const action = this.undoStack.pop();
    if (!action) return null;
    this.redoStack.push(action);
    return action;
  }

  /**
   * Redo the last undone action. Returns the action to replay, or null if nothing to redo.
   * The caller is responsible for actually mutating the document.
   */
  redo(): UndoAction | null {
    const action = this.redoStack.pop();
    if (!action) return null;
    this.undoStack.push(action);
    return action;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  get undoSize(): number {
    return this.undoStack.length;
  }

  get redoSize(): number {
    return this.redoStack.length;
  }
}
