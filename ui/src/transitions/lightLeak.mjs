/*
 * Light Leak transition. Distributed under GNU AGPL-3.0-or-later with Xibo.
 * The same module is used by the macOS player and the CMS preview.
 */
export const LIGHT_LEAK = 'lightLeak';
export const DEFAULT_DURATION = 1800;

export function lightLeakDuration(value) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms >= 100 && ms <= 10000 ? ms : DEFAULT_DURATION;
}

// Match XLR's CSS background sizing/alignment instead of stretching every photo.
export function imageRect(imageWidth, imageHeight, width, height, size, position) {
  let w = width, h = height;
  if (size !== '100% 100%') {
    const scale = size === 'cover' ? Math.max(width / imageWidth, height / imageHeight)
      : Math.min(width / imageWidth, height / imageHeight);
    w = imageWidth * scale;
    h = imageHeight * scale;
  }
  const [x = '50%', y = '50%'] = position.trim().split(/\s+/);
  const offset = (value, space) => {
    if (value === 'left' || value === 'top') return 0;
    if (value === 'right' || value === 'bottom') return space;
    if (value === 'center') return space / 2;
    return value.endsWith('%') ? space * parseFloat(value) / 100 : parseFloat(value) || 0;
  };
  return { x: offset(x, width - w), y: offset(y, height - h), width: w, height: h };
}

export const fragmentShader = `precision highp float;
varying vec2 uv;
uniform sampler2D photoA;
uniform sampler2D photoB;
uniform float progress;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){return .57*noise(p)+.28*noise(p*2.03)+.15*noise(p*4.09);}
void main(){
vec2 p=vec2(uv.x,1.-uv.y);
vec4 a=texture2D(photoA,p),b=texture2D(photoB,p);
float edge=-.48+progress*1.96;
float wave=(fbm(vec2(p.y*5.6,progress*.65))-.5)*.26+(p.y-.5)*.18;
float d=p.x-edge+wave;
float revealed=1.-smoothstep(-.055,.065,d);
vec4 base=mix(a,b,revealed);
float envelope=smoothstep(0.,.12,progress)*(1.-smoothstep(.84,1.,progress));
float broad=exp(-d*d/.038)*.82;
float halo=exp(-d*d/.006)*1.1;
float core=exp(-d*d/.00055)*2.4;
float film=fbm(vec2(p.x*13.,p.y*9.)+progress*.2);
vec3 light=(vec3(1.,.14,.025)*broad*(.5+film*.8)+vec3(1.,.57,.15)*halo+vec3(1.,.95,.76)*core)*envelope;
float streak=exp(-pow((p.y-.36)+.025*sin(p.x*5.),2.)/.00028)*exp(-d*d/.14)*.13*envelope;
vec3 col=1.-(1.-base.rgb)*exp(-light-vec3(1.,.72,.4)*streak);
float grain=(hash(p*vec2(1280.,720.))-.5)*.014*envelope;
float alpha=max(base.a,clamp(max(light.r,max(light.g,light.b)),0.,1.));
gl_FragColor=vec4(clamp(col+grain,0.,1.),alpha);
}`;
const vertexShader = 'attribute vec2 a; varying vec2 uv; void main(){uv=(a+1.0)*.5;gl_Position=vec4(a,0.,1.);}';

function loadImage(url, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const abort = () => { image.src = ''; finish(new Error('Light Leak cancelled')); };
    function finish(error) {
      image.onload = image.onerror = null;
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(image);
    }
    image.onload = () => finish();
    image.onerror = () => finish(new Error('Light Leak image unavailable'));
    image.crossOrigin = 'anonymous';
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else image.src = url;
  });
}

function snapshot(image, media, width, height, dimensions, style) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Light Leak snapshot unavailable');
  ctx.scale(width / dimensions.width, height / dimensions.height);
  ctx.fillStyle = style.backgroundColor;
  ctx.fillRect(0, 0, dimensions.width, dimensions.height);
  // XLR paints CSS backgrounds; RendererLite (PWA) uses native <img> elements.
  const nativeImage = media.html?.tagName === 'IMG';
  const size = nativeImage ? (style.objectFit === 'fill' ? '100% 100%' : style.objectFit) : style.backgroundSize;
  const position = nativeImage ? style.objectPosition : style.backgroundPosition;
  const box = imageRect(image.naturalWidth, image.naturalHeight,
    media.divWidth, media.divHeight, size, position);
  ctx.drawImage(image, box.x, box.y, box.width, box.height);
  return canvas;
}

// The old image is covered synchronously, before XLR hides/removes its DOM node.
// Image timers and proof-of-play remain owned by XLR; this is presentation only.
export function beginLightLeak(region, oldMedia, newMedia, duration) {
  const host = region.html;
  if (!host?.isConnected || !oldMedia.html || !newMedia.html || !oldMedia.url || !newMedia.url) return () => {};
  const width = host.clientWidth, height = host.clientHeight;
  if (!width || !height) return () => {};
  const oldStyle = getComputedStyle(oldMedia.html), nextStyle = getComputedStyle(newMedia.html);
  const overlay = document.createElement('div');
  overlay.dataset.xiboLightLeak = 'loading';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:100;';
  const hold = oldMedia.html.cloneNode(false);
  hold.removeAttribute('id');
  hold.removeAttribute('class');
  hold.style.visibility = 'visible'; hold.style.opacity = '1'; hold.style.zIndex = '0';
  overlay.append(hold);
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;visibility:hidden;';
  // Cap pixel work while retaining the display's aspect ratio (including portrait).
  const scale = Math.min(1, 1920 / Math.max(width, height));
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  overlay.append(canvas);
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false });
  if (!gl) return () => {};
  let disposed = false, frame = 0, incomingVisibility;
  const controller = new AbortController();
  const shaders = [], textures = [], buffers = [], programs = [];
  const cleanups = [];
  const finish = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    clearTimeout(deadline);
    controller.abort();
    for (const cleanup of cleanups) cleanup();
    if (incomingVisibility !== undefined && newMedia.html) newMedia.html.style.visibility = incomingVisibility;
    overlay.remove();
    if (!gl.isContextLost()) {
      for (const item of textures) gl.deleteTexture(item);
      for (const item of buffers) gl.deleteBuffer(item);
      for (const item of programs) gl.deleteProgram(item);
      for (const item of shaders) gl.deleteShader(item);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  };
  // Includes image loading. A hidden/throttled renderer cannot hold the old photo forever.
  const deadline = setTimeout(finish, duration + 500);
  const lost = event => { event.preventDefault(); finish(); };
  canvas.addEventListener('webglcontextlost', lost);
  cleanups.push(() => canvas.removeEventListener('webglcontextlost', lost));
  const resized = new ResizeObserver(() => {
    if (host.clientWidth !== width || host.clientHeight !== height) finish();
  });
  resized.observe(host);
  cleanups.push(() => resized.disconnect());
  const removed = new MutationObserver(() => { if (!host.isConnected) finish(); });
  removed.observe(document.documentElement, { subtree: true, childList: true });
  cleanups.push(() => removed.disconnect());
  host.append(overlay);
  const started = performance.now();
  function compile(type, source) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Light Leak shader unavailable');
    shaders.push(shader);
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Light Leak shader compilation failed');
    return shader;
  }
  Promise.all([loadImage(oldMedia.url, controller.signal), loadImage(newMedia.url, controller.signal)])
    .then(([oldImage, nextImage]) => {
      if (disposed) return;
      const program = gl.createProgram();
      if (!program) throw new Error('Light Leak program unavailable');
      programs.push(program);
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShader));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShader));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Light Leak linking failed');
      gl.useProgram(program);
      const buffer = gl.createBuffer(); buffers.push(buffer);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      const attr = gl.getAttribLocation(program, 'a');
      gl.enableVertexAttribArray(attr); gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
      [oldImage, nextImage].forEach((image, index) => {
        gl.activeTexture(gl.TEXTURE0 + index);
        const texture = gl.createTexture(); textures.push(texture);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const media = index ? newMedia : oldMedia;
        const style = index ? nextStyle : oldStyle;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE,
          snapshot(image, media, canvas.width, canvas.height, { width, height }, style));
        gl.uniform1i(gl.getUniformLocation(program, index ? 'photoB' : 'photoA'), index);
      });
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Light Leak texture upload failed');
      const uniform = gl.getUniformLocation(program, 'progress');
      canvas.style.visibility = 'visible';
      hold.remove();
      overlay.dataset.xiboLightLeak = 'playing';
      function draw(now) {
        if (disposed) return;
        if (!host.isConnected || gl.isContextLost()) { finish(); return; }
        const progress = Math.min(1, Math.max(0, (now - started) / duration));
        gl.uniform1f(uniform, progress);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (progress < 1) frame = requestAnimationFrame(draw); else finish();
      }
      draw(performance.now());
    }).catch(() => finish()); // GPU/CORS/image failures fall back to the next real photo.
  finish.hideIncoming = () => {
    if (!disposed && newMedia.html) {
      incomingVisibility = newMedia.html.style.visibility;
      newMedia.html.style.visibility = 'hidden';
    }
  };
  return finish;
}

const installed = new WeakSet();
export function installLightLeakTransitions({ Region, Media }, begin = beginLightLeak) {
  if (installed.has(Region)) return;
  installed.add(Region);
  const active = new WeakMap();
  const cancel = region => { active.get(region)?.(); active.delete(region); };
  const transitionNodes = Region.prototype.transitionNodes;
  const run = Media.prototype.run;
  // XLR doesn't know lightLeak: never pass it to its built-in keyframe lookup.
  Media.prototype.run = function (...args) {
    if (this.options.transin !== LIGHT_LEAK) return run.apply(this, args);
    const value = this.options.transin;
    this.options.transin = '';
    try { return run.apply(this, args); } finally { this.options.transin = value; }
  };
  Region.prototype.transitionNodes = function (oldMedia, newMedia) {
    cancel(this);
    const lightLeak = newMedia?.options.transin === LIGHT_LEAK;
    if (lightLeak && oldMedia && oldMedia !== newMedia && oldMedia.mediaType === 'image' && newMedia.mediaType === 'image') {
      try { active.set(this, begin(this, oldMedia, newMedia, lightLeakDuration(newMedia.options.transinduration))); }
      catch { cancel(this); } // Continue playback even if WebGL cannot be initialised.
    }
    // Incoming Light Leak owns the visual blend; suppress competing out animations.
    // Also tolerate an imported lightLeak out option without crashing XLR.
    const out = oldMedia?.options.transout;
    const suppress = oldMedia && (lightLeak || out === LIGHT_LEAK);
    if (suppress) oldMedia.options.transout = '';
    try {
      const result = transitionNodes.call(this, oldMedia, newMedia);
      active.get(this)?.hideIncoming?.();
      return result;
    }
    catch (error) { cancel(this); throw error; }
    finally { if (suppress) oldMedia.options.transout = out; }
  };
  for (const method of ['end', 'reset']) {
    const original = Region.prototype[method];
    Region.prototype[method] = function (...args) { cancel(this); return original.apply(this, args); };
  }
}
