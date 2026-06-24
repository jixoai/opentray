# @opentray/ext-badge-windows-x64

Windows x64 native dynamic library package for `@opentray/ext-badge`.

This package is installed as an optional platform artifact. Source control does not commit the generated dynamic library; CI or local staging places `opentray_ext_badge.dll` into `bin/` before npm publish or smoke testing.

Current maturity: reduced. The runtime reports badge capability truth and rejects unsupported families explicitly instead of pretending full taskbar parity.
