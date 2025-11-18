#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DRIZZLE_DIR="${ROOT_DIR}/drizzle"
if [ -d "${DRIZZLE_DIR}" ]; then
  echo "Removing drizzle directory at ${DRIZZLE_DIR}"
  rm -rf "${DRIZZLE_DIR}"
else
  echo "Drizzle directory not found at ${DRIZZLE_DIR}, skipping"
fi

remove_sqlite_var() {
  local env_file="$1"
  if [ ! -f "${env_file}" ]; then
    return
  fi
  if ! grep -q "^SQLITE_URL=" "${env_file}"; then
    echo "No SQLITE_URL entry in ${env_file}, skipping"
    return
  fi

  local target_db
  target_db="$(grep "^SQLITE_URL=" "${env_file}" | head -n1 | cut -d '=' -f2- | tr -d '"' | tr -d "'" | xargs)"
  if [ -z "${target_db}" ]; then
    echo "SQLITE_URL in ${env_file} is empty, skipping"
    return
  fi

  local db_path="${target_db}"
  if [ "${db_path#/}" = "${db_path}" ]; then
    db_path="${ROOT_DIR}/${db_path}"
  fi

  if [ -f "${db_path}" ]; then
    echo "Removing SQLite file ${db_path} (from ${env_file})"
    rm -f "${db_path}"
  else
    echo "SQLite file ${db_path} not found (from ${env_file}), skipping removal"
  fi
}

remove_sqlite_var "${ROOT_DIR}/.env"
remove_sqlite_var "${ROOT_DIR}/.env.development"
remove_sqlite_var "${ROOT_DIR}/.env.production"
