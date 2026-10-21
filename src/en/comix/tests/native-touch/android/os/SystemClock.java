package android.os;
public final class SystemClock {
    private static long now = 100;
    public static long uptimeMillis() { return now += 10; }
}
