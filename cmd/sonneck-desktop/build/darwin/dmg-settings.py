# dmgbuild settings for the macOS .dmg: a window with Sonneck on the left,
# an Applications shortcut on the right and dmg-background.png behind them,
# for the usual drag-to-install. native-build.yml runs it from
# cmd/sonneck-desktop:
#   dmgbuild -s build/darwin/dmg-settings.py -D app=build/bin/Sonneck.app \
#     Sonneck build/bin/Sonneck.dmg
# dmgbuild writes the window's layout straight into the image's .DS_Store,
# with no Finder scripting, so it runs on a CI machine with no screen.
import os.path

application = defines.get("app", "build/bin/Sonneck.app")  # noqa: F821
appname = os.path.basename(application)

format = "UDZO"
files = [application]
symlinks = {"Applications": "/Applications"}
hide_extensions = [appname]

# Relative to cmd/sonneck-desktop (dmgbuild runs this file without a
# __file__ to anchor on). dmg-background@2x.png beside it is picked up
# automatically for Retina.
background = defines.get("background", "build/darwin/dmg-background.png")  # noqa: F821
# Window size is the whole window, bars included. Finder shows its tab,
# path and status bars whenever the Mac's own View-menu settings have them
# on, whatever this file asks (they take about 110pt), so the height leaves
# room for the full 400pt design even then; the background runs 500pt tall
# in plain paper for a Mac without them.
window_rect = ((200, 120), (600, 510))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False

# Icon centers, matching the arrow and caption drawn in dmg-background.svg.
icon_size = 128
text_size = 13
icon_locations = {
    appname: (150, 175),
    "Applications": (450, 175),
}
