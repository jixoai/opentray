// Copyright 2021 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

#import "LynxWindow.h"
#import "ViewController.h"
#include <stdio.h>

static NSString *const kOpenTrayLynxDebugEnv = @"OPENTRAY_LYNX_DEBUG";
static NSString *const kOpenTrayLynxDebugLogPathEnv =
    @"OPENTRAY_LYNX_DEBUG_LOG_PATH";

static BOOL OpenTrayDebugModeEnabled(NSString *mode) {
  NSString *raw = [NSProcessInfo processInfo].environment[kOpenTrayLynxDebugEnv];
  if (raw.length == 0 || mode.length == 0) {
    return NO;
  }
  for (NSString *token in [raw componentsSeparatedByString:@","]) {
    NSString *normalized =
        [[token stringByTrimmingCharactersInSet:
                   [NSCharacterSet whitespaceAndNewlineCharacterSet]] lowercaseString];
    if (normalized.length == 0) {
      continue;
    }
    if ([normalized isEqualToString:@"all"] ||
        [normalized isEqualToString:[mode lowercaseString]]) {
      return YES;
    }
  }
  return NO;
}

static void OpenTrayDebugWriteLine(NSString *line) {
  if (line.length == 0) {
    return;
  }
  NSString *logPath =
      [NSProcessInfo processInfo].environment[kOpenTrayLynxDebugLogPathEnv];
  FILE *stream = stderr;
  if (logPath.length > 0) {
    stream = fopen(logPath.UTF8String, "a");
  }
  if (stream == NULL) {
    stream = stderr;
  }
  fprintf(stream, "%s\n", line.UTF8String ?: "");
  fflush(stream);
  if (stream != stderr) {
    fclose(stream);
  }
}

static BOOL OpenTrayShouldTraceEvent(NSEventType type) {
  switch (type) {
    case NSEventTypeLeftMouseDown:
    case NSEventTypeLeftMouseUp:
    case NSEventTypeLeftMouseDragged:
    case NSEventTypeRightMouseDown:
    case NSEventTypeRightMouseUp:
    case NSEventTypeRightMouseDragged:
    case NSEventTypeOtherMouseDown:
    case NSEventTypeOtherMouseUp:
    case NSEventTypeOtherMouseDragged:
    case NSEventTypeMouseMoved:
    case NSEventTypeScrollWheel:
      return YES;
    default:
      return NO;
  }
}

static NSString *OpenTrayEventTypeName(NSEventType type) {
  switch (type) {
    case NSEventTypeLeftMouseDown:
      return @"left-down";
    case NSEventTypeLeftMouseUp:
      return @"left-up";
    case NSEventTypeLeftMouseDragged:
      return @"left-dragged";
    case NSEventTypeRightMouseDown:
      return @"right-down";
    case NSEventTypeRightMouseUp:
      return @"right-up";
    case NSEventTypeRightMouseDragged:
      return @"right-dragged";
    case NSEventTypeOtherMouseDown:
      return @"other-down";
    case NSEventTypeOtherMouseUp:
      return @"other-up";
    case NSEventTypeOtherMouseDragged:
      return @"other-dragged";
    case NSEventTypeMouseMoved:
      return @"moved";
    case NSEventTypeScrollWheel:
      return @"scroll";
    default:
      return [NSString stringWithFormat:@"type-%ld", (long)type];
  }
}

static NSString *OpenTrayHitViewName(NSWindow *window, NSEvent *event) {
  NSView *contentView = window.contentView;
  if (contentView == nil) {
    return @"nil";
  }
  NSPoint contentPoint = [contentView convertPoint:event.locationInWindow
                                          fromView:nil];
  NSView *hitView = [contentView hitTest:contentPoint];
  return hitView ? NSStringFromClass(hitView.class) : @"nil";
}

@interface LynxWindow ()

@property(nonatomic, strong) NSButton *refresh_btn;

@end

@implementation LynxWindow

- (instancetype)init {
  self = [super init];
  if (self) {
    [self initUI];
  }
  return self;
}

- (void)initUI {
  NSUInteger style = NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable |
                     NSWindowStyleMaskTitled | NSWindowStyleMaskResizable;
  [self setStyleMask:style];
  self.titlebarAppearsTransparent = YES;
  if (OpenTrayDebugModeEnabled(@"host-events")) {
    OpenTrayDebugWriteLine(
        [NSString stringWithFormat:
                      @"[opentray][host-input] stage=window-init styleMask=%lu titlebarTransparent=%d",
                      (unsigned long)style, self.titlebarAppearsTransparent ? 1 : 0]);
  }
}

- (void)sendEvent:(NSEvent *)event {
  BOOL traceHostEvents = OpenTrayDebugModeEnabled(@"host-events");
  BOOL traceHostTitle = OpenTrayDebugModeEnabled(@"host-title");
  if ((traceHostEvents || traceHostTitle) && OpenTrayShouldTraceEvent(event.type)) {
    NSString *eventName = OpenTrayEventTypeName(event.type);
    NSString *hitViewName = OpenTrayHitViewName(self, event);
    NSString *firstResponderName =
        self.firstResponder ? NSStringFromClass([self.firstResponder class]) : @"nil";
    NSString *message = [NSString
        stringWithFormat:
            @"[opentray][host-input] stage=send-event type=%@ button=%ld clicks=%ld phase=%ld momentum=%ld location=(%.1f,%.1f) delta=(%.2f,%.2f) hit=%@ firstResponder=%@ movable=%d key=%d main=%d",
            eventName, (long)event.buttonNumber, (long)event.clickCount,
            (long)event.phase, (long)event.momentumPhase, event.locationInWindow.x,
            event.locationInWindow.y, event.deltaX, event.deltaY, hitViewName,
            firstResponderName, self.movableByWindowBackground ? 1 : 0,
            self.isKeyWindow ? 1 : 0, self.isMainWindow ? 1 : 0];
    if (traceHostEvents) {
      OpenTrayDebugWriteLine(message);
    }
    if (traceHostTitle) {
      self.title = [NSString stringWithFormat:@"[dbg] %@", eventName];
    }
  }
  [super sendEvent:event];
}

@end
