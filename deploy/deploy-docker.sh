#!/usr/bin/env bash
# Run from a private temporary copy so replacing /opt/passetonpg is safe.
set -Eeuo pipefail
umask 077
if [[ ${PTPG_TEMP_COPY:-0} != 1 ]]; then
  copy=$(mktemp /tmp/passetonpg-deploy.XXXXXX)
  cp -- "$0" "$copy"
  result=0
  PTPG_TEMP_COPY=1 bash "$copy" "$@" || result=$?
  rm -f -- "$copy"
  exit "$result"
fi
[[ $EUID == 0 ]] || { echo 'Utiliser sudo.'; exit 1; }
[[ $(hostname) == passetonpg-prod ]] || { echo 'VM inattendue.'; exit 1; }
state=/var/lib/passetonpg
root=/opt/passetonpg
releases=/opt/passetonpg-releases
domain=passetonpg.accesdiscret.fr
install -d -m 0700 "$state" "$state/rollback"
exec 9>"$state/deploy.lock"
flock -n 9 || { echo 'Un déploiement est déjà en cours.'; exit 1; }
mode=${1:---check}
health() {
  local url=$1; shift
  local response
  response=$(curl -sS --max-time 20 -w '\n%{http_code}' "$@" "$url") || return 1
  [[ ${response##*$'\n'} == 200 ]] || return 1
  printf '%s' "${response%$'\n'*}" | docker exec -i "$(docker compose -f "$root/deploy/compose.prod.yaml" ps -q app)" node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try {let d=JSON.parse(s);process.exit(d.status==="ok"&&d.service==="passetonpg"?0:1)} catch {process.exit(1)}})'
}
check() {
  test "$(stat -c '%u:%a' /etc/passetonpg.env)" = 0:600
  for variable in ADMIN_USERNAME ADMIN_PASSWORD; do
    grep -qE "^${variable}=.+" /etc/passetonpg.env || { echo "Variable manquante : $variable"; return 1; }
  done
  systemctl is-active --quiet docker nginx cloudflared
  nginx -t
  [[ $(df -Pk /var/lib/docker | awk 'NR==2 {print $4}') -ge 2097152 ]] || { echo 'Moins de 2 Gio libres.'; return 1; }
  if [[ -f $state/current.env ]]; then
    set -a; source "$state/current.env"; set +a
    health http://127.0.0.1:3000/api/health
  fi
  echo 'Précontrôles réussis.'
}
activate() {
  local sha=$1
  [[ $sha =~ ^[0-9a-f]{40}$ ]] && [[ -d $releases/$sha/deploy ]] || return 1
  ln -s "$releases/$sha" "$releases/active-next" || return 1
  mv -Tf "$releases/active-next" "$root" || return 1
  printf 'APP_IMAGE=passetonpg:%s\nDEPLOYED_SHA=%s\n' "$sha" "$sha" > "$state/current.env" || return 1
  export APP_IMAGE="passetonpg:$sha"
  install -m 0644 "$root/deploy/nginx-passetonpg.conf" /etc/nginx/sites-available/passetonpg || return 1
  ln -sfn /etc/nginx/sites-available/passetonpg /etc/nginx/sites-enabled/passetonpg || return 1
  # Only disable the standard unmodified symlink on this dedicated VM.
  if [[ -L /etc/nginx/sites-enabled/default && $(readlink /etc/nginx/sites-enabled/default) == /etc/nginx/sites-available/default ]]; then
    rm /etc/nginx/sites-enabled/default || return 1
  fi
  nginx -t || return 1
  for unit in passetonpg.service passetonpg-backup.service passetonpg-backup.timer; do
    install -m 0644 "$root/deploy/$unit" "/etc/systemd/system/$unit" || return 1
  done
  systemctl daemon-reload || return 1
  docker compose -f "$root/deploy/compose.prod.yaml" up -d --remove-orphans --wait --wait-timeout 120 || return 1
  systemctl enable --now passetonpg.service passetonpg-backup.timer || return 1
  systemctl reload nginx || return 1
  health http://127.0.0.1:3000/api/health || return 1
  health http://127.0.0.1/api/health -H "Host: $domain" || return 1
  health "https://$domain/api/health" || return 1
  echo "Version active : $sha"
}
rollback() {
  [[ -f $state/rollback/previous.env ]] || { echo 'Première installation : aucune version précédente.'; return 1; }
  local previous
  previous=$(sed -n 's/^DEPLOYED_SHA=//p' "$state/rollback/previous.env")
  activate "$previous" || return 1
  echo 'Code précédent restauré. La sauvegarde SQLite reste disponible ; elle ne se restaure pas automatiquement.'
}
case "$mode" in
  --check) check; exit ;;
  --rollback) rollback; exit ;;
  --deploy) ;;
  *) echo 'Usage : --check | --deploy TAG SHA_APPROUVE | --rollback'; exit 1 ;;
esac
tag=${2:?TAG requis}
sha=${3:?SHA approuvé requis, vérifier la CI depuis le poste}
[[ $tag =~ ^v[0-9][A-Za-z0-9._-]*$ && $sha =~ ^[0-9a-f]{40}$ ]] || exit 1
check
[[ ! -e $root || -L $root ]] || { echo '/opt/passetonpg doit être absent ou être le lien de release.'; exit 1; }
work=$(mktemp -d /var/tmp/passetonpg-release.XXXXXX)
trap 'rm -rf -- "$work"' EXIT
base="https://github.com/kaa-serpent/passeTonPG/releases/download/$tag"
curl -fLsS --proto '=https' "$base/SHA256SUMS" -o "$work/SHA256SUMS"
curl -fLsS --proto '=https' "$base/passetonpg-linux-amd64.tar.gz" -o "$work/passetonpg-linux-amd64.tar.gz"
[[ $(wc -l < "$work/SHA256SUMS") == 1 ]]
grep -qE '^[a-f0-9]{64}  passetonpg-linux-amd64.tar.gz$' "$work/SHA256SUMS"
(cd "$work" && sha256sum -c SHA256SUMS)
docker load -i "$work/passetonpg-linux-amd64.tar.gz"
[[ $(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "passetonpg:$sha") == "$sha" ]]
install -d -m 0755 "$releases"
if [[ ! -e $releases/$sha ]]; then
  curl -fLsS --proto '=https' "https://api.github.com/repos/kaa-serpent/passeTonPG/tarball/$sha" -o "$work/source.tar.gz"
  mkdir "$work/source"
  tar -xzf "$work/source.tar.gz" -C "$work/source" --strip-components=1 --no-same-owner
  test -f "$work/source/deploy/compose.prod.yaml"
  mv "$work/source" "$releases/$sha"
fi
if [[ -f $state/current.env ]]; then
  [[ ${DEPLOYED_SHA:-} != "$sha" ]] || { echo 'Cette version est déjà active.'; exit 0; }
  bash "$root/deploy/backup.sh"
  cp "$state/current.env" "$state/rollback/previous.env"
fi
install -d -o 1000 -g 1000 -m 0700 "$state/data"
if (set -Eeuo pipefail; activate "$sha"); then
  echo "Déploiement vérifié : $sha"
else
  echo 'Échec de la nouvelle version.' >&2
  if [[ -f $state/rollback/previous.env ]]; then
    rollback || { echo 'ÉCHEC du retour arrière, intervention requise.' >&2; exit 2; }
  else
    export APP_IMAGE="passetonpg:$sha"
    docker compose -f "$root/deploy/compose.prod.yaml" stop || true
    echo 'Première installation arrêtée, données conservées. Aucune version antérieure.' >&2
  fi
  exit 1
fi
