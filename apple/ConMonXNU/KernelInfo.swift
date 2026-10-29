import Foundation
import UIKit

/// Facts read from the running XNU kernel through uname() and sysctl, plus a
/// few from UIKit. Nothing leaves the phone unless you tap "Show in ConMon Lab".
struct Fact: Identifiable {
    let key: String
    let value: String
    var id: String { key }
}

struct KernelInfo {
    var rows: [Fact] = []

    static func sysctlString(_ name: String) -> String? {
        var size = 0
        guard sysctlbyname(name, nil, &size, nil, 0) == 0, size > 0 else { return nil }
        var buf = [CChar](repeating: 0, count: size)
        guard sysctlbyname(name, &buf, &size, nil, 0) == 0 else { return nil }
        return String(cString: buf)
    }

    static func sysctlInt(_ name: String) -> Int64? {
        var value: Int64 = 0
        var size = MemoryLayout<Int64>.size
        guard sysctlbyname(name, &value, &size, nil, 0) == 0 else { return nil }
        return size == 4 ? Int64(Int32(truncatingIfNeeded: value)) : value
    }

    static func bootTime() -> Date? {
        var tv = timeval()
        var size = MemoryLayout<timeval>.size
        guard sysctlbyname("kern.boottime", &tv, &size, nil, 0) == 0 else { return nil }
        return Date(timeIntervalSince1970: TimeInterval(tv.tv_sec))
    }

    @MainActor static func read() -> KernelInfo {
        var info = KernelInfo()
        var u = utsname()
        uname(&u)
        func field<T>(_ v: T) -> String {
            withUnsafeBytes(of: v) { raw in String(cString: raw.bindMemory(to: CChar.self).baseAddress!) }
        }
        func add(_ k: String, _ v: String?) {
            guard let v = v, !v.isEmpty else { return }
            info.rows.append(Fact(key: k, value: v))
        }
        add("Kernel", field(u.sysname))                                  // "Darwin"
        add("Release", field(u.release))                                 // e.g. 25.0.0
        add("Version", field(u.version))                                 // "Darwin Kernel Version ... xnu-..."
        add("Machine", field(u.machine))                                 // e.g. iPhone16,2
        add("OS build", sysctlString("kern.osversion"))
        add("Model", sysctlString("hw.model"))
        add("CPU cores", sysctlInt("hw.ncpu").map { String($0) })
        add("Perf. cores", sysctlInt("hw.perflevel0.physicalcpu").map { String($0) })
        add("Efficiency cores", sysctlInt("hw.perflevel1.physicalcpu").map { String($0) })
        add("Memory", sysctlInt("hw.memsize").map { String(format: "%.1f GB", Double($0) / 1_073_741_824) })
        add("Page size", sysctlInt("hw.pagesize").map { "\($0) bytes" })
        add("Max processes", sysctlInt("kern.maxproc").map { String($0) })
        if let boot = bootTime() {
            let f = DateFormatter(); f.dateStyle = .medium; f.timeStyle = .short
            add("Booted", f.string(from: boot))
        }
        let up = Int(ProcessInfo.processInfo.systemUptime)
        add("Uptime", "\(up / 86400)d \(up % 86400 / 3600)h \(up % 3600 / 60)m")
        add("iOS", "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)")
        let thermal = ["nominal", "fair", "serious", "critical"]
        add("Thermal state", thermal[min(ProcessInfo.processInfo.thermalState.rawValue, 3)])
        UIDevice.current.isBatteryMonitoringEnabled = true
        let level = UIDevice.current.batteryLevel
        if level >= 0 { add("Battery", "\(Int(level * 100))%") }
        add("Low Power Mode", ProcessInfo.processInfo.isLowPowerModeEnabled ? "on" : "off")
        return info
    }

    /// base64url JSON, put after # so it never reaches a web server.
    var fragment: String {
        let dict = Dictionary(rows.map { ($0.key, $0.value) }, uniquingKeysWith: { a, _ in a })
        let order = rows.map { $0.key }
        let data = (try? JSONSerialization.data(withJSONObject: ["order": order, "facts": dict])) ?? Data()
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
