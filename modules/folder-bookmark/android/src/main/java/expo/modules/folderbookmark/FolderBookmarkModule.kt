package expo.modules.folderbookmark

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Android has no equivalent to iOS security-scoped bookmarks — SAF grants
// are persistent through the URI itself, so the sync path on Android lists
// the content:// URI directly and never calls into this module.
//
// Stub implementations exist so the JS surface compiles cross-platform.
// resolveBookmark always returns null; releaseBookmark is a no-op.
class FolderBookmarkModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FolderBookmark")

    AsyncFunction("resolveBookmark") { _: String ->
      null as Map<String, Any>?
    }

    AsyncFunction("releaseBookmark") { _: String ->
      // no-op
    }
  }
}
