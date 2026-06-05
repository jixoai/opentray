// Copyright 2025 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

#include "explorer/darwin/macos/lynx_explorer/OpenTrayLynxRuntime/service/LynxHttpService.h"
#import <Foundation/Foundation.h>
#include <cstddef>
#include <cstdint>

namespace lynx {
namespace service {

void LynxHttpServiceImpl::Request(std::shared_ptr<pub::LynxHttpRequest> http_request,
                                  std::shared_ptr<pub::LynxHttpResponse> http_response) {
  NSURL *url = [NSURL URLWithString:[NSString stringWithUTF8String:http_request->GetUrl().c_str()]];
  NSMutableURLRequest *nsRequest = [NSMutableURLRequest requestWithURL:url];
  nsRequest.HTTPMethod = [NSString stringWithUTF8String:http_request->GetMethod().c_str()];

  for (const auto &header : http_request->GetHeaders()) {
    NSString *key = [NSString stringWithUTF8String:header.first.c_str()];
    NSString *value = [NSString stringWithUTF8String:header.second.c_str()];
    if (key && value) {
      [nsRequest setValue:value forHTTPHeaderField:key];
    }
  }

  const auto &request_body = http_request->GetBody();
  if (!request_body.empty()) {
    nsRequest.HTTPBody = [NSData dataWithBytes:request_body.data() length:request_body.size()];
  }

  NSURLSession *session = [NSURLSession sharedSession];
  NSURLSessionDataTask *dataTask =
      [session dataTaskWithRequest:nsRequest
                 completionHandler:^(NSData *_Nullable data, NSURLResponse *_Nullable response,
                                     NSError *_Nullable error) {
                   if (data && data.length > 0) {
                     http_response->SetBody(
                         (uint8_t *)data.bytes, data.length,
                         [](uint8_t *body, size_t length, void *opaque) { CFRelease(opaque); },
                         (__bridge_retained void *)data);
                   }

                   if (error) {
                     static const int SDK_ERROR_STATUS_CODE = 499;
                     http_response->SetStatusCode(SDK_ERROR_STATUS_CODE);
                     http_response->SetStatusText([error.localizedDescription UTF8String]);
                   } else if ([response isKindOfClass:[NSHTTPURLResponse class]]) {
                     NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;
                     http_response->SetStatusCode(httpResponse.statusCode);

                     NSString *statusText =
                         [NSHTTPURLResponse localizedStringForStatusCode:httpResponse.statusCode];
                     http_response->SetStatusText(statusText ? [statusText UTF8String] : "");

                     for (NSString *key in httpResponse.allHeaderFields) {
                       NSString *value = httpResponse.allHeaderFields[key];
                       if (key && value) {
                         http_response->AddHeader([key UTF8String], [value UTF8String]);
                       }
                     }
                   } else {
                     http_response->SetStatusCode(-1);
                     http_response->SetStatusText("missing http response");
                   }

                   http_response->Complete();
                 }];

  [dataTask resume];
}

}  // namespace service
}  // namespace lynx
