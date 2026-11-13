/* Local Android integration. No network, telemetry, document text or phrase persistence. */
(()=>{
  if(!window.NativeShakal)return;
  let waiting=null,busy=false;
  const api=window.ShakalAndroid={
    ready(id){if(waiting){waiting(id);waiting=null;}},
    async download(blob,name){
      if(busy)return;busy=true;let id=null;
      try{
        id=await new Promise(resolve=>{waiting=resolve;NativeShakal.beginSave(name||'shakal-result',blob.type.split(';')[0]||'application/octet-stream');});
        if(!id)return;
        for(let offset=0;offset<blob.size;offset+=65536){
          const bytes=new Uint8Array(await blob.slice(offset,offset+65536).arrayBuffer());let binary='';for(let j=0;j<bytes.length;j++)binary+=String.fromCharCode(bytes[j]);
          if(!NativeShakal.append(id,btoa(binary)))throw new Error('Не удалось дописать файл');
        }
        NativeShakal.finish(id,true);id=null;
      }catch(e){if(id)NativeShakal.finish(id,false);alert('Сохранение прервано. Проверьте свободное место.');}
      finally{busy=false;waiting=null;}
    },
    async downloadURL(url,name,mime){try{let blob=await(await fetch(url)).blob();if(!blob.type&&mime)blob=new Blob([blob],{type:mime});await api.download(blob,name);}catch{alert('Не удалось открыть результат для сохранения');}}
  };
  const original=HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click=function(){if(this.download&&(this.href.startsWith('blob:')||this.href.startsWith('data:'))){api.downloadURL(this.href,this.download);return;}return original.call(this);};
  document.addEventListener('click',e=>{const a=e.target.closest?.('a[download]');if(a&&(a.href.startsWith('blob:')||a.href.startsWith('data:'))){e.preventDefault();api.downloadURL(a.href,a.download);}},true);
  try{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>NativeShakal.copy(String(text))}});}catch{}
  if(!navigator.share)navigator.share=async data=>{NativeShakal.share([data.title,data.text,data.url].filter(Boolean).join('\n'));};
  addEventListener('pagehide',()=>{if(waiting){waiting(null);waiting=null;}for(const tool of [window.shakalAudio,window.shakalVid]){try{tool?.state?.ff?.terminate();}catch{}}try{window.shakalAudio?.dsd?.worker?.terminate();}catch{}});
})();
