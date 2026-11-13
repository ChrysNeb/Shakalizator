package space.shakalizator.app;
public final class ExportNames {
    private ExportNames(){}
    public static String clean(String name){String s=name==null?"shakal-result":name.replaceAll("[\\p{Cntrl}/\\\\:*?\"<>|]","_").trim();while(s.startsWith("."))s=s.substring(1);return s.isEmpty()?"shakal-result":s.substring(0,Math.min(150,s.length()));}
    public static String mime(String mime){return mime!=null&&mime.matches("[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+")?mime:"application/octet-stream";}
}
