package android.os;
public final class Handler {
    public Handler(Looper looper) {}
    // Execute scheduled frames immediately; this harness checks events, not wall time.
    public boolean postDelayed(Runnable runnable, long delay) { runnable.run(); return true; }
    public void removeCallbacks(Runnable runnable) {}
}
