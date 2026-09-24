export type BufferedRange = { start: number; end: number };

export class BufferedRanges {
  private ranges: BufferedRange[] = [];

  public get length(): number {
    return this.ranges.length;
  }

  public add(start: number, end: number): void {
    if (end < start) {
      return;
    }
    const merged: BufferedRange[] = [];
    let inserted: BufferedRange = { start, end };
    let placed = false;
    for (const range of this.ranges) {
      if (range.end < inserted.start - 1) {
        merged.push(range);
      } else if (range.start > inserted.end + 1) {
        if (!placed) {
          merged.push(inserted);
          placed = true;
        }
        merged.push(range);
      } else {
        inserted = {
          start: Math.min(inserted.start, range.start),
          end: Math.max(inserted.end, range.end),
        };
      }
    }
    if (!placed) {
      merged.push(inserted);
    }
    this.ranges = merged;
  }

  public rangeContaining(t: number): BufferedRange | null {
    for (const range of this.ranges) {
      if (range.start <= t && t <= range.end) {
        return range;
      }
      if (range.start > t) {
        break;
      }
    }
    return null;
  }

  public covers(t: number): boolean {
    return this.rangeContaining(t) !== null;
  }

  public frontierAt(t: number): number | null {
    const range = this.rangeContaining(t);
    return range ? range.end : null;
  }

  public nextRangeStartAfter(t: number): number | null {
    for (const range of this.ranges) {
      if (range.start > t) {
        return range.start;
      }
    }
    return null;
  }

  public clear(): void {
    this.ranges = [];
  }

  public toArray(): BufferedRange[] {
    return this.ranges.map((range) => ({ ...range }));
  }
}

export function planFetchWindow(
  ranges: BufferedRanges,
  keyframe: number | null,
  target: number,
): { from: number; gapEnd?: number } {
  const containing = keyframe !== null ? ranges.rangeContaining(keyframe) : null;
  let from: number;
  if (containing) {
    from = containing.end + 1;
  } else if (keyframe !== null) {
    from = keyframe;
  } else {
    from = target;
  }
  const gapEnd = ranges.nextRangeStartAfter(from);
  return { from, gapEnd: gapEnd ?? undefined };
}
