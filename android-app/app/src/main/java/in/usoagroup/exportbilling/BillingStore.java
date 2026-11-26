package in.usoagroup.exportbilling;
import android.content.*;
import android.database.Cursor;
import android.database.sqlite.*;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** Encrypted archive payloads, authenticated with per-record AAD.
 * Metadata and keyed indexes are not full-database encryption. */
final class BillingStore extends SQLiteOpenHelper {
    private static final String AES="usoa.v4.archive.aes", MAC="usoa.v4.index.hmac";
    private static BillingStore singleton;
    static synchronized BillingStore get(Context c){if(singleton==null)singleton=new BillingStore(c.getApplicationContext());return singleton;}
    private BillingStore(Context c){super(c,"usoa-v4.db",null,1);}
    @Override public void onConfigure(SQLiteDatabase db){db.setForeignKeyConstraintsEnabled(true);}
    @Override public void onCreate(SQLiteDatabase db){
        db.execSQL("CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,saved INTEGER NOT NULL,body BLOB NOT NULL)");
        db.execSQL("CREATE TABLE doc_keys(k TEXT NOT NULL,record_id TEXT NOT NULL REFERENCES records(id),PRIMARY KEY(k,record_id))");
        db.execSQL("CREATE INDEX record_order ON records(kind,saved)");
        db.execSQL("CREATE TABLE metadata(k TEXT PRIMARY KEY,v TEXT NOT NULL)");
        db.execSQL("CREATE TABLE sequences(k TEXT PRIMARY KEY,last INTEGER NOT NULL)");
        db.execSQL("CREATE TABLE drafts(kind TEXT PRIMARY KEY,body BLOB NOT NULL)");
    }
    @Override public void onUpgrade(SQLiteDatabase db,int oldV,int newV){throw new IllegalStateException("Explicit migration required");}
    private SecretKey key(String alias,boolean mac,boolean create)throws Exception{
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        if(!ks.containsAlias(alias)){
            if(!create)throw new IOException("Encryption key unavailable; restore from backup");
            KeyGenerator g=KeyGenerator.getInstance(mac?KeyProperties.KEY_ALGORITHM_HMAC_SHA256:KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            KeyGenParameterSpec.Builder b=new KeyGenParameterSpec.Builder(alias,mac?KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY:KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setKeySize(256);
            if(mac)b.setDigests(KeyProperties.DIGEST_SHA256);else b.setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE);
            g.init(b.build());g.generateKey();
        }
        return (SecretKey)ks.getKey(alias,null);
    }
    private byte[] seal(String id,String text)throws Exception{
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key(AES,false,true));c.updateAAD(id.getBytes(StandardCharsets.UTF_8));
        byte[] iv=c.getIV(),body=c.doFinal(text.getBytes(StandardCharsets.UTF_8));if(iv.length!=12)throw new IOException("Invalid nonce");
        byte[] out=new byte[iv.length+body.length];System.arraycopy(iv,0,out,0,iv.length);System.arraycopy(body,0,out,iv.length,body.length);return out;
    }
    private String open(String id,byte[] body)throws Exception{
        if(body.length<28)throw new IOException("Invalid encrypted data");
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(AES,false,false),new GCMParameterSpec(128,body,0,12));c.updateAAD(id.getBytes(StandardCharsets.UTF_8));return new String(c.doFinal(body,12,body.length-12),StandardCharsets.UTF_8);
    }
    private String index(String value)throws Exception{Mac m=Mac.getInstance("HmacSHA256");m.init(key(MAC,true,true));return android.util.Base64.encodeToString(m.doFinal(value.getBytes(StandardCharsets.UTF_8)),android.util.Base64.NO_WRAP);}
    private String meta(SQLiteDatabase db,String k){try(Cursor c=db.rawQuery("SELECT v FROM metadata WHERE k=?",new String[]{k})){return c.moveToFirst()?c.getString(0):"";}}
    private void meta(SQLiteDatabase db,String k,String v){ContentValues cv=new ContentValues();cv.put("k",k);cv.put("v",v);if(db.insertWithOnConflict("metadata",null,cv,SQLiteDatabase.CONFLICT_REPLACE)==-1)throw new IllegalStateException("Metadata save failed");}
    private Set<String> keys(JSONObject row,boolean strict)throws Exception{
        JSONObject d=new JSONObject(row.getString("payload"));Set<String> result=new HashSet<>();
        if("domestic".equals(row.getString("kind"))){
            try{String mode=d.getString("mode");if(!mode.equals("Tax Invoice")&&!mode.equals("Delivery Challan"))throw new IllegalArgumentException("Invalid mode");result.add(index(FiscalNumbers.key(mode.equals("Delivery Challan")?"challan":"gst",d.getString("date"),d.getString("number"))));}catch(Exception e){if(strict)throw e;}
        }else{
            JSONObject f=d.getJSONObject("fields");
            for(String[] x:new String[][]{{"proforma","piDate","piNo"},{"commercial","ciDate","ciNo"},{"packing","plDate","plNo"}}){
                try{result.add(index(FiscalNumbers.key(x[0],f.getString(x[1]),f.getString(x[2]))));}catch(Exception e){if(strict)throw e;}
            }
        }return result;
    }
    private String existing(SQLiteDatabase db,String id)throws Exception{try(Cursor c=db.rawQuery("SELECT body FROM records WHERE id=?",new String[]{id})){return c.moveToFirst()?open(id,c.getBlob(0)):null;}}
    private boolean same(JSONObject a,JSONObject b)throws Exception{return a.getString("payload").equals(b.getString("payload"))&&a.getString("kind").equals(b.getString("kind"));}
    private String insert(SQLiteDatabase db,JSONObject row,boolean strict)throws Exception{
        String id=row.getString("id");if(!DriveSync.valid(row,id))throw new IOException("Invalid record");
        String old=existing(db,id);if(old!=null){if(same(new JSONObject(old),row))return "Already archived";throw new IOException("Record ID conflict; existing data retained");}
        Set<String> keys=keys(row,strict);
        if(strict)for(String k:keys)try(Cursor c=db.rawQuery("SELECT record_id FROM doc_keys WHERE k=?",new String[]{k})){if(c.moveToFirst()){if(same(new JSONObject(existing(db,c.getString(0))),row))return "Already archived";throw new IOException("Duplicate document number. Draft retained; review History.");}}
        ContentValues v=new ContentValues();v.put("id",id);v.put("kind",row.getString("kind"));v.put("saved",row.optLong("saved"));v.put("body",seal(id,row.toString()));db.insertOrThrow("records",null,v);
        for(String k:keys){ContentValues i=new ContentValues();i.put("k",k);i.put("record_id",id);db.insertOrThrow("doc_keys",null,i);}return "Document archived";
    }
    synchronized void migrate(SharedPreferences prefs)throws Exception{
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try{if(!"1".equals(meta(db,"v3_migrated"))){for(Map.Entry<String,?> e:prefs.getAll().entrySet())if(e.getKey().startsWith("r:")){JSONObject r=new JSONObject((String)e.getValue());if(!e.getKey().equals("r:"+r.getString("id")))throw new IOException("Legacy ID mismatch");insert(db,r,false);}meta(db,"v3_migrated","1");}db.setTransactionSuccessful();}finally{db.endTransaction();}
    }
    synchronized String put(JSONObject row,boolean strict)throws Exception{SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{String result=insert(db,row,strict);db.setTransactionSuccessful();return result;}finally{db.endTransaction();}}
    synchronized int merge(JSONArray rows)throws Exception{SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{int count=0;for(int i=0;i<rows.length();i++)if("Document archived".equals(insert(db,rows.getJSONObject(i),false)))count++;db.setTransactionSuccessful();return count;}finally{db.endTransaction();}}
    synchronized JSONArray rows(String kind)throws Exception{JSONArray out=new JSONArray();boolean all=kind.equals("all");try(Cursor c=getReadableDatabase().rawQuery("SELECT id,body FROM records"+(all?"":" WHERE kind=?")+" ORDER BY saved DESC",all?null:new String[]{kind})){while(c.moveToNext())out.put(new JSONObject(open(c.getString(0),c.getBlob(1))));}return out;}
    synchronized boolean has(String id){try(Cursor c=getReadableDatabase().rawQuery("SELECT 1 FROM records WHERE id=?",new String[]{id})){return c.moveToFirst();}}
    synchronized int conflictCount(){try(Cursor c=getReadableDatabase().rawQuery("SELECT COUNT(*) FROM (SELECT k FROM doc_keys GROUP BY k HAVING COUNT(*)>1)",null)){return c.moveToFirst()?c.getInt(0):0;}}
    synchronized String series(){return meta(getReadableDatabase(),"device_series");}
    synchronized void setSeries(String value){SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{String old=meta(db,"device_series"),s=FiscalNumbers.series(value);if(!old.isEmpty()&&!old.equals(s))throw new IllegalArgumentException("Device series already assigned");meta(db,"device_series",s);db.setTransactionSuccessful();}finally{db.endTransaction();}}
    synchronized String reserve(String type,String date)throws Exception{SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{
        String series=meta(db,"device_series");if(series.isEmpty())throw new IOException("Assign a unique device series in Setup first");
        int year=FiscalNumbers.year(date);String k=type+":"+year+":"+series;long last=0;try(Cursor c=db.rawQuery("SELECT last FROM sequences WHERE k=?",new String[]{k})){if(c.moveToFirst())last=c.getLong(0);}
        String next;boolean used;do{next=FiscalNumbers.format(type,year,series,++last);try(Cursor c=db.rawQuery("SELECT 1 FROM doc_keys WHERE k=?",new String[]{index(FiscalNumbers.key(type,date,next))})){used=c.moveToFirst();}}while(used);
        ContentValues v=new ContentValues();v.put("k",k);v.put("last",last);if(db.insertWithOnConflict("sequences",null,v,SQLiteDatabase.CONFLICT_REPLACE)==-1)throw new IOException("Sequence save failed");db.setTransactionSuccessful();return next;
    }finally{db.endTransaction();}}
    synchronized String readDraft(String kind)throws Exception{if(!kind.equals("export")&&!kind.equals("domestic"))throw new IOException("Invalid draft type");try(Cursor c=getReadableDatabase().rawQuery("SELECT body FROM drafts WHERE kind=?",new String[]{kind})){return c.moveToFirst()?open("draft:"+kind,c.getBlob(0)):"";}}
    synchronized void saveDraft(String kind,String text)throws Exception{if(!kind.equals("export")&&!kind.equals("domestic"))throw new IOException("Invalid draft type");if(text.length()>10000000)throw new IOException("Draft too large");JSONObject draft=new JSONObject(text);if(kind.equals("export")&&(draft.optInt("version")!=2||draft.optJSONObject("fields")==null||draft.optJSONArray("items")==null||draft.optJSONArray("packages")==null))throw new IOException("Invalid export draft");if(kind.equals("domestic")&&(draft.optInt("version")!=1||draft.optJSONObject("seller")==null||draft.optJSONObject("buyer")==null||draft.optJSONArray("items")==null))throw new IOException("Invalid domestic draft");readDraft(kind);ContentValues v=new ContentValues();v.put("kind",kind);v.put("body",seal("draft:"+kind,text));if(getWritableDatabase().insertWithOnConflict("drafts",null,v,SQLiteDatabase.CONFLICT_REPLACE)==-1)throw new IOException("Draft save failed");}
    synchronized String recoveryCode()throws Exception{
        String stored=meta(getReadableDatabase(),"recovery_code_v4");
        return stored.isEmpty()?"":open("recovery-code",android.util.Base64.decode(stored,android.util.Base64.NO_WRAP));
    }
    synchronized void setRecoveryCode(String code)throws Exception{
        String clean=code.trim().replace("-","").replace(" ","").toLowerCase(java.util.Locale.ROOT);
        BackupCrypto.key(clean);
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try{
            String old=recoveryCode();
            if(!old.isEmpty()&&!old.equals(clean))throw new IOException("Existing recovery code cannot be replaced");
            if(old.isEmpty())meta(db,"recovery_code_v4",android.util.Base64.encodeToString(seal("recovery-code",clean),android.util.Base64.NO_WRAP));
            db.setTransactionSuccessful();
        }finally{db.endTransaction();}
    }

    private String masterKey(String kind)throws IOException{
        if(!kind.equals("customer")&&!kind.equals("product"))throw new IOException("Unknown master type");return "master:"+kind;
    }
    synchronized JSONArray masterRows(String kind)throws Exception{
        String k=masterKey(kind),stored=meta(getReadableDatabase(),k);
        return stored.isEmpty()?new JSONArray():new JSONArray(open(k,android.util.Base64.decode(stored,android.util.Base64.NO_WRAP)));
    }
    private String masterText(JSONObject raw,String field,int max)throws Exception{
        String v=raw.optString(field,"").trim();
        if(v.length()>max)throw new IOException("Master field too long");return v;
    }
    synchronized String saveMaster(String kind,String id,String payload)throws Exception{
        if(payload.length()>40000)throw new IOException("Master entry too large");
        String k=masterKey(kind);JSONObject raw=new JSONObject(payload),clean=new JSONObject();
        if(kind.equals("customer")){
            for(String field:new String[]{"name","address","gstin","state","contact"})clean.put(field,masterText(raw,field,field.equals("address")?10000:500));
            if(clean.getString("name").isEmpty()||clean.getString("address").isEmpty()||!clean.getString("state").matches("[0-9]{2}"))throw new IOException("Customer name, address and state are required");
            String gstin=clean.getString("gstin").toUpperCase(java.util.Locale.ROOT);if(!gstin.isEmpty()&&(!gstin.matches("[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]")||!gstin.startsWith(clean.getString("state"))))throw new IOException("Invalid customer GSTIN/state");clean.put("gstin",gstin);
        }else{
            for(String field:new String[]{"description","hsn","unit"})clean.put(field,masterText(raw,field,field.equals("description")?10000:100));
            if(clean.getString("description").isEmpty()||clean.getString("unit").isEmpty())throw new IOException("Product description and unit required");
            double rate=raw.getDouble("rate"),gst=raw.getDouble("gst");if(!Double.isFinite(rate)||rate<0||rate>1e9||!Double.isFinite(gst)||gst<0||gst>100)throw new IOException("Invalid product rate or tax");
            clean.put("rate",rate).put("gst",gst);
        }
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
        try{
            JSONArray all=masterRows(kind);int existing=-1;
            if(id.isEmpty()){id=UUID.randomUUID().toString();}
            else{if(!UUID.fromString(id).toString().equals(id))throw new IOException("Invalid master ID");for(int n=0;n<all.length();n++)if(id.equals(all.getJSONObject(n).getString("id"))){existing=n;break;}if(existing<0)throw new IOException("Master entry no longer exists");}
            JSONObject entry=new JSONObject().put("id",id).put("value",clean).put("updated",System.currentTimeMillis());
            if(existing>=0)all.put(existing,entry);else{if(all.length()>=1000)throw new IOException("Local master limit reached");all.put(entry);}
            String json=all.toString();if(json.length()>4_000_000)throw new IOException("Master storage limit reached");
            meta(db,k,android.util.Base64.encodeToString(seal(k,json),android.util.Base64.NO_WRAP));db.setTransactionSuccessful();return id;
        }finally{db.endTransaction();}
    }

}
