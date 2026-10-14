#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $(id -u) = 0 ]] || { echo 'Run as root.' >&2; exit 1; }
exec 9>/run/lock/agents-era-acme.lock
flock -n 9 || exit 0
state=/var/lib/agents-era-acme
webroot=/opt/1panel/apps/openresty/openresty/www/sites/agents-era/acme
target=/opt/1panel/apps/openresty/openresty/conf/conf.d/agents-era-tls
proxy=1Panel-openresty-XOH1
image=certbot/certbot@sha256:f70ad0adbb7e117f0fe42a63c553f28ea451edabc0148757b6efcd9735acaa20
[[ $# = 0 || ( $# = 1 && $1 = --publish-only ) ]] || { echo 'Usage: renew-certificate.sh [--publish-only]' >&2; exit 1; }
if [[ ${1:-} != --publish-only ]]; then
    docker run --rm --network host \
        -v "$state/config:/etc/letsencrypt" \
        -v "$state/work:/var/lib/letsencrypt" \
        -v "$state/log:/var/log/letsencrypt" \
        -v "$webroot:/acme" "$image" renew --quiet
fi
source_dir=$state/config/live/agents-era-ip
openssl x509 -in "$source_dir/fullchain.pem" -noout -checkip 38.207.178.31 >/dev/null
openssl x509 -in "$source_dir/fullchain.pem" -noout -checkend 86400 >/dev/null
version=$(sha256sum "$source_dir/fullchain.pem" | cut -d ' ' -f 1)
install -d -m 700 "$target" "$target/versions" "$target/versions/$version"
if [[ -L "$target/current" ]] && cmp -s "$source_dir/fullchain.pem" "$target/current/fullchain.pem" && cmp -s "$source_dir/privkey.pem" "$target/current/privkey.pem"; then exit 0; fi
install -m 600 "$source_dir/fullchain.pem" "$target/versions/$version/fullchain.pem"
install -m 600 "$source_dir/privkey.pem" "$target/versions/$version/privkey.pem"
previous=$(readlink "$target/current" || true)
ln -s "versions/$version" "$target/current.next"
mv -Tf "$target/current.next" "$target/current"
if ! docker exec "$proxy" nginx -t; then
    if [[ -n "$previous" ]]; then
        ln -s "$previous" "$target/current.rollback"
        mv -Tf "$target/current.rollback" "$target/current"
    else
        rm -- "$target/current"
    fi
    echo 'Proxy validation failed; certificate pointer restored.' >&2
    exit 1
fi
docker exec "$proxy" nginx -s reload
