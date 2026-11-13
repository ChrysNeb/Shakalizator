import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import vm from 'node:vm';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../app/src/main/assets/web');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'vendor/manifest.json')));
for(const file of manifest){const b=fs.readFileSync(path.join(root,'vendor',file.file));assert.equal(crypto.createHash('sha256').update(b).digest('hex'),file.sha256,file.file);}
for(const section of ['','pic/','vid/','audio/','txt/','crypto/'])assert.match(fs.readFileSync(path.join(root,section,'index.html'),'utf8'),/src="\/android.js"/);
for(const section of ['vid','audio']){const s=fs.readFileSync(path.join(root,section,'index.html'),'utf8');assert.ok(!s.includes('https://unpkg.com/'));assert.match(s,/const wantMT = false/);}
const crypt=fs.readFileSync(path.join(root,'crypto/app.js'),'utf8');assert.match(crypt,/fetch\('\/crypto\/wordlist.json'\)/);assert.match(crypt,/new Worker\('\/crypto\/worker.js'/);
assert.ok(!fs.readFileSync(path.resolve(root,'../../AndroidManifest.xml'),'utf8').includes('android.permission.INTERNET'));
const result=[],events={};let done=false;
const context={window:null,document:{addEventListener(){}},navigator:{},HTMLAnchorElement:function(){},addEventListener:(n,fn)=>events[n]=fn,Blob,Uint8Array,String,Promise,Error,alert:message=>{throw Error(message);},btoa:binary=>Buffer.from(binary,'binary').toString('base64')};
context.window=context;context.HTMLAnchorElement.prototype.click=()=>{};
context.NativeShakal={beginSave(){context.ShakalAndroid.ready('test-id');},append(id,chunk){assert.equal(id,'test-id');assert.ok(chunk.length<200000);result.push(Buffer.from(chunk,'base64'));return true;},finish(id,ok){assert.equal(id,'test-id');done=ok;},copy(){},share(){}};
vm.runInNewContext(fs.readFileSync(path.join(root,'android.js'),'utf8'),context);
const bytes=crypto.randomBytes(6*1024*1024+173);await context.ShakalAndroid.download(new Blob([bytes],{type:'application/octet-stream'}),'test.bin');assert.equal(done,true);assert.deepEqual(Buffer.concat(result),bytes);
console.log('OK: pinned assets, local imports, no INTERNET permission, 6 MiB chunked export roundtrip.');
