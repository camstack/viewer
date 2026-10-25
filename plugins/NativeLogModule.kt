package {{PACKAGE_NAME}}

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File

/**
 * Native log module for Android.
 * Reads/writes log file. iOS captures RCTLog automatically; Android file is populated
 * when native code writes (e.g. via future logcat integration).
 */
class NativeLogModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "NativeLogModule"

    private val logFile: File
        get() = File(reactApplicationContext.filesDir, "camstack-native-logs.json")

    @ReactMethod
    fun readLogs(promise: Promise) {
        try {
            val content = if (logFile.exists()) logFile.readText() else ""
            promise.resolve(content)
        } catch (e: Exception) {
            promise.resolve("")
        }
    }

    @ReactMethod
    fun clearLogs(promise: Promise) {
        try {
            if (logFile.exists()) {
                logFile.writeText("")
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_CLEAR", e.message, e)
        }
    }
}
