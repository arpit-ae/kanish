package in.usoagroup.exportbilling;

import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Portable authenticated encryption. The 256-bit recovery code must be kept offline by the owner. */
final class BackupCrypto {
    private static final SecureRandom RNG=new SecureRandom();
    static String generate(){byte[] b=new byte[32];RNG.nextBytes(b);StringBuilder s=new StringBuilder();for(byte x:b)s.append(String.format(java.util.Locale.ROOT,"%02x",x&255));return s.toString();}
    static byte[] key(String code){
        String s=code.trim().replace("-","").replace(" ","");
        if(!s.matches("[0-9a-fA-F]{64}"))throw new IllegalArgumentException("Use the original 64-character recovery code");
        byte[] b=new byte[32];for(int i=0;i<32;i++)b[i]=(byte)Integer.parseInt(s.substring(i*2,i*2+2),16);return b;
    }
    static String seal(String code,String context,String plain)throws Exception{
        byte[] iv=new byte[12];RNG.nextBytes(iv);
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(key(code),"AES"),new GCMParameterSpec(128,iv));
        c.updateAAD(("USOA-v4:"+context).getBytes(StandardCharsets.UTF_8));
        byte[] body=c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] out=new byte[iv.length+body.length];System.arraycopy(iv,0,out,0,iv.length);System.arraycopy(body,0,out,iv.length,body.length);
        return Base64.getEncoder().encodeToString(out);
    }
    static String open(String code,String context,String encoded)throws Exception{
        byte[] b=Base64.getDecoder().decode(encoded);if(b.length<28)throw new IllegalArgumentException("Invalid encrypted backup");
        Cipher c=Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key(code),"AES"),new GCMParameterSpec(128,b,0,12));
        c.updateAAD(("USOA-v4:"+context).getBytes(StandardCharsets.UTF_8));
        return new String(c.doFinal(b,12,b.length-12),StandardCharsets.UTF_8);
    }
}
