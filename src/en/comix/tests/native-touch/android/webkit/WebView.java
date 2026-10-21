package android.webkit;
import android.view.MotionEvent;
import java.util.ArrayList;
import java.util.List;
public final class WebView {
    private int width;
    private int height;
    public boolean ignoreLayout;
    public int measuredWidth;
    public int measuredHeight;
    public final List<MotionEvent> events = new ArrayList<>();
    public WebView(int width) { this.width=width; }
    public int getWidth() { return width; }
    public int getHeight() { return height; }
    public void measure(int widthSpec, int heightSpec) {
        if ((widthSpec & 0xc0000000) != 0x40000000 || (heightSpec & 0xc0000000) != 0x40000000)
            throw new AssertionError("viewport must use exact sizing");
        measuredWidth=widthSpec & 0x3fffffff; measuredHeight=heightSpec & 0x3fffffff;
    }
    public void layout(int left, int top, int right, int bottom) {
        if (right-left!=measuredWidth || bottom-top!=measuredHeight)
            throw new AssertionError("measure/layout mismatch");
        if (!ignoreLayout) { width=right-left; height=bottom-top; }
    }
    // Deliberately no getResources()/DisplayMetrics API: any access fails linkage.
    public boolean dispatchTouchEvent(MotionEvent event) { events.add(event); return true; }
    public abstract static class VisualStateCallback { public abstract void onComplete(long requestId); }
    public void postVisualStateCallback(long id, VisualStateCallback callback) { callback.onComplete(id); }
}
