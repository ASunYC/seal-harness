#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ACTION="${1:-}"
INSTANCE_ID="${2:-}"
ROOT="/opt/stratex/autonomous/${INSTANCE_ID}"
HOST_ROOT="/opt/stratex/autonomous"
case "${ACTION}" in validate|preflight|deploy|recover|status|start|stop|restart|remove) ;; *) exit 2;; esac
[[ "${INSTANCE_ID}" =~ ^auto-[a-f0-9]{24}$ ]] || exit 2
mkdir -p "${ROOT}"
LOCK="${ROOT}/operation.lock"
exec 9>"${LOCK}"
flock -w 900 9 || { printf '%s\n' '{"v":1,"stage":"busy","state":"failed","message":"等待该实例已有操作完成超时"}'; exit 3; }
if [[ "${ACTION}" != validate && "${ACTION}" != status ]]; then
  exec 8>"${HOST_ROOT}/host-operation.lock"
  flock -w 900 8 || {
    printf '%s\n' '{"v":1,"stage":"busy","state":"failed","message":"固定主机当前正在执行其他实例操作，请稍后重试"}'
    exit 3
  }
fi

event(){ printf '{"v":1,"stage":"%s","state":"%s","message":"%s"}\n' "$1" "$2" "$3"; }
image_stage(){
  case "$1" in
    RUNTIME_IMAGE) printf '%s' 'image-runtime';;
    CHAT_IMAGE) printf '%s' 'image-chat';;
    MAP_IMAGE) printf '%s' 'image-map';;
    KNOWLEDGE_IMAGE) printf '%s' 'image-knowledge';;
    MODEL_SERVICE_IMAGE) printf '%s' 'image-model';;
    DATABASE_IMAGE) printf '%s' 'image-database';;
  esac
}
image_label(){
  case "$1" in
    RUNTIME_IMAGE) printf '%s' '智能体运行服务';;
    CHAT_IMAGE) printf '%s' '智能体聊天界面';;
    MAP_IMAGE) printf '%s' '地图服务';;
    KNOWLEDGE_IMAGE) printf '%s' '资料服务';;
    MODEL_SERVICE_IMAGE) printf '%s' '模型服务';;
    DATABASE_IMAGE) printf '%s' '数据库';;
  esac
}
failure_message(){
  case "${LAST_STAGE}" in
    environment) printf '%s' "容器运行环境准备失败";;
    registry) printf '%s' "运行服务下载凭据验证失败";;
    images) printf '%s' "运行服务获取失败，请检查镜像地址和网络";;
    image-runtime) printf '%s' "智能体运行服务下载失败";;
    image-chat) printf '%s' "智能体聊天界面下载失败";;
    image-map) printf '%s' "地图服务下载失败";;
    image-knowledge) printf '%s' "资料服务下载失败";;
    image-model) printf '%s' "模型服务下载失败";;
    image-database) printf '%s' "数据库下载失败";;
    configuration-addresses) printf '%s' "管理页面地址适配失败，请确认运行服务版本与发布组件一致";;
    configuration) printf '%s' "实例配置准备失败";;
    services|health) service_failure_message;;
    data) printf '%s' "实例数据删除失败";;
    network) printf '%s' "实例容器网络与固定主机管理网络冲突，已停止发布以避免影响远程连接";;
    *) printf '%s' "固定主机操作未完成，请检查服务器环境后重试";;
  esac
}
LAST_STAGE=initialization
trap 'event "${LAST_STAGE}" failed "$(failure_message)"' ERR
need(){ command -v "$1" >/dev/null 2>&1; }
decode(){ printf '%s' "$1" | base64 -d; }
ENV_FILE="${ROOT}/secrets.env"

ipv4_to_int(){
  local address="$1" a b c d
  IFS=. read -r a b c d <<<"${address}"
  [[ "${a:-}" =~ ^[0-9]+$ && "${b:-}" =~ ^[0-9]+$ && "${c:-}" =~ ^[0-9]+$ && "${d:-}" =~ ^[0-9]+$ ]] || return 1
  ((a <= 255 && b <= 255 && c <= 255 && d <= 255)) || return 1
  printf '%u' "$(( (10#${a} << 24) | (10#${b} << 16) | (10#${c} << 8) | 10#${d} ))"
}

cidr_bounds(){
  local cidr="${1:-}" address prefix ip mask
  [[ "${cidr}" == */* ]] || return 1
  address="${cidr%/*}"; prefix="${cidr#*/}"
  [[ "${prefix}" =~ ^[0-9]+$ ]] || return 1
  ((prefix >= 0 && prefix <= 32)) || return 1
  ip="$(ipv4_to_int "${address}")" || return 1
  if ((prefix == 0)); then mask=0; else mask=$(( (0xffffffff << (32 - prefix)) & 0xffffffff )); fi
  printf '%u %u\n' "$((ip & mask))" "$(( (ip & mask) | (0xffffffff ^ mask) ))"
}

cidr_overlaps(){
  local left right left_start left_end right_start right_end
  read -r left_start left_end < <(cidr_bounds "${1}") || return 1
  read -r right_start right_end < <(cidr_bounds "${2}") || return 1
  ((left_start <= right_end && right_start <= left_end))
}

management_peer_ip(){
  local value="${STRATEX_MANAGEMENT_PEER_IP:-}"
  if [[ -z "${value}" && -n "${SSH_CONNECTION:-}" ]]; then value="${SSH_CONNECTION%% *}"; fi
  if [[ "${value}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then printf '%s' "${value}"; fi
  return 0
}

route_to_management_peer_uses_container_network(){
  local peer="$1 route"
  [[ -n "${peer}" ]] || return 1
  route="$(ip -4 route get "${peer}" 2>/dev/null || true)"
  [[ "${route}" == *" dev br-"* || "${route}" == *" dev docker"* ]]
}

network_subnet_conflicts(){
  local subnet="$1" skip_route="${2:-}" peer route_prefix
  peer="$(management_peer_ip)"
  if [[ -n "${peer}" ]] && cidr_overlaps "${subnet}" "${peer}/32"; then
    printf '%s' "管理连接地址 ${peer} 落在实例容器网络 ${subnet} 内"
    return 0
  fi
  while read -r route_prefix _; do
    [[ "${route_prefix}" == */* ]] || continue
    [[ "${route_prefix}" == "${skip_route}" ]] && continue
    if cidr_overlaps "${subnet}" "${route_prefix}"; then
      printf '%s' "实例容器网络 ${subnet} 与主机现有路由 ${route_prefix} 重叠"
      return 0
    fi
  done < <(ip -4 route show 2>/dev/null || true)
  return 1
}

network_subnet_available(){
  local subnet="$1"
  network_subnet_conflicts "${subnet}" >/dev/null && return 1
  return 0
}

choose_network_subnet(){
  local candidate reason
  # Prefer small /24 bridges in a Docker-only private range. Never use the
  # broad 192.168.0.0/16 pool where workstation/VPN management networks live.
  for candidate in \
    172.31.240.0/24 172.31.241.0/24 172.31.242.0/24 172.31.243.0/24 \
    172.31.244.0/24 172.31.245.0/24 172.31.246.0/24 172.31.247.0/24 \
    172.30.240.0/24 172.30.241.0/24 172.30.242.0/24 172.30.243.0/24 \
    10.254.240.0/24 10.254.241.0/24 10.254.242.0/24 10.254.243.0/24; do
    if network_subnet_available "${candidate}"; then
      printf '%s' "${candidate}"
      return 0
    fi
  done
  return 1
}

set_env_value(){
  local key="$1" value="$2" temporary
  temporary="$(mktemp "${ROOT}/.env.XXXXXX")"
  if [[ -f "${ENV_FILE}" ]]; then grep -Ev "^${key}=" "${ENV_FILE}" >"${temporary}" || true; fi
  printf '%s=%s\n' "${key}" "${value}" >>"${temporary}"
  chmod 600 "${temporary}"
  mv "${temporary}" "${ENV_FILE}"
}

existing_network_subnet(){
  local network="stratex-${INSTANCE_ID}_runtime"
  docker network inspect "${network}" --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}' 2>/dev/null | head -n 1
}

prepare_network_subnet(){
  local configured existing selected conflict peer
  LAST_STAGE=network
  event network running "正在检查实例容器网络与固定主机管理路由"
  configured=""
  if [[ -f "${ENV_FILE}" ]]; then configured="$(sed -n 's/^NETWORK_SUBNET=//p' "${ENV_FILE}" | tail -n 1)"; fi
  existing="$(existing_network_subnet || true)"
  selected="${configured:-${existing:-}}"
  if [[ -z "${selected}" ]]; then
    selected="$(choose_network_subnet || true)"
    [[ -n "${selected}" ]] || { event network failed "没有找到不影响现有网络的可用实例容器网段"; return 1; }
  fi
  if ! cidr_bounds "${selected}" >/dev/null; then
    event network failed "实例容器网段配置无效"
    return 1
  fi
  conflict="$(network_subnet_conflicts "${selected}" "${selected}" || true)"
  if [[ -n "${conflict}" ]]; then
    event network failed "${conflict}"
    return 1
  fi
  peer="$(management_peer_ip)"
  if [[ -n "${peer}" ]] && route_to_management_peer_uses_container_network "${peer}"; then
    event network failed "管理连接 ${peer} 的回程路由已指向 Docker 网桥，已停止发布"
    return 1
  fi
  NETWORK_SUBNET="${selected}"
  SELECTED_NETWORK_SUBNET="${selected}"
  if [[ -f "${ENV_FILE}" && -z "${configured}" ]]; then set_env_value NETWORK_SUBNET "${selected}"; fi
  event network succeeded "实例容器网络检查通过（${selected}，未覆盖现有管理路由）"
}

declare -A INPUT=()
LAST_STAGE=input.decode
while IFS= read -r line; do
  key="${line%%=*}"
  value="${line#*=}"
  case "${key}" in
    RUNTIME_PORT|MAP_PORT|PUBLIC_HOST|MODEL_NAME|MODEL_BASE_URL|MODEL_API_KEY|MODEL_PROTOCOL|REGISTRY_USER|REGISTRY_PASSWORD|RUNTIME_IMAGE|CHAT_IMAGE|MAP_IMAGE|KNOWLEDGE_IMAGE|MODEL_SERVICE_IMAGE|DATABASE_IMAGE) INPUT["${key}"]="$(decode "${value}")";;
    '') ;;
    *) event input failed "部署参数无效"; exit 4;;
  esac
done
LAST_STAGE=input.validate
required_fields=(RUNTIME_PORT)
if [[ "${ACTION}" == preflight || "${ACTION}" == deploy || "${ACTION}" == recover ]]; then
  required_fields+=(MAP_PORT)
fi
if [[ "${ACTION}" == deploy || "${ACTION}" == recover ]]; then
  required_fields+=(PUBLIC_HOST RUNTIME_IMAGE CHAT_IMAGE MAP_IMAGE KNOWLEDGE_IMAGE MODEL_SERVICE_IMAGE DATABASE_IMAGE)
fi
for required in "${required_fields[@]}"; do
  [[ -n "${INPUT[$required]:-}" ]] || { event input failed "部署参数不完整"; exit 4; }
done
[[ "${INPUT[RUNTIME_PORT]}" =~ ^[0-9]+$ && ${#INPUT[RUNTIME_PORT]} -le 5 ]] || { event input failed "实例端口无效"; exit 4; }
runtime_port=$((10#${INPUT[RUNTIME_PORT]}))
((runtime_port >= 1 && runtime_port <= 65531)) || { event input failed "实例端口无效"; exit 4; }
INPUT[RUNTIME_PORT]="${runtime_port}"
if [[ "${ACTION}" == deploy || "${ACTION}" == recover ]]; then
  [[ "${INPUT[PUBLIC_HOST]}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || { event input failed "固定主机地址无效"; exit 4; }
fi
if [[ "${ACTION}" == preflight || "${ACTION}" == deploy || "${ACTION}" == recover ]]; then
  [[ "${INPUT[MAP_PORT]}" =~ ^[0-9]+$ && ${#INPUT[MAP_PORT]} -le 5 ]] || { event input failed "实例端口无效"; exit 4; }
  map_port=$((10#${INPUT[MAP_PORT]}))
  ((map_port >= 1 && map_port <= 65535)) || { event input failed "实例端口无效"; exit 4; }
  INPUT[MAP_PORT]="${map_port}"
fi

install_docker(){
  LAST_STAGE=environment
  event environment running "正在准备容器运行环境"
  if need docker && docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 \
    && need curl && need openssl && need ss && need flock && need base64; then
    event environment succeeded "容器运行环境已就绪"
    return
  fi
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -y >&2
      apt-get install -y ca-certificates coreutils curl gnupg openssl iproute2 util-linux >&2
      if need docker && docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        event environment succeeded "容器运行环境已就绪"
        return
      fi
      install -m 0755 -d /etc/apt/keyrings
      curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc >&2
      chmod a+r /etc/apt/keyrings/docker.asc
      . /etc/os-release
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
      apt-get update -y >&2
      apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >&2;;
    rocky|almalinux|rhel|centos)
      dnf -y install dnf-plugins-core coreutils curl openssl iproute util-linux >&2
      if need docker && docker info >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        event environment succeeded "容器运行环境已就绪"
        return
      fi
      dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo >&2
      dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >&2;;
    *) event environment failed "当前 Linux 版本暂不支持自动准备容器环境"; exit 5;;
  esac
  systemctl enable --now docker >&2
  docker info >/dev/null && docker compose version >/dev/null
  event environment succeeded "容器运行环境准备完成"
}

preflight(){
  LAST_STAGE=preflight
  event connect succeeded "已连接固定主机"
  [[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { event system failed "服务器系统或架构暂不支持"; exit 6; }
  event system succeeded "服务器基础环境检查通过"
  install_docker
  prepare_network_subnet
  local p map
  if [[ -f "${ENV_FILE}" ]]; then . "${ENV_FILE}"; fi
  p="${RUNTIME_PORT:-${INPUT[RUNTIME_PORT]:-26106}}"; map="${MAP_PORT:-${INPUT[MAP_PORT]:-19100}}"
  if ! docker ps -a --filter "label=com.docker.compose.project=stratex-${INSTANCE_ID}" --format '{{.ID}}' | grep -q .; then
    for port in "${p}" "$((p+2))" "$((p+3))" "${map}"; do
      if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${port}$"; then event ports failed "端口 ${port} 已被占用，请更换实例端口后重试"; exit 7; fi
    done
  fi
  event preflight succeeded "发布条件检查通过"
}

write_env(){
  ENV_FILE="${ROOT}/secrets.env"
  if [[ -f "${ENV_FILE}" ]]; then
    . "${ENV_FILE}"
    if [[ -z "${NETWORK_SUBNET:-}" && -n "${SELECTED_NETWORK_SUBNET:-}" ]]; then
      set_env_value NETWORK_SUBNET "${SELECTED_NETWORK_SUBNET}"
      . "${ENV_FILE}"
    fi
    migrate_env
    return
  fi
  chmod 700 "${ROOT}"
  touch "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  cat >"${ENV_FILE}" <<EOF
INSTANCE_ID=${INSTANCE_ID}
RUNTIME_PORT=${INPUT[RUNTIME_PORT]}
DASHBOARD_PORT=$((${INPUT[RUNTIME_PORT]}+3))
CHAT_PORT=$((${INPUT[RUNTIME_PORT]}+2))
PUBLIC_HOST=${INPUT[PUBLIC_HOST]}
MAP_PORT=${INPUT[MAP_PORT]}
RUNTIME_IMAGE=${INPUT[RUNTIME_IMAGE]}
CHAT_IMAGE=${INPUT[CHAT_IMAGE]}
MAP_IMAGE=${INPUT[MAP_IMAGE]}
KNOWLEDGE_IMAGE=${INPUT[KNOWLEDGE_IMAGE]}
MODEL_SERVICE_IMAGE=${INPUT[MODEL_SERVICE_IMAGE]}
DATABASE_IMAGE=${INPUT[DATABASE_IMAGE]}
NETWORK_SUBNET=${NETWORK_SUBNET:-${SELECTED_NETWORK_SUBNET:-}}
MODEL_NAME=${INPUT[MODEL_NAME]:-}
MODEL_BASE_URL=${INPUT[MODEL_BASE_URL]:-}
MODEL_API_KEY=${INPUT[MODEL_API_KEY]:-}
MODEL_PROTOCOL=${INPUT[MODEL_PROTOCOL]:-chat-completions}
SERVICE_KEY=$(openssl rand -hex 24)
RUNTIME_TOKEN=$(openssl rand -hex 24)
DATABASE_PASSWORD=$(openssl rand -hex 24)
EOF
  . "${ENV_FILE}"
  migrate_env
}

migrate_env(){
  local auth_registry secret_registry managed_secret_store_key public_host temporary
  auth_registry="{\"${RUNTIME_TOKEN}\":{\"serviceId\":\"runtime-service\",\"profileId\":\"main-agent\",\"userId\":\"local-runtime\",\"permissions\":[\"mcp\",\"chat\",\"realtime\"]}}"
  secret_registry="{\"runtime-hermes-chat\":{\"scope\":{\"operations\":[\"chat\",\"connect\",\"list\",\"call\"],\"serviceIds\":[\"runtime-service\"],\"profileIds\":[\"main-agent\"]},\"headers\":{\"authorization\":\"Bearer ${SERVICE_KEY}\"}}}"
  managed_secret_store_key="${MANAGED_SECRET_STORE_KEY:-$(openssl rand -base64 32)}"
  public_host="${PUBLIC_HOST:-${INPUT[PUBLIC_HOST]}}"
  temporary="$(mktemp "${ROOT}/.secrets.XXXXXX")"
  grep -Ev '^AUTH_REGISTRY=|^MCP_SECRET_REGISTRY=|^MANAGED_SECRET_STORE_KEY=|^CHAT_PORT=|^PUBLIC_HOST=|^CHAT_STORAGE_KEY=' "${ENV_FILE}" > "${temporary}"
  printf 'AUTH_REGISTRY=%s\nMCP_SECRET_REGISTRY=%s\nMANAGED_SECRET_STORE_KEY=%s\nCHAT_PORT=%s\nPUBLIC_HOST=%s\nCHAT_STORAGE_KEY=%s\n' "${auth_registry}" "${secret_registry}" "${managed_secret_store_key}" "$((RUNTIME_PORT+2))" "${public_host}" "agent-earth-runtime-chat:${INSTANCE_ID}" >> "${temporary}"
  chmod 600 "${temporary}"
  mv "${temporary}" "${ENV_FILE}"
}

wait_runtime_health(){
  local attempt
  for attempt in $(seq 1 60); do
    if curl -fsS --max-time 4 "http://127.0.0.1:${INPUT[RUNTIME_PORT]}/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  event health failed "智能体服务未能正常启动"
  return 1
}

services_healthy(){
  local service container state health
  for service in database knowledge map model-service runtime; do
    container="$(docker compose --project-name "stratex-${INSTANCE_ID}" --env-file "${ROOT}/secrets.env" -f "${ROOT}/docker-compose.yml" ps -q "${service}")"
    [[ -n "${container}" ]] || return 1
    state="$(docker inspect --format '{{.State.Status}}' "${container}")"
    [[ "${state}" == running ]] || return 1
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "${container}")"
    [[ "${health}" == healthy ]] || return 1
  done
  if grep -q '^CHAT_IMAGE=' "${ROOT}/secrets.env"; then
    container="$(docker compose --project-name "stratex-${INSTANCE_ID}" --env-file "${ROOT}/secrets.env" -f "${ROOT}/docker-compose.yml" ps -q runtime-chat-demo)"
    [[ -n "${container}" ]] || return 1
    [[ "$(docker inspect --format '{{.State.Status}}' "${container}")" == running ]] || return 1
    curl -fsS --max-time 4 "http://127.0.0.1:$((INPUT[RUNTIME_PORT]+2))/" >/dev/null 2>&1 || return 1
  fi
  curl -fsS --max-time 4 "http://127.0.0.1:${INPUT[RUNTIME_PORT]}/api/health" >/dev/null 2>&1
  curl -fsS --max-time 4 "http://127.0.0.1:${INPUT[RUNTIME_PORT]}/manage/assets/manage.js" | grep -q 'STRATEX_MANAGE_PRODUCT_LANGUAGE_V1'
  curl -fsS --max-time 4 "http://127.0.0.1:${INPUT[RUNTIME_PORT]}/manage/assets/manage-addresses.js" | grep -q 'STRATEX_MANAGE_REMOTE_ACCESS_V1'
}

service_label(){
  case "$1" in
    database) printf '%s' "数据库服务";;
    knowledge) printf '%s' "资料服务";;
    map) printf '%s' "地图服务";;
    model-service) printf '%s' "模型服务";;
    runtime) printf '%s' "智能体运行服务";;
    *) printf '%s' "智能体服务";;
  esac
}

service_state_label(){
  case "$1" in
    created) printf '%s' "尚未启动";;
    restarting) printf '%s' "反复重启";;
    exited) printf '%s' "已退出";;
    dead) printf '%s' "已终止";;
    paused) printf '%s' "已暂停";;
    *) printf '%s' "未正常运行";;
  esac
}

service_failure_message(){
  local service container state health label
  if [[ ! -f "${ROOT}/secrets.env" || ! -f "${ROOT}/docker-compose.yml" ]]; then
    printf '%s' "实例配置未准备完成，请重新发布。"
    return
  fi
  for service in database knowledge map model-service runtime; do
    label="$(service_label "${service}")"
    container="$(docker compose --project-name "stratex-${INSTANCE_ID}" --env-file "${ROOT}/secrets.env" -f "${ROOT}/docker-compose.yml" ps -q --all "${service}" 2>/dev/null || true)"
    if [[ -z "${container}" ]]; then
      printf '%s' "${label}未创建，请检查运行镜像后重试。"
      return
    fi
    state="$(docker inspect --format '{{.State.Status}}' "${container}" 2>/dev/null || true)"
    if [[ "${state}" != running ]]; then
      printf '%s' "${label}启动失败（$(service_state_label "${state}")），请检查运行镜像和服务器资源后重试。"
      return
    fi
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "${container}" 2>/dev/null || true)"
    if [[ "${health}" != healthy ]]; then
      printf '%s' "${label}健康检查未通过，请检查对应服务配置后重试。"
      return
    fi
  done
  if grep -q '^CHAT_IMAGE=' "${ROOT}/secrets.env"; then
    container="$(docker compose --project-name "stratex-${INSTANCE_ID}" --env-file "${ROOT}/secrets.env" -f "${ROOT}/docker-compose.yml" ps -q --all runtime-chat-demo 2>/dev/null || true)"
    if [[ -z "${container}" || "$(docker inspect --format '{{.State.Status}}' "${container}" 2>/dev/null || true)" != running ]]; then
      printf '%s' "智能体聊天界面未启动，请检查聊天镜像后重试。"
      return
    fi
    if ! curl -fsS --max-time 4 "http://127.0.0.1:$((INPUT[RUNTIME_PORT]+2))/" >/dev/null 2>&1; then
      printf '%s' "智能体聊天界面尚未就绪，请检查服务日志后重试。"
      return
    fi
  fi
  if ! curl -fsS --max-time 4 "http://127.0.0.1:${INPUT[RUNTIME_PORT]}/api/health" >/dev/null 2>&1; then
    printf '%s' "智能体运行接口尚未就绪，请检查运行服务日志。"
    return
  fi
  if ! curl -fsS --max-time 4 "http://127.0.0.1:${INPUT[RUNTIME_PORT]}/manage/assets/manage.js" | grep -q 'STRATEX_MANAGE_PRODUCT_LANGUAGE_V1'; then
    printf '%s' "管理页面资源验证失败，请检查运行服务版本。"
    return
  fi
  if ! curl -fsS --max-time 4 "http://127.0.0.1:${INPUT[RUNTIME_PORT]}/manage/assets/manage-addresses.js" | grep -q 'STRATEX_MANAGE_REMOTE_ACCESS_V1'; then
    printf '%s' "管理页面访问地址资源验证失败，请检查固定主机发布组件。"
    return
  fi
  printf '%s' "智能体服务健康状态尚未稳定，请稍后重试。"
}

wait_services_health(){
  local started="${SECONDS}"
  while ((SECONDS - started < 30)); do
    if services_healthy; then return 0; fi
    sleep 2
  done
  event health failed "$(service_failure_message)"
  return 1
}

services_stopped(){
  local service container state port
  for service in database knowledge map model-service runtime runtime-chat-demo; do
    if [[ "${service}" == runtime-chat-demo ]] && ! grep -q '^CHAT_IMAGE=' "${ROOT}/secrets.env"; then continue; fi
    container="$(docker compose --project-name "stratex-${INSTANCE_ID}" --env-file "${ROOT}/secrets.env" -f "${ROOT}/docker-compose.yml" ps -q --all "${service}")"
    [[ -z "${container}" ]] && continue
    state="$(docker inspect --format '{{.State.Status}}' "${container}")"
    [[ "${state}" != running ]] || return 1
  done
  . "${ROOT}/secrets.env"
  for port in "${RUNTIME_PORT}" "${CHAT_PORT:-}" "${DASHBOARD_PORT}" "${MAP_PORT}"; do
    [[ -n "${port}" ]] || continue
    if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${port}$"; then return 1; fi
  done
  ! curl -fsS --max-time 2 "http://127.0.0.1:${INPUT[RUNTIME_PORT]}/api/health" >/dev/null 2>&1
}

wait_services_stopped(){
  local attempt
  for attempt in $(seq 1 30); do
    if services_stopped; then return 0; fi
    sleep 1
  done
  event services failed "实例未能完全停止"
  return 1
}

materialize_manage_ui(){
  local container html addresses
  rm -rf "${ROOT}/manage-ui"
  mkdir -p "${ROOT}/manage-ui"
  container="$(docker create "${RUNTIME_IMAGE}")"
  if ! docker cp "${container}:/app/manage-ui/." "${ROOT}/manage-ui"; then
    docker rm -f "${container}" >/dev/null 2>&1 || true
    return 1
  fi
  docker rm "${container}" >/dev/null
  html="${ROOT}/manage-ui/legacy-manage.html"
  [[ -f "${html}" ]] || { event configuration failed "管理页面资源不完整"; return 1; }
  addresses="${ROOT}/manage-ui/manage-addresses.js"
  [[ -f "${addresses}" ]] || { event configuration failed "访问地址页面资源不完整"; return 1; }
  LAST_STAGE=configuration-addresses
  python3 "${ROOT}/manage-remote-access.py" "${addresses}" "${INPUT[MAP_PORT]}" "${CHAT_PORT}"
  LAST_STAGE=configuration
  cat "${ROOT}/manage-product-language.js" >> "${ROOT}/manage-ui/manage.js"
  chmod -R a+rX "${ROOT}/manage-ui"
}

deploy(){
  LAST_STAGE=deployment
  preflight
  LAST_STAGE=configuration
  if [[ -f "${ROOT}/secrets.env" && -f "${ROOT}/images.lock" ]]; then
    event images succeeded "已复用该实例锁定的运行服务"
    for role in RUNTIME_IMAGE MAP_IMAGE KNOWLEDGE_IMAGE MODEL_SERVICE_IMAGE DATABASE_IMAGE; do
      event "$(image_stage "${role}")" succeeded "$(image_label "${role}")已准备"
    done
    ENV_FILE="${ROOT}/secrets.env"
    . "${ENV_FILE}"
    migrate_env
    chat_locked="$(sed -n 's/^CHAT_IMAGE=//p' "${ROOT}/images.lock" | tail -n 1)"
    if [[ -n "${chat_locked}" ]]; then
      set_env_value CHAT_IMAGE "${chat_locked}"
      event image-chat succeeded "智能体聊天界面已准备"
    else
      LAST_STAGE=registry
      event registry running "正在连接企业镜像服务"
      REGISTRY_CONFIG="$(mktemp -d "${ROOT}/.registry.XXXXXX")"
      export DOCKER_CONFIG="${REGISTRY_CONFIG}"
      trap 'rm -rf "${REGISTRY_CONFIG:-}"' EXIT
      printf '%s' "${INPUT[REGISTRY_PASSWORD]}" | docker login -u "${INPUT[REGISTRY_USER]}" --password-stdin metaversedockerrepo.geovisearth.com >/dev/null 2>&1
      LAST_STAGE=image-chat
      event image-chat running "正在下载智能体聊天界面"
      docker pull "${INPUT[CHAT_IMAGE]}" >&2
      digest="$(docker image inspect "${INPUT[CHAT_IMAGE]}" --format '{{index .RepoDigests 0}}')"
      set_env_value CHAT_IMAGE "${digest}"
      printf 'CHAT_IMAGE=%s\n' "${digest}" >> "${ROOT}/images.lock"
      event image-chat succeeded "智能体聊天界面已准备"
    fi
    . "${ENV_FILE}"
  else
    event registry running "正在连接企业镜像服务"
    LAST_STAGE=registry
    REGISTRY=metaversedockerrepo.geovisearth.com
    REGISTRY_CONFIG="$(mktemp -d "${ROOT}/.registry.XXXXXX")"
    export DOCKER_CONFIG="${REGISTRY_CONFIG}"
    trap 'rm -rf "${REGISTRY_CONFIG:-}"' EXIT
    printf '%s' "${INPUT[REGISTRY_PASSWORD]}" | docker login -u "${INPUT[REGISTRY_USER]}" --password-stdin "${REGISTRY}" >/dev/null 2>&1
    event images running "正在获取智能体所需运行服务"
    LAST_STAGE=images
    for role in RUNTIME_IMAGE CHAT_IMAGE MAP_IMAGE KNOWLEDGE_IMAGE MODEL_SERVICE_IMAGE DATABASE_IMAGE; do
      LAST_STAGE="$(image_stage "${role}")"
      event "${LAST_STAGE}" running "正在下载$(image_label "${role}")"
      docker pull "${INPUT[$role]}" >&2
      event "${LAST_STAGE}" succeeded "$(image_label "${role}")已准备"
    done
    LAST_STAGE=images
    : > "${ROOT}/images.lock"
    chmod 600 "${ROOT}/images.lock"
    for role in RUNTIME_IMAGE CHAT_IMAGE MAP_IMAGE KNOWLEDGE_IMAGE MODEL_SERVICE_IMAGE DATABASE_IMAGE; do
      digest="$(docker image inspect "${INPUT[$role]}" --format '{{index .RepoDigests 0}}')"
      printf '%s=%s\n' "${role}" "${digest}" >> "${ROOT}/images.lock"
      INPUT["${role}"]="${digest}"
    done
    event images succeeded "运行服务已准备完成"
    write_env
  fi
  event configuration running "正在准备实例配置"
  materialize_manage_ui
  docker compose --project-name "stratex-${INSTANCE_ID}" --env-file "${ENV_FILE}" -f "${ROOT}/docker-compose.yml" config >/dev/null
  event configuration succeeded "实例配置已准备"
  event services running "正在启动智能体服务"
  LAST_STAGE=services
  docker compose --project-name "stratex-${INSTANCE_ID}" --env-file "${ENV_FILE}" -f "${ROOT}/docker-compose.yml" up -d --build --wait --force-recreate >&2
  event services succeeded "智能体服务已启动"
  event health running "正在验证服务状态（最多等待 30 秒）"
  LAST_STAGE=health
  wait_services_health
  if [[ -n "${REGISTRY_CONFIG:-}" ]]; then rm -rf "${REGISTRY_CONFIG}"; unset DOCKER_CONFIG; trap - EXIT; fi
  event complete succeeded "固定主机发布完成"
  trap - ERR
}

start_instance(){
  preflight
  LAST_STAGE=services
  event services running "正在启动智能体"
  docker compose --project-name "stratex-${INSTANCE_ID}" --env-file "${ROOT}/secrets.env" -f "${ROOT}/docker-compose.yml" up -d --wait --force-recreate >&2
  event services succeeded "智能体服务已启动"
  LAST_STAGE=health
  event health running "正在验证服务状态（最多等待 30 秒）"
  wait_services_health
  event complete succeeded "智能体已启动"
  trap - ERR
}

stop_instance(){
  LAST_STAGE=services
  event services running "正在停止智能体"
  docker compose --project-name "stratex-${INSTANCE_ID}" --env-file "${ROOT}/secrets.env" -f "${ROOT}/docker-compose.yml" down --remove-orphans >&2
  event services succeeded "智能体服务已停止"
  LAST_STAGE=health
  event health running "正在确认所有服务已停止"
  wait_services_stopped
  event complete succeeded "智能体已停止，配置和数据已保留"
  trap - ERR
}

restart_instance(){
  preflight
  LAST_STAGE=services
  event services running "正在重启智能体"
  # up 能同时恢复被人工删除或异常退出的容器；单纯 restart 无法自愈缺失服务。
  docker compose --project-name "stratex-${INSTANCE_ID}" --env-file "${ROOT}/secrets.env" -f "${ROOT}/docker-compose.yml" up -d --wait --force-recreate >&2
  event services succeeded "智能体服务已重启"
  LAST_STAGE=health
  event health running "正在验证服务状态（最多等待 30 秒）"
  wait_services_health
  event complete succeeded "智能体已重启"
  trap - ERR
}

remove_instance(){
  LAST_STAGE=services
  event services running "正在永久删除实例运行资源和全部数据"
  if [[ -f "${ROOT}/secrets.env" && -f "${ROOT}/docker-compose.yml" ]]; then
    docker compose --project-name "stratex-${INSTANCE_ID}" --env-file "${ROOT}/secrets.env" -f "${ROOT}/docker-compose.yml" down --remove-orphans --volumes >&2
  fi
  event services succeeded "运行服务、网络和数据卷已删除"
  LAST_STAGE=data
  event data running "正在删除实例配置和运行数据"
  rm -rf "${ROOT}"
  event data succeeded "实例配置和运行数据已删除"
  event complete succeeded "实例和数据已永久删除"
  trap - ERR
}

case "${ACTION}" in
  validate) event input succeeded "部署参数检查通过"; trap - ERR;;
  preflight) preflight;;
  deploy|recover) deploy;;
  status) services_healthy && event status succeeded "智能体运行正常" || event status failed "智能体暂不可用";;
  start) start_instance;;
  stop) stop_instance;;
  restart) restart_instance;;
  remove) remove_instance;;
esac
