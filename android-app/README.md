# USOA Export Billing (Android)
Standalone Android wrapper for the existing root kanish.html, bundled at build time. No INTERNET permission or website/database changes. Uses local WebView storage, native print/PDF and Android file picker for JSON import/export. Only the original current-shipment workspace is retained; export backup before replacing a shipment or uninstalling.

## Build
Install JDK 17, Android SDK platform 35 and Gradle 8.10.2. From the repository root: gradle -p android-app :app:assembleDebug
APK: android-app/app/build/outputs/apk/debug/app-debug.apk

CI debug APK is a test build, not permanently release-signed. Before production, use a securely stored release key and test actual devices: airplane mode, data persistence, all 3 document types, mixed packing, all PDF page layouts and QR/VPIN, backup import/export, rotations, and reinstall/upgrade.
