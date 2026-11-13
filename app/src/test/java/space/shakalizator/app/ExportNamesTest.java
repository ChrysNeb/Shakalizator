package space.shakalizator.app;
import org.junit.Test;import static org.junit.Assert.*;
public class ExportNamesTest {
    @Test public void stripsPathsAndControlCharacters(){String s=ExportNames.clean("../../photo\n.jpg");assertFalse(s.contains("/"));assertFalse(s.contains("\n"));assertFalse(s.startsWith("."));}
    @Test public void preservesCyrillicAndExtensions(){assertEquals("шакал-фраза.txt",ExportNames.clean("шакал-фраза.txt"));assertEquals("audio.dsf",ExportNames.clean("audio.dsf"));}
    @Test public void safeFallback(){assertEquals("shakal-result",ExportNames.clean(null));assertEquals("shakal-result",ExportNames.clean("..."));assertEquals("application/octet-stream",ExportNames.mime("text/html\nInjected: yes"));assertEquals("audio/ogg",ExportNames.mime("audio/ogg"));}
}
