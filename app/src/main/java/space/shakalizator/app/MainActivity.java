package space.shakalizator.app;

import android.Manifest;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import org.json.JSONObject;
import java.io.*;
import java.util.*;

public final class MainActivity extends ComponentActivity {
    private LinearLayout root;private FrameLayout content;private WebView web;private TextView status;private ProgressBar progress;private LocalPages pages;
    private ValueCallback<Uri[]> files;private PermissionRequest microphone;private View fullscreen;private WebChromeClient.CustomViewCallback fullscreenCallback;
    private final Object exportLock=new Object();private OutputStream exportStream;private String exportId;private String exportName;private Uri exportUri;private boolean exportPending;private long bytes;
    private final ActivityResultLauncher<Intent> choose=registerForActivityResult(new ActivityResultContracts.StartActivityForResult(),r->{ValueCallback<Uri[]> callback=files;files=null;if(callback!=null)callback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.getResultCode(),r.getData()));});
    private final ActivityResultLauncher<Intent> save=registerForActivityResult(new ActivityResultContracts.StartActivityForResult(),r->{
        exportPending=false;if(r.getResultCode()!=RESULT_OK||r.getData()==null||r.getData().getData()==null){js("window.ShakalAndroid&&ShakalAndroid.ready(null)");return;}
        try{synchronized(exportLock){exportUri=r.getData().getData();exportStream=getContentResolver().openOutputStream(exportUri,"wt");if(exportStream==null)throw new IOException();exportId=UUID.randomUUID().toString();bytes=0;js("ShakalAndroid.ready("+JSONObject.quote(exportId)+")");}status.setText("Сохраняем: "+exportName);}
        catch(IOException|SecurityException e){closeExport();js("ShakalAndroid.ready(null)");toast("Не удалось открыть место сохранения");}
    });
    private final ActivityResultLauncher<String> record=registerForActivityResult(new ActivityResultContracts.RequestPermission(),granted->{PermissionRequest p=microphone;microphone=null;if(p!=null){if(granted)p.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});else p.deny();}});
    @Override public void onCreate(Bundle b){super.onCreate(b);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);pages=new LocalPages(this);buildUi();load(LocalPages.ORIGIN+"/index.html");
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){if(fullscreen!=null)hideFullscreen();else if(web.canGoBack())web.goBack();else{setEnabled(false);getOnBackPressedDispatcher().onBackPressed();}}});}
    private int dp(int x){return Math.round(x*getResources().getDisplayMetrics().density);}
    private Button button(String text,Runnable action){Button b=new Button(this);b.setText(text);b.setTextSize(12);b.setAllCaps(false);b.setTextColor(0xfff5a524);b.setMinWidth(0);b.setMinimumWidth(0);b.setPadding(dp(7),0,dp(7),0);GradientDrawable bg=new GradientDrawable();bg.setColor(0xff181b22);bg.setCornerRadius(dp(13));bg.setStroke(dp(1),0xff343a46);b.setBackground(bg);b.setContentDescription(text);b.setOnClickListener(v->action.run());return b;}
    private void buildUi(){
        root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(0xff0f1115);root.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);setContentView(root);
        root.setOnApplyWindowInsetsListener((v,i)->{root.setPadding(0,i.getSystemWindowInsetTop(),0,i.getSystemWindowInsetBottom());return i;});
        LinearLayout bar=new LinearLayout(this);bar.setGravity(Gravity.CENTER_VERTICAL);bar.setPadding(dp(8),dp(3),dp(8),dp(3));
        Button home=button("🐺 Главная",()->load(LocalPages.ORIGIN+"/index.html"));Button about=button("О проекте",()->load(LocalPages.ORIGIN+"/about.html"));Button online=button("Веб-версия ↗",()->openBrowser("https://shakalizator.space/"));
        for(Button b:new Button[]{home,about,online}){LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(0,dp(44),1);p.setMargins(dp(3),0,dp(3),0);bar.addView(b,p);}root.addView(bar);
        progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);root.addView(progress,new LinearLayout.LayoutParams(-1,dp(3)));
        content=new FrameLayout(this);root.addView(content,new LinearLayout.LayoutParams(-1,0,1));
        status=new TextView(this);status.setText("Офлайн · файлы остаются на устройстве");status.setTextSize(11);status.setTextColor(0xffa3aabb);status.setGravity(Gravity.CENTER);status.setMinHeight(dp(24));root.addView(status);createWebView();
    }
    @SuppressWarnings("SetJavaScriptEnabled")
    private void createWebView(){
        web=new WebView(this);web.setBackgroundColor(0xff0f1115);WebView.setWebContentsDebuggingEnabled(false);WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(true);s.setCacheMode(WebSettings.LOAD_NO_CACHE);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setSupportMultipleWindows(false);s.setJavaScriptCanOpenWindowsAutomatically(false);s.setGeolocationEnabled(false);s.setSaveFormData(false);
        CookieManager.getInstance().setAcceptCookie(false);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);web.addJavascriptInterface(new Bridge(),"NativeShakal");
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r){return pages.get(r.getUrl());}
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){Uri u=r.getUrl();if(LocalPages.isLocal(u))return false;String local=LocalPages.toolUrl(u);if(local!=null){load(local);return true;}if(r.isForMainFrame()&&"https".equals(u.getScheme()))openBrowser(u.toString());return true;}
            @Override public void onPageFinished(WebView v,String url){progress.setVisibility(View.GONE);status.setText("Офлайн · файлы остаются на устройстве");}
            @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail d){content.removeView(v);v.destroy();closeExport();createWebView();load(LocalPages.ORIGIN+"/index.html");toast("Обработка остановлена: памяти не хватило. Выберите файл поменьше или короткий отрезок.");return true;}
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public void onProgressChanged(WebView v,int n){progress.setVisibility(n<100?View.VISIBLE:View.GONE);progress.setProgress(n);}
            @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> callback,FileChooserParams params){if(files!=null)files.onReceiveValue(null);files=callback;try{Intent i=params.createIntent();i.addCategory(Intent.CATEGORY_OPENABLE);choose.launch(i);}catch(ActivityNotFoundException e){files.onReceiveValue(null);files=null;toast("Не найдено приложение для выбора файла");}return true;}
            @Override public void onPermissionRequest(PermissionRequest p){runOnUiThread(()->{if(!LocalPages.isLocal(p.getOrigin())||!Arrays.asList(p.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)){p.deny();return;}if(ContextCompat.checkSelfPermission(MainActivity.this,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)p.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});else{if(microphone!=null)microphone.deny();microphone=p;record.launch(Manifest.permission.RECORD_AUDIO);}});}
            @Override public void onPermissionRequestCanceled(PermissionRequest p){if(microphone==p)microphone=null;}
            @Override public void onShowCustomView(View view,CustomViewCallback callback){if(fullscreen!=null){callback.onCustomViewHidden();return;}fullscreen=view;fullscreenCallback=callback;content.addView(view,new FrameLayout.LayoutParams(-1,-1));}
            @Override public void onHideCustomView(){hideFullscreen();}
        });
        web.setDownloadListener((url,ua,disposition,mime,length)->{if(url.startsWith("blob:")||url.startsWith("data:"))js("ShakalAndroid.downloadURL("+JSONObject.quote(url)+",'shakal-result',"+JSONObject.quote(mime==null?"application/octet-stream":mime)+")");});
        content.addView(web,0,new FrameLayout.LayoutParams(-1,-1));
    }
    private void hideFullscreen(){if(fullscreen!=null){content.removeView(fullscreen);fullscreen=null;if(fullscreenCallback!=null)fullscreenCallback.onCustomViewHidden();fullscreenCallback=null;}}
    private void load(String url){if(web!=null)web.loadUrl(url);}
    private void js(String script){if(web!=null&&!isDestroyed())web.evaluateJavascript(script,null);}
    private void openBrowser(String url){try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));}catch(ActivityNotFoundException e){toast("Не найден браузер");}}
    private void toast(String t){Toast.makeText(this,t,Toast.LENGTH_LONG).show();}
    private void closeExport(){synchronized(exportLock){if(exportStream!=null)try{exportStream.close();}catch(IOException ignored){}exportStream=null;exportId=null;}}
    final class Bridge {
        @JavascriptInterface public void beginSave(String name,String mime){runOnUiThread(()->{if(exportPending||exportStream!=null){js("ShakalAndroid.ready(null)");return;}exportPending=true;exportName=ExportNames.clean(name);Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(ExportNames.mime(mime)).putExtra(Intent.EXTRA_TITLE,exportName);try{save.launch(i);}catch(ActivityNotFoundException e){exportPending=false;js("ShakalAndroid.ready(null)");toast("Не найдено приложение для сохранения");}});}
        @JavascriptInterface public boolean append(String id,String chunk){synchronized(exportLock){if(exportStream==null||!Objects.equals(id,exportId)||chunk.length()>200_000)return false;try{byte[] b=Base64.decode(chunk,Base64.NO_WRAP);exportStream.write(b);bytes+=b.length;return true;}catch(IOException|IllegalArgumentException e){return false;}}}
        @JavascriptInterface public void finish(String id,boolean ok){synchronized(exportLock){if(!Objects.equals(id,exportId))return;closeExport();}runOnUiThread(()->{status.setText(ok?"Сохранено · "+exportName:"Сохранение прервано · проверьте неполный файл");toast(ok?"Файл сохранён":"Не удалось дописать файл");});}
        @JavascriptInterface public void copy(String text){runOnUiThread(()->((ClipboardManager)getSystemService(CLIPBOARD_SERVICE)).setPrimaryClip(ClipData.newPlainText("Шакализатор",text)));}
        @JavascriptInterface public void share(String text){runOnUiThread(()->{Intent i=new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,text);startActivity(Intent.createChooser(i,"Поделиться"));});}
    }
    WebView webForTests(){return web;}LocalPages pagesForTests(){return pages;}
    @Override protected void onPause(){super.onPause();web.onPause();}
    @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();}
    @Override protected void onDestroy(){if(files!=null)files.onReceiveValue(null);if(microphone!=null)microphone.deny();closeExport();if(web!=null){content.removeView(web);web.removeJavascriptInterface("NativeShakal");web.destroy();web=null;}super.onDestroy();}
}
