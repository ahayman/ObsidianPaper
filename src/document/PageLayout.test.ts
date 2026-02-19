import type { Page } from "../types";
import {
  computePageLayout,
  findPageAtPoint,
  getDocumentBounds,
  getEffectiveSize,
  PAGE_GAP,
} from "./PageLayout";

function makePage(
  id: string,
  width: number,
  height: number,
  orientation: Page["orientation"] = "portrait",
  paperType: Page["paperType"] = "blank"
): Page {
  return {
    id,
    size: { width, height },
    orientation,
    paperType,
    lineSpacing: 32,
    gridSize: 40,
    margins: { top: 72, bottom: 36, left: 36, right: 36 },
  };
}

describe("PageLayout", () => {
  describe("getEffectiveSize", () => {
    it("should return original dimensions for portrait", () => {
      const page = makePage("p1", 612, 792, "portrait");
      const size = getEffectiveSize(page);
      expect(size.width).toBe(612);
      expect(size.height).toBe(792);
    });

    it("should swap dimensions for landscape", () => {
      const page = makePage("p1", 612, 792, "landscape");
      const size = getEffectiveSize(page);
      expect(size.width).toBe(792);
      expect(size.height).toBe(612);
    });
  });

  describe("computePageLayout — vertical", () => {
    it("should layout a single page centered on X=0", () => {
      const pages = [makePage("p1", 612, 792)];
      const layout = computePageLayout(pages, "vertical");

      expect(layout).toHaveLength(1);
      expect(layout[0].pageIndex).toBe(0);
      expect(layout[0].x).toBe(-306); // -612/2
      expect(layout[0].y).toBe(0);
      expect(layout[0].width).toBe(612);
      expect(layout[0].height).toBe(792);
    });

    it("should stack pages vertically with gaps", () => {
      const pages = [
        makePage("p1", 612, 792),
        makePage("p2", 612, 792),
      ];
      const layout = computePageLayout(pages, "vertical");

      expect(layout).toHaveLength(2);
      expect(layout[0].y).toBe(0);
      expect(layout[1].y).toBe(792 + PAGE_GAP);
    });

    it("should center pages of different widths independently", () => {
      const pages = [
        makePage("p1", 612, 792),
        makePage("p2", 420, 595),
      ];
      const layout = computePageLayout(pages, "vertical");

      expect(layout[0].x).toBe(-306); // -612/2
      expect(layout[1].x).toBe(-210); // -420/2
    });

    it("should handle landscape orientation pages", () => {
      const pages = [makePage("p1", 612, 792, "landscape")];
      const layout = computePageLayout(pages, "vertical");

      // Landscape swaps: effective width = 792, height = 612
      expect(layout[0].width).toBe(792);
      expect(layout[0].height).toBe(612);
      expect(layout[0].x).toBe(-396); // -792/2
    });
  });

  describe("computePageLayout — horizontal", () => {
    it("should layout a single page centered on Y=0", () => {
      const pages = [makePage("p1", 612, 792)];
      const layout = computePageLayout(pages, "horizontal");

      expect(layout).toHaveLength(1);
      expect(layout[0].x).toBe(0);
      expect(layout[0].y).toBe(-396); // -792/2
    });

    it("should stack pages horizontally with gaps", () => {
      const pages = [
        makePage("p1", 612, 792),
        makePage("p2", 612, 792),
      ];
      const layout = computePageLayout(pages, "horizontal");

      expect(layout[0].x).toBe(0);
      expect(layout[1].x).toBe(612 + PAGE_GAP);
    });

    it("should center pages of different heights independently", () => {
      const pages = [
        makePage("p1", 612, 792),
        makePage("p2", 420, 595),
      ];
      const layout = computePageLayout(pages, "horizontal");

      expect(layout[0].y).toBe(-396); // -792/2
      expect(layout[1].y).toBeCloseTo(-297.5); // -595/2
    });
  });

  describe("findPageAtPoint", () => {
    it("should find the correct page for a point inside", () => {
      const pages = [
        makePage("p1", 612, 792),
        makePage("p2", 612, 792),
      ];
      const layout = computePageLayout(pages, "vertical");

      // Point inside first page
      expect(findPageAtPoint(0, 100, layout)).toBe(0);
      // Point inside second page
      expect(findPageAtPoint(0, 792 + PAGE_GAP + 100, layout)).toBe(1);
    });

    it("should return -1 for point outside all pages", () => {
      const pages = [makePage("p1", 612, 792)];
      const layout = computePageLayout(pages, "vertical");

      expect(findPageAtPoint(-500, 0, layout)).toBe(-1);
      expect(findPageAtPoint(0, -100, layout)).toBe(-1);
      expect(findPageAtPoint(0, 1000, layout)).toBe(-1);
    });

    it("should detect point on page boundary", () => {
      const pages = [makePage("p1", 612, 792)];
      const layout = computePageLayout(pages, "vertical");

      // Top-left corner of the page
      expect(findPageAtPoint(layout[0].x, layout[0].y, layout)).toBe(0);
      // Bottom-right corner
      expect(findPageAtPoint(
        layout[0].x + layout[0].width,
        layout[0].y + layout[0].height,
        layout
      )).toBe(0);
    });

    it("should return -1 for point in gap between pages", () => {
      const pages = [
        makePage("p1", 612, 792),
        makePage("p2", 612, 792),
      ];
      const layout = computePageLayout(pages, "vertical");

      // Point in the gap between pages
      const gapY = 792 + PAGE_GAP / 2;
      expect(findPageAtPoint(0, gapY, layout)).toBe(-1);
    });
  });

  describe("getDocumentBounds", () => {
    it("should return zero bounds for empty layout", () => {
      const bounds = getDocumentBounds([]);
      expect(bounds.minX).toBe(0);
      expect(bounds.minY).toBe(0);
      expect(bounds.maxX).toBe(0);
      expect(bounds.maxY).toBe(0);
    });

    it("should encompass a single page", () => {
      const pages = [makePage("p1", 612, 792)];
      const layout = computePageLayout(pages, "vertical");
      const bounds = getDocumentBounds(layout);

      expect(bounds.minX).toBe(-306);
      expect(bounds.minY).toBe(0);
      expect(bounds.maxX).toBe(306);
      expect(bounds.maxY).toBe(792);
    });

    it("should encompass multiple pages", () => {
      const pages = [
        makePage("p1", 612, 792),
        makePage("p2", 420, 595),
      ];
      const layout = computePageLayout(pages, "vertical");
      const bounds = getDocumentBounds(layout);

      expect(bounds.minX).toBe(-306); // Wider page determines minX
      expect(bounds.maxX).toBe(306);
      expect(bounds.minY).toBe(0);
      expect(bounds.maxY).toBe(792 + PAGE_GAP + 595);
    });
  });
});
