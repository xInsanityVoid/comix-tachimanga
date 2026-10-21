package android.view;
public class View {
    public static class MeasureSpec {
        public static final int EXACTLY=0x40000000;
        public static int makeMeasureSpec(int size, int mode) { return size | mode; }
    }
}
