#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>

@class CGVirtualDisplay;

@interface CGVirtualDisplayDescriptor : NSObject
@property(retain, nonatomic) dispatch_queue_t queue;
@property(retain, nonatomic) NSString *name;
@property(nonatomic) unsigned int maxPixelsHigh;
@property(nonatomic) unsigned int maxPixelsWide;
@property(nonatomic) CGSize sizeInMillimeters;
@property(nonatomic) unsigned int serialNum;
@property(nonatomic) unsigned int productID;
@property(nonatomic) unsigned int vendorID;
@property(copy, nonatomic) void (^terminationHandler)(id, CGVirtualDisplay *);
@end

@interface CGVirtualDisplayMode : NSObject
@property(readonly, nonatomic) CGFloat refreshRate;
@property(readonly, nonatomic) NSUInteger width;
@property(readonly, nonatomic) NSUInteger height;
- (instancetype)initWithWidth:(NSUInteger)width height:(NSUInteger)height refreshRate:(CGFloat)refreshRate;
@end

@interface CGVirtualDisplaySettings : NSObject
@property(retain, nonatomic) NSArray<CGVirtualDisplayMode *> *modes;
@property(nonatomic) unsigned int hiDPI;
@end

@interface CGVirtualDisplay : NSObject
@property(readonly, nonatomic) CGDirectDisplayID displayID;
- (instancetype)initWithDescriptor:(CGVirtualDisplayDescriptor *)descriptor;
- (BOOL)applySettings:(CGVirtualDisplaySettings *)settings;
@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSUInteger width = argc > 1 ? (NSUInteger)atoi(argv[1]) : 1600;
        NSUInteger height = argc > 2 ? (NSUInteger)atoi(argv[2]) : 1000;
        if (!NSClassFromString(@"CGVirtualDisplay")) {
            fprintf(stderr, "hidpi-display: this macOS has no CGVirtualDisplay\n");
            return 2;
        }
        CGVirtualDisplayDescriptor *descriptor = [[NSClassFromString(@"CGVirtualDisplayDescriptor") alloc] init];
        descriptor.queue = dispatch_get_main_queue();
        descriptor.name = @"Open Historia CI Retina";
        descriptor.maxPixelsWide = (unsigned int)(width * 2);
        descriptor.maxPixelsHigh = (unsigned int)(height * 2);
        descriptor.sizeInMillimeters = CGSizeMake(width * 25.4 / 110.0, height * 25.4 / 110.0);
        descriptor.serialNum = 0x4f48;
        descriptor.productID = 0x4f48;
        descriptor.vendorID = 0x4f48;
        descriptor.terminationHandler = ^(id display, CGVirtualDisplay *virtualDisplay) {
            fprintf(stderr, "hidpi-display: the system ended the display\n");
            exit(3);
        };
        CGVirtualDisplay *display = [[NSClassFromString(@"CGVirtualDisplay") alloc] initWithDescriptor:descriptor];
        if (!display) {
            fprintf(stderr, "hidpi-display: the display could not be made\n");
            return 4;
        }
        CGVirtualDisplaySettings *settings = [[NSClassFromString(@"CGVirtualDisplaySettings") alloc] init];
        settings.hiDPI = 1;
        settings.modes = @[
            [[NSClassFromString(@"CGVirtualDisplayMode") alloc] initWithWidth:width * 2 height:height * 2 refreshRate:60],
            [[NSClassFromString(@"CGVirtualDisplayMode") alloc] initWithWidth:width height:height refreshRate:60],
        ];
        if (![display applySettings:settings]) {
            fprintf(stderr, "hidpi-display: the HiDPI mode was refused\n");
            return 5;
        }
        printf("hidpi-display: display %u, %lux%lu points at 2x\n", display.displayID, (unsigned long)width, (unsigned long)height);
        fflush(stdout);
        [[NSRunLoop mainRunLoop] run];
    }
    return 0;
}
