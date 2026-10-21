import android.webkit.WebView;
import android.view.MotionEvent;
import keiyoushi.utils.WebViewScope;
import eu.kanade.tachiyomi.extension.en.comix.SwipeKt;
import eu.kanade.tachiyomi.extension.en.comix.TouchInput;
import eu.kanade.tachiyomi.extension.en.comix.ViewportKt;

public final class NativeTouchHarness {
    public static void main(String[] args) {
        WebView detached=new WebView(0);
        WebViewScope<?> detachedScope=new WebViewScope<>(detached);
        ViewportKt.configureViewport(detachedScope);
        check(detached.getWidth()>0 && detached.getHeight()>0,"detached viewport remained empty");
        SwipeKt.tap(detachedScope,50,100,detached.getWidth());
        verifyGesture(detached,50,100,50,100);
        WebView unsupported=new WebView(0);
        unsupported.ignoreLayout=true;
        try { ViewportKt.configureViewport(new WebViewScope<>(unsupported)); throw new AssertionError("ignored failed layout"); }
        catch(IllegalStateException expected) { check(expected.getMessage().contains("host did not size"),"missing layout diagnostic"); }
        check(unsupported.events.isEmpty(),"sent input to unsized view");
        for (int nativeWidth : new int[] {360,720,1080}) {
            float scale=nativeWidth/360f;
            WebView tapView=new WebView(nativeWidth);
            TouchInput tap=TouchInput.Companion.parse("360,50,100");
            SwipeKt.tap(new WebViewScope<>(tapView),tap.getPoints().get(0),tap.getPoints().get(1),tap.getViewportWidth());
            verifyGesture(tapView,50*scale,100*scale,50*scale,100*scale);
            check(tapView.events.size()>=2 && tapView.events.size()<=4,"tap frame count");
            WebView swipeView=new WebView(nativeWidth);
            TouchInput swipe=TouchInput.Companion.parse("360,50,200,50,50");
            SwipeKt.swipe(new WebViewScope<>(swipeView),swipe.getPoints().get(0),swipe.getPoints().get(1),
                swipe.getPoints().get(2),swipe.getPoints().get(3),swipe.getViewportWidth());
            verifyGesture(swipeView,50*scale,200*scale,50*scale,50*scale);
            float previous=Float.POSITIVE_INFINITY;
            for(MotionEvent event:swipeView.events) {
                check(event.y<=previous+0.001f,"swipe reversed direction"); previous=event.y;
            }
        }
        for(String invalid:new String[]{"50,100","0,50,100","NaN,50,100","360,50,Infinity","360,x,20","360,1,2,3"}) {
            try { TouchInput.Companion.parse(invalid); throw new AssertionError("accepted invalid input: "+invalid); }
            catch(IllegalArgumentException expected) {}
        }
        try { SwipeKt.tap(new WebViewScope<>(new WebView(0)),50,100,360); throw new AssertionError("accepted zero-width view"); }
        catch(IllegalArgumentException expected) { check(expected.getMessage().contains("WebView width"),"missing width diagnostic"); }
        System.out.println("PASS: compiled viewport layout from zero without Resources; rejected unsupported layout; taps/swipes, 1x/2x/3x scaling, event order, recycling and invalid inputs");
    }
    private static void verifyGesture(WebView view,float x1,float y1,float x2,float y2) {
        MotionEvent first=view.events.get(0),last=view.events.get(view.events.size()-1);
        check(first.action==0 && last.action==1,"missing DOWN/UP");
        check(Math.abs(first.x-x1)<0.001f && Math.abs(first.y-y1)<0.001f,"start coordinates");
        check(Math.abs(last.x-x2)<0.001f && Math.abs(last.y-y2)<0.001f,"end coordinates");
        for(int i=0;i<view.events.size();i++) {
            MotionEvent event=view.events.get(i);
            check(event.downTime==first.downTime,"down time changed");
            check(event.eventTime>=event.downTime,"invalid event time");
            check(event.source==4098,"wrong event source");
            check(event.recycled,"unrecycled event");
            if(i>0 && i<view.events.size()-1) check(event.action==2,"unexpected middle event");
        }
    }
    private static void check(boolean condition,String message) { if(!condition) throw new AssertionError(message); }
}
