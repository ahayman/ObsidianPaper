import { AutoMinimizer } from "./AutoMinimizer";

describe("AutoMinimizer", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts expanded", () => {
    const onChange = jest.fn();
    const am = new AutoMinimizer(onChange);
    expect(am.isMinimized()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    am.destroy();
  });

  it("minimizes immediately on stroke start", () => {
    const onChange = jest.fn();
    const am = new AutoMinimizer(onChange);
    am.notifyStrokeStart();
    expect(am.isMinimized()).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
    am.destroy();
  });

  it("expands after delay on stroke end", () => {
    const onChange = jest.fn();
    const am = new AutoMinimizer(onChange);

    am.notifyStrokeStart();
    expect(am.isMinimized()).toBe(true);

    am.notifyStrokeEnd();
    // Still minimized before timer fires
    expect(am.isMinimized()).toBe(true);

    jest.advanceTimersByTime(500);
    expect(am.isMinimized()).toBe(false);
    expect(onChange).toHaveBeenCalledWith(false);
    am.destroy();
  });

  it("cancels expand timer when new stroke starts", () => {
    const onChange = jest.fn();
    const am = new AutoMinimizer(onChange);

    am.notifyStrokeStart();
    am.notifyStrokeEnd();

    // Start new stroke before timer fires
    jest.advanceTimersByTime(200);
    am.notifyStrokeStart();

    // Original timer fires but shouldn't expand
    jest.advanceTimersByTime(500);
    expect(am.isMinimized()).toBe(true);
    am.destroy();
  });

  it("forceExpand expands immediately and cancels timer", () => {
    const onChange = jest.fn();
    const am = new AutoMinimizer(onChange);

    am.notifyStrokeStart();
    expect(am.isMinimized()).toBe(true);

    am.forceExpand();
    expect(am.isMinimized()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
    am.destroy();
  });

  it("suspend prevents minimization", () => {
    const onChange = jest.fn();
    const am = new AutoMinimizer(onChange);

    am.suspend();
    am.notifyStrokeStart();
    expect(am.isMinimized()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    am.destroy();
  });

  it("suspend also expands if currently minimized", () => {
    const onChange = jest.fn();
    const am = new AutoMinimizer(onChange);

    am.notifyStrokeStart();
    expect(am.isMinimized()).toBe(true);

    am.suspend();
    expect(am.isMinimized()).toBe(false);
    am.destroy();
  });

  it("resume re-enables auto-minimize", () => {
    const onChange = jest.fn();
    const am = new AutoMinimizer(onChange);

    am.suspend();
    am.resume();

    am.notifyStrokeStart();
    expect(am.isMinimized()).toBe(true);
    am.destroy();
  });

  it("destroy clears pending timer", () => {
    const onChange = jest.fn();
    const am = new AutoMinimizer(onChange);

    am.notifyStrokeStart();
    am.notifyStrokeEnd();

    am.destroy();

    // Timer should not fire after destroy
    jest.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1); // Only the initial minimize
  });

  it("does not fire onChange when state doesn't change", () => {
    const onChange = jest.fn();
    const am = new AutoMinimizer(onChange);

    // Already expanded, force expand should not fire
    am.forceExpand();
    expect(onChange).not.toHaveBeenCalled();

    // Minimize, then try to minimize again
    am.notifyStrokeStart();
    expect(onChange).toHaveBeenCalledTimes(1);

    am.notifyStrokeStart();
    expect(onChange).toHaveBeenCalledTimes(1); // No extra call
    am.destroy();
  });
});
