#import <Cocoa/Cocoa.h>

// 仅把原生按钮移到已为它们预留的 84×64 区域，不替换系统按钮行为。
@interface AGCTrafficLights : NSView
@end
@implementation AGCTrafficLights
- (NSView *)hitTest:(NSPoint)point {
    NSView *hit = [super hitTest:point];
    return hit == self ? nil : hit;
}
@end

void agcLayoutTrafficLights(void *handle) {
    NSWindow *window = (NSWindow *)handle;
    NSView *content = window.contentView;
    if (!content) return;
    AGCTrafficLights *host = nil;
    for (NSView *view in content.subviews) {
        if ([view isKindOfClass:[AGCTrafficLights class]]) { host = (AGCTrafficLights *)view; break; }
    }
    if (!host) {
        host = [[AGCTrafficLights alloc] initWithFrame:NSMakeRect(0, 0, 84, 64)];
        [content addSubview:host positioned:NSWindowAbove relativeTo:nil];
        [host release];
    }
    host.hidden = (window.styleMask & NSWindowStyleMaskFullScreen) != 0;
    host.frame = NSMakeRect(0, content.isFlipped ? 0 : NSHeight(content.bounds)-64, 84, 64);
    NSWindowButton types[] = {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton};
    for (int i=0; i<3; i++) {
        NSButton *button = [window standardWindowButton:types[i]];
        if (!button) continue;
        if (button.superview != host) { [button retain]; [button removeFromSuperview]; [host addSubview:button]; [button release]; }
        NSRect frame = button.frame;
        frame.origin = NSMakePoint(12+i*20, (64-NSHeight(frame))/2);
        button.frame = frame;
        button.hidden = NO;
    }
}

#ifdef AGC_DESKTOP_QA
int agcCaptureWindow(void *handle, const char *imagePath, const char *metricsPath) {
    NSWindow *window = (NSWindow *)handle;
    NSView *content = window.contentView;
    if (!content) return 1;
    NSMutableArray *lights = [NSMutableArray array];
    NSWindowButton types[] = {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton};
    for (int i=0;i<3;i++) {
        NSButton *button=[window standardWindowButton:types[i]];
        NSRect frame=[button convertRect:button.bounds toView:content];
        [lights addObject:@{@"x":@(NSMidX(frame)),@"yFromTop":@(NSHeight(content.bounds)-NSMidY(frame)),@"enabled":@(button.enabled)}];
    }
    NSDictionary *metrics=@{@"width":@(NSWidth(window.frame)),@"height":@(NSHeight(window.frame)),@"lights":lights};
    NSData *json=[NSJSONSerialization dataWithJSONObject:metrics options:NSJSONWritingPrettyPrinted error:nil];
    [json writeToFile:[NSString stringWithUTF8String:metricsPath] atomically:YES];
    NSBitmapImageRep *bitmap=[content bitmapImageRepForCachingDisplayInRect:content.bounds];
    [content cacheDisplayInRect:content.bounds toBitmapImageRep:bitmap];
    NSData *png=[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    return [png writeToFile:[NSString stringWithUTF8String:imagePath] atomically:YES]?0:2;
}
#endif
