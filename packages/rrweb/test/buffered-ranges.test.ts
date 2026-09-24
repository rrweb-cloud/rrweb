import { describe, it, expect } from 'vitest';
import { BufferedRanges, planFetchWindow } from '../src/replay/buffered-ranges';

describe('BufferedRanges', () => {
  it('starts empty', () => {
    const b = new BufferedRanges();
    expect(b.length).toBe(0);
    expect(b.toArray()).toEqual([]);
    expect(b.covers(0)).toBe(false);
    expect(b.frontierAt(0)).toBeNull();
    expect(b.rangeContaining(0)).toBeNull();
    expect(b.nextRangeStartAfter(0)).toBeNull();
  });

  it('adds a single range', () => {
    const b = new BufferedRanges();
    b.add(100, 200);
    expect(b.toArray()).toEqual([{ start: 100, end: 200 }]);
  });

  it('ignores a reversed range', () => {
    const b = new BufferedRanges();
    b.add(200, 100);
    expect(b.toArray()).toEqual([]);
  });

  it('keeps disjoint ranges separate and ordered', () => {
    const b = new BufferedRanges();
    b.add(500, 600);
    b.add(0, 100);
    expect(b.toArray()).toEqual([
      { start: 0, end: 100 },
      { start: 500, end: 600 },
    ]);
  });

  it('merges integer-adjacent ranges (frontier + 1 continuation)', () => {
    const b = new BufferedRanges();
    b.add(0, 100);
    b.add(101, 200);
    expect(b.toArray()).toEqual([{ start: 0, end: 200 }]);
  });

  it('merges overlapping ranges', () => {
    const b = new BufferedRanges();
    b.add(0, 150);
    b.add(100, 200);
    expect(b.toArray()).toEqual([{ start: 0, end: 200 }]);
  });

  it('is a no-op when adding a fully-contained range', () => {
    const b = new BufferedRanges();
    b.add(0, 200);
    b.add(50, 150);
    expect(b.toArray()).toEqual([{ start: 0, end: 200 }]);
  });

  it('swallows multiple ranges when a new range spans them', () => {
    const b = new BufferedRanges();
    b.add(0, 100);
    b.add(500, 600);
    b.add(1000, 1100);
    b.add(50, 1050);
    expect(b.toArray()).toEqual([{ start: 0, end: 1100 }]);
  });

  it('fills a gap between two ranges and merges all three', () => {
    const b = new BufferedRanges();
    b.add(0, 200);
    b.add(500, 600);
    b.add(201, 499);
    expect(b.toArray()).toEqual([{ start: 0, end: 600 }]);
  });

  describe('rangeContaining / covers / frontierAt', () => {
    const b = new BufferedRanges();
    b.add(0, 200);
    b.add(500, 600);

    it('reports coverage inside a range, including boundaries', () => {
      expect(b.covers(0)).toBe(true);
      expect(b.covers(100)).toBe(true);
      expect(b.covers(200)).toBe(true);
      expect(b.covers(500)).toBe(true);
      expect(b.covers(600)).toBe(true);
    });

    it('reports no coverage inside a gap or beyond the last range', () => {
      expect(b.covers(300)).toBe(false);
      expect(b.covers(700)).toBe(false);
      expect(b.covers(-1)).toBe(false);
    });

    it('returns the containing range frontier', () => {
      expect(b.frontierAt(100)).toBe(200);
      expect(b.frontierAt(550)).toBe(600);
      expect(b.frontierAt(300)).toBeNull();
    });
  });

  describe('nextRangeStartAfter', () => {
    const b = new BufferedRanges();
    b.add(0, 200);
    b.add(500, 600);

    it('finds the start of the first range beginning after t (gapEnd)', () => {
      expect(b.nextRangeStartAfter(100)).toBe(500);
      expect(b.nextRangeStartAfter(200)).toBe(500);
      expect(b.nextRangeStartAfter(499)).toBe(500);
    });

    it('returns null when no later range exists', () => {
      expect(b.nextRangeStartAfter(500)).toBeNull();
      expect(b.nextRangeStartAfter(600)).toBeNull();
      expect(b.nextRangeStartAfter(1000)).toBeNull();
    });
  });

  it('clears all ranges', () => {
    const b = new BufferedRanges();
    b.add(0, 200);
    b.clear();
    expect(b.toArray()).toEqual([]);
    expect(b.length).toBe(0);
  });

  it('returns copies from toArray (no external mutation)', () => {
    const b = new BufferedRanges();
    b.add(0, 200);
    const snapshot = b.toArray();
    snapshot[0].end = 999;
    expect(b.toArray()).toEqual([{ start: 0, end: 200 }]);
  });
});

describe('planFetchWindow', () => {
  it('extends from the frontier when the keyframe is inside a buffered range', () => {
    const b = new BufferedRanges();
    b.add(0, 2000);
    expect(planFetchWindow(b, 1000, 2500)).toEqual({
      from: 2001,
      gapEnd: undefined,
    });
  });

  it('opens a fresh range at the keyframe when nothing covers it', () => {
    const b = new BufferedRanges();
    b.add(0, 2000);
    expect(planFetchWindow(b, 25000, 30000)).toEqual({
      from: 25000,
      gapEnd: undefined,
    });
  });

  it('caps the window with gapEnd at the next range start', () => {
    const b = new BufferedRanges();
    b.add(0, 2000);
    b.add(25000, 30000);
    expect(planFetchWindow(b, 1000, 8000)).toEqual({
      from: 2001,
      gapEnd: 25000,
    });
  });

  it('falls back to the target when there is no keyframe', () => {
    const b = new BufferedRanges();
    expect(planFetchWindow(b, null, 5000)).toEqual({
      from: 5000,
      gapEnd: undefined,
    });
  });
});
