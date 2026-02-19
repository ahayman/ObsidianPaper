import type { Stroke } from "../types";
import { UndoManager } from "./UndoManager";

function makeStroke(id: string): Stroke {
  return {
    id,
    pageIndex: 0,
    style: "_default",
    bbox: [0, 0, 100, 100],
    pointCount: 5,
    pts: "0,0,128,128,128,0,0;10,10,0,0,0,8",
  };
}

describe("UndoManager", () => {
  let manager: UndoManager;

  beforeEach(() => {
    manager = new UndoManager();
  });

  describe("add-stroke undo/redo", () => {
    it("should have nothing to undo initially", () => {
      expect(manager.canUndo()).toBe(false);
      expect(manager.undo()).toBeNull();
    });

    it("should undo an added stroke", () => {
      const stroke = makeStroke("s1");
      manager.pushAddStroke(stroke);

      expect(manager.canUndo()).toBe(true);
      const action = manager.undo();
      expect(action).not.toBeNull();
      expect(action!.type).toBe("add-stroke");
      expect((action as { type: "add-stroke"; stroke: Stroke }).stroke.id).toBe("s1");
    });

    it("should redo after undo", () => {
      const stroke = makeStroke("s1");
      manager.pushAddStroke(stroke);
      manager.undo();

      expect(manager.canRedo()).toBe(true);
      const action = manager.redo();
      expect(action).not.toBeNull();
      expect(action!.type).toBe("add-stroke");
    });

    it("should clear redo stack on new action", () => {
      manager.pushAddStroke(makeStroke("s1"));
      manager.undo();
      expect(manager.canRedo()).toBe(true);

      manager.pushAddStroke(makeStroke("s2"));
      expect(manager.canRedo()).toBe(false);
    });
  });

  describe("remove-stroke undo/redo", () => {
    it("should undo a removed stroke", () => {
      const stroke = makeStroke("s1");
      manager.pushRemoveStroke(stroke, 3);

      const action = manager.undo();
      expect(action).not.toBeNull();
      expect(action!.type).toBe("remove-stroke");

      const removeAction = action as {
        type: "remove-stroke";
        stroke: Stroke;
        index: number;
      };
      expect(removeAction.stroke.id).toBe("s1");
      expect(removeAction.index).toBe(3);
    });
  });

  describe("remove-strokes (batch) undo/redo", () => {
    it("should undo batch removal", () => {
      const entries = [
        { stroke: makeStroke("s1"), index: 0 },
        { stroke: makeStroke("s2"), index: 2 },
      ];
      manager.pushRemoveStrokes(entries);

      const action = manager.undo();
      expect(action).not.toBeNull();
      expect(action!.type).toBe("remove-strokes");
    });
  });

  describe("stack management", () => {
    it("should track sizes correctly", () => {
      expect(manager.undoSize).toBe(0);
      expect(manager.redoSize).toBe(0);

      manager.pushAddStroke(makeStroke("s1"));
      manager.pushAddStroke(makeStroke("s2"));
      expect(manager.undoSize).toBe(2);

      manager.undo();
      expect(manager.undoSize).toBe(1);
      expect(manager.redoSize).toBe(1);
    });

    it("should clear both stacks", () => {
      manager.pushAddStroke(makeStroke("s1"));
      manager.undo();
      manager.clear();

      expect(manager.canUndo()).toBe(false);
      expect(manager.canRedo()).toBe(false);
      expect(manager.undoSize).toBe(0);
      expect(manager.redoSize).toBe(0);
    });

    it("should handle multiple undo/redo cycles", () => {
      manager.pushAddStroke(makeStroke("s1"));
      manager.pushAddStroke(makeStroke("s2"));
      manager.pushAddStroke(makeStroke("s3"));

      // Undo all three
      const a3 = manager.undo();
      const a2 = manager.undo();
      const a1 = manager.undo();
      expect(a3!.type).toBe("add-stroke");
      expect(a2!.type).toBe("add-stroke");
      expect(a1!.type).toBe("add-stroke");
      expect(manager.undo()).toBeNull();

      // Redo all three
      manager.redo();
      manager.redo();
      manager.redo();
      expect(manager.redo()).toBeNull();
      expect(manager.undoSize).toBe(3);
    });
  });
});
