import ExpoModulesCore
import Foundation

// Resolves a base64-encoded NSData bookmark (as returned by
// @react-native-documents/picker's pickDirectory) back to a security-scoped
// file:// URL, and starts access so expo-file-system can read inside it.
//
// We track active scopes by absoluteString so releaseBookmark from JS lands on
// the exact same URL we called startAccessingSecurityScopedResource on — the
// URL must be the bookmark-resolved one, not the original picker URI (which
// can differ by path normalization). Keeping the URL itself alive in the
// dictionary is required: stopAccessingSecurityScopedResource must be called
// on the same NSURL instance that started it.
//
// Bookmark resolution itself is cheap and synchronous; we do it on a background
// queue anyway because we're an AsyncFunction and don't want to risk blocking
// the JS thread.

public class FolderBookmarkModule: Module {
  private let queue = DispatchQueue(label: "folder-bookmark.scope", qos: .userInitiated)
  // Keyed by url.absoluteString — the JS side stores and releases by that key.
  // NSURL retains the security scope; we keep the instance alive until release.
  private var activeScopes: [String: URL] = [:]

  public func definition() -> ModuleDefinition {
    Name("FolderBookmark")

    AsyncFunction("resolveBookmark") { (base64Bookmark: String) -> [String: Any]? in
      guard let data = Data(base64Encoded: base64Bookmark) else {
        return nil
      }

      var isStale: ObjCBool = false
      let url: URL
      do {
        url = try URL(
          resolvingBookmarkData: data,
          options: [.withoutUI],
          relativeTo: nil,
          bookmarkDataIsStale: &isStale
        )
      } catch {
        NSLog("FolderBookmark: failed to resolve bookmark: \(error.localizedDescription)")
        return nil
      }

      // Security-scoped start. If this fails the URL still resolves but
      // expo-file-system can't read inside it — surface that as nil so the
      // caller skips the source rather than racing on permission errors.
      guard url.startAccessingSecurityScopedResource() else {
        NSLog("FolderBookmark: startAccessingSecurityScopedResource returned false for \(url.absoluteString)")
        return nil
      }

      let key = url.absoluteString
      self.queue.sync {
        // If somehow we re-resolve while a scope is already held, release the
        // previous one so we don't leak — the new URL instance becomes the
        // owner of the scope from here on.
        if let existing = self.activeScopes[key] {
          existing.stopAccessingSecurityScopedResource()
        }
        self.activeScopes[key] = url
      }

      return [
        "uri": key,
        "stale": isStale.boolValue
      ]
    }

    AsyncFunction("releaseBookmark") { (uri: String) -> Void in
      let url: URL? = self.queue.sync {
        let existing = self.activeScopes[uri]
        self.activeScopes[uri] = nil
        return existing
      }
      url?.stopAccessingSecurityScopedResource()
    }
  }
}
