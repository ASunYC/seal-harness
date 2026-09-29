#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ACTION="${1:-}"
INSTANCE_ID="${2:-}"
ROOT="/opt/stratex/workflow"
INSTANCE_DIR="${ROOT}/${INSTANCE_ID}"
COMPOSE_FILE="${INSTANCE_DIR}/docker-compose.yml"
ENV_FILE="${INSTANCE_DIR}/runtime.env"
PROJECT="stratex-${INSTANCE_ID}"

emit() {
  printf '{"v":1,"stage":"%s","state":"%s","message":"%s"}\n' "$1" "$2" "$3"
}
fail() {
  emit "${1:-failed}" failed "${2:-操作未完成，请检查固定主机运行环境。}"
  exit 1
}
decode_input() {
  local line key value
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || fail input "发布参数格式不正确。"
    printf -v "$key" '%s' "$(printf '%s' "$value" | base64 -d)"
    export "$key"
  done
}
validate() {
  [[ "$INSTANCE_ID" =~ ^flow-[a-f0-9]{24}$ ]] || fail input "实例标识不正确。"
  [[ "${RUNTIME_PORT:-}" =~ ^[0-9]+$ ]] || fail input "服务端口不正确。"
  (( RUNTIME_PORT >= 1024 && RUNTIME_PORT <= 65535 )) || fail input "服务端口不正确。"
}
compose() {
  docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" --file "$COMPOSE_FILE" "$@"
}
ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then return; fi
  emit environment running "正在准备固定主机运行环境"
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq docker.io docker-compose-v2 curl ca-certificates
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y docker docker-compose-plugin curl ca-certificates
  elif command -v yum >/dev/null 2>&1; then
    yum install -y docker docker-compose-plugin curl ca-certificates
  else
    fail environment "固定主机缺少受支持的容器运行环境，请联系管理员处理。"
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 || fail environment "容器运行环境准备失败，请联系管理员处理。"
  emit environment succeeded "固定主机运行环境已就绪"
}
check_port() {
  if command -v ss >/dev/null 2>&1 && ss -H -ltn "sport = :${RUNTIME_PORT}" | grep -q .; then
    if ! compose ps --status running --quiet 2>/dev/null | grep -q .; then
      fail port "服务端口已被占用，请返回并更换端口。"
    fi
  fi
}
wait_ready() {
  local attempt
  for attempt in $(seq 1 180); do
    if curl --fail --silent --max-time 3 "http://127.0.0.1:${RUNTIME_PORT}/health/ready" >/dev/null; then return; fi
    sleep 2
  done
  fail health "流程运行服务未能按时就绪，请重试或查看操作记录。"
}
write_environment() {
  local admin_password
  admin_password="$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | base64 | tr -dc 'a-f0-9' | head -c 48)"
  cat >"$ENV_FILE" <<EOF
RUNTIME_IMAGE=${RUNTIME_IMAGE}
RUNTIME_PORT=${RUNTIME_PORT}
PUBLIC_ORIGIN=${PUBLIC_ORIGIN}
ADMIN_PASSWORD=${admin_password}
MODEL_BASE_URL=${MODEL_BASE_URL}
MODEL_PROTOCOL=${MODEL_PROTOCOL}
MODEL_NAME=${MODEL_NAME}
MODEL_API_KEY=${MODEL_API_KEY}
EOF
  chmod 600 "$ENV_FILE"
}
write_image_lock() {
  local repo_digest image_id digest
  repo_digest="$(docker image inspect "$RUNTIME_IMAGE" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"
  image_id="$(docker image inspect "$RUNTIME_IMAGE" --format '{{.Id}}')"
  digest="${repo_digest:-$image_id}"
  [[ "$digest" =~ sha256:[a-f0-9]{64}$ ]] || fail images "无法确认流程运行服务版本。"
  printf 'RUNTIME_IMAGE=%s\n' "$digest" >"${INSTANCE_DIR}/images.lock"
  chmod 600 "${INSTANCE_DIR}/images.lock"
}

case "$ACTION" in
  deploy|recover)
    decode_input
    validate
    emit connect succeeded "固定主机连接已验证"
    emit system running "正在检查主机系统"
    [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] || fail system "固定主机需要 Linux x86_64 系统。"
    emit system succeeded "主机系统检查通过"
    ensure_docker
    mkdir -p "$INSTANCE_DIR"
    check_port
    emit registry running "正在连接企业镜像服务"
    printf '%s' "$REGISTRY_PASSWORD" | docker login metaversedockerrepo.geovisearth.com --username "$REGISTRY_USER" --password-stdin >/dev/null 2>&1 ||
      fail registry "企业镜像服务连接失败，请重新登录后重试。"
    emit registry succeeded "企业镜像服务连接成功"
    emit images running "正在下载流程运行服务"
    docker pull "$RUNTIME_IMAGE" >/dev/null || fail images "流程运行服务下载失败，请检查网络后重试。"
    emit images succeeded "流程运行服务下载完成"
    write_environment
    emit configuration succeeded "实例配置已保存"
    emit services running "正在启动流程运行服务"
    compose up -d --force-recreate >/dev/null || fail services "流程运行服务启动失败，请重试。"
    write_image_lock
    emit services succeeded "流程运行服务已启动"
    emit health running "正在等待流程运行服务就绪"
    wait_ready
    emit health succeeded "流程运行服务已就绪"
    emit complete succeeded "流程型智能体发布完成"
    ;;
  status)
    decode_input
    validate
    ensure_docker
    if compose ps --status running --quiet 2>/dev/null | grep -q . &&
      curl --fail --silent --max-time 3 "http://127.0.0.1:${RUNTIME_PORT}/health/ready" >/dev/null; then
      printf '%s\n' "流程服务运行中"
      exit 0
    fi
    printf '%s\n' "流程服务暂不可用"
    ;;
  start|restart|stop)
    decode_input
    validate
    ensure_docker
    emit services running "正在维护流程运行服务"
    if [[ "$ACTION" == stop ]]; then compose stop >/dev/null; else compose "$ACTION" >/dev/null; fi
    emit services succeeded "流程运行服务状态已更新"
    if [[ "$ACTION" != stop ]]; then
      emit health running "正在等待流程运行服务就绪"
      wait_ready
      emit health succeeded "流程运行服务已就绪"
    fi
    emit complete succeeded "操作已完成"
    ;;
  remove)
    decode_input
    validate
    ensure_docker
    emit services running "正在删除流程型智能体"
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
    rm -rf -- "$INSTANCE_DIR"
    emit services succeeded "流程型智能体已删除"
    emit complete succeeded "操作已完成"
    ;;
  *)
    fail input "不支持的固定主机操作。"
    ;;
esac
