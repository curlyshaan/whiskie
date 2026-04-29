FROM ghcr.io/railwayapp/nixpacks:ubuntu-1745885067

WORKDIR /app

COPY .nixpacks/ /app/.nixpacks/
RUN nix-env -if /app/.nixpacks/nixpkgs-23f9169c4ccce521379e602cc82ed873a1f1b52b.nix && nix-collect-garbage -d

COPY package.json package-lock.json nixpacks.toml railway.json /app/
RUN npm ci

RUN python3.11 -m venv /app/.venv \
  && /app/.venv/bin/python -m ensurepip --upgrade \
  && /app/.venv/bin/python -m pip install --upgrade pip setuptools wheel \
  && /app/.venv/bin/python -m pip install --no-cache-dir earnings==1.1.0

COPY . /app

ENV PATH="/app/node_modules/.bin:${PATH}"

CMD ["sh", "-c", "PYTHON_BIN=/app/.venv/bin/python node src/index.js"]
