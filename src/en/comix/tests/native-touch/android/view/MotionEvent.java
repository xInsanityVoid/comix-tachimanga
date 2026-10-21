package android.view;
public final class MotionEvent {
    public final long downTime, eventTime;
    public final int action;
    public final float x, y;
    public int source;
    public boolean recycled;
    private MotionEvent(long down, long time, int action, float x, float y) {
        this.downTime=down; this.eventTime=time; this.action=action; this.x=x; this.y=y;
    }
    public static MotionEvent obtain(long down, long time, int action, float x, float y, int meta) {
        return new MotionEvent(down,time,action,x,y);
    }
    public void setSource(int source) { this.source=source; }
    public void recycle() { recycled=true; }
}
