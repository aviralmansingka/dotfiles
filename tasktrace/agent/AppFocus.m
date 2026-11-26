// NSWorkspace activation agent: one JSON line per app activation, written to
// the collector's unix socket.  The collector stamps ts/mono, so the agent
// reports only what changed.
//
// Built with clang (Apple's Swift toolchain needs an SDK-matched compiler):
//   clang -fobjc-arc -O2 -framework AppKit -framework CoreGraphics -o AppFocus AppFocus.m

#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#include <math.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

static void sendEvent(NSDictionary *fields) {
    NSData *json = [NSJSONSerialization dataWithJSONObject:fields options:0 error:NULL];
    if (json == nil) {
        return;
    }
    NSMutableData *line = [json mutableCopy];
    const char newline = '\n';
    [line appendBytes:&newline length:1];

    const char *path = getenv("TASKTRACE_SOCK");
    if (path == NULL || path[0] == '\0') {
        fwrite(line.bytes, 1, line.length, stdout);
        fflush(stdout);
        return;
    }

    int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) {
        return;
    }
    struct sockaddr_un address;
    memset(&address, 0, sizeof(address));
    address.sun_family = AF_UNIX;
    strlcpy(address.sun_path, path, sizeof(address.sun_path));
    if (connect(fd, (struct sockaddr *)&address, sizeof(address)) == 0) {
        write(fd, line.bytes, line.length);
        char answer[256];
        read(fd, answer, sizeof(answer));
    }
    close(fd);
}

static double idleSeconds(void) {
    CGEventType types[] = {
        kCGEventKeyDown,
        kCGEventMouseMoved,
        kCGEventLeftMouseDown,
        kCGEventRightMouseDown,
        kCGEventScrollWheel,
        kCGEventFlagsChanged,
    };
    double best = 1e9;
    for (size_t index = 0; index < sizeof(types) / sizeof(types[0]); index++) {
        double seconds = CGEventSourceSecondsSinceLastEventType(
            kCGEventSourceStateCombinedSessionState, types[index]);
        if (seconds < best) {
            best = seconds;
        }
    }
    return round(best * 1000.0) / 1000.0;
}

static void report(NSRunningApplication *app, NSString *why) {
    if (app == nil) {
        return;
    }
    sendEvent(@{
        @"kind" : @"app",
        @"app" : app.localizedName ?: @"",
        @"bundle" : app.bundleIdentifier ?: @"",
        @"idle_s" : @(idleSeconds()),
        @"source" : @"nsworkspace",
        @"detail" : @{@"pid" : @(app.processIdentifier), @"why" : why},
    });
}

int main(void) {
    @autoreleasepool {
        NSWorkspace *workspace = NSWorkspace.sharedWorkspace;
        NSNotificationCenter *center = workspace.notificationCenter;

        report(workspace.frontmostApplication, @"start");

        [center addObserverForName:NSWorkspaceDidActivateApplicationNotification
                             object:nil
                              queue:NSOperationQueue.mainQueue
                         usingBlock:^(NSNotification *note) {
                           report(note.userInfo[NSWorkspaceApplicationKey], @"activate");
                         }];

        [center addObserverForName:NSWorkspaceDidLaunchApplicationNotification
                             object:nil
                              queue:NSOperationQueue.mainQueue
                         usingBlock:^(NSNotification *note) {
                           report(note.userInfo[NSWorkspaceApplicationKey], @"launch");
                         }];

        [NSRunLoop.mainRunLoop run];
    }
    return 0;
}
