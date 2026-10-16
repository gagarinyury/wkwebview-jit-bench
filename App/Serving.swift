import Foundation
import WebKit
import Network

let blob16 = Data(count: 16 << 20)
func mime(_ p: String) -> String {
    if p.hasSuffix(".html") { return "text/html; charset=utf-8" }
    if p.hasSuffix(".js") { return "text/javascript; charset=utf-8" }
    if p.hasSuffix(".wasm") { return "application/wasm" }
    return "application/octet-stream"
}
func payload(root: URL, path: String) -> (Data, String)? {
    if path == "/echo" { return (Data("ok".utf8), "text/plain") }
    if path == "/blob" { return (blob16, "application/octet-stream") }
    let rel = path == "/" ? "index.html" : String(path.dropFirst())
    guard let d = try? Data(contentsOf: root.appendingPathComponent(rel)) else { return nil }
    return (d, mime(rel))
}
let isoHeaders = ["Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "no-store"]

final class SchemeHandler: NSObject, WKURLSchemeHandler {
    let root = Bundle.main.url(forResource: "Web", withExtension: nil)!
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let url = task.request.url!
        guard let (data, type) = payload(root: root, path: url.path) else {
            task.didReceive(HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!)
            task.didFinish(); return
        }
        var h = isoHeaders; h["Content-Type"] = type; h["Content-Length"] = "\(data.count)"
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: h)!)
        task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class LocalServer {
    let root: URL
    var listener: NWListener?
    init(root: URL) { self.root = root }

    func start(ready: @escaping (UInt16) -> Void) {
        let params = NWParameters.tcp
        params.requiredInterfaceType = .loopback
        listener = try! NWListener(using: params)
        listener!.stateUpdateHandler = { [weak self] st in
            if case .ready = st, let p = self?.listener?.port?.rawValue { ready(p) }
            if case .failed(let e) = st { spikeLog("{\"type\":\"server_failed\",\"e\":\"\(e)\"}") }
        }
        listener!.newConnectionHandler = { [weak self] c in c.start(queue: .global()); self?.serve(c) }
        listener!.start(queue: .global())
    }

    func serve(_ c: NWConnection) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, done, err in
            guard let self = self, let data = data, err == nil, let req = String(data: data, encoding: .utf8) else { c.cancel(); return }
            let line = req.split(separator: "\r\n").first.map(String.init) ?? ""
            let parts = line.split(separator: " ")
            let path = parts.count > 1 ? String(parts[1].split(separator: "?", omittingEmptySubsequences: false)[0]) : "/"
            var head: String, body = Data()
            if let (d, type) = payload(root: self.root, path: path) {
                head = "HTTP/1.1 200 OK\r\nContent-Type: \(type)\r\nContent-Length: \(d.count)\r\n"
                body = d
            } else {
                head = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n"
            }
            for (k, v) in isoHeaders { head += "\(k): \(v)\r\n" }
            head += "Connection: keep-alive\r\n\r\n"
            var out = Data(head.utf8); out.append(body)
            c.send(content: out, completion: .contentProcessed { e in
                if e != nil || done { c.cancel() } else { self.serve(c) }
            })
        }
    }
}
