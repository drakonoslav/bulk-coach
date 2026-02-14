# iOS Dev Build — Step-by-Step Runbook

This guide gets **Bulk Coach** running on your iPhone as a native dev client
with HealthKit (and Polar BLE) support.

---

## Prerequisites

| Requirement | How to check |
|---|---|
| macOS with **Xcode 15+** | `xcodebuild -version` |
| Apple Developer account (free works for personal device) | [developer.apple.com](https://developer.apple.com) |
| Physical iPhone (HealthKit needs real hardware) | -- |
| Node.js 18+ | `node -v` |
| EAS CLI | `npx eas-cli --version` (install below if missing) |

---

## Step 1 — Install EAS CLI (one-time)

```bash
npm install -g eas-cli
```

## Step 2 — Log in to your Expo account

```bash
eas login
```

Enter your Expo username and password when prompted.
If you don't have an Expo account, create one at https://expo.dev/signup.

## Step 3 — Create `eas.json` (if it doesn't exist)

Create a file called `eas.json` in the **project root** with this exact content:

```json
{
  "cli": {
    "version": ">= 12.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": {
        "simulator": false
      }
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {}
  }
}
```

## Step 4 — Register your iPhone for internal distribution

```bash
eas device:create
```

This opens a webpage with a QR code. **Scan it with your iPhone camera.**
Follow the prompts to install the provisioning profile on your device.

> Your device is now registered for internal distribution builds.

## Step 5 — Build the dev client

```bash
eas build --profile development --platform ios
```

What happens:
1. EAS packages your project and uploads it
2. A cloud build server compiles the native iOS app (~10-15 min)
3. You get a link when it's done

> **First build?** EAS may ask you to choose/create an Apple App ID and
> provisioning profile. Accept the defaults — EAS handles code signing for you.
>
> If asked about "Bundle Identifier", use `com.bulkcoach.app`.

## Step 6 — Install the build on your iPhone

When the build finishes, EAS prints:

```
Build finished. Install it on your device:
https://expo.dev/accounts/YOUR_ACCOUNT/projects/bulk-coach/builds/BUILD_ID
```

**Option A — QR code (easiest):**
1. Open that URL on your Mac
2. Scan the QR code with your iPhone camera
3. Tap the banner to install

**Option B — direct link:**
1. Open the EAS link **on your iPhone** in Safari
2. Tap "Install"
3. The Bulk Coach dev client app appears on your home screen

> First install: iOS may say "Untrusted Developer." Go to
> **Settings > General > VPN & Device Management** and trust your developer certificate.

## Step 7 — Start the dev server

Back on your computer (in the project directory):

```bash
npx expo start --dev-client
```

This starts a local dev server. You'll see a QR code in the terminal.

## Step 8 — Connect your iPhone

1. **Open the Bulk Coach app** on your iPhone (not Expo Go — the one you just installed)
2. It automatically finds and connects to your dev server on the same Wi-Fi network
3. The app loads with full native module support

> **Troubleshooting connection:** Make sure your Mac and iPhone are on the same
> Wi-Fi network. If it doesn't auto-connect, type the dev server URL shown in
> the terminal into the app's URL bar.

## Step 9 — Verify HealthKit

1. Open the app on your iPhone
2. Navigate to **Vitals** tab
3. Tap **"Connect Apple Health"**
4. Check the debug panel at the top:
   - **Runtime** should say `Dev Client`
   - **HealthKit module loaded** should say `yes`
5. The status badge should show **"Ready"** (not "Not Available")
6. Tap **"Sync last 7 days"** — iOS will prompt you to allow HealthKit access
7. Grant all requested permissions
8. Watch the sync counters update

---

## Rebuilding after code changes

**Most code changes** (TypeScript, screens, styles) are picked up automatically
by the dev server — no rebuild needed.

**You need to rebuild** (`eas build --profile development --platform ios`) only when:
- You add or update a native package (e.g., `react-native-ble-plx`)
- You change `app.json` plugins or entitlements
- You change `eas.json` build settings

---

## Quick Reference

| Task | Command |
|---|---|
| Install EAS CLI | `npm install -g eas-cli` |
| Log in | `eas login` |
| Register device | `eas device:create` |
| Build dev client | `eas build --profile development --platform ios` |
| Start dev server | `npx expo start --dev-client` |
| Check build status | `eas build:list` |

---

## FAQ

**Q: Can I use Expo Go instead?**
No. HealthKit requires the `react-native-health` native module, which is not
included in Expo Go. The dev client build bundles this module into the app.

**Q: Do I need a paid Apple Developer account?**
A free account works for installing on your own device. A paid account ($99/yr)
is needed to distribute to other people or publish to the App Store.

**Q: The debug panel shows "Dev Client" but "HealthKit module loaded: no"**
The native module didn't link correctly. Try:
1. Make sure `react-native-health` is in `package.json` dependencies
2. Verify the config plugin is in `app.json` → `plugins` array:
   ```json
   ["react-native-health", { "isClinicalDataEnabled": false }]
   ```
3. Rebuild: `eas build --profile development --platform ios`
4. Reinstall the new build on your device

**Q: Bundle identifier mismatch**
If the build fails with a bundle ID mismatch, make sure `app.json` → `expo.ios.bundleIdentifier`
matches what's registered in your Apple Developer account. The current value is `com.bulkcoach.app`.
If you previously used a different ID, either:
- Update `app.json` to match the old one, OR
- Create a new App ID in Apple Developer portal matching `com.bulkcoach.app`

**Q: Provisioning profile issues**
Run `eas device:create` again to re-register your device. Then rebuild.
If issues persist, try `eas credentials` to manage your provisioning profiles.

**Q: How long does the build take?**
First build: ~10-15 minutes. Subsequent builds are faster with EAS caching.

**Q: The build failed with "HealthKit entitlement" error?**
Make sure your Apple Developer account has HealthKit capability enabled.
Go to developer.apple.com > Certificates, Identifiers & Profiles > Identifiers >
select your App ID > enable HealthKit.
