package in.usoagroup.exportbilling;

import android.content.*;
import android.database.Cursor;
import android.app.Activity;
import android.app.Instrumentation;
import android.view.*;
import android.webkit.WebView;
import android.widget.Button;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class FoundationDeviceTest {
    private static JSONObject document(String n,String name)throws Exception{
        return new JSONObject().put("version",1).put("mode","Tax Invoice").put("number",n).put("date","2026-11-26")
            .put("seller",new JSONObject().put("name","Test seller").put("state","10"))
            .put("buyer",new JSONObject().put("name",name).put("state","10"))
            .put("items",new JSONArray().put(new JSONObject().put("description","Test honey").put("qty",1).put("rate",100).put("gst",18)));
    }
    private static JSONObject row(String id,JSONObject body)throws Exception{
        return new JSONObject().put("id",id).put("kind","domestic").put("saved",1).put("payload",body.toString());
    }
    @Test public void encryptedArchiveDraftAndMaster()throws Exception{
        Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();
        BillingStore db=BillingStore.get(c);
        SharedPreferences legacy=c.getSharedPreferences("billing-records",Context.MODE_PRIVATE);
        String id=UUID.randomUUID().toString(),n="TEST/"+id.substring(0,8),name="Private-"+id;
        JSONObject data=document(n,name),record=row(id,data);
        assertTrue(legacy.edit().putString("r:"+id,record.toString()).commit());
        db.migrate(legacy);
        assertTrue(db.has(id));
        assertTrue(legacy.contains("r:"+id));
        assertEquals("Already archived",db.put(record,true));
        try{db.put(row(UUID.randomUUID().toString(),document(n,"Changed buyer")),true);fail("Duplicate invoice accepted");}catch(java.io.IOException expected){}
        try(Cursor cursor=db.getReadableDatabase().rawQuery("SELECT body FROM records WHERE id=?",new String[]{id})){
            assertTrue(cursor.moveToFirst());assertFalse(new String(cursor.getBlob(0),java.nio.charset.StandardCharsets.UTF_8).contains(name));
        }
        db.saveDraft("domestic",data.toString());
        assertEquals(data.toString(),db.readDraft("domestic"));
        try{db.saveDraft("domestic","{}");fail("Invalid draft accepted");}catch(java.io.IOException expected){}
        assertEquals(data.toString(),db.readDraft("domestic"));
        db.setSeries("T");
        String a=db.reserve("gst","2026-11-26"),b=db.reserve("gst","2026-11-26");
        assertNotEquals(a,b);assertTrue(a.length()<=16);
        String code=BackupCrypto.generate();db.setRecoveryCode(code);assertEquals(code,db.recoveryCode());
        try{db.setRecoveryCode(BackupCrypto.generate());fail("Key replaced");}catch(java.io.IOException expected){}
        JSONObject customer=new JSONObject().put("name","Test buyer").put("address","Test address").put("state","10").put("gstin","").put("contact","");
        String customerId=db.saveMaster("customer","",customer.toString());
        customer.put("name","Updated buyer");db.saveMaster("customer",customerId,customer.toString());
        JSONArray customers=db.masterRows("customer");boolean found=false;
        for(int i=0;i<customers.length();i++){JSONObject e=customers.getJSONObject(i);if(customerId.equals(e.getString("id"))){assertEquals("Updated buyer",e.getJSONObject("value").getString("name"));found=true;}}
        assertTrue(found);
        String product=db.saveMaster("product","",new JSONObject().put("description","Test honey").put("hsn","0409").put("unit","kg").put("rate",100).put("gst",5).toString());
        assertFalse(product.isEmpty());
    }
    private static <T extends View> T find(View v,Class<T> type,String label){
        if(type.isInstance(v)&&(label==null||(v instanceof Button&&label.contentEquals(((Button)v).getText()))))return type.cast(v);
        if(v instanceof ViewGroup){ViewGroup g=(ViewGroup)v;for(int i=0;i<g.getChildCount();i++){T f=find(g.getChildAt(i),type,label);if(f!=null)return f;}}
        return null;
    }
    private static String evaluate(Instrumentation in,WebView w,String code)throws Exception{
        CountDownLatch done=new CountDownLatch(1);AtomicReference<String> result=new AtomicReference<>();
        in.runOnMainSync(()->w.evaluateJavascript(code,v->{result.set(v);done.countDown();}));
        assertTrue("WebView evaluation timeout",done.await(15,TimeUnit.SECONDS));return result.get();
    }
    private static void waitFor(Instrumentation in,WebView w,String predicate)throws Exception{
        for(int i=0;i<30;i++){if("true".equals(evaluate(in,w,predicate)))return;Thread.sleep(500);}
        fail("Editor did not initialize: "+predicate);
    }
    @Test public void loadsOfflineEditors()throws Exception{
        Instrumentation in=InstrumentationRegistry.getInstrumentation();
        Context c=in.getTargetContext();
        Activity activity=in.startActivitySync(new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try{
            AtomicReference<WebView> view=new AtomicReference<>();in.runOnMainSync(()->view.set(find(activity.getWindow().getDecorView(),WebView.class,null)));
            assertNotNull(view.get());
            waitFor(in,view.get(),"typeof window.AndroidArchive==='function' && !!document.getElementById('invoiceForm') && document.querySelectorAll('#invoiceForm input').length>0");
            in.runOnMainSync(()->{Button b=find(activity.getWindow().getDecorView(),Button.class,"India GST");assertNotNull(b);b.performClick();});
            waitFor(in,view.get(),"typeof window.AndroidArchive==='function' && !!document.getElementById('meta-number') && !!document.getElementById('items')");
            assertEquals("true",evaluate(in,view.get(),"Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Customers') && Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Products')"));
        }finally{in.runOnMainSync(activity::finish);}
    }
}
