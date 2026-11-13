/* One-time PWA shell refresh for Light Leak. GNU AGPL-3.0-or-later.
 * Media caches, IndexedDB, localStorage and player identity are preserved.
 */
export function installLightLeakRollout(worker) {
  const version='light-leak-v1';
  const scope=new URL(worker.registration.scope);
  const marker=new URL('__light_leak_rollout__',scope).href;
  const isCurrent=async()=>{
    const response=await(await caches.open('xibo-sw-version')).match(marker);
    return response && await response.text()===version;
  };
  worker.addEventListener('install',event=>event.waitUntil((async()=>{
    if(!await isCurrent())await worker.skipWaiting();
  })()));
  worker.addEventListener('activate',event=>event.waitUntil((async()=>{
    if(await isCurrent())return;
    // Refresh the shell before navigation; a failed/offline fetch leaves existing
    // clients playing and the marker unset so the next update can retry.
    try {
      const urls=[scope.href,new URL('index.html',scope).href];
      const responses=await Promise.all(urls.map(url=>fetch(url,{cache:'no-store'})));
      if(responses.some(response=>!response.ok))return;
      const shell=await caches.open('xibo-static-v1');
      await Promise.all(responses.map((response,index)=>shell.put(urls[index],response)));
      await(await caches.open('xibo-sw-version')).put(marker,new Response(version));
      await worker.clients.claim();
      const clients=await worker.clients.matchAll({type:'window',includeUncontrolled:true});
      await Promise.all(clients.filter(client=>{
        const url=new URL(client.url);
        return url.origin===scope.origin && (url.pathname===scope.pathname || url.pathname===scope.pathname+'index.html');
      }).map(client=>client.navigate(client.url).catch(()=>{})));
    } catch { /* Keep offline playback and retry on a later worker update. */ }
  })()));
}
if(typeof ServiceWorkerGlobalScope!=='undefined' && self instanceof ServiceWorkerGlobalScope) installLightLeakRollout(self);
