import AppKit
import Foundation
import UserNotifications

let gameBundleIdentifier = "io.github.arkniem.openhistoria.native"
let serving = CommandLine.arguments.contains("--serve")

_ = signal(SIGPIPE, SIG_IGN)

func say(_ value: [String: Any]) {
    guard serving, JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value), let text = String(data: data, encoding: .utf8) else { return }
    fputs(text + "\n", stdout)
    fflush(stdout)
}

func describe(_ error: Error) -> String {
    let value = error as NSError
    return "\(value.domain) \(value.code): \(value.localizedDescription)"
}

func settingOf(_ status: UNAuthorizationStatus) -> String {
    switch status {
    case .notDetermined: return "Unknown"
    case .denied: return "Disabled"
    default: return "Enabled"
    }
}

func text(_ value: Any?) -> String {
    if let value = value as? String { return value }
    if let value = value as? NSNumber { return value.stringValue }
    return ""
}

func gameURL() -> URL? {
    let candidate = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    if candidate.pathExtension == "app", Bundle(url: candidate)?.bundleIdentifier == gameBundleIdentifier { return candidate }
    return NSWorkspace.shared.urlForApplication(withBundleIdentifier: gameBundleIdentifier)
}

func openByIdentifier() {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
    process.arguments = ["-b", gameBundleIdentifier]
    try? process.run()
}

func bringGameForward() {
    guard let url = gameURL() else {
        openByIdentifier()
        return
    }
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    NSWorkspace.shared.openApplication(at: url, configuration: configuration) { _, error in
        if error != nil { DispatchQueue.main.async { openByIdentifier() } }
    }
}

final class Notifier: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    let center = UNUserNotificationCenter.current()
    var answered = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        if serving {
            say(["ready": true, "bundle": Bundle.main.bundleIdentifier ?? ""])
            Thread.detachNewThread { self.readRequests() }
        } else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
                if !self.answered { NSApp.terminate(nil) }
            }
        }
    }

    func readRequests() {
        while let line = readLine(strippingNewline: true) {
            DispatchQueue.main.async { self.handle(line) }
        }
        DispatchQueue.main.async { self.finish() }
    }

    func finish() {
        center.removeAllDeliveredNotifications()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { NSApp.terminate(nil) }
    }

    func reply(_ seq: Int, _ fields: [String: Any], _ error: String? = nil, unavailable: Bool = false) {
        var value = fields
        value["seq"] = seq
        if let error = error { value["error"] = error }
        if unavailable { value["unavailable"] = true }
        say(value)
    }

    func authorize(_ done: @escaping (String, String?, Bool) -> Void) {
        center.getNotificationSettings { settings in
            let status = settings.authorizationStatus
            if status != .notDetermined {
                DispatchQueue.main.async { done(settingOf(status), nil, false) }
                return
            }
            self.center.requestAuthorization(options: [.alert, .sound]) { granted, error in
                guard let error = error else {
                    DispatchQueue.main.async { done(granted ? "Enabled" : "Disabled", nil, false) }
                    return
                }
                self.center.getNotificationSettings { after in
                    let denied = after.authorizationStatus == .denied
                    DispatchQueue.main.async { done(denied ? "Disabled" : "Unknown", denied ? nil : describe(error), !denied) }
                }
            }
        }
    }

    func post(_ message: [String: Any], _ done: @escaping (String?) -> Void) {
        let content = UNMutableNotificationContent()
        content.title = text(message["title"])
        content.body = text(message["body"])
        content.sound = .default
        content.threadIdentifier = "diplomacy"
        content.userInfo = ["notice": text(message["notice"]), "chatId": text(message["chatId"]), "gameId": text(message["gameId"])]
        let tag = text(message["tag"])
        let request = UNNotificationRequest(identifier: tag.isEmpty ? UUID().uuidString : tag, content: content, trigger: nil)
        center.add(request) { error in
            DispatchQueue.main.async { done(error.map(describe)) }
        }
    }

    func handle(_ line: String) {
        guard let data = line.data(using: .utf8), let message = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        let seq = (message["seq"] as? NSNumber)?.intValue ?? 0
        switch text(message["op"]) {
        case "register", "setting":
            authorize { setting, error, unavailable in
                self.reply(seq, ["setting": setting], error, unavailable: unavailable)
            }
        case "show":
            authorize { setting, error, unavailable in
                guard setting == "Enabled" else {
                    self.reply(seq, ["shown": false, "setting": setting], error, unavailable: unavailable)
                    return
                }
                self.post(message) { failure in
                    self.reply(seq, ["shown": failure == nil, "setting": "Enabled"], failure)
                }
            }
        case "clear":
            center.removeAllDeliveredNotifications()
            reply(seq, ["cleared": true])
        default:
            reply(seq, [:], "Unknown request")
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if #available(macOS 11.0, *) {
            completionHandler([.banner, .list, .sound])
        } else {
            completionHandler([.alert, .sound])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        let action = response.actionIdentifier
        DispatchQueue.main.async {
            self.answered = true
            if action != UNNotificationDismissActionIdentifier {
                say(["event": "activated", "notice": Int(text(info["notice"])) ?? 0, "chatId": text(info["chatId"]), "gameId": text(info["gameId"])])
                bringGameForward()
            }
            completionHandler()
            if !serving {
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) { NSApp.terminate(nil) }
            }
        }
    }
}

if CommandLine.arguments.contains("--locate") {
    let found = gameURL()
    let line = ["game": found?.path ?? "", "identifier": found.flatMap { Bundle(url: $0)?.bundleIdentifier } ?? "", "notifier": Bundle.main.bundleIdentifier ?? ""]
    if let data = try? JSONSerialization.data(withJSONObject: line), let text = String(data: data, encoding: .utf8) { print(text) }
    exit(found == nil ? 1 : 0)
}

let notifier = Notifier()
UNUserNotificationCenter.current().delegate = notifier
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
application.delegate = notifier
application.run()
