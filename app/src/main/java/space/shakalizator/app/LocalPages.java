package space.shakalizator.app;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import androidx.webkit.WebViewAssetLoader;
import java.io.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Virtual HTTPS origin is intercepted locally; there is no server or listening port. */
public final class LocalPages {
    public static final String HOST="appassets.androidplatform.net",ORIGIN="https://"+HOST;
    private final WebViewAssetLoader loader;public final AtomicInteger blocked=new AtomicInteger();
    public LocalPages(Context context){loader=new WebViewAssetLoader.Builder().setDomain(HOST).addPathHandler("/",path->{
        if(path.isEmpty())path="index.html";
        if(path.contains("..")||path.contains("\\")||path.contains("\0"))return response(403,"text/plain","Forbidden");
        try{
            String mime=mime(path);WebResourceResponse out=new WebResourceResponse(mime,mime.startsWith("text/")||mime.endsWith("json")?"UTF-8":null,context.getAssets().open("web/"+path));
            Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("X-Content-Type-Options","nosniff");headers.put("Referrer-Policy","no-referrer");
            headers.put("Content-Security-Policy",path.startsWith("crypto/")?"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self' blob: data:; object-src 'none'; frame-src 'none'; form-action 'none'":"connect-src 'self' blob: data:; img-src 'self' blob: data:; media-src 'self' blob: data:; object-src 'none'; frame-src 'none'; form-action 'none'");
            out.setResponseHeaders(headers);return out;
        }catch(IOException e){return response(404,"text/plain","Not found");}
    }).build();}
    public WebResourceResponse get(Uri uri){
        if(isLocal(uri)){WebResourceResponse r=loader.shouldInterceptRequest(uri);return r!=null?r:response(404,"text/plain","Not found");}
        blocked.incrementAndGet();return response(403,"text/plain","Network disabled: offline application");
    }
    public static boolean isLocal(Uri u){return "https".equals(u.getScheme())&&HOST.equals(u.getHost());}
    public static String toolUrl(Uri u){
        if(!"https".equals(u.getScheme()))return null;String host=u.getHost();if(host==null)return null;
        String folder=switch(host){case "shakalizator.space"->"";case "pic.shakalizator.space"->"pic/";case "vid.shakalizator.space"->"vid/";case "audio.shakalizator.space"->"audio/";case "txt.shakalizator.space"->"txt/";case "crypto.shakalizator.space"->"crypto/";default->null;};
        return folder==null?null:ORIGIN+"/"+folder+"index.html"+(u.getEncodedFragment()==null?"":"#"+u.getEncodedFragment());
    }
    static WebResourceResponse response(int status,String mime,String text){return new WebResourceResponse(mime,"UTF-8",status,status==403?"Forbidden":"Not Found",Collections.emptyMap(),new ByteArrayInputStream(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)));}
    static String mime(String p){if(p.endsWith(".wasm"))return "application/wasm";if(p.endsWith(".js"))return "text/javascript";if(p.endsWith(".json")||p.endsWith(".webmanifest"))return "application/json";if(p.endsWith(".css"))return "text/css";if(p.endsWith(".html"))return "text/html";if(p.endsWith(".svg"))return "image/svg+xml";if(p.endsWith(".jpg"))return "image/jpeg";if(p.endsWith(".png"))return "image/png";if(p.endsWith(".ico"))return "image/x-icon";return "application/octet-stream";}
}
