// Copyright 2025 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

#import "AppDelegate.h"
#import "LynxWindow.h"
#import "LynxWindowController.h"
#import "ViewController.h"
#include <stdio.h>
#include "explorer/darwin/macos/lynx_explorer/OpenTrayLynxRuntime/module/LynxDemoModule.h"
#include "explorer/darwin/macos/lynx_explorer/OpenTrayLynxRuntime/service/LynxHttpService.h"
#include "explorer/embedder/lynx_explorer/module/lynx_demo_extension_module.h"
#include "lynx_env.h"

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

@interface AppDelegate ()

@property(strong) IBOutlet NSWindow *window;
@property(strong) id opentrayLocalEventMonitor;

@end

@implementation AppDelegate {
}

- (void)applicationDidFinishLaunching:(NSNotification *)aNotification {
  // Insert code here to initialize your application
  [self initSettingsMenu];

  auto &lynx_env = lynx::pub::LynxEnv::GetInstance();
  lynx_env.SetDevtoolEnabled(true);
  NSDictionary *env = [[NSProcessInfo processInfo] environment];
  const char *remote_debug_url = nil;
  if ([[env allKeys] containsObject:@"lynx_scheme_url"]) {
    remote_debug_url = [env[@"lynx_scheme_url"] UTF8String];
  }
  if (remote_debug_url) {
    lynx_env.SetDevtoolAppInfo("App", "OpenTrayLynxRuntime");
    lynx_env.SetDevtoolAppInfo("AppVersion", "1.0.0");
    lynx_env.ConnectDevtool(remote_debug_url);
  }

  // TODO: Prefer to use the C++ Wrapper. Use c-napi now because of the compatibility.
  lynx_env_register_native_module("ExplorerModule", &ExplorerModuleCreator, nullptr);
  lynx_env.RegisterExtensionModule("LynxDemoExtensionModule",
                                   &lynx::example::LynxDemoExtensionModule::CreateCModule, false,
                                   nullptr);

  // Init LynxServices
  lynx::pub::LynxServiceCenter::GetInstance().RegisterService(
      std::make_shared<lynx::service::LynxHttpServiceImpl>());

  self.window.contentViewController = [[ViewController alloc] initWithUrl:nil];
  [self installOpenTrayEventMonitorIfNeeded];
  [self logOpenTrayWindowBinding];
}

- (void)applicationWillTerminate:(NSNotification *)aNotification {
  // Insert code here to tear down your application
  if (self.opentrayLocalEventMonitor != nil) {
    [NSEvent removeMonitor:self.opentrayLocalEventMonitor];
    self.opentrayLocalEventMonitor = nil;
  }
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
  return YES;
}

- (void)initLynx {
}

- (void)initSettingsMenu {
  NSMenu *mainMenu = [NSApp mainMenu];
  NSMenuItem *debugSettingsItem = [[NSMenuItem alloc] init];
  [debugSettingsItem setTitle:@"DebugSettingsMenu"];
  if ([mainMenu itemWithTitle:@"Help"] != nil) {
    NSInteger index = [mainMenu indexOfItemWithTitle:@"Help"];
    [mainMenu insertItem:debugSettingsItem atIndex:index];
  } else {
    [mainMenu addItem:debugSettingsItem];
  }
  NSMenu *subMenu = [[NSMenu alloc] initWithTitle:@"DebugSettings"];
  NSMenuItem *openPanelItem = [[NSMenuItem alloc] initWithTitle:@"DebugSettingsPanel"
                                                         action:@selector(openSettingsPanel)
                                                  keyEquivalent:@""];
  openPanelItem.target = self;
  [subMenu addItem:openPanelItem];
  [debugSettingsItem setSubmenu:subMenu];
}

- (void)openSettingsPanel {
}

- (void)logOpenTrayWindowBinding {
  if (!OpenTrayDebugModeEnabled(@"host-events")) {
    return;
  }
  OpenTrayDebugWriteLine([NSString
      stringWithFormat:
          @"[opentray][host-input] stage=window-bound class=%@ title=%@ contentController=%@ key=%d main=%d",
          NSStringFromClass(self.window.class), self.window.title ?: @"",
          self.window.contentViewController
              ? NSStringFromClass(self.window.contentViewController.class)
              : @"nil",
          self.window.isKeyWindow ? 1 : 0, self.window.isMainWindow ? 1 : 0]);
}

- (void)installOpenTrayEventMonitorIfNeeded {
  BOOL traceHostEvents = OpenTrayDebugModeEnabled(@"host-events");
  BOOL traceHostTitle = OpenTrayDebugModeEnabled(@"host-title");
  if ((!traceHostEvents && !traceHostTitle) || self.opentrayLocalEventMonitor != nil) {
    return;
  }

  __weak AppDelegate *weakSelf = self;
  self.opentrayLocalEventMonitor = [NSEvent
      addLocalMonitorForEventsMatchingMask:NSEventMaskAny
                                   handler:^NSEvent *_Nullable(NSEvent *_Nonnull event) {
                                     AppDelegate *strongSelf = weakSelf;
                                     if (strongSelf == nil ||
                                         !OpenTrayShouldTraceEvent(event.type)) {
                                       return event;
                                     }
                                     NSWindow *window = event.window ?: strongSelf.window;
                                     NSString *eventName = OpenTrayEventTypeName(event.type);
                                     NSString *windowClass =
                                         window ? NSStringFromClass(window.class) : @"nil";
                                     NSString *hitViewName =
                                         window ? OpenTrayHitViewName(window, event) : @"nil";
                                     NSString *firstResponderName =
                                         window.firstResponder
                                             ? NSStringFromClass(window.firstResponder.class)
                                             : @"nil";
                                     if (traceHostEvents) {
                                       OpenTrayDebugWriteLine([NSString
                                           stringWithFormat:
                                               @"[opentray][host-input] stage=local-monitor type=%@ button=%ld clicks=%ld phase=%ld momentum=%ld location=(%.1f,%.1f) delta=(%.2f,%.2f) windowClass=%@ hit=%@ firstResponder=%@ key=%d main=%d",
                                               eventName, (long)event.buttonNumber,
                                               (long)event.clickCount, (long)event.phase,
                                               (long)event.momentumPhase,
                                               event.locationInWindow.x,
                                               event.locationInWindow.y, event.deltaX,
                                               event.deltaY, windowClass, hitViewName,
                                               firstResponderName,
                                               window.isKeyWindow ? 1 : 0,
                                               window.isMainWindow ? 1 : 0]);
                                     }
                                     if (traceHostTitle && window != nil) {
                                       window.title =
                                           [NSString stringWithFormat:@"[dbg] %@", eventName];
                                     }
                                     return event;
                                   }];
}

@end
