package space.shakalizator.app;
import android.Manifest;
import android.content.pm.PackageManager;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class OfflineToolsTest {
    private ActivityScenario<MainActivity> scenario;
    @Before public void open(){scenario=ActivityScenario.launch(MainActivity.class);}
    @After public void close(){scenario.close();}
    private String eval(String script)throws Exception{CountDownLatch latch=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();scenario.onActivity(a->a.webForTests().evaluateJavascript(script,v->{result.set(v);latch.countDown();}));assertTrue(latch.await(15,TimeUnit.SECONDS));return result.get();}
    private void load(String section,String ready)throws Exception{scenario.onActivity(a->a.webForTests().loadUrl(LocalPages.ORIGIN+"/"+section));long until=System.currentTimeMillis()+60_000;while(System.currentTimeMillis()<until){if("true".equals(eval("Boolean(location.href === "+JSONObject.quote(LocalPages.ORIGIN+"/"+section)+" && ("+ready+"))")))return;Thread.sleep(250);}fail("Page did not become ready: "+section);}
    private JSONObject run(String body,int seconds)throws Exception{eval("window.__testResult=null;Promise.resolve().then(async()=>{"+body+"}).then(value=>window.__testResult=JSON.stringify({ok:true,value}),e=>window.__testResult=JSON.stringify({ok:false,error:String(e&&e.stack||e)}));void 0;");long until=System.currentTimeMillis()+seconds*1000L;while(System.currentTimeMillis()<until){Object value=new JSONTokener(eval("window.__testResult||null")).nextValue();if(value instanceof String){JSONObject result=new JSONObject((String)value);assertTrue(result.toString(),result.getBoolean("ok"));return result;}Thread.sleep(250);}fail("JS operation timed out");return null;}
    private void noNetwork(){scenario.onActivity(a->assertEquals("external subresources",0,a.pagesForTests().blocked.get()));}
    @Test public void bundledPagesWorkWithoutInternetPermission()throws Exception{
        assertEquals(PackageManager.PERMISSION_DENIED,InstrumentationRegistry.getInstrumentation().getTargetContext().checkSelfPermission(Manifest.permission.INTERNET));
        for(String page:new String[]{"index.html","pic/index.html","vid/index.html","audio/index.html","txt/index.html","crypto/index.html","about.html"}){load(page,"document.readyState==='complete'&&document.querySelector('h1')");assertFalse(eval("document.querySelector('h1').textContent").isEmpty());}noNetwork();
    }
    @Test public void photoAllLevelsAndResamplingAreNonBlack()throws Exception{
        load("pic/index.html","window.shakal");run("const c=document.createElement('canvas');c.width=240;c.height=180;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,240,180);g.addColorStop(0,'#20ddaa');g.addColorStop(1,'#ff55aa');x.fillStyle=g;x.fillRect(0,0,240,180);x.fillStyle='#112233';x.font='24px sans-serif';x.fillText('SHAKAL',20,80);let count=0;for(const resample of ['paint','nearest','clean']){for(const l of [1,2,3,4,5,6,7,8,9,10,12]){const result=l===12?await shakal.shakalize1210(c,{resample}):await shakal.shakalize(l,c,{resample});const b=result.canvas;const p=b.getContext('2d').getImageData(2,2,1,1).data;if(p[0]+p[1]+p[2]<30)throw Error('black '+l);b.width=b.height=0;count++;}}c.width=c.height=0;return count;",180);noNetwork();
    }
    @Test public void textSeedAndHonestMojibakeRoundtrip()throws Exception{
        load("txt/index.html","window.shakalTxt");run("const s=shakalTxt;await s.loadDict();const text='Привет, как дела? Автор пишет ещё один прекрасный текст.';for(let level=1;level<=10;level++){const opts={level,seed:'123',iter:0};const a=s.shakalize(text,opts),b=s.shakalize(text,opts);if(!a||a!==b)throw Error('seed '+level);}const short='Привет, как дела?';if(s.decrack(s.crack1210(short))!==short)throw Error('mojibake');return true;",40);noNetwork();
    }
    @Test public void cryptoWorkerAndPngPayloadRoundtrip()throws Exception{
        load("crypto/index.html","document.querySelector('#phrase')?.value.split(' ').length===12");run("if(!isSecureContext)throw Error('insecure');const c=await import('/crypto/core.js');const words=await(await fetch('/crypto/wordlist.json')).json();const phrase=await c.generatePhrase(12,c.wordIndex(words));const w=new Worker('/crypto/worker.js',{type:'module'});let id=0;const call=m=>new Promise((resolve,reject)=>{w.onmessage=e=>e.data.ok?resolve(e.data):reject(Error(e.data.error));w.onerror=e=>reject(Error(e.message));w.postMessage({id:++id,...m});});for(const level of [1,6,12]){const enc=await call({op:'enc',text:'Привет 🐺',phrase,level});const p=c.packToImage(enc.packet);const canvas=document.createElement('canvas');canvas.width=p.width;canvas.height=c.PNG_BANNER_H+p.rows;canvas.getContext('2d').putImageData(new ImageData(p.data,p.width,p.rows),0,c.PNG_BANNER_H);const back=c.unpackFromImage(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);const dec=await call({op:'dec',packet:back,phrase,level});if(dec.text!=='Привет 🐺')throw Error('roundtrip');}w.terminate();return true;",90);noNetwork();
    }
    @Test public void ffmpegAudioAndVideoRunFromBundledWasm()throws Exception{
        load("audio/index.html","window.shakalAudio");run("const s=shakalAudio;await s.loadCore(()=>{});let code=await s.state.ff.exec(['-y','-f','lavfi','-i','sine=frequency=1000:duration=1','-c:a','pcm_s16le','tone.wav']);if(code)throw Error('fixture');const data=await s.state.ff.readFile('tone.wav');await s.onFile(new File([data],'tone.wav',{type:'audio/wav'}));for(const level of [1,7,10,12]){s.state.mode1210=level===12;document.querySelector('#slider').value=level===12?10:level;s.state.mp3=null;await s.go({preview:true,again:false});if(!s.state.mp3||s.state.mp3.length<100)throw Error('audio '+level);}s.state.ff.terminate();return true;",240);noNetwork();
        load("vid/index.html","window.shakalVid");run("const s=shakalVid;await s.loadCore(()=>{});const code=await s.state.ff.exec(['-y','-f','lavfi','-i','testsrc2=size=160x120:rate=12:duration=1','-f','lavfi','-i','sine=frequency=700:duration=1','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest','fixture.mp4']);if(code)throw Error('fixture');const data=await s.state.ff.readFile('fixture.mp4');await s.onFile(new File([data],'fixture.mp4',{type:'video/mp4'}));for(const level of [1,6,10,12]){s.state.mode1210=level===12;document.querySelector('#slider').value=level===12?10:level;s.state.out=null;await s.go({preview:true,again:false});if(!s.state.out||s.state.out.length<100)throw Error('video '+level);}s.state.ff.terminate();return true;",300);noNetwork();
    }
}
