# iOS Dev Build — HealthKit + Polar H10

## Prerequisites

- macOS with Xcode 15+ installed
- Apple Developer account (free or paid)
- Physical iOS device (HealthKit requires real hardware)
- Node.js 18+ and npm
- EAS CLI: `npm install -g eas-cli`

## 1. Required Native Packages

```bash
npx expo install react-native-health react-native-ble-plx
```

## 2. app.json Config Plugins

Add these plugins to your `app.json` under `expo.plugins`:

```json
{
  "plugins": [
    [
      "react-native-health",
      {
        "isClinicalDataEnabled": false
      }
    ],
    [
      "react-native-ble-plx",
      {
        "isBackgroundEnabled": false,
        "modes": ["peripheral", "central"],
        "bluetoothAlwaysPermission": "This app uses Bluetooth to connect to your Polar H10 heart rate monitor."
      }
    ]
  ]
}
```

## 3. iOS Entitlements

Add to `app.json` under `expo.ios`:

```json
{
  "ios": {
    "supportsTablet": false,
    "bundleIdentifier": "com.bulkcoach.app",
    "infoPlist": {
      "NSHealthShareUsageDescription": "Bulk Coach reads your health data (heart rate, HRV, sleep, workouts, steps) to provide personalized training recommendations.",
      "NSHealthUpdateUsageDescription": "Bulk Coach writes workout data to Apple Health.",
      "NSBluetoothAlwaysUsageDescription": "Bulk Coach connects to your Polar H10 for real-time heart rate and HRV monitoring during workouts.",
      "NSBluetoothPeripheralUsageDescription": "Bulk Coach connects to your Polar H10 heart rate monitor."
    },
    "entitlements": {
      "com.apple.developer.healthkit": true,
      "com.apple.developer.healthkit.access": ["health-records"],
      "com.apple.developer.healthkit.background-delivery": true
    }
  }
}
```

## 4. EAS Configuration

Create `eas.json` in the project root:

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

## 5. Build the Dev Client

```bash
# Login to EAS
eas login

# Build for iOS device
eas build --profile development --platform ios

# OR build locally (requires Xcode)
npx expo run:ios --device
```

## 6. Install and Run

After the EAS build completes:

1. Install the `.ipa` on your device via the link EAS provides
2. Start the dev server: `npx expo start --dev-client`
3. Open the app on your device — it connects to the dev server automatically

## 7. Testing HealthKit

1. Navigate to Vitals tab > "Connect Apple Health"
2. Grant all requested health permissions
3. Tap "Sync last 7 days" or "Sync last 30 days"
4. Verify counts: sleep rows, vitals rows, workouts imported
5. Check data in Dashboard and Report tabs

## 8. Testing Polar H10

1. Wear your Polar H10 chest strap
2. Navigate to Vitals tab > "Connect Polar H10"
3. Tap scan — your H10 should appear in the list
4. Tap connect — wait for "Connected" status
5. Start a workout from the Game Guide screen
6. Watch the 120s baseline capture countdown
7. Log sets — observe CBP drain and phase transitions
8. End session — HRV analysis results display automatically

## Troubleshooting

**HealthKit permissions denied**: Go to iOS Settings > Health > Data Access > Bulk Coach and re-enable permissions.

**Polar H10 not found**: Ensure the strap is wet (conductive contact required). Check that Bluetooth is enabled in iOS Settings. The H10 broadcasts only when worn.

**Build fails with entitlements error**: Ensure your Apple Developer account has HealthKit capability enabled for your App ID. Go to developer.apple.com > Certificates, Identifiers & Profiles > Identifiers > select your app > enable HealthKit.

**Podfile issues**: If using `npx expo run:ios`, the Podfile is auto-generated. If you need manual tweaks:
```ruby
# ios/Podfile — usually no changes needed
# react-native-health and react-native-ble-plx are auto-linked
```
