// A disposable third application for testing macOS application activation.
// It neither reads user data nor automates any other application.
import AppKit
import ApplicationServices

if CommandLine.arguments.contains("--capabilities") {
    print("accessibility=\(AXIsProcessTrusted())")
    exit(0)
}

let application = NSApplication.shared
application.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 80, y: 80, width: 300, height: 140),
                      styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "Codex Activity focus test"
window.makeKeyAndOrderFront(nil)
application.activate(ignoringOtherApps: true)
Timer.scheduledTimer(withTimeInterval: 25, repeats: false) { _ in application.terminate(nil) }
application.run()
