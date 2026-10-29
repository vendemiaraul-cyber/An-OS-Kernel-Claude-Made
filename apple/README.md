# ConMon XNU (iPhone app)

A tiny SwiftUI app that reads facts from the iPhone's own kernel (Apple's
XNU) with `uname()` and `sysctl`: kernel version string, Darwin release, chip
and model, CPU cores, memory, boot time, uptime, plus battery and thermal
state. **Show in ConMon Lab** opens your Kernel Lab with them, and the `apple`
command in ConMon prints them. Nothing is sent anywhere else: the data travels
after `#` in the link, which browsers never send to the web server.

## Build without a Mac

1. On GitHub, open this repo → **Actions** → **iOS app (ConMon XNU)** →
   **Run workflow**. A free macOS build server builds it (about 5 minutes).
2. Download the **ConMonXNU-unsigned** artifact; inside is `ConMonXNU.ipa`.
3. On your Windows PC, install **Sideloadly**, plug in the iPhone, drop the
   `.ipa` in and sign in with your Apple ID. It signs and installs the app.
4. On the iPhone: Settings → General → VPN & Device Management → trust your
   Apple ID; Settings → Privacy & Security → Developer Mode on (iOS 16+).

Free Apple IDs sign apps for 7 days; re-install with Sideloadly after that.

## Build with a Mac

`brew install xcodegen && cd apple && xcodegen`, open `ConMonXNU.xcodeproj`,
pick your team under Signing and run it on the iPhone.
