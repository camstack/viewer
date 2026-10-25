import ExpoModulesCore
import Foundation
import Security

/// A P-256 device key that never leaves the chip.
///
/// The key is created inside the Secure Enclave (`kSecAttrTokenIDSecureEnclave`),
/// is not exportable, is usable once the device has been unlocked after boot
/// (`AfterFirstUnlockThisDeviceOnly`, so a cold start from a notification on a
/// locked phone can still sign) and never migrates to another device or a
/// backup. A simulator has no Secure Enclave: it gets a software key in the
/// keychain with the same accessibility, and says so (`hardwareBacked: false`).
public final class CamstackDeviceKeyModule: Module {
  /// ASN.1 prefix of a P-256 SubjectPublicKeyInfo; the 65-byte X9.63 point follows.
  private static let spkiPrefix: [UInt8] = [
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
  ]

  public func definition() -> ModuleDefinition {
    Name("CamstackDeviceKey")

    AsyncFunction("generateKey") { (alias: String) throws -> [String: Any] in
      try Self.deleteIfPresent(alias)
      let (key, _) = try Self.createKey(alias)
      // Ask the OS where the key lives rather than trusting the branch taken.
      return ["publicKeySpki": try Self.spkiBase64Url(of: key), "hardwareBacked": Self.isInSecureEnclave(key)]
    }

    AsyncFunction("getPublicKey") { (alias: String) throws -> String? in
      guard let key = try Self.findKey(alias) else { return nil }
      return try Self.spkiBase64Url(of: key)
    }

    AsyncFunction("sign") { (alias: String, message: String) throws -> String in
      guard let key = try Self.findKey(alias) else {
        throw Exception(name: "ERR_KEY_MISSING", description: "No device key for this alias")
      }
      var error: Unmanaged<CFError>?
      // SHA-256 over the UTF-8 message, ECDSA, DER-encoded signature.
      guard let signature = SecKeyCreateSignature(
        key, .ecdsaSignatureMessageX962SHA256, Data(message.utf8) as CFData, &error
      ) as Data? else {
        throw Exception(
          name: "ERR_SIGN_FAILED",
          description: (error?.takeRetainedValue() as Error?)?.localizedDescription ?? "Signing failed"
        )
      }
      return Self.base64Url(signature)
    }

    AsyncFunction("hasKey") { (alias: String) throws -> Bool in
      return try Self.findKey(alias) != nil
    }

    AsyncFunction("deleteKey") { (alias: String) throws -> Bool in
      return try Self.deleteIfPresent(alias)
    }
  }

  // MARK: - Keychain

  private static func tag(_ alias: String) -> Data { Data("camstack.device-key.\(alias)".utf8) }

  private static func query(_ alias: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: tag(alias),
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
    ]
  }

  private static func findKey(_ alias: String) throws -> SecKey? {
    var q = query(alias)
    q[kSecReturnRef as String] = true
    var item: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let item = item else {
      throw Exception(name: "ERR_KEYCHAIN", description: "Keychain read failed (\(status))")
    }
    // swiftlint:disable:next force_cast
    return (item as! SecKey)
  }

  @discardableResult
  private static func deleteIfPresent(_ alias: String) throws -> Bool {
    let status = SecItemDelete(query(alias) as CFDictionary)
    if status == errSecSuccess { return true }
    if status == errSecItemNotFound { return false }
    throw Exception(name: "ERR_KEYCHAIN", description: "Keychain delete failed (\(status))")
  }

  private static func createKey(_ alias: String) throws -> (SecKey, Bool) {
    var acError: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(
      kCFAllocatorDefault,
      kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
      .privateKeyUsage,
      &acError
    ) else {
      throw Exception(name: "ERR_ACCESS_CONTROL", description: "Access control creation failed")
    }
    var attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: [
        kSecAttrIsPermanent as String: true,
        kSecAttrApplicationTag as String: tag(alias),
        kSecAttrAccessControl as String: access,
      ] as [String: Any],
    ]
    #if !targetEnvironment(simulator)
    attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
    var error: Unmanaged<CFError>?
    if let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) { return (key, true) }
    throw Exception(
      name: "ERR_KEY_GENERATION",
      description: (error?.takeRetainedValue() as Error?)?.localizedDescription ?? "Secure Enclave key generation failed"
    )
    #else
    // No Secure Enclave on a simulator: a software key, same accessibility.
    attributes[kSecPrivateKeyAttrs as String] = [
      kSecAttrIsPermanent as String: true,
      kSecAttrApplicationTag as String: tag(alias),
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ] as [String: Any]
    var error: Unmanaged<CFError>?
    guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      throw Exception(
        name: "ERR_KEY_GENERATION",
        description: (error?.takeRetainedValue() as Error?)?.localizedDescription ?? "Key generation failed"
      )
    }
    return (key, false)
    #endif
  }

  private static func isInSecureEnclave(_ key: SecKey) -> Bool {
    guard let attrs = SecKeyCopyAttributes(key) as? [String: Any],
      let token = attrs[kSecAttrTokenID as String] as? String
    else { return false }
    return token == (kSecAttrTokenIDSecureEnclave as String)
  }

  private static func spkiBase64Url(of privateKey: SecKey) throws -> String {
    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
      throw Exception(name: "ERR_PUBLIC_KEY", description: "Public key unavailable")
    }
    var error: Unmanaged<CFError>?
    guard let point = SecKeyCopyExternalRepresentation(publicKey, &error) as Data? else {
      throw Exception(name: "ERR_PUBLIC_KEY", description: "Public key export failed")
    }
    return base64Url(Data(spkiPrefix) + point)
  }

  private static func base64Url(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
