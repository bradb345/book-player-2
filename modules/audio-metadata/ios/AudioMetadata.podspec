Pod::Spec.new do |s|
  s.name           = 'AudioMetadata'
  s.version        = '0.1.0'
  s.summary        = 'Reads embedded cover art from audio files'
  s.description    = 'Local Expo module exposing embedded audio artwork via AVAsset'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '15.1'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
