import Foundation
import AVFAudio

protocol AudioSessionHandler: AnyObject {
  var audioSession: AVAudioSession { get }
  func handleInterruptionBegan(applicationWasSuspended: Bool)
  func handleInterruptionEnd(shouldResume: Bool)
  func handleAudioRouteChange()
  func handleMediaServerWereReset()
  func handleMediaServerWereLost()
}

extension AudioSessionHandler {
  func subscribeAudioSessionNotifications() -> [Any] {
    let center = NotificationCenter.default
    let s1 = center.addObserver(forName: AVAudioSession.interruptionNotification, object: audioSession, queue: nil) { [weak self] n in
      guard let self else { return }
      guard let type = n.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber else { return }
      let t = AVAudioSession.InterruptionType(rawValue: type.uintValue)
      if t == .began {
        var suspended = false
        if #available(iOS 14.5, *) {
          if let r = n.userInfo?[AVAudioSessionInterruptionReasonKey] as? NSNumber {
            suspended = AVAudioSession.InterruptionReason(rawValue: r.uintValue) == .appWasSuspended
          }
        }
        handleInterruptionBegan(applicationWasSuspended: suspended)
      } else if t == .ended {
        var resume = false
        if let o = n.userInfo?[AVAudioSessionInterruptionOptionKey] as? NSNumber {
          resume = AVAudioSession.InterruptionOptions(rawValue: o.uintValue).contains(.shouldResume)
        }
        handleInterruptionEnd(shouldResume: resume)
      }
    }
    let s2 = center.addObserver(forName: AVAudioSession.routeChangeNotification, object: audioSession, queue: nil) { [weak self] _ in
      self?.handleAudioRouteChange()
    }
    let s3 = center.addObserver(forName: AVAudioSession.mediaServicesWereLostNotification, object: audioSession, queue: nil) { [weak self] _ in
      self?.handleMediaServerWereLost()
    }
    let s4 = center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: audioSession, queue: nil) { [weak self] _ in
      self?.handleMediaServerWereReset()
    }
    return [s1, s2, s3, s4]
  }

  func unsubscribeAudioSessionNotifications(observers: [Any]) {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
  }

  func configureStereoRecording() {
    guard let inputs = audioSession.availableInputs,
          let mic = inputs.first(where: { $0.portType == .builtInMic }) else { return }
    try? audioSession.setPreferredInput(mic)
  }
}
