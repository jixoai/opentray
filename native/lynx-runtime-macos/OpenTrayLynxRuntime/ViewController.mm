// OpenTray-maintained Lynx runtime host controller.
// This file remains repo-owned even though the build reuses upstream Lynx shared libraries.

#import "ViewController.h"
#include <cmath>
#include <cstring>
#include <memory>
#include "explorer/darwin/macos/lynx_explorer/OpenTrayLynxRuntime/fetcher/ExampleGenericResourceFetcher.h"
#include "explorer/darwin/macos/lynx_explorer/OpenTrayLynxRuntime/runtime/ExampleLynxRuntimeLifecycleObserver.h"
#include "lynx_env.h"
#include "lynx_native_view.h"
#include "lynx_value.h"
#include "lynx_view.h"
#include "platform/embedder/public/lynx_runtime_lifecycle_observer.h"
#if ENABLE_TESTBENCH_REPLAY
#include "platform/embedder/lynx_recorder/test_bench_action_manager.h"
#endif
#ifdef USE_WEAK_SUFFIX_NAPI
#include "third_party/weak-node-api/headers/weak_napi_defines.h"
#endif

using lynx::pub::LynxValue;

@class ViewController;

napi_value OpenTrayWindowInvoke(napi_env env, napi_callback_info info);
napi_value OpenTrayWindowModuleCreator(napi_env env, napi_value exports,
                                       const char *module_name, void *opaque);

@interface OpenTrayWindowLaunchConfig : NSObject

@property(nonatomic, strong, nullable) NSNumber *width;
@property(nonatomic, strong, nullable) NSNumber *height;
@property(nonatomic, strong, nullable) NSNumber *minWidth;
@property(nonatomic, strong, nullable) NSNumber *minHeight;
@property(nonatomic, strong, nullable) NSNumber *maxWidth;
@property(nonatomic, strong, nullable) NSNumber *maxHeight;
@property(nonatomic, assign) BOOL fitContentSize;
@property(nonatomic, assign) BOOL nativeWindowApi;
@property(nonatomic, assign) BOOL bindWindowGlobals;
@property(nonatomic, assign) BOOL nativeScreenApi;
@property(nonatomic, assign) BOOL bindScreenGlobals;
@property(nonatomic, copy) NSString *title;
@property(nonatomic, strong, nullable) NSDictionary *icon;
@property(nonatomic, assign) BOOL frameless;

+ (instancetype)fromEnvironment;
- (BOOL)fitContentWidth;
- (BOOL)fitContentHeight;
- (NSDictionary *)dictionaryRepresentation;
- (NSDictionary *)windowStyleDictionary;
- (NSDictionary *)capabilitiesDictionary;
- (NSSize)initialContentSize;

@end

namespace {

static NSString *const kOpenTrayWindowConfigEnv = @"OPENTRAY_LYNX_WINDOW_CONFIG_JSON";
static NSString *const kOpenTrayHostProfileEnv = @"OPENTRAY_LYNX_HOST_PROFILE";
static NSString *const kOpenTrayWindowEventPrefix = @"opentray.window:";
static NSString *const kOpenTrayDefaultWindowTitle = @"OpenTray Lynx";
const uint64_t kOpenTrayWindowModuleID =
    reinterpret_cast<uint64_t>(&kOpenTrayWindowModuleID);

BOOL OpenTrayBaselineHostModeEnabled() {
  NSString *raw = [NSProcessInfo processInfo].environment[kOpenTrayHostProfileEnv];
  if (raw.length == 0) {
    return NO;
  }
  NSString *normalized =
      [[raw stringByTrimmingCharactersInSet:
                 [NSCharacterSet whitespaceAndNewlineCharacterSet]] lowercaseString];
  return [normalized isEqualToString:@"baseline"];
}

NSSize ClampSize(NSSize size, NSNumber *minWidth, NSNumber *minHeight,
                 NSNumber *maxWidth, NSNumber *maxHeight) {
  if (minWidth) {
    size.width = MAX(size.width, minWidth.doubleValue);
  }
  if (minHeight) {
    size.height = MAX(size.height, minHeight.doubleValue);
  }
  if (maxWidth && maxWidth.doubleValue > 0) {
    size.width = MIN(size.width, maxWidth.doubleValue);
  }
  if (maxHeight && maxHeight.doubleValue > 0) {
    size.height = MIN(size.height, maxHeight.doubleValue);
  }
  return size;
}

NSUInteger OpenTrayWindowStyleMask(BOOL frameless) {
  if (frameless) {
    return NSWindowStyleMaskBorderless;
  }
  return NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable |
         NSWindowStyleMaskTitled | NSWindowStyleMaskResizable;
}

NSString *JSONStringFromObject(id object) {
  if (!object) {
    object = @{};
  }
  NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
  if (!data) {
    return @"{}";
  }
  return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"{}";
}

id JSONObjectFromString(NSString *json) {
  if (!json || json.length == 0) {
    return nil;
  }
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) {
    return nil;
  }
  return [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
}

std::string StdStringFromNSString(NSString *value) {
  if (!value) {
    return std::string();
  }
  return std::string([value UTF8String] ?: "");
}

NSString *NSStringFromStdString(const std::string &value) {
  return [[NSString alloc] initWithUTF8String:value.c_str()] ?: @"";
}

void OpenTrayRunOnMainSync(dispatch_block_t block) {
  if ([NSThread isMainThread]) {
    block();
    return;
  }
  dispatch_sync(dispatch_get_main_queue(), block);
}

std::string ReadNapiString(napi_env env, napi_value value) {
  size_t length = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &length);
  std::string result(length, '\0');
  napi_get_value_string_utf8(env, value, result.data(), length + 1, &length);
  result.resize(length);
  return result;
}

napi_value NapiString(napi_env env, NSString *value) {
  napi_value result;
  std::string utf8 = StdStringFromNSString(value);
  napi_create_string_utf8(env, utf8.c_str(), utf8.size(), &result);
  return result;
}

NSDictionary *NormalizedIconValue(id value) {
  if (!value || value == [NSNull null]) {
    return nil;
  }
  NSDictionary *icon = [value isKindOfClass:[NSDictionary class]] ? value : nil;
  NSString *type = [icon[@"type"] isKindOfClass:[NSString class]] ? icon[@"type"] : nil;
  if (!type) {
    return nil;
  }
  if ([type isEqualToString:@"rgba"]) {
    NSArray *data = [icon[@"data"] isKindOfClass:[NSArray class]] ? icon[@"data"] : nil;
    NSNumber *width = [icon[@"width"] isKindOfClass:[NSNumber class]] ? icon[@"width"] : nil;
    NSNumber *height =
        [icon[@"height"] isKindOfClass:[NSNumber class]] ? icon[@"height"] : nil;
    if (!data || !width || !height) {
      return nil;
    }
    return @{
      @"type" : @"rgba",
      @"data" : data,
      @"width" : width,
      @"height" : height,
    };
  }
  if ([type isEqualToString:@"encoded"]) {
    NSArray *data = [icon[@"data"] isKindOfClass:[NSArray class]] ? icon[@"data"] : nil;
    if (!data) {
      return nil;
    }
    return @{
      @"type" : @"encoded",
      @"data" : data,
    };
  }
  if ([type isEqualToString:@"file"]) {
    NSString *path = [icon[@"path"] isKindOfClass:[NSString class]] ? icon[@"path"] : nil;
    if (!path) {
      return nil;
    }
    return @{
      @"type" : @"file",
      @"path" : path,
    };
  }
  if ([type isEqualToString:@"href"]) {
    NSString *href = [icon[@"href"] isKindOfClass:[NSString class]] ? icon[@"href"] : nil;
    if (!href) {
      return nil;
    }
    return @{
      @"type" : @"href",
      @"href" : href,
    };
  }
  return nil;
}

NSData *ByteDataFromJSONArray(NSArray *values) {
  NSMutableData *data = [NSMutableData dataWithCapacity:values.count];
  for (id value in values) {
    NSNumber *number = [value isKindOfClass:[NSNumber class]] ? value : nil;
    if (!number) {
      return nil;
    }
    NSInteger byteValue = number.integerValue;
    if (byteValue < 0 || byteValue > 255) {
      return nil;
    }
    uint8_t byte = static_cast<uint8_t>(byteValue);
    [data appendBytes:&byte length:1];
  }
  return data;
}

NSData *ImageDataFromHref(NSString *href) {
  if (![href hasPrefix:@"data:image/"]) {
    return nil;
  }
  NSRange comma = [href rangeOfString:@","];
  if (comma.location == NSNotFound || comma.location + 1 >= href.length) {
    return nil;
  }
  NSString *metadata = [href substringToIndex:comma.location];
  if (![metadata containsString:@";base64"]) {
    return nil;
  }
  NSString *payload = [href substringFromIndex:comma.location + 1];
  return [[NSData alloc] initWithBase64EncodedString:payload
                                             options:NSDataBase64DecodingIgnoreUnknownCharacters];
}

NSImage *NSImageFromIconValue(NSDictionary *icon) {
  NSString *type = [icon[@"type"] isKindOfClass:[NSString class]] ? icon[@"type"] : nil;
  if (!type) {
    return nil;
  }
  if ([type isEqualToString:@"file"]) {
    NSString *path = [icon[@"path"] isKindOfClass:[NSString class]] ? icon[@"path"] : nil;
    return path ? [[NSImage alloc] initWithContentsOfFile:path] : nil;
  }
  if ([type isEqualToString:@"href"]) {
    NSString *href = [icon[@"href"] isKindOfClass:[NSString class]] ? icon[@"href"] : nil;
    if (!href) {
      return nil;
    }
    if (NSData *data = ImageDataFromHref(href)) {
      return [[NSImage alloc] initWithData:data];
    }
    NSURL *url = [NSURL URLWithString:href];
    return url ? [[NSImage alloc] initWithContentsOfURL:url] : nil;
  }
  if ([type isEqualToString:@"encoded"]) {
    NSArray *dataArray = [icon[@"data"] isKindOfClass:[NSArray class]] ? icon[@"data"] : nil;
    NSData *data = dataArray ? ByteDataFromJSONArray(dataArray) : nil;
    return data ? [[NSImage alloc] initWithData:data] : nil;
  }
  if ([type isEqualToString:@"rgba"]) {
    NSArray *dataArray = [icon[@"data"] isKindOfClass:[NSArray class]] ? icon[@"data"] : nil;
    NSNumber *width = [icon[@"width"] isKindOfClass:[NSNumber class]] ? icon[@"width"] : nil;
    NSNumber *height =
        [icon[@"height"] isKindOfClass:[NSNumber class]] ? icon[@"height"] : nil;
    if (!dataArray || !width || !height || width.integerValue <= 0 ||
        height.integerValue <= 0) {
      return nil;
    }
    NSData *data = ByteDataFromJSONArray(dataArray);
    NSUInteger expectedLength =
        static_cast<NSUInteger>(width.unsignedIntegerValue * height.unsignedIntegerValue * 4);
    if (!data || data.length != expectedLength) {
      return nil;
    }
    NSBitmapImageRep *rep = [[NSBitmapImageRep alloc]
        initWithBitmapDataPlanes:nil
                      pixelsWide:width.integerValue
                      pixelsHigh:height.integerValue
                   bitsPerSample:8
                 samplesPerPixel:4
                        hasAlpha:YES
                        isPlanar:NO
                  colorSpaceName:NSCalibratedRGBColorSpace
                     bytesPerRow:width.integerValue * 4
                    bitsPerPixel:32];
    if (!rep || !rep.bitmapData) {
      return nil;
    }
    std::memcpy(rep.bitmapData, data.bytes, data.length);
    NSImage *image =
        [[NSImage alloc] initWithSize:NSMakeSize(width.doubleValue, height.doubleValue)];
    [image addRepresentation:rep];
    return image;
  }
  return nil;
}

NSDictionary *RectDictionary(NSRect rect) {
  return @{
    @"x" : @(static_cast<NSInteger>(std::llround(rect.origin.x))),
    @"y" : @(static_cast<NSInteger>(std::llround(rect.origin.y))),
    @"width" : @(static_cast<NSUInteger>(std::llround(MAX(rect.size.width, 0.0)))),
    @"height" : @(static_cast<NSUInteger>(std::llround(MAX(rect.size.height, 0.0)))),
  };
}

}  // namespace

@implementation OpenTrayWindowLaunchConfig

+ (instancetype)fromEnvironment {
  OpenTrayWindowLaunchConfig *config = [[OpenTrayWindowLaunchConfig alloc] init];
  config.fitContentSize = YES;
  NSDictionary *environment = [NSProcessInfo processInfo].environment;
  NSString *json = environment[kOpenTrayWindowConfigEnv];
  id raw = JSONObjectFromString(json);
  NSDictionary *parsed = [raw isKindOfClass:[NSDictionary class]] ? raw : nil;
  if (!parsed) {
    return config;
  }

  config.width = [parsed[@"width"] isKindOfClass:[NSNumber class]] ? parsed[@"width"] : nil;
  config.height =
      [parsed[@"height"] isKindOfClass:[NSNumber class]] ? parsed[@"height"] : nil;
  config.minWidth =
      [parsed[@"minWidth"] isKindOfClass:[NSNumber class]] ? parsed[@"minWidth"] : nil;
  config.minHeight =
      [parsed[@"minHeight"] isKindOfClass:[NSNumber class]] ? parsed[@"minHeight"] : nil;
  config.maxWidth =
      [parsed[@"maxWidth"] isKindOfClass:[NSNumber class]] ? parsed[@"maxWidth"] : nil;
  config.maxHeight =
      [parsed[@"maxHeight"] isKindOfClass:[NSNumber class]] ? parsed[@"maxHeight"] : nil;
  if ([parsed[@"fitContentSize"] isKindOfClass:[NSNumber class]]) {
    config.fitContentSize = [parsed[@"fitContentSize"] boolValue];
  }
  if ([parsed[@"nativeWindowApi"] isKindOfClass:[NSNumber class]]) {
    config.nativeWindowApi = [parsed[@"nativeWindowApi"] boolValue];
  }
  if ([parsed[@"bindWindowGlobals"] isKindOfClass:[NSNumber class]]) {
    config.bindWindowGlobals = [parsed[@"bindWindowGlobals"] boolValue];
  }
  if ([parsed[@"nativeScreenApi"] isKindOfClass:[NSNumber class]]) {
    config.nativeScreenApi = [parsed[@"nativeScreenApi"] boolValue];
  }
  if ([parsed[@"bindScreenGlobals"] isKindOfClass:[NSNumber class]]) {
    config.bindScreenGlobals = [parsed[@"bindScreenGlobals"] boolValue];
  }
  if ([parsed[@"title"] isKindOfClass:[NSString class]]) {
    config.title = parsed[@"title"];
  }
  config.icon = NormalizedIconValue(parsed[@"icon"]);
  NSDictionary *style =
      [parsed[@"style"] isKindOfClass:[NSDictionary class]] ? parsed[@"style"] : nil;
  if ([style[@"frameless"] isKindOfClass:[NSNumber class]]) {
    config.frameless = [style[@"frameless"] boolValue];
  }

  return config;
}

- (BOOL)fitContentWidth {
  // Explicit caller width wins; fit-content only owns axes left unspecified by the launcher.
  return self.fitContentSize && self.width == nil;
}

- (BOOL)fitContentHeight {
  // Explicit caller height wins; fit-content only owns axes left unspecified by the launcher.
  return self.fitContentSize && self.height == nil;
}

- (NSDictionary *)dictionaryRepresentation {
  NSMutableDictionary *result = [NSMutableDictionary dictionary];
  if (self.width) result[@"width"] = self.width;
  if (self.height) result[@"height"] = self.height;
  if (self.minWidth) result[@"minWidth"] = self.minWidth;
  if (self.minHeight) result[@"minHeight"] = self.minHeight;
  if (self.maxWidth) result[@"maxWidth"] = self.maxWidth;
  if (self.maxHeight) result[@"maxHeight"] = self.maxHeight;
  result[@"fitContentSize"] = @(self.fitContentSize);
  result[@"nativeWindowApi"] = @(self.nativeWindowApi);
  result[@"bindWindowGlobals"] = @(self.bindWindowGlobals);
  result[@"nativeScreenApi"] = @(self.nativeScreenApi);
  result[@"bindScreenGlobals"] = @(self.bindScreenGlobals);
  if (self.title) result[@"title"] = self.title;
  if (self.icon) result[@"icon"] = self.icon;
  result[@"style"] = @{@"frameless" : @(self.frameless)};
  return result;
}

- (NSDictionary *)windowStyleDictionary {
  return @{
    @"frameless" : @(self.frameless),
    @"transparent" : @NO,
    @"backgroundEffect" : [NSNull null],
  };
}

- (NSDictionary *)capabilitiesDictionary {
  return @{
    @"close" : @YES,
    @"move" : @YES,
    @"resize" : @YES,
    @"title" : @YES,
    @"icon" : @YES,
    @"screen" : @YES,
    @"frameless" : @YES,
    @"transparent" : @NO,
    @"backgroundEffects" : @[],
    @"globalBindingsEnabled" : @(self.bindWindowGlobals),
    @"globalBindingsSupported" : @YES,
    @"screenBindingsEnabled" : @(self.nativeScreenApi && self.bindScreenGlobals),
    @"screenBindingsSupported" : @YES,
    @"fitContentSize" : @(self.fitContentSize),
    @"platform" : @"macos",
  };
}

- (NSSize)initialContentSize {
  CGFloat width = self.width ? self.width.doubleValue : 720.0;
  CGFloat height = self.height ? self.height.doubleValue : 420.0;
  return ClampSize(NSMakeSize(width, height), self.minWidth, self.minHeight,
                   self.maxWidth, self.maxHeight);
}

@end

namespace {

class OpenTrayRuntimeLifecycleObserver
    : public lynx::pub::LynxRuntimeLifecycleObserver {
 public:
  OpenTrayRuntimeLifecycleObserver(
      std::shared_ptr<lynx::pub::LynxRuntimeLifecycleObserver> upstream_observer,
      std::string bootstrap_script)
      : upstream_observer_(std::move(upstream_observer)),
        bootstrap_script_(std::move(bootstrap_script)) {}

  void OnRuntimeAttach(napi_env env) override {
    if (upstream_observer_) {
      upstream_observer_->OnRuntimeAttach(env);
    }
    if (bootstrap_script_.empty()) {
      return;
    }
    napi_handle_scope scope = nullptr;
    napi_open_handle_scope(env, &scope);
    napi_value script;
    napi_create_string_utf8(env, bootstrap_script_.c_str(),
                            bootstrap_script_.size(), &script);
    napi_value result;
    napi_run_script(env, script, &result);
    napi_close_handle_scope(env, scope);
  }

  void OnRuntimeDetach() override {
    if (upstream_observer_) {
      upstream_observer_->OnRuntimeDetach();
    }
  }

 private:
  std::shared_ptr<lynx::pub::LynxRuntimeLifecycleObserver> upstream_observer_;
  std::string bootstrap_script_;
};

class FakeView : public lynx::pub::LynxNativeView {
 public:
  explicit FakeView(void *opaque) : vc_((__bridge ViewController *)opaque) {}
  ~FakeView() override {}
  bool OnCreate() override { return true; }
  void OnDestroy() override {}
  void OnAttach() override {}
  void OnDetach() override {}
  void OnLayoutChanged(float left, float top, float width, float height,
                       float pixel_ratio) override {
    LynxValue detail(LynxValue::kCreateAsMapTag);
    detail.SetProperty("pixelRatio", LynxValue(pixel_ratio));
    detail.SetProperty("width", LynxValue(width));
    detail.SetProperty("height", LynxValue(height));
    TriggerEvent("resize", std::move(detail));
  }
  void OnPropertiesChanged(const LynxValue &attrs, const LynxValue &events) override {}
  void OnMethodInvoked(const char *method, const LynxValue &attrs,
                       std::function<void(int, lynx::pub::LynxValue &&)> callback) override {
    callback(kSuccess, LynxValue(LynxValue::kCreateAsNullTag));
  }
  bool IsScrollEnabled() override { return true; }
  bool IsSurfaceEnabled() override { return true; }

 private:
  __weak ViewController *vc_;
};

std::vector<uint8_t> ConvertNSBinary(NSData *binary) {
  std::vector<uint8_t> result;
  auto len = binary.length;
  if (len > 0) {
    auto begin = reinterpret_cast<const uint8_t *>(binary.bytes);
    result.assign(begin, begin + len);
  }
  return result;
}

std::string OpenTrayBootstrapScript(OpenTrayWindowLaunchConfig *config) {
  std::string config_json = StdStringFromNSString(JSONStringFromObject([config dictionaryRepresentation]));
  std::string script = R"JS((function () {
  const config = __OPENTRAY_CONFIG__;
  const targetWindow = globalThis.window || globalThis;
  const navigatorObject = globalThis.navigator || (globalThis.navigator = {});
  const emitter = () =>
    (globalThis.lynx &&
      typeof globalThis.lynx.getJSModule === "function" &&
      globalThis.lynx.getJSModule("GlobalEventEmitter")) ||
    globalThis.GlobalEventEmitter;
  const nativeModule = () => globalThis.NativeModules && globalThis.NativeModules.OpenTrayWindowModule;
  const eventPrefix = "opentray.window:";
  const INTERNALS_KEY = "__OPENTRAY_WINDOW_INTERNALS__";
  const API_KEY = "__OPENTRAY_WINDOW_API__";
  const SCREEN_API_KEY = "__OPENTRAY_SCREEN_API__";
  if (!targetWindow[INTERNALS_KEY]) {
    const domListeners = Object.create(null);
    const originalWindowFns = {
      close: targetWindow.close,
      moveTo: targetWindow.moveTo,
      resizeTo: targetWindow.resizeTo,
      getScreenDetails: targetWindow.getScreenDetails
    };
    const typedError = (code, message) => ({ code, message });
    const callNative = (cmd, payload = {}) => {
      const bridge = nativeModule();
      if (!bridge || typeof bridge.invoke !== "function") {
        throw typedError("unsupported", "OpenTray Lynx window module is unavailable");
      }
      const raw = bridge.invoke(JSON.stringify({ cmd, payload }));
      const response = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!response || response.ok !== true) {
        throw response?.error ?? typedError("internal", "OpenTray Lynx window call failed");
      }
      return response.result ?? null;
    };
    const invoke = (cmd, payload = {}) => Promise.resolve().then(() => callNative(cmd, payload));
    const createApi = () => {
      if (targetWindow[API_KEY]) return targetWindow[API_KEY];
      const api = {
        invoke,
        async listen(event, handler) {
          const events = emitter();
          if (!events || typeof events.addListener !== "function" || typeof events.removeListener !== "function") {
            throw typedError("unsupported", "GlobalEventEmitter is unavailable");
          }
          const eventName = `${eventPrefix}${event}`;
          const wrapped = (payload) => {
            if (typeof handler === "function") handler(payload);
          };
          events.addListener(eventName, wrapped);
          return async () => {
            events.removeListener(eventName, wrapped);
          };
        },
        async once(event, handler) {
          let unlisten = async () => {};
          unlisten = await api.listen(event, async (eventData) => {
            await unlisten();
            if (typeof handler === "function") handler(eventData);
          });
          return unlisten;
        },
        close() {
          return invoke("close");
        },
        move(x, y) {
          return invoke("move", { x, y });
        },
        moveTo(x, y) {
          return invoke("moveTo", { x, y });
        },
        resize(width, height) {
          return invoke("resize", { width, height });
        },
        resizeTo(width, height) {
          return invoke("resizeTo", { width, height });
        },
        getStyle() {
          return invoke("getStyle");
        },
        setStyle(style) {
          return invoke("setStyle", style ?? {});
        },
        getCapabilities() {
          return invoke("getCapabilities");
        },
        getTitle() {
          return invoke("getTitle");
        },
        setTitle(title) {
          return invoke("setTitle", { title });
        },
        getIcon() {
          return invoke("getIcon");
        },
        setIcon(icon) {
          return invoke("setIcon", icon ?? null);
        },
        addEventListener(event, handler) {
          const eventListeners = (domListeners[event] ??= new Map());
          if (eventListeners.has(handler)) return;
          const pending = api.listen(event, handler).then((unlisten) => {
            eventListeners.set(handler, unlisten);
            return unlisten;
          });
          eventListeners.set(handler, pending);
        },
        removeEventListener(event, handler) {
          const eventListeners = domListeners[event];
          if (!eventListeners) return;
          const unlisten = eventListeners.get(handler);
          eventListeners.delete(handler);
          if (typeof unlisten === "function") {
            void unlisten();
            return;
          }
          if (unlisten && typeof unlisten.then === "function") {
            void unlisten.then((resolved) => {
              if (typeof resolved === "function") {
                return resolved();
              }
            });
          }
        }
      };
      Object.freeze(api);
      Object.defineProperty(targetWindow, API_KEY, {
        value: api,
        configurable: true
      });
      return api;
    };
    const createScreenApi = () => {
      if (targetWindow[SCREEN_API_KEY]) return targetWindow[SCREEN_API_KEY];
      const api = {
        getScreenDetails() {
          return invoke("getScreenDetails");
        }
      };
      Object.freeze(api);
      Object.defineProperty(targetWindow, SCREEN_API_KEY, {
        value: api,
        configurable: true
      });
      return api;
    };
    const restoreGlobals = () => {
      try {
        targetWindow.close = originalWindowFns.close;
        targetWindow.moveTo = originalWindowFns.moveTo;
        targetWindow.resizeTo = originalWindowFns.resizeTo;
        targetWindow.getScreenDetails = originalWindowFns.getScreenDetails;
      } catch (_) {}
    };
    const install = () => {
      // The extension owns this navigator bridge; it does not reuse page messaging or daemon globals.
      if (config.nativeWindowApi) {
        const api = createApi();
        Object.defineProperty(navigatorObject, "window", {
          value: api,
          configurable: true
        });
        Object.defineProperty(navigatorObject, "opentrayWindow", {
          value: api,
          configurable: true
        });
        if (config.bindWindowGlobals) {
          try {
            targetWindow.close = () => {
              void api.close();
            };
            targetWindow.moveTo = (x, y) => {
              void api.moveTo(Number(x), Number(y));
            };
            targetWindow.resizeTo = (width, height) => {
              void api.resizeTo(Number(width), Number(height));
            };
          } catch (_) {}
        }
      } else {
        try {
          delete navigatorObject.window;
          delete navigatorObject.opentrayWindow;
        } catch (_) {}
      }
      if (config.nativeScreenApi) {
        const screenApi = createScreenApi();
        Object.defineProperty(navigatorObject, "screen", {
          value: screenApi,
          configurable: true
        });
        Object.defineProperty(navigatorObject, "opentrayScreen", {
          value: screenApi,
          configurable: true
        });
        if (config.bindScreenGlobals) {
          try {
            targetWindow.getScreenDetails = () => screenApi.getScreenDetails();
          } catch (_) {}
        }
      } else {
        try {
          delete navigatorObject.screen;
          delete navigatorObject.opentrayScreen;
        } catch (_) {}
      }
      if (!config.bindWindowGlobals && !config.bindScreenGlobals) {
        restoreGlobals();
      } else if (!config.bindWindowGlobals) {
        try {
          targetWindow.close = originalWindowFns.close;
          targetWindow.moveTo = originalWindowFns.moveTo;
          targetWindow.resizeTo = originalWindowFns.resizeTo;
        } catch (_) {}
      } else if (!config.bindScreenGlobals) {
        try {
          targetWindow.getScreenDetails = originalWindowFns.getScreenDetails;
        } catch (_) {}
      }
    };
    const uninstall = () => {
      try {
        delete navigatorObject.window;
        delete navigatorObject.opentrayWindow;
        delete navigatorObject.screen;
        delete navigatorObject.opentrayScreen;
      } catch (_) {}
      restoreGlobals();
    };
    const scheduleFitProbe = () => {
      // Fit-content is a native host policy fed by Lynx layout snapshots, not a DOM/window identity claim.
      if (!config.fitContentSize) return;
      let attempts = 0;
      const maxAttempts = 60;
      let lastKey = "";
      const measure = () => {
        attempts += 1;
        try {
          const runtimeLynx = globalThis.lynx;
          if (!runtimeLynx || typeof runtimeLynx.createSelectorQuery !== "function") {
            if (attempts < maxAttempts) setTimeout(measure, 80);
            return;
          }
          runtimeLynx
            .createSelectorQuery()
            .selectRoot()
            .boundingClientRect((rect) => {
              const width = Number(rect && (rect.width ?? (Number(rect.right) - Number(rect.left))));
              const height = Number(rect && (rect.height ?? (Number(rect.bottom) - Number(rect.top))));
              if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
                const key = `${Math.round(width)}x${Math.round(height)}`;
                if (key !== lastKey) {
                  lastKey = key;
                  void invoke("reportContentRect", { width, height });
                }
              }
              if (attempts < maxAttempts) {
                setTimeout(measure, attempts < 3 ? 16 : 120);
              }
            })
            .exec();
        } catch (_) {
          if (attempts < maxAttempts) {
            setTimeout(measure, 120);
          }
        }
      };
      setTimeout(measure, 0);
    };
    Object.defineProperty(targetWindow, INTERNALS_KEY, {
      value: Object.freeze({
        install,
        uninstall,
        scheduleFitProbe
      }),
      configurable: false
    });
  }
  const internals = targetWindow[INTERNALS_KEY];
  if (config.nativeWindowApi || config.nativeScreenApi) {
    internals.install();
  } else {
    internals.uninstall();
  }
  internals.scheduleFitProbe();
})();)JS";

  size_t pos = script.find("__OPENTRAY_CONFIG__");
  if (pos != std::string::npos) {
    script.replace(pos, strlen("__OPENTRAY_CONFIG__"), config_json);
  }
  return script;
}

}  // namespace

@interface ViewController () <NSWindowDelegate>

@property(nonatomic) std::shared_ptr<lynx::pub::LynxView> lynxView;
@property(nonatomic, strong) OpenTrayWindowLaunchConfig *opentrayWindowConfig;
@property(nonatomic, assign) BOOL opentrayBaselineHostMode;
@property(nonatomic, assign) BOOL opentrayWindowAttached;
@property(nonatomic, assign) BOOL opentrayWindowRevealed;
@property(nonatomic, assign) BOOL opentrayInitialFitApplied;
@property(nonatomic, assign) BOOL opentrayApplyingWindowFrame;
@property(nonatomic, strong) id opentrayWindowDelegateOwner;
@property(nonatomic, copy) NSString *opentrayWindowTitle;
@property(nonatomic, strong, nullable) NSDictionary *opentrayWindowIcon;
#if ENABLE_TESTBENCH_REPLAY
@property(nonatomic) std::shared_ptr<lynx::embedder::TestBenchActionManager> testBenchActionManager;
@property(nonatomic) BOOL isTestBenchReplay;
#endif
@end

@implementation ViewController {
  CGFloat _lastScaleFactor;
  std::shared_ptr<lynx::pub::LynxRuntimeLifecycleObserver> _opentrayRuntimeObserver;
}

- (void)loadView {
  self.view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 800, 600)];
}

- (instancetype)initWithUrl:(NSString *)url {
  self = [super init];
  if (self) {
    self.url = url;
    self.opentrayWindowConfig = [OpenTrayWindowLaunchConfig fromEnvironment];
    self.opentrayBaselineHostMode = OpenTrayBaselineHostModeEnabled();
    if (self.opentrayBaselineHostMode) {
      // Baseline mode keeps the OpenTray-owned carrier but deliberately restores the
      // upstream host interaction model before re-layering window APIs and fit-content.
      self.opentrayWindowConfig.fitContentSize = NO;
      self.opentrayWindowConfig.nativeWindowApi = NO;
      self.opentrayWindowConfig.bindWindowGlobals = NO;
      self.opentrayWindowConfig.nativeScreenApi = NO;
      self.opentrayWindowConfig.bindScreenGlobals = NO;
      self.opentrayWindowConfig.frameless = NO;
    }
    self.opentrayWindowTitle =
        self.opentrayWindowConfig.title ?: kOpenTrayDefaultWindowTitle;
    self.opentrayWindowIcon = self.opentrayWindowConfig.icon;
    NSScreen *screen = [NSScreen mainScreen];
    _lastScaleFactor = screen.backingScaleFactor;
#if ENABLE_TESTBENCH_REPLAY
    self.isTestBenchReplay = [_url hasPrefix:@"sslocal://arkview?"];
#endif
  }
  return self;
}

- (void)viewDidLoad {
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(notifyWindowBecomeActive)
                                               name:NSWindowDidDeminiaturizeNotification
                                             object:nil];
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(notifyWindowEnterBackground)
                                               name:NSWindowDidMiniaturizeNotification
                                             object:nil];
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(windowScreenDidChange:)
                                               name:NSWindowDidChangeScreenNotification
                                             object:nil];
  [super viewDidLoad];
  [self loadLynxView];
  [self reloadTemplate];
}

- (void)viewWillAppear {
  [super viewWillAppear];
  [self attachWindowIfNeeded];
}

- (void)viewDidAppear {
  [super viewDidAppear];
  [self revealWindowIfNeeded];
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  _lynxView.reset();
}

- (void)windowScreenDidChange:(NSNotification *)notification {
  NSScreen *newScreen = self.view.window.screen;
  if (!newScreen) return;
  if (_lastScaleFactor != newScreen.backingScaleFactor) {
    _lastScaleFactor = newScreen.backingScaleFactor;
    _lynxView->UpdateScreenMetrics(self.view.frame.size.width, self.view.frame.size.height,
                                   _lastScaleFactor);
  }
  [self emitWindowEvent:@"screenchange" payload:[self currentScreenDetailsDictionary]];
}

- (void)notifyWindowBecomeActive {
  _lynxView->OnEnterForeground();
}

- (void)notifyWindowEnterBackground {
  _lynxView->OnEnterBackground();
}

- (void)viewDidLayout {
  [super viewDidLayout];
  [self attachWindowIfNeeded];
  _lynxView->UpdateScreenMetrics(self.view.frame.size.width, self.view.frame.size.height,
                                 _lastScaleFactor);
  _lynxView->SetFrame(0, 0, self.view.frame.size.width, self.view.frame.size.height);
}

- (BOOL)acceptsFirstResponder {
  return false;
}

- (void)attachWindowIfNeeded {
  if (self.opentrayWindowAttached || !self.view.window) {
    return;
  }
  self.opentrayWindowAttached = YES;
  if (self.opentrayBaselineHostMode) {
    return;
  }
  NSWindow *window = self.view.window;
  window.delegate = self;
  [window setStyleMask:OpenTrayWindowStyleMask(self.opentrayWindowConfig.frameless)];
  window.titlebarAppearsTransparent = YES;
  window.movableByWindowBackground = self.opentrayWindowConfig.frameless;
  window.minSize = NSMakeSize(self.opentrayWindowConfig.minWidth ? self.opentrayWindowConfig.minWidth.doubleValue : 200.0,
                              self.opentrayWindowConfig.minHeight ? self.opentrayWindowConfig.minHeight.doubleValue : 200.0);
  if (self.opentrayWindowConfig.maxWidth || self.opentrayWindowConfig.maxHeight) {
    window.contentMaxSize = NSMakeSize(self.opentrayWindowConfig.maxWidth ? self.opentrayWindowConfig.maxWidth.doubleValue : CGFLOAT_MAX,
                                       self.opentrayWindowConfig.maxHeight ? self.opentrayWindowConfig.maxHeight.doubleValue : CGFLOAT_MAX);
  }
  [window setContentSize:[self.opentrayWindowConfig initialContentSize]];
  [self applyWindowTitle:self.opentrayWindowTitle emitEvent:NO];
  [self applyWindowIconValue:self.opentrayWindowIcon emitEvent:NO errorMessage:nil];
  [window center];
}

- (void)revealWindowIfNeeded {
  if (self.opentrayWindowRevealed || !self.view.window) {
    return;
  }
  self.opentrayWindowRevealed = YES;
  if (self.opentrayBaselineHostMode) {
    return;
  }
  self.view.window.alphaValue = 1.0;
  [self.view.window makeKeyAndOrderFront:nil];
}

- (NSDictionary *)currentWindowStyleDictionary {
  return [self.opentrayWindowConfig windowStyleDictionary];
}

- (NSDictionary *)currentCapabilitiesDictionary {
  return [self.opentrayWindowConfig capabilitiesDictionary];
}

- (NSString *)currentWindowTitle {
  return self.opentrayWindowTitle ?: kOpenTrayDefaultWindowTitle;
}

- (NSDictionary *)currentWindowIconValue {
  return self.opentrayWindowIcon;
}

- (NSDictionary *)currentScreenDetailsDictionary {
  NSArray<NSScreen *> *screens = [NSScreen screens] ?: @[];
  NSScreen *primaryScreen = [NSScreen mainScreen];
  NSScreen *currentScreen = self.view.window.screen ?: primaryScreen;
  NSMutableArray<NSDictionary *> *screenDetails =
      [NSMutableArray arrayWithCapacity:screens.count];
  NSDictionary *currentDetail = nil;
  for (NSUInteger index = 0; index < screens.count; index += 1) {
    NSScreen *screen = screens[index];
    NSString *label = [NSString stringWithFormat:@"Screen %lu",
                                                 static_cast<unsigned long>(index + 1)];
    if (@available(macOS 10.15, *)) {
      if (screen.localizedName.length > 0) {
        label = screen.localizedName;
      }
    }
    NSDictionary *detail = @{
      @"id" : [NSString stringWithFormat:@"screen-%lu",
                                           static_cast<unsigned long>(index)],
      @"label" : label,
      @"isPrimary" : @(screen == primaryScreen),
      @"frame" : RectDictionary(screen.frame),
      @"visibleFrame" : RectDictionary(screen.visibleFrame),
      @"scaleFactor" : @(screen.backingScaleFactor),
    };
    [screenDetails addObject:detail];
    if (screen == currentScreen) {
      currentDetail = detail;
    }
  }
  return @{
    @"currentScreen" : currentDetail ?: [NSNull null],
    @"screens" : screenDetails,
    @"isExtended" : @(screenDetails.count > 1),
  };
}

- (NSSize)currentContentSize {
  if (!self.view.window) {
    return [self.opentrayWindowConfig initialContentSize];
  }
  return [self.view.window contentRectForFrameRect:self.view.window.frame].size;
}

- (void)applyWindowTitle:(NSString *)title emitEvent:(BOOL)emitEvent {
  NSString *nextTitle = title ?: @"";
  self.opentrayWindowTitle = nextTitle;
  if (self.view.window) {
    self.view.window.title = nextTitle;
  }
  NSString *processTitle =
      nextTitle.length > 0 ? nextTitle : kOpenTrayDefaultWindowTitle;
  [[NSProcessInfo processInfo] setProcessName:processTitle];
  [[[NSApplication sharedApplication] dockTile] display];
  if (emitEvent) {
    [self emitWindowEvent:@"titlechange" payload:@{@"title" : nextTitle}];
  }
}

- (BOOL)applyWindowIconValue:(NSDictionary *)icon
                    emitEvent:(BOOL)emitEvent
                 errorMessage:(NSString *_Nullable *_Nullable)errorMessage {
  NSImage *nativeIcon = icon ? NSImageFromIconValue(icon) : nil;
  if (icon && !nativeIcon) {
    if (errorMessage) {
      *errorMessage = @"icon could not be materialized as a native image";
    }
    return NO;
  }
  self.opentrayWindowIcon = icon;
  if (self.view.window) {
    [self.view.window setMiniwindowImage:nativeIcon];
  }
  [[NSApplication sharedApplication] setApplicationIconImage:nativeIcon];
  [[[NSApplication sharedApplication] dockTile] display];
  if (emitEvent) {
    [self emitWindowEvent:@"iconchange"
                  payload:@{@"icon" : icon ?: [NSNull null]}];
  }
  return YES;
}

- (void)applyFrameless:(BOOL)frameless {
  self.opentrayWindowConfig.frameless = frameless;
  NSWindow *window = self.view.window;
  if (!window) {
    return;
  }
  [window setStyleMask:OpenTrayWindowStyleMask(frameless)];
  window.titlebarAppearsTransparent = YES;
  window.movableByWindowBackground = frameless;
  [self emitWindowEvent:@"stylechange" payload:[self currentWindowStyleDictionary]];
}

- (void)emitWindowEvent:(NSString *)event payload:(NSDictionary *)payload {
  if (!self.lynxView) {
    return;
  }
  NSString *eventName = [kOpenTrayWindowEventPrefix stringByAppendingString:event];
  NSString *json = JSONStringFromObject(@[ payload ?: @{} ]);
  self.lynxView->SendGlobalEvent(StdStringFromNSString(eventName), StdStringFromNSString(json));
}

- (NSDictionary *)framePayload {
  NSWindow *window = self.view.window;
  if (!window) {
    return @{
      @"x" : @0,
      @"y" : @0,
      @"width" : @([self currentContentSize].width),
      @"height" : @([self currentContentSize].height),
    };
  }
  NSRect frame = window.frame;
  NSSize contentSize = [self currentContentSize];
  return @{
    @"x" : @(frame.origin.x),
    @"y" : @(frame.origin.y),
    @"width" : @(contentSize.width),
    @"height" : @(contentSize.height),
  };
}

- (void)applyReportedContentRect:(CGFloat)width height:(CGFloat)height {
  if (!self.opentrayWindowConfig.fitContentSize || !self.view.window) {
    [self revealWindowIfNeeded];
    return;
  }
  NSSize current = [self currentContentSize];
  CGFloat targetWidth =
      [self.opentrayWindowConfig fitContentWidth] ? width : current.width;
  CGFloat targetHeight =
      [self.opentrayWindowConfig fitContentHeight] ? height : current.height;
  NSSize target =
      ClampSize(NSMakeSize(targetWidth, targetHeight), self.opentrayWindowConfig.minWidth,
                self.opentrayWindowConfig.minHeight, self.opentrayWindowConfig.maxWidth,
                self.opentrayWindowConfig.maxHeight);
  if (fabs(target.width - current.width) > 0.5 ||
      fabs(target.height - current.height) > 0.5) {
    self.opentrayApplyingWindowFrame = YES;
    [self.view.window setContentSize:target];
    self.opentrayApplyingWindowFrame = NO;
  }
  self.opentrayInitialFitApplied = YES;
  [self revealWindowIfNeeded];
}

- (NSString *)jsonSuccess:(id)result {
  return JSONStringFromObject(@{
    @"ok" : @YES,
    @"result" : result ?: [NSNull null],
  });
}

- (NSString *)jsonError:(NSString *)code message:(NSString *)message {
  return JSONStringFromObject(@{
    @"ok" : @NO,
    @"error" : @{
      @"code" : code ?: @"internal",
      @"message" : message ?: @"unknown error",
    },
  });
}

- (NSString *)handleOpenTrayWindowRequestJSON:(NSString *)requestJSON {
  NSDictionary *request = [JSONObjectFromString(requestJSON) isKindOfClass:[NSDictionary class]]
                              ? JSONObjectFromString(requestJSON)
                              : nil;
  if (!request) {
    return [self jsonError:@"rejected" message:@"invalid OpenTray window request JSON"];
  }
  NSString *cmd = [request[@"cmd"] isKindOfClass:[NSString class]] ? request[@"cmd"] : nil;
  id payloadValue = request[@"payload"];
  NSDictionary *payload =
      [payloadValue isKindOfClass:[NSDictionary class]] ? payloadValue : @{};
  if (!cmd) {
    return [self jsonError:@"rejected" message:@"OpenTray window request requires cmd"];
  }

  __block NSString *response = nil;
  OpenTrayRunOnMainSync(^{
    if ([cmd isEqualToString:@"close"]) {
      [self.view.window close];
      response = [self jsonSuccess:nil];
      return;
    }
    if ([cmd isEqualToString:@"move"] || [cmd isEqualToString:@"moveTo"]) {
      NSNumber *x = [payload[@"x"] isKindOfClass:[NSNumber class]] ? payload[@"x"] : nil;
      NSNumber *y = [payload[@"y"] isKindOfClass:[NSNumber class]] ? payload[@"y"] : nil;
      if (!x || !y) {
        response = [self jsonError:@"rejected" message:@"moveTo requires x and y"];
        return;
      }
      NSRect frame = self.view.window.frame;
      frame.origin = NSMakePoint(x.doubleValue, y.doubleValue);
      [self.view.window setFrame:frame display:YES];
      response = [self jsonSuccess:[self framePayload]];
      return;
    }
    if ([cmd isEqualToString:@"resize"] || [cmd isEqualToString:@"resizeTo"]) {
      NSNumber *width =
          [payload[@"width"] isKindOfClass:[NSNumber class]] ? payload[@"width"] : nil;
      NSNumber *height =
          [payload[@"height"] isKindOfClass:[NSNumber class]] ? payload[@"height"] : nil;
      if (!width || !height || width.doubleValue <= 0 || height.doubleValue <= 0) {
        response =
            [self jsonError:@"rejected" message:@"resizeTo requires positive width and height"];
        return;
      }
      NSSize target =
          ClampSize(NSMakeSize(width.doubleValue, height.doubleValue), self.opentrayWindowConfig.minWidth,
                    self.opentrayWindowConfig.minHeight, self.opentrayWindowConfig.maxWidth,
                    self.opentrayWindowConfig.maxHeight);
      self.opentrayApplyingWindowFrame = YES;
      [self.view.window setContentSize:target];
      self.opentrayApplyingWindowFrame = NO;
      response = [self jsonSuccess:[self framePayload]];
      return;
    }
    if ([cmd isEqualToString:@"getStyle"]) {
      response = [self jsonSuccess:[self currentWindowStyleDictionary]];
      return;
    }
    if ([cmd isEqualToString:@"getTitle"]) {
      response = [self jsonSuccess:[self currentWindowTitle]];
      return;
    }
    if ([cmd isEqualToString:@"setTitle"]) {
      NSString *title =
          [payload[@"title"] isKindOfClass:[NSString class]] ? payload[@"title"] : nil;
      if (!title) {
        response = [self jsonError:@"rejected" message:@"setTitle requires title"];
        return;
      }
      [self applyWindowTitle:title emitEvent:YES];
      response = [self jsonSuccess:[self currentWindowTitle]];
      return;
    }
    if ([cmd isEqualToString:@"getIcon"]) {
      response = [self jsonSuccess:[self currentWindowIconValue]];
      return;
    }
    if ([cmd isEqualToString:@"setIcon"]) {
      NSDictionary *icon = NormalizedIconValue(payloadValue);
      NSString *errorMessage = nil;
      if (payloadValue != nil && payloadValue != [NSNull null] && !icon) {
        response = [self jsonError:@"rejected" message:@"setIcon requires a valid icon payload"];
        return;
      }
      if (![self applyWindowIconValue:icon emitEvent:YES errorMessage:&errorMessage]) {
        response = [self jsonError:@"unsupported"
                           message:errorMessage ?: @"icon could not be materialized as a native image"];
        return;
      }
      response = [self jsonSuccess:[self currentWindowIconValue]];
      return;
    }
    if ([cmd isEqualToString:@"setStyle"]) {
      if ([payload[@"transparent"] boolValue]) {
        response = [self jsonError:@"unsupported"
                           message:@"transparent windows are not implemented for Lynx on macOS"];
        return;
      }
      if (payload[@"backgroundEffect"] && payload[@"backgroundEffect"] != [NSNull null]) {
        response = [self jsonError:@"unsupported"
                           message:@"background effects are not implemented for Lynx on macOS"];
        return;
      }
      if ([payload[@"frameless"] isKindOfClass:[NSNumber class]]) {
        [self applyFrameless:[payload[@"frameless"] boolValue]];
      }
      response = [self jsonSuccess:[self currentWindowStyleDictionary]];
      return;
    }
    if ([cmd isEqualToString:@"getCapabilities"]) {
      response = [self jsonSuccess:[self currentCapabilitiesDictionary]];
      return;
    }
    if ([cmd isEqualToString:@"getScreenDetails"]) {
      response = [self jsonSuccess:[self currentScreenDetailsDictionary]];
      return;
    }
    if ([cmd isEqualToString:@"reportContentRect"]) {
      NSNumber *width =
          [payload[@"width"] isKindOfClass:[NSNumber class]] ? payload[@"width"] : nil;
      NSNumber *height =
          [payload[@"height"] isKindOfClass:[NSNumber class]] ? payload[@"height"] : nil;
      if (!width || !height || width.doubleValue <= 0 || height.doubleValue <= 0) {
        response = [self jsonError:@"rejected"
                           message:@"reportContentRect requires positive width and height"];
        return;
      }
      [self applyReportedContentRect:width.doubleValue height:height.doubleValue];
      response = [self jsonSuccess:[self framePayload]];
      return;
    }
    response = [self jsonError:@"rejected"
                       message:[NSString stringWithFormat:@"unsupported OpenTray window command: %@", cmd]];
  });

  return response ?: [self jsonError:@"internal" message:@"OpenTray window command produced no response"];
}

- (void)windowDidMove:(NSNotification *)notification {
  [self emitWindowEvent:@"moved" payload:[self framePayload]];
}

- (void)windowDidResize:(NSNotification *)notification {
  [self emitWindowEvent:@"resized" payload:[self framePayload]];
  if (!self.opentrayApplyingWindowFrame) {
    [self revealWindowIfNeeded];
  }
}

- (void)windowWillClose:(NSNotification *)notification {
  [self emitWindowEvent:@"closed" payload:@{}];
}

- (void)reloadTemplate {
  NSString *remote_debug_url = nil;
  if (self.url == nil) {
    auto args = [NSProcessInfo processInfo].arguments;
    for (NSUInteger i = 1; args && i < args.count; i++) {
      if ([args[i] hasPrefix:@"--url="]) {
        self.url = [args[i] substringFromIndex:6];
        break;
      } else if ([args[i] hasPrefix:@"--remote-debug="]) {
        remote_debug_url = [args[i] substringFromIndex:15];
        break;
      }
    }
  }
  const char *remote_debug_url_str = nil;
  if (remote_debug_url) {
    remote_debug_url_str = [remote_debug_url UTF8String];
  }
  if (remote_debug_url_str) {
    auto &lynx_env = lynx::pub::LynxEnv::GetInstance();
    lynx_env.SetDevtoolAppInfo("App", "OpenTrayLynxRuntime");
    lynx_env.SetDevtoolAppInfo("AppVersion", "1.0.0");
    lynx_env.ConnectDevtool(remote_debug_url_str);
  }

  if (!self.url || [self.url length] == 0) {
    auto meta_data = std::make_shared<lynx::pub::LynxLoadMeta>();
    meta_data->SetUrl("assets://main.lynx.bundle");
    NSData *data =
        [NSData dataWithContentsOfFile:[[NSBundle mainBundle]
                                           pathForResource:@"Resource/homepage/main.lynx.bundle"
                                                    ofType:nil]];
    meta_data->SetGlobalProps(std::make_shared<lynx::pub::LynxTemplateData>(
        "{\"theme\":\"light\",\"platform\":\"macos\"}"));
    meta_data->SetBinaryData(ConvertNSBinary(data));
    _lynxView->LoadTemplate(meta_data);
    return;
  }
#if ENABLE_TESTBENCH_REPLAY
  if (_isTestBenchReplay) {
    _testBenchActionManager->StartWithUrl([self.url UTF8String]);
    return;
  }
#endif
  NSURL *source = [NSURL URLWithString:self.url];

  if ([source.scheme isEqualToString:@"sslocal"]) {
    NSURL *subSourceUrl = [NSURL URLWithString:source.query];
    if ([subSourceUrl.scheme isEqualToString:@"local"]) {
      NSString *str =
          [NSString stringWithFormat:@"Resource/%@%@", subSourceUrl.host, subSourceUrl.path];
      NSString *targetUrl =
          [[NSBundle mainBundle] pathForResource:[str stringByDeletingPathExtension] ofType:@"js"];
      if (targetUrl == nil) {
        return;
      }
      auto meta_data = std::make_shared<lynx::pub::LynxLoadMeta>();
      meta_data->SetUrl("assets://main.lynx.bundle");
      NSData *data = [NSData dataWithContentsOfFile:targetUrl];
      meta_data->SetBinaryData(ConvertNSBinary(data));
      _lynxView->LoadTemplate(meta_data);
    }
  } else if ([source.scheme isEqualToString:@"file"]) {
    NSString *filePath = self.url;
    NSRange bundleExtensionRange = [filePath rangeOfString:@".lynx.bundle"
                                                   options:NSBackwardsSearch];
    if (bundleExtensionRange.location != NSNotFound) {
      NSUInteger newLength = bundleExtensionRange.location + bundleExtensionRange.length;
      if (newLength <= filePath.length) {
        filePath = [filePath substringToIndex:newLength];
      }
    }
    if ([filePath hasPrefix:@"file://lynx?local://"]) {
      NSString *relativePath = [filePath substringFromIndex:20];
      NSString *bundleDir = [[NSBundle mainBundle] resourcePath];
      NSString *resource_path = [NSString stringWithFormat:@"Resource/%@", relativePath];
      filePath = [bundleDir stringByAppendingPathComponent:resource_path];
      BOOL fileExists = [[NSFileManager defaultManager] fileExistsAtPath:filePath];
      if (!fileExists) {
        NSString *resourceName = [relativePath stringByDeletingPathExtension];
        NSString *resourceType = @"bundle";
        NSString *resourceSubDir = @"Resource";
        filePath = [[NSBundle mainBundle] pathForResource:resourceName
                                                   ofType:resourceType
                                              inDirectory:resourceSubDir];
      }
    }
    NSData *data = [NSData dataWithContentsOfFile:filePath];
    if (data) {
      auto meta_data = std::make_shared<lynx::pub::LynxLoadMeta>();
      meta_data->SetUrl("assets://main.lynx.bundle");
      meta_data->SetBinaryData(ConvertNSBinary(data));
      auto global_props = std::make_shared<lynx::pub::LynxTemplateData>(
          "{\"theme\": \"light\", \"platform\": \"macos\"}");
      meta_data->SetGlobalProps(global_props);
      _lynxView->LoadTemplate(meta_data);
    }
  } else {
    auto meta_data = std::make_shared<lynx::pub::LynxLoadMeta>();
    meta_data->SetUrl([self.url UTF8String]);
    _lynxView->LoadTemplate(meta_data);
  }
}

- (void)loadTemplateFromURL:(NSString *)url {
}

- (void)onRefresh {
  [self reload];
}

- (void)reload {
  [self reloadTemplate];
}

- (void)loadLynxView {
  lynx::pub::LynxView::Builder builder;
  builder.SetScreenSize(self.view.frame.size.width, self.view.frame.size.height, 1.0)
      .SetFrame(0, 0, self.view.frame.size.width, self.view.frame.size.height)
      .SetParent((__bridge NativeWindow)self.view)
      .SetGenericResourceFetcher(std::make_shared<lynx::example::ExampleGenericResourceFetcher>())
      .RegisterNativeView<FakeView>("x-fake-view", (__bridge void *)self);
  if (!self.opentrayBaselineHostMode) {
    builder.RegisterNativeModule("OpenTrayWindowModule", &OpenTrayWindowModuleCreator,
                                 (__bridge void *)self);
  }
#if ENABLE_TESTBENCH_REPLAY
  if (_isTestBenchReplay) {
    lynx::embedder::TestBenchReplayDataModule::RegisterJSB(
        [&builder](const std::string &name, napi_module_creator creator) {
          lynx_view_builder_register_native_module(builder.Impl(), name.c_str(), creator,
                                                   nullptr);
        });
  }
#endif
  _lynxView = builder.Build();
  _lynxView->RegisterNativeView<FakeView>("x-fake-view-alias", (__bridge void *)self);
  std::shared_ptr<lynx::pub::LynxRuntimeLifecycleObserver> upstreamObserver =
      std::make_shared<lynx::example::ExampleLynxRuntimeLifecycleObserver>();
  std::string bootstrapScript;
  if (!self.opentrayBaselineHostMode) {
    bootstrapScript = OpenTrayBootstrapScript(self.opentrayWindowConfig);
  }
  _opentrayRuntimeObserver = std::make_shared<OpenTrayRuntimeLifecycleObserver>(
      std::move(upstreamObserver), std::move(bootstrapScript));
  _lynxView->RegisterRuntimeLifecycleObserver(_opentrayRuntimeObserver);
#if ENABLE_TESTBENCH_REPLAY
  if (_isTestBenchReplay) {
    _testBenchActionManager = std::make_shared<lynx::embedder::TestBenchActionManager>(
        _lynxView,
        [self](int width, int height) { [self.view setFrame:NSMakeRect(0, 0, width, height)]; });
    _testBenchActionManager->SetFetchCallback(
        [](const std::string &url_str, std::function<void(const std::string &result)> callback) {
          NSString *ns_string = [NSString stringWithUTF8String:url_str.c_str()];
          NSURL *url = [NSURL URLWithString:ns_string];
          NSMutableURLRequest *nsRequest = [NSMutableURLRequest requestWithURL:url];
          NSURLSession *session = [NSURLSession sharedSession];
          NSURLSessionDataTask *dataTask = [session
              dataTaskWithRequest:nsRequest
                completionHandler:^(NSData *_Nullable data, NSURLResponse *_Nullable response,
                                    NSError *_Nullable error) {
                  if (data && data.length > 0) {
                    std::string result((const char *)data.bytes, data.length);
                    callback(std::move(result));
                  } else {
                    callback("");
                  }
                }];

          [dataTask resume];
        });
  }
#endif
}

napi_value OpenTrayWindowInvoke(napi_env env, napi_callback_info info) {
  void *data = nullptr;
  lynx_napi_get_instance_data(env, kOpenTrayWindowModuleID, &data);
  ViewController *controller = (__bridge ViewController *)data;
  if (!controller) {
    return NapiString(env, @"{\"ok\":false,\"error\":{\"code\":\"internal\",\"message\":\"OpenTray window controller is unavailable\"}}");
  }

  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) {
    return NapiString(env, [controller jsonError:@"rejected" message:@"OpenTray window invoke requires a JSON payload"]);
  }

  std::string raw = ReadNapiString(env, argv[0]);
  NSString *response = [controller handleOpenTrayWindowRequestJSON:NSStringFromStdString(raw)];
  return NapiString(env, response);
}

napi_value OpenTrayWindowModuleCreator(napi_env env, napi_value exports,
                                       const char *module_name, void *opaque) {
  lynx_napi_set_instance_data(env, kOpenTrayWindowModuleID, opaque, nullptr, nullptr);
  napi_value func;
  napi_create_function(env, "invoke", 1, &OpenTrayWindowInvoke, 0, &func);
  napi_set_named_property(env, exports, "invoke", func);
  return exports;
}

@end
