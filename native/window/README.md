# Optional Windows native window

This directory is packaged in the existing `dsh-whale-widget` npm bundle; the
feature defaults to off. No personal profile, credentials, generated session,
machine path, or installed Harness files belong in this directory.

`whale-window.ps1` loads the bundled x64 WebView2 SDK and uses the installed
Evergreen Runtime. See `sdk/NOTICE.md` and the Microsoft license. Windows
PowerShell 5.1 requires the script's UTF-8 BOM. Missing Runtime is a recoverable
failure: the host returns to the embedded widget.

The host passes its session cookie only in the child environment. The child
removes that environment variable before WebView initialization, seeds its cookie
jar, attaches its bridge, and only then navigates. Every HTTP route uses the
original registration/authentication wrapper. Do not reintroduce an unauthenticated
HTML route that signs a host session or writes `Set-Cookie` responses.

The HWND covers the primary working area for the existing widget's layout, but
`WhaleWindowRegion.cs` clips the native window to bounded UI rectangles. Empty
startup and error regions are real empty regions, not `SetWindowRgn(hwnd, NULL)`
(which would remove clipping). Region handles transfer to Windows only after a
successful `SetWindowRgn`; temporary GDI handles must be disposed.

CSS viewport dimensions map to physical client pixels and then to window-relative
coordinates. The region watchdog drops snapshots older than one second and
releases capture on failure. Three consecutive timeouts or invalid snapshots close
the native window and restore the embedded widget. It never expands the region to the full screen during
dragging. Rectangular transparent corners may still receive input. Modal backdrops
are excluded; desktop clicks outside cards remain available. Region updates can
briefly clip animations; pixel-exact alpha masks and multiple monitors are outside
this contribution.

Run these checks from the repository root:

```text
node tools/window-region-test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File tools/window-region-test.ps1
node tools/z-layer-audit.mjs assets/whale-widget.js
node tools/ci-audit.mjs
node tools/ci-audit-selftest.mjs
node tools/check-dead-settings.mjs
```

CI and the manually invoked publication workflow both run DOM and native region
regression checks; publishing depends on the Windows native job. Publication
remains manual, with the existing main-branch and npm-version guards. This change
does not bump the package version or run a release.

Before merging, also exercise the actual DSH window: whale clicks and dragging,
detached menus/dialogs, snap/flip animations, foreground switching, DPI changes,
zoom, renderer stalls, closing and restarting the host. Automated geometry tests
do not cover every user interaction or GPU/runtime combination.
