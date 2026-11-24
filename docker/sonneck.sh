#!/bin/sh
# The image's `sonneck` command: the container's entrypoint, and what
# `docker exec <container> sonneck <command>` runs. It runs the real binary
# (/usr/local/lib/sonneck/sonneck) as PUID:PGID (1000:1000 unless set), so
# the server and every admin command write the library as that user.
#
# Started as root (plain `docker run`, Compose, Unraid), it first makes sure
# the library folder exists and belongs to PUID:PGID — Docker creates a
# missing host folder as root, which Sonneck couldn't write to — then drops
# to that user. It hands the folder over (chown -R) only when its owner
# differs (a first start, or PUID/PGID changed), so a big library isn't
# re-chowned on every restart. Started as anyone else (Compose's `user:`,
# rootless Podman), it changes nothing and just runs the binary.
set -eu

bin=/usr/local/lib/sonneck/sonneck

if [ "$(id -u)" != 0 ]; then
	exec "$bin" "$@"
fi

PUID=${PUID:-1000}
PGID=${PGID:-1000}
for pair in "PUID=$PUID" "PGID=$PGID"; do
	case ${pair#*=} in
	'' | *[!0-9]*)
		echo "sonneck: ${pair%%=*} must be a number, got '${pair#*=}'" >&2
		exit 1
		;;
	esac
done
if [ "$PUID" = 0 ] || [ "$PGID" = 0 ]; then
	echo "sonneck: PUID and PGID can't be 0; Sonneck doesn't run as root" >&2
	exit 1
fi

# The library, and a backup folder set somewhere else.
for dir in "${DATA_DIR:-/data}" ${BACKUP_DIR:+"$BACKUP_DIR"}; do
	mkdir -p "$dir"
	if [ "$(stat -c %u:%g "$dir")" != "$PUID:$PGID" ]; then
		echo "sonneck: giving $dir to $PUID:$PGID (a first start, or PUID/PGID changed)" >&2
		chown -R "$PUID:$PGID" "$dir"
	fi
done

# As the non-root image always ran: a home that doesn't exist, so nothing
# (fontconfig's cache, say) tries to write into root's.
export HOME=/nonexistent
exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- "$bin" "$@"
