#!/bin/sh
set -eu

python3 - <<'PY'
import os
import pathlib
import tempfile

import yaml

path = pathlib.Path('/opt/data/config.yaml')
if path.exists():
    with path.open(encoding='utf-8') as stream:
        config = yaml.safe_load(stream) or {}
else:
    config = {}
if not isinstance(config, dict):
    config = {}

model = config.setdefault('model', {})
if not isinstance(model, dict):
    model = {}
    config['model'] = model
model_name = os.environ.get('MODEL_NAME', '').strip()
model_base_url = os.environ.get('MODEL_BASE_URL', '').strip()
model_api_key = os.environ.get('MODEL_API_KEY', '').strip()
model_protocol = os.environ.get('MODEL_PROTOCOL', 'chat-completions').strip()
if model_name and model_base_url:
    model.setdefault('provider', os.environ.get('MODEL_PROVIDER_NAME', 'custom').strip() or 'custom')
    model.setdefault('default', model_name)
    model.setdefault('base_url', model_base_url)
    if model_api_key:
        model.setdefault('api_key', model_api_key)
    if model_protocol == 'responses':
        model.setdefault('api_mode', 'codex_responses')
elif 'model' not in config or not model:
    config.pop('model', None)

skills = config.setdefault('skills', {})
if not isinstance(skills, dict):
    skills = {}
    config['skills'] = skills
skills['external_dirs'] = ['/opt/agent-earth/managed-skills/active/agent-earth']

streaming = config.setdefault('streaming', {})
if not isinstance(streaming, dict):
    streaming = {}
    config['streaming'] = streaming
streaming['enabled'] = True

mcp_servers = config.setdefault('mcp_servers', {})
if not isinstance(mcp_servers, dict):
    mcp_servers = {}
    config['mcp_servers'] = mcp_servers
mcp_servers['cesium'] = {'url': 'http://cesium-mcp:9200/mcp'}

path.parent.mkdir(parents=True, exist_ok=True)
with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=path.parent, delete=False) as stream:
    yaml.safe_dump(config, stream, sort_keys=False, allow_unicode=True)
    temporary_path = pathlib.Path(stream.name)
os.replace(temporary_path, path)
PY
