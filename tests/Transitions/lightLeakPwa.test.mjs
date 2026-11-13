import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installLightLeakPwa} from '../../ui/src/player-extensions/lightLeakPwa.mjs';

function fixture(begin=()=>()=>{}) {
 class Renderer {
  async _showWidget(region,index) {
   const widget=region.widgets[index];
   const element=region.widgetElements.get(widget.id);
   if(!widget.transitions.in)element.style.opacity='1';
   element.style.visibility='visible';
   this.starts=(this.starts||0)+1;
   return widget;
  }
  _hideWidget(region,index) { return region.widgets[index].transitions.out; }
  stopCurrentLayout(){this.stopped=true;}
  cleanup(){this.cleaned=true;}
  _swapToPreloadedLayout(){return 'swapped';}
 }
 const widgets=[1,2,3].map(id=>({id,type:'image',transitions:{in:{type:'lightLeak',duration:1800},out:null}}));
 const elements=new Map(widgets.map(w=>[w.id,{src:'photo'+w.id,style:{opacity:'0',visibility:'hidden'}}]));
 const region={element:{clientWidth:800,clientHeight:600},widgets,widgetElements:elements};
 installLightLeakPwa(Renderer,begin);
 return {Renderer,renderer:new Renderer(),region};
}

test('first photo and missing GPU use visible native fallback, preserving transition config',async()=>{
 const {renderer,region}=fixture();
 for(const index of [0,1]){
  await renderer._showWidget(region,index);
  assert.equal(region.widgetElements.get(index+1).style.opacity,'1');
  assert.equal(region.widgets[index].transitions.in.type,'lightLeak');
 }
 assert.equal(renderer.starts,2);
});

test('consecutive images use ms duration and the native img/source/dimensions',async()=>{
 const calls=[];
 const {renderer,region}=fixture((...args)=>{calls.push(args);return ()=>{};});
 await renderer._showWidget(region,0);await renderer._showWidget(region,1);
 assert.equal(calls.length,1);assert.equal(calls[0][3],1800);
 assert.equal(calls[0][1].url,'photo1');assert.equal(calls[0][2].html,region.widgetElements.get(2));
 assert.equal(calls[0][2].divWidth,800);assert.equal(calls[0][2].divHeight,600);
});

test('navigation, layout stop and cleanup release pending effects',async()=>{
 let cancelled=0,hidden=0;
 const {renderer,region}=fixture(()=>{const end=()=>cancelled++;end.hideIncoming=()=>hidden++;return end;});
 await renderer._showWidget(region,0);await renderer._showWidget(region,1);await renderer._showWidget(region,2);
 assert.equal(cancelled,1);renderer.stopCurrentLayout();assert.equal(cancelled,2);
 await renderer._showWidget(region,0);assert.equal(hidden,2,'new layout first item has no preceding photo');
 await renderer._showWidget(region,1);renderer.cleanup();assert.equal(cancelled,3);
});

test('other transitions and incompatible media pass through without composing',async()=>{
 const {renderer,region}=fixture(()=>{throw Error('must not compose');});
 region.widgets[0].transitions.in={type:'fadeIn',duration:500};
 await renderer._showWidget(region,0);
 assert.equal(region.widgets[0].transitions.in.type,'fadeIn');
 region.widgets[1].type='video';await renderer._showWidget(region,1);
 assert.equal(renderer.starts,2);
});

test('out animations are suppressed only when the next photo uses lightLeak',()=>{
 const {renderer,region}=fixture();region.widgets[0].transitions.out={type:'fadeOut'};
 assert.equal(renderer._hideWidget(region,0),null);
 assert.equal(region.widgets[0].transitions.out.type,'fadeOut');
 region.widgets[1].transitions.in={type:'fadeIn'};
 assert.equal(renderer._hideWidget(region,0).type,'fadeOut');
});

test('GPU initialization exception cannot stop photo playback',async()=>{
 const {renderer,region}=fixture(()=>{throw Error('GPU unavailable');});
 await renderer._showWidget(region,0);await renderer._showWidget(region,1);
 assert.equal(renderer.starts,2);assert.equal(region.widgetElements.get(2).style.opacity,'1');
});

test('installation is idempotent and checks the supported renderer lifecycle',async()=>{
 const {renderer,region,Renderer}=fixture();installLightLeakPwa(Renderer);
 await renderer._showWidget(region,0);assert.equal(renderer.starts,1);
 assert.throws(()=>installLightLeakPwa(class {}),/Unsupported RendererLite/);
});
