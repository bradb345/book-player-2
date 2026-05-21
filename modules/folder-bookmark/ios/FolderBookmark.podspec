Pod::Spec.new do |s|
  s.name           = 'FolderBookmark'
  s.version        = '0.1.0'
  s.summary        = 'Resolves iOS security-scoped bookmarks for picked folders'
  s.description    = 'Local Expo module exposing URL bookmark resolution for re-acquiring folder access across app launches'
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
