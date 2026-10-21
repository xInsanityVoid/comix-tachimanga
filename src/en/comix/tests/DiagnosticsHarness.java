import eu.kanade.tachiyomi.extension.en.comix.DiagnosticsKt;
import java.io.IOException;
import java.util.concurrent.CancellationException;
import kotlin.coroutines.Continuation;
import kotlin.coroutines.CoroutineContext;
import kotlin.coroutines.EmptyCoroutineContext;

// Run against the compiled Kotlin classes; these checks do not emulate iOS.
public final class DiagnosticsHarness {
    private static final Continuation<String> CONTINUATION = new Continuation<>() {
        public CoroutineContext getContext() { return EmptyCoroutineContext.INSTANCE; }
        public void resumeWith(Object result) { throw new AssertionError("Unexpected suspension"); }
    };

    public static void main(String[] args) {
        Object result = DiagnosticsKt.comixStep("success", c -> "unchanged", CONTINUATION);
        check("unchanged".equals(result), "successful return changed");
        NullPointerException original = new NullPointerException("runtime detail");
        original.setStackTrace(new StackTraceElement[] {
            new StackTraceElement("host.WebView", "tap", "WebView.java", 42),
            new StackTraceElement("source.Comix", "input", "Comix.kt", 600),
            new StackTraceElement("source.Bridge", "invoke", null, -1),
            new StackTraceElement("source.More", "invoke", "More.kt", 1),
        });
        try {
            DiagnosticsKt.comixStep("native tap", c -> { throw original; }, CONTINUATION);
            throw new AssertionError("null failure was swallowed");
        } catch (Throwable error) {
            check(error instanceof IOException, "null failure was not contextualized");
            check(error.getCause() == original, "original cause was lost");
            check(error.getMessage().contains("native tap"), "stage missing");
            check(error.getMessage().contains("WebView.tap:42"), "stack location missing");
            check(error.getMessage().indexOf("WebView.tap:42") < 64, "first frame is too late for a cropped error");
            check(!error.getMessage().contains("More.invoke"), "stack is not bounded");
        }
        for (RuntimeException originalError : new RuntimeException[] {
                new CancellationException("cancel"), new IllegalStateException("site error")}) {
            try {
                DiagnosticsKt.comixStep("other failure", c -> { throw originalError; }, CONTINUATION);
                throw new AssertionError("failure was swallowed");
            } catch (Throwable error) {
                check(error == originalError, "unrelated error was changed");
            }
        }
        check(!DiagnosticsKt.isHtmlRequest(null), "missing request headers must not crash");
        check(!DiagnosticsKt.isHtmlRequest(java.util.Map.of()), "missing Accept is not HTML");
        check(DiagnosticsKt.isHtmlRequest(java.util.Map.of("Accept", "text/html,application/xhtml+xml")), "HTML request not recognized");
        check(DiagnosticsKt.isHtmlRequest(java.util.Map.of("accept", "TEXT/HTML")), "header case should not matter");
        check(!DiagnosticsKt.isHtmlRequest(java.util.Map.of("Accept", "application/json")), "JSON mistaken for a document");
        System.out.println("PASS: diagnostics preserve behavior; null/missing/case-insensitive request headers handled");
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
}
