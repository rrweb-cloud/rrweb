import * as path from 'path';
import * as esbuild from 'esbuild';
import type * as puppeteer from 'puppeteer';
import {
  vi,
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from 'vitest';
import { EventType, type eventWithTime } from '@rrweb/types';
import { launchPuppeteer, sampleEvents } from './utils';

const T = sampleEvents[0].timestamp;
const DCL = sampleEvents[0];
const META = sampleEvents[2];
const FULLSNAPSHOT = sampleEvents[3];
const CLICK = sampleEvents[4];

const bufferEndMarker = (bufferedTo: number): eventWithTime =>
  ({
    type: EventType.Custom,
    timestamp: bufferedTo,
    data: { tag: 'buffer-end', payload: { bufferedTo } },
  } as unknown as eventWithTime);

const truncatedRecording: eventWithTime[] = [
  DCL,
  META,
  FULLSNAPSHOT,
  CLICK,
  bufferEndMarker(T + 2000),
  { ...CLICK, timestamp: T + 3000 },
  { ...CLICK, timestamp: T + 4000 },
];

const continuation: eventWithTime[] = [
  { ...CLICK, timestamp: T + 2500 },
  bufferEndMarker(T + 4000),
];

const multiKeyframeRecording: eventWithTime[] = [
  DCL,
  META,
  FULLSNAPSHOT,
  CLICK,
  bufferEndMarker(T + 2000),
  { ...META, timestamp: T + 5000 },
  { ...CLICK, timestamp: T + 8000 },
  { ...CLICK, timestamp: T + 10000 },
];

const syntheticSnapshotContinuation: eventWithTime[] = [
  { ...FULLSNAPSHOT, timestamp: T + 5500 },
  bufferEndMarker(T + 10000),
];

async function bundleReplayer(): Promise<string> {
  const rrwebDir = path.resolve(__dirname, '..');
  const typesSrc = path.resolve(rrwebDir, '../types/src/index.ts');
  const result = await esbuild.build({
    stdin: {
      contents:
        `export { Replayer } from ${JSON.stringify(
          path.resolve(rrwebDir, 'src/replay/index.ts'),
        )};\n` + `export { ReplayerEvents } from '@rrweb/types';\n`,
      resolveDir: rrwebDir,
      loader: 'ts',
    },
    bundle: true,
    format: 'iife',
    globalName: 'rrweb',
    platform: 'browser',
    loader: { '.css': 'empty' },
    write: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'alias-rrweb-types',
        setup(build) {
          build.onResolve({ filter: /^@rrweb\/types$/ }, () => ({
            path: typesSrc,
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

describe('buffered-dom replay', function () {
  vi.setConfig({ testTimeout: 20_000 });

  let code: string;
  let browser: puppeteer.Browser;
  let page: puppeteer.Page;

  beforeAll(async () => {
    browser = await launchPuppeteer();
    code = await bundleReplayer();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await page.goto('about:blank');
    await page.evaluate(code);
    await page.evaluate(`var truncated = ${JSON.stringify(truncatedRecording)};
      var continuation = ${JSON.stringify(continuation)};
      var multiKeyframe = ${JSON.stringify(multiKeyframeRecording)};
      var syntheticContinuation = ${JSON.stringify(syntheticSnapshotContinuation)};
      var T = ${T};`);
    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
  });

  afterEach(async () => {
    await page.close();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('seeds a buffered range from the buffer-end marker and strips the marker', async () => {
    const result = await page.evaluate(`
      (() => {
        const { Replayer } = rrweb;
        const replayer = new Replayer(truncated, { fetchEvents: () => Promise.resolve([]) });
        return {
          ranges: replayer.getBufferedRanges(),
          endTime: replayer.getMetaData().endTime,
        };
      })();
    `);
    expect(result.ranges).toEqual([{ start: T, end: T + 2000 }]);
    expect(result.endTime).toBe(T + 4000);
  });

  it('fully covers a recording with no marker and never fetches', async () => {
    const result = await page.evaluate(`
      (() => {
        const { Replayer } = rrweb;
        let fetched = false;
        const noMarker = truncated.filter((e) => !(e.data && e.data.tag === 'buffer-end'));
        const replayer = new Replayer(noMarker, {
          fetchEvents: () => { fetched = true; return Promise.resolve([]); },
        });
        return { ranges: replayer.getBufferedRanges(), fetched };
      })();
    `);
    expect(result.ranges).toEqual([{ start: T, end: T + 4000 }]);
    expect(result.fetched).toBe(false);
  });

  it('stalls on a seek past the frontier, fetches from frontier+1, then resumes', async () => {
    const result = await page.evaluate(`
      (async () => {
        const { Replayer, ReplayerEvents } = rrweb;
        const calls = [];
        const emitted = [];
        const replayer = new Replayer(truncated, {
          fetchEvents: (req) => { calls.push(req); return Promise.resolve(continuation); },
        });
        replayer.on(ReplayerEvents.BufferingStart, (d) => emitted.push(['start', d.target]));
        replayer.on(ReplayerEvents.BufferingEnd, () => emitted.push(['end']));
        replayer.play(2500);
        await new Promise((r) => setTimeout(r, 300));
        return { calls, emitted, ranges: replayer.getBufferedRanges() };
      })();
    `);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].from).toBe(T + 2001);
    expect(result.calls[0].gapEnd == null).toBe(true);
    expect(result.calls[0].speed).toBe(1);
    expect(result.emitted).toEqual([['start', T + 2500], ['end']]);
    expect(result.ranges).toEqual([{ start: T, end: T + 4000 }]);
  });

  it('on a jump, sends from=playhead + gapStart=keyframe and anchors coverage at the returned (synthetic) snapshot, not gapStart', async () => {
    const result = await page.evaluate(`
      (async () => {
        const { Replayer, ReplayerEvents } = rrweb;
        const calls = [];
        const emitted = [];
        const replayer = new Replayer(multiKeyframe, {
          fetchEvents: (req) => { calls.push(req); return Promise.resolve(syntheticContinuation); },
        });
        replayer.on(ReplayerEvents.BufferingStart, (d) => emitted.push(['start', d.target]));
        replayer.on(ReplayerEvents.BufferingEnd, () => emitted.push(['end']));
        replayer.play(6000);
        await new Promise((r) => setTimeout(r, 300));
        return { calls, emitted, ranges: replayer.getBufferedRanges() };
      })();
    `);
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0].from).toBe(T + 6000);
    expect(result.calls[0].gapStart).toBe(T + 5000);
    expect(result.emitted).toEqual([['start', T + 6000], ['end']]);
    expect(result.ranges).toEqual([
      { start: T, end: T + 2000 },
      { start: T + 5500, end: T + 10000 },
    ]);
  });
});
