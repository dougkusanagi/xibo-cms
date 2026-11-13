/* Light Leak adapter for RendererLite 0.4.9. GNU AGPL-3.0-or-later. */
import { beginLightLeak, LIGHT_LEAK, lightLeakDuration } from '../transitions/lightLeak.mjs';

const installed = new WeakSet();
export function installLightLeakPwa(RendererLite, begin = beginLightLeak) {
  if (installed.has(RendererLite)) return;
  const proto = RendererLite.prototype;
  if (typeof proto._showWidget !== 'function' || typeof proto._hideWidget !== 'function') {
    throw new Error('Unsupported RendererLite lifecycle for Light Leak');
  }
  installed.add(RendererLite);
  const instances = new WeakMap();
  const state = renderer => {
    if (!instances.has(renderer)) instances.set(renderer, { shown:new WeakMap(), active:new Map(), tokens:new WeakMap() });
    return instances.get(renderer);
  };
  const cancel = (s, region) => { s.active.get(region)?.(); s.active.delete(region); };
  const media = (widget, element, region) => ({
    html:element, url:element?.currentSrc || element?.src,
    divWidth:region.element.clientWidth, divHeight:region.element.clientHeight,
    mediaType:widget.type,
  });
  const show = proto._showWidget;
  proto._showWidget = async function (region, index) {
    const s=state(this), previous=s.shown.get(region), next=region.widgets[index];
    cancel(s,region);
    const token={}; s.tokens.set(region,token);
    const incoming = next?.transitions?.in;
    const custom = incoming?.type === LIGHT_LEAK;
    const oldElement = previous && region.widgetElements.get(previous.id);
    const nextElement = next && region.widgetElements.get(next.id);
    if (custom && previous && previous!==next && previous.type==='image' && next.type==='image' && oldElement && nextElement) {
      try { s.active.set(region,begin({html:region.element},media(previous,oldElement,region),media(next,nextElement,region),lightLeakDuration(incoming.duration))); }
      catch { cancel(s,region); }
    }
    // Unknown PWA transitions otherwise leave reused <img> nodes at opacity 0.
    // Let the native "no transition" path make the photo fully visible, then
    // conceal it behind the compositor while Light Leak runs.
    if (custom) next.transitions.in=null;
    try {
      const result=await show.call(this,region,index);
      if (s.tokens.get(region)===token) {
        if (result) s.shown.set(region,next);
        s.active.get(region)?.hideIncoming?.();
      }
      return result;
    } catch (error) { if(s.tokens.get(region)===token) cancel(s,region); throw error; }
    finally { if(custom) next.transitions.in=incoming; }
  };
  const hide=proto._hideWidget;
  proto._hideWidget=function(region,index) {
    const widget=region.widgets[index];
    const next=region.widgets[(index+1)%region.widgets.length];
    const out=widget?.transitions?.out;
    const suppress=widget?.type==='image' && next?.type==='image' && next.transitions?.in?.type===LIGHT_LEAK;
    if(suppress) widget.transitions.out=null;
    try { return hide.call(this,region,index); }
    finally { if(suppress) widget.transitions.out=out; }
  };
  for (const method of ['stopCurrentLayout','cleanup','_swapToPreloadedLayout','stopOverlay']) {
    const original=proto[method];
    if(typeof original!=='function')continue;
    proto[method]=function(...args) {
      const s=state(this);
      for(const region of s.active.keys())cancel(s,region);
      s.shown=new WeakMap();s.tokens=new WeakMap();
      return original.apply(this,args);
    };
  }
}
