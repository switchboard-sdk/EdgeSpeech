//
//  EdgeSpeechModuleProvider.mm
//  edgespeech
//

#import "EdgeSpeechModuleProvider.h"

#import <AVFAudio/AVFAudio.h>
#import <ReactCommon/CallInvoker.h>
#import <ReactCommon/TurboModule.h>

#import "NativeEdgeSpeech.h"

@implementation EdgeSpeechModuleProvider

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  // Mic-permission request lives here — the C++ module can't reach AVFoundation.
  // Prompts once; a prior decision resolves without UI.
  facebook::react::NativeEdgeSpeech::setMicrophonePermissionHook(
      [](std::function<void(bool)> completion) {
        if (@available(iOS 17.0, *)) {
          [AVAudioApplication requestRecordPermissionWithCompletionHandler:^(BOOL granted) {
            completion(granted);
          }];
        } else {
          [[AVAudioSession sharedInstance] requestRecordPermission:^(BOOL granted) {
            completion(granted);
          }];
        }
      });

  return std::make_shared<facebook::react::NativeEdgeSpeech>(params.jsInvoker);
}

@end
