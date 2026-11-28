import ExpoModulesCore

/// Configures WebRTC for receive-only audio without the orange mic indicator.
/// Calls native setup before WebRTC initializes.
public class WebRTCAudioDeviceAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    WebRTCAudioDeviceSetup.configure()
    return false
  }
}
