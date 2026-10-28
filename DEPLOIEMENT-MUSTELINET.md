# Déployer une application sur Mustelinet — guide réutilisable

> **PasseTonPG :** la fiche adaptée est dans [`deploy/EXPLOITATION.md`](deploy/EXPLOITATION.md). VM `passetonpg-prod`, **m1.tiny (1 vCPU / 1 Gio)**, domaine `passetonpg.accesdiscret.fr`, dépôt `kaa-serpent/passeTonPG`. Pour respecter la mémoire de tiny, les images sont construites et testées sur le PC et dans GitHub Actions, puis distribuées via des releases ; la VM ne compile pas. Les sections ci-dessous restent le modèle générique, et ne prouvent pas une installation réussie.

Guide à copier à la racine de chaque nouveau projet et à donner à son agent de développement. Il reprend l'organisation de BioCold : VM Ubuntu, Docker Compose, Nginx, tunnel Cloudflare, sous-domaine HTTPS et SSH par clé.

Ce document est un modèle : les noms `monapp` et les marqueurs `REMPLACER_...` doivent être adaptés avant exécution. Les exemples supposent une application HTTP sur le port interne 3000 et un code dans `app/`. Adapter ces deux choix au projet réel.

## 1. Remplir la fiche du projet

| Paramètre | Exemple à adapter |
| --- | --- |
| Identifiant technique, minuscules sans espaces | `monapp` |
| Dépôt privé GitHub | `git@github.com:kaa-serpent/MonApp.git` |
| Branche de production | `main` |
| Dossier du code dans le dépôt | `app/` ou racine |
| Projet OpenStack | `guigui` — vérifier son accès |
| Région | `RegionOne` — vérifier sa disponibilité |
| Nouvelle VM dédiée | `monapp-prod` |
| Image système | Ubuntu 24.04 LTS |
| Gabarit initial | `m1.medium`, 2 vCPU / 4 Gio, à ajuster |
| Volume système initial | 20 Gio minimum, à ajuster au build et aux données |
| Réseau privé | `network-1` — vérifier son accès Internet sortant |
| Groupe de sécurité dédié | `monapp-tunnel` |
| Paire de clés OpenStack | `monapp-deploy` |
| Clé privée sur le PC | `%USERPROFILE%\.ssh\monapp-deploy` |
| Tunnel Cloudflare dédié | `monapp-prod` |
| Domaine géré dans Cloudflare | `accesdiscret.fr`, si autorisé pour ce projet |
| Sous-domaine de l'application | `monapp.accesdiscret.fr` |
| Sous-domaine SSH | `ssh-monapp.accesdiscret.fr` |
| Utilisateur SSH | `ubuntu` |
| Clone sur la VM | `/opt/monapp` |
| Dossier applicatif sur la VM | `/opt/monapp/app` |
| Secrets applicatifs | `/etc/monapp.env`, propriétaire root, mode `600` |
| Clé GitHub en lecture seule sur la VM | `/root/.ssh/monapp_github` |
| Projet Docker Compose | `monapp` |
| Service systemd | `monapp.service` |
| Port HTTP publié par Docker | `127.0.0.1:3000` |
| Route de santé publique sans secret | `/api/health` |
| Données persistantes et sauvegardes | À préciser ; aucune si stockage externe uniquement |

**Architecture par défaut : une VM et un tunnel par application.** Cela permet de conserver le port 3000 sur chaque VM et d'isoler les redémarrages, les secrets et les retours arrière. Une mutualisation sur une VM existante nécessite un choix explicite, des ports distincts et une procédure adaptée ; ne pas appliquer directement ce modèle dans ce cas.

Ne jamais réutiliser les VM, clés, secrets, tunnels ou sous-domaines de BioCold ou de ProfileReader pour un nouveau projet. Ne pas modifier leurs ressources. Les noms de réseau et de projet ci-dessus sont des repères issus de l'installation existante, pas une garantie de disponibilité ou de capacité.

## 2. Comprendre les deux chemins d'accès

```text
Application : navigateur → HTTPS Cloudflare → tunnel monapp-prod
            → Nginx sur la VM, port 80 → Docker, 127.0.0.1:3000

Administration : OpenSSH sur Windows + cloudflared → ssh-monapp.accesdiscret.fr
               → tunnel monapp-prod → serveur SSH de la VM, port 22
               → authentification avec la clé privée du PC
```

Cloudflare termine TLS et le tunnel contacte Nginx en HTTP local. Aucun certificat HTTPS n'est requis sur Nginx dans cette architecture. Le sous-domaine web et le sous-domaine SSH ont des destinations différentes.

Une IP flottante Mustelinet privée de type `10.x.x.x` n'est pas nécessairement joignable depuis Windows. Ne pas créer un enregistrement DNS A public vers cette IP. Le test externe de référence utilise le sous-domaine HTTPS.

## 3. Préparer le projet en local

L'agent du projet doit commencer par examiner sa pile et ses règles, puis préparer :

```text
DEPLOIEMENT-MUSTELINET.md       ce guide, rempli pour le projet
app/Dockerfile                étapes test, build et runtime adaptées à la pile
app/.dockerignore
app/compose.yaml              simulation locale avec construction et healthcheck
app/deploy/compose.prod.yaml   exécution de l'image validée sur la VM
app/deploy/nginx-monapp.conf
app/deploy/monapp.service
app/deploy/update-from-git.sh  --check et --deploy
app/deploy/deploy-docker.sh    construction, activation et --rollback
app/deploy/bootstrap.yaml.example  amorçage sans vrai jeton
.github/workflows/ci.yml       validation Docker de chaque commit
```

Ces fichiers sont **à créer ou adapter dans chaque projet**. Ils ne sont pas fournis automatiquement par ce guide. Ne pas annoncer un retour arrière automatique tant que son script n'est pas implémenté et vérifié.

Docker est la voie normale pour les tests et la compilation : aucune installation de dépendances applicatives directement sur le PC ou la VM. Verrouiller les dépendances. Exécuter l'application avec un utilisateur non root, sans privilèges supplémentaires. Elle doit écouter sur `0.0.0.0` dans le conteneur.

Créer une route `/api/health` qui renvoie HTTP 200 quand l'application est prête, sans secret ni donnée personnelle. Une route équivalente existante peut être réutilisée, en remplaçant son chemin partout dans ce guide. Prévoir un statut d'erreur si un composant indispensable ne fonctionne pas.

### Exclusions de Git et du contexte Docker

Adapter `.gitignore` et `.dockerignore` pour exclure les fichiers réels de secrets, `.env*`, clés privées, exports de données, jeux de test confidentiels, `node_modules`, `dist`, `.next`, `.vinext`, `.wrangler` et `.sites-runtime`. Un éventuel `.env.example` ne contient que des valeurs fictives. Exclure aussi les fichiers d'amorçage contenant un jeton réel.

Les bases de données ou fichiers utilisateurs doivent disposer de volumes persistants et de sauvegardes explicites. Ne pas les placer dans le système de fichiers éphémère du conteneur.

## 4. Préparer Windows et la clé SSH

Sur le PC, disposer d'OpenSSH, de Docker Desktop et de `cloudflared`. L'exemple utilise le chemin déjà employé pour BioCold ; adapter s'il est différent :

```powershell
Get-Command ssh
docker version
docker compose version
Test-Path "$env:USERPROFILE\bin\cloudflared.exe"
```

Créer une nouvelle clé pour cette VM, uniquement si elle n'existe pas déjà :

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.ssh" | Out-Null
Test-Path "$env:USERPROFILE\.ssh\monapp-deploy"
# Si le résultat est False :
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\monapp-deploy" -C "monapp-deploy"
Get-Content "$env:USERPROFILE\.ssh\monapp-deploy.pub"
```

Choisir une phrase secrète pour la clé locale et utiliser l'agent SSH si souhaité. Importer **uniquement la clé publique** `.pub` dans OpenStack sous le nom `monapp-deploy`. Ne jamais remplacer une clé existante ni envoyer la clé privée à OpenStack, GitHub, un dépôt ou une conversation.

## 5. Réserver le tunnel et les deux sous-domaines Cloudflare

Dans le compte Cloudflare autorisé à gérer le domaine :

1. Ouvrir la section des tunnels Cloudflare One / Zero Trust ; les intitulés du tableau de bord peuvent évoluer.
2. Créer un tunnel de type `cloudflared` nommé `monapp-prod`, géré depuis le tableau de bord.
3. Récupérer son jeton d'installation dans un espace privé. Ne pas le coller dans Git ou dans une conversation.
4. Ajouter une route d'application publiée pour `monapp.accesdiscret.fr`, service **HTTP**, destination `localhost:80`.
5. Ajouter une seconde route pour `ssh-monapp.accesdiscret.fr`, service **SSH**, destination `localhost:22`.
6. Vérifier les DNS créés par Cloudflare : les noms doivent pointer vers le tunnel, généralement via un CNAME proxifié vers `<UUID-du-tunnel>.cfargotunnel.com`. Si un nom existe déjà, s'arrêter et vérifier son propriétaire avant toute modification.
7. Créer une application Cloudflare Access pour l'hôte SSH exact et une règle Allow limitée aux identités autorisées. Éviter une règle ouverte à tout le monde. Tester que les autres identités sont refusées.

Le tunnel peut rester hors ligne jusqu'au démarrage de la VM à l'étape suivante. Cloudflare Access contrôle l'accès au tunnel ; le serveur SSH exige toujours la clé du PC. Le jeton du tunnel n'est ni la clé SSH ni une clé API Cloudflare.

Pour une application privée, définir aussi son authentification web et décider si Cloudflare Access protège le sous-domaine web. Si Access protège une route de santé, adapter les contrôles automatisés avec une méthode autorisée et des secrets stockés côté serveur ; ne pas prendre une page de connexion HTTP 200 pour une preuve de santé.

Référence : [SSH via cloudflared et Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/use-cases/ssh/ssh-cloudflared-authentication/).

## 6. Créer la nouvelle VM et établir le premier accès

### Pourquoi un amorçage est nécessaire

Sur une VM neuve, le tunnel ne fonctionne pas tant que `cloudflared` n'est pas installé et démarré. On ne peut donc pas utiliser ce même tunnel pour l'installer une première fois. Utiliser les données de personnalisation **cloud-init à la création de la nouvelle VM**, ou un accès d'administration déjà disponible et explicitement autorisé.

Ne pas supposer que la console Ubuntu permet une connexion par mot de passe. Ne pas recréer une VM existante pour résoudre ce problème.

### Modèle cloud-init pour une VM neuve uniquement

Créer une copie privée locale de ce modèle, hors du dépôt, et y remplacer le nom et le jeton. La paire de clés sélectionnée dans OpenStack fournit la clé publique à l'utilisateur `ubuntu` de l'image officielle.

```yaml
#cloud-config
hostname: monapp-prod
package_update: true
packages:
  - ca-certificates
  - curl
  - git
  - nginx
  - openssh-server
ssh_pwauth: false
disable_root: true
write_files:
  - path: /etc/cloudflared/tunnel-token
    owner: root:root
    permissions: '0600'
    content: |
      REMPLACER_PAR_LE_JETON_DU_NOUVEAU_TUNNEL
  - path: /etc/systemd/system/cloudflared.service
    owner: root:root
    permissions: '0644'
    content: |
      [Unit]
      Description=Cloudflare Tunnel monapp
      Wants=network-online.target
      After=network-online.target
      [Service]
      Type=simple
      ExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run --token-file /etc/cloudflared/tunnel-token
      Restart=on-failure
      RestartSec=5s
      [Install]
      WantedBy=multi-user.target
runcmd:
  - [bash, -ec, 'install -d -m 0755 /usr/share/keyrings; curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg']
  - [bash, -ec, 'echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list']
  - [apt-get, update]
  - [apt-get, install, -y, cloudflared]
  - [systemctl, enable, --now, ssh]
  - [systemctl, daemon-reload]
  - [systemctl, enable, --now, cloudflared]
  - [bash, -ec, 'systemctl is-active --quiet ssh; systemctl is-active --quiet cloudflared; echo MUSTELINET_BOOTSTRAP_READY']
```

Le jeton est lu depuis un fichier root `600`, avec `cloudflared` version 2025.4.0 ou ultérieure. Voir les [paquets officiels Cloudflare](https://pkg.cloudflare.com/index.html) et le [paramètre officiel token-file](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/#token-file).

**Cette copie remplie est confidentielle.** Les données cloud-init peuvent rester dans les métadonnées OpenStack et les fichiers d'instance. Restreindre leur accès, ne jamais y inclure de secrets applicatifs et ne pas publier leurs journaux bruts. Pour une politique interdisant tout jeton dans les métadonnées, utiliser un accès initial sécurisé ou un mécanisme de livraison de secrets approuvé à la place. Prévoir la rotation du jeton et sa mise à jour sur la VM une fois l'accès établi ; ne pas nettoyer aveuglément cloud-init.

### Dans le portail OpenStack Mustelinet

1. Vérifier le projet `guigui`, la région et les quotas disponibles.
2. Créer un groupe de sécurité dédié. Autoriser la sortie nécessaire : DNS vers les résolveurs du réseau, HTTP/HTTPS pour les dépôts, TCP 22 vers GitHub si le clone utilise SSH, et TCP/UDP 7844 pour le tunnel Cloudflare. Aucune entrée Internet sur 22, 80 ou 3000 n'est nécessaire pour ce modèle par tunnel. Respecter les règles réseau imposées par Mustelinet.
3. Créer **une nouvelle** instance `monapp-prod`, image Ubuntu 24.04, gabarit et volume de la fiche, réseau `network-1`, paire de clés `monapp-deploy`, groupe dédié.
4. Fournir la copie cloud-init remplie dans la personnalisation de cette nouvelle instance avant son premier démarrage.
5. Vérifier le besoin éventuel d'une IP flottante selon le routage sortant du réseau. Ne jamais réaffecter celle d'une autre VM ; noter toute nouvelle IP attribuée.
6. Attendre le démarrage, examiner la console pour `MUSTELINET_BOOTSTRAP_READY`, puis vérifier que le connecteur apparaît connecté dans Cloudflare. Le marqueur indique un service démarré, la connexion dans Cloudflare confirme le tunnel.

À ce stade, la page web peut afficher la page Nginx par défaut : l'application n'est pas encore installée.

Référence réseau : [sorties requises pour Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-with-firewall/).

## 7. Configurer et tester SSH depuis Windows

Ajouter ce bloc dans `%USERPROFILE%\.ssh\config`, sans écraser les entrées existantes. Adapter le nom d'utilisateur Windows et le chemin de `cloudflared` :

```sshconfig
Host monapp-prod
    HostName ssh-monapp.accesdiscret.fr
    User ubuntu
    IdentityFile C:/Users/REMPLACER_UTILISATEUR/.ssh/monapp-deploy
    IdentitiesOnly yes
    ProxyCommand "C:/Users/REMPLACER_UTILISATEUR/bin/cloudflared.exe" access ssh --hostname %h
```

Puis, dans PowerShell :

```powershell
Resolve-DnsName ssh-monapp.accesdiscret.fr
ssh monapp-prod
```

S'authentifier auprès de Cloudflare Access si le navigateur le demande. Lors de la première connexion SSH, comparer l'empreinte de la clé hôte à une source indépendante de confiance, par exemple la console OpenStack. Ne pas désactiver la vérification des clés hôtes.

Sur la VM, vérifier :

```bash
id -un
hostname
sudo cloud-init status --wait
sudo systemctl is-active ssh nginx cloudflared
```

Résultat attendu : utilisateur `ubuntu`, VM `monapp-prod`, cloud-init terminé sans erreur, services actifs. Sortir avec `exit`.

Pour les connexions suivantes :

```powershell
ssh monapp-prod "hostname"
scp "C:\chemin\fichier-non-secret" monapp-prod:/tmp/
```

Si l'accès est refusé ou absent, arrêter le déploiement et faire corriger DNS, Access, tunnel ou clé avec une autorisation adaptée. Ne pas passer par une autre VM et ne pas recréer automatiquement l'instance.

## 8. Installer Docker et l'accès GitHub sur la VM

### Docker

Se connecter avec `ssh monapp-prod`. Installer Docker Engine et le plugin Compose depuis le dépôt APT officiel pour Ubuntu 24.04, en suivant la [procédure officielle Docker, section installation par dépôt APT](https://docs.docker.com/engine/install/ubuntu/#install-using-the-repository). L'agent doit intégrer les commandes vérifiées dans le bootstrap du projet s'il automatise cette étape.

```bash
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
```

Utiliser `sudo docker` dans ce guide. Ne pas installer Node, npm ou les dépendances du projet sur l'hôte.

### Clé de déploiement GitHub distincte de la clé du PC

Sur la nouvelle VM :

```bash
sudo install -d -m 700 /root/.ssh
sudo test -e /root/.ssh/monapp_github
# Uniquement si la clé n'existe pas :
sudo ssh-keygen -t ed25519 -N '' -f /root/.ssh/monapp_github -C monapp-github-readonly
sudo cat /root/.ssh/monapp_github.pub
```

Ajouter cette **clé publique** dans GitHub → dépôt du projet → Settings → Deploy keys. Laisser l'écriture désactivée. La clé privée reste sur la VM, mode `600`.

Avant le clone, enregistrer la clé hôte de GitHub dans `/root/.ssh/known_hosts` après comparaison avec les [empreintes publiées officiellement par GitHub](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/githubs-ssh-key-fingerprints). Un résultat `ssh-keyscan` seul ne prouve pas l'identité du serveur.

```bash
sudo env GIT_SSH_COMMAND='ssh -i /root/.ssh/monapp_github -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes' \
  git clone --branch main git@github.com:kaa-serpent/MonApp.git /opt/monapp
```

Si `/opt/monapp` existe déjà, examiner son contenu avant toute action. Ne pas écraser un clone existant. Conserver l'accès GitHub par clé dédiée dans les scripts de mise à jour.

## 9. Installer les secrets de l'application

Sur la VM, créer le fichier uniquement s'il est absent, puis le remplir avec un éditeur sécurisé :

```bash
sudo test -e /etc/monapp.env || sudo install -o root -g root -m 600 /dev/null /etc/monapp.env
sudoedit /etc/monapp.env
sudo chmod 600 /etc/monapp.env
sudo chown root:root /etc/monapp.env
sudo stat -c '%a %U %G' /etc/monapp.env
```

Résultat attendu : `600 root root`. Ne pas afficher le contenu. Les noms exacts des variables dépendent du projet ; exemple **sans vrais secrets** :

```dotenv
APP_ORIGIN=https://monapp.accesdiscret.fr
NODE_ENV=production
SESSION_SECRET=REMPLACER_PAR_UN_SECRET_ALEATOIRE_PROPRE_A_CE_PROJET
```

Les secrets applicatifs restent exclusivement dans `/etc/monapp.env`. Les identifiants d'infrastructure restent dans leurs fichiers protégés dédiés. Ne pas utiliser de secret dans un argument de build, une variable `NEXT_PUBLIC_`, Git ou le navigateur. Les valeurs publiques intégrées au build doivent être traitées séparément selon la pile.

Si Google ou un autre fournisseur OAuth est utilisé, enregistrer le nouveau domaine exact et les éventuelles URL de retour exigées par **le flux de ce projet**. Ne pas recopier automatiquement les réglages OAuth de BioCold.

## 10. Configurer Compose, Nginx et systemd

### Exemple de `app/deploy/compose.prod.yaml`

```yaml
name: monapp
services:
  app:
    image: monapp:current
    env_file:
      - /etc/monapp.env
    environment:
      NODE_ENV: production
      HOSTNAME: 0.0.0.0
      PORT: 3000
    ports:
      - "127.0.0.1:3000:3000"
    init: true
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
```

Le Dockerfile doit définir un `HEALTHCHECK` adapté au runtime et à `/api/health`, avec des délais et une période de démarrage réalistes. Le fichier ci-dessus exécute une image déjà construite : le script de déploiement doit créer cette image avant le premier démarrage. Ajouter les volumes requis par le projet ; utiliser un système de fichiers en lecture seule et `/tmp` en mémoire si l'application le permet.

### Exemple de `app/deploy/nginx-monapp.conf`

```nginx
server {
    listen 80;
    server_name monapp.accesdiscret.fr;
    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 60s;
    }
}
```

Le protocole transmis vaut HTTPS car cette entrée est réservée au tunnel Cloudflare. Ajuster taille d'envoi et délais aux besoins. Pour WebSocket, SSE ou réponses longues, ajouter les réglages spécifiques et les vérifier. Les ports entrants directs doivent rester fermés ; l'application doit traiter les en-têtes proxy selon ce périmètre de confiance.

### Exemple de `app/deploy/monapp.service`

```ini
[Unit]
Description=Application monapp Docker
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/monapp/app
ExecStart=/usr/bin/docker compose -f deploy/compose.prod.yaml up -d --remove-orphans
ExecStop=/usr/bin/docker compose -f deploy/compose.prod.yaml down
RemainAfterExit=yes
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

`systemd` assure le démarrage au boot ; la politique Docker assure les redémarrages du conteneur. Un service systemd `active` ne prouve pas que l'application est saine : vérifier aussi Docker et HTTP.

L'installation de ces configurations appartient au script de déploiement et intervient après l'autorisation de mise en production. Sur une nouvelle VM, installer le site Nginx puis désactiver le lien du site `default` s'il existe, après vérification. Exécuter `nginx -t` avant un rechargement. Ne pas supprimer des configurations inconnues.

## 11. Valider localement et vérifier la CI avant déploiement

Depuis le dossier applicatif sous Windows, avec les fichiers locaux adaptés :

```powershell
docker build --target test -t monapp:test .
# Continuer uniquement si le code de sortie est 0.
docker compose up --build -d
docker compose ps
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/health
docker compose down
```

Exécuter les étapes séparément et arrêter au premier échec. Exiger un conteneur `healthy`, HTTP 200 et les tests métier pertinents. Pour une modification d'interface, proposer un contrôle visuel des vues principales et le réaliser si demandé. Corriger les échecs puis recommencer la validation complète.

Configurer la CI GitHub pour exécuter les tests et la construction dans Docker, sans secret de production. Après fusion sur `main`, vérifier que la CI est verte **pour le SHA exact à déployer** et que ce SHA contient les changements validés. Si un nouveau commit arrive, vérifier de nouveau sa CI et son périmètre avant activation.

## 12. Contrat des scripts de déploiement à implémenter

Pour retrouver la simplicité de BioCold, le projet doit fournir les deux commandes suivantes :

```bash
sudo bash /opt/monapp/app/deploy/update-from-git.sh --check
sudo bash /opt/monapp/app/deploy/update-from-git.sh --deploy
```

Le mode `--check` n'active aucune nouvelle version, ne nettoie aucune ressource et vérifie :

- VM, chemins, domaine et dépôt conformes à la fiche ; services Docker, Nginx, tunnel et connectivité disponibles ;
- clone propre sur `main`, origine Git exacte, accès GitHub par la clé dédiée ;
- permissions root `600` et présence des variables requises, sans afficher leur valeur ;
- espace disque suffisant pour construire et garder une image de secours ;
- configuration Nginx valide et présence de tous les fichiers nécessaires.

Pour un premier déploiement, le contrôle doit accepter l'absence d'image précédente et de service applicatif installé. Le bootstrap et les dépendances doivent déjà être prêts. Pour les mises à jour, contrôler aussi l'état actuel de l'application.

Le mode `--deploy` doit :

1. Prendre un verrou afin d'empêcher deux déploiements simultanés et répéter les précontrôles.
2. Récupérer `origin/main`, fixer et afficher le SHA candidat, vérifier qu'il est celui approuvé et que sa CI est verte ; refuser sinon. Ne pas exiger un PAT sur la VM : la vérification CI peut être faite depuis le poste puis le SHA explicitement transmis au script.
3. Refuser une mise à jour qui ne serait pas une avance rapide. Aucun écrasement d'un clone modifié.
4. Construire une image candidate identifiée par le SHA, en exécutant les tests via Docker avant activation.
5. Sauvegarder le commit, l'image active et les seules configurations appartenant à l'application, dans `/var/lib/monapp/rollback`.
6. Installer les nouvelles configurations, vérifier Nginx, activer l'image et le service.
7. Attendre `healthy`, vérifier HTTP 200 sur le conteneur via loopback, puis Nginx avec le bon Host, puis le domaine HTTPS public. Refuser les redirections et les pages de connexion prises à tort pour des réponses saines.
8. Confirmer le SHA déployé. En cas d'échec, restaurer image, configurations et commit précédents et vérifier leur santé. Pour une première installation, signaler explicitement qu'aucune version antérieure n'existe.

Le script doit s'exécuter depuis une copie temporaire pour éviter qu'une mise à jour de son propre fichier perturbe son exécution. Ne jamais faire de nettoyage global Docker. Ne supprimer aucun volume de données. Le retour arrière du code ne restaure pas une base de données : prévoir une sauvegarde et une stratégie spécifique pour toute migration.

## 13. Autoriser puis effectuer la mise en production

**Arrêt obligatoire avant activation :** demander une confirmation explicite de l'utilisatrice dans la conversation en cours, en indiquant la VM, le domaine et le SHA validé. Une demande de préparation, une fusion ou un push ne vaut pas autorisation de déployer. Demander séparément l'autorisation avant toute création payante ou modification de ressources d'infrastructure si elle n'a pas déjà été donnée pour ce périmètre.

Après validation locale complète, CI verte du SHA concerné et confirmation explicite :

```powershell
ssh monapp-prod
```

Puis sur la VM, avec les scripts réellement implémentés selon l'étape 12 :

```bash
sudo bash /opt/monapp/app/deploy/update-from-git.sh --check
# Continuer uniquement après un contrôle réussi.
sudo bash /opt/monapp/app/deploy/update-from-git.sh --deploy
```

Si le script prévoit un argument de SHA, employer celui qu'il documente ; ne pas laisser le candidat changer entre l'approbation et l'activation.

Vérifications sur la VM :

```bash
sudo git -C /opt/monapp rev-parse HEAD
sudo systemctl is-active monapp nginx cloudflared
sudo docker compose -f /opt/monapp/app/deploy/compose.prod.yaml ps
curl --fail --max-time 20 http://127.0.0.1:3000/api/health
curl --fail --max-time 20 -H 'Host: monapp.accesdiscret.fr' http://127.0.0.1/api/health
curl --fail --max-time 20 https://monapp.accesdiscret.fr/api/health
```

Depuis Windows, effectuer aussi le contrôle externe :

```powershell
Invoke-WebRequest -UseBasicParsing https://monapp.accesdiscret.fr/api/health
```

Les contrôles automatisés doivent vérifier explicitement le statut **200** et la structure attendue de la réponse, car `curl --fail` seul ne refuse pas toutes les redirections. Tester enfin l'ouverture du site, la connexion et un parcours métier avec des données de test autorisées. Ne pas afficher ni modifier des données réelles pour un simple contrôle de disponibilité.

Pour les mises à jour suivantes, reprendre les étapes 11 à 13. Après toute modification des secrets, recréer le conteneur avec Compose pour qu'il relise son environnement, puis refaire les contrôles utiles ; un simple redémarrage du conteneur ne recharge pas `env_file`.

## 14. Diagnostic rapide

| Symptôme | Vérification prioritaire |
| --- | --- |
| Sous-domaine introuvable | DNS du nom exact, zone Cloudflare et route publiée |
| Erreur Cloudflare 1033 | Connecteur absent ou hors ligne ; service et sortie réseau 7844 |
| Erreur 502 | Destination de la route, Nginx, port Docker et logs ciblés |
| Page Nginx par défaut | Site Nginx activé et `server_name` correct |
| SSH refusé avant authentification Linux | Route SSH et politique Cloudflare Access |
| `Permission denied (publickey)` | Utilisateur `ubuntu`, clé locale et clé publique injectée dans la bonne VM |
| Empreinte SSH changée | Vérifier l'identité de la VM ; ne pas supprimer aveuglément `known_hosts` |
| Application locale saine, HTTPS en panne | Test Nginx avec Host, DNS, tunnel et éventuelle protection Access |
| OAuth refuse l'origine | Domaine exact, origine serveur et paramètres du fournisseur |
| Disque plein | `df -h` et `sudo docker system df` ; nettoyage ciblé uniquement |

Commandes de diagnostic sur la VM :

```bash
sudo nginx -t
sudo journalctl -u cloudflared -n 60 --no-pager
sudo journalctl -u monapp -n 60 --no-pager
sudo docker compose -f /opt/monapp/app/deploy/compose.prod.yaml logs --tail 60
```

Examiner les journaux dans un contexte privé et masquer leurs éventuelles données sensibles avant partage. Ne pas lancer `docker compose config` dans une sortie partagée : la commande peut développer les variables d'environnement.

Ne jamais réparer une panne d'accès en supprimant une VM, en réaffectant une IP, en ouvrant SSH par mot de passe ou en touchant une autre application. Une intervention de secours exige une autorisation spécifique et un plan de préservation des volumes.

## 15. Consigne à donner à l'agent de chaque projet

Copier ce guide dans le projet, remplir la fiche, puis transmettre cette consigne :

> Lis `DEPLOIEMENT-MUSTELINET.md` et les instructions du dépôt. Adapte ce modèle à la pile réelle du projet. Prépare les fichiers Docker, Compose, Nginx, systemd, CI, bootstrap et scripts de déploiement avec contrôles de santé et retour arrière. Documente les variables requises sans leurs valeurs. Vérifie les exclusions de secrets et de données privées. Effectue toute la validation locale dans Docker et identifie le SHA dont la CI doit être verte. Présente le résultat concret et les seuls accès ou choix manquants. Ne crée pas de ressource payante ni ne déploie sans l'autorisation explicite requise. Utilise une VM, un tunnel et deux sous-domaines dédiés à ce projet ; ne modifie aucune autre application. Après autorisation et vérifications, déploie le SHA approuvé, contrôle le site HTTPS et SSH, puis note la version déployée et la procédure de retour arrière.

## 16. Fiche à conserver après installation

Mettre à jour ce document ou un fichier d'exploitation du projet avec :

- nom et identifiant de la VM, volume, réseau, groupe de sécurité et éventuelle IP flottante ;
- nom et identifiant du tunnel, deux sous-domaines et politique Access attendue ;
- alias SSH, utilisateur et **chemins** des clés, sans leur contenu ;
- chemin du clone, fichier de secrets et service systemd ;
- SHA déployé, date, contrôles réussis et image de secours disponible ;
- emplacement des données persistantes, sauvegardes et procédure de restauration.

Ce document décrit une procédure à adapter. Il ne constitue pas une preuve qu'une nouvelle VM, un nouveau tunnel ou une nouvelle application a déjà été créé ou validé.
