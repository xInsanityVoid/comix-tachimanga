package keiyoushi.utils;
import android.webkit.WebView;
import kotlin.Unit;
import kotlin.jvm.functions.Function1;
public final class WebViewScope<T> {
    private final WebView view;
    public WebViewScope(WebView view) { this.view=view; }
    public void withNativeWebView(Function1<? super WebView, Unit> block) { block.invoke(view); }
    public void reject(Throwable error) { throw new AssertionError("Unexpected native error", error); }
}
