#!/bin/sh
set -eu

profile="$DSH_HOME/profiles/superagent"
mkdir -p "$DSH_HOME" /home/node/work
created=0
if [ ! -f "$profile/package.json" ]; then
  dsh superagent --from-default-profile web --dump-config >/dev/null
  created=1
fi
if [ ! -e "$profile/node_modules/dsh-superagent" ]; then
  dsh plugin --profile superagent add 'link:/opt/dsh-superagent'
fi
if [ "$created" -eq 1 ] || [ ! -f "$profile/cordis.patch.yml" ]; then
  cat > "$profile/cordis.patch.yml" <<'EOF'
- id: webserver
  config:
    host: 127.0.0.1
    port: 3082
- id: dsh-superagent
  config:
    stateDir: /home/node/.dsh/state/superagent
EOF
fi

socat TCP-LISTEN:3083,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:3082 &
exec dsh --profile superagent --no-open
