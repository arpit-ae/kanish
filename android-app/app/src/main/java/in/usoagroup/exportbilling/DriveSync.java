package in.usoagroup.exportbilling;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.work.*;
import com.google.android.gms.auth.api.identity.*;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;

public final class DriveSync extends Worker {
    static final String SCOPE="https://www.googleapis.com/auth/drive.appdata";
    static final String API="https://www.googleapis.com/drive/v3/";
    static final String UPLOAD="https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    static final String PREF="billing-records", ACCOUNT="driveAccount", OWNER="driveOwner", STATUS="driveStatus";
    private static final int LIMIT=12_000_000;
    private static final Object SYNC_LOCK=new Object();
    public DriveSync(Context context, WorkerParameters params){super(context,params);}
    static AuthorizationRequest request(){
        return AuthorizationRequest.builder().setRequestedScopes(Collections.singletonList(new Scope(SCOPE))).build();
    }
    static void schedule(Context c){
        if(c.getSharedPreferences(PREF,Context.MODE_PRIVATE).getString(ACCOUNT,"").isEmpty())return;
        Constraints network=new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        WorkManager wm=WorkManager.getInstance(c);
        wm.enqueueUniquePeriodicWork("usoa-drive-periodic",ExistingPeriodicWorkPolicy.KEEP,
            new PeriodicWorkRequest.Builder(DriveSync.class,15,TimeUnit.MINUTES).setConstraints(network).build());
        wm.enqueueUniqueWork("usoa-drive-now",ExistingWorkPolicy.KEEP,
            new OneTimeWorkRequest.Builder(DriveSync.class).setConstraints(network).build());
    }
    static void disconnect(Context c){
        SharedPreferences p=c.getSharedPreferences(PREF,Context.MODE_PRIVATE);
        String owner=p.getString(OWNER,p.getString(ACCOUNT,""));
        p.edit().putString(OWNER,owner).remove(ACCOUNT).putString(STATUS,"Google Drive disconnected").commit();
        WorkManager.getInstance(c).cancelUniqueWork("usoa-drive-periodic");
        WorkManager.getInstance(c).cancelUniqueWork("usoa-drive-now");
    }
    static String enc(String s)throws Exception{return URLEncoder.encode(s,"UTF-8");}
    static byte[] call(String token,String address,String method,String contentType,byte[] body)throws Exception{
        HttpURLConnection conn=(HttpURLConnection)new URL(address).openConnection();
        conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(15000);conn.setReadTimeout(30000);
        conn.setRequestMethod(method);conn.setRequestProperty("Authorization","Bearer "+token);
        try{
            if(body!=null){conn.setDoOutput(true);conn.setRequestProperty("Content-Type",contentType);conn.setFixedLengthStreamingMode(body.length);try(OutputStream out=conn.getOutputStream()){out.write(body);}}
            int code=conn.getResponseCode();
            if(code<200||code>=300)throw new IOException("Drive HTTP "+code);
            try(InputStream in=conn.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
                byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){if(out.size()+n>LIMIT)throw new IOException("Drive file too large");out.write(b,0,n);}return out.toByteArray();
            }
        }finally{conn.disconnect();}
    }
    static JSONObject json(byte[] b)throws JSONException{return new JSONObject(new String(b,StandardCharsets.UTF_8));}
    static String account(String token)throws Exception{
        return json(call(token,API+"about?fields="+enc("user(permissionId)"),"GET",null,null)).getJSONObject("user").getString("permissionId");
    }
    static boolean valid(JSONObject row,String id){
        try{
            if(!UUID.fromString(id).toString().equals(id)||!id.equals(row.getString("id")))return false;
            if(row.getString("payload").length()>10_000_000)return false;
            JSONObject d=new JSONObject(row.getString("payload"));
            String kind=row.getString("kind");
            return ("export".equals(kind)&&d.optInt("version")==2&&d.optJSONObject("fields")!=null&&d.optJSONArray("items")!=null&&d.optJSONArray("packages")!=null)
                || ("domestic".equals(kind)&&d.optInt("version")==1&&d.optJSONArray("items")!=null&&d.optJSONObject("seller")!=null&&d.optJSONObject("buyer")!=null);
        }catch(Exception e){return false;}
    }
    private boolean active(SharedPreferences prefs,String account){return !isStopped()&&account.equals(prefs.getString(ACCOUNT,""));}
    private void upload(String token,String id,String row)throws Exception{
        String boundary="usoa_"+UUID.randomUUID().toString();
        JSONObject meta=new JSONObject();meta.put("name","usoa-"+id+".json");meta.put("parents",new JSONArray().put("appDataFolder"));meta.put("mimeType","application/json");
        ByteArrayOutputStream out=new ByteArrayOutputStream();
        out.write(("--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"+meta+"\r\n--"+boundary+"\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n").getBytes(StandardCharsets.UTF_8));
        out.write(row.getBytes(StandardCharsets.UTF_8));out.write(("\r\n--"+boundary+"--\r\n").getBytes(StandardCharsets.UTF_8));
        call(token,UPLOAD,"POST","multipart/related; boundary="+boundary,out.toByteArray());
    }
    @androidx.annotation.NonNull @Override public Result doWork(){synchronized(SYNC_LOCK){return sync();}}
    private Result sync(){
        SharedPreferences prefs=getApplicationContext().getSharedPreferences(PREF,Context.MODE_PRIVATE);
        String bound=prefs.getString(ACCOUNT,"");if(bound.isEmpty())return Result.success();
        try{
            BillingStore store=BillingStore.get(getApplicationContext());store.migrate(prefs);
            String owner=prefs.getString(OWNER,bound);if(!bound.equals(owner))return Result.failure();
            if(!prefs.contains(OWNER)&&!prefs.edit().putString(OWNER,bound).commit())throw new IOException("Account binding save failed");
            AuthorizationResult auth=Tasks.await(Identity.getAuthorizationClient(getApplicationContext()).authorize(request()),30,TimeUnit.SECONDS);
            if(auth.hasResolution()||auth.getAccessToken()==null){prefs.edit().putString(STATUS,"Reconnect Google Drive in Backup").apply();return Result.success();}
            String token=auth.getAccessToken();
            if(!bound.equals(account(token))){prefs.edit().putString(STATUS,"Google account changed; sync paused").apply();return Result.success();}
            HashSet<String> remote=new HashSet<>();String page="";
            do{
                if(!active(prefs,bound))return Result.success();
                JSONObject listing=json(call(token,API+"files?spaces=appDataFolder&pageSize=1000&fields="+enc("nextPageToken,files(id,name)")+"&q="+enc("trashed = false and name contains 'usoa-'")+(page.isEmpty()?"":"&pageToken="+enc(page)),"GET",null,null));
                JSONArray files=listing.optJSONArray("files");
                if(files!=null)for(int i=0;i<files.length();i++){
                    JSONObject file=files.getJSONObject(i);String name=file.optString("name");
                    if(!name.matches("usoa-[0-9a-f-]{36}\\.json"))continue;
                    String id=name.substring(5,name.length()-5);try{if(!UUID.fromString(id).toString().equals(id))continue;}catch(Exception ignored){continue;}
                    if(!active(prefs,bound))return Result.success();
                    if(!store.has(id)){
                        JSONObject row=json(call(token,API+"files/"+enc(file.getString("id"))+"?alt=media","GET",null,null));
                        if(!valid(row,id))throw new IOException("Invalid cloud document");
                        if(!active(prefs,bound))return Result.success();
                        store.put(row,false);
                    }
                    remote.add(id);
                }
                page=listing.optString("nextPageToken","");
            }while(!page.isEmpty());
            JSONArray saved=store.rows("all");
            for(int i=0;i<saved.length();i++){
                JSONObject record=saved.getJSONObject(i);String id=record.getString("id");
                if(remote.contains(id))continue;
                if(!active(prefs,bound))return Result.success();
                if(!valid(record,id))throw new IOException("Invalid local document");
                upload(token,id,record.toString());remote.add(id);
            }
            if(active(prefs,bound))prefs.edit().putString(STATUS,"Drive synced • "+remote.size()+" saved records • "+new Date()).apply();
            return Result.success();
        }catch(Exception e){
            if(active(prefs,bound))prefs.edit().putString(STATUS,"Drive sync pending • retry when online / reconnect if needed").apply();
            return Result.retry();
        }
    }
}
