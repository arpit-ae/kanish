package in.usoagroup.exportbilling;
import java.time.LocalDate;
import java.util.Locale;
final class FiscalNumbers {
    static int year(String date){LocalDate d=LocalDate.parse(date);if(d.getYear()<2001||d.getYear()>2099)throw new IllegalArgumentException("Unsupported financial year");return d.getMonthValue()>=4?d.getYear():d.getYear()-1;}
    static String normalized(String value){String n=value.trim().toUpperCase(Locale.ROOT);if(!n.matches("[A-Z0-9/-]{1,16}"))throw new IllegalArgumentException("Document number must contain 1–16 letters, digits, / or -");return n;}
    static String series(String value){String s=value.trim().toUpperCase(Locale.ROOT);if(!s.matches("[A-Z]{1,2}"))throw new IllegalArgumentException("Use one or two letters for the series");return s;}
    static String prefix(String t){switch(t){case "gst":return "UG";case "commercial":return "EX";case "proforma":return "PI";case "packing":return "PL";case "challan":return "DC";default:throw new IllegalArgumentException("Unknown type");}}
    static String format(String t,int year,String series,long serial){if(year<2000||year>2099||serial<1||serial>99999)throw new IllegalArgumentException("Invalid year or exhausted sequence");return normalized(String.format(Locale.ROOT,"%s/%02d/%s/%05d",prefix(t),year%100,series(series),serial));}
    static String key(String type,String date,String number){prefix(type);return (type.equals("commercial")?"gst":type)+":"+year(date)+":"+normalized(number);}
}
