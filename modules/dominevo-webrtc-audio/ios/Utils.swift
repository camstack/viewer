import Foundation
import AVFoundation

extension AVAudioSession {
  var supportsVoiceProcessing: Bool {
    category == .playAndRecord && (mode == .voiceChat || mode == .videoChat)
  }
}
