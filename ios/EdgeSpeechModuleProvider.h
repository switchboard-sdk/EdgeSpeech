//
//  EdgeSpeechModuleProvider.h
//  edgespeech
//
//  RCTModuleProvider for the EdgeSpeech C++ TurboModule. Registered with React
//  Native via package.json `codegenConfig.ios.modulesProvider` so autolinking
//  hands JS's `EdgeSpeech` module off to the shared C++ implementation.
//

#import <Foundation/Foundation.h>
#import <ReactCommon/RCTTurboModule.h>

NS_ASSUME_NONNULL_BEGIN

@interface EdgeSpeechModuleProvider : NSObject <RCTModuleProvider>

@end

NS_ASSUME_NONNULL_END
