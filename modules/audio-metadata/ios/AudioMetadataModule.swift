import ExpoModulesCore
import AVFoundation

public class AudioMetadataModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioMetadata")

    // Reads the embedded cover picture from an audio file and returns it as a
    // base64 string (no data: prefix), or nil when there's none. iOS imports
    // are copied into the app sandbox, so this is a local file:// URL.
    AsyncFunction("getEmbeddedArtwork") { (uri: String) -> String? in
      guard let url = URL(string: uri) ?? URL(fileURLWithPath: uri) as URL? else {
        return nil
      }
      let asset = AVURLAsset(url: url)

      // Common metadata covers ID3 APIC and MP4 'covr' for most files.
      for item in asset.commonMetadata where item.commonKey == .commonKeyArtwork {
        if let data = item.dataValue {
          return data.base64EncodedString()
        }
      }

      // Fall back to scanning every available metadata format.
      for format in asset.availableMetadataFormats {
        for item in asset.metadata(forFormat: format) where item.commonKey == .commonKeyArtwork {
          if let data = item.dataValue {
            return data.base64EncodedString()
          }
        }
      }

      return nil
    }
  }
}
