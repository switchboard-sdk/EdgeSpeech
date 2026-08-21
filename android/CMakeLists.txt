# Android native build for the EdgeSpeech C++ TurboModule.
#
# This file is pulled into the consuming app's native build by RN autolinking
# (react-native.config.js → android.cxxModuleCMakeListsPath). It compiles the
# shared C++ (../cpp) and links it against the codegen-generated spec and the
# Switchboard SDK + extensions (resolved via Prefab from the AAR dependencies).
cmake_minimum_required(VERSION 3.13)
project(EdgeSpeech)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(EDGESPEECH_CPP_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../cpp")

# Module name must match react-native.config.js `cxxModuleCMakeListsModuleName`.
add_library(react-native-edgespeech SHARED
    "${EDGESPEECH_CPP_DIR}/NativeEdgeSpeech.cpp"
)

target_include_directories(react-native-edgespeech PUBLIC "${EDGESPEECH_CPP_DIR}")

# Switchboard SDK + extensions via Prefab. The AAR Prefab package names are
# SwitchboardSDK / SwitchboardOnnx / SwitchboardSileroVAD / SwitchboardWhisper /
# SwitchboardSherpa (verified from the 3.2.5 AARs).
find_package(SwitchboardSDK REQUIRED CONFIG)
find_package(SwitchboardOnnx REQUIRED CONFIG)
find_package(SwitchboardSileroVAD REQUIRED CONFIG)
find_package(SwitchboardWhisper REQUIRED CONFIG)
find_package(SwitchboardSherpa REQUIRED CONFIG)

target_link_libraries(react-native-edgespeech
    # Codegen-generated spec (RNEdgeSpeechSpecJSI.h) — provides jsi/TurboModule.
    react_codegen_RNEdgeSpeechSpec
    SwitchboardSDK::SwitchboardSDK
    SwitchboardOnnx::SwitchboardOnnx
    SwitchboardSileroVAD::SwitchboardSileroVAD
    SwitchboardWhisper::SwitchboardWhisper
    SwitchboardSherpa::SwitchboardSherpa
)
