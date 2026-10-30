import SwiftUI

struct ContentView: View {
    @State private var info = KernelInfo.read()
    @AppStorage("siteURL") private var siteURL = "https://vendemiaraul-cyber.github.io/An-OS-Kernel-Claude-Made"
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            List {
                Section("XNU kernel on this iPhone") {
                    ForEach(info.rows) { row in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(row.key).font(.caption).foregroundStyle(.secondary)
                            Text(row.value).font(.system(.body, design: .monospaced)).textSelection(.enabled)
                        }
                    }
                }
                Section("ConMon Lab") {
                    TextField("Your ConMon Lab site", text: $siteURL)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Button("Show in ConMon Lab") {
                        let base = siteURL.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                        if let url = URL(string: base + "/kernel/#xnu=" + info.fragment) { openURL(url) }
                    }
                    Text("Opens Kernel Lab; type apple in ConMon to see these facts.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("ConMon XNU")
            .toolbar { Button("Refresh") { info = KernelInfo.read() } }
        }
        .preferredColorScheme(.dark)
    }
}
