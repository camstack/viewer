package expo.modules.camstackdevicekey

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * A P-256 device key in the Android Keystore: StrongBox when the device has
 * one, the TEE otherwise. Not exportable; the private key never leaves the
 * secure hardware. Signs SHA-256 ECDSA and answers a DER signature.
 */
class CamstackDeviceKeyModule : Module() {
  private val keyStore: KeyStore by lazy { KeyStore.getInstance(PROVIDER).apply { load(null) } }

  override fun definition() = ModuleDefinition {
    Name("CamstackDeviceKey")

    AsyncFunction("generateKey") { alias: String ->
      keyStore.deleteEntry(entry(alias))
      // StrongBox first. ANY failure there (not only "unavailable": drivers throw
      // ProviderException, InvalidAlgorithmParameterException, ...) removes the
      // half-made entry and retries in the TEE.
      var strongBox = false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        try {
          generate(alias, true)
          strongBox = true
        } catch (e: Exception) {
          keyStore.deleteEntry(entry(alias))
        }
      }
      if (!strongBox) generate(alias, false)
      val level = securityLevel(alias)
      mapOf(
        "publicKeySpki" to spki(alias),
        "hardwareBacked" to (level == "strongbox" || level == "tee"),
        "level" to level,
      )
    }

    AsyncFunction("getPublicKey") { alias: String ->
      if (keyStore.containsAlias(entry(alias))) spki(alias) else null
    }

    AsyncFunction("sign") { alias: String, message: String ->
      val key = keyStore.getKey(entry(alias), null) as? PrivateKey
        ?: throw CodedException("ERR_KEY_MISSING", "No device key for this alias", null)
      val signature = Signature.getInstance("SHA256withECDSA")
      signature.initSign(key)
      signature.update(message.toByteArray(Charsets.UTF_8))
      b64url(signature.sign())
    }

    AsyncFunction("hasKey") { alias: String -> keyStore.containsAlias(entry(alias)) }

    AsyncFunction("deleteKey") { alias: String ->
      val had = keyStore.containsAlias(entry(alias))
      keyStore.deleteEntry(entry(alias))
      had
    }
  }

  private fun entry(alias: String) = "camstack.device-key.$alias"

  private fun generate(alias: String, strongBox: Boolean) {
    val builder = KeyGenParameterSpec.Builder(entry(alias), KeyProperties.PURPOSE_SIGN)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .setUserAuthenticationRequired(false)
    if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) builder.setIsStrongBoxBacked(true)
    KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, PROVIDER).run {
      initialize(builder.build())
      generateKeyPair()
    }
  }

  /** What the OS says about where the key lives: "strongbox", "tee" or "software". */
  private fun securityLevel(alias: String): String {
    val key = keyStore.getKey(entry(alias), null) as? PrivateKey ?: return "software"
    val info = KeyFactory.getInstance(key.algorithm, PROVIDER).getKeySpec(key, KeyInfo::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      return when (info.securityLevel) {
        KeyProperties.SECURITY_LEVEL_STRONGBOX -> "strongbox"
        KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT -> "tee"
        else -> "software"
      }
    }
    @Suppress("DEPRECATION")
    return if (info.isInsideSecureHardware) "tee" else "software"
  }

  /** The certificate's public key encodes as X.509 SubjectPublicKeyInfo. */
  private fun spki(alias: String): String {
    val cert = keyStore.getCertificate(entry(alias))
      ?: throw CodedException("ERR_KEY_MISSING", "No device key for this alias", null)
    return b64url(cert.publicKey.encoded)
  }

  private fun b64url(bytes: ByteArray): String =
    Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

  companion object {
    private const val PROVIDER = "AndroidKeyStore"
  }
}
