package expo.modules.audiometadata

import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AudioMetadataModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AudioMetadata")

    // Reads the embedded cover picture from an audio file and returns it as a
    // base64 string (no data: prefix), or null when there's none. Works for
    // SAF content:// URIs (the file is never copied) as well as file:// paths.
    // AsyncFunction already runs off the JS thread, and MediaMetadataRetriever
    // is synchronous, so no coroutine is needed here.
    AsyncFunction("getEmbeddedArtwork") { uri: String ->
      val context = appContext.reactContext
      if (context == null) {
        null
      } else {
        val retriever = MediaMetadataRetriever()
        try {
          if (uri.startsWith("content://") || uri.startsWith("file://")) {
            retriever.setDataSource(context, Uri.parse(uri))
          } else {
            retriever.setDataSource(uri)
          }
          val picture = retriever.embeddedPicture
          if (picture == null) null else Base64.encodeToString(picture, Base64.NO_WRAP)
        } catch (e: Exception) {
          null
        } finally {
          try {
            retriever.release()
          } catch (_: Exception) {
          }
        }
      }
    }
  }
}
