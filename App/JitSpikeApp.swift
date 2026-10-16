import SwiftUI
import WebKit

@main
struct JitSpikeApp: App {
    @State private var host = Host()
    var body: some Scene {
        WindowGroup {
            WebRep(host: host).ignoresSafeArea().onAppear { host.start() }
        }
    }
}

struct WebRep: UIViewRepresentable {
    let host: Host
    func makeUIView(context: Context) -> WKWebView { host.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

func spikeLog(_ s: String) {
    print("SPIKE|" + s)
    fflush(stdout)
    let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("spike-log.txt")
    if let d = (s + "\n").data(using: .utf8) {
        if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(d); try? h.close() } else { try? d.write(to: url) }
    }
}

final class Host: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    let webView: WKWebView
    var server: LocalServer?

    override init() {
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(SchemeHandler(), forURLScheme: "spike")
        let uc = WKUserContentController()
        cfg.userContentController = uc
        webView = WKWebView(frame: .zero, configuration: cfg)
        super.init()
        uc.add(self, name: "report")
        webView.navigationDelegate = self
        webView.isInspectable = true
    }

    func start() {
        UIApplication.shared.isIdleTimerDisabled = true
        let d = UserDefaults.standard
        let origin = d.string(forKey: "origin") ?? "scheme"
        let phase = d.string(forKey: "phase") ?? "main"
        var info = utsname(); uname(&info)
        let model = withUnsafePointer(to: &info.machine) { $0.withMemoryRebound(to: CChar.self, capacity: 64) { String(cString: $0) } }
        spikeLog("{\"type\":\"launch\",\"origin\":\"\(origin)\",\"phase\":\"\(phase)\",\"ios\":\"\(UIDevice.current.systemVersion)\",\"model\":\"\(model)\"}")
        if d.bool(forKey: "native") {
            DispatchQueue.global(qos: .userInteractive).async {
                let iters: UInt32 = 20_000_000
                let r = native_bench(iters)
                let instr = Double(iters) * 22
                spikeLog("{\"type\":\"native\",\"interp_mips\":\(Int(instr / r.interp_ms / 1000)),\"aot_mips\":\(Int(instr / r.aot_ms / 1000)),\"interp_ms\":\(r.interp_ms),\"aot_ms\":\(r.aot_ms),\"chk_small_interp\":\(r.small_interp),\"chk_small_aot\":\(r.small_aot),\"chk_big_equal\":\(r.chk_interp == r.chk_aot)}")
                DispatchQueue.main.async { self.load(origin: origin, phase: phase) }
            }
        } else {
            load(origin: origin, phase: phase)
        }
    }

    func load(origin: String, phase: String) {
        if origin == "http" {
            let root = Bundle.main.url(forResource: "Web", withExtension: nil)!
            server = LocalServer(root: root)
            server!.start { port in
                DispatchQueue.main.async {
                    self.webView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/index.html?phase=\(phase)")!))
                }
            }
        } else {
            webView.load(URLRequest(url: URL(string: "spike://app/index.html?phase=\(phase)")!))
        }
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let s = m.body as? String else { return }
        spikeLog(s)
        if s.contains("\"type\":\"done\"") { DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { exit(0) } }
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        spikeLog("{\"type\":\"webcontent_terminated\"}")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { exit(2) }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { spikeLog("{\"type\":\"nav_fail\",\"e\":\"\(error)\"}") }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { spikeLog("{\"type\":\"nav_fail_prov\",\"e\":\"\(error)\"}") }
}
