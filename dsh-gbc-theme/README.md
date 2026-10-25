# dsh-gbc-theme

`GIRLS BAND CRY / 空の箱` — a dynamic wallpaper theme for the **DeepSeek Harness** web shell.

This package contains the host entry (`lib/index.js`) and the prebuilt browser bundle (`lib/client.js`). The bundle injects a full-screen Canvas scene behind the shell, makes the frame/conversation transparent, turns the side rails into smoked glass, and adds a small `GBC` chip at the bottom-right for switching LIVE / SKY / NOISE.

## Install

Use the DSH plugin manager (Settings → Plugins / Discover) and choose the local package directory or the tarball `dsh-gbc-theme-1.0.0.tgz`. Enable the bundle; restart DSH if the manager asks for it.

## Controls

- Click the bottom-right `GBC` chip: cycle LIVE / SKY / NOISE.
- `Alt + G`: cycle mode from the keyboard.
- The chip is intentionally low-opacity; hover to bring it up.

## Notes

- No host routes, commands, tools, or disk writes.
- Uninstalling/disabling the bundle removes the injected canvas, styles, and `gbc-theme-on` class.
- The only persisted value is the mode preference in the browser's `localStorage` (`gbc-wallpaper-mode`).
- Fan-made, non-commercial. GIRLS BAND CRY © Toei Animation / agehasprings / Universal Music.
