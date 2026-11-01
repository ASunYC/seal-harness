FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git git-lfs gnupg python3 socat tmux \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
  && npm install -g @deepseek-ai/dsh@0.2.1-rc.3

ARG SUPERAGENT_REV=6337fc823ce20251c8de8085948165c81aaa701e
RUN git init /opt/dsh-superagent \
  && git -C /opt/dsh-superagent remote add origin https://github.com/deepseek-ai/dsh-superagent-prototype.git \
  && git -C /opt/dsh-superagent fetch --depth 1 origin "$SUPERAGENT_REV" \
  && git -C /opt/dsh-superagent checkout --detach FETCH_HEAD \
  && cd /opt/dsh-superagent \
  && corepack pnpm install --frozen-lockfile \
  && corepack pnpm build \
  && chown -R node:node /opt/dsh-superagent

COPY entrypoint.sh /usr/local/bin/seal-superagent-entrypoint
COPY gh-agent /usr/local/bin/gh-agent
RUN chmod 0755 /usr/local/bin/seal-superagent-entrypoint /usr/local/bin/gh-agent \
  && mkdir -p /home/node/.dsh /home/node/work \
  && chown -R node:node /home/node/.dsh /home/node/work

USER node
ENV DSH_HOME=/home/node/.dsh
WORKDIR /opt/dsh-superagent
EXPOSE 3083
ENTRYPOINT ["/usr/local/bin/seal-superagent-entrypoint"]
