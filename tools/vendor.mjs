import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../app/src/main/assets/web/vendor');
const files=[...['index.js','classes.js','const.js','errors.js','types.js','utils.js','worker.js'].map(n=>['ffmpeg/'+n,'https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm/'+n]),
    ['core/ffmpeg-core.js','https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js'],
    ['core/ffmpeg-core.wasm','https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm'],
    ['ffmpeg/LICENSE','https://raw.githubusercontent.com/ffmpegwasm/ffmpeg.wasm/v0.12.10/LICENSE']];
const manifest=[];
for(const [name,url] of files){const r=await fetch(url);if(!r.ok){if(name.endsWith('LICENSE'))continue;throw new Error(url+': '+r.status);}const data=Buffer.from(await r.arrayBuffer());const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data);manifest.push({file:name,source:url,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')});}
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2));console.log('Pinned FFmpeg 0.12.10 / core 0.12.6 vendored; wasm stays inside APK.');
