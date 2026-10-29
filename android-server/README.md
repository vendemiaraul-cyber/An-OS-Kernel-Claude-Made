# Android server for ConMon Lab

Android can't run inside the browser emulator, so this runs **real Android 12**
(Redroid) on a small ARM server you own, and streams it to Kernel Lab.

1. Make an Ubuntu 22.04 or 24.04 **ARM64** VM:
   - Oracle Cloud Free Tier: Compute → Instance → shape *VM.Standard.A1.Flex*
     (2 OCPU / 12 GB is plenty), image *Canonical Ubuntu*.
   - or AWS: a *t4g.small* (or bigger) with Ubuntu ARM64.
   Open TCP ports **80** and **443** in the cloud firewall (Oracle: VCN →
   Security List → Ingress rules; AWS: Security group).
2. SSH in and paste:
   ```
   curl -fsSL https://raw.githubusercontent.com/vendemiaraul-cyber/An-OS-Kernel-Claude-Made/main/android-server/setup.sh | sudo bash
   ```
   Choose your own password with `PASSWORD=... ` before `bash` (the
   `sudo PASSWORD=... bash` form), otherwise one is generated and printed.
3. It prints an `https://…sslip.io` address, a user and the password. In
   ConMon Lab, open **Kernel Lab → Android (your server)**, paste the address
   and tap Open. Sign in, tap the device and pick a player.

Only the password-protected HTTPS page is reachable from the internet; adb and
Android itself stay inside Docker. Delete `/opt/conmon-android/data` to reset
Android. Redroid is Apache-2.0, ws-scrcpy MIT, Caddy Apache-2.0.
