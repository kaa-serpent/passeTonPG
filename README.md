# PasseTonPG

PWA en français et en anglais pour inventorier des clés et des cylindres et retrouver les codes de passe général possibles. Interface mobile, navigation basse, thèmes clair et sombre, projets privés et catalogue partagé de marques et modèles.

Le sélecteur Français / English dans l’en-tête change immédiatement la langue de l’interface, des formulaires et des messages. Le choix est mémorisé sur cet appareil pendant un an et reste utilisable hors ligne. Les noms et descriptions saisis par les utilisateurs sont conservés tels quels. Les traductions anglaises sont centralisées dans `src/lib/translations.en.json`.

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Lucide React et SQLite intégré à Node.js 24. Docker Compose lance l’application et Nginx ; la base reste dans un volume Docker.

## Hébergement Mustelinet

Production : [passetonpg.accesdiscret.fr](https://passetonpg.accesdiscret.fr). VM dédiée `m1.tiny` (1 vCPU, 1 Gio, disque 10 Gio), image Docker distribuée par les releases GitHub. La fiche d'installation, les contrôles, les sauvegardes et les commandes de mise à jour figurent dans [deploy/EXPLOITATION.md](deploy/EXPLOITATION.md).

## Démarrage local

Installer Docker Desktop avec les conteneurs Linux, puis ouvrir PowerShell dans ce dossier :

```powershell
Copy-Item .env.example .env
notepad .env
```

Renseigner `ADMIN_USERNAME` et `ADMIN_PASSWORD` : pseudo d’au moins 3 caractères et mot de passe d’au moins 10 caractères. Aucun identifiant n’est fourni par défaut. Les variables sont lues au premier accès au serveur ; si aucun administrateur n’existe, il est créé. Une fois créé, modifier ces variables ne change pas son mot de passe : utiliser le formulaire du compte.

```powershell
docker compose up --build -d
docker compose ps
```

Ouvrir [PasseTonPG sur localhost](http://localhost:8080). Le premier build peut prendre quelques minutes.

```powershell
# Consulter les journaux
docker compose logs --tail=100 app nginx
# Arrêter sans supprimer les données
docker compose down
# Appliquer une nouvelle version
docker compose up --build -d
```

Le volume `app_data` conserve comptes, catalogue, sessions et projets. Ne pas utiliser `docker compose down -v` pour un arrêt courant : cette option supprime les données.

## Développement

Le mode Docker de développement recharge les fichiers du dossier au fil des modifications. Il utilise le même volume de données que le mode de production : les migrations doivent rester compatibles et une sauvegarde est conseillée avant de travailler sur leur structure.

```powershell
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

Après modification des dépendances, mettre à jour le volume des modules puis relancer :

```powershell
docker compose -f compose.yaml -f compose.dev.yaml run --rm --no-deps app npm ci
docker compose -f compose.yaml -f compose.dev.yaml up --build
```

Pour travailler sans Docker, installer Node.js 24 puis :

```powershell
npm ci
$env:APP_ORIGIN = 'http://localhost:3000'
npm run dev
```

Le fichier `.env` est lu par Next.js. Les données de cette exécution restent dans `data/passetonpg.sqlite`, séparément du volume Docker. Se rendre sur [localhost:3000](http://localhost:3000). Le service worker est enregistré uniquement en production pour ne pas perturber le rechargement de développement.

Vérifications :

```powershell
npm run test
npm run typecheck
npm run build
```

## Utilisation et calcul

- Invité : travail conservé dans l’onglet après rechargement ; sa fermeture supprime les projets temporaires. Après connexion, un bouton permet de les sauvegarder dans le compte.
- Compte : inscription par pseudo et mot de passe ; sauvegarde automatique des projets valides. Les projets d’un compte ne sont pas accessibles aux autres comptes.
- Type de cylindre : paracentrique, radial ou disque, facultatif dans les fiches du catalogue et les projets. La sélection d’un modèle reprend son type ; le projet en conserve une copie modifiable. Les anciennes données restent « Non renseigné » après migration automatique.
- Projet : 5 ou 6 positions, plage de chiffres incluse entre 0 et 9 et MACS facultatif. Le catalogue préremplit les caractéristiques, mais chaque projet garde sa propre copie.
- Clé : une valeur par position. Cylindre : une ou plusieurs valeurs admises, ou une position explicitement inconnue.
- Pour les cylindres à disques, le MACS ne s’applique pas : il est masqué, enregistré à `null` et ignoré dans les calculs. Une migration automatique corrige les anciennes fiches et les projets à disques.
- À partir de deux cylindres, le moteur intersecte les valeurs admises par position puis conserve les combinaisons respectant `abs(a − b) <= MACS` entre voisins. Un MACS vide est ignoré ; `0` est une contrainte valide.
- Les résultats indiquent le total exact et une liste par pages de 50. Une position inconnue rend le résultat provisoire. Le classement distingue ouvertures confirmées et indéterminées des clés connues.
- Le catalogue peut être prérempli depuis les Excel EUR/US (voir ci-dessous). Les comptes peuvent ajouter une marque et un modèle ; les fiches non validées restent utilisables avec une indication discrète. L’administrateur corrige et valide les fiches et réinitialise les mots de passe depuis son compte.
- Les projets détectent les nouvelles versions de leurs modèles ; une mise à jour des réglages reste explicite. Le modèle personnalisé, le partage, l’export et les e-mails ne font pas partie de la V1.

### Profils paracentriques EUR/US

Après initialisation de la base par l’application, sauvegarder puis importer :

```powershell
npm run seed:catalog
# Avec Docker, après reconstruction de l’image :
docker compose exec app node scripts/seed-catalog.mjs
```

L’import ajoute 39 profils à partir des 41 lignes principales des deux Excel. Les mesures, leurs unités, la provenance et l’empreinte SHA-256 des fichiers sont conservées dans `scripts/catalog/base-profiles.json` et la table `catalog_sources`. Les sections annexes KESO/VAG, les lignes vides et les notes ne deviennent pas des modèles. Les séries TRELOCK et les références YALE EUR/US restent distinctes. Les intitulés « Base EUR/US » sont des repères d’import et non des noms commerciaux confirmés.

Les profils ont 5 goupilles par défaut, modifiables ensuite. Le nombre de tailles est déduit des profondeurs renseignées ; leur indexation 0 à N−1 est provisoire et doit être confirmée avec le codage du cylindre. Ces champs restent à valider. Un MACS numérique simple est repris ; les MACS absents ou variables (CES neu, EMHART, MEDECO BIAXIAL) restent inconnus, avec la valeur source conservée. Les mesures sont optimisées pour impression et peuvent différer des tailles d’origine.

BASI (15 profondeurs) et ZEISS-IKON (20 profondeurs) sont conservés dans `catalog_sources`, sans être proposés comme modèles : la saisie et le calcul actuels acceptent des valeurs de 0 à 9. Aucune taille n’est tronquée. Relancer l’import ne crée pas de doublons et ne remplace jamais les fiches existantes, même corrigées ou renommées par la suite.

### Complément PDF : profondeurs et espacements

Le scan `Residential & Comerical Depth and Space.pdf` est transcrit dans `scripts/catalog/pdf-profiles.json`, avec son empreinte SHA-256, la page et la position de chaque fiche. Les valeurs en pouces sont conservées ; les millimètres affichés sont calculés à partir de ces valeurs, car certaines conversions imprimées dans le scan sont incohérentes.

Après sauvegarde de la base :

```powershell
# Prévisualiser les changements sans les enregistrer
npm run import:pdf-catalog -- --dry-run
# Appliquer l’import local
npm run import:pdf-catalog
# Docker, après reconstruction de l’image
docker compose exec app node scripts/import-pdf-catalog.mjs
```

Sur le catalogue Excel initial, l’import enrichit 11 modèles et ajoute 14 variantes. Les correspondances sont contrôlées sur l’ensemble des profondeurs et la provenance de la ligne Excel, puis les codes originaux remplacent les indices provisoires : notamment Kwikset Titan 1–7 et Medeco Standard 1–6. Les modèles conservent leur identifiant, leur provenance Excel et passent à la version suivante ; les projets existants gardent leurs réglages jusqu’à une mise à jour explicite.

Les nouvelles fiches ont 5 goupilles par défaut, à confirmer. Les MACS existants sont conservés, sans déduire de nouvelles valeurs d’un pas de profondeur ou d’un espacement. Exception : Sargent emploie 1–9 puis 0 ; son MACS est désactivé car le moteur actuel compare les chiffres, et non le rang physique des profondeurs. Cette limite et les orientations Medeco non prises en compte sont indiquées dans les mesures du PDF. La variante Weslock à 8 tailles reste distincte du modèle Excel à 10 tailles. L’écart de butée YALE entre les deux sources reste signalé.

Les 23 fiches mises à part (paillettes, tailles fractionnaires, codes supérieurs à 9, schémas à 4 positions, systèmes spécialisés ou mesures ambiguës) restent consultables dans les données sources avec leur motif. Aucun profil à paillettes n’est classé comme cylindre à disques. Les corrections administrateur ne sont pas écrasées : les conflits sont rapportés. Les imports sont transactionnels et répétables ; la table `catalog_import_changes` conserve l’état précédent des modèles modifiés.

### Hors ligne et installation

Après un premier chargement en production, l’interface est disponible hors ligne. Les projets déjà chargés sont conservés sur l’appareil ; les modifications deviennent des brouillons. Au retour du réseau, l’utilisateur confirme leur envoi. Si le serveur a une autre révision, l’application propose de garder le brouillon comme copie ou de reprendre la version du serveur.

Les API et les données de compte ne sont jamais placées dans le cache du service worker. Les copies locales de compte sont effacées à la déconnexion, après avertissement si des brouillons ne sont pas envoyés. Un appareil contenant ces copies doit être considéré comme un appareil de travail personnel.

Dans un navigateur compatible, utiliser « Installer l’application » ou « Ajouter à l’écran d’accueil ». `localhost` est reconnu comme contexte sécurisé pour le développement. Pour installer depuis un téléphone avec une adresse réseau ou utiliser la PWA sur le futur serveur, HTTPS est nécessaire. Après une mise à jour, fermer les anciens onglets pour laisser la nouvelle version du service worker s’activer.

## Sauvegarder et restaurer

Le script utilise l’API de sauvegarde SQLite, ce qui produit une copie cohérente même lorsque l’application fonctionne. Remplacer `ma-sauvegarde` par un nom daté :

```powershell
docker compose exec app node scripts/backup.mjs /app/data/backups/ma-sauvegarde.sqlite
docker compose cp app:/app/data/backups/ma-sauvegarde.sqlite ./ma-sauvegarde.sqlite
```

Conserver les sauvegardes copiées en dehors du volume, sur un autre support. Elles contiennent les projets et comptes : les protéger comme la base principale.

Pour restaurer un fichier local, commencer par sauvegarder la base actuelle. La restauration remplace son contenu : arrêter l’application avant l’opération et garder Nginx arrêté pendant celle-ci.

```powershell
# Copier d’abord le fichier dans le volume
docker compose exec app mkdir -p /app/data/backups
docker compose cp ./ma-sauvegarde.sqlite app:/app/data/backups/restauration.sqlite
# Arrêter le serveur avant de remplacer la base
docker compose stop nginx app
docker compose run --rm --no-deps app node scripts/restore.mjs /app/data/backups/restauration.sqlite --confirm
docker compose up -d
```

La restauration vérifie l’intégrité du fichier source avant de restaurer. Les sauvegardes faites par une version plus récente ne doivent pas être restaurées dans une ancienne version de l’application.

## Hébergement ultérieur

1. Copier les sources et le fichier de configuration privé sur le serveur, installer Docker et restaurer une sauvegarde dans le volume.
2. Placer Nginx derrière une terminaison HTTPS adaptée au serveur ou lui ajouter une configuration TLS. Le certificat n’est pas géré par cette V1.
3. Remplacer `APP_ORIGIN` par l’origine publique exacte, par exemple `https://pg.exemple.fr`, et mettre `COOKIE_SECURE=true`.
4. Adapter la publication du port Nginx si le frontal HTTPS n’est pas sur le même hôte. Par défaut, seul `127.0.0.1:8080` est publié ; le port de l’application n’est jamais exposé directement.
5. Prévoir les sauvegardes régulières et vérifier une restauration avant l’ouverture publique.

`TRUST_PROXY=true` est limité au réseau Compose ; Nginx remplace l’en-tête d’adresse client pour la limitation des connexions. Si le serveur est placé derrière un autre proxy, adapter explicitement la chaîne de confiance et les en-têtes transmis. Garder une seule instance de l’application avec SQLite dans cette V1.
