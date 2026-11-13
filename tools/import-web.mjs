// Optional refresh from the original checkout. A normal APK build only uses committed assets.
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.resolve(process.argv[2]||path.join(project,'..'));
const dest=path.join(project,'app/src/main/assets/web');
const sites=[['','shakal'],['pic','shakal-pic/public'],['vid','shakal-vid/public'],['audio','shakal-audio/public'],['txt','shakal-txt/public'],['crypto','shakal-crypto/public']];
for(const [section,folder] of sites){
    const target=path.join(dest,section);fs.mkdirSync(target,{recursive:true});
    for(const entry of fs.readdirSync(path.join(source,folder),{withFileTypes:true})){
        if(!entry.isFile()||! /\.(html|js|css|json|bin|svg|png|jpg|ico|webmanifest)$/.test(entry.name))continue;
        if(section===''&&entry.name==='index.html')continue; // Android dashboard is maintained separately.
        if(['404.html','robots.txt','sitemap.xml'].includes(entry.name))continue;
        const origin=path.join(source,folder,entry.name),file=path.join(target,entry.name);
        if(/\.(html|js)$/.test(entry.name)){
            let text=fs.readFileSync(origin,'utf8');
            text=text.replaceAll('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm','https://appassets.androidplatform.net/vendor/ffmpeg')
                .replaceAll('https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm','https://appassets.androidplatform.net/vendor/core')
                .replaceAll('https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm','https://appassets.androidplatform.net/vendor/core')
                .replace(/const wantMT = [^;]+;/g,'const wantMT = false; // Android: bundled single-thread engine');
            if(section==='crypto'){
                for(const asset of ['app.js','worker.js','wordlist.json','skins.json','favicon.svg','favicon.ico','apple-touch-icon.png','site.webmanifest'])text=text.replaceAll('/'+asset,'/crypto/'+asset);
            }
            if(section==='pic')text=text.replace(/let MAX_SOURCE = [^;]+;/,'let MAX_SOURCE = 2048;').replace(/let MAX_AREA = [^;]+;/,'let MAX_AREA = 4000000;').replace(/let VIEW_LONG = [^;]+;/,'let VIEW_LONG = 1280;');
            if(entry.name.endsWith('.html'))text=text.replace('</head>','<link rel="stylesheet" href="/android.css"><script src="/android.js"></script></head>');
            fs.writeFileSync(file,text);
        }else fs.copyFileSync(origin,file);
    }
}
console.log('Bundled six original pages. No website project is needed to build the APK.');
