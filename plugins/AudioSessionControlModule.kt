package {{PACKAGE_NAME}}

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap

class AudioSessionControlModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AudioSessionControl"

    private val audioManager: AudioManager
        get() = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    @ReactMethod
    fun configureForPlayback(promise: Promise) {
        try {
            audioManager.mode = AudioManager.MODE_NORMAL
            audioManager.isSpeakerphoneOn = true
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_AUDIO_SESSION", e.message, e)
        }
    }

    @ReactMethod
    fun configureForIntercom(promise: Promise) {
        try {
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
            audioManager.isSpeakerphoneOn = true
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_AUDIO_SESSION", e.message, e)
        }
    }

    @ReactMethod
    fun getAudioOutputDevices(promise: Promise) {
        try {
            val result = WritableNativeArray()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
                for (device in devices) {
                    val map = WritableNativeMap()
                    map.putString("uid", device.id.toString())
                    map.putString("name",
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
                            device.productName?.toString() ?: classifyType(device.type)
                        else classifyType(device.type))
                    map.putString("type", classifyType(device.type))
                    result.pushMap(map)
                }
            } else {
                val speaker = WritableNativeMap()
                speaker.putString("uid", "Speaker")
                speaker.putString("name", "Speaker")
                speaker.putString("type", "speaker")
                result.pushMap(speaker)
                if (audioManager.isWiredHeadsetOn) {
                    val headset = WritableNativeMap()
                    headset.putString("uid", "WiredHeadset")
                    headset.putString("name", "Wired Headset")
                    headset.putString("type", "headphones")
                    result.pushMap(headset)
                }
                if (audioManager.isBluetoothA2dpOn) {
                    val bt = WritableNativeMap()
                    bt.putString("uid", "BluetoothA2DP")
                    bt.putString("name", "Bluetooth")
                    bt.putString("type", "bluetooth")
                    result.pushMap(bt)
                }
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("ERR_AUDIO_SESSION", e.message, e)
        }
    }

    @ReactMethod
    fun setPreferredAudioOutput(uid: String, promise: Promise) {
        try {
            when {
                uid == "Speaker" || uid == "BuiltInSpeaker" -> {
                    audioManager.isSpeakerphoneOn = true
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        audioManager.clearCommunicationDevice()
                    }
                }
                else -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        val devices = audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
                        val target = devices.firstOrNull { it.id.toString() == uid }
                        if (target != null) {
                            audioManager.setCommunicationDevice(target)
                            audioManager.isSpeakerphoneOn = false
                        }
                    } else {
                        audioManager.isSpeakerphoneOn = false
                        if (uid.contains("Bluetooth", ignoreCase = true)) {
                            @Suppress("DEPRECATION")
                            audioManager.isBluetoothScoOn = true
                            audioManager.startBluetoothSco()
                        }
                    }
                }
            }
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("ERR_AUDIO_SESSION", e.message, e)
        }
    }

    private fun classifyType(type: Int): String {
        return when (type) {
            AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "speaker"
            AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "headphones"
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth"
            else -> "other"
        }
    }
}
