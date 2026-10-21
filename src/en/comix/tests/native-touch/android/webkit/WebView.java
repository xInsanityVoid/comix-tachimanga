package android.webkit;
import android.view.MotionEvent;
import java.util.ArrayList;
import java.util.List;
public final class WebView {
    private final int width;
    public final List<MotionEvent> events = new ArrayList<>();
    public WebView(int width) { this.width=width; }
    public int getWidth() { return width; }
    // Deliberately no getResources()/DisplayMetrics API: any access fails linkage.
    public boolean dispatchTouchEvent(MotionEvent event) { events.add(event); return true; }
    public abstract static class VisualStateCallback { public abstract void onComplete(long requestId); }
    public void postVisualStateCallback(long id, VisualStateCallback callback) { callback.onComplete(id); }
}
