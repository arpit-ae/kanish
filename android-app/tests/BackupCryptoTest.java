package in.usoagroup.exportbilling;
public final class BackupCryptoTest {
    interface Checked{void run()throws Exception;}
    static void fails(Checked c)throws Exception{try{c.run();}catch(Exception e){return;}throw new AssertionError("Expected rejection");}
    public static void main(String[] args)throws Exception{
        String key=BackupCrypto.generate(),other=BackupCrypto.generate(),s="{\"amount\":1180,\"name\":\"हनी\"}";
        if(key.length()!=64||key.equals(other))throw new AssertionError("Key generation");
        String a=BackupCrypto.seal(key,"record:a",s),b=BackupCrypto.seal(key,"record:a",s);
        if(a.equals(b)||a.contains(s)||!s.equals(BackupCrypto.open(key,"record:a",a)))throw new AssertionError("Encryption");
        fails(()->BackupCrypto.open(other,"record:a",a));
        fails(()->BackupCrypto.open(key,"record:b",a));
        byte[] t=java.util.Base64.getDecoder().decode(a);t[t.length-1]^=1;
        fails(()->BackupCrypto.open(key,"record:a",java.util.Base64.getEncoder().encodeToString(t)));
        fails(()->BackupCrypto.key("1234"));
        System.out.println("Portable encryption: round-trip, random nonce, wrong key, wrong context, tampering, invalid key checks passed");
    }
}
