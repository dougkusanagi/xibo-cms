import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageRect, lightLeakDuration, installLightLeakTransitions } from '../../ui/src/transitions/lightLeak.mjs';

function fixture(begin = () => () => {}) {
  class Media {
    constructor(type = 'image', options = {}) { this.mediaType = type; this.options = options; this.runs = 0; }
    run() { this.runs++; assert.notEqual(this.options.transin, 'lightLeak', 'unknown effect must not reach XLR'); }
  }
  class Region {
    transitionNodes(old, next) { this.observedOut = old?.options.transout; next?.run(); }
    end() { this.ended = true; }
    reset() { this.resetCalled = true; }
  }
  installLightLeakTransitions({ Region, Media }, begin);
  return { Media, Region, region: new Region() };
}

test('duration is in ms with safe defaults and finite bounds', () => {
  assert.equal(lightLeakDuration('2300'), 2300);
  for (const v of [undefined, '', null, NaN, Infinity, -1, 0, 99, 10001]) assert.equal(lightLeakDuration(v), 1800);
  assert.equal(lightLeakDuration(100), 100);
  assert.equal(lightLeakDuration(10000), 10000);
});

test('snapshot preserves contain, cover, stretch and alignment in portrait regions', () => {
  assert.deepEqual(imageRect(1600, 900, 900, 1600, 'contain', '50% 50%'), { x:0, y:546.875, width:900, height:506.25 });
  const crop = imageRect(1600, 900, 900, 1600, 'cover', 'right bottom');
  assert.equal(crop.x + crop.width, 900); assert.equal(crop.y, 0); assert.equal(crop.height, 1600);
  assert.deepEqual(imageRect(1600, 900, 900, 1600, '100% 100%', '50% 50%'), { x:0,y:0,width:900,height:1600 });
  assert.equal(imageRect(100, 200, 500, 200, 'contain', 'left top').x, 0);
  assert.equal(imageRect(100, 200, 500, 200, 'contain', '100% 0%').x, 400);
});

test('only consecutive distinct photos animate; all items still start exactly once', () => {
  const calls = [];
  const { Media, region } = fixture((...args) => { calls.push(args); return () => {}; });
  const next = new Media('image', { transin:'lightLeak', transinduration:'1800' });
  region.transitionNodes(undefined, next);
  region.transitionNodes(next, next);
  region.transitionNodes(new Media('video'), next);
  assert.equal(calls.length, 0);
  const old = new Media('image', { transout:'fadeOut' });
  region.transitionNodes(old, next);
  assert.equal(calls.length, 1); assert.equal(calls[0][3], 1800);
  assert.equal(region.observedOut, ''); assert.equal(old.options.transout, 'fadeOut');
  assert.equal(next.runs, 4); assert.equal(next.options.transin, 'lightLeak');
});

test('other transitions pass through, including original out effect', () => {
  const { Media, region } = fixture(() => { throw Error('must not run'); });
  const old = new Media('image', { transout:'fly' }), next = new Media('image', { transin:'fadeIn' });
  region.transitionNodes(old, next);
  assert.equal(next.runs, 1); assert.equal(region.observedOut, 'fly'); assert.equal(next.options.transin, 'fadeIn');
});

test('navigation, reset, end and subsequent ordinary media cancel pending GPU work', () => {
  let cancelled = 0, concealed = 0;
  const { Media, region } = fixture(() => {
    const stop = () => { cancelled++; }; stop.hideIncoming = () => { concealed++; }; return stop;
  });
  const photo = () => new Media('image', {transin:'lightLeak'});
  region.transitionNodes(photo(), photo()); region.reset();
  region.transitionNodes(photo(), photo()); region.end();
  region.transitionNodes(photo(), photo()); region.transitionNodes(photo(), new Media('video'));
  assert.equal(cancelled, 3); assert.equal(concealed, 3); assert.equal(region.ended, true);
});

test('a GPU initialization failure does not break playback or restore unknown options too early', () => {
  const { Media, region } = fixture(() => { throw Error('GPU disabled'); });
  const next = new Media('image', { transin:'lightLeak' });
  region.transitionNodes(new Media(), next);
  assert.equal(next.runs, 1); assert.equal(next.options.transin, 'lightLeak');
});

test('install is idempotent and restores configuration even when original run throws', () => {
  let runs = 0;
  class Media { run() { runs++; assert.equal(this.options.transin, ''); throw Error('original failure'); } }
  class Region { transitionNodes(old, next) { next.run(); } end() {} reset() {} }
  installLightLeakTransitions({ Region, Media });
  installLightLeakTransitions({ Region, Media });
  const media = new Media(); media.options = { transin:'lightLeak' };
  assert.throws(() => media.run(), /original failure/);
  assert.equal(runs, 1); assert.equal(media.options.transin, 'lightLeak');
});
