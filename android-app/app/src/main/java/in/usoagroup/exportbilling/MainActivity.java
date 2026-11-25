package in.usoagroup.exportbilling;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.view.View;
import android.webkit.*;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.*;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final String PAGE = "https://appassets.androidplatform.net/kanish.html";
    private static final int OPEN = 101, SAVE = 102;
    private WebView web;
    private ValueCallback<Uri[]> picker;
    private byte[] pending;
    private boolean printing, leftForPrint;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(23,61,50));
        getWindow().setNavigationBarColor(Color.rgb(23,61,50));
        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1,-1));
        if (android.os.Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
                v.setPadding(bars.left,bars.top,bars.right,bars.bottom);
                return insets;
            });
        }
        setContentView(root);
        WebSettings s=web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        web.addJavascriptInterface(new Bridge(),"AndroidExport");
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r){
                if (PAGE.equals(r.getUrl().toString())) {
                    try { return new WebResourceResponse("text/html","UTF-8",getAssets().open("kanish.html")); }
                    catch(IOException e){ return blocked(); }
                }
                return blocked();
            }
            private WebResourceResponse blocked(){ return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",java.util.Collections.emptyMap(),new ByteArrayInputStream(new byte[0])); }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r){
                Uri u=r.getUrl();
                if (PAGE.equals(u.toString())) return false;
                if(r.isForMainFrame() && "https".equals(u.getScheme()) && r.hasGesture()){
                    try { startActivity(new Intent(Intent.ACTION_VIEW,u)); } catch(Exception e){ toast("No browser available"); }
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> cb,FileChooserParams p){
                if(picker!=null)picker.onReceiveValue(null);
                picker=cb;
                try { startActivityForResult(p.createIntent(),OPEN); }
                catch(Exception e){ picker.onReceiveValue(null); picker=null; toast("File picker unavailable"); }
                return true;
            }
            @Override public boolean onJsAlert(WebView v,String url,String message,JsResult result){
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("OK",(d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show();return true;
            }
            @Override public boolean onJsConfirm(WebView v,String url,String message,JsResult result){
                new AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("OK",(d,w)->result.confirm()).setNegativeButton("Cancel",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;
            }
        });
        web.loadUrl(PAGE);
    }
    private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_LONG).show();}
    private void resetPrint(){printing=false;leftForPrint=false;web.evaluateJavascript("window.dispatchEvent(new Event('afterprint'))",null);}
    private final class Bridge {
        @JavascriptInterface public void print(){
            runOnUiThread(()->{
                if(printing)return;
                printing=true;leftForPrint=false;
                web.postDelayed(()->{
                    if(isFinishing())return;
                    try{
                        PrintManager pm=(PrintManager)getSystemService(PRINT_SERVICE);
                        pm.print("USOA Export Documents",web.createPrintDocumentAdapter("USOA Export Documents"),
                            new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).setMinMargins(PrintAttributes.Margins.NO_MARGINS).build());
                    }catch(Exception e){resetPrint();toast("Print unavailable");}
                },250);
            });
        }
        @JavascriptInterface public void save(String text,String name,String mime){
            runOnUiThread(()->{
                if(pending!=null){toast("Finish the current save first");return;}
                pending=text.getBytes(StandardCharsets.UTF_8);
                Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("application/json".equals(mime)?"application/json":"text/html")
                    .putExtra(Intent.EXTRA_TITLE,name.replaceAll("[/\\\\]","_"));
                try {startActivityForResult(i,SAVE);}catch(Exception e){pending=null;toast("Save unavailable");}
            });
        }
    }
    @Override protected void onPause(){super.onPause();if(printing)leftForPrint=true;}
    @Override protected void onResume(){super.onResume();if(printing&&leftForPrint)resetPrint();}
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==OPEN && picker!=null){picker.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));picker=null;}
        if(request==SAVE){
            byte[] bytes=pending;pending=null;
            if(result==RESULT_OK && data!=null && data.getData()!=null && bytes!=null){
                try(OutputStream out=getContentResolver().openOutputStream(data.getData(),"wt")){
                    if(out==null)throw new IOException("No output");
                    out.write(bytes);toast("File saved");
                }catch(Exception e){toast("Could not save file");}
            }
        }
    }
    @Override public void onBackPressed(){new AlertDialog.Builder(this).setMessage("Close USOA Export Billing?").setPositiveButton("Close",(d,w)->finish()).setNegativeButton("Stay",null).show();}
}
