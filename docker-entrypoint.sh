#!/bin/sh
set -eu

token_file="/run/secrets/op_service_account_token"
if [ ! -r "$token_file" ]; then
  echo "ERROR: Missing or unreadable 1Password token file at $token_file" >&2
  exit 1
fi

OP_SERVICE_ACCOUNT_TOKEN="$(cat "$token_file")"
if [ -z "$OP_SERVICE_ACCOUNT_TOKEN" ]; then
  echo "ERROR: 1Password token file is empty" >&2
  exit 1
fi

export OP_SERVICE_ACCOUNT_TOKEN

if command -v gosu >/dev/null 2>&1; then
  exec gosu appuser:appuser op run -- "$@"
fi

echo "ERROR: gosu not found in image; cannot drop privileges safely" >&2
exit 1
