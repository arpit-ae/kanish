package in.usoagroup.exportbilling;
public final class FiscalNumbersTest {
    static void eq(Object expected,Object actual){if(!expected.equals(actual))throw new AssertionError(expected+" != "+actual);}
    static void bad(Runnable test){try{test.run();throw new AssertionError("Expected rejection");}catch(IllegalArgumentException|java.time.DateTimeException expected){}}
    public static void main(String[] args){
        eq(2025,FiscalNumbers.year("2026-03-31"));
        eq(2026,FiscalNumbers.year("2026-04-01"));
        eq("UG/26/A/00001",FiscalNumbers.format("gst",2026,"a",1));
        eq("EX/26/B/99999",FiscalNumbers.format("commercial",2026,"B",99999));
        eq(FiscalNumbers.key("gst","2026-04-01","UG/26/A/00001"),FiscalNumbers.key("commercial","2026-11-01","ug/26/a/00001"));
        if(FiscalNumbers.format("gst",2026,"AA",1).length()>16)throw new AssertionError("Too long");
        bad(()->FiscalNumbers.format("gst",2026,"AAA",1));
        bad(()->FiscalNumbers.format("gst",2026,"A",100000));
        bad(()->FiscalNumbers.normalized("INVALID NUMBER"));
        bad(()->FiscalNumbers.year("2026-02-30"));
        System.out.println("10 fiscal numbering assertions passed");
    }
}
