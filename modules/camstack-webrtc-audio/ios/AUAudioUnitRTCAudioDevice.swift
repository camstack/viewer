import Foundation
import WebRTC
import AVFoundation

/// Custom RTCAudioDevice for receive-only streaming. Microphone and playback
/// are activated only when WebRTC requests them (mic icon / audio icon).
/// Based on https://github.com/mstyura/RTCAudioDevice
///
/// @objc required so NSClassFromString("AUAudioUnitRTCAudioDevice") finds it from ObjC.
@objc(AUAudioUnitRTCAudioDevice)
final class AUAudioUnitRTCAudioDevice: NSObject {
  let audioSession = AVAudioSession.sharedInstance()
  private let queue = DispatchQueue(label: "AUAudioUnitRTCAudioDevice")
  private var audioUnit: AUAudioUnit?
  private var subscribtions: [Any]?
  private var shouldPlay = false
  private var shouldRecord = false
  private var isInterrupted_ = false
  private var isInterrupted: Bool {
    get { queue.sync { isInterrupted_ } }
    set { queue.sync { isInterrupted_ = newValue } }
  }
  var delegate_: RTCAudioDeviceDelegate?
  private var delegate: RTCAudioDeviceDelegate? {
    get { queue.sync { delegate_ } }
    set { queue.sync { delegate_ = newValue } }
  }
  private lazy var audioInputFormat = AVAudioFormat(
    commonFormat: .pcmFormatInt16,
    sampleRate: audioSession.sampleRate,
    channels: AVAudioChannelCount(min(2, audioSession.inputNumberOfChannels)),
    interleaved: true
  )! {
    didSet {
      guard oldValue != audioInputFormat else { return }
      delegate?.notifyAudioInputParametersChange()
    }
  }
  private lazy var audioOutputFormat = AVAudioFormat(
    commonFormat: .pcmFormatInt16,
    sampleRate: audioSession.sampleRate,
    channels: AVAudioChannelCount(min(2, audioSession.outputNumberOfChannels)),
    interleaved: true
  )! {
    didSet {
      guard oldValue != audioOutputFormat else { return }
      delegate?.notifyAudioOutputParametersChange()
    }
  }
  private(set) lazy var inputLatency = audioSession.inputLatency {
    didSet {
      guard oldValue != inputLatency else { return }
      delegate?.notifyAudioInputParametersChange()
    }
  }
  private(set) lazy var outputLatency = audioSession.outputLatency {
    didSet {
      guard oldValue != outputLatency else { return }
      delegate?.notifyAudioOutputParametersChange()
    }
  }

  override init() { super.init() }

  private func updateAudioUnit() {
    guard let audioUnit = audioUnit else { return }

    let stopAudioUnit = { (_: String) in
      if audioUnit.isRunning {
        audioUnit.stopHardware()
        self.delegate?.notifyAudioInputInterrupted()
        self.delegate?.notifyAudioOutputInterrupted()
      }
    }
    let stopAndUninit = { (label: String) in
      stopAudioUnit(label)
      if audioUnit.renderResourcesAllocated {
        audioUnit.deallocateRenderResources()
      }
    }

    guard let delegate = delegate, (shouldPlay || shouldRecord), !isInterrupted else {
      stopAndUninit("turn off")
      return
    }

    if audioUnit.isInputEnabled != shouldRecord {
      stopAndUninit("toggle input")
      audioUnit.isInputEnabled = shouldRecord
    }
    if audioUnit.isOutputEnabled != shouldPlay {
      stopAndUninit("toggle output")
      audioUnit.isOutputEnabled = shouldPlay
    }

    let rate = audioSession.sampleRate

    if shouldRecord {
      let rtcRecordFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: rate,
        channels: AVAudioChannelCount(min(2, audioSession.inputNumberOfChannels)),
        interleaved: true
      )!
      let bus = 1
      let outputBus = audioUnit.outputBusses[bus]
      if outputBus.format != rtcRecordFormat {
        stopAndUninit("record format")
        try? outputBus.setFormat(rtcRecordFormat)
      }
      audioInputFormat = rtcRecordFormat

      let deliverRecordedData = delegate.deliverRecordedData
      let renderBlock = audioUnit.renderBlock
      let customRenderBlock: RTCAudioDeviceRenderRecordedDataBlock = { actionFlags, timestamp, inputBusNumber, frameCount, abl, renderContext in
        return renderBlock(actionFlags, timestamp, frameCount, inputBusNumber, abl, nil)
      }
      audioUnit.inputHandler = { actionFlags, timestamp, frameCount, inputBusNumber in
        _ = deliverRecordedData(actionFlags, timestamp, inputBusNumber, frameCount, nil, nil, customRenderBlock)
      }
      inputLatency = audioSession.inputLatency
    }

    if shouldPlay {
      let rtcPlayFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16,
        sampleRate: rate,
        channels: AVAudioChannelCount(min(2, audioSession.outputNumberOfChannels)),
        interleaved: true
      )!
      let bus = 0
      let inputBus = audioUnit.inputBusses[bus]
      if inputBus.format != rtcPlayFormat {
        stopAndUninit("play format")
        try? inputBus.setFormat(rtcPlayFormat)
      }
      audioOutputFormat = rtcPlayFormat

      if audioUnit.outputProvider == nil {
        let getPlayoutData = delegate.getPlayoutData
        var outputCallCount: Int = 0
        audioUnit.outputProvider = { actionFlags, timestamp, frameCount, inputBusNumber, inputData in
          let status = getPlayoutData(actionFlags, timestamp, inputBusNumber, frameCount, inputData)
          outputCallCount += 1
          if outputCallCount == 1 || outputCallCount == 50 {
            NSLog("[AUAudioUnitRTCAudioDevice] outputProvider called #%d, status=%d, frames=%d", outputCallCount, status, frameCount)
          }
          return status
        }
      }
      outputLatency = audioSession.outputLatency
    }

    if !audioUnit.renderResourcesAllocated {
      do {
        try audioUnit.allocateRenderResources()
      } catch {
        NSLog("[AUAudioUnitRTCAudioDevice] allocateRenderResources FAILED: %@", error.localizedDescription)
        return
      }
    }
    if !audioUnit.isRunning {
      do {
        try audioUnit.startHardware()
        NSLog("[AUAudioUnitRTCAudioDevice] startHardware OK (play=%d rec=%d)", shouldPlay ? 1 : 0, shouldRecord ? 1 : 0)
      } catch {
        NSLog("[AUAudioUnitRTCAudioDevice] startHardware FAILED: %@", error.localizedDescription)
      }
    }
  }
}

extension AUAudioUnitRTCAudioDevice: RTCAudioDevice {
  var deviceInputSampleRate: Double {
    let r = audioInputFormat.sampleRate
    return r > 0 ? r : audioSession.sampleRate
  }
  var deviceOutputSampleRate: Double {
    let r = audioOutputFormat.sampleRate
    return r > 0 ? r : audioSession.sampleRate
  }
  var inputIOBufferDuration: TimeInterval { audioSession.ioBufferDuration }
  var outputIOBufferDuration: TimeInterval { audioSession.ioBufferDuration }
  var inputNumberOfChannels: Int {
    let c = audioInputFormat.channelCount
    return c > 0 ? Int(c) : min(2, audioSession.inputNumberOfChannels)
  }
  var outputNumberOfChannels: Int {
    let c = audioOutputFormat.channelCount
    return c > 0 ? Int(c) : min(2, audioSession.outputNumberOfChannels)
  }
  var isInitialized: Bool { delegate != nil && audioUnit != nil }

  func initialize(with delegate: RTCAudioDeviceDelegate) -> Bool {
    // A refused initialize is FATAL to WebRTC (`adm_helpers::Init` aborts the
    // process on it), and this one instance outlives the JS bridge: after an
    // OTA reload the new WebRTCModule builds a new factory around the same
    // shared device, whose delegate the torn-down factory never cleared.
    // TestFlight 1.0.374 (15), 2026-09-06 16:31: SIGABRT in
    // cricket::WebRtcVoiceEngine::Init three seconds after launch. A stale
    // initialisation is torn down and replaced, never refused.
    if self.delegate != nil {
      NSLog("[AUAudioUnitRTCAudioDevice] initialize while already initialised — tearing the stale device down first")
      _ = terminateDevice()
    }
    let desc = AudioComponentDescription(
      componentType: kAudioUnitType_Output,
      componentSubType: kAudioUnitSubType_RemoteIO,
      componentManufacturer: kAudioUnitManufacturer_Apple,
      componentFlags: 0,
      componentFlagsMask: 0
    )
    guard let au = try? AUAudioUnit(componentDescription: desc) else {
      NSLog("[AUAudioUnitRTCAudioDevice] Failed to create AUAudioUnit")
      return false
    }
    NSLog("[AUAudioUnitRTCAudioDevice] Created RemoteIO audio unit")
    au.isInputEnabled = false
    au.isOutputEnabled = false
    au.maximumFramesToRender = 1024
    if subscribtions == nil { subscribtions = subscribeAudioSessionNotifications() }
    configureStereoRecording()
    audioUnit = au
    self.delegate = delegate
    return true
  }

  func terminateDevice() -> Bool {
    if let s = subscribtions { unsubscribeAudioSessionNotifications(observers: s) }
    subscribtions = nil
    shouldPlay = false
    shouldRecord = false
    updateAudioUnit()
    audioUnit = nil
    // Cleared so the next factory can initialise this instance again.
    delegate = nil
    return true
  }

  var isPlayoutInitialized: Bool { isInitialized }
  func initializePlayout() -> Bool { isPlayoutInitialized }
  var isPlaying: Bool { shouldPlay }
  func startPlayout() -> Bool {
    NSLog("[AUAudioUnitRTCAudioDevice] startPlayout")
    shouldPlay = true; updateAudioUnit(); return true
  }
  func stopPlayout() -> Bool {
    NSLog("[AUAudioUnitRTCAudioDevice] stopPlayout")
    shouldPlay = false; updateAudioUnit(); return true
  }

  var isRecordingInitialized: Bool { isInitialized }
  func initializeRecording() -> Bool { isRecordingInitialized }
  var isRecording: Bool { shouldRecord }
  func startRecording() -> Bool {
    NSLog("[AUAudioUnitRTCAudioDevice] startRecording")
    shouldRecord = true; updateAudioUnit(); return true
  }
  func stopRecording() -> Bool {
    NSLog("[AUAudioUnitRTCAudioDevice] stopRecording")
    shouldRecord = false; updateAudioUnit(); return true
  }
}

extension AUAudioUnitRTCAudioDevice: AudioSessionHandler {
  func handleInterruptionBegan(applicationWasSuspended: Bool) {
    guard !applicationWasSuspended else { return }
    isInterrupted = true
    delegate?.dispatchAsync { self.updateAudioUnit() }
  }
  func handleInterruptionEnd(shouldResume: Bool) {
    isInterrupted = false
    delegate?.dispatchAsync { self.updateAudioUnit() }
  }
  func handleAudioRouteChange() {
    delegate?.dispatchAsync { self.updateAudioUnit() }
  }
  func handleMediaServerWereReset() {
    delegate?.dispatchAsync { self.updateAudioUnit() }
  }
  func handleMediaServerWereLost() {}
}
