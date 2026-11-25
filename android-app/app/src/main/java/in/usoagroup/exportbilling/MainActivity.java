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
    private static final int OPEN=101,SAVE=102,CLOUD=103,IMPORT=104,DRIVE_AUTH=105;
    private static final String BASE="https://appassets.androidplatform.net/", DOMESTIC=BASE+"domestic.html";
    private String current=PAGE;
    private android.content.SharedPreferences records;
    private final java.util.concurrent.ExecutorService io=java.util.concurrent.Executors.newSingleThreadExecutor();
    private android.widget.TextView status;
    private android.content.SharedPreferences.OnSharedPreferenceChangeListener syncListener;
    private boolean driveConnecting;

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
        records=getSharedPreferences("billing-records",MODE_PRIVATE);
        android.widget.LinearLayout layout=new android.widget.LinearLayout(this);layout.setOrientation(android.widget.LinearLayout.VERTICAL);
        android.widget.LinearLayout bar=new android.widget.LinearLayout(this);
        for(String label:new String[]{"Export","India GST","Backup","History"}){
            android.widget.Button b=new android.widget.Button(this);b.setText(label);b.setAllCaps(false);
            bar.addView(b,new android.widget.LinearLayout.LayoutParams(0,-2,1));
            b.setOnClickListener(v->{if(printing)return;if(label.equals("Export"))switchPage(PAGE);else if(label.equals("India GST"))switchPage(DOMESTIC);else if(label.equals("Backup"))backupMenu();else historyMenu();});
        }
        status=new android.widget.TextView(this);status.setText(records.getString(DriveSync.STATUS,"Offline workspace • optional backup"));
        syncListener=(prefs,key)->{if(DriveSync.STATUS.equals(key))message(prefs.getString(key,"Offline workspace"));};
        records.registerOnSharedPreferenceChangeListener(syncListener);
        layout.addView(bar);layout.addView(status);layout.addView(web,new android.widget.LinearLayout.LayoutParams(-1,0,1));root.addView(layout,new FrameLayout.LayoutParams(-1,-1));
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
                String url=r.getUrl().toString();
                if(url.equals(PAGE)||url.equals(DOMESTIC)||url.equals(BASE+"assets/orbit-editor.js")||url.equals(BASE+"assets/domestic-workspace.js")||url.equals(BASE+"assets/orbit-billing.css")){
                    String name=url.substring(BASE.length());
                    String mime=name.endsWith(".js")?"application/javascript":name.endsWith(".css")?"text/css":"text/html";
                    try{return new WebResourceResponse(mime,"UTF-8",getAssets().open(name));}catch(IOException e){return blocked();}
                }
                return blocked();
            }
            private WebResourceResponse blocked(){ return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",java.util.Collections.emptyMap(),new ByteArrayInputStream(new byte[0])); }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r){
                Uri u=r.getUrl();
                if (PAGE.equals(u.toString())||DOMESTIC.equals(u.toString())) return false;
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
    private void switchPage(String url){if(current.equals(url))return;web.evaluateJavascript("window.AndroidFlush && window.AndroidFlush()",v->{current=url;web.loadUrl(url);});}
    private void message(String text){runOnUiThread(()->status.setText(text));}
    private org.json.JSONArray historyRows(String kind){
        java.util.ArrayList<org.json.JSONObject> rows=new java.util.ArrayList<>();
        for(java.util.Map.Entry<String,?> e:records.getAll().entrySet())if(e.getKey().startsWith("r:"))try{org.json.JSONObject r=new org.json.JSONObject((String)e.getValue());if(kind.equals("all")||kind.equals(r.optString("kind")))rows.add(r);}catch(Exception ignored){}
        rows.sort((a,b)->Long.compare(b.optLong("saved"),a.optLong("saved")));org.json.JSONArray result=new org.json.JSONArray();for(org.json.JSONObject r:rows)result.put(r);return result;
    }
    private void archive(String kind,String payload){
        io.execute(()->{try{
            if(payload.length()>10000000||(!kind.equals("export")&&!kind.equals("domestic")))throw new IOException();
            new org.json.JSONObject(payload);
            String id=java.util.UUID.randomUUID().toString();org.json.JSONObject r=new org.json.JSONObject();
            r.put("id",id);r.put("kind",kind);r.put("payload",payload);r.put("saved",System.currentTimeMillis());
            if(!records.edit().putString("r:"+id,r.toString()).commit())throw new IOException();
            message("Document saved locally");queueBackup();DriveSync.schedule(this);
        }catch(Exception e){message("Save failed");}});
    }
    private void historyMenu(){
        String kind=current.equals(PAGE)?"export":"domestic";
        new AlertDialog.Builder(this).setItems(new String[]{"Archive current document","Open saved document"},(d,w)->{
            if(w==0){web.evaluateJavascript("window.AndroidArchive && window.AndroidArchive()",null);return;}
            org.json.JSONArray a=historyRows(kind);String[] titles=new String[a.length()];
            for(int i=0;i<a.length();i++)try{org.json.JSONObject r=a.getJSONObject(i),p=new org.json.JSONObject(r.getString("payload"));titles[i]=(kind.equals("export")?p.getJSONObject("fields").optString("piNo"):p.optString("mode")+" "+p.optString("number"))+" • "+new java.util.Date(r.optLong("saved"));}catch(Exception e){titles[i]="Saved record";}
            if(titles.length==0){toast("No saved documents");return;}
            new AlertDialog.Builder(this).setItems(titles,(dd,i)->new AlertDialog.Builder(this).setMessage("Replace current draft?").setNegativeButton("Cancel",null).setPositiveButton("Open",(x,y)->{try{web.evaluateJavascript("window.AndroidRestore("+org.json.JSONObject.quote(a.getJSONObject(i).getString("payload"))+")",null);}catch(Exception e){toast("Restore failed");}}).show()).show();
        }).show();
    }
    private void backupMenu(){
        new AlertDialog.Builder(this).setTitle("Backup & transfer").setItems(new String[]{"Connect Google Drive (automatic archive sync)","Sync Google Drive now","Disconnect Google Drive","Connect manual backup file","Retry manual backup","Import / merge backup","Disconnect manual backup"},(d,w)->{
            if(w==0){connectDrive();}
            else if(w==1){DriveSync.schedule(this);message(records.getString(DriveSync.ACCOUNT,"").isEmpty()?"Connect Google Drive first":"Drive sync requested");}
            else if(w==2){DriveSync.disconnect(this);message("Drive disconnected");}
            else if(w==3){Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE,"USOA-"+java.util.UUID.randomUUID().toString().substring(0,8)+".json");i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);startActivityForResult(i,CLOUD);}
            else if(w==4)queueBackup();
            else if(w==5)startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json"),IMPORT);
            else{records.edit().remove("uri").apply();message("Backup disconnected");}
        }).show();
    }
    private void connectDrive(){
        if(driveConnecting)return;
        new AlertDialog.Builder(this).setTitle("Connect Google Drive").setMessage("Sync sends your saved billing documents to the selected Google account. Use the same business account on every device. Drafts stay local. Continue?").setNegativeButton("Cancel",null).setPositiveButton("Connect",(d,w)->{
            driveConnecting=true;
            com.google.android.gms.auth.api.identity.Identity.getAuthorizationClient(this).authorize(DriveSync.request()).addOnSuccessListener(result->{
                try{
                    if(result.hasResolution()){
                        android.app.PendingIntent pi=result.getPendingIntent();
                        if(pi==null)throw new IOException("No consent screen");
                        startIntentSenderForResult(pi.getIntentSender(),DRIVE_AUTH,null,0,0,0);
                    }else finishDriveConnect(result);
                }catch(Exception e){driveConnecting=false;message("Drive authorization unavailable");}
            }).addOnFailureListener(e->{driveConnecting=false;message("Google Drive authorization failed • check OAuth setup");});
        }).show();
    }
    private void finishDriveConnect(com.google.android.gms.auth.api.identity.AuthorizationResult result){
        String token=result.getAccessToken();
        if(token==null){driveConnecting=false;message("Drive access not granted");return;}
        io.execute(()->{
            try{
                String id=DriveSync.account(token);String existing=records.getString(DriveSync.ACCOUNT,"");
                if(!existing.isEmpty()&&!existing.equals(id)){message("Different account • disconnect first if you intend to switch");return;}
                records.edit().putString(DriveSync.ACCOUNT,id).putString(DriveSync.STATUS,"Drive connected • sync queued").commit();
                DriveSync.schedule(this);
            }catch(Exception e){message("Drive access failed • check API and OAuth configuration");}
            finally{runOnUiThread(()->driveConnecting=false);}
        });
    }
    private void queueBackup(){
        String target=records.getString("uri","");if(target.isEmpty())return;
        io.execute(()->{try{org.json.JSONObject r=new org.json.JSONObject();r.put("app","USOA-Billing");r.put("version",1);r.put("records",historyRows("all"));try(OutputStream out=getContentResolver().openOutputStream(Uri.parse(target),"wt")){if(out==null)throw new IOException();out.write(r.toString().getBytes(StandardCharsets.UTF_8));}message("Backup written to provider");}catch(Exception e){message("Backup pending • retry in Backup");}});
    }
    private void importArchive(Uri uri){
        io.execute(()->{try(InputStream in=getContentResolver().openInputStream(uri)){
            if(in==null)throw new IOException();ByteArrayOutputStream buf=new ByteArrayOutputStream();byte[] b=new byte[8192];int n;
            while((n=in.read(b))!=-1){if(buf.size()+n>50000000)throw new IOException();buf.write(b,0,n);}
            org.json.JSONObject root=new org.json.JSONObject(buf.toString("UTF-8"));
            if(!root.optString("app").equals("USOA-Billing")||root.optInt("version")!=1)throw new IOException();
            org.json.JSONArray rows=root.getJSONArray("records");android.content.SharedPreferences.Editor edit=records.edit();int count=0;
            for(int i=0;i<rows.length();i++){org.json.JSONObject r=rows.getJSONObject(i);String id=r.getString("id"),kind=r.getString("kind");java.util.UUID.fromString(id);org.json.JSONObject p=new org.json.JSONObject(r.getString("payload"));if(!(kind.equals("export")&&p.optInt("version")==2)&&!(kind.equals("domestic")&&p.optInt("version")==1))throw new IOException();if(!records.contains("r:"+id)){edit.putString("r:"+id,r.toString());count++;}}
            if(!edit.commit())throw new IOException();message("Imported "+count+" new records");queueBackup();DriveSync.schedule(this);
        }catch(Exception e){message("Backup import failed");}});
    }
    private final class Bridge {
        @JavascriptInterface public void archive(String kind,String payload){MainActivity.this.archive(kind,payload);}
        @JavascriptInterface public String history(String kind){return historyRows(kind).toString();}

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
    @Override protected void onResume(){super.onResume();if(printing&&leftForPrint)resetPrint();if(records!=null){queueBackup();DriveSync.schedule(this);}}
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==DRIVE_AUTH){if(result==RESULT_OK&&data!=null){try{finishDriveConnect(com.google.android.gms.auth.api.identity.Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data));}catch(Exception e){driveConnecting=false;message("Drive consent failed");}}else{driveConnecting=false;message("Drive consent cancelled");}}
        if(request==CLOUD&&result==RESULT_OK&&data!=null&&data.getData()!=null){try{Uri u=data.getData();if((data.getFlags() & Intent.FLAG_GRANT_WRITE_URI_PERMISSION)==0)throw new SecurityException("No write permission");getContentResolver().takePersistableUriPermission(u,Intent.FLAG_GRANT_WRITE_URI_PERMISSION);records.edit().putString("uri",u.toString()).apply();queueBackup();}catch(Exception e){toast("Provider cannot retain backup access");}}
        if(request==IMPORT&&result==RESULT_OK&&data!=null&&data.getData()!=null)importArchive(data.getData());
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
    @Override protected void onDestroy(){if(records!=null&&syncListener!=null)records.unregisterOnSharedPreferenceChangeListener(syncListener);super.onDestroy();}
    @Override public void onBackPressed(){new AlertDialog.Builder(this).setMessage("Close USOA Export Billing?").setPositiveButton("Close",(d,w)->finish()).setNegativeButton("Stay",null).show();}
}
