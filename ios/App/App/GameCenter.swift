import UIKit
import Capacitor
import GameKit
import CoreMotion
import AVFoundation

/// Hosts the web game full screen in portrait and registers the Game Center plugin below.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(GameCenterPlugin())
        bridge?.registerPluginInstance(MotionPlugin())
        // Game audio: respect the silent switch and mix with whatever the player is listening to.
        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default, options: [])
        try? AVAudioSession.sharedInstance().setActive(true)
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // Rounds are short and touch-driven; never let the screen dim mid-game.
        UIApplication.shared.isIdleTimerDisabled = true
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // Sign in to Game Center once the game is on screen, as Apple recommends.
        GameCenterAuth.shared.start(from: self)
    }
    // Status bar and home indicator are hidden by Capacitor's SystemBars
    // setting in capacitor.config.json.
    // Fast swipes near the edges (Wake Up, Flip It, Roll It) must not pull down
    // Notification Centre or go home on the first swipe.
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { [.top, .bottom] }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
}

/// Minimal Game Center bridge for the web game.
/// JS: Capacitor.Plugins.GameCenter.authenticate() / submitScore({leaderboardId, score}) /
///     showLeaderboard({leaderboardId}) / reportAchievement({achievementId})
@objc(GameCenterPlugin)
public class GameCenterPlugin: CAPPlugin, CAPBridgedPlugin, GKGameCenterControllerDelegate {
    public let identifier = "GameCenterPlugin"
    public let jsName = "GameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showLeaderboard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportAchievement", returnType: CAPPluginReturnPromise)
    ]

    @objc func authenticate(_ call: CAPPluginCall) {
        GameCenterAuth.shared.whenReady { ok in
            call.resolve(["authenticated": ok, "alias": ok ? GKLocalPlayer.local.alias : ""])
        }
    }

    @objc func submitScore(_ call: CAPPluginCall) {
        guard let id = call.getString("leaderboardId"), let score = call.getInt("score") else {
            call.reject("leaderboardId and score are required"); return
        }
        guard GKLocalPlayer.local.isAuthenticated else {
            call.resolve(["submitted": false]); return
        }
        GKLeaderboard.submitScore(score, context: 0, player: GKLocalPlayer.local, leaderboardIDs: [id]) { error in
            if let error = error { call.resolve(["submitted": false, "error": error.localizedDescription]) }
            else { call.resolve(["submitted": true]) }
        }
    }

    /// Opens Apple's Game Center leaderboard. Uses the system overlay on
    /// iOS 18+ (the old full-screen controller is deprecated in iOS 26 and
    /// can lock up the app), falling back to it on older iOS.
    @objc func showLeaderboard(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.resolve(["shown": false, "reason": "not_signed_in"]); return
        }
        let id = call.getString("leaderboardId")
        DispatchQueue.main.async {
            if #available(iOS 18.0, *) {
                if let id = id {
                    GKAccessPoint.shared.trigger(leaderboardID: id, playerScope: .global, timeScope: .allTime) {}
                } else {
                    GKAccessPoint.shared.trigger(state: .leaderboards) {}
                }
                call.resolve(["shown": true])
                return
            }
            guard let host = self.bridge?.viewController, host.presentedViewController == nil else {
                call.resolve(["shown": false, "reason": "busy"]); return
            }
            let gc: GKGameCenterViewController
            if let id = id {
                gc = GKGameCenterViewController(leaderboardID: id, playerScope: .global, timeScope: .allTime)
            } else {
                gc = GKGameCenterViewController(state: .leaderboards)
            }
            gc.gameCenterDelegate = self
            host.present(gc, animated: true)
            call.resolve(["shown": true])
        }
    }

    /// Marks an achievement as fully earned and shows Apple's banner.
    @objc func reportAchievement(_ call: CAPPluginCall) {
        guard let id = call.getString("achievementId") else {
            call.reject("achievementId is required"); return
        }
        guard GKLocalPlayer.local.isAuthenticated else {
            call.resolve(["reported": false]); return
        }
        let achievement = GKAchievement(identifier: id)
        achievement.percentComplete = 100
        achievement.showsCompletionBanner = true
        GKAchievement.report([achievement]) { error in
            if let error = error { call.resolve(["reported": false, "error": error.localizedDescription]) }
            else { call.resolve(["reported": true]) }
        }
    }

    public func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
        DispatchQueue.main.async { gameCenterViewController.dismiss(animated: true) }
    }
}

/// Owns the single Game Center sign-in for the app.
final class GameCenterAuth {
    static let shared = GameCenterAuth()
    private var started = false
    private var finished = false
    private var waiters: [(Bool) -> Void] = []
    private weak var host: UIViewController?

    func start(from host: UIViewController) {
        self.host = host
        guard !started else { return }
        started = true
        GKLocalPlayer.local.authenticateHandler = { [weak self] viewController, _ in
            guard let self = self else { return }
            if let vc = viewController {
                // Apple's sign-in sheet; shown on top of the game.
                if let h = self.host, h.presentedViewController == nil { h.present(vc, animated: true) }
                return
            }
            self.finished = true
            let ok = GKLocalPlayer.local.isAuthenticated
            let pending = self.waiters
            self.waiters.removeAll()
            pending.forEach { $0(ok) }
        }
    }

    /// Calls back once sign-in has settled (or after 10 seconds at most).
    func whenReady(_ done: @escaping (Bool) -> Void) {
        DispatchQueue.main.async {
            if GKLocalPlayer.local.isAuthenticated || self.finished {
                done(GKLocalPlayer.local.isAuthenticated); return
            }
            var called = false
            let once: (Bool) -> Void = { ok in if !called { called = true; done(ok) } }
            self.waiters.append(once)
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) { once(GKLocalPlayer.local.isAuthenticated) }
        }
    }
}

/// Streams CoreMotion data to the web game for tilt and shake microgames.
/// JS: Capacitor.Plugins.NativeMotion.start() / stop(); addListener('motion', {gx, gy, ax, ay, az})
/// gx/gy are gravity (in g, -1...1); ax/ay/az are user acceleration (in g). No permission prompt is needed.
@objc(MotionPlugin)
public class MotionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MotionPlugin"
    public let jsName = "NativeMotion"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]
    private let manager = CMMotionManager()

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.manager.isDeviceMotionAvailable else {
                call.resolve(["available": false]); return
            }
            if !self.manager.isDeviceMotionActive {
                self.manager.deviceMotionUpdateInterval = 1.0 / 30.0
                self.manager.startDeviceMotionUpdates(to: OperationQueue.main) { [weak self] motion, _ in
                    guard let self = self, let m = motion else { return }
                    self.notifyListeners("motion", data: [
                        "gx": m.gravity.x, "gy": m.gravity.y,
                        "ax": m.userAcceleration.x, "ay": m.userAcceleration.y, "az": m.userAcceleration.z
                    ])
                }
            }
            call.resolve(["available": true])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.manager.isDeviceMotionActive { self.manager.stopDeviceMotionUpdates() }
            call.resolve()
        }
    }
}
