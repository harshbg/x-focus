# X Focus

X (x.com) for one phone, made deliberately less fun:

- everything in greyscale, on a true black background
- no video, no ads (each is replaced by a small dotted "hidden" box)
- a daily time limit shown as a large countdown at the top, coloured blue, yellow and red by thirds
- a full-screen check-in every 5 minutes that holds for one minute
- a small daily allowance for seeing a post in colour: hold a finger on its picture
- Grok and Premium upsells are hidden

## How it is put together

`x-focus.user.js` is the whole product. It runs inside x.com and draws the timer, the check-ins and the settings.

`android/` is a thin Android app: one screen showing x.com in the system web view, which injects that script into every page. It also blocks video downloads and keeps the timer state outside the page.

The same script works as a userscript in Firefox for Android (Violentmonkey) and should work in Safari on iOS (Userscripts app).

## Updates

The app downloads `x-focus.user.js` from this repository's `main` branch (see `android/update-url.txt`) once a day, and switches to it the next time it comes to the front. "Check for updates" in the settings screen fetches it immediately. So changing the script here changes the app, with nothing to reinstall. Bump `@version` and `VERSION` in the script with each change; the version shows at the bottom of the settings screen.

Anyone who can push to this repository controls what runs inside the signed-in X session. Keep write access to yourself.

Only changes under `android/` need a new APK.

## Building the APK

No Gradle. On Ubuntu:

```bash
sudo apt install aapt apksigner zipalign dalvik-exchange android-sdk-platform-23 default-jdk
```

```bash
android/build.sh
```

The build signs with `android/signing.jks`, which is not in this repository. Keep your copy: an APK signed with a different key will not install over the existing app.

## Tests

`test/` drives the script against a mock page shaped like X's mobile layout, in headless Chromium with Playwright.

```bash
node test/test.js
```

```bash
node test/test-app.js
```

The script has not been tested automatically against the real x.com, whose markup changes; selectors that stop matching fail quietly (nothing is hidden) rather than breaking the page.
